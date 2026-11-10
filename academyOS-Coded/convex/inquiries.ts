import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/authz";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("inquiries")
      .withIndex("by_status")
      .collect();
    const mine = await Promise.all(
      rows
        .filter((r) => r.academyId === admin.academyId)
        .map(async (r) => {
          const guardian = await ctx.db.get(r.guardianId);
          return { id: r._id, topic: r.topic, message: r.message, status: r.status, from: guardian?.name ?? "—", createdAt: r._creationTime };
        })
    );
    return mine.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  },
});

export const resolve = mutation({
  args: { inquiryId: v.id("inquiries") },
  handler: async (ctx, { inquiryId }) => {
    const admin = await requireAdmin(ctx);
    const inquiry = await ctx.db.get(inquiryId);
    if (!inquiry) throw new Error("Inquiry not found.");
    const nowResolved = inquiry.status === "open";
    await ctx.db.patch(inquiryId, {
      status: nowResolved ? "resolved" : "open",
      resolvedBy: nowResolved ? admin._id : undefined,
      resolvedAt: nowResolved ? Date.now() : undefined,
    });
    return { status: nowResolved ? "resolved" : "open" };
  },
});

export const getChatbotStats = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const guardians = await ctx.db
      .query("guardians")
      .withIndex("by_academy", (q) => q.eq("academyId", admin.academyId))
      .collect();
    const guardianIds = new Set(guardians.map((g) => g._id));

    let sessions = 0;
    let toolCalls = 0;
    let tokenUsage = 0;
    for (const g of guardians) {
      const sessionRows = await ctx.db
        .query("chatSessions")
        .withIndex("by_guardian", (q) => q.eq("guardianId", g._id))
        .collect();
      for (const s of sessionRows) {
        if (s.startedAt < weekAgo) continue;
        sessions += 1;
        tokenUsage += s.tokenUsage;
        const messages = await ctx.db
          .query("chatMessages")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        toolCalls += messages.filter((m) => m.role === "tool").length;
      }
    }

    const inquiries = await ctx.db
      .query("inquiries")
      .withIndex("by_status")
      .collect();
    const deflected = inquiries.filter((i) => i.academyId === admin.academyId && guardianIds.has(i.guardianId) && i._creationTime >= weekAgo).length;

    return [
      { label: "Sessions this week", value: String(sessions) },
      { label: "Tool calls", value: String(toolCalls) },
      { label: "Deflected → inquiry", value: String(deflected) },
      { label: "Tokens (est.)", value: tokenUsage.toLocaleString() },
    ];
  },
});
