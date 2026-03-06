import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.25.0";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  mapStripeSubscriptionStatus,
} from "../_shared/billing.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function stripeTimestampToIso(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

async function upsertSubscriptionByUserId(
  admin: ReturnType<typeof createClient>,
  userId: string,
  data: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    status?: string | null;
    current_period_end?: string | null;
  },
): Promise<void> {
  const { data: existing, error: existingError } = await admin
    .from("subscriptions")
    .select("status, is_admin, is_comped")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingStatus =
    typeof existing?.status === "string" ? existing.status.toLowerCase() : null;
  const protectedAccess = existing?.is_admin === true || existing?.is_comped === true;

  let nextStatus =
    data.status === undefined || data.status === null
      ? existingStatus
      : String(data.status).toLowerCase();

  if (
    protectedAccess &&
    nextStatus !== null &&
    !ACTIVE_SUBSCRIPTION_STATUSES.has(nextStatus) &&
    existingStatus
  ) {
    nextStatus = existingStatus;
  }

  const row: Record<string, unknown> = { user_id: userId };
  if (data.stripe_customer_id !== undefined) {
    row.stripe_customer_id = data.stripe_customer_id;
  }
  if (data.stripe_subscription_id !== undefined) {
    row.stripe_subscription_id = data.stripe_subscription_id;
  }
  if (nextStatus !== null) {
    row.status = nextStatus;
  }
  if (data.current_period_end !== undefined) {
    row.current_period_end = data.current_period_end;
  }
  if (existing?.is_admin === true) {
    row.is_admin = true;
  }
  if (existing?.is_comped === true) {
    row.is_comped = true;
  }

  const { error } = await admin.from("subscriptions").upsert(row, {
    onConflict: "user_id",
  });
  if (error) {
    throw new Error(error.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const signature = req.headers.get("stripe-signature") ?? "";
    if (!signature) {
      return jsonResponse({ error: "Missing Stripe signature" }, 400);
    }

    const body = await req.text();
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid signature";
      return jsonResponse({ error: message }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : null;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;

      if (userId) {
        let status = "inactive";
        let currentPeriodEnd: string | null = null;

        if (subscriptionId) {
          const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
          status = mapStripeSubscriptionStatus(stripeSubscription.status);
          currentPeriodEnd = stripeTimestampToIso(stripeSubscription.current_period_end);
        }

        await upsertSubscriptionByUserId(admin, userId, {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status,
          current_period_end: currentPeriodEnd,
        });
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string"
        ? subscription.customer
        : null;
      const subscriptionId = subscription.id;
      const status = mapStripeSubscriptionStatus(subscription.status);
      const currentPeriodEnd = stripeTimestampToIso(subscription.current_period_end);

      const metadataUserId =
        typeof subscription.metadata?.user_id === "string"
          ? subscription.metadata.user_id
          : "";

      let userId = metadataUserId;

      if (!userId && customerId) {
        const { data: existing, error: lookupError } = await admin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        if (lookupError) {
          throw new Error(lookupError.message);
        }
        userId = typeof existing?.user_id === "string" ? existing.user_id : "";
      }

      if (userId) {
        await upsertSubscriptionByUserId(admin, userId, {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status,
          current_period_end: currentPeriodEnd,
        });
      }
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled webhook error";
    console.error(`[stripe_webhook] ${message}`);
    return jsonResponse({ error: message }, 500);
  }
});
