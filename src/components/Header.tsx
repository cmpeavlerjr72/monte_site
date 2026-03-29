// src/components/Header.tsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import logoLight from "../assets/mvpeav-logo-light.png";

import SupportButton from "../components/SupportButton";

export default function Header() {
  const { pathname } = useLocation();
  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");
  const inMLB = pathname.startsWith("/mlb");
  const inNASCAR = pathname.startsWith("/nascar");
  const inTennis = pathname.startsWith("/tennis");
  const inCollegeBB = pathname.startsWith("/college-baseball");
  // Use current sport for all header links; default to CFB on non-sport routes
  const basePath = inCollegeBB ? "/college-baseball" : inTennis ? "/tennis" : inNASCAR ? "/nascar" : inMLB ? "/mlb" : inCBB ? "/cbb" : "/cfb";

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
          <NavLink
            to="/mlb/scoreboard"
            className={({ isActive }) => `tab${isActive || inMLB ? " active" : ""}`}
            aria-current={inMLB ? "page" : undefined}
          >
            MLB
          </NavLink>
          <NavLink
            to="/nascar"
            className={({ isActive }) => `tab${isActive || inNASCAR ? " active" : ""}`}
            aria-current={inNASCAR ? "page" : undefined}
          >
            NASCAR
          </NavLink>
          <NavLink
            to="/tennis"
            className={({ isActive }) => `tab${isActive || inTennis ? " active" : ""}`}
            aria-current={inTennis ? "page" : undefined}
          >
            Tennis
          </NavLink>
          <NavLink
            to="/college-baseball"
            className={({ isActive }) => `tab${isActive || inCollegeBB ? " active" : ""}`}
            aria-current={inCollegeBB ? "page" : undefined}
          >
            CBASE
          </NavLink>

          <SupportButton 
          venmoHandle="Mitchell-Peavler"
          label='Donate'
          triggerVariant="venmo" />

        </div>

        {/* Desktop inline nav (uses active sport basePath) */}
        <nav className="primary-nav">
          {inCollegeBB ? (
            <NavLink to="/college-baseball/scoreboard">Scoreboard</NavLink>
          ) : inNASCAR ? (
            <>
              <NavLink to="/nascar/predictions">Predictions</NavLink>
              <NavLink to="/nascar/scanner">Scanner</NavLink>
            </>
          ) : inTennis ? (
            <NavLink to="/tennis/predictions">Predictions</NavLink>
          ) : inMLB ? (
            <>
              <NavLink to="/mlb/scoreboard">Scoreboard</NavLink>
              <NavLink to="/mlb/game">Game Detail</NavLink>
            </>
          ) : (
            <>
              <NavLink to={`${basePath}/game`}>Detailed Player</NavLink>
              <NavLink to={`${basePath}/scoreboard`}>Scoreboard</NavLink>
              <NavLink to={`${basePath}/results`}>Results</NavLink>
              <NavLink to={`${basePath}/trends-clv`}>Trends</NavLink>
              <NavLink to={`${basePath}/bracket`}>Bracket</NavLink>
            </>
          )}
        </nav>

        {/* Mobile hamburger -> dropdown (also uses basePath) */}
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
            {inCollegeBB ? (
              <NavLink to="/college-baseball/scoreboard" role="menuitem">Scoreboard</NavLink>
            ) : inNASCAR ? (
              <>
                <NavLink to="/nascar/predictions" role="menuitem">Predictions</NavLink>
                <NavLink to="/nascar/scanner" role="menuitem">Scanner</NavLink>
              </>
            ) : inTennis ? (
              <NavLink to="/tennis/predictions" role="menuitem">Predictions</NavLink>
            ) : inMLB ? (
              <>
                <NavLink to="/mlb/scoreboard" role="menuitem">Scoreboard</NavLink>
                <NavLink to="/mlb/game" role="menuitem">Game Detail</NavLink>
              </>
            ) : (
              <>
                <NavLink to={`${basePath}/game`} role="menuitem">Detailed Player</NavLink>
                <NavLink to={`${basePath}/scoreboard`} role="menuitem">Scoreboard</NavLink>
                <NavLink to={`${basePath}/results`} role="menuitem">Results</NavLink>
                <NavLink to={`${basePath}/trends-clv`} role="menuitem">Trends</NavLink>
                <NavLink to={`${basePath}/bracket`} role="menuitem">Bracket</NavLink>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
