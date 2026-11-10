import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminOrTeacher, requireGuardian, isTeacherOfBatch, rosterEnrollments, ownedStudentOrNull } from "./lib/authz";

/**
 * Assessments & marks — §7. Two integrity guards ported from the reference
 * (academic_integrity_hardening / guards_rpcs migrations):
 *  - a subject must belong to the assessment's own batch
 *  - publish is blocked until every actively-enrolled roster student has
 *    either an obtained score or absent:true — "ready to publish" is a
 *    computed status, not a checkbox the teacher can just tick.
 */

export const createAssessment = mutation({
  args: { batchId: v.id("batches"), subjectId: v.id("subjects"), date: v.string(), maxMarks: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireAdminOrTeacher(ctx);
    if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, args.batchId))) throw new Error("Not your batch.");
    const subject = await ctx.db.get(args.subjectId);
    if (!subject || subject.batchId !== args.batchId) throw new Error("That subject doesn't belong to this batch.");
    if (args.maxMarks <= 0) throw new Error("Max marks must be positive.");
    return ctx.db.insert("assessments", {
      academyId: subject.academyId,
      batchId: args.batchId,
      subjectId: args.subjectId,
      date: args.date,
      maxMarks: args.maxMarks,
      published: false,
      createdBy: profile._id,
    });
  },
});

export const getLatestForBatch = query({
  args: { batchId: v.id("batches") },
  handler: async (ctx, { batchId }) => {
    const profile = await requireAdminOrTeacher(ctx);
    if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, batchId))) throw new Error("Not your batch.");
    const rows = await ctx.db
      .query("assessments")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    if (rows.length === 0) return null;
    const latest = rows.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const subject = await ctx.db.get(latest.subjectId);
    const batch = await ctx.db.get(latest.batchId);
    return {
      id: latest._id,
      batchId: latest.batchId,
      batchName: batch?.name ?? "Unassigned",
      subject: subject?.name ?? "Subject",
      date: latest.date,
      maxMarks: latest.maxMarks,
      published: latest.published,
    };
  },
});

async function requireAssessmentAccess(ctx: QueryCtx | MutationCtx, assessmentId: Id<"assessments">) {
  const profile = await requireAdminOrTeacher(ctx);
  const assessment = await ctx.db.get(assessmentId);
  if (!assessment) throw new Error("Assessment not found.");
  if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, assessment.batchId))) throw new Error("Not your batch.");
  return { profile, assessment };
}

/** Every test for a batch, newest first — the teacher's test picker (§7: a partial entry stays reachable as a draft). */
export const listForBatch = query({
  args: { batchId: v.id("batches") },
  handler: async (ctx, { batchId }) => {
    const profile = await requireAdminOrTeacher(ctx);
    if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, batchId))) throw new Error("Not your batch.");
    const rows = await ctx.db
      .query("assessments")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    const batch = await ctx.db.get(batchId);
    return Promise.all(
      rows
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map(async (a) => {
          const subject = await ctx.db.get(a.subjectId);
          return {
            id: a._id,
            batchId: a.batchId,
            batchName: batch?.name ?? "Unassigned",
            subject: subject?.name ?? "Subject",
            date: a.date,
            maxMarks: a.maxMarks,
            published: a.published,
          };
        })
    );
  },
});

export const getMarksGrid = query({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, { assessmentId }) => {
    const { assessment } = await requireAssessmentAccess(ctx, assessmentId);
    const roster = await rosterEnrollments(ctx, assessment.batchId);
    const students = (await Promise.all(roster.map((e) => ctx.db.get(e.studentId)))).filter((s): s is Doc<"students"> => s !== null);
    const scores = await ctx.db
      .query("scores")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
      .collect();
    const byStudent = new Map(scores.map((s) => [s.studentId, s]));
    const rows = students
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        const score = byStudent.get(s._id);
        return { studentId: s._id, name: s.name, value: score && !score.absent && score.obtained !== undefined ? String(score.obtained) : "", absent: score?.absent ?? false };
      });
    return { maxMarks: assessment.maxMarks, rows };
  },
});

export const saveMarksDraft = mutation({
  args: {
    assessmentId: v.id("assessments"),
    rows: v.array(v.object({ studentId: v.id("students"), value: v.string(), absent: v.boolean() })),
  },
  handler: async (ctx, args) => {
    const { assessment } = await requireAssessmentAccess(ctx, args.assessmentId);
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("scores")
        .withIndex("by_assessment_and_student", (q) => q.eq("assessmentId", args.assessmentId).eq("studentId", row.studentId))
        .unique();
      const trimmed = row.value.trim();

      // Blank + not absent = "not entered yet", a valid draft state — the
      // reference's fix for a bug where this raised instead of clearing.
      if (!row.absent && trimmed === "") {
        if (existing) await ctx.db.delete(existing._id);
        continue;
      }

      const obtained = row.absent ? undefined : Number(trimmed);
      if (!row.absent && (Number.isNaN(obtained) || (obtained as number) < 0)) throw new Error(`Invalid marks for one student.`);
      if (!row.absent && (obtained as number) > assessment.maxMarks) throw new Error(`Obtained marks exceed the maximum of ${assessment.maxMarks}.`);

      if (existing) {
        await ctx.db.patch(existing._id, { obtained, absent: row.absent });
      } else {
        await ctx.db.insert("scores", { assessmentId: args.assessmentId, studentId: row.studentId, obtained, absent: row.absent });
      }
    }
  },
});

export const publish = mutation({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, { assessmentId }) => {
    const { assessment } = await requireAssessmentAccess(ctx, assessmentId);
    const roster = await rosterEnrollments(ctx, assessment.batchId);
    const scores = await ctx.db
      .query("scores")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
      .collect();
    const scored = new Set(scores.map((s) => s.studentId));
    const missing = roster.filter((e) => !scored.has(e.studentId));
    if (missing.length > 0) {
      throw new Error(`${missing.length} student${missing.length === 1 ? "" : "s"} still need${missing.length === 1 ? "s" : ""} a mark or an absent flag before you can publish.`);
    }
    await ctx.db.patch(assessmentId, { published: true });
    return { notified: scores.length };
  },
});

export const getPublishedResults = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const { guardian } = await requireGuardian(ctx);
    const student = await ownedStudentOrNull(ctx, guardian._id, studentId);
    if (!student) return [];

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
    return results.sort((a, b) => (a.date < b.date ? 1 : -1));
  },
});

export const listSubjectsForBatch = query({
  args: { batchId: v.id("batches") },
  handler: async (ctx, { batchId }) => {
    await requireAdminOrTeacher(ctx);
    const rows = await ctx.db
      .query("subjects")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    return rows.map((s) => ({ id: s._id, name: s.name }));
  },
});
