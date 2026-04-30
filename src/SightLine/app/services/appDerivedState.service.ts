import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";
import type { MelodyEvent } from "@/SightLine/domain/music";

type AppMode = "teacher" | "student" | "guest";

type RenderableAttack = {
  noteId: string;
  midi: number;
};

type TeacherSubscriptionStateInput = {
  hasActiveSubscription: boolean;
  subscriptionStatus: string;
  subscriptionStripeCustomerId: string | null;
  subscriptionIsAdmin: boolean;
  subscriptionIsComped: boolean;
  checkoutStatus: string;
  portalStatus: string;
};

type NoteKeyFn = (event: MelodyEvent, index: number) => string;

export function getModeLabel(mode: AppMode): "Teacher" | "Student" | "Guest" {
  return mode === "teacher" ? "Teacher" : mode === "student" ? "Student" : "Guest";
}

export function getNavAuthLabel(
  mode: AppMode,
  hasAuthUser: boolean,
): "Sign out" | "Sign In" {
  return mode === "student" || hasAuthUser ? "Sign out" : "Sign In";
}

export function getTeacherFeaturesDisabled(
  mode: AppMode,
  hasActiveSubscription: boolean,
): boolean {
  return mode === "teacher" && !hasActiveSubscription;
}

export function getClimaxNoteIndices(
  projectedDebugSemantics: DebugSemanticsProjection,
): number[] {
  return projectedDebugSemantics.targetNotes.flatMap((note, index) =>
    note.functions.includes("climax") ? [index] : [],
  );
}

export function getSelectedMelodyIndex({
  selectedAttack,
  currentMelody,
  noteKey,
}: {
  selectedAttack: RenderableAttack | null;
  currentMelody: MelodyEvent[];
  noteKey: NoteKeyFn;
}): number {
  if (!selectedAttack || currentMelody.length === 0) return -1;

  return currentMelody.findIndex(
    (event, index) => noteKey(event, index) === selectedAttack.noteId,
  );
}

export function getSelectedEditLabel({
  selectedAttack,
  selectedOriginalAttack,
}: {
  selectedAttack: RenderableAttack | null;
  selectedOriginalAttack: MelodyEvent | null;
}): string {
  if (!selectedAttack || !selectedOriginalAttack) return "Edited: no";

  return selectedAttack.midi === selectedOriginalAttack.midi
    ? "Edited: no"
    : `Edited: MIDI ${selectedOriginalAttack.midi} -> ${selectedAttack.midi}`;
}

export function getBillingActionState({
  mode,
  teacher,
}: {
  mode: AppMode;
  teacher: TeacherSubscriptionStateInput;
}) {
  const subscriptionStatusNormalized = teacher.subscriptionStatus.toLowerCase();
  const hasStripeCustomer = Boolean(teacher.subscriptionStripeCustomerId);

  const hasActiveOrTrialingSubscription =
    subscriptionStatusNormalized === "active" ||
    subscriptionStatusNormalized === "trialing";

  const canManageSubscription =
    teacher.hasActiveSubscription &&
    (hasActiveOrTrialingSubscription || hasStripeCustomer);

  const manageDisabledMissingCustomer =
    teacher.hasActiveSubscription &&
    !canManageSubscription &&
    (teacher.subscriptionIsAdmin || teacher.subscriptionIsComped);

  const subscriptionActionLoading =
    teacher.checkoutStatus === "starting" ||
    teacher.checkoutStatus === "redirecting" ||
    teacher.portalStatus === "starting" ||
    teacher.portalStatus === "redirecting";

  const showBillingAction = mode === "teacher";

  const billingActionLabel = teacher.hasActiveSubscription
    ? teacher.portalStatus === "starting"
      ? "Opening..."
      : "Subscription"
    : teacher.checkoutStatus === "starting"
      ? "Starting..."
      : "Upgrade";

  const billingActionTitle = teacher.hasActiveSubscription
    ? manageDisabledMissingCustomer
      ? "No Stripe customer record for this account"
      : "Open Stripe billing portal"
    : "Start premium access";

  const billingActionDisabled = teacher.hasActiveSubscription
    ? subscriptionActionLoading || manageDisabledMissingCustomer
    : subscriptionActionLoading;

  return {
    showBillingAction,
    billingActionLabel,
    billingActionTitle,
    billingActionDisabled,
    canManageSubscription,
    manageDisabledMissingCustomer,
    subscriptionActionLoading,
  };
}