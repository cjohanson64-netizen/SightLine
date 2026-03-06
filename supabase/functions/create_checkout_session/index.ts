import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.25.0";
import {
  extractBearerToken,
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

function getAppUrl(): string {
  const configured = Deno.env.get("APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  const normalized = configured.trim().replace(/\/$/, "");
  return normalized || "http://localhost:5173";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripePriceId = Deno.env.get("STRIPE_PRICE_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !stripePriceId || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const authResult = await verifyTeacherAuth(admin, extractBearerToken(req));
    if (!authResult.ok) {
      return jsonResponse({ error: authResult.error }, authResult.status);
    }

    const { teacherId, email } = authResult;

    const { data: subscriptionRow, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", teacherId)
      .maybeSingle();

    if (subscriptionError) {
      throw new Error(subscriptionError.message);
    }

    let stripeCustomerId =
      typeof subscriptionRow?.stripe_customer_id === "string"
        ? subscriptionRow.stripe_customer_id
        : "";

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { user_id: teacherId },
      });
      stripeCustomerId = customer.id;
    }

    const { error: upsertError } = await admin.from("subscriptions").upsert(
      {
        user_id: teacherId,
        stripe_customer_id: stripeCustomerId,
      },
      { onConflict: "user_id" },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    const appUrl = getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      client_reference_id: teacherId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?billing=success`,
      cancel_url: `${appUrl}/dashboard?billing=cancel`,
      subscription_data: {
        metadata: { user_id: teacherId },
      },
    });

    if (!session.url) {
      throw new Error("Unable to create checkout session URL.");
    }

    return jsonResponse({ url: session.url }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled function error";
    console.error(`[create_checkout_session] ${message}`);
    return jsonResponse({ error: message }, 500);
  }
});
