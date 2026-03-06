import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractBearerToken,
  requireActiveSubscription,
  verifyTeacherAuth,
} from "../_shared/billing.ts";

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

type Body = {
  submission_id?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const authResult = await verifyTeacherAuth(admin, extractBearerToken(req));
    if (!authResult.ok) {
      return jsonResponse({ error: authResult.error }, authResult.status);
    }
    const teacherId = authResult.teacherId;

    const subscriptionResult = await requireActiveSubscription(admin, teacherId);
    if (!subscriptionResult.ok) {
      return jsonResponse({ error: subscriptionResult.error }, subscriptionResult.status);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const submissionId = String(body.submission_id ?? "").trim();
    if (!submissionId) {
      return jsonResponse({ error: "Missing submission_id." }, 400);
    }

    const { data: submission, error: submissionError } = await admin
      .from("student_submissions")
      .select(
        "id, folder_id, student_id, title, seed, music_xml, spec_json, melody_json, beats_per_measure, status",
      )
      .eq("id", submissionId)
      .maybeSingle();
    if (submissionError) {
      throw new Error(submissionError.message);
    }
    if (!submission) {
      return jsonResponse({ error: "Submission not found." }, 404);
    }
    if (submission.status !== "pending") {
      return jsonResponse({ error: "Submission is no longer pending." }, 409);
    }

    const { data: folder, error: folderError } = await admin
      .from("folders")
      .select("id, owner_id")
      .eq("id", submission.folder_id)
      .maybeSingle();
    if (folderError) {
      throw new Error(folderError.message);
    }
    if (!folder || folder.owner_id !== teacherId) {
      return jsonResponse({ error: "Not allowed." }, 403);
    }

    const { data: exercise, error: insertError } = await admin
      .from("exercises")
      .insert({
        owner_id: teacherId,
        folder_id: submission.folder_id,
        seed: submission.seed,
        title: submission.title,
        music_xml: submission.music_xml,
        spec_json: submission.spec_json,
        melody_json: submission.melody_json,
        beats_per_measure: submission.beats_per_measure,
      })
      .select("id")
      .single();
    if (insertError || !exercise) {
      throw new Error(insertError?.message ?? "Unable to create exercise.");
    }

    const { error: updateError } = await admin
      .from("student_submissions")
      .update({ status: "approved" })
      .eq("id", submissionId);
    if (updateError) {
      throw new Error(updateError.message);
    }

    return jsonResponse({ ok: true, exercise_id: exercise.id }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unhandled approval error.";
    return jsonResponse({ error: message }, 500);
  }
});
