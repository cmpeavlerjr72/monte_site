// src/components/Header.tsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import logoLight from "../assets/mvpeav-logo-light.png";

import SupportButton from "../components/SupportButton";

export default function Header() {
  const { pathname } = useLocation();
  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");
  // Use current sport for all header links; default to CFB on non-sport routes
  const basePath = inCBB ? "/cbb" : "/cfb";

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current || !dropRef.current) return;
      if (!btnRef.current.contains(t) && !dropRef.current.contains(t)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Close on route change
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="site-header" data-role="header">
      <div className="inner header-inner">
        {/* Brand */}
        <Link
          to="/"
          className="brand"
          style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}
        >
          <img src={logoLight} alt="MVPeav" height={40} />
          <span style={{ fontWeight: 800, letterSpacing: 1, color: "var(--brand-contrast)" }}>
            MVPEAV
          </span>
        </Link>

        {/* Sport pills (always visible) */}
        <div className="tabbar">
          <NavLink
            to="/cfb"
            className={({ isActive }) => `tab${isActive || inCFB ? " active" : ""}`}
            aria-current={inCFB ? "page" : undefined}
          >
            CFB
          </NavLink>
          <NavLink
            to="/cbb"
            className={({ isActive }) => `tab${isActive || inCBB ? " active" : ""}`}
            aria-current={inCBB ? "page" : undefined}
          >
            CBB
          </NavLink>

          <SupportButton 
          venmoHandle="Mitchell-Peavler"
          label='Donate'
          triggerVariant="venmo" />

        </div>

        {/* Desktop inline nav (uses active sport basePath) */}
        <nav className="primary-nav">
          <NavLink to={`${basePath}/game`}>Detailed Player</NavLink>
          <NavLink to={`${basePath}/scoreboard`}>Scoreboard</NavLink>
          <NavLink to={`${basePath}/results`}>Results</NavLink>
          <NavLink to={`${basePath}/trends-clv`}>Trends</NavLink>
          <NavLink to={`${basePath}/bracket`}>Bracket</NavLink>
        </nav>

        {/* Mobile hamburger → dropdown (also uses basePath) */}
        <div className="menu-wrap">
          <button
            ref={btnRef}
            className="menu-trigger"
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls="header-menu"
            onClick={() => setOpen(v => !v)}
          >
            <span className="menu-icon" />
          </button>

          <div
            id="header-menu"
            ref={dropRef}
            className={`menu-dropdown${open ? " open" : ""}`}
            role="menu"
          >
            <NavLink to={`${basePath}/game`} role="menuitem">Detailed Player</NavLink>
            <NavLink to={`${basePath}/scoreboard`} role="menuitem">Scoreboard</NavLink>
            <NavLink to={`${basePath}/results`} role="menuitem">Results</NavLink>
            <NavLink to={`${basePath}/trends-clv`} role="menuitem">Trends</NavLink>
            <NavLink to={`${basePath}/bracket`}role='menuitem'>Bracket</NavLink>
          </div>
        </div>
      </div>
    </header>
  );
}
