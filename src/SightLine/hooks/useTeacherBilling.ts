import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

interface UseTeacherBillingOptions {
  authUserId: string | null;
  mode: "teacher" | "student" | "guest";
}

export function useTeacherBilling({
  authUserId,
  mode,
}: UseTeacherBillingOptions) {
  const [subscriptionStatus, setSubscriptionStatus] = useState("inactive");
  const [subscriptionCurrentPeriodEnd, setSubscriptionCurrentPeriodEnd] =
    useState<string | null>(null);
  const [subscriptionIsAdmin, setSubscriptionIsAdmin] = useState(false);
  const [subscriptionIsComped, setSubscriptionIsComped] = useState(false);
  const [subscriptionStripeCustomerId, setSubscriptionStripeCustomerId] =
    useState<string | null>(null);
  const [subscriptionLoadStatus, setSubscriptionLoadStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [subscriptionMessage, setSubscriptionMessage] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState<
    "idle" | "starting" | "redirecting" | "error"
  >("idle");
  const [portalStatus, setPortalStatus] = useState<
    "idle" | "starting" | "redirecting" | "error"
  >("idle");

  const hasActiveSubscription = useMemo(
    () =>
      subscriptionIsAdmin ||
      subscriptionIsComped ||
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus.toLowerCase()),
    [subscriptionStatus, subscriptionIsAdmin, subscriptionIsComped],
  );

  const subscriptionBadgeLabel = useMemo(() => {
    if (subscriptionIsAdmin || subscriptionIsComped) return "Admin/Comped";
    return hasActiveSubscription ? "Active" : "Inactive";
  }, [hasActiveSubscription, subscriptionIsAdmin, subscriptionIsComped]);

  const refreshSubscriptionStatus = useCallback(async () => {
    if (mode !== "teacher" || !authUserId) {
      setSubscriptionStatus("inactive");
      setSubscriptionCurrentPeriodEnd(null);
      setSubscriptionIsAdmin(false);
      setSubscriptionIsComped(false);
      setSubscriptionStripeCustomerId(null);
      setSubscriptionLoadStatus("idle");
      setSubscriptionMessage("");
      return;
    }
    setSubscriptionLoadStatus("loading");
    setSubscriptionMessage("");
    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "status, current_period_end, is_admin, is_comped, stripe_customer_id",
      )
      .eq("user_id", authUserId)
      .maybeSingle();
    if (error) {
      setSubscriptionLoadStatus("error");
      setSubscriptionStatus("inactive");
      setSubscriptionCurrentPeriodEnd(null);
      setSubscriptionIsAdmin(false);
      setSubscriptionIsComped(false);
      setSubscriptionStripeCustomerId(null);
      setSubscriptionMessage(error.message);
      return;
    }
    setSubscriptionStatus(
      typeof data?.status === "string" ? data.status : "inactive",
    );
    setSubscriptionCurrentPeriodEnd(
      typeof data?.current_period_end === "string"
        ? data.current_period_end
        : null,
    );
    setSubscriptionIsAdmin(data?.is_admin === true);
    setSubscriptionIsComped(data?.is_comped === true);
    setSubscriptionStripeCustomerId(
      typeof data?.stripe_customer_id === "string" &&
        data.stripe_customer_id.trim().length > 0
        ? data.stripe_customer_id.trim()
        : null,
    );
    setSubscriptionLoadStatus("loaded");
  }, [mode, authUserId]);

  useEffect(() => {
    if (mode !== "teacher" || !authUserId) {
      setSubscriptionStatus("inactive");
      setSubscriptionCurrentPeriodEnd(null);
      setSubscriptionIsAdmin(false);
      setSubscriptionIsComped(false);
      setSubscriptionStripeCustomerId(null);
      setSubscriptionLoadStatus("idle");
      setSubscriptionMessage("");
      setCheckoutStatus("idle");
      setPortalStatus("idle");
      return;
    }
    void refreshSubscriptionStatus();
  }, [mode, authUserId, refreshSubscriptionStatus]);

  const startCheckout = useCallback(async () => {
    if (mode !== "teacher" || !authUserId) return false;
    setCheckoutStatus("starting");
    setPortalStatus((prev) => (prev === "redirecting" ? prev : "idle"));
    setSubscriptionMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again.");
      const { data: payload, error } = await supabase.functions.invoke(
        "create_checkout_session",
        { body: {} },
      );
      if (error) throw new Error(error.message);
      if (typeof payload.url !== "string" || payload.url.length === 0) {
        throw new Error("Checkout URL missing from response.");
      }
      setCheckoutStatus("redirecting");
      window.location.assign(payload.url);
      return true;
    } catch (error) {
      setCheckoutStatus("error");
      setSubscriptionMessage(
        error instanceof Error ? error.message : "Unable to start checkout.",
      );
      return false;
    }
  }, [mode, authUserId]);

  const startPortalSession = useCallback(async () => {
    if (mode !== "teacher" || !authUserId) return false;
    setPortalStatus("starting");
    setCheckoutStatus((prev) => (prev === "redirecting" ? prev : "idle"));
    setSubscriptionMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again.");
      const { data: payload, error } = await supabase.functions.invoke(
        "create_portal_session",
        { body: {} },
      );
      if (error) throw new Error(error.message);
      if (typeof payload.url !== "string" || payload.url.length === 0) {
        throw new Error("Portal URL missing from response.");
      }
      setPortalStatus("redirecting");
      window.location.assign(payload.url);
      return true;
    } catch (error) {
      setPortalStatus("error");
      setSubscriptionMessage(
        error instanceof Error ? error.message : "Unable to open billing portal.",
      );
      return false;
    }
  }, [mode, authUserId]);

  return {
    subscriptionStatus,
    subscriptionCurrentPeriodEnd,
    subscriptionIsAdmin,
    subscriptionIsComped,
    subscriptionStripeCustomerId,
    subscriptionLoadStatus,
    subscriptionMessage,
    checkoutStatus,
    portalStatus,
    hasActiveSubscription,
    subscriptionBadgeLabel,
    refreshSubscriptionStatus,
    startCheckout,
    startPortalSession,
  };
}
