import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { jwtVerify } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

type StudentClaims = {
  role?: string;
  classroom_folder_id?: string;
  student_id?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
  return new Response("ok", { status: 200, headers: corsHeaders });
}

  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      event_type?: string;
      exercise_id?: string | null;
      duration_seconds?: number | null;
    };

    const token = String(body.token ?? "");
    const event_type = String(body.event_type ?? "");
    const exercise_id =
      body.exercise_id === undefined || body.exercise_id === null
        ? null
        : String(body.exercise_id);
    const duration_seconds =
      typeof body.duration_seconds === "number" &&
      Number.isFinite(body.duration_seconds)
        ? Math.max(0, Math.floor(body.duration_seconds))
        : null;

    if (!token || !event_type) {
      return jsonResponse({ error: "Missing token or event_type" }, 400);
    }

    if (!["start", "stop", "attempt"].includes(event_type)) {
      return jsonResponse({ error: "Invalid event_type" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("CLASSROOM_JWT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const claims = payload as unknown as StudentClaims;
    const folder_id = claims.classroom_folder_id;
    const student_id = claims.student_id;
    if (!folder_id || !student_id || claims.role !== "student") {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error: insertError } = await admin.from("student_progress_events").insert({
      folder_id,
      student_id,
      exercise_id,
      event_type,
      duration_seconds,
    });
    if (insertError) {
      throw insertError;
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
