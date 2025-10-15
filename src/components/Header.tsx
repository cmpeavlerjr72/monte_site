// src/components/Header.tsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import logoLight from "../assets/mvpeav-logo-light.png";

export default function Header() {
  const { pathname } = useLocation();
  const inCFB = pathname.startsWith("/cfb");
  const inCBB = pathname.startsWith("/cbb");
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
        <Link to="/" className="brand" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src={logoLight} alt="MVPeav" height={40} />
          <span style={{ fontWeight: 800, letterSpacing: 1, color: "var(--brand-contrast)" }}>MVPEAV</span>
        </Link>

        {/* Sport pills (always visible) */}
        <div className="tabbar">
          <NavLink to="/cfb" className={({ isActive }) => `tab${isActive || inCFB ? " active" : ""}`} aria-current={inCFB ? "page" : undefined}>CFB</NavLink>
          <NavLink to="/cbb" className={({ isActive }) => `tab${isActive || inCBB ? " active" : ""}`} aria-current={inCBB ? "page" : undefined}>CBB</NavLink>
        </div>

        {/* Desktop inline nav */}
        <nav className="primary-nav">
          <NavLink to="/cfb/game">Detailed Player</NavLink>
          <NavLink to="/cfb/scoreboard">Scoreboard</NavLink>
          <NavLink to="/cfb/results">Results</NavLink>
          <NavLink to="/cfb/trends-clv">Trends</NavLink>
        </nav>

        {/* Mobile hamburger → dropdown */}
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
            <NavLink to="/cfb/game" role="menuitem">Detailed Player</NavLink>
            <NavLink to="/cfb/scoreboard" role="menuitem">Scoreboard</NavLink>
            <NavLink to="/cfb/results" role="menuitem">Results</NavLink>
            <NavLink to="/cfb/trends-clv" role="menuitem">Trends</NavLink>
          </div>
        </div>
      </div>
    </header>
  );
}
