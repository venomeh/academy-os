import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireGuardian, ownedStudentOrNull, pktToday } from "./lib/authz";
import { computeVoucherForStudent, computeOutstanding, randomToken } from "./model/vouchers";
import { agingBucket, isOverdue, outstandingOf, statusFor, voucherPaid } from "./model/ledger";
import { sendEmail, emailShell } from "./model/email";

/**
 * Vouchers — §8.1/§8.2. Generation is idempotent per (student, period);
 * cash payments and the Stripe webhook (convex/stripe.ts) are the only two
 * writers of voucher.status, and both re-derive outstanding from the ledger
 * before validating — never from a client-supplied number.
 */

async function voucherRow(ctx: QueryCtx | MutationCtx, voucher: Doc<"vouchers">, today: string) {
  const student = await ctx.db.get(voucher.studentId);
  const guardian = await ctx.db.get(voucher.guardianId);
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_voucher", (q) => q.eq("voucherId", voucher._id))
    .collect();
  const paid = voucherPaid(entries);
  return {
    id: voucher._id,
    studentId: voucher.studentId,
    student: student?.name ?? "—",
    guardian: guardian?.name ?? "—",
    guardianId: voucher.guardianId,
    period: voucher.period,
    dueDate: voucher.dueDate,
    total: voucher.total,
    paid,
    outstanding: Math.max(0, outstandingOf(voucher, entries)),
    status: voucher.status,
    age: isOverdue(voucher, today) ? agingBucket(voucher, today) : "current",
    lineItems: voucher.lineItems,
    token: voucher.token,
    // Every ledger row against this voucher, oldest first — the modal shows
    // fines and adjustments here since they are not part of `lineItems`.
    entries: entries
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((e) => ({ id: e._id, kind: e.kind, amount: e.amount, method: e.method ?? null, reason: e.reason ?? null, receiptNumber: e.receiptNumber ?? null, createdAt: e._creationTime })),
  };
}

export const list = query({
  args: { period: v.string(), query: v.optional(v.string()), tab: v.optional(v.union(v.literal("All"), v.literal("Unpaid"), v.literal("Partial"), v.literal("Paid"))) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const today = pktToday();
    const rows = await ctx.db
      .query("vouchers")
      .withIndex("by_period", (q) => q.eq("period", args.period))
      .collect();
    const built = await Promise.all(rows.map((v) => voucherRow(ctx, v, today)));
    const q = (args.query ?? "").trim().toLowerCase();
    const tab = args.tab ?? "All";
    return built.filter((r) => {
      if (q && !`${r.student} ${r.guardian}`.toLowerCase().includes(q)) return false;
      if (tab === "Unpaid" && r.status !== "unpaid") return false;
      if (tab === "Partial" && r.status !== "partial") return false;
      if (tab === "Paid" && r.status !== "paid") return false;
      return true;
    });
  },
});

export const get = query({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher) return null;
    const profile = await requireAdminOrGuardianOf(ctx, voucher);
    if (!profile) return null;
    return voucherRow(ctx, voucher, pktToday());
  },
});

/** Parent Portal — the signed-in guardian's current-period voucher for one of their own children (§8.3, §11). No-enumeration: returns null for a foreign/invalid studentId rather than throwing. */
export const getCurrentForGuardianChild = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const { guardian } = await requireGuardian(ctx);
    const student = await ownedStudentOrNull(ctx, guardian._id, studentId);
    if (!student) return null;
    const period = new Date().toISOString().slice(0, 7);
    const voucher = await ctx.db
      .query("vouchers")
      .withIndex("by_student_and_period", (q) => q.eq("studentId", studentId).eq("period", period))
      .unique();
    if (!voucher) return null;
    return voucherRow(ctx, voucher, pktToday());
  },
});

async function requireAdminOrGuardianOf(ctx: QueryCtx, voucher: Doc<"vouchers">) {
  try {
    await requireAdmin(ctx);
    return true;
  } catch {
    const { guardian } = await requireGuardian(ctx);
    const student = await ownedStudentOrNull(ctx, guardian._id, voucher.studentId);
    return student ? true : null;
  }
}

export const getStats = query({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    await requireAdmin(ctx);
    const today = pktToday();
    const rows = await ctx.db
      .query("vouchers")
      .withIndex("by_period", (q) => q.eq("period", period))
      .collect();
    const built = await Promise.all(rows.map((v) => voucherRow(ctx, v, today)));
    const issued = built.length;
    const collected = built.reduce((s, r) => s + r.paid, 0);
    const outstanding = built.reduce((s, r) => s + r.outstanding, 0);
    const rate = issued ? Math.round((built.filter((r) => r.status === "paid").length / issued) * 100) : 0;
    return { issued, collected, outstanding, rate };
  },
});

