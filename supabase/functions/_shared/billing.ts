import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export type SubscriptionAccess = {
  allowed: boolean;
  status: string | null;
  is_admin: boolean;
  is_comped: boolean;
};

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export async function requireTeacherAuth(
  admin: SupabaseClient,
  req: Request,
): Promise<{ teacherId: string; email: string | null }> {
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    throw new Error("Missing Bearer token");
  }
  const { data, error } = await admin.auth.getUser(bearerToken);
  if (error || !data.user?.id) {
    throw new Error("Invalid/expired token");
  }
  return { teacherId: data.user.id, email: data.user.email ?? null };
}

export async function getSubscriptionAccess(
  admin: SupabaseClient,
  teacherId: string,
): Promise<SubscriptionAccess> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("status, is_admin, is_comped")
    .eq("user_id", teacherId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const status = typeof data?.status === "string" ? data.status.toLowerCase() : null;
  const is_admin = data?.is_admin === true;
  const is_comped = data?.is_comped === true;
  const allowed =
    is_admin || is_comped || (status !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(status));
  return { allowed, status, is_admin, is_comped };
}

export async function requireActiveSubscription(
  admin: SupabaseClient,
  teacherId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const access = await getSubscriptionAccess(admin, teacherId);
  if (!access.allowed) {
    return { ok: false, status: 402, error: "Subscription required" };
  }
  return { ok: true };
}

export function mapStripeSubscriptionStatus(status: string | null | undefined): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "trialing") return "trialing";
  return "inactive";
}
