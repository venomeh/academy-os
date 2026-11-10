import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type VoucherRow = {
  id: string;
  academy_id: string;
  guardian_id: string;
  student_id: string;
  total: number | string;
  period: string | null;
  status: string;
  due_date: string | null;
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redirectTo(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: url,
      "Cache-Control": "no-store",
    },
  });
}

function cleanPayToken(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (
    !token ||
    token === "null" ||
    token === "undefined" ||
    token.startsWith("<") ||
    token.length < 20
  ) {
    return "";
  }
  return token;
}

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

async function createCheckoutSession(opts: {
  stripeSecret: string;
  currency: string;
  appUrl: string;
  voucher: VoucherRow;
  outstanding: number;
}): Promise<{ url: string; session_id: string }> {
  const unitAmount = Math.round(opts.outstanding * 100);
  if (unitAmount < 1) {
    throw new Error("Amount too small for Checkout");
  }

  const stripe = new Stripe(opts.stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const periodLabel = opts.voucher.period
    ? String(opts.voucher.period).slice(0, 7)
    : "fees";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: opts.currency,
          unit_amount: unitAmount,
          product_data: {
            name: `Academy fee — ${periodLabel}`,
            description: `Voucher ${opts.voucher.id}`,
          },
        },
      },
    ],
    success_url: `${opts.appUrl}/pay_result?status=success`,
    cancel_url: `${opts.appUrl}/pay_result?status=cancel`,
    metadata: {
      voucher_id: opts.voucher.id,
      guardian_id: opts.voucher.guardian_id,
      student_id: opts.voucher.student_id,
      academy_id: opts.voucher.academy_id,
    },
    client_reference_id: opts.voucher.id,
  });

  if (!session.url) {
    throw new Error("Checkout session missing URL");
  }

  return { url: session.url, session_id: session.id };
}

async function outstandingForVoucher(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  voucher: VoucherRow,
): Promise<{ outstanding: number; error?: string }> {
  const { data, error } = await supabase
    .from("voucher_balances")
    .select("outstanding")
    .eq("voucher_id", voucher.id)
    .maybeSingle();

  if (error || !data) {
    return { outstanding: 0, error: "compute_failed" };
  }

  const outstanding = Math.round(Number(data.outstanding) * 100) / 100;
  if (outstanding <= 0) {
    return { outstanding: 0, error: "already_paid" };
  }

  return { outstanding };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const key = serviceRoleKey();
    const appUrl =
      Deno.env.get("APP_URL") ||
      "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";
    const currency = (Deno.env.get("STRIPE_CURRENCY") || "pkr").toLowerCase();
    const isGet = req.method === "GET";
    const resultPage = (status: string) => `${appUrl}/pay_result?status=${status}`;

    if (!supabaseUrl || !key) {
      if (isGet) return redirectTo(resultPage("cancel"));
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "Supabase not configured",
      }, 500);
    }
    if (!stripeSecret) {
      if (isGet) return redirectTo(resultPage("cancel"));
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "STRIPE_SECRET_KEY not configured",
      }, 500);
    }

    const supabase = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let body: Record<string, unknown> = {};
    if (!isGet) {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const requestUrl = new URL(req.url);
    const rawToken = isGet
      ? (requestUrl.searchParams.get("t") ||
        requestUrl.searchParams.get("token") ||
        "")
      : typeof body.token === "string"
      ? body.token
      : "";
    const voucherId = typeof body.voucher_id === "string"
      ? body.voucher_id.trim()
      : "";
    // Bubble often sends unsubstituted "<token>" or a blank after Allow blank.
    // Pay-link tokens are ≥ 20 chars. Anything shorter is not Path A — use voucher_id.
    const payToken = cleanPayToken(rawToken);

    if (isGet && !payToken) {
      return redirectTo(resultPage("cancel"));
    }

    let voucher: VoucherRow | null = null;

    // --- Path A: email pay link (token ≥ 20 chars) ---
    if (payToken) {
      const { data, error } = await supabase
        .from("vouchers")
        .select(
          "id, academy_id, guardian_id, student_id, total, period, status, due_date",
        )
        .eq("token", payToken)
        .maybeSingle();

      if (data) {
        voucher = data as VoucherRow;
      } else if (!voucherId) {
        if (isGet) return redirectTo(resultPage("cancel"));
        return jsonResponse({
          success: false,
          error: "not_found",
          message: "Invalid or unknown pay token",
        }, 404);
      }
      // Junk Initialize token + voucher_id → Path B below.
    }

    if (!voucher && voucherId) {
      // --- Path B: logged-in parent + voucher_id ---
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({
          success: false,
          error: "auth_error",
          message: "Missing or invalid Authorization header",
        }, 401);
      }
      const callerJwt = authHeader.replace("Bearer ", "");

      const {
        data: { user: caller },
        error: callerError,
      } = await supabase.auth.getUser(callerJwt);

      if (callerError || !caller) {
        return jsonResponse({
          success: false,
          error: "auth_error",
          message: "Invalid token",
        }, 401);
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, academy_id")
        .eq("id", caller.id)
        .single();

      if (!profile || profile.role !== "parent") {
        return jsonResponse({
          success: false,
          error: "forbidden",
          message: "Only parents can start checkout",
        }, 403);
      }

      const { data: guardian } = await supabase
        .from("guardians")
        .select("id")
        .eq("profile_id", caller.id)
        .maybeSingle();

      if (!guardian?.id) {
        return jsonResponse({
          success: false,
          error: "forbidden",
          message: "Guardian profile not found",
        }, 403);
      }

      const { data, error } = await supabase
        .from("vouchers")
        .select(
          "id, academy_id, guardian_id, student_id, total, period, status, due_date",
        )
        .eq("id", voucherId)
        .maybeSingle();

      if (error || !data) {
        return jsonResponse({
          success: false,
          error: "not_found",
          message: "Voucher not found",
        }, 404);
      }

      if (data.guardian_id !== guardian.id) {
        return jsonResponse({
          success: false,
          error: "forbidden",
          message: "Not your voucher",
        }, 403);
      }

      voucher = data as VoucherRow;
    } else if (!voucher) {
      if (isGet) return redirectTo(resultPage("cancel"));
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "Provide voucher_id (parent JWT) or token (pay link)",
      }, 400);
    }

    const { outstanding, error: balError } = await outstandingForVoucher(
      supabase,
      voucher,
    );

    if (balError === "already_paid") {
      if (isGet) return redirectTo(resultPage("success"));
      return jsonResponse({
        success: false,
        error: "already_paid",
        message: "Voucher is already paid",
      }, 400);
    }
    if (balError || outstanding <= 0) {
      if (isGet) return redirectTo(resultPage("cancel"));
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "Could not compute outstanding",
      }, 500);
    }

    const session = await createCheckoutSession({
      stripeSecret,
      currency,
      appUrl,
      voucher,
      outstanding,
    });

    if (isGet) return redirectTo(session.url);

    return jsonResponse({
      success: true,
      url: session.url,
      session_id: session.session_id,
      amount: outstanding,
      currency,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("create-checkout error:", message);
    if (req.method === "GET") {
      const appUrl =
        Deno.env.get("APP_URL") ||
        "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";
      return redirectTo(`${appUrl}/pay_result?status=cancel`);
    }
    return jsonResponse({
      success: false,
      error: "server_error",
      message,
    }, 500);
  }
});
