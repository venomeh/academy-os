import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, pktToday } from "./lib/authz";
import { reminderBucketFor, fillTemplate, formatItemization, daysOverdue } from "./model/reminders";
import { sendEmail, emailShell } from "./model/email";
import { personalizeReminder } from "./model/remindersAi";
import { outstandingOf } from "./model/ledger";

/**
 * Escalating fee follow-ups — §10.
 *
 * The message is always built first by deterministic `{{placeholder}}`
 * substitution into a locked, admin-editable, version-stored template. The
 * model only ever gets to *rewrite that finished message*, and only if the
 * rewrite still quotes the same amount and pay link (see model/remindersAi.ts).
 * Nothing free-form is ever auto-sent, and `messageLog.personalized` records
 * which of the two texts actually went out.
 */

const BUCKET = v.union(v.literal("due_date"), v.literal("7d_gentle"), v.literal("14d_firm"), v.literal("30d_final"));

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db.query("reminderTemplates").collect();
    return rows.filter((r) => r.academyId === admin.academyId);
  },
});

/** Versioned insert-only — "editing" a template deactivates the current one and inserts version+1, never a destructive update. */
export const setTemplate = mutation({
  args: { bucket: BUCKET, language: v.union(v.literal("en"), v.literal("ur")), subjectLine: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const current = await ctx.db
      .query("reminderTemplates")
      .withIndex("by_academy_and_bucket_and_language_and_active", (q) => q.eq("academyId", admin.academyId).eq("bucket", args.bucket).eq("language", args.language).eq("active", true))
      .unique();
    if (current) await ctx.db.patch(current._id, { active: false });
    await ctx.db.insert("reminderTemplates", {
      academyId: admin.academyId,
      bucket: args.bucket,
      language: args.language,
      subjectLine: args.subjectLine,
      body: args.body,
      templateVersion: (current?.templateVersion ?? 0) + 1,
      active: true,
    });
  },
});

export const getSweepStatus = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rules = await ctx.db
      .query("feeRules")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .unique();
    return rules?.remindersSweepEnabled ?? true;
  },
});

export const toggleSweep = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rules = await ctx.db
      .query("feeRules")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .unique();
    if (!rules) throw new Error("Fee rules haven't been configured yet.");
    const next = !(rules.remindersSweepEnabled ?? true);
    await ctx.db.patch(rules._id, { remindersSweepEnabled: next });
    return next;
  },
});

export const listMessageLog = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db.query("messageLog").order("desc").take(50);
    return Promise.all(
      rows
        .filter((r) => r.academyId === admin.academyId)
        .map(async (r) => {
          const guardian = await ctx.db.get(r.guardianId);
          return {
            id: r._id,
            guardian: guardian?.name ?? "—",
            channel: r.channel,
            status: r.status,
            bucket: r.bucket ?? null,
            templateVersion: r.templateVersion ?? null,
            personalized: r.personalized ?? false,
            sentAt: r.sentAt ?? null,
          };
        })
    );
  },
});

async function activeTemplate(
  ctx: QueryCtx | MutationCtx,
  academyId: Id<"academies">,
  bucket: "due_date" | "7d_gentle" | "14d_firm" | "30d_final",
  language: "en" | "ur"
): Promise<Doc<"reminderTemplates"> | null> {
  return ctx.db
    .query("reminderTemplates")
    .withIndex("by_academy_and_bucket_and_language_and_active", (q) => q.eq("academyId", academyId).eq("bucket", bucket).eq("language", language).eq("active", true))
    .unique();
}

interface Candidate {
  voucherId: Id<"vouchers">;
  guardianId: Id<"guardians">;
  studentId: Id<"students">;
  bucket: "due_date" | "7d_gentle" | "14d_firm" | "30d_final";
}

export const findCandidates = internalQuery({
  args: {},
  handler: async (ctx): Promise<Candidate[]> => {
    const today = pktToday();
    const unpaid = await ctx.db.query("vouchers").withIndex("by_status", (q) => q.eq("status", "unpaid")).collect();
    const partial = await ctx.db.query("vouchers").withIndex("by_status", (q) => q.eq("status", "partial")).collect();
    const out: Candidate[] = [];
    for (const voucher of [...unpaid, ...partial]) {
      if (voucher.dueDate > today) continue;
      const bucket = reminderBucketFor(voucher, today);
      if (!bucket) continue;
      const [student, guardian] = await Promise.all([ctx.db.get(voucher.studentId), ctx.db.get(voucher.guardianId)]);
      if (!student || student.status !== "active") continue;
      if (!guardian || guardian.remindersPaused) continue;
      out.push({ voucherId: voucher._id, guardianId: voucher.guardianId, studentId: voucher.studentId, bucket });
    }
    return out;
  },
});

