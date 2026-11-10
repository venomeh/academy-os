import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = Record<string, JsonValue>;

type ChatRole = "system" | "user" | "assistant" | "tool";

type OpenRouterMessage = {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatMessageRow = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name: string | null;
  tool_payload: JsonRecord | null;
  created_at: string;
};

type ParentContext = {
  userId: string;
  guardianId: string;
  academyId: string;
  guardianName: string;
  guardianEmail: string;
  language: "en" | "ur";
};

type SessionRow = {
  id: string;
  token_usage: number;
};

type ToolResult = {
  ok: boolean;
  data?: JsonValue;
  error?: string;
};

function jsonResponse(body: JsonRecord, status = 200): Response {
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
        const parsed = JSON.parse(secretKeys) as Record<string, string>;
        key = parsed.default;
      } catch {
        /* ignore malformed secrets JSON */
      }
    }
  }
  return key ?? null;
}

function cleanText(value: unknown, maxLength = 4000): string {
  const raw = value == null ? "" : String(value).trim();
  if (
    !raw ||
    raw === "null" ||
    raw === "undefined" ||
    /^<[A-Za-z0-9_ -]*>$/.test(raw)
  ) {
    return "";
  }
  return raw.slice(0, maxLength);
}

function optionalUuid(value: unknown): string | null {
  const text = cleanText(value, 80);
  return UUID_RE.test(text) ? text : null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toJsonRecord(value: unknown): JsonRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function parseToolArguments(raw: string): JsonRecord {
  try {
    return toJsonRecord(JSON.parse(raw || "{}"));
  } catch {
    return {};
  }
}

function karachiDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function currentMonthString(): string {
  return karachiDateString().slice(0, 7);
}

function normalizeDate(value: unknown): string | null {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function normalizeMonth(value: unknown): string {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}$/.test(text) ? text : currentMonthString();
}

function formatMoney(value: unknown): string {
  return Number(toNumber(value)).toFixed(2);
}

function looksLikeFeeQuestion(value: string): boolean {
  const lower = value.toLowerCase();
  return [
    "owe",
    "owing",
    "outstanding",
    "balance",
    "due",
    "dues",
    "fee",
    "fees",
    "voucher",
    "payment",
    "pay",
    "arrears",
    "fine",
    "amount",
    "bill",
    "invoice",
  ].some((word) => lower.includes(word));
}

function looksLikeFamilyBalanceQuestion(value: string): boolean {
  const lower = value.toLowerCase();
  return [
    "owe",
    "owing",
    "outstanding",
    "balance",
    "dues",
    "how much",
    "total amount",
    "amount due",
    "family",
  ].some((word) => lower.includes(word));
}

function formatPkrDisplay(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function familyBalanceReply(parent: ParentContext, owed: string): string {
  const display = formatPkrDisplay(owed);
  if (parent.language === "ur") {
    return `تازہ ترین فیس ریکارڈ کے مطابق آپ کی باقی رقم PKR ${display} ہے۔`;
  }
  return `According to the latest fee record, your family amount due is PKR ${display}.`;
}

function replyHasAmount(reply: string, owed: string): boolean {
  const owedDigits = owed.replace(/[^\d]/g, "");
  if (!owedDigits) return false;
  const replyDigits = reply.replace(/[^\d]/g, "");
  return replyDigits.includes(owedDigits);
}

function ledgerSignedAmount(kind: string, amount: number): number {
  if (kind === "voucher" || kind === "fine") return amount;
  if (kind === "payment" || kind === "discount") return -amount;
  return amount;
}

function trimForStorage(value: unknown): string {
  return cleanText(value, 8000);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikePlanning(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  const markers = [
    "we need to",
    "we'll need to",
    "let's list",
    "use get_",
    "call get_",
    "tool per",
    "student_id",
    "iterate through",
    "there are many children",
    "might be many",
    "chain of thought",
    "i will use the tool",
    "i'll call the",
    "function call",
    "tool_choice",
  ];
  const hitCount = markers.filter((marker) => lower.includes(marker)).length;
  if (hitCount >= 2) return true;
  if (lower.includes("get_approved_remarks") || lower.includes("get_outstanding_balance")) {
    return true;
  }
  return false;
}

function parentFacingText(value: string, parent: ParentContext): string {
  const cleaned = stripMarkdown(cleanText(value, 1200));
  if (!cleaned || looksLikePlanning(cleaned)) {
    return fallbackResponse(parent);
  }
  return cleaned;
}

async function getParentContext(
  supabase: SupabaseClient,
  bearer: string,
): Promise<{ data?: ParentContext; error?: Response }> {
  const { data: userData, error: userError } = await supabase.auth.getUser(
    bearer,
  );
  const user = userData.user;
  if (userError || !user) {
    return {
      error: jsonResponse({
        success: false,
        error: "auth_error",
        message: "Invalid parent session. Please log in again.",
      }, 401),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, academy_id, role, full_name, email, language_pref, active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      error: jsonResponse({
        success: false,
        error: "profile_not_found",
        message: "Your parent profile was not found.",
      }, 403),
    };
  }
  if (profile.role !== "parent" || profile.active === false) {
    return {
      error: jsonResponse({
        success: false,
        error: "forbidden",
        message: "Parent access required.",
      }, 403),
    };
  }

  const { data: guardian, error: guardianError } = await supabase
    .from("guardians")
    .select("id, academy_id, name, email, language_pref")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (guardianError || !guardian) {
    return {
      error: jsonResponse({
        success: false,
        error: "guardian_not_found",
        message: "No guardian record is linked to this account.",
      }, 403),
    };
  }

  const language = (guardian.language_pref || profile.language_pref) === "ur"
    ? "ur"
    : "en";

  return {
    data: {
      userId: user.id,
      guardianId: guardian.id,
      academyId: guardian.academy_id || profile.academy_id,
      guardianName: cleanText(guardian.name || profile.full_name, 120),
      guardianEmail: cleanText(guardian.email || profile.email, 200),
      language,
    },
  };
}

async function getOrCreateSession(
  supabase: SupabaseClient,
  parent: ParentContext,
  requestedSessionId: string | null,
): Promise<SessionRow> {
  if (requestedSessionId) {
    const { data } = await supabase
      .from("chat_sessions")
      .select("id, token_usage")
      .eq("id", requestedSessionId)
      .eq("guardian_id", parent.guardianId)
      .maybeSingle();
    if (data) return data as SessionRow;
  }

  const { data: latest } = await supabase
    .from("chat_sessions")
    .select("id, token_usage")
    .eq("guardian_id", parent.guardianId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) return latest as SessionRow;

  const { data: created, error } = await supabase
    .from("chat_sessions")
    .insert({ guardian_id: parent.guardianId })
    .select("id, token_usage")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "Could not create chat session");
  }
  return created as SessionRow;
}

async function createNewSession(
  supabase: SupabaseClient,
  parent: ParentContext,
): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({ guardian_id: parent.guardianId })
    .select("id, token_usage")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Could not create chat session");
  }
  return data as SessionRow;
}

