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
    // Support both legacy and new env var formats
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

    // --- Validate caller is admin ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "auth_error", message: "Missing or invalid Authorization header" });
    }
    const callerToken = authHeader.replace("Bearer ", "");
    const {
      data: { user: caller },
      error: callerError,
    } = await supabase.auth.getUser(callerToken);

    if (callerError || !caller) {
      return jsonResponse({ success: false, error: "auth_error", message: "Invalid token" });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, academy_id")
      .eq("id", caller.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin") {
      return jsonResponse({ success: false, error: "forbidden", message: "Only admins can invite users" });
    }

    const academyId = callerProfile.academy_id;

    // --- Parse body ---
    const body = await req.json();
    const { action, email, role, full_name, phone, language_pref } = body;

    if (!email) {
      return jsonResponse({ success: false, error: "validation_error", message: "email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // --- Validate role ---
    if (action !== "resend") {
      if (!role || !["teacher", "parent"].includes(role)) {
        return jsonResponse({ success: false, error: "validation_error", message: "role must be 'teacher' or 'parent'" });
      }
      if (!full_name || full_name.trim().length === 0) {
        return jsonResponse({ success: false, error: "validation_error", message: "full_name is required" });
      }
    }

    // --- Check if user already exists ---
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, role, active")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      if (!existingProfile.active) {
        return jsonResponse({
          success: false,
          error: "user_deactivated",
          message: "This account has been deactivated. Reactivate it first if you want to resend an invite.",
        });
      }

      // Check if they've ever logged in
      const { data: authUser } = await supabase.auth.admin.getUserById(
        existingProfile.id
      );

      if (authUser?.user?.last_sign_in_at) {
        return jsonResponse({
          success: false,
          error: "duplicate_active",
          message: "This email is already registered and active. The user has already logged in.",
        });
      }

      // User exists but never logged in — invite is pending
      if (action === "resend") {
        // Resend the invite
        const link = await generateInviteLink(
          supabase,
          normalizedEmail,
          appUrl
        );
        await sendInviteEmail(
          resendApiKey,
          normalizedEmail,
          authUser?.user?.user_metadata?.full_name || full_name || "User",
          existingProfile.role,
          link
        );
        return jsonResponse({
          success: true,
          error: "",
          user_id: existingProfile.id,
          role: existingProfile.role,
          message: "Invite resent successfully",
        });
      }

      return jsonResponse({
        success: false,
        error: "invite_pending",
        user_id: existingProfile.id,
        message: "An invite was already sent to this email but they haven't logged in yet. Use action: 'resend' to resend.",
      });
    }

    // --- If action is resend but user doesn't exist ---
    if (action === "resend") {
      return jsonResponse({ success: false, error: "not_found", message: "No existing user found with this email to resend to" });
    }

    const languagePref = normalizeLanguagePref(language_pref, role);

    // --- Create the user ---
    const { data: newUser, error: createError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: {
          academy_id: academyId,
          role: role,
          full_name: full_name.trim(),
          phone: phone?.trim() || null,
          language_pref: languagePref,
        },
      });

    if (createError) {
      if (
        createError.message?.includes("already been registered") ||
        createError.message?.includes("already exists")
      ) {
        return jsonResponse({
          success: false,
          error: "duplicate_active",
          message: "This email is already registered in the auth system.",
        });
      }
      return jsonResponse({ success: false, error: "server_error", message: `Failed to create user: ${createError.message}` });
    }

    // --- For parent: create guardians row ---
    if (role === "parent") {
      const { error: guardianError } = await supabase.from("guardians").insert({
        id: crypto.randomUUID(),
        profile_id: newUser.user.id,
        academy_id: academyId,
        name: full_name.trim(),
        phone: phone?.trim() || null,
        email: normalizedEmail,
        language_pref: languagePref,
        verified: false,
      });

      if (guardianError) {
        // User was created but guardian insert failed — log but don't fail the whole invite
        console.error("Guardian creation failed:", guardianError.message);
      }
    }

    // --- Generate invite link and send email ---
    const link = await generateInviteLink(supabase, normalizedEmail, appUrl);
    await sendInviteEmail(
      resendApiKey,
      normalizedEmail,
      full_name.trim(),
      role,
      link
    );

    return jsonResponse({
      success: true,
      error: "",
      user_id: newUser.user.id,
      role: role,
      language_pref: languagePref,
      message: `Invite sent to ${normalizedEmail}`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Unhandled error:", errMsg);
    return jsonResponse({ success: false, error: "server_error", message: `Internal server error: ${errMsg}` });
  }
});

// --- Helpers ---

async function generateInviteLink(
  supabase: any,
  email: string,
  appUrl: string
): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: email,
  });

  if (error) {
    throw new Error(`Failed to generate invite link: ${error.message}`);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const tokenHash = data.properties.hashed_token;
  const redirectTo = `${appUrl}/reset_pw`;

  return `${supabaseUrl}/functions/v1/verify-token?token=${tokenHash}&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function sendInviteEmail(
  resendApiKey: string,
  toEmail: string,
  fullName: string,
  role: string,
  inviteLink: string
): Promise<void> {
  const fromEmail =
    Deno.env.get("RESEND_FROM_EMAIL") || "AcademyOS <noreply@example.com>";

  const roleLabel = role === "teacher" ? "Teacher" : "Parent";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Welcome to AcademyOS</h2>
  <p>Hi ${escapeHtml(fullName)},</p>
  <p>You've been invited to join AcademyOS as a <strong>${roleLabel}</strong>.</p>
  <p>Click the button below to set your password and activate your account:</p>
  <p style="margin: 30px 0;">
    <a href="${inviteLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
      Set Password & Activate
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
  <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${inviteLink}</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #9ca3af; font-size: 12px;">This invite was sent by your academy administrator. If you didn't expect this, you can safely ignore it.</p>
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
      to: [toEmail],
      subject: `You're invited to AcademyOS as a ${roleLabel}`,
      html: html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("Resend API error:", res.status, errBody);
    throw new Error(`Email send failed: ${res.status}`);
  }
}

function normalizeLanguagePref(raw: unknown, role: string): "en" | "ur" {
  if (role !== "parent") return "en";
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "ur" || value === "urdu") return "ur";
  return "en";
}

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
    user_id: data.user_id ?? "",
    role: data.role ?? "",
    language_pref: data.language_pref ?? "",
    message: data.message ?? "",
  };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

