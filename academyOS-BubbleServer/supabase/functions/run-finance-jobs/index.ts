import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function karachiDateParts(): { ymd: string; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const dayStr = parts.find((p) => p.type === "day")?.value ?? "01";
  return { ymd: `${year}-${month}-${dayStr}`, day: Number(dayStr) };
}

type LineItem = { code?: string; label?: string; amount?: number | string };

async function emailVoucher(
  supabase: SupabaseClient,
  voucherId: string,
  resendApiKey: string,
  fromEmail: string,
  supabaseUrl: string,
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const { data: voucher, error: voucherError } = await supabase
    .from("vouchers")
    .select(
      "id, academy_id, token, total, period, due_date, status, guardian_id, student_id, line_items",
    )
    .eq("id", voucherId)
    .maybeSingle();

  if (voucherError || !voucher) {
    return { ok: false, error: "voucher_not_found" };
  }
  if (!voucher.token || String(voucher.token).length < 20) {
    return { ok: false, error: "no_token" };
  }

  const [{ data: guardian }, { data: student }, { data: balance }] =
    await Promise.all([
      supabase
        .from("guardians")
        .select("name, email")
        .eq("id", voucher.guardian_id)
        .maybeSingle(),
      supabase
        .from("students")
        .select("name, status")
        .eq("id", voucher.student_id)
        .maybeSingle(),
      supabase
        .from("voucher_balances")
        .select("outstanding")
        .eq("voucher_id", voucher.id)
        .maybeSingle(),
    ]);

  if (student?.status === "left") return { ok: false, error: "student_left" };

  const toEmail = guardian?.email?.trim();
  if (!toEmail) return { ok: false, error: "no_email" };

  const outstanding = Math.round(Number(balance?.outstanding ?? 0) * 100) / 100;
  if (outstanding <= 0) return { ok: false, error: "already_paid" };

  const payUrl =
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/create-checkout?t=${encodeURIComponent(voucher.token)}`;
  const periodLabel = voucher.period
    ? String(voucher.period).slice(0, 7)
    : "fees";
  const studentName = student?.name || "your child";
  const guardianName = guardian?.name || "Parent";
  const items = (Array.isArray(voucher.line_items)
    ? voucher.line_items
    : []) as LineItem[];
  const rows = items
    .map((item) => {
      const label = escapeHtml(String(item.label ?? item.code ?? "Item"));
      const amount = Number(item.amount ?? 0).toFixed(2);
      return `<tr><td style="padding:4px 0;">${label}</td><td style="padding:4px 0;text-align:right;">${amount}</td></tr>`;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <p>Hi ${escapeHtml(guardianName)},</p>
  <p>Fee voucher for <strong>${escapeHtml(studentName)}</strong> (${escapeHtml(periodLabel)}).</p>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
  <p>Amount due: <strong>${outstanding.toFixed(2)}</strong></p>
  <p>Due date: <strong>${escapeHtml(String(voucher.due_date ?? "—"))}</strong></p>
  <p><a href="${payUrl}">Pay securely online</a></p>
  <p style="color:#6b7280;font-size:12px;">${payUrl}</p>
  <p>— AcademyOS</p>
</body></html>`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: `Fee voucher — ${studentName} (${periodLabel})`,
      html,
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error("Resend voucher email failed:", errText);
    return { ok: false, email: toEmail, error: "email_failed" };
  }

  await supabase.from("message_log").insert({
    academy_id: voucher.academy_id,
    guardian_id: voucher.guardian_id,
    voucher_id: voucher.id,
    channel: "email",
    status: "sent",
    template_version: 1,
    content: "voucher_issue",
    sent_at: new Date().toISOString(),
  });

  return { ok: true, email: toEmail };
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
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
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

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!bearer) {
      return jsonResponse({
        success: false,
        error: "auth_error",
        message: "Missing Authorization Bearer token",
      }, 401);
    }

    const supabase = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const cronOk = cronSecret.length >= 16 && bearer === cronSecret;
    let adminOk = false;
    if (!cronOk) {
      const { data: { user }, error } = await supabase.auth.getUser(bearer);
      if (!error && user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        adminOk = profile?.role === "admin";
      }
    }

    if (!cronOk && !adminOk) {
      return jsonResponse({
        success: false,
        error: "forbidden",
        message: "Cron secret or admin JWT required",
      }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const forceGenerate = body.force_generate === true;
    const skipEmail = body.skip_email === true;
    const skipAccrue = body.skip_accrue === true;
    const skipGenerate = body.skip_generate === true;
    const periodArg = typeof body.period === "string" && /^\d{4}-\d{2}-\d{2}$/
      .test(body.period)
      ? body.period
      : null;

    const { data: rules, error: rulesError } = await supabase
      .from("fee_rules")
      .select("generation_day, due_day")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rulesError || !rules) {
      return jsonResponse({
        success: false,
        error: "not_configured",
        message: "Fee rules not configured",
      }, 500);
    }

    const { day, ymd } = karachiDateParts();
    const isGenerationDay = day === Number(rules.generation_day);
    const shouldGenerate = !skipGenerate && (forceGenerate || isGenerationDay);

    let accrue: Record<string, unknown> | null = null;
    let generate: Record<string, unknown> | null = null;
    const emails: { sent: number; failed: number; skipped: string } = {
      sent: 0,
      failed: 0,
      skipped: "none",
    };

    if (!skipAccrue) {
      const { data, error } = await supabase.rpc("accrue_late_fines");
      if (error) {
        return jsonResponse({
          success: false,
          error: "accrue_failed",
          message: error.message,
        }, 500);
      }
      accrue = data as Record<string, unknown>;
    }

    if (shouldGenerate) {
      const { data, error } = await supabase.rpc("generate_vouchers", {
        p_period: periodArg,
      });
      if (error) {
        return jsonResponse({
          success: false,
          error: "generate_failed",
          message: error.message,
          accrue,
        }, 500);
      }
      generate = data as Record<string, unknown>;

      if (!skipEmail && resendApiKey) {
        const period = String(generate?.period ?? periodArg ?? "").slice(0, 10);
        const { data: due } = await supabase
          .from("voucher_balances")
          .select("voucher_id")
          .eq("period", period)
          .gt("outstanding", 0);

        for (const row of due ?? []) {
          const { data: alreadySent } = await supabase
            .from("message_log")
            .select("id")
            .eq("voucher_id", row.voucher_id)
            .eq("channel", "email")
            .eq("content", "voucher_issue")
            .maybeSingle();
          if (alreadySent) continue;

          const result = await emailVoucher(
            supabase,
            row.voucher_id,
            resendApiKey,
            fromEmail,
            supabaseUrl,
          );
          if (result.ok) emails.sent += 1;
          else emails.failed += 1;
        }
        if (emails.sent === 0 && emails.failed === 0) {
          emails.skipped = "no_unmailed_outstanding";
        }
      } else if (!skipEmail && !resendApiKey) {
        emails.skipped = "RESEND_API_KEY missing";
      }
    } else {
      generate = {
        skipped: true,
        reason: `today ${ymd} is day ${day}; generation_day is ${rules.generation_day}`,
      };
      emails.skipped = "generate_skipped";
    }

    await supabase.from("job_runs").insert({
      job_name: "run_finance_jobs",
      period: periodArg,
      result: {
        source: cronOk ? "cron" : "admin",
        karachi_today: ymd,
        is_generation_day: isGenerationDay,
        force_generate: forceGenerate,
        accrue,
        generate,
        emails,
      },
    });

    return jsonResponse({
      success: true,
      karachi_today: ymd,
      is_generation_day: isGenerationDay,
      ran_generate: shouldGenerate,
      accrue,
      generate,
      emails,
    });
  } catch (err) {
    console.error("run-finance-jobs error:", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: err instanceof Error ? err.message : "Unexpected error",
    }, 500);
  }
});
