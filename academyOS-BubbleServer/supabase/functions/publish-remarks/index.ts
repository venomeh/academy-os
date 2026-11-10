import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

function cleanText(value: unknown): string {
  const raw = value == null ? "" : String(value).trim();
  if (!raw || raw === "null" || raw === "undefined") return "";
  if (/^<[A-Za-z0-9_]*>$/.test(raw)) return "";
  return raw;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    if (!resendApiKey) {
      return jsonResponse({
        success: false,
        error: "not_configured",
        message: "RESEND_API_KEY is not set",
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

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const batchId = cleanText(body.p_batch_id);
    const month = cleanText(body.p_month);
    if (!batchId || !month) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "p_batch_id and p_month are required",
      }, 400);
    }

    const supabase = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(bearer);
    if (userError || !user) {
      return jsonResponse({
        success: false,
        error: "auth_error",
        message: "Invalid token",
      }, 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin" && profile?.role !== "teacher") {
      return jsonResponse({
        success: false,
        error: "forbidden",
        message: "Teacher or admin JWT required",
      }, 403);
    }
    if (profile.role === "teacher") {
      const { data: assignment } = await supabase
        .from("batch_teachers")
        .select("batch_id")
        .eq("teacher_id", user.id)
        .eq("batch_id", batchId)
        .maybeSingle();
      if (!assignment) {
        return jsonResponse({
          success: false,
          error: "forbidden",
          message: "Batch is not assigned to this teacher",
        }, 403);
      }
    }

    const { data: queue, error: queueError } = await supabase.rpc(
      "get_remark_data_packs",
      { p_batch_id: batchId, p_month: month, p_student_id: null },
    );
    if (queueError) {
      return jsonResponse({
        success: false,
        error: "queue_failed",
        message: queueError.message,
      }, 500);
    }

    const rows = (queue ?? []) as Array<{
      academy_id: string;
      student_id: string;
      student_name: string;
      guardian_id: string;
      period_date: string;
      period_text: string;
      existing_status: string | null;
      batch_name: string;
    }>;

    const drafts = rows.filter((row) => row.existing_status === "draft");
    const missing = rows.filter((row) => !row.existing_status);
    if (drafts.length > 0 || missing.length > 0) {
      return jsonResponse({
        success: false,
        error: "pending_drafts",
        message: `${drafts.length} draft(s) and ${missing.length} missing remark(s) still need review before publish`,
        pending_drafts: drafts.length,
        missing: missing.length,
      }, 400);
    }

    const approved = rows.filter((row) => row.existing_status === "approved");
    if (approved.length === 0) {
      return jsonResponse({
        success: false,
        error: "nothing_to_publish",
        message: "No approved remarks for this batch and month",
      }, 400);
    }

    const byGuardian = new Map<string, typeof approved>();
    for (const row of approved) {
      const list = byGuardian.get(row.guardian_id) ?? [];
      list.push(row);
      byGuardian.set(row.guardian_id, list);
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const portalUrl = `${appUrl}/parent_children`;

    for (const [guardianId, children] of byGuardian.entries()) {
      const period = children[0]?.period_date;
      const academyId = children[0]?.academy_id;
      const periodLabel = children[0]?.period_text || month;

      const { data: existing } = await supabase
        .from("remark_notification_log")
        .select("id, status")
        .eq("guardian_id", guardianId)
        .eq("batch_id", batchId)
        .eq("period", period)
        .eq("channel", "email")
        .maybeSingle();
      if (existing?.status === "sent") {
        skipped += 1;
        continue;
      }

      const { data: guardian } = await supabase
        .from("guardians")
        .select("id, name, email")
        .eq("id", guardianId)
        .maybeSingle();
      const toEmail = guardian?.email?.trim() || "";
      const childNames = children.map((c) => c.student_name).join(", ");
      const close = (tag: string) => `<` + `/${tag}>`;
      const listHtml = children
        .map((c) => `<li>${escapeHtml(c.student_name)}${close("li")}`)
        .join("");

      if (!toEmail) {
        await supabase.from("remark_notification_log").upsert({
          academy_id: academyId,
          guardian_id: guardianId,
          batch_id: batchId,
          period,
          channel: "email",
          status: "failed",
          error_detail: "no_email",
        }, { onConflict: "guardian_id,batch_id,period,channel" });
        failed += 1;
        continue;
      }

      const html = [
        `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;">`,
        `<h2 style="margin:0 0 12px;">Progress remarks published${close("h2")}`,
        `<p>Hi ${escapeHtml(guardian?.name || "Parent")},${close("p")}`,
        `<p>Teachers have published ${escapeHtml(periodLabel)} progress remarks for:${close("p")}`,
        `<ul>${listHtml}${close("ul")}`,
        `<p><a href="${escapeHtml(portalUrl)}">Open the parent portal${close("a")} to read the approved remarks.${close("p")}`,
        `<p style="color:#6b7280;font-size:13px;">— AcademyOS${close("p")}`,
        `${close("body")}${close("html")}`,
      ].join("");

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          subject: `Progress remarks for ${periodLabel} — ${childNames}`,
          html,
        }),
      });

      if (!emailRes.ok) {
        const errText = await emailRes.text();
        await supabase.from("remark_notification_log").upsert({
          academy_id: academyId,
          guardian_id: guardianId,
          batch_id: batchId,
          period,
          channel: "email",
          status: "failed",
          error_detail: errText.slice(0, 500),
        }, { onConflict: "guardian_id,batch_id,period,channel" });
        failed += 1;
        continue;
      }

      await supabase.from("remark_notification_log").upsert({
        academy_id: academyId,
        guardian_id: guardianId,
        batch_id: batchId,
        period,
        channel: "email",
        status: "sent",
        sent_at: new Date().toISOString(),
        error_detail: null,
      }, { onConflict: "guardian_id,batch_id,period,channel" });
      sent += 1;
    }

    return jsonResponse({
      success: true,
      sent,
      skipped,
      failed,
      approved: approved.length,
    });
  } catch (err) {
    console.error("publish-remarks error:", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }
});
