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

type TeacherAuthResult =
  | { ok: true; teacherId: string }
  | { ok: false; response: Response };

async function verifyTeacherAuth(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
  anonKey: string,
): Promise<TeacherAuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return {
      ok: false,
      response: jsonResponse({ error: "Missing Bearer token" }, 401),
    };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: jsonResponse({ error: "Invalid/expired token" }, 401),
    };
  }

  return { ok: true, teacherId: data.user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const jwtSecret = Deno.env.get("CLASSROOM_JWT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !anonKey || !jwtSecret) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      folder_id?: string;
    };

    if (body.token) {
      const token = String(body.token);
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(jwtSecret),
      );
      const claims = payload as unknown as StudentClaims;
      const folder_id = claims.classroom_folder_id;
      const student_id = claims.student_id;
      if (!folder_id || !student_id || claims.role !== "student") {
        return jsonResponse({ error: "Invalid token" }, 401);
      }

      const since = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await admin
        .from("student_progress_events")
        .select("event_type, duration_seconds, created_at")
        .eq("folder_id", folder_id)
        .eq("student_id", student_id)
        .gte("created_at", since);
      if (error) throw error;

      const rows = data ?? [];
      const totalSeconds = rows.reduce(
        (sum, row) =>
          row.event_type === "stop"
            ? sum + Math.max(0, Number(row.duration_seconds ?? 0))
            : sum,
        0,
      );
      const attempts = rows.filter(
        (row) => row.event_type === "attempt",
      ).length;
      const lastPracticedAt =
        rows.length > 0
          ? rows
              .map((row) => String(row.created_at))
              .sort((a, b) => (a < b ? 1 : -1))[0]
          : null;

      return jsonResponse(
        {
          total_minutes: Math.round((totalSeconds / 60) * 10) / 10,
          total_attempts: attempts,
          last_practiced_at: lastPracticedAt,
        },
        200,
      );
    }

    const folder_id = String(body.folder_id ?? "");
    if (!folder_id) {
      return jsonResponse({ error: "Missing token or folder_id" }, 400);
    }

    const teacherAuth = await verifyTeacherAuth(
      req,
      supabaseUrl,
      serviceRoleKey,
      anonKey,
    );
    if (!teacherAuth.ok) {
      return teacherAuth.response;
    }

    const { data: folder, error: folderError } = await admin
      .from("folders")
      .select("id, owner_id")
      .eq("id", folder_id)
      .maybeSingle();
    if (folderError) throw folderError;
    if (!folder || folder.owner_id !== teacherAuth.teacherId) {
      return jsonResponse({ error: "Not allowed" }, 403);
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error: rowsError } = await admin
      .from("student_progress_events")
      .select("student_id, event_type, duration_seconds, created_at")
      .eq("folder_id", folder_id)
      .gte("created_at", since);
    if (rowsError) throw rowsError;

    const byStudent = new Map<
      string,
      { totalSeconds: number; attempts: number; lastPracticedAt: string | null }
    >();
    for (const row of rows ?? []) {
      const studentId = String(row.student_id);
      const current = byStudent.get(studentId) ?? {
        totalSeconds: 0,
        attempts: 0,
        lastPracticedAt: null,
      };
      if (row.event_type === "stop") {
        current.totalSeconds += Math.max(0, Number(row.duration_seconds ?? 0));
      }
      if (row.event_type === "attempt") {
        current.attempts += 1;
      }
      const createdAt = String(row.created_at);
      if (!current.lastPracticedAt || createdAt > current.lastPracticedAt) {
        current.lastPracticedAt = createdAt;
      }
      byStudent.set(studentId, current);
    }

    const summary = Array.from(byStudent.entries())
      .map(([student_id, item]) => ({
        student_id,
        total_minutes: Math.round((item.totalSeconds / 60) * 10) / 10,
        total_attempts: item.attempts,
        last_practiced_at: item.lastPracticedAt,
      }))
      .sort((a, b) => a.student_id.localeCompare(b.student_id));

    return jsonResponse({ summary }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