async function recentMessages(
  supabase: SupabaseClient,
  sessionId: string,
  limit = 16,
): Promise<ChatMessageRow[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, tool_name, tool_payload, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChatMessageRow[]).reverse();
}

async function publicMessages(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<JsonValue[]> {
  const rows = await recentMessages(supabase, sessionId, 30);
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      role: row.role,
      content: row.role === "assistant" ? stripMarkdown(row.content) : row.content,
      created_at: row.created_at,
    }));
}

async function insertMessage(
  supabase: SupabaseClient,
  sessionId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolName?: string,
  toolPayload?: JsonRecord,
): Promise<void> {
  const { error } = await supabase.from("chat_messages").insert({
    session_id: sessionId,
    role,
    content: trimForStorage(content),
    tool_name: toolName ?? null,
    tool_payload: toolPayload ?? null,
  });
  if (error) throw new Error(error.message);
}

async function updateSession(
  supabase: SupabaseClient,
  session: SessionRow,
  tokenDelta: number,
): Promise<number> {
  const tokenUsage = Math.max(0, session.token_usage + tokenDelta);
  const { error } = await supabase
    .from("chat_sessions")
    .update({
      last_message_at: new Date().toISOString(),
      token_usage: tokenUsage,
    })
    .eq("id", session.id);
  if (error) throw new Error(error.message);
  session.token_usage = tokenUsage;
  return tokenUsage;
}

async function bumpRateLimit(
  supabase: SupabaseClient,
  parent: ParentContext,
  limit: number,
): Promise<{ used: number; remaining: number }> {
  const today = karachiDateString();
  const { data: existing, error: readError } = await supabase
    .from("chat_usage")
    .select("request_count")
    .eq("guardian_id", parent.guardianId)
    .eq("date", today)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const used = toNumber(existing?.request_count);
  if (used >= limit) {
    throw new Error(`Daily chatbot limit reached (${limit} messages).`);
  }

  const next = used + 1;
  const { error: writeError } = await supabase.from("chat_usage").upsert({
    guardian_id: parent.guardianId,
    date: today,
    request_count: next,
  }, { onConflict: "guardian_id,date" });
  if (writeError) throw new Error(writeError.message);

  return { used: next, remaining: Math.max(limit - next, 0) };
}