/** DB-only half of generation — a mutation so it's retriable/deterministic; the calling action sends the email afterward. */
export const createVoucherRecord = internalMutation({
  args: { studentId: v.id("students"), period: v.string() },
  handler: async (ctx, { studentId, period }) => {
    const student = await ctx.db.get(studentId);
    if (!student) return { ok: false as const, reason: "inactive" as const };
    const feeRules = await ctx.db
      .query("feeRules")
      .withIndex("by_academy", (q) => q.eq("academyId", student.academyId))
      .unique();
    if (!feeRules) throw new Error("Fee rules haven't been configured for this academy yet.");

    const result = await computeVoucherForStudent(ctx, studentId, period, feeRules);
    if (!result.ok) return result;

    const voucherId = await ctx.db.insert("vouchers", {
      academyId: student.academyId,
      studentId,
      guardianId: result.voucher.guardianId,
      period,
      lineItems: result.voucher.lineItems,
      tuitionAmount: result.voucher.tuitionAmount,
      siblingDiscount: result.voucher.siblingDiscount,
      arrears: result.voucher.arrears,
      fines: 0,
      total: result.voucher.total,
      dueDate: result.voucher.dueDate,
      status: "unpaid",
      token: randomToken(),
      ruleSnapshot: result.voucher.ruleSnapshot,
      generatedAt: Date.now(),
    });
    // Charge only what is NEW this period. `total` deliberately includes
    // arrears so the printed voucher shows the full amount due, but those
    // arrears are already on the account as the prior unpaid voucher's own
    // ledger row — posting `total` here would bill the family twice and
    // inflate every running balance. (The reference backend sidesteps this
    // by never posting a voucher row at all; Tasks.md §14 asks for the
    // `voucher` kind, so we post it for the new charges only.)
    const newCharges = result.voucher.total - result.voucher.arrears;
    await ctx.db.insert("ledgerEntries", {
      academyId: student.academyId,
      guardianId: result.voucher.guardianId,
      studentId,
      voucherId,
      kind: "voucher",
      amount: -newCharges,
      reason: result.voucher.arrears > 0 ? `New charges for ${period} — ${result.voucher.arrears.toLocaleString()} arrears already on the account` : undefined,
    });
    const voucher = await ctx.db.get(voucherId);
    return { ok: true as const, voucher: voucher! };
  },
});

/** Client-facing: admin-only, and always runs regardless of the configured generation day — this is also the "manual run/re-run for corrections" path (§8.1). Delegates to runGenerateVouchers with force:true. */
export const generateVouchers = action({
  args: { period: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ created: number; skipped: number; flaggedForReview: number; period: string } | { skipped: string }> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") throw new Error("Admin access required.");
    return ctx.runAction(internal.vouchers.runGenerateVouchers, { ...args, force: true });
  },
});

/**
 * Cron-safe: no auth check — only reachable from server code (crons.ts,
 * generateVouchers above), never from a client. The daily cron calls this
 * with force:false, so it only actually generates on the academy's
 * configured `generationDay` (§8.1) — every other day it's a fast no-op,
 * not a full skip-everything pass through the roster.
 */
export const runGenerateVouchers = internalAction({
  args: { period: v.optional(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ created: number; skipped: number; flaggedForReview: number; period: string } | { skipped: string }> => {
    if (!args.force) {
      const rules = await ctx.runQuery(internal.vouchers.getFeeRulesInternal, {});
      const today = new Date();
      if (!rules || today.getDate() !== rules.generationDay) {
        return { skipped: `not the configured generation day (${rules?.generationDay ?? "no fee rules configured"})` };
      }
    }
    const period = args.period ?? pktToday().slice(0, 7);

    const students: Doc<"students">[] = await ctx.runQuery(internal.vouchers.listActiveStudentsInternal, {});

    let created = 0;
    let skipped = 0;
    let flaggedForReview = 0;

    for (const student of students) {
      const result = await ctx.runMutation(internal.vouchers.createVoucherRecord, { studentId: student._id, period });
      if (result.ok) {
        created += 1;
        if (student.needsFeeReview) flaggedForReview += 1;
        const guardian = await ctx.runQuery(internal.vouchers.getGuardianInternal, { guardianId: result.voucher.guardianId });
        // Fire-and-forget via the scheduler rather than awaiting inline —
        // decouples email delivery from this action's own execution window,
        // so a large run's emails don't risk the whole generation timing out.
        if (guardian?.email) {
          await ctx.scheduler.runAfter(0, internal.vouchers.sendVoucherEmail, {
            to: guardian.email,
            studentName: student.name,
            voucherId: result.voucher._id,
          });
        }
      } else {
        skipped += 1;
      }
    }

    await ctx.runMutation(internal.vouchers.logJobRun, { jobName: "generate-vouchers", period, result: { created, skipped, flaggedForReview } });
    return { created, skipped, flaggedForReview, period };
  },
});

export const sendVoucherEmail = internalAction({
  args: { to: v.string(), studentName: v.string(), voucherId: v.id("vouchers") },
  handler: async (ctx, args) => {
    const voucher = await ctx.runQuery(internal.vouchers.getVoucherInternal, { voucherId: args.voucherId });
    if (!voucher) return;
    const payLink = `${process.env.CONVEX_SITE_URL}/pay/${voucher.token}`;
    const lines = voucher.lineItems.map((l) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #EFEDE7;"><span>${l.label}</span><b>${l.amount.toLocaleString()}</b></div>`).join("");
    await sendEmail({
      to: args.to,
      subject: `Fee voucher · ${voucher.period} · ${args.studentName}`,
      html: emailShell(`
        <p style="font-size:15px;line-height:1.6;">${args.studentName}'s voucher for ${voucher.period} is due ${voucher.dueDate}.</p>
        ${lines}
        <div style="display:flex;justify-content:space-between;padding:12px 0;font-weight:900;font-size:18px;"><span>Total due</span><span>${voucher.total.toLocaleString()}</span></div>
        <a href="${payLink}" style="display:inline-block;margin-top:12px;padding:12px 20px;background:#0D0D0D;color:#F7F6F3;border-radius:8px;text-decoration:none;font-weight:700;">Pay online</a>
      `),
      text: `${args.studentName}'s voucher for ${voucher.period}: PKR ${voucher.total} due ${voucher.dueDate}. Pay online: ${payLink}`,
    });
  },
});

export const getVoucherInternal = internalQuery({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => ctx.db.get(voucherId),
});

export const getFeeRulesInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("feeRules").first(),
});

