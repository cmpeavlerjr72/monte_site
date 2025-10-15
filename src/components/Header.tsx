// src/components/Header.tsx
import { Link, NavLink, useLocation } from "react-router-dom";
import logoLight from "../assets/mvpeav-logo-light.png";

export default function Header() {
  const { pathname } = useLocation();
  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");

  const tab = (to: string, label: string, active: boolean) => (
    <NavLink
      to={to}
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: active ? "var(--brand)" : "var(--card)",
        color: active ? "var(--brand-contrast)" : "var(--text)",
        fontWeight: 700,
        textDecoration: "none",
      }}
    >
      {label}
    </NavLink>
  );

  return (
    <header className="header">
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          justifyContent: "space-between",
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src={logoLight} alt="MVPeav" height={40} />
          <span style={{ fontWeight: 800, letterSpacing: 1 }}>MVPEAV</span>
        </Link>

        {/* Sport tabs */}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", marginRight: 16 }}>
          {tab("/cfb", "CFB", inCFB)}
          {tab("/cbb", "CBB", inCBB)}
        </div>

        {/* CFB nav (namespaced so old pages work exactly the same) */}
        <nav style={{ display: "flex", gap: 16, fontWeight: 600 }}>
          <Link to="/cfb/game">Detailed Player</Link>
          <Link to="/cfb/scoreboard">Scoreboard</Link>
          <Link to="/cfb/results">Results</Link>
          <Link to="/cfb/trends-clv">Trends</Link>
          {/* keep these if you use them; otherwise remove */}
          {/* <Link to='/cfb/bestbets'>Best Bets</Link>
          <Link to='/cfb/clv'>CLV</Link> */}
        </nav>
      </div>
    </header>
  );
}
