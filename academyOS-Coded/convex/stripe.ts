import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireGuardian } from "./lib/authz";
import { outstandingOf, statusFor } from "./model/ledger";

/**
 * Stripe Checkout — §8.2. Default (non-Node) runtime: `createCheckoutSession`
 * uses plain `fetch` against Stripe's REST API, no SDK needed for a single
 * POST. The webhook handler lives in convex/stripeWebhook.ts instead — it
 * needs "use node" for real signature verification, and a "use node" file
 * can only contain actions, not the queries/mutations this file also needs.
 * `creditPaymentInternal` (the mutation the webhook calls) lives here, in
 * the default runtime, for the same reason.
 */

export const resolveByIdInternal = internalQuery({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => ctx.db.get(voucherId),
});

export const resolveByTokenInternal = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return ctx.db
      .query("vouchers")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
  },
});

export const requireOwnedVoucherInternal = internalQuery({
  args: { voucherId: v.id("vouchers"), guardianId: v.id("guardians") },
  handler: async (ctx, { voucherId, guardianId }) => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher || voucher.guardianId !== guardianId) return null;
    return voucher;
  },
});

export const outstandingInternal = internalQuery({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher) return null;
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    return outstandingOf(voucher, entries);
  },
});

export const currentGuardianInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      const { guardian } = await requireGuardian(ctx);
      return guardian;
    } catch {
      return null;
    }
  },
});

