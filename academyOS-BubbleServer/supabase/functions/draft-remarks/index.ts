import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROUNDING_RULES = `You generate monthly student progress remarks for a school system.

Rules:
- Use only the structured JSON data pack in the user message.
- Mention actual numbers when they are present (attendance percentage, test scores, batch average, trend).
- Do not invent behavior, effort, personality, health, family, discipline, or financial details.
- If tests are missing, do not mention academic performance.
- If attendance days are 0, do not mention attendance.
- If low_data is true, return status "low_data" and do not write a normal remark.
- Follow the requested language (en or ur).
- Keep the remark 2 to 4 sentences.
- Reply with one JSON object and nothing else. No markdown, no checklists, no chain of thought.
- draft_text must be only the parent-facing sentences. Never put JSON, grounding, constraint checks, or "I'll output the JSON" inside draft_text.`;

type DataPack = {
  academy_id: string;
  student_id: string;
  student_name: string;
  batch_id: string;
  batch_name: string;
  period_date: string;
  period_text: string;
  guardian_id: string;
  guardian_language: string;
  joined_at_text: string;
  joined_mid_month: boolean;
  attendance_total_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  leave_days: number;
  attendance_pct: number;
  published_tests_count: number;
  tests_json: unknown;
  tests_summary: string;
  current_month_avg_pct: number | null;
  previous_month_avg_pct: number | null;
  trend_text: string;
  low_data: boolean;
  low_data_reason: string | null;
  existing_remark_id: string | null;
  existing_status: string | null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function karachiDateParts(): { ymd: string; day: number; year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "01");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "01");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return { ymd: `${year}-${mm}-${dd}`, day, year, month };
}

function previousYearMonth(year: number, month: number): string {
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

function assistantContentToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const rec = part as { text?: unknown; content?: unknown };
          return String(rec.text ?? rec.content ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function messageToText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const rec = message as {
    content?: unknown;
    reasoning?: unknown;
    reasoning_content?: unknown;
    reasoning_details?: unknown;
  };
  const parts = [
    assistantContentToText(rec.content),
    assistantContentToText(rec.reasoning),
    assistantContentToText(rec.reasoning_content),
  ];
  if (Array.isArray(rec.reasoning_details)) {
    for (const detail of rec.reasoning_details) {
      if (detail && typeof detail === "object") {
        const d = detail as { text?: unknown; content?: unknown; summary?: unknown };
        parts.push(String(d.text ?? d.content ?? d.summary ?? ""));
      }
    }
  }
  return parts.filter((part) => part.trim().length > 0).join("\n").trim();
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

function isReasoningDump(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /i['’]?ll output the json/i.test(t) ||
    /check constraints/i.test(t) ||
    /mentions actual numbers/i.test(t) ||
    /does not mention attendance/i.test(t) ||
    /final check of the draft_text/i.test(t) ||
    /ensure i don['’]?t invent/i.test(t) ||
    /language en:\s*yes/i.test(t) ||
    (t.length > 800 && t.includes('"grounding"'))
  );
}

function extractDraftTextField(raw: string): string {
  const re = /"draft_text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let last = "";
  for (const match of raw.matchAll(re)) {
    const next = unescapeJsonString(match[1] ?? "");
    if (next && !isReasoningDump(next)) last = next;
  }
  return last;
}

function extractNumberedSentences(raw: string): string {
  const lines = [...raw.matchAll(/^\s*\d+[.)]\s+(.+?)\s*$/gm)]
    .map((match) => (match[1] ?? "").trim())
    .filter((line) => line.length > 20)
    .filter((line) => !/^(mentions|does not|language|check|grounding)/i.test(line));
  if (lines.length === 0) return "";
  return lines.slice(0, 4).join(" ").replace(/\s+/g, " ").trim();
}

function extractParentFacingRemark(raw: string): string {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!stripped) return "";
  const fromField = extractDraftTextField(stripped);
  if (fromField) return fromField;
  if (isReasoningDump(stripped) || stripped.includes('"draft_text"') || stripped.startsWith("{")) {
    const numbered = extractNumberedSentences(stripped);
    if (numbered) return numbered;
    if (isReasoningDump(stripped) || stripped.startsWith("{")) return "";
  }
  return stripped.length <= 800 ? stripped : stripped.slice(0, 800).trim();
}

function parseModelJson(raw: string): { status: string; draft_text: string } {
  const stripped = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const objects = stripped.match(/\{[^{}]*\}/g) ?? [];
  let status = "draft";
  for (const candidate of [...objects].reverse()) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed.status) status = String(parsed.status);
      const draft = extractParentFacingRemark(String(
        parsed.draft_text ??
          parsed.remark ??
          parsed.remark_text ??
          parsed.text ??
          "",
      ));
      if (draft) return { status, draft_text: draft };
    } catch {
      /* keep scanning */
    }
  }
  return {
    status,
    draft_text: extractParentFacingRemark(stripped),
  };
}

function draftFromAssistantMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const rec = message as { content?: unknown };
  const fromContent = extractParentFacingRemark(assistantContentToText(rec.content));
  if (fromContent) return fromContent;
  return extractParentFacingRemark(messageToText(message));
}

async function openRouterDraft(opts: {
  apiKey: string;
  model: string;
  siteUrl: string;
  appName: string;
  tone: string;
  language: string;
  pack: DataPack;
}): Promise<{
  draftText: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
}> {
  const userPayload = {
    language: opts.language,
    student_name: opts.pack.student_name,
    batch_name: opts.pack.batch_name,
    period: opts.pack.period_text,
    attendance: {
      total_days: opts.pack.attendance_total_days,
      present_days: opts.pack.present_days,
      absent_days: opts.pack.absent_days,
      late_days: opts.pack.late_days,
      leave_days: opts.pack.leave_days,
      attendance_pct: opts.pack.attendance_pct,
    },
    tests: opts.pack.tests_json,
    tests_summary: opts.pack.tests_summary,
    trend: {
      previous_month_avg_pct: opts.pack.previous_month_avg_pct,
      current_month_avg_pct: opts.pack.current_month_avg_pct,
      direction: opts.pack.trend_text,
    },
    low_data: opts.pack.low_data,
    low_data_reason: opts.pack.low_data_reason,
  };

  const body = {
    model: opts.model,
    temperature: 0.3,
    max_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${opts.tone}\n\n${GROUNDING_RULES}` },
      {
        role: "user",
        content:
          `Write one parent-facing progress remark from this data pack. Reply with JSON only: {"status":"draft","draft_text":"2-4 sentences"}. draft_text is the remark the parent will read — no reasoning, no grounding, no checklists.\n\n${JSON.stringify(userPayload)}`,
      },
    ],
  };

  let lastError = "openrouter_failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": opts.siteUrl,
        "X-Title": opts.appName,
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = { error: { message: raw } };
    }

    if (response.status === 429 || response.status === 502) {
      lastError = `openrouter_${response.status}`;
      await sleep(1000 * (attempt + 1) * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      const errObj = parsed.error as { message?: string } | undefined;
      throw new Error(errObj?.message || `openrouter_${response.status}`);
    }

    const choices = parsed.choices as Array<{
      finish_reason?: string;
      message?: unknown;
    }> | undefined;
    const parsedDraft = parseModelJson(
      assistantContentToText(
        (choices?.[0]?.message as { content?: unknown } | undefined)?.content,
      ),
    );
    const draftText = parsedDraft.draft_text ||
      draftFromAssistantMessage(choices?.[0]?.message);
    if (!draftText || isReasoningDump(draftText)) {
      const finish = choices?.[0]?.finish_reason || "unknown";
      throw new Error(`openrouter_empty_draft:${finish}`);
    }
    const usage = parsed.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    } | undefined;
    return {
      draftText,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      cost: usage?.cost ?? null,
    };
  }
  throw new Error(lastError);
}

async function callerAllowed(
  supabase: SupabaseClient,
  bearer: string,
  cronSecret: string,
  batchId: string,
): Promise<{ ok: boolean; kind: "cron" | "admin" | "teacher" | null; userId?: string }> {
  if (cronSecret.length >= 16 && bearer === cronSecret) {
    return { ok: true, kind: "cron" };
  }
  const { data: { user }, error } = await supabase.auth.getUser(bearer);
  if (error || !user) return { ok: false, kind: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  const role = profile?.role;
  if (role === "admin") return { ok: true, kind: "admin", userId: user.id };
  if (role !== "teacher") return { ok: false, kind: null };

  if (!batchId) {
    return { ok: true, kind: "teacher", userId: user.id };
  }
  const { data: assignment } = await supabase
    .from("batch_teachers")
    .select("batch_id")
    .eq("teacher_id", user.id)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!assignment) return { ok: false, kind: "teacher", userId: user.id };
  return { ok: true, kind: "teacher", userId: user.id };
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
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
    const model = Deno.env.get("OPENROUTER_MODEL") || "stealth/ox-alpha";
    const siteUrl = Deno.env.get("OPENROUTER_SITE_URL") ||
      Deno.env.get("APP_URL") ||
      "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";
    const appName = Deno.env.get("OPENROUTER_APP_NAME") || "AcademyOS";

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

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const source = cleanText(body.source);
    const force = body.force === true || body.force === "true";
    const regenerate = body.regenerate === true || body.regenerate === "true";
    const batchId = cleanText(body.p_batch_id);
    const studentId = cleanText(body.p_student_id);
    let month = cleanText(body.p_month);
    const limitRaw = Number(body.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 200)
      : 200;

    const supabase = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const access = await callerAllowed(supabase, bearer, cronSecret, batchId);
    if (!access.ok) {
      return jsonResponse({
        success: false,
        error: "forbidden",
        message: "Cron secret, admin JWT, or teacher JWT for this batch required",
      }, 403);
    }

    const { day, year, month: km } = karachiDateParts();
    if ((source === "cron" || access.kind === "cron") && !force && !month) {
      if (day !== 1) {
        return jsonResponse({
          success: true,
          skipped: true,
          reason: `cron only drafts the previous month on day 1 (Karachi); today is day ${day}`,
        });
      }
      month = previousYearMonth(year, km);
    }
    if (!month) {
      month = `${year}-${String(km).padStart(2, "0")}`;
    }
    if (access.kind === "teacher" && !batchId) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "p_batch_id is required for teachers",
      }, 400);
    }

    const { data: packs, error: packError } = await supabase.rpc(
      "get_remark_data_packs",
      {
        p_batch_id: batchId || null,
        p_month: month,
        p_student_id: studentId || null,
      },
    );
    if (packError) {
      return jsonResponse({
        success: false,
        error: "pack_failed",
        message: packError.message,
      }, 500);
    }

    const seenStudents = new Set<string>();
    const rows = ((packs ?? []) as DataPack[]).filter((pack) => {
      if (seenStudents.has(pack.student_id)) return false;
      seenStudents.add(pack.student_id);
      return true;
    }).slice(0, limit);
    const existingIds = rows
      .map((row) => row.existing_remark_id)
      .filter((id): id is string => Boolean(id));
    const dirtyIds = new Set<string>();
    if (existingIds.length > 0) {
      const { data: existingRows } = await supabase
        .from("remarks")
        .select("id, draft_text, final_text")
        .in("id", existingIds);
      for (const row of existingRows ?? []) {
        const blob = `${row.draft_text ?? ""}\n${row.final_text ?? ""}`;
        if (isReasoningDump(blob)) {
          dirtyIds.add(String(row.id));
        }
      }
    }
    if (!openRouterKey && rows.some((row) => !row.low_data)) {
      return jsonResponse({
        success: false,
        error: "not_configured",
        message: "OPENROUTER_API_KEY is not set",
      }, 500);
    }

    let drafted = 0;
    let lowData = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ student_id: string; message: string }> = [];

    for (const pack of rows) {
      if (
        pack.existing_status &&
        !regenerate &&
        !dirtyIds.has(pack.existing_remark_id ?? "")
      ) {
        skipped += 1;
        continue;
      }

      const language = pack.guardian_language === "ur" ? "ur" : "en";
      let status: "draft" | "low_data" = pack.low_data ? "low_data" : "draft";
      let draftText = pack.low_data
        ? (pack.low_data_reason || "Insufficient monthly data.")
        : "";
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      let totalTokens: number | null = null;
      let cost: number | null = null;
      let logStatus = "low_data";
      let errorMessage: string | null = null;

      if (!pack.low_data) {
        const { data: tones } = await supabase.rpc("get_active_remark_tone", {
          p_academy_id: pack.academy_id,
          p_language: language,
        });
        const toneRow = Array.isArray(tones) ? tones[0] as { tone_text?: string } | undefined : undefined;
        const tone = toneRow?.tone_text ||
          "Write a short parent-facing monthly progress remark. Be supportive, specific, and professional.";
        try {
          const generated = await openRouterDraft({
            apiKey: openRouterKey,
            model,
            siteUrl,
            appName,
            tone,
            language,
            pack,
          });
          draftText = generated.draftText;
          promptTokens = generated.promptTokens;
          completionTokens = generated.completionTokens;
          totalTokens = generated.totalTokens;
          cost = generated.cost;
          logStatus = "draft";
        } catch (err) {
          failed += 1;
          errorMessage = err instanceof Error ? err.message : "openrouter_failed";
          errors.push({ student_id: pack.student_id, message: errorMessage });
          await supabase.from("remark_generation_log").insert({
            academy_id: pack.academy_id,
            student_id: pack.student_id,
            period: pack.period_date,
            remark_id: pack.existing_remark_id,
            provider: "openrouter",
            model,
            status: "error",
            error_message: errorMessage,
          });
          continue;
        }
      } else {
        lowData += 1;
      }

      const upsertRow = {
        academy_id: pack.academy_id,
        student_id: pack.student_id,
        period: pack.period_date,
        draft_text: draftText,
        final_text: status === "draft" ? draftText : null,
        language,
        status,
        approved_by: null,
        approved_at: null,
      };

      const { data: saved, error: upsertError } = await supabase
        .from("remarks")
        .upsert(upsertRow, { onConflict: "student_id,period" })
        .select("id")
        .maybeSingle();

      if (upsertError) {
        failed += 1;
        errors.push({ student_id: pack.student_id, message: upsertError.message });
        continue;
      }

      await supabase.from("remark_generation_log").insert({
        academy_id: pack.academy_id,
        student_id: pack.student_id,
        period: pack.period_date,
        remark_id: saved?.id ?? pack.existing_remark_id,
        provider: "openrouter",
        model: status === "low_data" ? model : model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost,
        status: logStatus,
        error_message: errorMessage,
      });

      if (status === "draft") drafted += 1;
    }

    return jsonResponse({
      success: true,
      period: month,
      drafted,
      low_data: lowData,
      skipped,
      failed,
      errors,
    });
  } catch (err) {
    console.error("draft-remarks error:", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }
});
