// src/components/Header.tsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import logoLight from "../assets/mvpeav-logo-light.png";

export default function Header() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header" data-role="header">
      <div className="inner">
        {/* Brand */}
        <Link to="/" className="brand" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src={logoLight} alt="MVPeav" height={40} />
          <span style={{ fontWeight: 800, letterSpacing: 1, color: "var(--brand-contrast)" }}>MVPEAV</span>
        </Link>

        {/* Sport pills (stay visible on mobile) */}
        <div className="tabbar">
          <NavLink to="/cfb" className={({ isActive }) => `tab${isActive || inCFB ? " active" : ""}`} aria-current={inCFB ? "page" : undefined}>
            CFB
          </NavLink>
          <NavLink to="/cbb" className={({ isActive }) => `tab${isActive || inCBB ? " active" : ""}`} aria-current={inCBB ? "page" : undefined}>
            CBB
          </NavLink>
        </div>

        {/* Desktop nav (hidden on mobile) */}
        <nav className="primary-nav">
          <NavLink to="/cfb/game">Detailed Player</NavLink>
          <NavLink to="/cfb/scoreboard">Scoreboard</NavLink>
          <NavLink to="/cfb/results">Results</NavLink>
          <NavLink to="/cfb/trends-clv">Trends</NavLink>
        </nav>

        {/* Mobile hamburger (shown on mobile only) */}
        <button
          className="hamburger-btn"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-drawer"
          onClick={() => setMenuOpen(v => !v)}
        >
          <span className="hamburger-lines" />
        </button>
      </div>

      {/* Mobile drawer */}
      <div
        id="mobile-drawer"
        className={`mobile-drawer${menuOpen ? " open" : ""}`}
        onClick={closeMenu}
      >
        <div className="mobile-drawer-panel" onClick={e => e.stopPropagation()}>
          <div className="mobile-drawer-header">
            <span>Navigate</span>
            <button className="drawer-close" aria-label="Close menu" onClick={closeMenu}>×</button>
          </div>
          <div className="mobile-drawer-links">
            <NavLink to="/cfb/game" onClick={closeMenu}>Detailed Player</NavLink>
            <NavLink to="/cfb/scoreboard" onClick={closeMenu}>Scoreboard</NavLink>
            <NavLink to="/cfb/results" onClick={closeMenu}>Results</NavLink>
            <NavLink to="/cfb/trends-clv" onClick={closeMenu}>Trends</NavLink>
          </div>
        </div>
      </div>
    </header>
  );
}
