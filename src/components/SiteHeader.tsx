// src/components/SiteHeader.tsx
import { NavLink, useLocation } from "react-router-dom";

const linkStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  textDecoration: "none",
  fontWeight: 700,
};

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        ...linkStyle,
        background: isActive ? "var(--brand)" : "var(--card)",
        color: isActive ? "var(--brand-contrast)" : "var(--text)",
      })}
    >
      {children}
    </NavLink>
  );
}

export default function SiteHeader() {
  const { pathname } = useLocation();
  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        backdropFilter: "saturate(180%) blur(6px)",
        background: "color-mix(in oklab, var(--card) 94%, transparent)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <NavLink to="/" style={{ textDecoration: "none", fontWeight: 900, fontSize: 18 }}>
          Sports Sim Hub
        </NavLink>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {/* These tabs light up based on pathname */}
          <Tab to="/cfb">{inCFB ? "CFB • Live" : "CFB"}</Tab>
          <Tab to="/cbb">{inCBB ? "CBB • Coming Soon" : "CBB"}</Tab>
        </div>
      </div>
    </header>
  );
}
