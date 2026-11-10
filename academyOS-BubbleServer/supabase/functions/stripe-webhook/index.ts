import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

function serviceRoleKey(): string | null {
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (secretKeys) {
      try {
        key = JSON.parse(secretKeys)["default"];
      } catch {
        /* ignore */
      }
    }
  }
  return key ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const key = serviceRoleKey();

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !key) {
    console.error("stripe-webhook misconfigured");
    return new Response("server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    return new Response("missing signature", { status: 400 });
  }

  const rawBody = await req.text();

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    console.error("signature verify failed:", message);
    return new Response(`webhook error: ${message}`, { status: 400 });
  }

  if (event.type === "checkout.session.expired") {
    // No ledger write — session abandoned.
    return new Response(JSON.stringify({ received: true, type: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const voucherId = session.metadata?.voucher_id ??
    session.client_reference_id ?? null;

  if (!voucherId) {
    console.error("checkout.session.completed missing voucher_id", event.id);
    return new Response("missing voucher_id metadata", { status: 400 });
  }

  // amount_total is in minor units (paisa / cents).
  const amountTotal = session.amount_total;
  if (amountTotal == null || amountTotal <= 0) {
    console.error("checkout.session.completed bad amount", event.id);
    return new Response("invalid amount", { status: 400 });
  }
  const amount = Math.round(amountTotal) / 100;

  const supabase = createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("record_stripe_payment", {
    p_voucher_id: voucherId,
    p_amount: amount,
    p_stripe_event_id: event.id,
  });

  if (error) {
    // Unique violation on stripe_event_id → treat as success (idempotent).
    if (
      error.code === "23505" ||
      (error.message && error.message.toLowerCase().includes("duplicate"))
    ) {
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    console.error("record_stripe_payment failed:", error);
    return new Response(error.message, { status: 500 });
  }

  return new Response(
    JSON.stringify({ received: true, result: data }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
