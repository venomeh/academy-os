import { v } from "convex/values";
import { internalAction, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/authz";
import { emailShell, sendEmail } from "./model/email";

/**
 * §13 — the landing page's waitlist form. The one deliberately
 * anonymous-writable table in the whole schema (mirrors the reference's
 * `waitlist_anon_insert` policy, the only grant `anon` has anywhere).
 * A mutation can't send mail, so the Resend confirmation is scheduled as
 * an internal action the moment the row lands.
 */

export const join = mutation({
  args: { email: v.string(), source: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    // Already on the list — return the same success shape rather than
    // erroring or revealing a prior signup either way.
    if (existing) return { ok: true };
    await ctx.db.insert("waitlist", { email, source: args.source });
    await ctx.scheduler.runAfter(0, internal.waitlist.sendConfirmation, { email });
    return { ok: true };
  },
});

export const sendConfirmation = internalAction({
  args: { email: v.string() },
  handler: async (_ctx, { email }) => {
    await sendEmail({
      to: email,
      subject: "You're on the AcademyOS waitlist",
      html: emailShell(`
        <p style="font-size:15px;line-height:1.6;">Thanks for joining. We're onboarding a small first group of academies and will email you once — when your spot opens.</p>
        <p style="font-size:13px;line-height:1.6;color:#6B6660;">Nothing else will be sent to this address. If this wasn't you, ignore this email.</p>
      `),
      text: "Thanks for joining the AcademyOS waitlist. We'll email you once, when your spot opens.",
    });
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("waitlist").order("desc").collect();
    return rows.map((r) => ({ id: r._id, email: r.email, source: r.source ?? null, createdAt: r._creationTime }));
  },
});
