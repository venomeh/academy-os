import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireAdminOrTeacher, requireGuardian, requireProfile, rosterEnrollments, teacherBatchIds, guardianBatchIds, isTeacherOfBatch } from "./lib/authz";

/**
 * Batches/subjects/teacher-assignment — §4.1. A single `list` query scoped
 * by the caller's role (mirrors how the reference's three separate RLS
 * policies on `batches` all resolve through one `SELECT * FROM batches`
 * from the client's point of view).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    let batches: Doc<"batches">[];
    if (profile.role === "admin") {
      batches = await ctx.db
        .query("batches")
        .withIndex("by_academy", (q) => q.eq("academyId", profile.academyId))
        .collect();
    } else if (profile.role === "teacher") {
      const ids = await teacherBatchIds(ctx, profile._id);
      batches = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((b): b is Doc<"batches"> => b !== null);
    } else {
      const { guardian } = await requireGuardian(ctx);
      const ids = await guardianBatchIds(ctx, guardian._id);
      batches = (await Promise.all([...ids].map((id) => ctx.db.get(id)))).filter((b): b is Doc<"batches"> => b !== null);
    }
    return Promise.all(
      batches
        .filter((b) => b.active)
        .map(async (b) => {
          const teacherRows = await ctx.db
            .query("batchTeachers")
            .withIndex("by_batch", (q) => q.eq("batchId", b._id))
            .collect();
          const teachers = (await Promise.all(teacherRows.map((r) => ctx.db.get(r.teacherId)))).filter((t): t is Doc<"profiles"> => t !== null);
          const roster = await rosterEnrollments(ctx, b._id);
          return {
            id: b._id,
            name: b.name,
            gradeLevel: b.gradeLevel ?? null,
            days: b.daysOfWeek,
            startTime: b.startTime ?? null,
            endTime: b.endTime ?? null,
            monthlyTuition: b.monthlyTuition,
            teachers: teachers.map((t) => ({ id: t._id, name: t.fullName })),
            rosterCount: roster.length,
          };
        })
    );
  },
});

/** Admin management view — includes inactive (deactivated/"removed") batches too, so one can be reactivated. */
export const listAllForAdmin = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const batches = await ctx.db
      .query("batches")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .collect();
    return Promise.all(
      batches.map(async (b) => {
        const teacherRows = await ctx.db
          .query("batchTeachers")
          .withIndex("by_batch", (q) => q.eq("batchId", b._id))
          .collect();
        const teachers = (await Promise.all(teacherRows.map((r) => ctx.db.get(r.teacherId)))).filter((t): t is Doc<"profiles"> => t !== null);
        const roster = await rosterEnrollments(ctx, b._id);
        const subjects = await ctx.db
          .query("subjects")
          .withIndex("by_batch", (q) => q.eq("batchId", b._id))
          .collect();
        return {
          id: b._id,
          name: b.name,
          gradeLevel: b.gradeLevel ?? null,
          days: b.daysOfWeek,
          startTime: b.startTime ?? null,
          endTime: b.endTime ?? null,
          monthlyTuition: b.monthlyTuition,
          active: b.active,
          teachers: teachers.map((t) => ({ id: t._id, name: t.fullName })),
          subjects: subjects.map((s) => ({ id: s._id, name: s.name })),
          rosterCount: roster.length,
        };
      })
    );
  },
});

