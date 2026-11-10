import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { rosterEnrollments } from "../lib/authz";

export async function batchName(ctx: QueryCtx | MutationCtx, batchId: Id<"batches">): Promise<string> {
  const batch = await ctx.db.get(batchId);
  return batch?.name ?? "Unassigned";
}

/** A student's active batch enrollments, each joined with the batch doc. */
export async function studentActiveEnrollments(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, asOfDate?: string): Promise<{ enrollment: Doc<"enrollments">; batch: Doc<"batches"> }[]> {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const rows = await ctx.db
    .query("enrollments")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect();
  const active = rows.filter((r) => r.startDate <= today && (!r.endDate || r.endDate >= today));
  const out: { enrollment: Doc<"enrollments">; batch: Doc<"batches"> }[] = [];
  for (const enrollment of active) {
    const batch = await ctx.db.get(enrollment.batchId);
    if (batch) out.push({ enrollment, batch });
  }
  return out;
}

export interface AttendanceSummary {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  leaveDays: number;
  attendancePct: number;
}

/** Mirrors the reference's attendance_summary(student_id, month) SQL function. */
export async function attendanceSummary(ctx: QueryCtx | MutationCtx, studentId: Id<"students">, period: string): Promise<AttendanceSummary> {
  const rows = await ctx.db
    .query("attendance")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect();
  const inPeriod = rows.filter((r) => r.date.startsWith(period));
  const presentDays = inPeriod.filter((r) => r.status === "present").length;
  const absentDays = inPeriod.filter((r) => r.status === "absent").length;
  const lateDays = inPeriod.filter((r) => r.status === "late").length;
  const leaveDays = inPeriod.filter((r) => r.status === "leave").length;
  const totalDays = inPeriod.length;
  const attendancePct = totalDays > 0 ? Math.round(((presentDays + lateDays) / totalDays) * 1000) / 10 : 0;
  return { totalDays, presentDays, absentDays, lateDays, leaveDays, attendancePct };
}

/**
 * Guardian's active children, ranked by (joinedAt, name, id) — rank 1 is
 * the "firstborn" who pays full tuition; every other rank gets the flat
 * sibling discount off their own tuition. Mirrors generate_vouchers' ranking
 * exactly (see lib/data/aging.ts-equivalent research notes) — NOT a
 * multiply-by-sibling-count formula.
 */
export async function siblingRank(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">): Promise<{ rank: number; siblingCount: number }> {
  const rows = await ctx.db
    .query("students")
    .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
    .collect();
  const active = rows
    .filter((s) => s.status === "active")
    .sort((a, b) => (a.joinedAt !== b.joinedAt ? a.joinedAt.localeCompare(b.joinedAt) : a.name !== b.name ? a.name.localeCompare(b.name) : a._id.localeCompare(b._id)));
  const rank = active.findIndex((s) => s._id === studentId) + 1;
  return { rank: rank || active.length + 1, siblingCount: active.length };
}