async function toolMyChildren(
  supabase: SupabaseClient,
  parent: ParentContext,
): Promise<ToolResult> {
  const children = await childrenForGuardian(supabase, parent);
  return {
    ok: true,
    data: {
      source: "students scoped by guardian_id",
      children: children.map((child) => ({
        student_id: String(child.id ?? ""),
        name: String(child.name ?? ""),
        grade: String(child.grade ?? ""),
        status: String(child.status ?? ""),
      })),
    },
  };
}

async function childrenForGuardian(
  supabase: SupabaseClient,
  parent: ParentContext,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from("students")
    .select("id, name, grade, status, joined_at")
    .eq("guardian_id", parent.guardianId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function requireOwnedStudent(
  supabase: SupabaseClient,
  parent: ParentContext,
  studentId: string | null,
): Promise<{ id?: string; name?: string; error?: string }> {
  const children = await childrenForGuardian(supabase, parent);
  if (!studentId) {
    if (children.length === 1) {
      const child = children[0];
      return { id: String(child.id), name: String(child.name ?? "child") };
    }
    return {
      error:
        `Please specify which child: ${children.map((c) => c.name).join(", ")}`,
    };
  }
  const child = children.find((row) => row.id === studentId);
  if (!child) {
    return { error: "That student is not linked to this parent account." };
  }
  return { id: String(child.id), name: String(child.name ?? "child") };
}

async function toolOutstandingBalance(
  supabase: SupabaseClient,
  parent: ParentContext,
): Promise<ToolResult> {
  const children = await childrenForGuardian(supabase, parent);
  const { data: vouchers, error } = await supabase
    .from("voucher_balances")
    .select("voucher_id, student_id, period, outstanding, due_date, status")
    .eq("guardian_id", parent.guardianId)
    .gt("outstanding", 0)
    .order("due_date", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const voucherRows = (vouchers ?? []) as Array<Record<string, unknown>>;
  const totalOutstanding = voucherRows.reduce(
    (sum, row) => sum + toNumber(row.outstanding),
    0,
  );

  return {
    ok: true,
    data: {
      source: "ledger outstanding from voucher_balances",
      rule:
        "Quote family_owed exactly. It already includes carry-forward. Do not add issued voucher totals, fines, or ledger lines.",
      guardian_name: parent.guardianName,
      family_owed: formatMoney(totalOutstanding),
      total_outstanding: formatMoney(totalOutstanding),
      unpaid_vouchers: voucherRows.length,
      children: children.map((child) => {
        const childVouchers = voucherRows.filter((row) =>
          row.student_id === child.id
        );
        const childOutstanding = childVouchers.reduce(
          (sum, row) => sum + toNumber(row.outstanding),
          0,
        );
        return {
          student_id: String(child.id),
          name: String(child.name ?? ""),
          grade: String(child.grade ?? ""),
          status: String(child.status ?? ""),
          outstanding: formatMoney(childOutstanding),
          vouchers: childVouchers.map((row) => ({
            voucher_id: String(row.voucher_id ?? ""),
            period: String(row.period ?? "").slice(0, 7),
            due_date: String(row.due_date ?? ""),
            outstanding: formatMoney(row.outstanding),
            status: String(row.status ?? ""),
          })),
        };
      }),
    },
  };
}

async function toolVoucherDetails(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const voucherId = optionalUuid(args.voucher_id);
  if (!voucherId) return { ok: false, error: "voucher_id is required" };

  const { data: voucher, error } = await supabase
    .from("vouchers")
    .select("id, student_id, period, line_items, tuition_amount, sibling_discount, arrears, fines, total, due_date, status")
    .eq("id", voucherId)
    .eq("guardian_id", parent.guardianId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!voucher) return { ok: false, error: "Voucher not found for this parent." };

  const { data: balance } = await supabase
    .from("voucher_balances")
    .select("total_paid, outstanding")
    .eq("voucher_id", voucherId)
    .maybeSingle();

  const { data: ledger } = await supabase
    .from("ledger_entries")
    .select("kind, amount, method, receipt_number, reason, created_at")
    .eq("voucher_id", voucherId)
    .eq("guardian_id", parent.guardianId)
    .order("created_at", { ascending: true });

  return {
    ok: true,
    data: {
      source: "ledger outstanding; issued_snapshot is not the amount due",
      voucher_id: String(voucher.id ?? ""),
      student_id: String(voucher.student_id ?? ""),
      period: String(voucher.period ?? "").slice(0, 7),
      due_date: String(voucher.due_date ?? ""),
      status: String(voucher.status ?? ""),
      line_items: voucher.line_items ?? [],
      issued_snapshot: formatMoney(voucher.total),
      amount_due: formatMoney(balance?.outstanding),
      outstanding: formatMoney(balance?.outstanding),
      total_paid: formatMoney(balance?.total_paid),
      ledger_entries: (ledger ?? []).map((row) => {
        const kind = String(row.kind ?? "");
        const amount = toNumber(row.amount);
        return {
          kind,
          amount: formatMoney(amount),
          signed_amount: formatMoney(ledgerSignedAmount(kind, amount)),
          method: String(row.method ?? ""),
          receipt_number: String(row.receipt_number ?? ""),
          reason: String(row.reason ?? ""),
          created_at: String(row.created_at ?? ""),
        };
      }),
    } as JsonRecord,
  };
}

async function toolAttendance(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const owned = await requireOwnedStudent(
    supabase,
    parent,
    optionalUuid(args.student_id),
  );
  if (owned.error || !owned.id) return { ok: false, error: owned.error };

  const month = normalizeMonth(args.month);
  const startDate = normalizeDate(args.start_date) ?? `${month}-01`;
  const endDate = normalizeDate(args.end_date);

  let query = supabase
    .from("attendance")
    .select("date, status")
    .eq("student_id", owned.id)
    .gte("date", startDate)
    .order("date", { ascending: true });
  if (endDate) {
    query = query.lte("date", endDate);
  } else {
    query = query.lt("date", nextMonthStart(month));
  }

  const { data: days, error } = await query;
  if (error) return { ok: false, error: error.message };

  const dayRows = (days ?? []) as Array<Record<string, unknown>>;
  const present = dayRows.filter((row) =>
    row.status === "present" || row.status === "late"
  ).length;
  const total = dayRows.length;
  const pct = total > 0 ? (present / total) * 100 : 0;

  return {
    ok: true,
    data: {
      source: "attendance scoped by owned student_id",
      student_id: owned.id,
      student_name: owned.name ?? "",
      range: { start_date: startDate, end_date: endDate ?? nextMonthStart(month) },
      present_or_late_days: present,
      total_days: total,
      attendance_pct: Math.round(pct * 10) / 10,
      days: dayRows.map((row) => ({
        date: String(row.date ?? ""),
        status: String(row.status ?? ""),
      })),
    },
  };
}

function nextMonthStart(month: string): string {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return next.toISOString().slice(0, 10);
}

async function toolBatchSchedule(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const owned = await requireOwnedStudent(
    supabase,
    parent,
    optionalUuid(args.student_id),
  );
  if (owned.error || !owned.id) return { ok: false, error: owned.error };

  const { data: enrollments, error } = await supabase
    .from("enrollments")
    .select("start_date, end_date, batches(id, name, grade_level, days_of_week, start_time, end_time, monthly_tuition, active)")
    .eq("student_id", owned.id)
    .lte("start_date", karachiDateString())
    .or(`end_date.is.null,end_date.gte.${karachiDateString()}`)
    .order("start_date", { ascending: false });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: {
      source: "enrollments joined to batches scoped by owned student_id",
      student_id: owned.id,
      student_name: owned.name ?? "",
      schedules: (enrollments ?? []).map((row) => ({
        start_date: String(row.start_date ?? ""),
        end_date: String(row.end_date ?? ""),
        batch: row.batches as JsonValue,
      })),
    },
  };
}

async function toolUpcomingAssessments(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const owned = await requireOwnedStudent(
    supabase,
    parent,
    optionalUuid(args.student_id),
  );
  if (owned.error || !owned.id) return { ok: false, error: owned.error };

  const { data: enrollments, error: enrollmentError } = await supabase
    .from("enrollments")
    .select("batch_id")
    .eq("student_id", owned.id)
    .lte("start_date", karachiDateString())
    .or(`end_date.is.null,end_date.gte.${karachiDateString()}`);
  if (enrollmentError) return { ok: false, error: enrollmentError.message };

  const batchIds = ((enrollments ?? []) as Array<{ batch_id: string }>)
    .map((row) => row.batch_id);
  if (batchIds.length === 0) {
    return {
      ok: true,
      data: {
        source: "enrollments scoped by owned student_id",
        student_id: owned.id,
        student_name: owned.name ?? "",
        upcoming: [],
      },
    };
  }

  const { data: assessments, error } = await supabase
    .from("assessments")
    .select("id, batch_id, subject_id, date, max_marks, published, subjects(name)")
    .in("batch_id", batchIds)
    .gte("date", karachiDateString())
    .order("date", { ascending: true })
    .limit(10);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: {
      source: "future assessments for owned student's active batches",
      student_id: owned.id,
      student_name: owned.name ?? "",
      upcoming: (assessments ?? []).map((row) => ({
        assessment_id: String(row.id ?? ""),
        date: String(row.date ?? ""),
        subject: subjectName(row.subjects),
        max_marks: formatMoney(row.max_marks),
        published: row.published === true,
      })),
    },
  };
}

function subjectName(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0] as { name?: unknown } | undefined;
    return cleanText(first?.name, 120);
  }
  if (typeof value === "object" && value !== null && "name" in value) {
    return cleanText((value as { name?: unknown }).name, 120);
  }
  return "";
}

