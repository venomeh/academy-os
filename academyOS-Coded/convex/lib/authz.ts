import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Authorization helpers — the Convex equivalent of the reference backend's
 * SQL `auth_role()` / `auth_guardian_id()` / `auth_teacher_batch_ids()` etc.
 * helper functions and its RLS policies (see academyOS-BubbleServer/supabase/
 * migrations/20260729075633_initial_schema.sql and 20260729090000_
 * rls_policies.sql — reference implementation).
 *
 * Convex has no database-enforced row security, so *every* query, mutation,
 * and action that touches guardian/student/batch-scoped data must call one
 * of these at the top. There is no equivalent of "RLS silently filters rows
 * for you" — an unscoped `ctx.db.query(...)` returns everything.
 *
 * Two argument shapes on purpose, mirroring the reference's no-enumeration
 * pattern (`parent_own_student_id` returns null rather than erroring):
 *   - `requireX` throws (for mutations / anything that should hard-fail)
 *   - plain getters return `null` (for read paths where "not yours" should
 *     look identical to "doesn't exist", not leak existence via an error)
 */

export class AuthzError extends Error {}

export async function currentUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users"> | null> {
  return getAuthUserId(ctx);
}

export async function currentProfile(ctx: QueryCtx | MutationCtx): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

export async function requireProfile(ctx: QueryCtx | MutationCtx): Promise<Doc<"profiles">> {
  const profile = await currentProfile(ctx);
  if (!profile) throw new AuthzError("Not signed in.");
  if (!profile.active) throw new AuthzError("This account has been deactivated.");
  return profile;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"profiles">> {
  const profile = await requireProfile(ctx);
  if (profile.role !== "admin") throw new AuthzError("Admin access required.");
  return profile;
}

export async function requireTeacher(ctx: QueryCtx | MutationCtx): Promise<Doc<"profiles">> {
  const profile = await requireProfile(ctx);
  if (profile.role !== "teacher") throw new AuthzError("Teacher access required.");
  return profile;
}

export async function requireAdminOrTeacher(ctx: QueryCtx | MutationCtx): Promise<Doc<"profiles">> {
  const profile = await requireProfile(ctx);
  if (profile.role !== "admin" && profile.role !== "teacher") throw new AuthzError("Staff access required.");
  return profile;
}

/** Resolves the signed-in parent's guardian row. Throws if not a parent or no linked guardian. */
export async function requireGuardian(ctx: QueryCtx | MutationCtx): Promise<{ profile: Doc<"profiles">; guardian: Doc<"guardians"> }> {
  const profile = await requireProfile(ctx);
  if (profile.role !== "parent") throw new AuthzError("Parent access required.");
  const guardian = await ctx.db
    .query("guardians")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .unique();
  if (!guardian) throw new AuthzError("No guardian record linked to this account.");
  return { profile, guardian };
}

/** Batch IDs a teacher is assigned to. Mirrors auth_teacher_batch_ids(). */
export async function teacherBatchIds(ctx: QueryCtx | MutationCtx, teacherId: Id<"profiles">): Promise<Id<"batches">[]> {
  const rows = await ctx.db
    .query("batchTeachers")
    .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
    .collect();
  return rows.map((r) => r.batchId);
}

export async function isTeacherOfBatch(ctx: QueryCtx | MutationCtx, teacherId: Id<"profiles">, batchId: Id<"batches">): Promise<boolean> {
  const row = await ctx.db
    .query("batchTeachers")
    .withIndex("by_batch_and_teacher", (q) => q.eq("batchId", batchId).eq("teacherId", teacherId))
    .unique();
  return row !== null;
}

/**
 * Active enrollment rows for a batch, deduped to one row per student (the
 * reference's "roster duplication" bug: overlapping enrollment rows for the
 * same student inflated roster counts — fixed there via `distinct on
 * (student_id) order by start_date desc`; replicated here the same way).
 * Only enrollments with no end_date, or an end_date not yet reached, count.
 */
export async function rosterEnrollments(ctx: QueryCtx | MutationCtx, batchId: Id<"batches">, asOfDate?: string): Promise<Doc<"enrollments">[]> {
  const rows = await ctx.db
    .query("enrollments")
    .withIndex("by_batch", (q) => q.eq("batchId", batchId))
    .collect();
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const active = rows.filter((r) => r.startDate <= today && (!r.endDate || r.endDate >= today));
  const latestByStudent = new Map<Id<"students">, Doc<"enrollments">>();
  for (const row of active) {
    const existing = latestByStudent.get(row.studentId);
    if (!existing || row.startDate > existing.startDate) latestByStudent.set(row.studentId, row);
  }
  return [...latestByStudent.values()];
}

/** Distinct student IDs a teacher can see, across all their batches (deduped). Mirrors auth_teacher_student_ids(). */
export async function teacherStudentIds(ctx: QueryCtx | MutationCtx, teacherId: Id<"profiles">): Promise<Set<Id<"students">>> {
  const batchIds = await teacherBatchIds(ctx, teacherId);
  const ids = new Set<Id<"students">>();
  for (const batchId of batchIds) {
    const roster = await rosterEnrollments(ctx, batchId);
    for (const e of roster) ids.add(e.studentId);
  }
  return ids;
}

/** Active student rows for a guardian. Mirrors auth_student_ids(). */
export async function guardianStudents(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">): Promise<Doc<"students">[]> {
  const rows = await ctx.db
    .query("students")
    .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
    .collect();
  return rows.filter((s) => s.status === "active");
}

/**
 * Verifies a student belongs to this guardian. Returns the student or null
 * — deliberately not throwing, so a guessed/foreign student ID looks
 * identical to a nonexistent one (the reference's `parent_own_student_id`
 * no-enumeration pattern). Callers on a mutation path that should hard-fail
 * can throw on a null result themselves.
 */
export async function ownedStudentOrNull(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">, studentId: Id<"students">): Promise<Doc<"students"> | null> {
  const student = await ctx.db.get(studentId);
  if (!student || student.guardianId !== guardianId) return null;
  return student;
}

/** Batch IDs any of a guardian's children are enrolled in. Mirrors auth_child_batch_ids(). */
export async function guardianBatchIds(ctx: QueryCtx | MutationCtx, guardianId: Id<"guardians">): Promise<Set<Id<"batches">>> {
  const students = await guardianStudents(ctx, guardianId);
  const ids = new Set<Id<"batches">>();
  for (const student of students) {
    const rows = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    for (const r of rows) {
      if (!r.endDate || r.endDate >= new Date().toISOString().slice(0, 10)) ids.add(r.batchId);
    }
  }
  return ids;
}

/** Asia/Karachi "today" as an ISO date string — attendance's same-day rule is timezone-specific, not server-UTC. */
export function pktToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}