export const getRoster = query({
  args: { batchId: v.id("batches") },
  handler: async (ctx, { batchId }) => {
    const profile = await requireProfile(ctx);
    if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, batchId))) {
      throw new Error("Not your batch.");
    }
    if (profile.role === "parent") {
      const { guardian } = await requireGuardian(ctx);
      const ids = await guardianBatchIds(ctx, guardian._id);
      if (!ids.has(batchId)) throw new Error("Not your child's batch.");
    }
    const roster = await rosterEnrollments(ctx, batchId);
    const students = (await Promise.all(roster.map((e) => ctx.db.get(e.studentId)))).filter((s): s is Doc<"students"> => s !== null && s.status === "active");
    return students
      .map((s) => ({ id: s._id, name: s.name, grade: s.grade ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    gradeLevel: v.optional(v.string()),
    subjectName: v.string(),
    daysOfWeek: v.array(v.string()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    monthlyTuition: v.number(),
    teacherIds: v.array(v.id("profiles")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const batchId = await ctx.db.insert("batches", {
      academyId: admin.academyId,
      name: args.name,
      gradeLevel: args.gradeLevel,
      daysOfWeek: args.daysOfWeek,
      startTime: args.startTime,
      endTime: args.endTime,
      monthlyTuition: args.monthlyTuition,
      active: true,
    });
    await ctx.db.insert("subjects", { academyId: admin.academyId, batchId, name: args.subjectName });
    for (const teacherId of args.teacherIds) {
      await ctx.db.insert("batchTeachers", { batchId, teacherId });
    }
    return batchId;
  },
});

export const update = mutation({
  args: {
    batchId: v.id("batches"),
    name: v.optional(v.string()),
    gradeLevel: v.optional(v.string()),
    monthlyTuition: v.optional(v.number()),
    daysOfWeek: v.optional(v.array(v.string())),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { batchId, ...patch }) => {
    await requireAdmin(ctx);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.db.patch(batchId, clean);
  },
});

export const assignTeacher = mutation({
  args: { batchId: v.id("batches"), teacherId: v.id("profiles") },
  handler: async (ctx, { batchId, teacherId }) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("batchTeachers")
      .withIndex("by_batch_and_teacher", (q) => q.eq("batchId", batchId).eq("teacherId", teacherId))
      .unique();
    if (!existing) await ctx.db.insert("batchTeachers", { batchId, teacherId });
  },
});

export const unassignTeacher = mutation({
  args: { batchId: v.id("batches"), teacherId: v.id("profiles") },
  handler: async (ctx, { batchId, teacherId }) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("batchTeachers")
      .withIndex("by_batch_and_teacher", (q) => q.eq("batchId", batchId).eq("teacherId", teacherId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// ---------------------------------------------------------------------------
// Subjects per batch (§4.1). A batch is the timetable slot; subjects are what
// gets taught in it and what an assessment is filed against, so these need
// their own lifecycle rather than one name frozen at batch creation.
// ---------------------------------------------------------------------------

export const listSubjects = query({
  args: { batchId: v.id("batches") },
  handler: async (ctx, { batchId }) => {
    const profile = await requireProfile(ctx);
    if (profile.role === "teacher" && !(await isTeacherOfBatch(ctx, profile._id, batchId))) return [];
    const rows = await ctx.db
      .query("subjects")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    return Promise.all(
      rows.map(async (s) => {
        const assessments = await ctx.db
          .query("assessments")
          .withIndex("by_batch", (q) => q.eq("batchId", batchId))
          .collect();
        return { id: s._id, name: s.name, assessmentCount: assessments.filter((a) => a.subjectId === s._id).length };
      })
    );
  },
});

export const addSubject = mutation({
  args: { batchId: v.id("batches"), name: v.string() },
  handler: async (ctx, { batchId, name }) => {
    const admin = await requireAdmin(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("A subject name is required.");
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.academyId !== admin.academyId) throw new Error("Batch not found.");
    const existing = await ctx.db
      .query("subjects")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    if (existing.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`${clean} is already a subject in this batch.`);
    }
    return ctx.db.insert("subjects", { academyId: admin.academyId, batchId, name: clean });
  },
});

export const renameSubject = mutation({
  args: { subjectId: v.id("subjects"), name: v.string() },
  handler: async (ctx, { subjectId, name }) => {
    const admin = await requireAdmin(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("A subject name is required.");
    const subject = await ctx.db.get(subjectId);
    if (!subject || subject.academyId !== admin.academyId) throw new Error("Subject not found.");
    await ctx.db.patch(subjectId, { name: clean });
  },
});

/** Refuses while assessments still reference it — marks history must never be orphaned. */
export const removeSubject = mutation({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) => {
    const admin = await requireAdmin(ctx);
    const subject = await ctx.db.get(subjectId);
    if (!subject || subject.academyId !== admin.academyId) throw new Error("Subject not found.");
    const assessments = await ctx.db
      .query("assessments")
      .withIndex("by_batch", (q) => q.eq("batchId", subject.batchId))
      .collect();
    const used = assessments.filter((a) => a.subjectId === subjectId).length;
    if (used > 0) {
      throw new Error(`${subject.name} has ${used} test${used === 1 ? "" : "s"} recorded against it — rename it instead of removing it.`);
    }
    const siblings = await ctx.db
      .query("subjects")
      .withIndex("by_batch", (q) => q.eq("batchId", subject.batchId))
      .collect();
    if (siblings.length <= 1) throw new Error("A batch needs at least one subject.");
    await ctx.db.delete(subjectId);
  },
});

export const listTeachers = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("profiles")
      .withIndex("by_role", (q) => q.eq("academyId", admin.academyId).eq("role", "teacher"))
      .collect();
    return rows.filter((r) => r.active).map((r) => ({ id: r._id, name: r.fullName, email: r.email }));
  },
});