async function toolPublishedResults(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const owned = await requireOwnedStudent(
    supabase,
    parent,
    optionalUuid(args.student_id),
  );
  if (owned.error || !owned.id) return { ok: false, error: owned.error };

  const { data, error } = await supabase
    .from("scores")
    .select("id, assessment_id, obtained, absent, assessments!inner(date, max_marks, published, subjects(name))")
    .eq("student_id", owned.id)
    .eq("assessments.published", true)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };

  const scoreRows = (data ?? []) as Array<Record<string, unknown>>;
  const results = await Promise.all(scoreRows.map(async (row) => {
    const assessmentId = String(row.assessment_id ?? "");
    const assessment = Array.isArray(row.assessments)
      ? row.assessments[0] as Record<string, unknown> | undefined
      : row.assessments as Record<string, unknown> | undefined;
    const maxMarks = toNumber(assessment?.max_marks);
    const absent = row.absent === true;
    const obtained = absent ? null : toNumber(row.obtained);
    const { data: averageRows } = await supabase
      .from("scores")
      .select("obtained")
      .eq("assessment_id", assessmentId)
      .eq("absent", false)
      .not("obtained", "is", null);
    const averageValues = ((averageRows ?? []) as Array<Record<string, unknown>>)
      .map((avgRow) => toNumber(avgRow.obtained));
    const average = averageValues.length > 0
      ? averageValues.reduce((sum, value) => sum + value, 0) / averageValues.length
      : 0;

    return {
      score_id: String(row.id ?? ""),
      assessment_date: String(assessment?.date ?? ""),
      subject: subjectName(assessment?.subjects),
      obtained: absent ? "Absent" : formatMoney(obtained),
      max_marks: formatMoney(maxMarks),
      percent: absent || maxMarks <= 0
        ? ""
        : `${Math.round((toNumber(obtained) / maxMarks) * 1000) / 10}%`,
      batch_average: averageValues.length > 0 ? formatMoney(average) : "",
    };
  }));

  return {
    ok: true,
    data: {
      source: "published assessments and scores scoped by owned student_id",
      student_id: owned.id,
      student_name: owned.name ?? "",
      results,
    },
  };
}

