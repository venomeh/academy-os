import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAdmin, guardianStudents } from "./lib/authz";

/**
 * Admin-facing directory around account provisioning — §3.2. Account
 * *creation* itself lives in convex/auth.ts's `provisionAccount` (already
 * built); this file is the surrounding admin UI: listing, deactivating,
 * and re-sending a stuck invite.
 */

export const listStaff = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("profiles")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .collect();
    return rows
      .filter((r) => r.role === "admin" || r.role === "teacher")
      .map((r) => ({ id: r._id, name: r.fullName, email: r.email, role: r.role, active: r.active }));
  },
});

export const listGuardians = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("guardians")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .collect();
    return Promise.all(
      rows.map(async (g) => {
        const children = await guardianStudents(ctx, g._id);
        const profile = await ctx.db.get(g.profileId);
        return {
          id: g._id,
          profileId: g.profileId,
          name: g.name,
          phone: g.phone ?? null,
          email: g.email ?? null,
          active: profile?.active ?? false,
          children: children.map((c) => c.name),
        };
      })
    );
  },
});

export const deactivate = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(profileId, { active: false });
  },
});

export const reactivate = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(profileId, { active: true });
  },
});

export const resendInviteCode = action({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") return { ok: false, error: "Admin access required." };
    await ctx.runAction(api.auth.signIn, { provider: "password", params: { email: email.trim().toLowerCase(), flow: "reset" } });
    return { ok: true };
  },
});
