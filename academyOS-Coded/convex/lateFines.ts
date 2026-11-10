import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { pktToday } from "./lib/authz";

/**
 * Late fine accrual — §8.2/§15 Rule 2. One fine per voucher, ever (checked
 * via the `by_voucher_and_kind` index before insert — Convex has no unique
 * partial index like the reference's Postgres one, so the check-then-insert
 * has to happen in application code; a fine is only ever inserted from this
 * one mutation, so there's no other writer that could race it). A fine
 * bumps the voucher's cached `total` — vouchers are not immutable after
 * generation, only their pre-fine line items are.
 */

function daysOverdue(dueDate: string, today: string): number {
  const from = new Date(`${dueDate}T00:00:00Z`).getTime();
  const to = new Date(`${today}T00:00:00Z`).getTime();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

export const listCandidatesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = pktToday();
    const unpaid = await ctx.db
      .query("vouchers")
      .withIndex("by_status", (q) => q.eq("status", "unpaid"))
      .collect();
    const partial = await ctx.db
      .query("vouchers")
      .withIndex("by_status", (q) => q.eq("status", "partial"))
      .collect();
    const overdue = [...unpaid, ...partial].filter((v) => daysOverdue(v.dueDate, today) > v.ruleSnapshot.lateFineGraceDays);

    const eligible = [];
    for (const voucher of overdue) {
      const existingFine = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_voucher_and_kind", (q) => q.eq("voucherId", voucher._id).eq("kind", "fine"))
        .unique();
      if (!existingFine) eligible.push(voucher._id);
    }
    return eligible;
  },
});

export const applyFineInternal = internalMutation({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher) return { applied: false as const };

    // Re-check inside the mutation (not just the caller's earlier query) —
    // two concurrent accrual runs must still only ever produce one fine.
    const existingFine = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher_and_kind", (q) => q.eq("voucherId", voucherId).eq("kind", "fine"))
      .unique();
    if (existingFine) return { applied: false as const };

    const { lateFineType, lateFineValue } = voucher.ruleSnapshot;
    const fineAmount = lateFineType === "flat" ? lateFineValue : Math.round(voucher.total * (lateFineValue / 100));
    if (fineAmount <= 0) return { applied: false as const };

    await ctx.db.insert("ledgerEntries", {
      academyId: voucher.academyId,
      guardianId: voucher.guardianId,
      studentId: voucher.studentId,
      voucherId,
      kind: "fine",
      amount: -fineAmount,
      reason: "late_fine",
    });
    await ctx.db.patch(voucherId, { fines: voucher.fines + fineAmount, total: voucher.total + fineAmount });
    return { applied: true as const, fineAmount };
  },
});

export const logJobRunInternal = internalMutation({
  args: { jobName: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert("jobRuns", args);
  },
});

/** Daily cron + admin manual trigger. */
/** Client-facing: admin-only. Delegates to runAccrue (below), the same entry point the daily cron calls with no user identity available. */
export const accrue = action({
  args: {},
  handler: async (ctx): Promise<{ applied: number; totalFined: number }> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") throw new Error("Admin access required.");
    return ctx.runAction(internal.lateFines.runAccrue, {});
  },
});

/** Cron-safe: no auth check — only reachable from server code (crons.ts, accrue above), never from a client. */
export const runAccrue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ applied: number; totalFined: number }> => {
    const candidates = await ctx.runQuery(internal.lateFines.listCandidatesInternal, {});
    let applied = 0;
    let totalFined = 0;
    for (const voucherId of candidates) {
      const result = await ctx.runMutation(internal.lateFines.applyFineInternal, { voucherId });
      if (result.applied) {
        applied += 1;
        totalFined += result.fineAmount;
      }
    }
    await ctx.runMutation(internal.lateFines.logJobRunInternal, { jobName: "accrue-late-fines", result: { applied, totalFined } });
    return { applied, totalFined };
  },
});
