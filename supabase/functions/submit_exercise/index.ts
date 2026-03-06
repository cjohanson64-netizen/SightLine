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

type TokenClaims = {
  classroom_folder_id?: string;
  student_id?: string;
};

type Body = {
  token?: string;
  title?: string;
  seed?: number;
  music_xml?: string;
  spec_json?: unknown;
  melody_json?: unknown;
  beats_per_measure?: number | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const token = String(body.token ?? "").trim();
    const providedTitle = String(body.title ?? "").trim();
    const seed = Number(body.seed ?? NaN);
    const musicXml = String(body.music_xml ?? "").trim();
    const beatsPerMeasureRaw = body.beats_per_measure;
    const beatsPerMeasure =
      typeof beatsPerMeasureRaw === "number" &&
      Number.isFinite(beatsPerMeasureRaw)
        ? Math.max(1, Math.floor(beatsPerMeasureRaw))
        : null;

    if (!token || !musicXml || !Number.isFinite(seed)) {
      return jsonResponse({ error: "Missing token, seed, or music_xml." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("CLASSROOM_JWT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(jwtSecret),
    );
    const claims = payload as unknown as TokenClaims;
    const folderId = String(claims.classroom_folder_id ?? "").trim();
    const studentId = String(claims.student_id ?? "")
      .trim()
      .toUpperCase();
    if (!folderId || !studentId) {
      return jsonResponse({ error: "Invalid student token." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const titleWithoutPrefix = providedTitle.startsWith(`${studentId} - `)
      ? providedTitle.slice(`${studentId} - `.length).trim()
      : providedTitle;
    const baseTitle = titleWithoutPrefix || "Student Submission";
    const finalTitle = `${studentId} - ${baseTitle}`;

    const { data: inserted, error: insertError } = await admin
      .from("student_submissions")
      .insert({
        folder_id: folderId,
        student_id: studentId,
        title: finalTitle,
        seed: Math.floor(seed),
        music_xml: musicXml,
        spec_json: body.spec_json ?? null,
        melody_json: body.melody_json ?? null,
        beats_per_measure: beatsPerMeasure,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message ?? "Unable to store submission.");
    }

    return jsonResponse({ ok: true, submission_id: inserted.id }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unhandled submit error.";
    return jsonResponse({ error: message }, 500);
  }
});