export const claimAndPrepareSend = internalMutation({
  args: { voucherId: v.id("vouchers"), bucket: BUCKET },
  handler: async (ctx, { voucherId, bucket }) => {
    const existing = await ctx.db
      .query("messageLog")
      .withIndex("by_voucher_and_bucket_and_channel", (q) => q.eq("voucherId", voucherId).eq("bucket", bucket).eq("channel", "email"))
      .unique();
    if (existing) return null; // already sent — claim-then-send idempotency, not just a pre-check

    const voucher = await ctx.db.get(voucherId);
    if (!voucher) return null;
    const [student, guardian] = await Promise.all([ctx.db.get(voucher.studentId), ctx.db.get(voucher.guardianId)]);
    if (!student || !guardian) return null;

    // Fall back to English if the guardian's preferred language has no active
    // template for this bucket yet — a missing translation must never mean a
    // family silently gets no reminder at all.
    const language = guardian.languagePref;
    const template = (await activeTemplate(ctx, voucher.academyId, bucket, language)) ?? (language !== "en" ? await activeTemplate(ctx, voucher.academyId, bucket, "en") : null);
    if (!template) return null;

    // A "partial" voucher must show what's actually still owed, not the
    // original total, or a family that's already paid part of it gets a
    // reminder demanding money they don't owe.
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    const outstanding = Math.max(0, outstandingOf(voucher, entries));
    const vars: Record<string, string> = {
      guardianName: guardian.name,
      studentName: student.name,
      amount: outstanding.toLocaleString(),
      dueDate: voucher.dueDate,
      daysOverdue: String(daysOverdue(voucher.dueDate, pktToday())),
      period: voucher.period,
      itemization: formatItemization(voucher.lineItems),
      payUrl: `${process.env.CONVEX_SITE_URL ?? ""}/pay/${voucher.token}`,
    };
    const subject = fillTemplate(template.subjectLine, vars);
    const body = fillTemplate(template.body, vars);
    const daysLate = daysOverdue(voucher.dueDate, pktToday());

    const logId = await ctx.db.insert("messageLog", {
      academyId: voucher.academyId,
      guardianId: guardian._id,
      voucherId,
      bucket,
      channel: "email",
      status: "pending",
      templateVersion: template.templateVersion,
      content: body,
    });
    return {
      logId,
      to: guardian.email ?? null,
      subject,
      body,
      language,
      bucket,
      amount: vars.amount,
      payUrl: vars.payUrl,
      // For the admin escalation that rides along with the final notice.
      guardianName: guardian.name,
      studentName: student.name,
      period: voucher.period,
      daysOverdue: daysLate,
    };
  },
});

export const listAdminEmailsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const admins = await ctx.db.query("profiles").filter((q) => q.eq(q.field("role"), "admin")).collect();
    return admins.filter((a) => a.active).map((a) => a.email);
  },
});

interface Prepared {
  bucket: "due_date" | "7d_gentle" | "14d_firm" | "30d_final";
  amount: string;
  guardianName: string;
  studentName: string;
  period: string;
  daysOverdue: number;
}

/**
 * §10's "30d final notice / admin escalation": the moment a family gets the
 * final notice, the front desk gets a heads-up too. Piggybacks on the same
 * claim, so it fires exactly once per voucher — never on a re-run.
 */
async function escalateToAdmin(ctx: { runQuery: ActionCtx["runQuery"] }, p: Prepared): Promise<void> {
  if (p.bucket !== "30d_final") return;
  const admins: string[] = await ctx.runQuery(internal.reminders.listAdminEmailsInternal, {});
  if (admins.length === 0) return;
  await sendEmail({
    to: admins,
    subject: `Final notice sent · ${p.guardianName} · PKR ${p.amount}`,
    html: emailShell(`
      <p style="font-size:15px;line-height:1.6;">The 30-day final notice just went to <strong>${p.guardianName}</strong> for ${p.studentName}'s ${p.period} voucher — <strong>PKR ${p.amount}</strong> outstanding, ${p.daysOverdue} days overdue.</p>
      <p style="font-size:14px;line-height:1.6;color:#6B6660;">Automated reminders for this voucher end here. Follow up in person, agree an installment plan (pause reminders on the Defaulters page), or post an adjustment if the balance is wrong.</p>
    `),
    text: `Final notice sent to ${p.guardianName} for ${p.studentName} (${p.period}): PKR ${p.amount} outstanding, ${p.daysOverdue} days overdue. Automated reminders end here.`,
  });
  console.log(`reminders: final notice for ${p.guardianName} (${p.period}) escalated to ${admins.length} admin(s)`);
}

