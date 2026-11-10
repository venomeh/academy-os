import { convexAuth, createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ResendOTPPasswordReset } from "./lib/resendOtp";
import { currentProfile } from "./lib/authz";
import { emailShell, sendEmail } from "./model/email";
import type { Id } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ reset: ResendOTPPasswordReset })],
});

/**
 * Accounts are admin-provisioned only (§3) — there is no public sign-up
 * anywhere in this app. The client never calls `signIn("password", {flow:
 * "signUp"})`; the only way a new user comes into existence is this action.
 */

export const currentProfileQuery = internalQuery({
  args: {},
  handler: async (ctx) => currentProfile(ctx),
});

export const findProfileByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
  },
});

export const finishProvisioning = internalMutation({
  args: {
    userId: v.id("users"),
    academyId: v.id("academies"),
    role: v.union(v.literal("admin"), v.literal("teacher"), v.literal("parent")),
    fullName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    languagePref: v.union(v.literal("en"), v.literal("ur")),
    guardianPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profileId = await ctx.db.insert("profiles", {
      userId: args.userId,
      academyId: args.academyId,
      role: args.role,
      fullName: args.fullName,
      email: args.email,
      phone: args.phone,
      languagePref: args.languagePref,
      active: true,
    });
    let guardianId = null;
    if (args.role === "parent") {
      guardianId = await ctx.db.insert("guardians", {
        profileId,
        academyId: args.academyId,
        name: args.fullName,
        phone: args.guardianPhone ?? args.phone,
        email: args.email,
        languagePref: args.languagePref,
        verified: false,
        remindersPaused: false,
      });
    }
    return { profileId, guardianId };
  },
});

function randomTempPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export const provisionAccount = action({
  args: {
    email: v.string(),
    fullName: v.string(),
    role: v.union(v.literal("teacher"), v.literal("parent")),
    phone: v.optional(v.string()),
    languagePref: v.union(v.literal("en"), v.literal("ur")),
  },
  handler: async (ctx, args): Promise<{ ok: true; guardianId: Id<"guardians"> | null; codeSent: boolean } | { ok: false; error: string }> => {
    const admin = await ctx.runQuery(internal.auth.currentProfileQuery, {});
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Admin access required." };
    }

    const email = args.email.trim().toLowerCase();
    const existing = await ctx.runQuery(internal.auth.findProfileByEmail, { email });
    if (existing) {
      return { ok: false, error: existing.active ? "An active account already exists for that email." : "That email belongs to a deactivated account." };
    }

    let created;
    try {
      created = await createAccount(ctx, {
        provider: "password",
        account: { id: email, secret: randomTempPassword() },
        profile: { email, name: args.fullName },
      });
    } catch {
      return { ok: false, error: "Could not create the account — the email may already be in use." };
    }

    const { guardianId } = await ctx.runMutation(internal.auth.finishProvisioning, {
      userId: created.user._id,
      academyId: admin.academyId,
      role: args.role,
      fullName: args.fullName,
      email,
      phone: args.phone,
      languagePref: args.languagePref,
    });

    // Send the welcome email up front (independent of the reset-code flow,
    // which Convex Auth's own rate limiting governs) so the invite doesn't
    // silently fail to notify if the code email is delayed or throttled.
    await sendEmail({
      to: email,
      subject: "You're invited to AcademyOS",
      html: emailShell(`
        <p style="font-size: 15px; line-height: 1.6;">Hi ${args.fullName},</p>
        <p style="font-size: 15px; line-height: 1.6;">You've been added to AcademyOS as ${args.role === "teacher" ? "a teacher" : "a parent"}. A sign-in code is on its way in a separate email — enter it on the sign-in page to set your password and get started.</p>
      `),
      text: `Hi ${args.fullName}, you've been added to AcademyOS. A sign-in code is on its way in a separate email.`,
    });

    // Trigger the same "reset" code flow a forgotten-password request would
    // — the account's real password was never set, so this is how the
    // invitee sets it for the first time. The account already exists at this
    // point, so a mail-delivery failure must not surface as "invite failed":
    // the admin would retry and be told the email is taken. Report it and
    // let them use "Resend invite" once the address/mail config is fixed.
    let codeSent = true;
    try {
      await ctx.runAction(api.auth.signIn, { provider: "password", params: { email, flow: "reset" } });
    } catch (err) {
      codeSent = false;
      console.error("provisionAccount: account created but the sign-in code could not be emailed", err instanceof Error ? err.message : err);
    }

    return { ok: true, guardianId, codeSent };
  },
});

/**
 * Public — the frontend's one bootstrap call: who is signed in, what role,
 * and (for a parent) which guardian record. Used for role-based routing
 * (redirect to the right dashboard, or away from someone else's) since
 * Next.js middleware only knows "authenticated or not," not role.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const profile = await currentProfile(ctx);
    if (!profile || !profile.active) return null;
    let guardianId = null;
    if (profile.role === "parent") {
      const guardian = await ctx.db
        .query("guardians")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .unique();
      guardianId = guardian?._id ?? null;
    }
    return {
      profileId: profile._id,
      role: profile.role,
      fullName: profile.fullName,
      email: profile.email,
      languagePref: profile.languagePref,
      guardianId,
    };
  },
});