async function toolApprovedRemarks(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const children = await childrenForGuardian(supabase, parent);
  const requestedId = optionalUuid(args.student_id);
  const target = requestedId
    ? children.filter((child) => String(child.id) === requestedId)
    : children;

  if (requestedId && target.length === 0) {
    return { ok: false, error: "That student is not linked to this parent account." };
  }

  const studentIds = target.map((child) => String(child.id));
  if (studentIds.length === 0) {
    return {
      ok: true,
      data: {
        source: "approved remarks scoped by guardian children",
        total_count: 0,
        children: [],
      },
    };
  }

  const { data, error } = await supabase
    .from("remarks")
    .select("id, student_id, period, final_text, draft_text, language")
    .in("student_id", studentIds)
    .eq("status", "approved")
    .order("period", { ascending: false })
    .limit(40);
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const byStudent = new Map<string, typeof rows>();
  for (const row of rows) {
    const sid = String(row.student_id ?? "");
    const list = byStudent.get(sid) ?? [];
    list.push(row);
    byStudent.set(sid, list);
  }

  return {
    ok: true,
    data: {
      source: "approved remarks scoped by guardian children",
      total_count: rows.length,
      children: target.map((child) => {
        const sid = String(child.id);
        const remarks = (byStudent.get(sid) ?? []).map((row) => ({
          remark_id: String(row.id ?? ""),
          period: String(row.period ?? "").slice(0, 7),
          text: cleanText(row.final_text || row.draft_text, 800),
          language: String(row.language ?? ""),
        }));
        return {
          student_id: sid,
          student_name: String(child.name ?? ""),
          count: remarks.length,
          remarks,
        };
      }),
    },
  };
}

async function toolCreateInquiry(
  supabase: SupabaseClient,
  parent: ParentContext,
  args: JsonRecord,
): Promise<ToolResult> {
  const topic = cleanText(args.topic, 120) || "Parent inquiry";
  const message = cleanText(args.message, 2000);
  if (!message) {
    return { ok: false, error: "message is required to create an inquiry" };
  }

  const { data, error } = await supabase
    .from("inquiries")
    .insert({
      academy_id: parent.academyId,
      guardian_id: parent.guardianId,
      topic,
      message,
    })
    .select("id, status, created_at")
    .single();
  if (error || !data) return { ok: false, error: error?.message };

  await notifyAdmins(supabase, parent, topic, message, String(data.id));

  return {
    ok: true,
    data: {
      source: "inquiries insert scoped to current guardian",
      inquiry_id: String(data.id),
      status: String(data.status ?? "open"),
      created_at: String(data.created_at ?? ""),
    },
  };
}