export const markSent = internalMutation({
  args: {
    logId: v.id("messageLog"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    content: v.optional(v.string()),
    personalized: v.optional(v.boolean()),
  },
  handler: async (ctx, { logId, ok, error, content, personalized }) => {
    await ctx.db.patch(logId, {
      ...(content !== undefined ? { content } : {}),
      ...(personalized !== undefined ? { personalized } : {}),
      ...(ok ? { status: "sent" as const, sentAt: Date.now() } : { status: "failed" as const, errorDetail: error }),
    });
  },
});

/** Client-facing: admin-only. Delegates to runSweep (below), the same entry point the daily cron calls with no user identity available. */
export const sweep = action({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped: number; failed: number }> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") throw new Error("Admin access required.");
    return ctx.runAction(internal.reminders.runSweep, {});
  },
});

/** Cron-safe: no auth check — only reachable from server code (crons.ts, sweep above), never from a client. */
export const runSweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped: number; failed: number }> => {
    const enabled = await ctx.runQuery(internal.reminders.getSweepStatusInternal, {});
    if (!enabled) return { sent: 0, skipped: 0, failed: 0 };

    const candidates = await ctx.runQuery(internal.reminders.findCandidates, {});
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of candidates) {
      const prepared = await ctx.runMutation(internal.reminders.claimAndPrepareSend, { voucherId: c.voucherId, bucket: c.bucket });
      if (!prepared) {
        skipped += 1;
        continue;
      }
      if (!prepared.to) {
        await ctx.runMutation(internal.reminders.markSent, { logId: prepared.logId, ok: false, error: "Guardian has no email on file." });
        failed += 1;
        continue;
      }
      const { text: body, personalized } = await personalizeReminder({
        body: prepared.body,
        language: prepared.language,
        amount: prepared.amount,
        payUrl: prepared.payUrl,
        bucket: prepared.bucket,
      });
      const result = await sendEmail({ to: prepared.to, subject: prepared.subject, html: emailShell(`<p style="font-size:14px; white-space:pre-line;">${body}</p>`), text: body });
      await ctx.runMutation(internal.reminders.markSent, {
        logId: prepared.logId,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
        content: body,
        personalized,
      });
      if (result.ok) {
        sent += 1;
        await escalateToAdmin(ctx, prepared);
      } else failed += 1;
    }

    await ctx.runMutation(internal.reminders.logSweepRun, { result: { sent, skipped, failed, candidates: candidates.length } });
    return { sent, skipped, failed };
  },
});

export const getSweepStatusInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.db.query("feeRules").first();
    return rules?.remindersSweepEnabled ?? true;
  },
});

export const logSweepRun = internalMutation({
  args: { result: v.any() },
  handler: async (ctx, { result }) => {
    await ctx.db.insert("jobRuns", { jobName: "reminder-sweep", result });
  },
});

/** Admin's "Send reminder" button on one family — same claim-then-send path, scoped to one guardian's overdue vouchers only. */
export const sendNow = action({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }): Promise<{ sent: number }> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") throw new Error("Admin access required.");
    const candidates = await ctx.runQuery(internal.reminders.findCandidatesForGuardian, { guardianId });
    let sent = 0;
    for (const c of candidates) {
      const prepared = await ctx.runMutation(internal.reminders.claimAndPrepareSend, { voucherId: c.voucherId, bucket: c.bucket });
      if (!prepared?.to) continue;
      const { text: body, personalized } = await personalizeReminder({
        body: prepared.body,
        language: prepared.language,
        amount: prepared.amount,
        payUrl: prepared.payUrl,
        bucket: prepared.bucket,
      });
      const result = await sendEmail({ to: prepared.to, subject: prepared.subject, html: emailShell(`<p style="font-size:14px; white-space:pre-line;">${body}</p>`), text: body });
      await ctx.runMutation(internal.reminders.markSent, {
        logId: prepared.logId,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
        content: body,
        personalized,
      });
      if (result.ok) {
        sent += 1;
        await escalateToAdmin(ctx, prepared);
      }
    }
    return { sent };
  },
});

export const findCandidatesForGuardian = internalQuery({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }): Promise<Candidate[]> => {
    const today = pktToday();
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
      .collect();
    const out: Candidate[] = [];
    for (const voucher of vouchers) {
      if (voucher.status === "paid" || voucher.dueDate > today) continue;
      const bucket = reminderBucketFor(voucher, today);
      if (!bucket) continue;
      out.push({ voucherId: voucher._id, guardianId, studentId: voucher.studentId, bucket });
    }
    return out;
  },
});
