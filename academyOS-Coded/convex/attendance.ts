import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireAdminOrTeacher, requireGuardian, isTeacherOfBatch, rosterEnrollments, ownedStudentOrNull, pktToday } from "./lib/authz";
import { attendanceSummary } from "./model/roster";

const STATUS = v.union(v.literal("present"), v.literal("absent"), v.literal("late"), v.literal("leave"));

/** Teacher's marking UI for one batch/date — unset rows default to "present" for display (§6.1), never persisted until Save. */
export const getForBatch = query({
  args: { batchId: v.id("batches"), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireAdminOrTeacher(ctx);
    if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, args.batchId))) {
      throw new Error("Not your batch.");
    }
    const date = args.date ?? pktToday();
    const roster = await rosterEnrollments(ctx, args.batchId);
    const students = (await Promise.all(roster.map((e) => ctx.db.get(e.studentId)))).filter((s): s is Doc<"students"> => s !== null);
    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_batch_and_date", (q) => q.eq("batchId", args.batchId).eq("date", date))
      .collect();
    const byStudent = new Map(existing.map((a) => [a.studentId, a]));
    const saved = existing.length > 0;
    const rows = students
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        const a = byStudent.get(s._id);
        return { studentId: s._id, name: s.name, status: a?.status ?? "present", corrected: Boolean(a?.correctedBy) };
      });
    return { date, saved, rows };
  },
});

export const save = mutation({
  args: {
    batchId: v.id("batches"),
    date: v.string(),
    rows: v.array(v.object({ studentId: v.id("students"), status: STATUS })),
  },
  handler: async (ctx, args) => {
    const profile = await requireAdminOrTeacher(ctx);
    if (profile.role === "teacher") {
      if (!(await isTeacherOfBatch(ctx, profile._id, args.batchId))) throw new Error("Not your batch.");
      if (args.date !== pktToday()) throw new Error("Teachers can only mark today's attendance — corrections go through the admin.");
    }
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found.");

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("attendance")
        .withIndex("by_student_and_batch_and_date", (q) => q.eq("studentId", row.studentId).eq("batchId", args.batchId).eq("date", args.date))
        .unique();
      if (existing) {
        const isCorrection = existing.status !== row.status && existing.markedBy !== profile._id;
        await ctx.db.patch(existing._id, {
          status: row.status,
          ...(isCorrection ? { correctedBy: profile._id, correctedAt: Date.now() } : {}),
        });
      } else {
        await ctx.db.insert("attendance", {
          academyId: batch.academyId,
          studentId: row.studentId,
          batchId: args.batchId,
          date: args.date,
          status: row.status,
          markedBy: profile._id,
        });
      }
    }
  },
});

/** Admin realtime tile (§6.1): batches marked today, present %, flagged after cutoff. */
export const getTodayOverview = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const today = pktToday();
    const cutoffHour = 18; // 6:30pm-ish cutoff, matches the reference's flavor; batches after this hour with no marks are flagged
    const nowHour = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", hour: "numeric", hour12: false }).format(new Date());

    const batches = await ctx.db
      .query("batches")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .collect();

    let totalPresentLike = 0;
    let totalMarked = 0;
    let markedCount = 0;
    let flagged = 0;

    const rows = await Promise.all(
      batches
        .filter((b) => b.active)
        .map(async (b) => {
          const roster = await rosterEnrollments(ctx, b._id);
          const records = await ctx.db
            .query("attendance")
            .withIndex("by_batch_and_date", (q) => q.eq("batchId", b._id).eq("date", today))
            .collect();
          const present = records.filter((r) => r.status === "present").length;
          const absent = records.filter((r) => r.status === "absent").length;
          const late = records.filter((r) => r.status === "late").length;
          const marked = records.length > 0;
          if (marked) {
            markedCount += 1;
            totalPresentLike += present + late;
            totalMarked += records.length;
          } else if (Number(nowHour) >= cutoffHour) {
            flagged += 1;
          }
          const teacherRows = await ctx.db
            .query("batchTeachers")
            .withIndex("by_batch", (q) => q.eq("batchId", b._id))
            .collect();
          const teacher = teacherRows[0] ? await ctx.db.get(teacherRows[0].teacherId) : null;
          return {
            batchId: b._id,
            name: b.name,
            teacher: teacher?.fullName ?? "Unassigned",
            time: b.startTime ?? "",
            roster: roster.length,
            status: marked ? "marked" : Number(nowHour) >= cutoffHour ? "flagged" : "pending",
            present,
            absent,
            late,
          };
        })
    );

    return {
      markedCount,
      totalBatches: rows.length,
      presentPct: totalMarked ? Math.round((totalPresentLike / totalMarked) * 100) : 0,
      flagged,
      batches: rows,
    };
  },
});

/** Parent's monthly calendar for one child (§11) — no-enumeration on a foreign student id. */
export const getCalendar = query({
  args: { studentId: v.id("students"), period: v.string() },
  handler: async (ctx, { studentId, period }) => {
    const { guardian } = await requireGuardian(ctx);
    const student = await ownedStudentOrNull(ctx, guardian._id, studentId);
    if (!student) return null;

    const summary = await attendanceSummary(ctx, studentId, period);
    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    const inPeriod = new Map(rows.filter((r) => r.date.startsWith(period)).map((r) => [r.date, r.status]));

    const [year, month] = period.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const iso = `${period}-${String(day).padStart(2, "0")}`;
      const dow = new Date(`${iso}T12:00:00`).getDay();
      const status = inPeriod.get(iso) ?? (dow === 0 || dow === 6 ? "off" : "unmarked");
      return { day, status };
    });

    return { pct: summary.attendancePct, sessionCount: summary.totalDays, absences: summary.absentDays, days };
  },
});