async function notifyAdmins(
  supabase: SupabaseClient,
  parent: ParentContext,
  topic: string,
  message: string,
  inquiryId: string,
): Promise<void> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!resendApiKey) return;

  const { data: admins } = await supabase
    .from("profiles")
    .select("email")
    .eq("academy_id", parent.academyId)
    .eq("role", "admin")
    .eq("active", true);
  const emails = ((admins ?? []) as Array<{ email?: string }>)
    .map((row) => cleanText(row.email, 200))
    .filter(Boolean);
  if (emails.length === 0) return;

  const fromEmail =
    Deno.env.get("RESEND_FROM_EMAIL") || "AcademyOS <noreply@example.com>";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: emails,
      subject: `Parent inquiry: ${topic}`,
      text: [
        `Inquiry ID: ${inquiryId}`,
        `Parent: ${parent.guardianName} <${parent.guardianEmail}>`,
        `Topic: ${topic}`,
        "",
        message,
      ].join("\n"),
    }),
  });
}

async function executeTool(
  supabase: SupabaseClient,
  parent: ParentContext,
  toolName: string,
  args: JsonRecord,
): Promise<ToolResult> {
  switch (toolName) {
    case "get_outstanding_balance":
      return await toolOutstandingBalance(supabase, parent);
    case "get_voucher_details":
      return await toolVoucherDetails(supabase, parent, args);
    case "get_attendance":
      return await toolAttendance(supabase, parent, args);
    case "get_upcoming_assessments":
      return await toolUpcomingAssessments(supabase, parent, args);
    case "get_batch_schedule":
      return await toolBatchSchedule(supabase, parent, args);
    case "get_published_results":
      return await toolPublishedResults(supabase, parent, args);
    case "get_approved_remarks":
      return await toolApprovedRemarks(supabase, parent, args);
    case "get_my_children":
      return await toolMyChildren(supabase, parent);
    case "create_inquiry":
      return await toolCreateInquiry(supabase, parent, args);
    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_outstanding_balance",
      description:
        "Get the family's current amount owed. family_owed / total_outstanding is the only number to quote to the parent. It is ledger-based and already includes carry-forward, so do not add issued voucher totals or ledger lines.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_voucher_details",
      description:
        "Get one voucher's itemized snapshot and the amount still due. Quote outstanding / amount_due, never issued_snapshot, as the money the parent still owes on that voucher.",
      parameters: {
        type: "object",
        properties: {
          voucher_id: { type: "string", description: "Voucher UUID" },
        },
        required: ["voucher_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attendance",
      description:
        "Get attendance days and percentage for an owned child. Use month as YYYY-MM unless the parent asks for a specific date range.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description:
              "Student UUID from prior tool data; omit only if the parent has one child.",
          },
          month: { type: "string", description: "Month in YYYY-MM format" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_assessments",
      description:
        "Get future assessments for the active batches of an owned child.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description:
              "Student UUID from prior tool data; omit only if the parent has one child.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_batch_schedule",
      description:
        "Get batch timing, days, and active enrollment schedule for an owned child.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description:
              "Student UUID from prior tool data; omit only if the parent has one child.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_published_results",
      description:
        "Get published assessment results and batch averages for an owned child. Unpublished tests are never returned.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description:
              "Student UUID from prior tool data; omit only if the parent has one child.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_approved_remarks",
      description:
        "Get teacher-approved monthly progress remarks. Omit student_id to return counts and remarks for every linked child. Draft or rejected remarks are never returned.",
      parameters: {
        type: "object",
        properties: {
          student_id: {
            type: "string",
            description:
              "Optional student UUID. Omit to include all children linked to this parent.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_children",
      description:
        "List this parent's linked children with student_id, name, grade, and status. Call this first when a question is about more than one child or you need student IDs.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_inquiry",
      description:
        "Create an admin inquiry for requests outside chatbot scope, complaints, fee-waiver questions, corrections, or anything needing human follow-up.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          message: { type: "string" },
        },
        required: ["topic", "message"],
        additionalProperties: false,
      },
    },
  },
] as const;

function systemPrompt(parent: ParentContext): string {
  const languageInstruction = parent.language === "ur"
    ? "Reply in simple Urdu written in Urdu script unless the parent writes in English."
    : "Reply in clear, simple English unless the parent writes in Urdu.";

  return [
    "You are AcademyOS Parent Assistant in a small mobile chat widget.",
    "Answer only questions about this parent's own children, fees, attendance, published results, approved remarks, and batch schedule.",
    "Use tools for facts. Never invent balances, attendance, marks, dates, or remarks.",
    "For any fee, due, outstanding, or 'how much do I owe' question, call get_outstanding_balance and quote family_owed from that latest result only.",
    "Previous chat answers can be stale. Never reuse an older PKR total from this conversation.",
    "Do not add issued voucher totals, fines, or unsigned ledger amounts. Carry-forward adjustments are already applied in family_owed.",
    "Return ONLY the parent-facing answer. Never describe your plan, search, or tool use. Never mention tool names, student_id, function calls, or internal steps.",
    "Do not write chain-of-thought, scratchpad, or 'we need to' reasoning. If you need data, call a tool silently, then answer.",
    "Plain text only. No markdown, no asterisks, no bullet symbols unless a short list is required.",
    "Keep answers to 1-4 short sentences. Mention the source briefly, e.g. 'According to the latest fee record'.",
    "If the parent asks for fee waivers, complaints, corrections, refunds, another family's data, or anything outside the tools, create an inquiry and tell them an admin will follow up.",
    "Never expose internal IDs unless the parent specifically needs a voucher reference.",
    languageInstruction,
    `Current parent: ${parent.guardianName}.`,
  ].join("\n");
}

function messagesForModel(
  parent: ParentContext,
  history: ChatMessageRow[],
  userMessage: string,
): OpenRouterMessage[] {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt(parent) },
  ];
  const feeQuestion = looksLikeFeeQuestion(userMessage);
  for (const row of history) {
    if (row.role === "user") {
      messages.push({ role: "user", content: row.content });
      continue;
    }
    if (row.role === "assistant") {
      const content = stripMarkdown(row.content);
      if (!content || looksLikePlanning(content)) continue;
      if (feeQuestion) continue;
      messages.push({ role: "assistant", content });
    }
  }
  messages.push({ role: "user", content: userMessage });
  return messages;
}

