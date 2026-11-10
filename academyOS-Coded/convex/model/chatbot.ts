import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ownedStudentOrNull, guardianStudents } from "../lib/authz";
import { attendanceSummary, studentActiveEnrollments } from "./roster";
import { outstandingOf, voucherPaid } from "./ledger";

/**
 * The chatbot's tool surface (§12). Each function is a genuine, correctly
 * scoped read the model can call through convex/chatbot.ts's tool loop;
 * the model composes the reply, these decide what it is allowed to know.
 *
 * Hard rule (Tasks.md §15 Rule 6): every tool takes `guardianId` from the
 * caller's resolved session, never from a tool argument. Where a tool also
 * takes a `studentId`, it is re-validated against that guardian via
 * `ownedStudentOrNull` — a foreign id returns a "not found" shape, never an
 * error, so a probing question can't be used to enumerate other families.
 */

const PERIOD = () => new Date().toISOString().slice(0, 7);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export async function getMyChildren(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">) {
  const students = await guardianStudents(ctx, guardianId);
  const period = PERIOD();
  return Promise.all(
    students.map(async (s) => {
      const enrollments = await studentActiveEnrollments(ctx, s._id);
      const summary = await attendanceSummary(ctx, s._id, period);
      const vouchers = await ctx.db
        .query("vouchers")
        .withIndex("by_student_and_period", (q) => q.eq("studentId", s._id).eq("period", period))
        .collect();
      let outstanding = 0;
      for (const v of vouchers) {
        outstanding += Math.max(0, await outstandingOn(ctx, v));
      }
      return {
        studentId: s._id,
        name: s.name,
        batches: enrollments.map((e) => e.batch.name),
        attendancePct: summary.attendancePct,
        outstanding,
      };
    })
  );
}

async function voucherEntries(ctx: QueryCtx | MutationCtx, voucher: Doc<"vouchers">) {
  return ctx.db
    .query("ledgerEntries")
    .withIndex("by_voucher", (q) => q.eq("voucherId", voucher._id))
    .collect();
}

async function outstandingOn(ctx: QueryCtx | MutationCtx, voucher: Doc<"vouchers">): Promise<number> {
  return outstandingOf(voucher, await voucherEntries(ctx, voucher));
}

export async function getOutstandingBalance(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">) {
  const students = await guardianStudents(ctx, guardianId);
  const period = PERIOD();
  const perChild: { studentId: Id<"students">; name: string; outstanding: number; voucherId: Id<"vouchers"> | null }[] = [];
  let total = 0;
  for (const s of students) {
    const voucher = await ctx.db
      .query("vouchers")
      .withIndex("by_student_and_period", (q) => q.eq("studentId", s._id).eq("period", period))
      .unique();
    if (!voucher) continue;
    const outstanding = Math.max(0, await outstandingOn(ctx, voucher));
    total += outstanding;
    perChild.push({ studentId: s._id, name: s.name, outstanding, voucherId: outstanding > 0 ? voucher._id : null });
  }
  return { total, period, children: perChild };
}

export async function getVoucherDetails(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, voucherId: Id<"vouchers">) {
  const voucher = await ctx.db.get(voucherId);
  if (!voucher) return null;
  const owned = await ownedStudentOrNull(ctx, guardianId, voucher.studentId);
  if (!owned) return null; // not this guardian's voucher — looks identical to "doesn't exist"
  const entries = await voucherEntries(ctx, voucher);
  return {
    ref: voucher._id,
    period: voucher.period,
    dueDate: voucher.dueDate,
    status: voucher.status,
    total: voucher.total,
    paid: voucherPaid(entries),
    outstanding: Math.max(0, outstandingOf(voucher, entries)),
    lineItems: voucher.lineItems,
    studentName: owned.name,
  };
}

export async function getAttendance(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">, period?: string) {
  const student = await ownedStudentOrNull(ctx, guardianId, studentId);
  if (!student) return null;
  const summary = await attendanceSummary(ctx, studentId, period ?? PERIOD());
  return { studentName: student.name, period: period ?? PERIOD(), ...summary };
}

/**
 * There's no advance test-schedule concept in this schema — assessments are
 * recorded after the fact by the teacher, not scheduled ahead of time. So
 * this tool is honest about what it actually knows: the student's regular
 * batch meeting days/times, not a fabricated "next test on [date]".
 */
export async function getUpcomingAssessments(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">) {
  const student = await ownedStudentOrNull(ctx, guardianId, studentId);
  if (!student) return null;
  const enrollments = await studentActiveEnrollments(ctx, studentId);
  return {
    studentName: student.name,
    note: "Specific test dates aren't scheduled in advance here — ask the teacher. Regular class times:",
    batches: enrollments.map((e) => ({ batch: e.batch.name, days: e.batch.daysOfWeek, startTime: e.batch.startTime ?? null, endTime: e.batch.endTime ?? null })),
  };
}

export async function getBatchSchedule(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">) {
  const student = await ownedStudentOrNull(ctx, guardianId, studentId);
  if (!student) return null;
  const enrollments = await studentActiveEnrollments(ctx, studentId);
  return {
    studentName: student.name,
    batches: enrollments.map((e) => ({ batch: e.batch.name, days: e.batch.daysOfWeek, startTime: e.batch.startTime ?? null, endTime: e.batch.endTime ?? null })),
  };
}

export async function getPublishedResults(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">) {
  const student = await ownedStudentOrNull(ctx, guardianId, studentId);
  if (!student) return null;

  const scores = await ctx.db
    .query("scores")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect();

  const results = [];
  for (const score of scores) {
    if (score.absent || score.obtained === undefined) continue;
    const assessment = await ctx.db.get(score.assessmentId);
    if (!assessment || !assessment.published) continue;
    const subject = await ctx.db.get(assessment.subjectId);
    const peers = await ctx.db
      .query("scores")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessment._id))
      .collect();
    const scoredPeers = peers.filter((p) => !p.absent && p.obtained !== undefined);
    const average = scoredPeers.length ? Math.round(scoredPeers.reduce((s, p) => s + (p.obtained ?? 0), 0) / scoredPeers.length) : 0;
    results.push({ subject: subject?.name ?? "Subject", date: assessment.date, score: score.obtained, average, maxMarks: assessment.maxMarks });
  }
  return { studentName: student.name, results: results.sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

export async function getApprovedRemarks(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">) {
  const student = await ownedStudentOrNull(ctx, guardianId, studentId);
  if (!student) return null;
  const rows = await ctx.db
    .query("remarks")
    .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId))
    .collect();
  const approved = rows
    .filter((r) => r.status === "approved")
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .map((r) => ({ period: r.period, text: r.finalText ?? r.draftText ?? "" }));
  return { studentName: student.name, remarks: approved };
}

/**
 * Writes the inquiry and returns who to notify. The admin email itself is
 * sent by the calling *action* — a Convex mutation cannot make network calls,
 * so sending from in here would throw the moment a parent escalated.
 */
export async function createInquiry(ctx: MutationCtx, guardianId: Id<"guardians">, topic: string, message: string) {
  const guardian = await ctx.db.get(guardianId);
  if (!guardian) throw new Error("Guardian not found.");
  const inquiryId = await ctx.db.insert("inquiries", {
    academyId: guardian.academyId,
    guardianId,
    topic,
    message,
    status: "open",
  });
  const admins = await ctx.db
    .query("profiles")
    .withIndex("by_role", (q) => q.eq("academyId", guardian.academyId).eq("role", "admin"))
    .collect();
  return {
    inquiryId,
    guardianName: guardian.name,
    adminEmails: admins.filter((a) => a.active).map((a) => a.email),
  };
}
