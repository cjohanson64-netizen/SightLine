// supabase/functions/set_classroom_access/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import {
  requireActiveSubscription,
  requireTeacherAuth,
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

function randomJoinCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function normalizeAndValidateCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (code.length < 4 || code.length > 10) {
    throw new Error("Class code must be 4-10 characters.");
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    throw new Error("Class code can only use letters A-Z and numbers 0-9.");
  }
  return code;
}

type Body = {
  folder_id?: string;
  passcode?: string;
  join_code?: string;
  rotate_code?: boolean;
  publish?: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[set_classroom_access] Missing server env vars");
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    let teacherId = "";
    try {
      const teacher = await requireTeacherAuth(admin, req);
      teacherId = teacher.teacherId;
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "Invalid/expired token";
      return jsonResponse({ error: message }, 401);
    }

    const subscriptionResult = await requireActiveSubscription(admin, teacherId);
    if (!subscriptionResult.ok) {
      return jsonResponse({ error: subscriptionResult.error }, subscriptionResult.status);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const folder_id = String(body.folder_id ?? "");
    const passcode = String(body.passcode ?? "");
    const rotate_code = Boolean(body.rotate_code);
    const publish = body.publish === undefined ? true : Boolean(body.publish);

    if (!folder_id || !passcode) {
      return jsonResponse({ error: "Missing folder_id or passcode" }, 400);
    }

    const { data: folder, error: folderErr } = await admin
      .from("folders")
      .select("id, owner_id, join_code, name")
      .eq("id", folder_id)
      .maybeSingle();

    if (folderErr) throw folderErr;
    if (!folder || folder.owner_id !== teacherId) {
      return jsonResponse({ error: "Not allowed" }, 403);
    }

    const desiredRaw =
      body.join_code === undefined || body.join_code === null
        ? ""
        : String(body.join_code);
    const desired = desiredRaw ? normalizeAndValidateCode(desiredRaw) : "";

    const codeTakenByAnotherFolder = async (code: string): Promise<boolean> => {
      const { data: conflict, error: conflictErr } = await admin
        .from("folders")
        .select("id")
        .eq("join_code", code)
        .neq("id", folder_id)
        .limit(1)
        .maybeSingle();
      if (conflictErr) throw conflictErr;
      return Boolean(conflict);
    };

    let join_code: string;
    if (rotate_code) {
      let nextCode = randomJoinCode(6);
      let foundUnique = false;
      for (let tries = 0; tries < 25; tries += 1) {
        const taken = await codeTakenByAnotherFolder(nextCode);
        if (!taken) {
          foundUnique = true;
          break;
        }
        nextCode = randomJoinCode(6);
      }
      if (!foundUnique) {
        return jsonResponse(
          { error: "Unable to generate a unique class code." },
          500,
        );
      }
      join_code = nextCode;
    } else if (desired) {
      join_code = desired;
    } else if (folder.join_code) {
      join_code = String(folder.join_code).trim().toUpperCase();
    } else {
      join_code = randomJoinCode(6);
    }

    if (!rotate_code) {
      const taken = await codeTakenByAnotherFolder(join_code);
      if (taken) {
        return jsonResponse({ error: "That class code is already taken." }, 409);
      }
    }

    const passcode_hash = await bcrypt.hash(passcode, 10);
    const { data: updated, error: updErr } = await admin
      .from("folders")
      .update({
        join_code,
        passcode_hash,
        is_published: publish,
      })
      .eq("id", folder_id)
      .select("id, name, join_code, is_published")
      .single();

    if (updErr) throw updErr;

    return jsonResponse({ classroom: updated }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unhandled function error";
    console.error(`[set_classroom_access] unhandled_error=${message}`);
    const status = message.includes("Class code") ? 400 : 500;
    return jsonResponse({ error: message }, status);
  }
});
