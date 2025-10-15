// src/components/Header.tsx
import { Link, NavLink, useLocation } from "react-router-dom";
import logoLight from "../assets/mvpeav-logo-light.png";

export default function Header() {
  const { pathname } = useLocation();
  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");

  const Tab = ({ to, label, active }: { to: string; label: string; active?: boolean }) => (
    <NavLink
      to={to}
      className={({ isActive }) => `tab${isActive || active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </NavLink>
  );

  return (
    <header className="site-header" data-role="header">
      <div className="inner" style={{ justifyContent: "space-between", gap: 12 }}>
        {/* Brand */}
        <Link
          to="/"
          style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", minWidth: 0 }}
        >
          <img src={logoLight} alt="MVPeav" height={40} />
          <span style={{ fontWeight: 800, letterSpacing: 1, color: "var(--brand-contrast)" }}>MVPEAV</span>
        </Link>

        {/* Sport tabs (scrollable on phones) */}
        <div className="tabbar tabbar-mask" style={{ marginLeft: "auto" }}>
          <Tab to="/cfb" label="CFB" active={inCFB} />
          <Tab to="/cbb" label="CBB" active={inCBB} />
        </div>

        {/* CFB nav (wraps / shrinks on mobile) */}
        <nav
          style={{
            display: "flex",
            gap: 12,
            fontWeight: 600,
            flexWrap: "wrap",
            alignItems: "center",
            color: "var(--brand-contrast)",
            minWidth: 0,
          }}
        >
          <Link to="/cfb/game">Detailed Player</Link>
          <Link to="/cfb/scoreboard">Scoreboard</Link>
          <Link to="/cfb/results">Results</Link>
          <Link to="/cfb/trends-clv">Trends</Link>
        </nav>
      </div>
    </header>
  );
}
