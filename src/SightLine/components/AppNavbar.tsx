import { NavLink } from "react-router-dom";

type AppNavbarProps = {
  modeLabel: "Teacher" | "Student" | "Guest";
  authLabel: string;
  onAuthClick: () => void;
  onBillingAction?: () => void;
  showBillingAction?: boolean;
  billingActionDisabled?: boolean;
  billingActionLabel?: string;
  billingActionTitle?: string;
  isProjectionMode: boolean;
  canAccessClass: boolean;
  theme: "dark" | "light";
  onThemeChange: (next: "dark" | "light") => void;
  interactionDisabled: boolean;
};

export default function AppNavbar({
  modeLabel,
  authLabel,
  onAuthClick,
  onBillingAction,
  showBillingAction = false,
  billingActionDisabled = false,
  billingActionLabel = "Subscription",
  billingActionTitle,
  isProjectionMode,
  canAccessClass,
  theme,
  onThemeChange,
  interactionDisabled,
}: AppNavbarProps): JSX.Element | null {
  if (isProjectionMode) {
    return null;
  }

  return (
    <header className="AppNavBar">
      <nav className="AppNavLinks" aria-label="Main navigation">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `AppNavLink${isActive ? " AppNavLinkActive" : ""}`
          }
          end
        >
          Generator
        </NavLink>
        <NavLink
          to="/guide"
          className={({ isActive }) =>
            `AppNavLink${isActive ? " AppNavLinkActive" : ""}`
          }
        >
          Guide
        </NavLink>
        {canAccessClass ? (
          <NavLink
            to="/class"
            className={({ isActive }) =>
              `AppNavLink${isActive ? " AppNavLinkActive" : ""}`
            }
          >
            Class Access
          </NavLink>
        ) : (
          <span
            className="AppNavLink AppNavLinkDisabled"
            aria-disabled="true"
            title="Class Access is available in Teacher mode"
          >
            Class Access
          </span>
        )}
      </nav>
      <div className="AppNavActions">
        <span className="AppNavMode">{modeLabel} Mode</span>
        {showBillingAction ? (
          <button
            type="button"
            className="AppHistoryButton"
            onClick={onBillingAction}
            disabled={interactionDisabled || billingActionDisabled}
            title={billingActionTitle}
          >
            {billingActionLabel}
          </button>
        ) : null}
        <label className="AppNavThemeField">
          Theme
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as "dark" | "light")}
            aria-label="Theme mode"
            disabled={interactionDisabled}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <button
          type="button"
          className="AppHistoryButton"
          onClick={onAuthClick}
          disabled={interactionDisabled}
        >
          {authLabel}
        </button>
      </div>
    </header>
  );
}
