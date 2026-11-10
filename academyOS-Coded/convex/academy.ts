import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireProfile } from "./lib/authz";

/**
 * Academy-wide settings — §4.2 fee rules (snapshotted onto every voucher at
 * generation time, so a later change here never mutates an issued voucher)
 * plus the handful of admin-toggleable flags (reminder sweep on/off) that
 * don't belong on any one domain table.
 */

export const getFeeRules = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rules = await ctx.db
      .query("feeRules")
      .withIndex("by_academy", (q) => q.eq("academyId", profile.academyId))
      .unique();
    return rules;
  },
});

export const updateFeeRules = mutation({
  args: {
    siblingDiscountPct: v.optional(v.number()),
    lateFineType: v.optional(v.union(v.literal("flat"), v.literal("percentage"))),
    lateFineValue: v.optional(v.number()),
    lateFineGraceDays: v.optional(v.number()),
    generationDay: v.optional(v.number()),
    dueDay: v.optional(v.number()),
    admissionFee: v.optional(v.number()),
  },
  handler: async (ctx, patch) => {
    const admin = await requireAdmin(ctx);
    const rules = await ctx.db
      .query("feeRules")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .unique();
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (rules) {
      await ctx.db.patch(rules._id, clean);
    } else {
      await ctx.db.insert("feeRules", {
        academyId: admin.academyId,
        siblingDiscountPct: patch.siblingDiscountPct ?? 10,
        lateFineType: patch.lateFineType ?? "flat",
        lateFineValue: patch.lateFineValue ?? 200,
        lateFineGraceDays: patch.lateFineGraceDays ?? 0,
        generationDay: patch.generationDay ?? 1,
        dueDay: patch.dueDay ?? 10,
        admissionFee: patch.admissionFee ?? 0,
      });
    }
  },
});

export const listScheduledJobRuns = query({
  args: { jobName: v.optional(v.string()) },
  handler: async (ctx, { jobName }) => {
    await requireAdmin(ctx);
    if (jobName) {
      return ctx.db
        .query("jobRuns")
        .withIndex("by_job_name", (q) => q.eq("jobName", jobName))
        .order("desc")
        .take(5);
    }
    return ctx.db.query("jobRuns").order("desc").take(20);
  },
});
