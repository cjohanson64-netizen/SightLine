import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";

type AuthState = ReturnType<typeof useAuth>;
type StudentSessionState = ReturnType<typeof useStudentSession>;
type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;

interface DashboardPageProps {
  auth: AuthState;
  billingNotice: string;
  formatSavedDate: (value: string | null | undefined) => string;
  mode: "teacher" | "student" | "guest";
  modeLabel: "Teacher" | "Student" | "Guest";
  student: StudentSessionState;
  teacher: TeacherLibraryState;
}

export default function DashboardPage({
  auth,
  billingNotice,
  formatSavedDate,
  mode,
  modeLabel,
  student,
  teacher,
}: DashboardPageProps): JSX.Element {
  const subscriptionStatusNormalized = teacher.subscriptionStatus.toLowerCase();
  const subscriptionAllowed = teacher.hasActiveSubscription;
  const hasStripeCustomer = Boolean(teacher.subscriptionStripeCustomerId);
  const hasActiveOrTrialingSubscription =
    subscriptionStatusNormalized === "active" ||
    subscriptionStatusNormalized === "trialing";
  const canManageSubscription =
    subscriptionAllowed &&
    (hasActiveOrTrialingSubscription || hasStripeCustomer);
  const manageDisabledMissingCustomer =
    subscriptionAllowed &&
    !canManageSubscription &&
    (teacher.subscriptionIsAdmin || teacher.subscriptionIsComped);
  const subscriptionActionLoading =
    teacher.checkoutStatus === "starting" ||
    teacher.checkoutStatus === "redirecting" ||
    teacher.portalStatus === "starting" ||
    teacher.portalStatus === "redirecting";

  return (
    <section className="AppRoutePage">
      <h2>Dashboard</h2>
      <div className="AppDashboardGrid">
        <div className="AppDashboardCard">
          <h3>Mode</h3>
          <p className="AppHistoryLabel">{modeLabel} mode active</p>
          <p className="AppHistoryLabel">
            {auth.authUser
              ? `Signed in${auth.authUser.email ? ` as ${auth.authUser.email}` : ""}`
              : "Not signed in"}
          </p>
        </div>
        <div className="AppDashboardCard">
          <h3>Subscription</h3>
          {mode === "teacher" ? (
            <>
              <p className="AppHistoryLabel">
                Status: {teacher.subscriptionBadgeLabel}
              </p>
              {teacher.subscriptionCurrentPeriodEnd ? (
                <p className="AppHistoryLabel">
                  Renews: {formatSavedDate(teacher.subscriptionCurrentPeriodEnd)}
                </p>
              ) : null}
              {teacher.subscriptionIsAdmin || teacher.subscriptionIsComped ? (
                <p className="AppHistoryLabel">Admin/Comped bypass enabled.</p>
              ) : null}
              {!subscriptionAllowed ? (
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.startCheckout()}
                  disabled={subscriptionActionLoading}
                >
                  {teacher.checkoutStatus === "starting" ? "Starting..." : "Upgrade"}
                </button>
              ) : null}
              {subscriptionAllowed ? (
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.startPortalSession()}
                  disabled={subscriptionActionLoading || manageDisabledMissingCustomer}
                  title={
                    manageDisabledMissingCustomer
                      ? "No Stripe customer record for this account"
                      : "Open Stripe billing portal"
                  }
                >
                  {teacher.portalStatus === "starting"
                    ? "Opening..."
                    : "Manage Subscription"}
                </button>
              ) : null}
              {teacher.subscriptionMessage ? (
                <p className="AppHistoryLabel">{teacher.subscriptionMessage}</p>
              ) : null}
            </>
          ) : (
            <p className="AppHistoryLabel">
              Sign in as teacher to manage billing.
            </p>
          )}
        </div>
        <div className="AppDashboardCard">
          <h3>Student Progress</h3>
          {mode === "student" ? (
            <p className="AppHistoryLabel">
              This week: {student.studentProgress.total_minutes} min,{" "}
              {student.studentProgress.total_attempts} attempts
            </p>
          ) : (
            <p className="AppHistoryLabel">
              Join a class to see student progress.
            </p>
          )}
        </div>
        <div className="AppDashboardCard">
          <h3>Teacher Summary</h3>
          {mode === "teacher" ? (
            <p className="AppHistoryLabel">
              Saved exercises: {teacher.savedExercises.length} | Class rows:{" "}
              {teacher.teacherProgressRows.length}
            </p>
          ) : (
            <p className="AppHistoryLabel">
              Sign in as teacher for class analytics.
            </p>
          )}
        </div>
        <div className="AppDashboardCard">
          <h3>Library Snapshot</h3>
          {mode === "teacher" ? (
            <>
              <p className="AppHistoryLabel">
                Active class: {teacher.selectedFolder?.name ?? "None selected"}
              </p>
              <p className="AppHistoryLabel">
                Pending submissions: {teacher.studentSubmissions.length}
              </p>
            </>
          ) : (
            <p className="AppHistoryLabel">
              Teacher library and classroom snapshots appear here in teacher mode.
            </p>
          )}
        </div>
      </div>
      {billingNotice ? <p className="AppHistoryLabel">{billingNotice}</p> : null}
      <div className="AppDashboardActions">
        <Link className="AppHistoryButton" to="/generator">
          Open Melody Generator
        </Link>
        <Link className="AppHistoryButton" to="/class">
          Open Class Access
        </Link>
      </div>
    </section>
  );
}
