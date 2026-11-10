"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sendEmail, emailShell } from "./model/email";

/**
 * The Node-runtime half of Stripe integration — only this file needs "use
 * node" (for the `stripe` package's real HMAC signature verification,
 * rather than hand-rolled parsing of Stripe's `t=...,v1=...` header). A
 * "use node" file can only export actions, so the mutation this handler
 * calls (`creditPaymentInternal`) lives in convex/stripe.ts instead, on the
 * default runtime, and this file calls it via `ctx.runMutation`.
 *
 * `handleStripeWebhook` is a plain function, not a Convex httpAction itself
 * — convex/http.ts imports and calls it from the actual httpAction so all
 * HTTP route wiring stays in one place.
 */

export async function handleStripeWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("Stripe webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET not configured.");
    return new Response("Stripe not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  if (!signature) return new Response("Missing signature", { status: 400 });

  const stripe = new Stripe(secretKey);
  let event: Stripe.Event;
  try {
    // Must be the async variant: this runtime provides WebCrypto only, and
    // the SDK's synchronous path needs Node's crypto. `constructEvent` throws
    // "SubtleCryptoProvider cannot be used in a synchronous context" here.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    // Surface the reason in the body: Stripe shows the response on the
    // endpoint's delivery log, which is where you debug this from.
    const reason = err instanceof Error ? err.message : "unknown";
    console.error("Stripe webhook signature verification failed", reason);
    return new Response(`Invalid signature: ${reason}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const voucherId = session.metadata?.voucherId as Id<"vouchers"> | undefined;
    if (!voucherId) return new Response("Missing voucherId in metadata", { status: 400 });
    const amountTotal = (session.amount_total ?? 0) / 100;
    const result = await ctx.runMutation(internal.stripe.creditPaymentInternal, {
      voucherId,
      amount: amountTotal,
      stripeEventId: event.id,
    });
    return new Response(JSON.stringify(result), { status: 200 });
  }

  if (event.type === "checkout.session.expired") {
    return new Response("ok", { status: 200 });
  }

  return new Response("ignored", { status: 200 });
}

export const sendStripeReceiptInternal = internalAction({
  args: { to: v.string(), studentName: v.string(), amount: v.number() },
  handler: async (_ctx, args) => {
    await sendEmail({
      to: args.to,
      subject: `Payment received · ${args.studentName}`,
      html: emailShell(`<p style="font-size:15px;line-height:1.6;">We received PKR ${args.amount.toLocaleString()} by card for ${args.studentName}.</p>`),
      text: `Payment received: PKR ${args.amount} by card for ${args.studentName}.`,
    });
  },
});
