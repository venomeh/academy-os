import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";
import { handleStripeWebhook } from "./stripeWebhook";

const http = httpRouter();

// Convex Auth's own routes (/api/auth/*) — token refresh, OAuth callbacks if
// ever added later. Required even for a Password-only setup.
auth.addHttpRoutes(http);

// Signature-verified, idempotent (§8.4) — the actual verification and
// ledger write live in convex/stripeWebhook.ts ("use node", for the real
// `stripe` package's signature check) and convex/stripe.ts respectively.
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => handleStripeWebhook(ctx, request)),
});

// The "QR-resolver pattern" from Tasks.md §14: a voucher's emailed pay link
// (built as CONVEX_SITE_URL + "/pay/" + token by convex/vouchers.ts and
// convex/reminders.ts) points here with no auth required, resolves the
// token server-side, and redirects straight to a fresh Stripe Checkout
// session. Never exposes the service-role-equivalent path to the browser —
// the token is the capability.
http.route({
  pathPrefix: "/pay/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).pathname.replace(/^\/pay\//, "");
    if (!token) return new Response("Missing pay link token.", { status: 400 });
    try {
      const { url } = await ctx.runAction(api.stripe.createCheckoutSession, { token });
      return Response.redirect(url, 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not open checkout.";
      return new Response(message, { status: 400 });
    }
  }),
});

export default http;
