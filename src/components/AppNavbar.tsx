import { NavLink } from "react-router-dom";

type AppNavbarProps = {
  modeLabel: "Teacher" | "Student" | "Guest";
  authLabel: string;
  onAuthClick: () => void;
  isProjectionMode: boolean;
  canAccessClass: boolean;
  theme: "dark" | "light";
  onThemeChange: (next: "dark" | "light") => void;
};

export default function AppNavbar({
  modeLabel,
  authLabel,
  onAuthClick,
  isProjectionMode,
  canAccessClass,
  theme,
  onThemeChange,
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
          Melody Generator
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
        <label className="AppNavThemeField">
          Theme
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as "dark" | "light")}
            aria-label="Theme mode"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <button type="button" className="AppHistoryButton" onClick={onAuthClick}>
          {authLabel}
        </button>
      </div>
    </header>
  );
}
