import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export type TeacherAuthResult =
  | { ok: true; teacherId: string; email: string | null }
  | { ok: false; status: number; error: string };

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export async function verifyTeacherAuth(
  admin: SupabaseClient,
  bearerToken: string | null,
): Promise<TeacherAuthResult> {
  if (!bearerToken) {
    return { ok: false, status: 401, error: "Missing Bearer token" };
  }
  const { data, error } = await admin.auth.getUser(bearerToken);
  if (error || !data.user?.id) {
    return { ok: false, status: 401, error: "Invalid/expired token" };
  }
  return { ok: true, teacherId: data.user.id, email: data.user.email ?? null };
}

export async function requireActiveSubscription(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const status = String(data?.status ?? "inactive").toLowerCase();
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
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
