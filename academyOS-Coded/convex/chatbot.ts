import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireGuardian, pktToday } from "./lib/authz";
import * as tools from "./model/chatbot";
import { sendEmail, emailShell } from "./model/email";
import { aiConfigured, addUsage, chatCompletion, chatModel, ZERO_USAGE, type AiMessage } from "./lib/ai";
import {
  CORRECTIVE_TURN,
  TOOL_DEFS,
  dailyLimit,
  fallbackResponse,
  familyBalanceReply,
  isUsableReply,
  looksLikeFeeQuestion,
  looksLikePlanning,
  notConfiguredMessage,
  parseEmulatedToolCall,
  rateLimitMessage,
  stripMarkdown,
  stripToolScaffolding,
  systemPrompt,
} from "./model/chatbotAi";

/**
 * §12 — agentic parent chatbot: a real server-side tool-use loop. The model
 * never receives a guardian id and no tool accepts one; identity comes from
 * the verified session and every student-scoped tool re-checks ownership, so
 * another family's data is unreachable by construction (Rule 6).
 */

const SESSION_GAP_MS = 60 * 60 * 1000; // reuse the last session if active within the past hour, else start a fresh one
const MAX_TURNS = 6;

export const listSessionMessages = query({
  args: {},
  handler: async (ctx) => {
    const { guardian } = await requireGuardian(ctx);
    const session = await ctx.db
      .query("chatSessions")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardian._id))
      .order("desc")
      .first();
    // §12 "per-session token usage displayed": the widget reads these
    // reactively, so they tick up the moment a reply lands.
    const usageRow = await ctx.db
      .query("chatUsage")
      .withIndex("by_guardian_and_date", (q) => q.eq("guardianId", guardian._id).eq("date", pktToday()))
      .unique();
    const usage = { tokenUsage: session?.tokenUsage ?? 0, dailyUsed: usageRow?.requestCount ?? 0, dailyLimit: dailyLimit() };
    if (!session) return { sessionId: null, messages: [], ...usage };
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    return { sessionId: session._id, messages: messages.map((m) => ({ id: m._id, role: m.role, content: m.content, toolName: m.toolName ?? null })), ...usage };
  },
});

// -- internal plumbing actions call through (actions can't touch ctx.db) --

export const requireGuardianQuery = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      return await requireGuardian(ctx);
    } catch {
      return null;
    }
  },
});

export const getOrCreateSession = internalMutation({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }) => {
    const latest = await ctx.db
      .query("chatSessions")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
      .order("desc")
      .first();
    const now = Date.now();
    if (latest && now - latest.lastMessageAt < SESSION_GAP_MS) return latest._id;
    return ctx.db.insert("chatSessions", { guardianId, startedAt: now, lastMessageAt: now, tokenUsage: 0 });
  },
});

export const checkAndBumpUsage = internalMutation({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }) => {
    const today = pktToday();
    const existing = await ctx.db
      .query("chatUsage")
      .withIndex("by_guardian_and_date", (q) => q.eq("guardianId", guardianId).eq("date", today))
      .unique();
    const count = existing?.requestCount ?? 0;
    if (count >= dailyLimit()) return { allowed: false, remaining: 0 };
    if (existing) await ctx.db.patch(existing._id, { requestCount: count + 1 });
    else await ctx.db.insert("chatUsage", { guardianId, date: today, requestCount: 1 });
    return { allowed: true, remaining: dailyLimit() - count - 1 };
  },
});

