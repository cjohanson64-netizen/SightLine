import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import { SignJWT } from "npm:jose@5.9.6";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      join_code?: string;
      passcode?: string;
      student_id?: string;
      pin?: string;
      display_name?: string;
    };

    const join_code = String(body.join_code ?? "").trim().toUpperCase();
    const passcode = String(body.passcode ?? "");
    const student_id = String(body.student_id ?? "").trim().toUpperCase();
    const pin = String(body.pin ?? "");
    const display_name =
      body.display_name === undefined || body.display_name === null
        ? null
        : String(body.display_name).trim() || null;

    if (!join_code || !passcode || !student_id) {
      return jsonResponse(
        { error: "Missing join_code, passcode, or student_id" },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("CLASSROOM_JWT_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return jsonResponse(
        { error: "Server misconfigured: missing env vars" },
        500,
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const ip =
      req.headers.get("cf-connecting-ip")?.trim() ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const recordJoinAttempt = async () => {
      try {
        await admin.from("join_attempts").insert({
          ip,
          join_code,
        });
      } catch {
        // best effort only
      }
    };

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: recentAttempts } = await admin
      .from("join_attempts")
      .select("id", { head: true, count: "exact" })
      .eq("ip", ip)
      .gte("created_at", fiveMinutesAgo);
    if ((recentAttempts ?? 0) > 20) {
      await recordJoinAttempt();
      return jsonResponse({ error: "Too many join attempts. Please wait." }, 429);
    }

    const { data: folder, error: folderError } = await admin
      .from("folders")
      .select("id, name, join_code, passcode_hash, is_published")
      .eq("join_code", join_code)
      .maybeSingle();

    if (folderError) throw folderError;

    if (!folder || !folder.passcode_hash) {
      await recordJoinAttempt();
      return jsonResponse({ error: "Invalid classroom code" }, 401);
    }

    const passcodeOk = await bcrypt.compare(passcode, folder.passcode_hash);
    if (!passcodeOk) {
      await recordJoinAttempt();
      return jsonResponse({ error: "Invalid passcode" }, 401);
    }

    const { data: rosterItem, error: rosterError } = await admin
      .from("classroom_students")
      .select("id, student_id, pin_hash, is_active")
      .eq("folder_id", folder.id)
      .eq("student_id", student_id)
      .maybeSingle();

    if (rosterError) throw rosterError;
    if (!rosterItem || rosterItem.is_active !== true) {
      await recordJoinAttempt();
      return jsonResponse({ error: "Invalid student ID" }, 401);
    }

    if (rosterItem.pin_hash) {
      if (!pin) {
        await recordJoinAttempt();
        return jsonResponse({ error: "PIN required" }, 401);
      }
      const pinOk = await bcrypt.compare(pin, rosterItem.pin_hash);
      if (!pinOk) {
        await recordJoinAttempt();
        return jsonResponse({ error: "Invalid PIN" }, 401);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 60 * 24 * 14;

    const token = await new SignJWT({
      role: "student",
      classroom_folder_id: folder.id,
      student_id: rosterItem.student_id,
      join_code: folder.join_code,
      display_name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode(jwtSecret));

    await recordJoinAttempt();

    return jsonResponse(
      {
        token,
        classroom: {
          id: folder.id,
          name: folder.name,
          join_code: folder.join_code,
          student_id: rosterItem.student_id,
        },
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
