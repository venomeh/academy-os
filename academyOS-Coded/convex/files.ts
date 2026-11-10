import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireProfile, ownedStudentOrNull, teacherStudentIds, guardianStudents } from "./lib/authz";

/**
 * Student photos — Convex's own file storage stands in for the reference's
 * Cloudflare R2 + presigned-URL pattern (per the user's instruction: no R2,
 * Convex handles file storage too). The presigned-upload *shape* is the
 * same (client asks for an upload URL, uploads directly, tells the server
 * the result) — Convex just doesn't need manual key construction, expiry
 * handling, or a separate signed-GET step, since access is already gated by
 * whatever query you write around `ctx.storage.getUrl`.
 */

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const savePhoto = mutation({
  args: { studentId: v.id("students"), storageId: v.id("_storage") },
  handler: async (ctx, { studentId, storageId }) => {
    await requireAdmin(ctx);
    const student = await ctx.db.get(studentId);
    if (!student) throw new Error("Student not found.");
    if (student.photoStorageId) await ctx.storage.delete(student.photoStorageId);
    await ctx.db.patch(studentId, { photoStorageId: storageId });
  },
});

export const getPhotoUrl = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const profile = await requireProfile(ctx);
    const student = await ctx.db.get(studentId);
    if (!student) return null;

    let allowed = false;
    if (profile.role === "admin") {
      allowed = student.academyId === profile.academyId;
    } else if (profile.role === "teacher") {
      allowed = (await teacherStudentIds(ctx, profile._id)).has(studentId);
    } else if (profile.role === "parent") {
      const guardian = await ctx.db
        .query("guardians")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .unique();
      allowed = guardian ? (await ownedStudentOrNull(ctx, guardian._id, studentId)) !== null : false;
    }
    if (!allowed) return null;
    if (!student.photoStorageId) return null;
    return ctx.storage.getUrl(student.photoStorageId);
  },
});

/** Batched form of getPhotoUrl for roster/list screens — one query and one authorization pass instead of one subscription per row. Missing/unauthorized ids are simply absent from the result. */
export const getPhotoUrls = query({
  args: { studentIds: v.array(v.id("students")) },
  handler: async (ctx, { studentIds }) => {
    const profile = await requireProfile(ctx);
    const unique = Array.from(new Set(studentIds));
    let allowedIds: Set<Id<"students">>;
    if (profile.role === "admin") {
      allowedIds = new Set(unique);
    } else if (profile.role === "teacher") {
      allowedIds = await teacherStudentIds(ctx, profile._id);
    } else if (profile.role === "parent") {
      const guardian = await ctx.db
        .query("guardians")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .unique();
      const owned = guardian ? await guardianStudents(ctx, guardian._id) : [];
      allowedIds = new Set(owned.map((s) => s._id));
    } else {
      allowedIds = new Set();
    }

    const result: Record<string, string | null> = {};
    await Promise.all(
      unique
        .filter((id) => allowedIds.has(id))
        .map(async (id) => {
          const student: Doc<"students"> | null = await ctx.db.get(id);
          if (!student) return;
          if (profile.role === "admin" && student.academyId !== profile.academyId) return;
          result[id] = student.photoStorageId ? await ctx.storage.getUrl(student.photoStorageId) : null;
        })
    );
    return result;
  },
});
