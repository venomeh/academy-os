import { Email } from "@convex-dev/auth/providers/Email";
import { emailShell, sendEmail } from "../model/email";

/**
 * Password-reset (and first-login) code delivery, standing in for the
 * reference backend's Supabase magiclink-to-/reset_pw flow. Convex Auth's
 * Password provider doesn't do magic links — it emails a short-lived code
 * the user types back in. Same job (nobody sets a password without proving
 * mailbox ownership first), different UX shape (code entry vs a link click).
 *
 * Used for two flows that share this one provider:
 *  - Admin invites someone → provisionAccount creates the account with an
 *    unusable random password, then immediately triggers this same "reset"
 *    flow so the first thing the invitee does is set their real password.
 *  - An existing user forgets their password → same "reset" flow.
 */
export const ResendOTPPasswordReset = Email({
  id: "resend-otp-password-reset",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b % 10).join("");
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const result = await sendEmail({
      to: email,
      subject: "Your AcademyOS sign-in code",
      html: emailShell(`
        <p style="font-size: 15px; line-height: 1.6;">Use this code to set your password and sign in:</p>
        <div style="margin: 20px 0; padding: 16px 20px; background: #FAF9F6; border: 1px solid #EFEDE7; border-radius: 10px; font-size: 28px; font-weight: 900; letter-spacing: 0.3em; text-align: center;">${token}</div>
        <p style="font-size: 13px; color: #6B6660;">This code expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
      `),
      text: `Your AcademyOS sign-in code is ${token}. It expires in 15 minutes.`,
    });
    if (!result.ok) throw new Error(result.error);
  },
});
