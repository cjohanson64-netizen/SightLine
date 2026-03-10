import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.25.0";
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

function getAppUrl(req: Request): string {
  const configured = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const origin = (req.headers.get("origin") ?? "").trim().replace(/\/$/, "");
  if (origin) return origin;

  return "http://localhost:5173";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    let teacherId = "";
    try {
      const teacher = await requireTeacherAuth(admin, req);
      teacherId = teacher.teacherId;
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : "Invalid/expired token";
      return jsonResponse({ error: message }, 401);
    }

    const { data: subscriptionRow, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", teacherId)
      .maybeSingle();

    if (subscriptionError) {
      throw new Error(subscriptionError.message);
    }

    const stripeCustomerId =
      typeof subscriptionRow?.stripe_customer_id === "string"
        ? subscriptionRow.stripe_customer_id.trim()
        : "";

    if (!stripeCustomerId) {
      return jsonResponse(
        { error: "No customer record. Please upgrade first." },
        400,
      );
    }

    const appUrl = getAppUrl(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${appUrl}/?billing=portal_return`,
    });

    if (!session.url) {
      throw new Error("Unable to create portal session URL.");
    }

    return jsonResponse({ url: session.url }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unhandled function error";
    console.error(`[create_portal_session] ${message}`);
    return jsonResponse({ error: message }, 500);
  }
});
