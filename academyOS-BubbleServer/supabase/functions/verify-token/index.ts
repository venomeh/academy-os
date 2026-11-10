import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const type = url.searchParams.get("type") || "magiclink";
  const redirectTo = url.searchParams.get("redirect_to") || "";

  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: type as any,
  });

  if (error || !data.session) {
    const appUrl = Deno.env.get("APP_URL") || "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test";
    return Response.redirect(
      `${appUrl}/reset_pw?error=invalid_or_expired_link`,
      302
    );
  }

  const accessToken = data.session.access_token;
  const target = redirectTo || `${Deno.env.get("APP_URL") || "https://<YOUR_BUBBLE_APP>.bubbleapps.io/version-test"}/reset_pw`;

  return Response.redirect(
    `${target}?access_token=${accessToken}`,
    302
  );
});
