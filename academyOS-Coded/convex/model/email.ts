/**
 * Shared Resend sending helper, used from actions only (email sending is an
 * external side effect, never done from a query/mutation). Plain `fetch`
 * against Resend's REST API — no SDK dependency needed for a single POST.
 *
 * Requires the Convex env vars RESEND_API_KEY and RESEND_FROM_EMAIL to be
 * set (`npx convex env set RESEND_API_KEY ...`) — never hardcode a key in
 * source. The academyOS-server reference project's key is reused here only
 * via that env-var mechanism, per the user's instruction to copy it in.
 */

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("sendEmail: RESEND_API_KEY or RESEND_FROM_EMAIL not configured — email not sent.", { subject: input.subject, to: input.to });
    return { ok: false, error: "Email is not configured on this deployment." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    console.error("sendEmail: Resend API error", res.status, detail);
    return { ok: false, error: `Resend API error ${res.status}: ${detail}` };
  }
  const body = (await res.json()) as { id: string };
  return { ok: true, id: body.id };
}

/** Thin wrapper: consistent chrome (academy name, footer) around every transactional email. */
export function emailShell(bodyHtml: string): string {
  return `<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0D0D0D;">
    <div style="padding: 24px 0; font-weight: 900; font-size: 18px; letter-spacing: -0.02em;">AcademyOS</div>
    ${bodyHtml}
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #E8E5DE; font-size: 12px; color: #8A857C;">
      Bright Future Academy · sent by AcademyOS
    </div>
  </div>`;
}