export const appendMessage = internalMutation({
  args: {
    sessionId: v.id("chatSessions"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolPayload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("chatMessages", args);
    await ctx.db.patch(args.sessionId, { lastMessageAt: Date.now() });
  },
});

export const bumpTokenUsage = internalMutation({
  args: { sessionId: v.id("chatSessions"), delta: v.number() },
  handler: async (ctx, { sessionId, delta }) => {
    const session = await ctx.db.get(sessionId);
    if (session) await ctx.db.patch(sessionId, { tokenUsage: session.tokenUsage + delta });
  },
});

/**
 * Read-only tool dispatch. Every student-scoped tool re-resolves ownership
 * from the caller's own guardian record, so a student id the model invented
 * or copied from anywhere else simply doesn't resolve (§12, Rule 6).
 */
export const executeReadTool = internalQuery({
  args: { guardianId: v.id("guardians"), name: v.string(), args: v.any() },
  handler: async (ctx, { guardianId, name, args }): Promise<unknown> => {
    const raw = (args ?? {}) as Record<string, unknown>;

    /** Resolve which child the model means: explicit id, or the only child. */
    async function student(): Promise<{ id: Id<"students"> } | { error: string }> {
      const children = await tools.getMyChildren(ctx, guardianId);
      const given = typeof raw.student_id === "string" ? raw.student_id : null;
      if (given) {
        const match = children.find((c) => c.studentId === given);
        if (!match) return { error: "That student is not linked to this parent account." };
        return { id: match.studentId };
      }
      if (children.length === 1) return { id: children[0].studentId };
      if (children.length === 0) return { error: "No children are enrolled under this account." };
      return { error: `Please specify which child: ${children.map((c) => c.name).join(", ")}` };
    }

    switch (name) {
      case "get_my_children":
        return tools.getMyChildren(ctx, guardianId);
      case "get_outstanding_balance":
        return tools.getOutstandingBalance(ctx, guardianId);
      case "get_voucher_details": {
        const id = typeof raw.voucher_id === "string" ? raw.voucher_id : "";
        if (!id) return { error: "voucher_id is required." };
        try {
          return await tools.getVoucherDetails(ctx, guardianId, id as Id<"vouchers">);
        } catch {
          return { error: "That voucher is not linked to this parent account." };
        }
      }
      case "get_attendance": {
        const s = await student();
        if ("error" in s) return s;
        const month = typeof raw.month === "string" ? raw.month : undefined;
        return tools.getAttendance(ctx, guardianId, s.id, month);
      }
      case "get_upcoming_assessments": {
        const s = await student();
        if ("error" in s) return s;
        return tools.getUpcomingAssessments(ctx, guardianId, s.id);
      }
      case "get_batch_schedule": {
        const s = await student();
        if ("error" in s) return s;
        return tools.getBatchSchedule(ctx, guardianId, s.id);
      }
      case "get_published_results": {
        const s = await student();
        if ("error" in s) return s;
        return tools.getPublishedResults(ctx, guardianId, s.id);
      }
      case "get_approved_remarks": {
        if (typeof raw.student_id !== "string") {
          const children = await tools.getMyChildren(ctx, guardianId);
          return Promise.all(children.map((c) => tools.getApprovedRemarks(ctx, guardianId, c.studentId)));
        }
        const s = await student();
        if ("error" in s) return s;
        return tools.getApprovedRemarks(ctx, guardianId, s.id);
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  },
});

export const fileInquiry = internalMutation({
  args: { guardianId: v.id("guardians"), topic: v.string(), message: v.string() },
  handler: async (ctx, { guardianId, topic, message }) => tools.createInquiry(ctx, guardianId, topic, message),
});

/** Recent turns for context. Assistant turns are dropped for fee questions so a stale PKR total can never be re-quoted. */
export const recentHistory = internalQuery({
  args: { sessionId: v.id("chatSessions"), userOnly: v.boolean() },
  handler: async (ctx, { sessionId, userOnly }) => {
    const all = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return all
      .filter((m) => (userOnly ? m.role === "user" : m.role !== "tool"))
      .slice(-10)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  },
});

interface ChatOk {
  ok: true;
  reply: string;
  tools: string[];
  tokensUsed: number;
  sessionTokens: number;
  dailyUsed: number;
  dailyRemaining: number;
  dailyLimit: number;
}

export const sendMessage = action({
  args: { text: v.string() },
  handler: async (ctx, { text }): Promise<ChatOk | { ok: false; error: string }> => {
    const resolved = await ctx.runQuery(internal.chatbot.requireGuardianQuery, {});
    if (!resolved) return { ok: false, error: "Not signed in as a parent." };
    const { guardian } = resolved;
    const language = guardian.languagePref;
    const limit = dailyLimit();

    if (!aiConfigured()) return { ok: false, error: notConfiguredMessage(language) };

    const usage = await ctx.runMutation(internal.chatbot.checkAndBumpUsage, { guardianId: guardian._id });
    if (!usage.allowed) return { ok: false, error: rateLimitMessage(limit, language) };

    const sessionId = await ctx.runMutation(internal.chatbot.getOrCreateSession, { guardianId: guardian._id });
    const feeQuestion = looksLikeFeeQuestion(text);
    const history = await ctx.runQuery(internal.chatbot.recentHistory, { sessionId, userOnly: feeQuestion });
    await ctx.runMutation(internal.chatbot.appendMessage, { sessionId, role: "user", content: text });

    const messages: AiMessage[] = [
      { role: "system", content: systemPrompt(guardian.name, language) },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: text },
    ];

    const model = chatModel();
    const fired: string[] = [];
    let usageTotal = ZERO_USAGE;
    let reply = "";
    let familyOwed: number | null = null;

    for (let i = 0; i < MAX_TURNS; i++) {
      const forceBalance = i === 0 && feeQuestion;
      const result = await chatCompletion({
        model,
        messages,
        tools: TOOL_DEFS,
        toolChoice: forceBalance ? { type: "function", function: { name: "get_outstanding_balance" } } : "auto",
        temperature: 0.2,
        // Generous: reasoning-style models spend most of the budget on
        // thinking that `excludeReasoning` strips, and a tight cap leaves
        // the visible answer truncated to a fragment.
        maxTokens: 1400,
        excludeReasoning: true,
      });
      if (!result.ok) break;
      usageTotal = addUsage(usageTotal, result.usage);

      // A model that emulates tool calls in prose still gets its tool run —
      // otherwise nothing is ever grounded. See parseEmulatedToolCall.
      const emulated = result.toolCalls.length === 0 ? parseEmulatedToolCall(result.text) : null;
      const calls = result.toolCalls.length > 0 ? result.toolCalls : emulated ? [{ id: `emulated_${i}`, name: emulated.name, arguments: emulated.arguments }] : [];

      if (calls.length > 0) {
        if (!emulated) {
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })),
          });
        }
        for (const call of calls) {
          let parsedArgs: unknown = {};
          try {
            parsedArgs = JSON.parse(call.arguments || "{}");
          } catch {
            parsedArgs = {};
          }
          let payload: unknown;
          if (call.name === "create_inquiry") {
            const a = parsedArgs as { topic?: string; message?: string };
            const filed = await ctx.runMutation(internal.chatbot.fileInquiry, {
              guardianId: guardian._id,
              topic: (a.topic ?? "Parent inquiry").slice(0, 120),
              message: (a.message ?? text).slice(0, 2000),
            });
            // The email lives here, in the action — a mutation cannot fetch.
            if (filed.adminEmails.length > 0) {
              await sendEmail({
                to: filed.adminEmails,
                subject: `Parent inquiry: ${a.topic ?? "Parent inquiry"}`,
                html: emailShell(
                  `<p style="font-size:15px;line-height:1.6;"><strong>${filed.guardianName}</strong> asked via the parent chatbot:</p>` +
                    `<p style="font-size:15px;line-height:1.6;padding:12px 16px;background:#FAF9F6;border-radius:8px;">${a.message ?? text}</p>` +
                    `<p style="font-size:13px;color:#6B6660;">Topic: ${a.topic ?? "Parent inquiry"}</p>`
                ),
                text: `${filed.guardianName} asked (${a.topic ?? "Parent inquiry"}): ${a.message ?? text}`,
              });
            }
            payload = { inquiry_id: filed.inquiryId, status: "open" };
          } else {
            payload = await ctx.runQuery(internal.chatbot.executeReadTool, {
              guardianId: guardian._id,
              name: call.name,
              args: parsedArgs,
            });
            if (call.name === "get_outstanding_balance") {
              // `total` is the field model/chatbot.ts actually returns.
              // The other two are historical names kept as a safety net —
              // reading only those meant this rail never fired at all.
              const b = payload as { total?: number; familyOwed?: number; totalOutstanding?: number };
              const owed = b.total ?? b.familyOwed ?? b.totalOutstanding;
              if (typeof owed === "number") familyOwed = owed;
            }
          }
          fired.push(call.name);
          await ctx.runMutation(internal.chatbot.appendMessage, {
            sessionId,
            role: "tool",
            content: JSON.stringify(payload).slice(0, 4000),
            toolName: call.name,
            toolPayload: payload,
          });
          if (emulated) {
            // No assistant/tool protocol pair for this model — hand the data
            // back as a plain turn it will actually read.
            messages.push({ role: "user", content: `Result of ${call.name}: ${JSON.stringify(payload)}\n\n${CORRECTIVE_TURN}` });
          } else {
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(payload) });
          }
        }
        continue;
      }

      const candidate = stripToolScaffolding(stripMarkdown(result.text));
      if (isUsableReply(candidate) && !looksLikePlanning(candidate)) {
        reply = candidate;
        break;
      }
      if (i < MAX_TURNS - 1) messages.push({ role: "user", content: CORRECTIVE_TURN });
    }

    // Loop exhausted without a clean answer — one last call, tools off.
    if (!reply) {
      const final = await chatCompletion({ model, messages, toolChoice: "none", temperature: 0.2, maxTokens: 280, excludeReasoning: true });
      if (final.ok) {
        usageTotal = addUsage(usageTotal, final.usage);
        const candidate = stripToolScaffolding(stripMarkdown(final.text));
        if (isUsableReply(candidate) && !looksLikePlanning(candidate)) reply = candidate;
      }
    }
    // A money question must be answered from the ledger even when the model
    // never managed a usable turn — otherwise the parent gets "try again"
    // for the one question the system can always answer itself.
    if (feeQuestion && familyOwed === null) {
      const payload = await ctx.runQuery(internal.chatbot.executeReadTool, { guardianId: guardian._id, name: "get_outstanding_balance", args: {} });
      const b = payload as { total?: number };
      if (typeof b.total === "number") {
        familyOwed = b.total;
        fired.push("get_outstanding_balance");
        await ctx.runMutation(internal.chatbot.appendMessage, {
          sessionId,
          role: "tool",
          content: JSON.stringify(payload).slice(0, 4000),
          toolName: "get_outstanding_balance",
          toolPayload: payload,
        });
      }
    }

    if (!reply) reply = fallbackResponse(language);

    // Hard rail: a fee answer that doesn't quote the real ledger number gets
    // replaced by one that does. The model never gets to improvise money.
    if (feeQuestion && familyOwed !== null) {
      const digits = String(Math.round(familyOwed));
      if (!reply.replace(/[,\s]/g, "").includes(digits)) reply = familyBalanceReply(familyOwed, language);
    }

    await ctx.runMutation(internal.chatbot.appendMessage, { sessionId, role: "assistant", content: reply });
    await ctx.runMutation(internal.chatbot.bumpTokenUsage, { sessionId, delta: usageTotal.totalTokens });
    const sessionTokens = await ctx.runQuery(internal.chatbot.sessionTokenUsage, { sessionId });

    return {
      ok: true,
      reply,
      tools: fired,
      tokensUsed: usageTotal.totalTokens,
      sessionTokens,
      dailyUsed: limit - usage.remaining,
      dailyRemaining: usage.remaining,
      dailyLimit: limit,
    };
  },
});

export const sessionTokenUsage = internalQuery({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, { sessionId }) => (await ctx.db.get(sessionId))?.tokenUsage ?? 0,
});
