import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 3 * 1024 * 1024;
const PUT_EXPIRES = 300;
const GET_EXPIRES = 3600;

type Action = "presign_upload" | "ingest" | "sign_read" | "sign_read_many";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceRoleKey(): string | null {
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (secretKeys) {
      try {
        key = JSON.parse(secretKeys)["default"];
      } catch {
        /* ignore */
      }
    }
  }
  return key ?? null;
}

function r2Config(): {
  client: AwsClient;
  endpoint: string;
  bucket: string;
} | null {
  const accessKeyId = (Deno.env.get("R2_ACCESS_KEY_ID") ?? "").trim();
  const secretAccessKey = (Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "").trim();
  const bucket = (Deno.env.get("R2_BUCKET_NAME") ?? "").trim();
  const endpoint = (Deno.env.get("R2_ENDPOINT") ?? "").trim().replace(/\/$/, "");
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  return {
    client: new AwsClient({
      accessKeyId,
      secretAccessKey,
      region: "auto",
      service: "s3",
    }),
    endpoint,
    bucket,
  };
}

function objectUrl(endpoint: string, bucket: string, key: string): string {
  return `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeType(raw: string | undefined): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (ALLOWED_TYPES[t]) return t === "image/jpg" ? "image/jpeg" : t;
  return null;
}

/** Bubble PictureUploader URLs are often //cdn.bubble.io/... not https:// */
function normalizeFileUrl(raw: string): string | null {
  let url = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;
  if (!url.startsWith("https://")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extFor(contentType: string): string {
  return ALLOWED_TYPES[contentType] ?? "jpg";
}

function newPhotoKey(academyId: string, contentType: string): string {
  return `${academyId}/students/${crypto.randomUUID()}.${extFor(contentType)}`;
}

async function presign(
  r2: NonNullable<ReturnType<typeof r2Config>>,
  method: "PUT" | "GET",
  key: string,
  contentType: string | undefined,
  expires: number,
): Promise<string> {
  const url = new URL(objectUrl(r2.endpoint, r2.bucket, key));
  url.searchParams.set("X-Amz-Expires", String(expires));
  const headers: Record<string, string> = {};
  if (method === "PUT" && contentType) headers["content-type"] = contentType;
  const signed = await r2.client.sign(
    new Request(url, { method, headers }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

async function putObject(
  r2: NonNullable<ReturnType<typeof r2Config>>,
  key: string,
  contentType: string,
  body: Uint8Array,
): Promise<void> {
  const res = await r2.client.fetch(objectUrl(r2.endpoint, r2.bucket, key), {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`r2_put_failed:${res.status}:${detail.slice(0, 180)}`);
  }
}

function asIdList(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (typeof row === "string") return row;
    if (row && typeof row === "object") {
      return String(Object.values(row as Record<string, unknown>)[0] ?? "");
    }
    return String(row ?? "");
  }).filter((id) => !!uuidLike(id));
}

function uuidLike(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const key = serviceRoleKey();
    const r2 = r2Config();
    if (!supabaseUrl || !key) {
      return jsonResponse({
        success: false,
        error: "server_error",
        message: "Supabase not configured",
      }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({
        success: false,
        error: "auth_error",
        message: "Missing Authorization Bearer token",
      }, 401);
    }

    const supabase = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const jwt = authHeader.slice(7).trim();
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) {
      return jsonResponse({
        success: false,
        error: "auth_error",
        message: "Invalid token",
      }, 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, academy_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) {
      return jsonResponse({ success: false, error: "forbidden" }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = String(body.action ?? "").trim() as Action;
    if (
      action !== "presign_upload" &&
      action !== "ingest" &&
      action !== "sign_read" &&
      action !== "sign_read_many"
    ) {
      return jsonResponse({
        success: false,
        error: "validation_error",
        message: "action must be presign_upload, ingest, sign_read, or sign_read_many",
      }, 400);
    }

    if (action === "presign_upload" || action === "ingest") {
      if (!r2) {
        return jsonResponse({
          success: false,
          error: "r2_not_configured",
          message: "R2 secrets are not set",
        }, 500);
      }
      if (profile.role !== "admin") {
        return jsonResponse({
          success: false,
          error: "forbidden",
          message: "Only admins can upload student photos",
        }, 403);
      }
      const declaredType = normalizeType(String(body.content_type ?? "image/jpeg"));

      if (action === "presign_upload") {
        if (!declaredType) {
          return jsonResponse({
            success: false,
            error: "validation_error",
            message: "content_type must be image/jpeg, image/png, or image/webp",
          }, 400);
        }
        const photoKey = newPhotoKey(profile.academy_id, declaredType);
        const uploadUrl = await presign(r2, "PUT", photoKey, declaredType, PUT_EXPIRES);
        return jsonResponse({
          success: true,
          photo_key: photoKey,
          upload_url: uploadUrl,
          content_type: declaredType,
          expires_in: PUT_EXPIRES,
        });
      }

      let bytes: Uint8Array | null = null;
      let detectedType: string | null = null;
      const fileUrlRaw = String(body.file_url ?? "").trim();
      const b64 = String(body.data_base64 ?? "").trim();
      if (fileUrlRaw) {
        const fileUrl = normalizeFileUrl(fileUrlRaw);
        if (!fileUrl) {
          return jsonResponse({
            success: false,
            error: "validation_error",
            message:
              "Map file_url to the PictureUploader's value's URL (Bubble CDN). Local disk paths cannot be used.",
          }, 400);
        }
        const fetched = await fetch(fileUrl);
        if (!fetched.ok) {
          return jsonResponse({
            success: false,
            error: "fetch_failed",
            message: "Could not read the uploaded picture",
          }, 400);
        }
        detectedType = normalizeType(
          (fetched.headers.get("content-type") ?? "").split(";")[0],
        );
        bytes = new Uint8Array(await fetched.arrayBuffer());
      } else if (b64) {
        const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
        try {
          const bin = atob(raw);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch {
          return jsonResponse({
            success: false,
            error: "validation_error",
            message: "data_base64 is invalid",
          }, 400);
        }
      } else {
        return jsonResponse({
          success: false,
          error: "validation_error",
          message: "file_url or data_base64 is required for ingest",
        }, 400);
      }

      const contentType = detectedType ?? declaredType;
      if (!contentType) {
        return jsonResponse({
          success: false,
          error: "validation_error",
          message: "content_type must be image/jpeg, image/png, or image/webp",
        }, 400);
      }

      if (!bytes || bytes.byteLength < 32) {
        return jsonResponse({
          success: false,
          error: "validation_error",
          message: "Picture is empty",
        }, 400);
      }
      if (bytes.byteLength > MAX_BYTES) {
        return jsonResponse({
          success: false,
          error: "validation_error",
          message: "Picture must be 3 MB or smaller",
        }, 400);
      }

      const photoKey = newPhotoKey(profile.academy_id, contentType);
      await putObject(r2, photoKey, contentType, bytes);
      return jsonResponse({
        success: true,
        photo_key: photoKey,
        content_type: contentType,
      });
    }

    async function canReadStudent(
      student: { academy_id: string; guardian_id: string; id: string },
    ): Promise<boolean> {
      if (profile.role === "admin") {
        return student.academy_id === profile.academy_id;
      }
      if (profile.role === "parent") {
        const { data: guardian } = await supabase
          .from("guardians")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle();
        return !!guardian && guardian.id === student.guardian_id;
      }
      if (profile.role === "teacher") {
        const { data: rows } = await supabase.rpc("auth_teacher_student_ids");
        return asIdList(rows).includes(student.id);
      }
      return false;
    }

    if (action === "sign_read") {
      const studentId = uuidLike(body.student_id);
      if (!studentId) {
        return jsonResponse({
          success: false,
          error: "validation_error",
          message: "student_id is required",
        }, 400);
      }
      const { data: student } = await supabase
        .from("students")
        .select("id, photo_key, academy_id, guardian_id")
        .eq("id", studentId)
        .maybeSingle();
      if (!student || !(await canReadStudent(student))) {
        return jsonResponse({ success: false, error: "not_found" }, 404);
      }
      if (!student.photo_key) {
        return jsonResponse({
          success: true,
          student_id: student.id,
          photo_key: null,
          photo_url: null,
        });
      }
      if (!r2) {
        return jsonResponse({
          success: false,
          error: "r2_not_configured",
          message: "R2 secrets are not set",
        }, 500);
      }
      const photoUrl = await presign(r2, "GET", student.photo_key, undefined, GET_EXPIRES);
      return jsonResponse({
        success: true,
        student_id: student.id,
        photo_key: student.photo_key,
        photo_url: photoUrl,
        expires_in: GET_EXPIRES,
      });
    }

    let query = supabase
      .from("students")
      .select("id, photo_key, academy_id, guardian_id")
      .eq("academy_id", profile.academy_id);

    if (profile.role === "parent") {
      const { data: guardian } = await supabase
        .from("guardians")
        .select("id")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!guardian) {
        return jsonResponse({ success: true, photos: [] });
      }
      query = query.eq("guardian_id", guardian.id);
    } else if (profile.role === "teacher") {
      const { data: rows } = await supabase.rpc("auth_teacher_student_ids");
      const ids = asIdList(rows);
      if (ids.length === 0) return jsonResponse({ success: true, photos: [] });
      query = query.in("id", ids);
    } else if (profile.role !== "admin") {
      return jsonResponse({ success: false, error: "forbidden" }, 403);
    }

    const requested = Array.isArray(body.student_ids)
      ? body.student_ids.map(uuidLike).filter((v): v is string => !!v)
      : [];
    if (requested.length > 0) query = query.in("id", requested);

    const { data: students, error: listErr } = await query;
    if (listErr) {
      return jsonResponse({
        success: false,
        error: "query_failed",
        message: listErr.message,
      }, 500);
    }

    if (!r2 && (students ?? []).some((s) => !!s.photo_key)) {
      return jsonResponse({
        success: false,
        error: "r2_not_configured",
        message: "R2 secrets are not set",
      }, 500);
    }

    const photos = [];
    for (const student of students ?? []) {
      if (profile.role === "admin" && student.academy_id !== profile.academy_id) {
        continue;
      }
      if (!student.photo_key || !r2) {
        photos.push({
          student_id: student.id,
          photo_key: student.photo_key ?? null,
          photo_url: null,
        });
        continue;
      }
      const photoUrl = await presign(r2, "GET", student.photo_key, undefined, GET_EXPIRES);
      photos.push({
        student_id: student.id,
        photo_key: student.photo_key,
        photo_url: photoUrl,
        expires_in: GET_EXPIRES,
      });
    }

    return jsonResponse({ success: true, photos });
  } catch (err) {
    console.error("student-photo failed", err);
    return jsonResponse({
      success: false,
      error: "server_error",
      message: "Could not process student photo",
    }, 500);
  }
});
