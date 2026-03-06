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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type TokenClaims = {
  classroom_folder_id?: string;
  role?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true }, 200);

  try {
    const { token } = (await req.json().catch(() => ({}))) as { token?: string };
    if (!token) return jsonResponse({ error: "Missing token" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("CLASSROOM_JWT_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const claims = payload as unknown as TokenClaims;

    const folderId = claims.classroom_folder_id;
    if (!folderId) return jsonResponse({ error: "Invalid token" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: folder, error } = await admin
      .from("folders")
      .select("id, default_spec_json")
      .eq("id", folderId)
      .maybeSingle();

    if (error) throw error;
    if (!folder) return jsonResponse({ error: "Classroom not found" }, 404);

    return jsonResponse({ default_spec_json: folder.default_spec_json ?? null }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});