import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    let serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
      if (secretKeys) {
        serviceRoleKey = JSON.parse(secretKeys)["default"];
      }
    }
    if (!serviceRoleKey) {
      return jsonResponse({ success: false, error: "server_error", message: "Service role key not configured" });
    }
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return jsonResponse({ success: false, error: "server_error", message: "RESEND_API_KEY not configured" });
    }
    const appUrl =
      Deno.env.get("APP_URL") ||
      "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { email } = body;

    if (!email) {
      return jsonResponse({ success: false, error: "validation_error", message: "email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists in auth
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      return jsonResponse({ success: false, error: "server_error", message: "Failed to check user" });
    }

    const existingUser = users.users.find(
      (u: any) => u.email?.toLowerCase() === normalizedEmail
    );

    if (!existingUser) {
      // Don't reveal whether the email exists — always return success
      return jsonResponse({ success: true, message: "If that email is registered, a reset link has been sent." });
    }

    // Generate magic link
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
    });

    if (error) {
      return jsonResponse({ success: false, error: "server_error", message: "Failed to generate reset link" });
    }

    const tokenHash = data.properties.hashed_token;
    const redirectTo = `${appUrl}/reset_pw`;
    const resetLink = `${supabaseUrl}/functions/v1/verify-token?token=${tokenHash}&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`;

    // Send reset email via Resend
    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") || "AcademyOS <noreply@example.com>";

    const fullName = existingUser.user_metadata?.full_name || "User";

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Reset Your Password</h2>
  <p>Hi ${escapeHtml(fullName)},</p>
  <p>We received a request to reset your AcademyOS password.</p>
  <p>Click the button below to set a new password:</p>
  <p style="margin: 30px 0;">
    <a href="${resetLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
      Reset Password
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
  <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${resetLink}</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #9ca3af; font-size: 12px;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [normalizedEmail],
        subject: "Reset your AcademyOS password",
        html: html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Resend API error:", res.status, errBody);
      return jsonResponse({ success: false, error: "server_error", message: "Failed to send reset email" });
    }

    return jsonResponse({ success: true, message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Unhandled error:", errMsg);
    return jsonResponse({ success: false, error: "server_error", message: `Internal server error: ${errMsg}` });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonResponse(data: Record<string, any>): Response {
  const body = {
    success: data.success ?? false,
    error: data.error ?? "",
    message: data.message ?? "",
  };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
