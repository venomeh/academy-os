import { chatCompletion, aiConfigured, remarksModel } from "../lib/ai";

/**
 * §10 — the model personalises *inside* the admin-approved template. It never
 * writes a reminder from scratch.
 *
 * Rule 4 says nothing free-form is ever auto-sent, so the output is checked
 * before it can go out: it must still quote the amount, still carry the pay
 * link, stay near the template's length, and not have grown new claims. Any
 * failure and the deterministic substitution is sent instead — a family
 * always gets the correct, admin-approved message, model or no model.
 */

const SYSTEM = `You rewrite fee reminder messages for a tuition academy.

Rules:
- You are given an already-correct reminder built from an admin-approved template.
- Keep every fact exactly as given: the amount, the due date, the days overdue, the student name, and the payment link.
- Do not add new facts, offers, discounts, deadlines, threats, or policies.
- Do not change the level of firmness. A gentle reminder stays gentle; a final notice stays a final notice.
- You may only improve flow and warmth, and address the parent naturally.
- Keep it about the same length. Never longer than the original.
- Reply with the message text only. No preamble, no quotes, no markdown, no explanation.`;

export interface PersonalizeInput {
  body: string;
  language: "en" | "ur";
  amount: string;
  payUrl: string;
  bucket: string;
}

/** Guards the model's rewrite before it can reach a parent. */
export function isSafeRewrite(original: string, rewritten: string, input: PersonalizeInput): boolean {
  if (!rewritten) return false;
  const flat = rewritten.replace(/[,\s]/g, "");
  // The money and the way to pay it must survive the rewrite.
  if (input.amount && !flat.includes(input.amount.replace(/[,\s]/g, ""))) return false;
  if (input.payUrl && !rewritten.includes(input.payUrl)) return false;
  // No unbounded growth — a rewrite that balloons is inventing.
  if (rewritten.length > original.length * 1.4 + 80) return false;
  // Obvious model chatter rather than a message.
  if (/^(sure|here'?s|certainly|of course)\b/i.test(rewritten.trim())) return false;
  if (/```/.test(rewritten)) return false;
  return true;
}

/**
 * Off by default, and deliberately so. §10's personalisation list — name,
 * amount, itemisation, months owed — is exactly the set of placeholders the
 * locked template already fills per family, which is how the reference
 * backend ships it too. Handing a model a finished, compliance-facing
 * message and asking it not to change any fact is all risk and little gain,
 * and small free models fail the guards below often enough to be pure
 * latency. Set REMINDER_AI_PERSONALIZE=true with a strong model to enable.
 */
function personalizationEnabled(): boolean {
  return process.env.REMINDER_AI_PERSONALIZE === "true";
}

export async function personalizeReminder(
  input: PersonalizeInput
): Promise<{ text: string; personalized: boolean }> {
  if (!personalizationEnabled() || !aiConfigured()) return { text: input.body, personalized: false };

  const result = await chatCompletion({
    model: remarksModel(),
    temperature: 0.4,
    maxTokens: 500,
    excludeReasoning: true,
    timeoutMs: 25_000,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Language: ${input.language}. Escalation stage: ${input.bucket}.\n\nRewrite this reminder, keeping every fact identical:\n\n${input.body}`,
      },
    ],
  });

  if (!result.ok) return { text: input.body, personalized: false };
  const candidate = result.text.trim();
  if (!isSafeRewrite(input.body, candidate, input)) return { text: input.body, personalized: false };
  return { text: candidate, personalized: true };
}
