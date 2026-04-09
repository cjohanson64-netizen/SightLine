import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { jwtVerify } from "npm:jose@5.9.6";
import { requireTeacherAuth } from "../_shared/billing.ts";

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

type Body = {
  token?: string | null;
  teacher_id?: string | null;
  class_id?: string | null;
  folder_id?: string | null;
  student_id?: string | null;
  assignment_id?: string | null;
  exercise_id?: string | null;
  exercise_title?: string;
  seed?: number | null;
  assessment_mode?: string;
  weighted_score?: number;
  total_possible?: number;
  percent?: number;
  correct_count?: number;
  ambiguous_count?: number;
  low_confidence_count?: number;
  incorrect_count?: number;
  recovery_kind?: string | null;
  tonal_state_kind?: string | null;
  signal_quality_level?: string | null;
  signal_quality_score?: number | null;
  summary_text?: string | null;
  note_details?: unknown;
  summary_json?: unknown;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("CLASSROOM_JWT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = (await req.json().catch(() => ({}))) as Body;

    const exerciseTitle = String(body.exercise_title ?? "").trim();
    const assessmentMode = String(body.assessment_mode ?? "").trim();
    const weightedScore = Number(body.weighted_score ?? NaN);
    const totalPossible = Number(body.total_possible ?? NaN);
    const percent = Number(body.percent ?? NaN);

    if (!exerciseTitle || !assessmentMode || !Number.isFinite(weightedScore) || !Number.isFinite(totalPossible) || !Number.isFinite(percent)) {
      return jsonResponse({ error: "Missing required assessment fields." }, 400);
    }

    let ownerId = "";
    let teacherId = String(body.teacher_id ?? "").trim() || null;
    let classId = String(body.class_id ?? "").trim() || null;
    let folderId = String(body.folder_id ?? "").trim() || null;
    let studentId = String(body.student_id ?? "").trim().toUpperCase() || null;

    const token = String(body.token ?? "").trim();
    if (token) {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(jwtSecret),
      );
      const claims = payload as unknown as StudentClaims;
      const tokenFolderId = String(claims.classroom_folder_id ?? "").trim();
      const tokenStudentId = String(claims.student_id ?? "").trim().toUpperCase();
      if (claims.role !== "student" || !tokenFolderId || !tokenStudentId) {
        return jsonResponse({ error: "Invalid student token." }, 401);
      }

      const { data: folder, error: folderError } = await admin
        .from("folders")
        .select("id, owner_id")
        .eq("id", tokenFolderId)
        .maybeSingle();
      if (folderError) throw folderError;
      if (!folder?.owner_id) {
        return jsonResponse({ error: "Classroom not found." }, 404);
      }

      ownerId = String(folder.owner_id);
      teacherId = String(folder.owner_id);
      classId = tokenFolderId;
      folderId = tokenFolderId;
      studentId = tokenStudentId;
    } else {
      const { teacherId: authenticatedTeacherId } = await requireTeacherAuth(admin, req);
      ownerId = authenticatedTeacherId;
      teacherId = authenticatedTeacherId;
      classId = classId ?? folderId;

      if (folderId) {
        const { data: folder, error: folderError } = await admin
          .from("folders")
          .select("id, owner_id")
          .eq("id", folderId)
          .maybeSingle();
        if (folderError) throw folderError;
        if (!folder || folder.owner_id !== teacherId) {
          return jsonResponse({ error: "Not allowed to log assessments for this class." }, 403);
        }
      }
    }

    const { data: inserted, error: insertError } = await admin
      .from("assessment_logs")
      .insert({
        owner_id: ownerId,
        teacher_id: teacherId,
        class_id: classId,
        folder_id: folderId,
        student_id: studentId,
        assignment_id: body.assignment_id ?? null,
        exercise_id: body.exercise_id ?? null,
        exercise_title: exerciseTitle,
        seed: Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : null,
        assessment_mode: assessmentMode,
        weighted_score: weightedScore,
        total_possible: totalPossible,
        percent,
        correct_count: Math.max(0, Math.floor(Number(body.correct_count ?? 0))),
        ambiguous_count: Math.max(0, Math.floor(Number(body.ambiguous_count ?? 0))),
        low_confidence_count: Math.max(0, Math.floor(Number(body.low_confidence_count ?? 0))),
        incorrect_count: Math.max(0, Math.floor(Number(body.incorrect_count ?? 0))),
        recovery_kind: body.recovery_kind ?? null,
        tonal_state_kind: body.tonal_state_kind ?? null,
        signal_quality_level: body.signal_quality_level ?? null,
        signal_quality_score: body.signal_quality_score ?? null,
        summary_text: body.summary_text ?? null,
        note_details: Array.isArray(body.note_details) ? body.note_details : [],
        summary_json:
          body.summary_json && typeof body.summary_json === "object" ? body.summary_json : null,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message ?? "Unable to save assessment log.");
    }

    return jsonResponse({ ok: true, id: inserted.id }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unhandled assessment log error.";
    return jsonResponse({ error: message }, 500);
  }
});