export const listActiveStudentsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("students")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
  },
});

export const getGuardianInternal = internalQuery({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }) => ctx.db.get(guardianId),
});

export const logJobRun = internalMutation({
  args: { jobName: v.string(), period: v.optional(v.string()), result: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert("jobRuns", args);
  },
});

async function recordCashPaymentImpl(ctx: MutationCtx, voucherId: Doc<"vouchers">["_id"], amount: number, createdBy: Doc<"profiles">["_id"] | undefined) {
  const voucher = await ctx.db.get(voucherId);
  if (!voucher) throw new Error("Voucher not found.");
  const outstanding = await computeOutstanding(ctx, voucherId);
  if (amount <= 0) throw new Error("Enter an amount.");
  if (amount > outstanding) throw new Error(`Overpayment is blocked — the maximum is ${outstanding.toLocaleString()}.`);

  // Sequential receipt numbers would need a counter document; a
  // timestamp+random suffix is unique without one and good enough since
  // receipts aren't shown in strict numeric sequence anywhere in the UI.
  const receiptNumber = `R-${Date.now().toString(36).toUpperCase()}`;

  await ctx.db.insert("ledgerEntries", {
    academyId: voucher.academyId,
    guardianId: voucher.guardianId,
    studentId: voucher.studentId,
    voucherId,
    kind: "payment",
    amount,
    method: "cash",
    receiptNumber,
    createdBy,
  });
  const entriesAfter = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
    .collect();
  const newStatus = statusFor(voucher, entriesAfter);
  await ctx.db.patch(voucherId, { status: newStatus });

  // Mutations can't call fetch (Resend) themselves — schedule the receipt
  // email to run immediately after via the scheduler, rather than relying
  // on the client to remember a follow-up call. Guarantees the email
  // fires even if nobody's listening for the mutation's return value.
  const guardian = await ctx.db.get(voucher.guardianId);
  const student = await ctx.db.get(voucher.studentId);
  if (guardian?.email) {
    await ctx.scheduler.runAfter(0, internal.vouchers.sendCashReceipt, {
      to: guardian.email,
      studentName: student?.name ?? "your child",
      amount,
      receiptNumber,
    });
  }

  return { receiptNumber, status: newStatus, remaining: Math.max(outstanding - amount, 0) };
}

/** Client-facing: admin-only. Delegates to recordCashPaymentImpl (above). */
export const recordCashPayment = mutation({
  args: { voucherId: v.id("vouchers"), amount: v.number() },
  handler: async (ctx, { voucherId, amount }) => {
    const admin = await requireAdmin(ctx);
    return recordCashPaymentImpl(ctx, voucherId, amount, admin._id);
  },
});

/** Seed/server-only: no auth check — never exposed to a client. Used by convex/seedDemo.ts to set up realistic payment scenarios via the real ledger-writing path instead of hand-crafted rows. */
export const recordCashPaymentInternal = internalMutation({
  args: { voucherId: v.id("vouchers"), amount: v.number() },
  handler: async (ctx, { voucherId, amount }) => recordCashPaymentImpl(ctx, voucherId, amount, undefined),
});

export const sendCashReceipt = internalAction({
  args: { to: v.string(), studentName: v.string(), amount: v.number(), receiptNumber: v.string() },
  handler: async (_ctx, args) => {
    await sendEmail({
      to: args.to,
      subject: `Receipt ${args.receiptNumber} · ${args.studentName}`,
      html: emailShell(`
        <p style="font-size:15px;line-height:1.6;">We received PKR ${args.amount.toLocaleString()} for ${args.studentName}.</p>
        <p style="font-size:13px;color:#6B6660;">Receipt ${args.receiptNumber}</p>
      `),
      text: `Receipt ${args.receiptNumber}: PKR ${args.amount} received for ${args.studentName}.`,
    });
  },
});
