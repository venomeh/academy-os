import type { AiToolDef } from "../lib/ai";

/**
 * Prompt, tool schemas and output guards for the agentic parent chatbot (§12).
 *
 * The identity rule is structural, not textual: no tool here accepts a
 * guardian id, and every student-scoped tool re-checks ownership server-side
 * against the caller's verified session. The model cannot ask for another
 * family's data because there is no argument that would express it.
 */

const STUDENT_ID_DESC = "Student UUID from prior tool data; omit only if the parent has one child.";

export function systemPrompt(guardianName: string, language: "en" | "ur"): string {
  const languageInstruction =
    language === "ur"
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
    `Current parent: ${guardianName}.`,
  ].join("\n");
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_DEFS: AiToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_my_children",
      description: "List this parent's enrolled children with their student IDs. Call this first when a question is about more than one child or you need student IDs.",
      parameters: obj({}),
    },
  },
  {
    type: "function",
    function: {
      name: "get_outstanding_balance",
      description:
        "Current amount this family owes. family_owed is the only number to quote; it is ledger-based and already includes carry-forward, so do not add issued voucher totals or ledger lines.",
      parameters: obj({}),
    },
  },
  {
    type: "function",
    function: {
      name: "get_voucher_details",
      description: "Itemised breakdown of one fee voucher. Quote outstanding, never the issued snapshot total.",
      parameters: obj({ voucher_id: { type: "string", description: "Voucher ID from prior tool data." } }, ["voucher_id"]),
    },
  },
  {
    type: "function",
    function: {
      name: "get_attendance",
      description: "Attendance summary for one child for a month.",
      parameters: obj({
        student_id: { type: "string", description: STUDENT_ID_DESC },
        month: { type: "string", description: "Month as YYYY-MM. Defaults to the current month." },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_assessments",
      description: "Future assessments for one child's active batches.",
      parameters: obj({ student_id: { type: "string", description: STUDENT_ID_DESC } }),
    },
  },
  {
    type: "function",
    function: {
      name: "get_batch_schedule",
      description: "Batch days, timing and teacher for one child's active enrolments.",
      parameters: obj({ student_id: { type: "string", description: STUDENT_ID_DESC } }),
    },
  },
  {
    type: "function",
    function: {
      name: "get_published_results",
      description: "Published test results for one child with batch averages. Unpublished tests are never returned.",
      parameters: obj({ student_id: { type: "string", description: STUDENT_ID_DESC } }),
    },
  },
  {
    type: "function",
    function: {
      name: "get_approved_remarks",
      description: "Teacher-approved monthly progress remarks. Omit student_id for all children. Draft or rejected remarks are never returned.",
      parameters: obj({ student_id: { type: "string", description: STUDENT_ID_DESC } }),
    },
  },
  {
    type: "function",
    function: {
      name: "create_inquiry",
      description: "Escalate anything outside the other tools — fee waivers, complaints, corrections, refunds — to an admin.",
      parameters: obj(
        {
          topic: { type: "string", description: "Short subject line, e.g. 'Fee waiver'." },
          message: { type: "string", description: "The parent's request in their own words." },
        },
        ["topic", "message"]
      ),
    },
  },
];

/** Models like to answer in markdown even when told not to; the widget renders plain text. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Some models write a *pretend* tool call — or a fabricated tool result —
 * into `content` instead of using the tool-call API, then append the real
 * answer after it. Observed live: `{"tool": "get_outstanding_balance",
 * "arguments": {}} {"familyOwed": 2500} According to the latest fee record…`
 * — with an invented figure. Keep the prose, drop the scaffolding; the
 * money rail in convex/chatbot.ts then re-checks the number that survives.
 */
export function stripToolScaffolding(text: string): string {
  let out = text;
  // One pass can leave a second fragment behind (the fake call *and* a fake
  // result), so peel until the text stops changing — bounded, never looping.
  for (let i = 0; i < 3; i++) {
    const next = peelScaffolding(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function peelScaffolding(text: string): string {
  if (!text || !text.includes(":")) return text;
  const looksScaffolded =
    /["']?(?:tool|tool_call|tool_name|function|arguments|parameters)["']?\s*:/i.test(text) ||
    /["']?(?:family_?owed|total_?outstanding|outstanding|total|student_?id|voucher_?id)["']?\s*:\s*["\d]/i.test(text);
  if (!looksScaffolded) return text;

  // Prefer whatever prose follows the last closing brace — but only if there
  // actually is one, or lastIndexOf's -1 hands back the whole string.
  const brace = text.lastIndexOf("}");
  if (brace >= 0) {
    const afterBrace = text.slice(brace + 1).trim();
    if (afterBrace.length >= 20) return afterBrace;
  }

  // Truncated scaffolding never closes its braces — cut after the last
  // `key: value` pair instead.
  const pairs = [...text.matchAll(/["']?[a-z_]+["']?\s*:\s*(?:"[^"]*"|-?[\d.]+|true|false|null|\{\s*\}|\[\s*\])/gi)];
  const last = pairs[pairs.length - 1];
  if (last?.index !== undefined) {
    const rest = text.slice(last.index + last[0].length).replace(/^[\s,{}[\]"']+/, "").trim();
    if (rest.length >= 20) return rest;
  }
  return text;
}

/**
 * A reply has to actually be a sentence. Observed live: this model can burn
 * its whole token budget on excluded reasoning and emit `"{ {"` as content
 * — which passed every guard below and was shown to the parent as an answer.
 */
export function isUsableReply(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;
  const letters = trimmed.replace(/[^\p{L}]/gu, "").length;
  return letters >= 8 && letters / trimmed.length > 0.5;
}

/** The model narrating its plan instead of answering — never show this to a parent. */
export function looksLikePlanning(text: string): boolean {
  if (!text) return true;
  return [
    /\bwe need to\b/i,
    /\bi (?:will|'ll|should|need to) (?:call|check|use|look)/i,
    /\blet me (?:call|check|look)/i,
    /\bcalling the\b.*\btool\b/i,
    /\btool call\b/i,
    /\bstudent_id\b/i,
    /\bget_[a-z_]+\(/i,
    // Scaffolding that survived stripToolScaffolding — the whole reply is
    // machinery, with no answer after it.
    /["']?(?:tool|arguments|parameters)["']?\s*:\s*["{[]/i,
    /^(?:plan|step \d|first,? i)/i,
  ].some((re) => re.test(text));
}

export function looksLikeFeeQuestion(text: string): boolean {
  return /\b(fee|fees|due|dues|owe|owed|outstanding|balance|bill|voucher|payment|pay)\b/i.test(text) ||
    /(بقایا|فیس|واجب|ادائیگی)/.test(text);
}

/** Deterministic answer used when the model's fee reply doesn't quote the real number. */
export function familyBalanceReply(amount: number, language: "en" | "ur"): string {
  if (amount <= 0) {
    return language === "ur"
      ? "آپ کے خاندان کا کوئی بقایا نہیں ہے۔ شکریہ۔"
      : "According to the latest fee record, your family has nothing outstanding right now.";
  }
  return language === "ur"
    ? `تازہ ترین فیس ریکارڈ کے مطابق آپ کے خاندان پر PKR ${amount.toLocaleString()} واجب الادا ہیں۔`
    : `According to the latest fee record, your family currently owes PKR ${amount.toLocaleString()}.`;
}

export function fallbackResponse(language: "en" | "ur"): string {
  return language === "ur"
    ? "معذرت، میں ابھی یہ معلومات حاصل نہیں کر سکا۔ براہ کرم دوبارہ کوشش کریں یا فرنٹ ڈیسک سے رابطہ کریں۔"
    : "I could not retrieve that information just now. Please try again, or contact the front desk.";
}

export function rateLimitMessage(limit: number, language: "en" | "ur"): string {
  return language === "ur"
    ? `آج کے لیے چیٹ کی حد (${limit} پیغامات) پوری ہو گئی ہے۔ براہ کرم کل دوبارہ کوشش کریں۔`
    : `You've reached today's chat limit (${limit} messages). Please try again tomorrow.`;
}

export function notConfiguredMessage(language: "en" | "ur"): string {
  return language === "ur"
    ? "چیٹ بوٹ ابھی ترتیب نہیں دیا گیا۔ براہ کرم فرنٹ ڈیسک سے رابطہ کریں۔"
    : "The assistant isn't configured yet. Please contact the front desk.";
}

/**
 * Not every model on OpenRouter returns real `tool_calls` — the free
 * Nemotron this deployment uses writes the call into `content` as JSON
 * instead, which meant no tool ever executed and every answer was the
 * model's own guess. This recovers the intended call from that text so the
 * loop can run it for real; the name is validated against TOOL_DEFS, so a
 * hallucinated tool name is ignored rather than executed.
 */
const TOOL_NAMES: string[] = TOOL_DEFS.map((t) => t.function.name);

export function parseEmulatedToolCall(text: string): { name: string; arguments: string } | null {
  if (!text || !text.includes(":")) return null;
  const nameMatch = text.match(/["']?(?:tool|tool_name|name|function)["']?\s*:\s*["']([a-z0-9_]+)["']/i);
  if (!nameMatch) return null;
  const raw = nameMatch[1].toLowerCase();
  // Models drop the underscores as often as not ("getoutstandingbalance").
  const name = TOOL_NAMES.find((n) => n === raw) ?? TOOL_NAMES.find((n) => n.replace(/_/g, "") === raw.replace(/_/g, ""));
  if (!name) return null;

  let args = "{}";
  const argsMatch = text.match(/["']?(?:arguments|parameters|args|input)["']?\s*:\s*(\{[\s\S]*?\})/i);
  if (argsMatch) {
    try {
      args = JSON.stringify(JSON.parse(argsMatch[1]));
    } catch {
      args = "{}";
    }
  }
  return { name, arguments: args };
}

export const CORRECTIVE_TURN =
  "Do not narrate your plan. Call the needed tools silently, then answer the parent in 1-4 short sentences.";

export function dailyLimit(): number {
  const raw = Number(process.env.CHAT_DAILY_LIMIT ?? 30);
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.trunc(raw), 100);
}