export const createCheckoutSession = action({
  args: { voucherId: v.optional(v.id("vouchers")), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const providedCount = [args.voucherId, args.token].filter((x) => x !== undefined).length;
    if (providedCount !== 1) throw new Error("Pass exactly one of voucherId or token.");

    let voucherId: Id<"vouchers">;
    if (args.token) {
      const voucher = await ctx.runQuery(internal.stripe.resolveByTokenInternal, { token: args.token });
      if (!voucher) throw new Error("Pay link not found or has expired.");
      voucherId = voucher._id;
    } else {
      const guardian = await ctx.runQuery(internal.stripe.currentGuardianInternal, {});
      if (!guardian) throw new Error("Sign in as the parent to pay this voucher.");
      const voucher = await ctx.runQuery(internal.stripe.requireOwnedVoucherInternal, { voucherId: args.voucherId!, guardianId: guardian._id });
      if (!voucher) throw new Error("Voucher not found.");
      voucherId = voucher._id;
    }

    const outstanding = await ctx.runQuery(internal.stripe.outstandingInternal, { voucherId });
    if (outstanding === null) throw new Error("Voucher not found.");
    if (outstanding <= 0) throw new Error("This voucher is already paid.");

    const voucher = await ctx.runQuery(internal.stripe.resolveByIdInternal, { voucherId });
    if (!voucher) throw new Error("Voucher not found.");

    const appUrl = process.env.APP_URL ?? "http://localhost:4321";
    const currency = process.env.STRIPE_CURRENCY ?? "pkr";
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error("Stripe is not configured on this deployment.");

    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", `${appUrl}/pay/success?session_id={CHECKOUT_SESSION_ID}`);
    body.set("cancel_url", `${appUrl}/parent`);
    body.set("client_reference_id", voucherId);
    body.set("metadata[voucherId]", voucherId);
    body.set("metadata[guardianId]", voucher.guardianId);
    body.set("metadata[studentId]", voucher.studentId);
    body.set("metadata[academyId]", voucher.academyId);
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", currency);
    body.set("line_items[0][price_data][unit_amount]", String(Math.round(outstanding * 100)));
    body.set("line_items[0][price_data][product_data][name]", `Voucher ${voucher.period} — outstanding balance`);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Stripe error: ${detail}`);
    }
    const session = (await res.json()) as { url: string };
    return { url: session.url };
  },
});

// ---------------------------------------------------------------------------
// Called by convex/stripeWebhook.ts's handleStripeWebhook. Idempotent on the
// Stripe event ID (§8.4, §15 Rule 2): a replayed event never credits twice.
// ---------------------------------------------------------------------------

export const creditPaymentInternal = internalMutation({
  args: { voucherId: v.id("vouchers"), amount: v.number(), stripeEventId: v.string() },
  handler: async (ctx, { voucherId, amount, stripeEventId }) => {
    const existing = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_stripe_event", (q) => q.eq("stripeEventId", stripeEventId))
      .unique();
    if (existing) return { duplicate: true as const };

    const voucher = await ctx.db.get(voucherId);
    if (!voucher) return { duplicate: false as const, skipped: "voucher_not_found" as const };

    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    const outstanding = outstandingOf(voucher, entries);
    if (outstanding <= 0) return { duplicate: false as const, skipped: "already_paid" as const };

    // Never credit more than what's outstanding, even if Stripe's amount
    // exceeds it (e.g. a cash payment landed in the gap between Checkout
    // session creation and this webhook).
    const pay = Math.min(amount, outstanding);

    await ctx.db.insert("ledgerEntries", {
      academyId: voucher.academyId,
      guardianId: voucher.guardianId,
      studentId: voucher.studentId,
      voucherId,
      kind: "payment",
      amount: pay,
      method: "stripe",
      stripeEventId,
    });
    const entriesAfter = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    await ctx.db.patch(voucherId, { status: statusFor(voucher, entriesAfter) });

    const guardian = await ctx.db.get(voucher.guardianId);
    const student = await ctx.db.get(voucher.studentId);
    if (guardian?.email) {
      await ctx.scheduler.runAfter(0, internal.stripeWebhook.sendStripeReceiptInternal, {
        to: guardian.email,
        studentName: student?.name ?? "your child",
        amount: pay,
      });
    }
    return { duplicate: false as const, credited: pay };
  },
});

// ---------------------------------------------------------------------------
// Powers /pay/success (§8.2). Stripe redirects here with `?session_id=`
// before the webhook is guaranteed to have landed, so this resolves the
// session against Stripe directly (for the voucher it paid) and reports
// "pending" until the webhook's ledger write actually shows up — the page
// polls this until it does. The webhook remains the only writer of payment
// state; this never credits anything itself.
// ---------------------------------------------------------------------------

export const getReceiptForSessionInternal = internalQuery({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher) return null;
    const student = await ctx.db.get(voucher.studentId);
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    const payment = entries
      .filter((e) => e.kind === "payment" && e.method === "stripe")
      .sort((a, b) => b._creationTime - a._creationTime)[0];
    return {
      studentName: student?.name ?? "your child",
      period: voucher.period,
      payment: payment
        ? { amount: payment.amount, receiptNumber: payment.receiptNumber ?? null, stripeEventId: payment.stripeEventId ?? null, id: payment._id, createdAt: payment._creationTime }
        : null,
    };
  },
});

export const getSessionReceipt = action({
  args: { sessionId: v.string() },
  handler: async (
    ctx,
    { sessionId }
  ): Promise<
    | { status: "paid" | "pending"; studentName: string; period: string; amount: number; receiptNumber: string | null; eventId: string | null; ledgerEntryId: string | null; paidAt: number | null }
    | { status: "not_found" }
  > => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error("Stripe is not configured on this deployment.");

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) return { status: "not_found" };
    const session = (await res.json()) as { metadata?: { voucherId?: string }; amount_total?: number | null };
    const voucherId = session.metadata?.voucherId as Id<"vouchers"> | undefined;
    if (!voucherId) return { status: "not_found" };

    const data = await ctx.runQuery(internal.stripe.getReceiptForSessionInternal, { voucherId });
    if (!data) return { status: "not_found" };

    if (data.payment) {
      return {
        status: "paid",
        studentName: data.studentName,
        period: data.period,
        amount: data.payment.amount,
        receiptNumber: data.payment.receiptNumber,
        eventId: data.payment.stripeEventId,
        ledgerEntryId: data.payment.id,
        paidAt: data.payment.createdAt,
      };
    }
    return {
      status: "pending",
      studentName: data.studentName,
      period: data.period,
      amount: (session.amount_total ?? 0) / 100,
      receiptNumber: null,
      eventId: null,
      ledgerEntryId: null,
      paidAt: null,
    };
  },
});
