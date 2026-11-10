/**
 * OpenRouter client — the single place any model call goes through (§9, §10, §12).
 *
 * Rule 9: the key lives only in a Convex env var, never in the browser. Every
 * caller here runs inside a Convex *action* (queries/mutations cannot fetch).
 *
 * Nothing in this file throws. Callers get a discriminated union so an outage,
 * a missing key, or a junk response degrades to the deterministic fallback
 * path rather than failing a teacher's queue or a parent's chat.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Remark drafting (§9). Overridable so the academy can pick its own model. */
export function remarksModel(): string {
  return process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku";
}

/** Parent chatbot (§12). Kept separate from the remarks model on purpose — a
 *  reasoning model that emits chain-of-thought breaks the tool-use loop. */
export function chatModel(): string {
  return process.env.OPENROUTER_CHAT_MODEL || "anthropic/claude-3.5-haiku";
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface AiToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type AiResult =
  | { ok: true; text: string; toolCalls: AiToolCall[]; usage: AiUsage; finishReason: string }
  | { ok: false; error: string };

export type AiToolChoice = "auto" | "none" | { type: "function"; function: { name: string } };

interface CompletionInput {
  model: string;
  messages: AiMessage[];
  tools?: AiToolDef[];
  toolChoice?: AiToolChoice;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the provider for a strict JSON object back (remark drafting). */
  jsonObject?: boolean;
  /**
   * Suppress reasoning traces. A model that streams chain-of-thought into
   * `content` derails the tool loop, so the chat path asks for it off — and
   * retries without the field for providers that reject it outright.
   */
  excludeReasoning?: boolean;
}

const EMPTY_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Transient upstream failures worth a retry — matches the reference's 429/502 rule. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion(input: CompletionInput): Promise<AiResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, error: "OPENROUTER_API_KEY is not set." };

  let lastError = "Model call failed.";
  let sendReasoningField = input.excludeReasoning === true;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 40_000);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers — they identify the calling app on
          // the dashboard and are required by some model providers.
          "HTTP-Referer": process.env.SITE_URL || "http://localhost:4321",
          "X-Title": "AcademyOS",
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          ...(input.tools?.length ? { tools: input.tools, tool_choice: input.toolChoice ?? "auto" } : {}),
          ...(input.jsonObject ? { response_format: { type: "json_object" } } : {}),
          ...(sendReasoningField ? { reasoning: { exclude: true } } : {}),
          temperature: input.temperature ?? 0.3,
          max_tokens: input.maxTokens ?? 700,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        lastError = `OpenRouter ${res.status}: ${body.slice(0, 300)}`;
        // Some providers 400 on the `reasoning` field — drop it and retry once.
        if (sendReasoningField && attempt < MAX_ATTEMPTS - 1) {
          sendReasoningField = false;
          continue;
        }
        if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
          await sleep(1000 * (attempt + 1) * (attempt + 1));
          continue;
        }
        return { ok: false, error: lastError };
      }

      const json = (await res.json()) as {
        choices?: { message?: AiMessage; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        error?: { message?: string };
      };

      if (json.error) return { ok: false, error: json.error.message ?? "OpenRouter returned an error." };
      const choice = json.choices?.[0];
      if (!choice?.message) return { ok: false, error: "OpenRouter returned no message." };

      return {
        ok: true,
        text: (choice.message.content ?? "").trim(),
        toolCalls: (choice.message.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          arguments: c.function.arguments,
        })),
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
          totalTokens: json.usage?.total_tokens ?? 0,
        },
        finishReason: choice.finish_reason ?? "stop",
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      lastError = aborted ? "Model call timed out." : err instanceof Error ? err.message : "Model call failed.";
      if (!aborted && attempt < MAX_ATTEMPTS - 1) {
        await sleep(1000 * (attempt + 1) * (attempt + 1));
        continue;
      }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError };
}

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export const ZERO_USAGE = EMPTY_USAGE;
