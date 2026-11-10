import type { RemarkDataPack } from "./remarks";

/**
 * The model half of §9. Everything here is about one thing: getting a
 * *grounded* 2–4 sentence remark out of a model and refusing anything else.
 *
 * The parsing below looks paranoid because it is. Reasoning-style models
 * happily emit their constraint-checking monologue into `draft_text`, and a
 * teacher hitting Approve on that would send a parent a page of the model
 * talking to itself. The reference backend learned this the hard way; these
 * guards are ported from it deliberately.
 */

/** The one rule Regenerate lifts — kept separate so both variants stay in sync. */
const LOW_DATA_RULE = '- If low_data is true, return status "low_data" and do not write a normal remark.';

export const GROUNDING_RULES = `You generate monthly student progress remarks for a school system.

Rules:
- Use only the structured JSON data pack in the user message.
- Mention actual numbers when they are present (attendance percentage, test scores, batch average, trend).
- Do not invent behavior, effort, personality, health, family, discipline, or financial details.
- If tests are missing, do not mention academic performance.
- If attendance days are 0, do not mention attendance.
${LOW_DATA_RULE}
- Follow the requested language (en or ur).
- Keep the remark 2 to 4 sentences.
- Reply with one JSON object and nothing else. No markdown, no checklists, no chain of thought.
- draft_text must be only the parent-facing sentences. Never put JSON, grounding, constraint checks, or "I'll output the JSON" inside draft_text.`;

/**
 * Regenerate is a person explicitly asking for a draft, so the "flag a thin
 * month, don't write it" rule is lifted for that path only — the monthly job
 * still flags (§9). Every other grounding rule stands: the model may write
 * from less data, never from data it wasn't given.
 */
export const GROUNDING_RULES_FORCED = GROUNDING_RULES.replace(
  LOW_DATA_RULE,
  '- low_data may be true: a teacher asked for this draft anyway. Write the remark from whatever data IS present and state plainly what is missing (for example "no tests were published this month"). Never return status "low_data", and never fill the gap with anything absent from the data pack.'
);

export const DEFAULT_TONE =
  "Write a short parent-facing monthly progress remark. Be supportive, specific, and professional.";

/** Exactly the subset the model is allowed to see — nothing about fees, guardians, or other students. */
export function buildUserPayload(input: {
  dataPack: RemarkDataPack;
  studentName: string;
  batchName: string;
  period: string;
  language: "en" | "ur";
}) {
  const { dataPack: p } = input;
  return {
    language: input.language,
    student_name: input.studentName,
    batch_name: input.batchName,
    period: input.period,
    attendance: {
      total_days: p.attendance.totalDays,
      present_days: p.attendance.presentDays,
      absent_days: p.attendance.absentDays,
      late_days: p.attendance.lateDays,
      leave_days: p.attendance.leaveDays,
      attendance_pct: p.attendance.attendancePct,
    },
    // `batch_average` used to carry raw marks while `percent` carried a
    // percentage, and tests_summary printed the raw number with a % sign —
    // so the model wrote "70% (batch average 4%)" for a batch that actually
    // averaged 40%. Both units are now named and correct.
    tests: p.publishedTests.map((t) => ({
      subject: t.subject,
      date: t.date,
      obtained: t.obtained,
      max_marks: t.maxMarks,
      percent: t.pct,
      batch_average_marks: t.batchAverage,
      batch_average_percent: t.maxMarks ? Math.round((t.batchAverage / t.maxMarks) * 100) : null,
    })),
    tests_summary: p.publishedTests
      .map((t) => `${t.subject} ${t.pct}% (batch avg ${t.maxMarks ? Math.round((t.batchAverage / t.maxMarks) * 100) : 0}%)`)
      .join("; "),
    trend: {
      previous_month_avg_pct: p.previousMonthAvgPct,
      current_month_avg_pct: p.currentMonthAvgPct,
      direction: p.trend,
    },
    low_data: p.lowData,
    low_data_reason: p.lowDataReason,
  };
}

export function userPrompt(payload: unknown): string {
  return `Write one parent-facing progress remark from this data pack. Reply with JSON only: {"status":"draft","draft_text":"2-4 sentences"}. draft_text is the remark the parent will read — no reasoning, no grounding, no checklists.\n\n${JSON.stringify(payload)}`;
}

/**
 * True when the text is the model thinking out loud rather than a remark.
 * Anything matching this must never reach a teacher's queue as a draft.
 */
/**
 * A remark has to be an actual remark. Observed live: the model replied
 * `{"draft_text":"..."}` and the three dots were stored as a finished AI
 * draft, because the only test was "is the string non-empty".
 */
export function isUsableRemark(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 40) return false;
  const letters = t.replace(/[^\p{L}]/gu, "").length;
  return letters >= 25 && t.split(/\s+/).length >= 8;
}

export function isReasoningDump(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /i'll output the json/i,
    /check constraints/i,
    /mentions actual numbers/i,
    /does not mention attendance/i,
    /final check of the draft_text/i,
    /ensure i don't invent/i,
    /language en:\s*yes/i,
    /"?draft_text"?\s*:/i,
  ];
  if (patterns.some((re) => re.test(text))) return true;
  return text.length > 800 && /grounding/i.test(text);
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

/** Last-resort: pull "1. …" style sentences out of a numbered monologue. */
function extractNumberedSentences(raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]\s+/.test(l))
    .map((l) => l.replace(/^\d+[.)]\s+/, ""))
    .filter((l) => l.length > 20)
    .filter((l) => !/^(mentions|does not|language|check|grounding)/i.test(l));
  return lines.slice(0, 4).join(" ");
}

/** Grab the last `"draft_text": "..."` in the raw output that isn't a monologue. */
function extractDraftTextField(raw: string): string {
  const re = /"draft_text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  let best = "";
  while ((match = re.exec(raw)) !== null) {
    const candidate = unescapeJsonString(match[1]);
    if (candidate && !isReasoningDump(candidate)) best = candidate;
  }
  return best;
}

export interface ParsedDraft {
  status: "draft" | "low_data";
  text: string;
}

/**
 * Walks every JSON object in the response *backwards* — models often narrate
 * first and emit the real object last — and takes the first one that yields
 * usable text. Falls through progressively weaker extractors after that.
 */
export function parseDraftResponse(raw: string): ParsedDraft | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();

  const objects = cleaned.match(/\{[\s\S]*?\}/g) ?? [];
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(objects[i]) as Record<string, unknown>;
      const text = String(parsed.draft_text ?? parsed.remark ?? parsed.remark_text ?? parsed.text ?? "").trim();
      if (text && !isReasoningDump(text)) {
        const status = parsed.status === "low_data" ? "low_data" : "draft";
        return { status, text: text.replace(/\s+/g, " ") };
      }
    } catch {
      // Not valid JSON — try the next candidate object.
    }
  }

  const field = extractDraftTextField(cleaned);
  if (field) return { status: "draft", text: field };

  const numbered = extractNumberedSentences(cleaned);
  if (numbered && !isReasoningDump(numbered)) return { status: "draft", text: numbered };

  if (cleaned && !isReasoningDump(cleaned)) {
    return { status: "draft", text: cleaned.slice(0, 800).replace(/\s+/g, " ") };
  }

  return null;
}
