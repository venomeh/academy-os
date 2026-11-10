import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireGuardian, guardianStudents } from "./lib/authz";
import { attendanceSummary, studentActiveEnrollments } from "./model/roster";
import { outstandingOf } from "./model/ledger";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Current-period balance for one student, from the ledger — a partial voucher must show what's left, not its full total. */
async function currentOutstanding(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, period: string): Promise<{ outstanding: number; status: "unpaid" | "partial" | "paid"; hasVoucher: boolean }> {
  const vouchers = await ctx.db
    .query("vouchers")
    .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId).eq("period", period))
    .collect();
  let outstanding = 0;
  for (const v of vouchers) {
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", v._id))
      .collect();
    outstanding += Math.max(0, outstandingOf(v, entries));
  }
  const status = vouchers.some((v) => v.status === "unpaid") ? "unpaid" : vouchers.some((v) => v.status === "partial") ? "partial" : "paid";
  return { outstanding, status, hasVoucher: vouchers.length > 0 };
}

/**
 * Students & guardians — §5.1. Sibling discount is *derived*, never stored:
 * it comes from ranking a guardian's active children (model/roster.ts),
 * recomputed fresh every time a voucher is generated.
 */

export const listForAdmin = query({
  args: { query: v.optional(v.string()), filter: v.optional(v.union(v.literal("All"), v.literal("Owing"), v.literal("Paid up"), v.literal("Siblings"), v.literal("Left"))) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const period = new Date().toISOString().slice(0, 7);
    const all = await ctx.db
      .query("students")
      .withIndex("by_status", (q) => q.eq("academyId", admin.academyId).eq("status", args.filter === "Left" ? "left" : "active"))
      .collect();

    const rows = await Promise.all(
      all.map(async (student) => {
        const guardian = await ctx.db.get(student.guardianId);
        const siblingCount = guardian ? (await guardianStudents(ctx, guardian._id)).length : 1;
        const summary = await attendanceSummary(ctx, student._id, period);
        const enrollments = await studentActiveEnrollments(ctx, student._id);
        const { outstanding, status, hasVoucher } = await currentOutstanding(ctx, student._id, period);
        return {
          id: student._id,
          name: student.name,
          grade: student.grade ?? null,
          joinedAt: student.joinedAt,
          guardian: guardian?.name ?? "—",
          guardianId: guardian?._id ?? null,
          batches: enrollments.map((e) => e.batch.name),
          siblingCount,
          attendancePct: summary.attendancePct,
          balance: outstanding,
          status: hasVoucher ? status : "paid",
        };
      })
    );

    const q = (args.query ?? "").trim().toLowerCase();
    const filter = args.filter ?? "All";
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.guardian} ${r.batches.join(" ")}`.toLowerCase().includes(q)) return false;
      if (filter === "Owing" && r.balance <= 0) return false;
      if (filter === "Paid up" && r.balance > 0) return false;
      if (filter === "Siblings" && r.siblingCount < 2) return false;
      return true;
    });
  },
});

export const getDetail = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    await requireAdmin(ctx);
    const student = await ctx.db.get(studentId);
    if (!student) return null;
    const guardian = await ctx.db.get(student.guardianId);
    const siblingCount = guardian ? (await guardianStudents(ctx, guardian._id)).length : 1;
    const period = new Date().toISOString().slice(0, 7);
    const summary = await attendanceSummary(ctx, studentId, period);
    const enrollments = await studentActiveEnrollments(ctx, studentId);
    const recentLedger = guardian
      ? (
          await ctx.db
            .query("ledgerEntries")
            .withIndex("by_guardian", (q) => q.eq("guardianId", guardian._id))
            .order("desc")
            .take(6)
        ).map((l) => ({ kind: l.kind, amount: l.amount, reason: l.reason ?? null, createdAt: l._creationTime }))
      : [];
    return {
      id: student._id,
      name: student.name,
      grade: student.grade ?? null,
      status: student.status,
      joinedAt: student.joinedAt,
      needsFeeReview: student.needsFeeReview ?? false,
      feeOverride: student.feeOverride ?? null,
      overrideReason: student.overrideReason ?? null,
      guardian: guardian ? { id: guardian._id, name: guardian.name, phone: guardian.phone ?? null, languagePref: guardian.languagePref } : null,
      siblingCount,
      attendancePct: summary.attendancePct,
      batches: enrollments.map((e) => ({ enrollmentId: e.enrollment._id, id: e.batch._id, name: e.batch.name })),
      recentLedger,
    };
  },
});

export const countActive = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("students")
      .withIndex("by_status", (q) => q.eq("academyId", admin.academyId).eq("status", "active"))
      .collect();
    return rows.length;
  },
});

export const enroll = mutation({
  args: {
    name: v.string(),
    grade: v.optional(v.string()),
    guardianId: v.optional(v.id("guardians")),
    batchId: v.id("batches"),
    joinedAt: v.string(),
    feeOverride: v.optional(v.number()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    // A brand-new parent is invited first (auth.provisionAccount creates the
    // login *and* the guardians row) and the returned guardianId is passed
    // here — the enroll modal does both steps in one go.
    const guardianId = args.guardianId;
    if (!guardianId) throw new Error("Guardian is required.");

    const guardian = await ctx.db.get(guardianId);
    if (!guardian || guardian.academyId !== admin.academyId) throw new Error("Guardian not found.");

    const today = new Date().toISOString().slice(0, 10);
    const isMidMonth = args.joinedAt.slice(0, 7) === today.slice(0, 7) && Number(args.joinedAt.slice(8, 10)) > 1;

    const studentId = await ctx.db.insert("students", {
      academyId: admin.academyId,
      guardianId,
      name: args.name,
      grade: args.grade,
      status: "active",
      joinedAt: args.joinedAt,
      feeOverride: args.feeOverride,
      overrideReason: args.overrideReason,
      needsFeeReview: isMidMonth,
    });
    await ctx.db.insert("enrollments", { studentId, batchId: args.batchId, startDate: args.joinedAt });
    return studentId;
  },
});

export const addEnrollment = mutation({
  args: { studentId: v.id("students"), batchId: v.id("batches"), startDate: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.insert("enrollments", args);
  },
});

export const endEnrollment = mutation({
  args: { enrollmentId: v.id("enrollments"), endDate: v.string() },
  handler: async (ctx, { enrollmentId, endDate }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(enrollmentId, { endDate });
  },
});

/** Marking a student "left" stops future vouchers but preserves ledger/history (§5.1) — no cascading deletes, ever. */
export const markLeft = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(studentId, { status: "left" });
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    const today = new Date().toISOString().slice(0, 10);
    for (const e of enrollments) {
      if (!e.endDate) await ctx.db.patch(e._id, { endDate: today });
    }
  },
});

export const reactivate = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(studentId, { status: "active" });
  },
});

export const clearFeeReview = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(studentId, { needsFeeReview: false });
  },
});

/** Per-student scholarship/custom-fee override (§4.2) — a reason is required so the discount is auditable, not silent. */
export const setFeeOverride = mutation({
  args: { studentId: v.id("students"), feeOverride: v.optional(v.number()), overrideReason: v.optional(v.string()) },
  handler: async (ctx, { studentId, feeOverride, overrideReason }) => {
    await requireAdmin(ctx);
    if (feeOverride !== undefined && !overrideReason?.trim()) throw new Error("A reason is required for a fee override.");
    await ctx.db.patch(studentId, {
      feeOverride: feeOverride ?? undefined,
      overrideReason: feeOverride === undefined ? undefined : overrideReason,
    });
  },
});

/** Parent Portal children overview (§11) — the signed-in guardian's own active kids only, each with their batch, current-period outstanding balance, and attendance %. */
export const listForGuardian = query({
  args: {},
  handler: async (ctx) => {
    const { guardian } = await requireGuardian(ctx);
    const students = await guardianStudents(ctx, guardian._id);
    const period = new Date().toISOString().slice(0, 7);
    return Promise.all(
      students.map(async (s) => {
        const enrollments = await studentActiveEnrollments(ctx, s._id);
        const summary = await attendanceSummary(ctx, s._id, period);
        const { outstanding } = await currentOutstanding(ctx, s._id, period);
        return {
          id: s._id,
          name: s.name,
          grade: s.grade ?? null,
          batches: enrollments.map((e) => e.batch.name),
          due: outstanding,
          attendancePct: summary.attendancePct,
        };
      })
    );
  },
});
