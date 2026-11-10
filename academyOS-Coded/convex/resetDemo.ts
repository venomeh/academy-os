import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";

/**
 * One-time wipe of all demo/seed data — every student, guardian, teacher
 * account, batch, voucher, attendance/assessment record, remark, ledger
 * entry, reminder log, chat session and inquiry created by seedDemo.ts.
 *
 * Deliberately preserved: the academy itself, feeRules, reminderTemplates
 * (real system config, not fake data), and every "admin"-role account —
 * so the owner can sign back in immediately on a clean slate and build a
 * real roster from scratch.
 *
 *   npx convex run resetDemo:wipeDemoData '{}'
 *
 * Idempotent — running it again on an already-empty deployment is a no-op.
 */

const DATA_TABLES: TableNames[] = [
  "enrollments",
  "batchTeachers",
  "subjects",
  "batches",
  "scores",
  "assessments",
  "attendance",
  "ledgerEntries",
  "vouchers",
  "remarkNotificationLog",
  "remarks",
  "messageLog",
  "chatUsage",
  "chatMessages",
  "chatSessions",
  "inquiries",
  "jobRuns",
  "guardians",
  "students",
];

async function clearTable(ctx: MutationCtx, table: TableNames): Promise<number> {
  const rows = await ctx.db.query(table).collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const wipeDemoData = action({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    return ctx.runMutation(internal.resetDemo.wipeDemoDataInternal, {});
  },
});

export const wipeDemoDataInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};

    // Student photos — delete the underlying storage blobs before the rows.
    const students = await ctx.db.query("students").collect();
    let photosDeleted = 0;
    for (const s of students) {
      if (s.photoStorageId) {
        await ctx.storage.delete(s.photoStorageId);
        photosDeleted += 1;
      }
    }
    counts.photos = photosDeleted;

    // Non-admin auth identities (teachers + parents) — accounts, sessions,
    // refresh tokens, verification codes, verifiers, then the user + profile.
    const profiles = await ctx.db.query("profiles").collect();
    const allVerifiers = await ctx.db.query("authVerifiers").collect();
    let accountsRemoved = 0;
    for (const profile of profiles) {
      if (profile.role === "admin") continue;
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", profile.userId))
        .collect();
      for (const acc of accounts) {
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", acc._id))
          .collect();
        for (const c of codes) await ctx.db.delete(c._id);
        await ctx.db.delete(acc._id);
      }
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", profile.userId))
        .collect();
      for (const session of sessions) {
        const refreshTokens = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
          .collect();
        for (const rt of refreshTokens) await ctx.db.delete(rt._id);
        for (const v of allVerifiers) {
          if (v.sessionId === session._id) await ctx.db.delete(v._id);
        }
        await ctx.db.delete(session._id);
      }
      await ctx.db.delete(profile.userId);
      await ctx.db.delete(profile._id);
      accountsRemoved += 1;
    }
    counts.accountsRemoved = accountsRemoved;

    const rateLimits = await ctx.db.query("authRateLimits").collect();
    for (const r of rateLimits) await ctx.db.delete(r._id);
    counts.authRateLimits = rateLimits.length;

    for (const table of DATA_TABLES) {
      counts[table] = await clearTable(ctx, table);
    }

    return counts;
  },
});
