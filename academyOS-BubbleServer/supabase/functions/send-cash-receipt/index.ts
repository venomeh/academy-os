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

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPeriod(period: string | null): string {
  if (!period) return "—";
  const d = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return period;
  return d.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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
        message: "Only admins can send cash receipts",
      }, 403);
    }

    const body = await req.json();
    const receiptNumber = typeof body?.receipt_number === "string"
      ? body.receipt_number.trim()
      : "";
    const voucherId = typeof body?.voucher_id === "string"
      ? body.voucher_id.trim()
      : "";

    if (!receiptNumber) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "receipt_number is required",
      }, 400);
    }

    const { data: entry, error: entryError } = await supabase
      .from("ledger_entries")
      .select(
        "id, amount, receipt_number, method, voucher_id, guardian_id, student_id, created_at",
      )
      .eq("receipt_number", receiptNumber)
      .eq("kind", "payment")
      .eq("method", "cash")
      .maybeSingle();

    if (entryError || !entry) {
      return jsonResponse({
        success: false,
        error: "not_found",
        message: "Cash receipt not found",
      }, 404);
    }

    if (voucherId && entry.voucher_id !== voucherId) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "receipt_number does not match voucher_id",
      }, 400);
    }

    const { data: voucher, error: voucherError } = await supabase
      .from("vouchers")
      .select(
        "id, period, due_date, status, total, tuition_amount, fines, arrears, sibling_discount",
      )
      .eq("id", entry.voucher_id)
      .maybeSingle();

    if (voucherError || !voucher) {
      console.error("voucher lookup failed:", voucherError);
      return jsonResponse({
        success: false,
        error: "not_found",
        message: "Voucher not found for this receipt",
      }, 404);
    }

    const [{ data: guardian }, { data: student }, { data: balance }] =
      await Promise.all([
        supabase
          .from("guardians")
          .select("id, name, email")
          .eq("id", entry.guardian_id)
          .maybeSingle(),
        supabase
          .from("students")
          .select("id, name")
          .eq("id", entry.student_id)
          .maybeSingle(),
        supabase
          .from("voucher_balances")
          .select("outstanding")
          .eq("voucher_id", entry.voucher_id)
          .maybeSingle(),
      ]);

    if (!guardian?.email) {
      return jsonResponse({
        success: false,
        error: "no_email",
        message: "Guardian has no email on file",
      }, 400);
    }

    const remaining = Math.max(0, Number(balance?.outstanding ?? 0));
    const paidNow = Number(entry.amount ?? 0);
    const guardianName = guardian.name || "Parent";
    const studentName = student?.name || "Student";
    const periodLabel = formatPeriod(voucher.period);
    const statusLabel = String(voucher.status || "").toUpperCase();

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="margin: 0 0 8px;">Cash payment receipt</h2>
  <p style="color: #6b7280; margin: 0 0 24px;">AcademyOS</p>
  <p>Hi ${escapeHtml(guardianName)},</p>
  <p>We received a cash payment for <strong>${escapeHtml(studentName)}</strong>.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
    <tr>
      <td style="padding: 8px 0; color: #6b7280;">Receipt</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600;">${escapeHtml(receiptNumber)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #6b7280;">Period</td>
      <td style="padding: 8px 0; text-align: right;">${escapeHtml(periodLabel)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #6b7280;">Amount paid</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600;">Rs ${formatMoney(paidNow)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #6b7280;">Remaining on voucher</td>
      <td style="padding: 8px 0; text-align: right;">Rs ${formatMoney(remaining)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #6b7280;">Voucher status</td>
      <td style="padding: 8px 0; text-align: right;">${escapeHtml(statusLabel)}</td>
    </tr>
  </table>
  <p style="color: #6b7280; font-size: 14px;">Keep this email as your receipt. If anything looks wrong, contact the academy office.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #9ca3af; font-size: 12px;">This receipt was sent automatically after a cash payment was recorded by an administrator.</p>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [guardian.email],
        subject: `Cash receipt ${receiptNumber} — ${studentName}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend cash receipt failed:", errText);
      return jsonResponse({
        success: false,
        error: "email_failed",
        message: "Failed to send receipt email",
      }, 502);
    }

    return jsonResponse({
      success: true,
      receipt_number: receiptNumber,
      email: guardian.email,
      paid: paidNow,
      remaining,
      status: voucher.status,
    });
  } catch (err) {
    console.error("send-cash-receipt error:", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: err instanceof Error ? err.message : "Unexpected error",
    }, 500);
  }
});
