import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type LineItem = { code?: string; label?: string; amount?: number | string };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
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

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function itemizationText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return (items as LineItem[])
    .map((item) => {
      const label = String(item.label ?? item.code ?? "Item");
      const amount = Number(item.amount ?? 0).toFixed(2);
      return `${label}: ${amount}`;
    })
    .join("\n");
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
    const appUrl =
      Deno.env.get("APP_URL") ||
      "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";

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

    const dryRun = body.dry_run === true || body.dry_run === "true";
    const limitRaw = Number(body.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 200)
      : 200;
    // Bubble leaves unsubstituted "<voucher_id>" (or a guardian UUID) in the
    // body when the field is blank. Only a real voucher UUID is a filter.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const voucherRaw = body.voucher_id == null ? "" : String(body.voucher_id).trim();
    const voucherFilter =
      voucherRaw &&
      !voucherRaw.startsWith("<") &&
      voucherRaw !== "null" &&
      voucherRaw !== "undefined" &&
      UUID_RE.test(voucherRaw)
        ? voucherRaw
        : "";

    const { data: defaulters, error: defErr } = await supabase
      .from("defaulters")
      .select(
        "voucher_id, student_id, guardian_id, period, due_date, outstanding, days_overdue, bucket, reminders_paused",
      )
      .order("days_overdue", { ascending: false });

    if (defErr) {
      return jsonResponse({
        success: false,
        error: "query_failed",
        message: defErr.message,
      }, 500);
    }

    const candidates = (defaulters ?? []).filter((row) => {
      if (row.reminders_paused) return false;
      if (voucherFilter && row.voucher_id !== voucherFilter) return false;
      return true;
    });

    let skippedPaused = (defaulters ?? []).filter((r) => r.reminders_paused).length;
    let skippedLeft = 0;
    let skippedAlready = 0;
    let sent = 0;
    let failed = 0;
    const preview: Record<string, unknown>[] = [];

    for (const row of candidates) {
      if (sent + failed >= limit && !dryRun) break;
      if (dryRun && preview.length >= limit) break;

      const { data: existing } = await supabase
        .from("message_log")
        .select("id")
        .eq("voucher_id", row.voucher_id)
        .eq("bucket", row.bucket)
        .eq("channel", "email")
        .maybeSingle();

      if (existing) {
        skippedAlready += 1;
        continue;
      }

      const [{ data: voucher }, { data: guardian }, { data: student }] =
        await Promise.all([
          supabase
            .from("vouchers")
            .select("id, academy_id, token, line_items, total")
            .eq("id", row.voucher_id)
            .maybeSingle(),
          supabase
            .from("guardians")
            .select("id, name, email, profile_id, language_pref")
            .eq("id", row.guardian_id)
            .maybeSingle(),
          supabase
            .from("students")
            .select("name, status")
            .eq("id", row.student_id)
            .maybeSingle(),
        ]);

      if (!voucher || !guardian) {
        failed += 1;
        continue;
      }

      if (student?.status === "left") {
        skippedLeft += 1;
        continue;
      }

      let language = "en";
      if (guardian.language_pref === "ur") {
        language = "ur";
      } else if (guardian.profile_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("language_pref")
          .eq("id", guardian.profile_id)
          .maybeSingle();
        if (profile?.language_pref === "ur") language = "ur";
      }

      const { data: templates } = await supabase
        .from("reminder_templates")
        .select("subject_line, body, template_version")
        .eq("academy_id", voucher.academy_id)
        .eq("bucket", row.bucket)
        .eq("language", language)
        .eq("active", true)
        .order("template_version", { ascending: false })
        .limit(1);

      let template = templates?.[0];
      if (!template && language !== "en") {
        const { data: enTemplates } = await supabase
          .from("reminder_templates")
          .select("subject_line, body, template_version")
          .eq("academy_id", voucher.academy_id)
          .eq("bucket", row.bucket)
          .eq("language", "en")
          .eq("active", true)
          .order("template_version", { ascending: false })
          .limit(1);
        template = enTemplates?.[0];
      }

      if (!template) {
        failed += 1;
        continue;
      }

      const payUrl = voucher.token && String(voucher.token).length >= 20
        ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/create-checkout?t=${encodeURIComponent(voucher.token)}`
        : appUrl;
      const vars: Record<string, string> = {
        guardian_name: guardian.name || "Parent",
        student_name: student?.name || "your child",
        amount: Number(row.outstanding).toFixed(2),
        due_date: String(row.due_date ?? "—"),
        days_overdue: String(row.days_overdue ?? 0),
        period: row.period ? String(row.period).slice(0, 7) : "fees",
        itemization: itemizationText(voucher.line_items),
        pay_url: payUrl,
      };
      const subject = fillTemplate(template.subject_line, vars);
      const content = fillTemplate(template.body, vars);
      const toEmail = guardian.email?.trim() || "";

      if (dryRun) {
        preview.push({
          voucher_id: row.voucher_id,
          bucket: row.bucket,
          days_overdue: row.days_overdue,
          email: toEmail || null,
          subject,
        });
        continue;
      }

      if (!toEmail) {
        await supabase.from("message_log").insert({
          academy_id: voucher.academy_id,
          guardian_id: guardian.id,
          voucher_id: voucher.id,
          bucket: row.bucket,
          channel: "email",
          status: "failed",
          template_version: template.template_version,
          content,
          error_detail: "guardian has no email",
        });
        failed += 1;
        continue;
      }

      if (!resendApiKey) {
        return jsonResponse({
          success: false,
          error: "server_error",
          message: "RESEND_API_KEY not configured",
        }, 500);
      }

      const { data: claimed, error: claimErr } = await supabase
        .from("message_log")
        .insert({
          academy_id: voucher.academy_id,
          guardian_id: guardian.id,
          voucher_id: voucher.id,
          bucket: row.bucket,
          channel: "email",
          status: "pending",
          template_version: template.template_version,
          content,
        })
        .select("id")
        .maybeSingle();

      if (claimErr || !claimed) {
        skippedAlready += 1;
        continue;
      }

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          subject,
          text: content,
        }),
      });

      if (!emailRes.ok) {
        const errText = await emailRes.text();
        await supabase.from("message_log").update({
          status: "failed",
          error_detail: errText.slice(0, 500),
        }).eq("id", claimed.id);
        failed += 1;
        continue;
      }

      await supabase.from("message_log").update({
        status: "sent",
        sent_at: new Date().toISOString(),
      }).eq("id", claimed.id);
      sent += 1;
    }

    const summary = {
      source: cronOk ? "cron" : "admin",
      dry_run: dryRun,
      sent,
      failed,
      skipped_paused: skippedPaused,
      skipped_left: skippedLeft,
      skipped_already: skippedAlready,
      candidates: candidates.length,
      defaulters_found: (defaulters ?? []).length,
      voucher_filter: voucherFilter || null,
      preview: dryRun ? preview : undefined,
    };

    await supabase.from("job_runs").insert({
      job_name: "send_reminders",
      result: summary,
    });

    return jsonResponse({
      success: true,
      ...summary,
    });
  } catch (err) {
    console.error("send-reminders error:", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: err instanceof Error ? err.message : "Unexpected error",
    }, 500);
  }
});
