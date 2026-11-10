import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const key = serviceRoleKey();
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") || "AcademyOS <noreply@example.com>";

    if (!supabaseUrl || !key) {
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "Supabase not configured",
      }, 500);
    }
    if (!resendApiKey) {
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "RESEND_API_KEY not configured",
      }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({
        success: false,
        error: "auth_error",
        message: "Missing or invalid Authorization header",
      }, 401);
    }

    const supabase = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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
      .select("role")
      .eq("id", caller.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return jsonResponse({
        success: false,
        error: "forbidden",
        message: "Only admins can send pay links",
      }, 403);
    }

    const body = await req.json();
    const voucherId = typeof body?.voucher_id === "string"
      ? body.voucher_id.trim()
      : "";

    if (!voucherId) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "voucher_id is required",
      }, 400);
    }

    const { data: voucher, error: voucherError } = await supabase
      .from("vouchers")
      .select(
        "id, token, total, period, due_date, status, guardian_id, student_id",
      )
      .eq("id", voucherId)
      .maybeSingle();

    if (voucherError || !voucher) {
      return jsonResponse({
        success: false,
        error: "not_found",
        message: "Voucher not found",
      }, 404);
    }

    if (!voucher.token || String(voucher.token).length < 20) {
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "Voucher has no valid pay token",
      }, 500);
    }

    const { data: guardian } = await supabase
      .from("guardians")
      .select("id, name, email")
      .eq("id", voucher.guardian_id)
      .maybeSingle();

    const { data: student } = await supabase
      .from("students")
      .select("name, status")
      .eq("id", voucher.student_id)
      .maybeSingle();

    if (student?.status === "left") {
      return jsonResponse({
        success: false,
        error: "student_left",
        message: "This student has left. Pay links are not sent for leavers.",
      }, 400);
    }

    const toEmail = guardian?.email?.trim();
    if (!toEmail) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "Guardian has no email",
      }, 400);
    }

    const { data: balance } = await supabase
      .from("voucher_balances")
      .select("outstanding")
      .eq("voucher_id", voucher.id)
      .maybeSingle();

    const outstanding = Math.round(Number(balance?.outstanding ?? 0) * 100) / 100;

    if (outstanding <= 0) {
      return jsonResponse({
        success: false,
        error: "already_paid",
        message: "Nothing outstanding to pay",
      }, 400);
    }

    const payUrl =
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/create-checkout?t=${encodeURIComponent(voucher.token)}`;
    const periodLabel = voucher.period
      ? String(voucher.period).slice(0, 7)
      : "fees";
    const studentName = student?.name || "your child";
    const guardianName = guardian?.name || "Parent";

    const html = `
      <p>Hi ${guardianName},</p>
      <p>Fee voucher for <strong>${studentName}</strong> (${periodLabel}).</p>
      <p>Amount due: <strong>${outstanding.toFixed(2)}</strong></p>
      <p>Due date: <strong>${voucher.due_date ?? "—"}</strong></p>
      <p><a href="${payUrl}">Pay securely online</a></p>
      <p>If the button does not work, copy this link:<br/>${payUrl}</p>
      <p>— AcademyOS</p>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `Fee payment link — ${studentName} (${periodLabel})`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return jsonResponse({
        success: false,
        error: "email_error",
        message: "Failed to send email",
      }, 500);
    }

    return jsonResponse({
      success: true,
      email: toEmail,
      pay_url: payUrl,
      amount: outstanding,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("send-pay-link error:", message);
    return jsonResponse({
      success: false,
      error: "server_error",
      message,
    }, 500);
  }
});