async function openRouterChat(opts: {
  apiKey: string;
  model: string;
  siteUrl: string;
  appName: string;
  messages: OpenRouterMessage[];
  finalAnswer?: boolean;
  forceTool?: string;
}): Promise<{
  content: string;
  toolCalls: ToolCall[];
  totalTokens: number;
}> {
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": opts.siteUrl,
    "X-Title": opts.appName,
  };
  const payload: JsonRecord = {
    model: opts.model,
    messages: opts.messages as unknown as JsonValue,
    temperature: 0.2,
    max_tokens: opts.finalAnswer ? 280 : 700,
    reasoning: { exclude: true },
  };
  if (!opts.finalAnswer) {
    payload.tools = tools as unknown as JsonValue;
    payload.tool_choice = opts.forceTool
      ? { type: "function", function: { name: opts.forceTool } }
      : "auto";
  } else {
    payload.tool_choice = "none";
  }

  let response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    delete payload.reasoning;
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text.slice(0, 300)}`);
  }

  const json = toJsonRecord(await response.json());
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = toJsonRecord(toJsonRecord(choices[0]).message);
  const toolCalls = Array.isArray(first.tool_calls)
    ? first.tool_calls as ToolCall[]
    : [];
  const usage = toJsonRecord(json.usage);

  return {
    content: cleanText(first.content, 4000),
    toolCalls,
    totalTokens: Math.trunc(toNumber(usage.total_tokens)),
  };
}

function fallbackResponse(parent: ParentContext): string {
  if (parent.language === "ur") {
    return "میں ابھی یہ معلومات نہیں نکال سکا۔ براہ کرم دوبارہ کوشش کریں، یا اپنا سوال تھوڑا واضح لکھ دیں۔";
  }
  return "I could not retrieve that information just now. Please try again or ask the question a little more specifically.";
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
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
    const model = Deno.env.get("OPENROUTER_CHAT_MODEL") || "openai/gpt-4o-mini";
    const siteUrl = Deno.env.get("OPENROUTER_SITE_URL") ||
      Deno.env.get("APP_URL") ||
      "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";
    const appName = Deno.env.get("OPENROUTER_APP_NAME") || "AcademyOS";
    const dailyLimitRaw = Number(Deno.env.get("CHAT_DAILY_LIMIT") ?? "30");
    const dailyLimit = Number.isFinite(dailyLimitRaw) && dailyLimitRaw > 0
      ? Math.min(Math.trunc(dailyLimitRaw), 100)
      : 30;

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
    const parentResult = await getParentContext(supabase, bearer);
    if (parentResult.error) return parentResult.error;
    const parent = parentResult.data;
    if (!parent) {
      return jsonResponse({
        success: false,
        error: "forbidden",
        message: "Parent access required.",
      }, 403);
    }

    let body: JsonRecord = {};
    try {
      body = toJsonRecord(await req.json());
    } catch {
      body = {};
    }

    const mode = cleanText(body.mode, 20) || "send";
    const sessionId = optionalUuid(body.session_id);

    if (mode === "new") {
      const session = await createNewSession(supabase, parent);
      return jsonResponse({
        success: true,
        error: "",
        message: "OK",
        mode,
        session_id: session.id,
        messages: [],
        token_usage: session.token_usage,
        daily_limit: dailyLimit,
      });
    }

    const session = await getOrCreateSession(supabase, parent, sessionId);

    if (mode === "history") {
      return jsonResponse({
        success: true,
        error: "",
        message: "OK",
        mode,
        session_id: session.id,
        messages: await publicMessages(supabase, session.id),
        token_usage: session.token_usage,
        daily_limit: dailyLimit,
      });
    }

    const userMessage = cleanText(body.message, 2000);
    if (!userMessage) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "Type a question first.",
        session_id: session.id,
      });
    }
    if (!openRouterKey) {
      return jsonResponse({
        success: false,
        error: "not_configured",
        message: "The chatbot is not configured yet.",
        session_id: session.id,
      });
    }

    let usage;
    try {
      usage = await bumpRateLimit(supabase, parent, dailyLimit);
    } catch (err) {
      return jsonResponse({
        success: false,
        error: "rate_limited",
        message: err instanceof Error ? err.message : "Daily chatbot limit reached.",
        session_id: session.id,
        daily_limit: dailyLimit,
      });
    }

    const history = await recentMessages(supabase, session.id, 14);
    await insertMessage(supabase, session.id, "user", userMessage);

    const modelMessages = messagesForModel(parent, history, userMessage);
    let totalTokens = 0;
    const toolsUsed: string[] = [];
    let reply = "";
    let latestFamilyOwed: string | null = null;
    const forceOutstanding = looksLikeFeeQuestion(userMessage);

    for (let i = 0; i < 6; i += 1) {
      const completion = await openRouterChat({
        apiKey: openRouterKey,
        model,
        siteUrl,
        appName,
        messages: modelMessages,
        forceTool: forceOutstanding && i === 0 && !toolsUsed.includes("get_outstanding_balance")
          ? "get_outstanding_balance"
          : undefined,
      });
      totalTokens += completion.totalTokens;

      if (completion.toolCalls.length === 0) {
        const candidate = stripMarkdown(completion.content);
        if (!looksLikePlanning(candidate)) {
          reply = parentFacingText(candidate, parent);
          break;
        }
        if (i < 5) {
          modelMessages.push({
            role: "user",
            content:
              "Do not narrate your plan. Call the needed tools silently, then answer the parent in 1-4 short sentences.",
          });
          continue;
        }
        const finalCompletion = await openRouterChat({
          apiKey: openRouterKey,
          model,
          siteUrl,
          appName,
          messages: modelMessages,
          finalAnswer: true,
        });
        totalTokens += finalCompletion.totalTokens;
        reply = parentFacingText(finalCompletion.content, parent);
        break;
      }

      modelMessages.push({
        role: "assistant",
        content: null,
        tool_calls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        const args = parseToolArguments(call.function.arguments);
        const result = await executeTool(
          supabase,
          parent,
          call.function.name,
          args,
        );
        const resultJson = JSON.stringify(result);
        toolsUsed.push(call.function.name);
        if (call.function.name === "get_outstanding_balance" && result.ok) {
          const data = toJsonRecord(result.data);
          const owed = cleanText(data.family_owed ?? data.total_outstanding, 40);
          if (owed) latestFamilyOwed = owed;
        }
        await insertMessage(
          supabase,
          session.id,
          "tool",
          resultJson,
          call.function.name,
          { arguments: args, result },
        );
        modelMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultJson,
        });
      }
    }

    if (!reply) reply = fallbackResponse(parent);
    if (looksLikeFamilyBalanceQuestion(userMessage) && !latestFamilyOwed) {
      const forced = await toolOutstandingBalance(supabase, parent);
      if (forced.ok) {
        const data = toJsonRecord(forced.data);
        const owed = cleanText(data.family_owed ?? data.total_outstanding, 40);
        if (owed) latestFamilyOwed = owed;
      }
    }
    if (
      looksLikeFamilyBalanceQuestion(userMessage) &&
      latestFamilyOwed &&
      !replyHasAmount(reply, latestFamilyOwed)
    ) {
      reply = familyBalanceReply(parent, latestFamilyOwed);
    }
    await insertMessage(supabase, session.id, "assistant", reply);
    const tokenUsage = await updateSession(supabase, session, totalTokens);

    return jsonResponse({
      success: true,
      error: "",
      message: "OK",
      mode,
      session_id: session.id,
      reply,
      messages: await publicMessages(supabase, session.id),
      tools_used: toolsUsed,
      token_usage: tokenUsage,
      tokens_used: totalTokens,
      daily_requests_used: usage.used,
      daily_requests_remaining: usage.remaining,
      daily_limit: dailyLimit,
    });
  } catch (err) {
    console.error("chatbot error:", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: err instanceof Error ? err.message : "Unknown chatbot error",
    }, 500);
  }
});
