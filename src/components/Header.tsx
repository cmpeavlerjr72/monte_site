// src/components/Header.tsx
//
// THE SITE HEADER (2026-10-16 refresh). Navy bar in both themes:
//
//   [MV shield] MVPEAV   CFB  CBB  Fantasy AI  Blog  About   [account] [menu]
//   ---------------------------------------------------------------- gold rule
//   Home  Scoreboard  Record  Quads                          <- section sub-nav
//
// The main nav is the audience-facing product only. Side projects (MLB,
// NASCAR, Tennis, College Baseball) live under Labs: in the menu, the footer
// and /labs; their old URLs are unchanged. The sub-nav row appears inside a
// section that has sub-pages (CFB, CBB, a Labs project).
//
// Mobile (<= 820px): the main nav folds into the menu button, which opens the
// FULL site map (every section, its sub-pages, Labs and Support), not just
// the current section's pages. The sub-nav row stays visible and scrolls
// sideways if it has to.
//
// The site map itself lives in src/lib/siteNav.ts.

import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import shield from "../assets/mv-shield.png";
import AccountMenu from "./AccountMenu";
import { MAIN_NAV, LABS, cfbNav, cbbNav, labsProjectOf, sectionOf, type NavItem } from "../lib/siteNav";

function SubNav({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav className="subnav" aria-label={label}>
      <div className="subnav__inner">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `subnav__link${isActive ? " active" : ""}`}>
            {i.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default function Header() {
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  const labsProject = labsProjectOf(pathname);

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click and Escape; close on navigation.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);

  const sub: { items: NavItem[]; label: string } | null =
    section === "cfb" ? { items: cfbNav(), label: "College football" }
    : section === "cbb" ? { items: cbbNav(), label: "College basketball" }
    : labsProject && labsProject.pages.length > 1 ? { items: labsProject.pages, label: labsProject.name }
    : null;

  return (
    <>
      <header className="site-header" data-role="header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="MVPEAV home">
            <img className="brand__mark" src={shield} alt="" width={33} height={36} />
            <span className="brand__word">MVPEAV</span>
          </Link>

          <nav className="tabbar" aria-label="Main">
            {MAIN_NAV.map((i) => {
              const on = section === i.section;
              return (
                <Link key={i.to} to={i.to} className={`tab${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
                  {i.label}
                </Link>
              );
            })}
          </nav>

          <div className="header-end">
            {/* Accounts: renders nothing when accounts are not configured
                for this build. */}
            <AccountMenu />

            <button
              ref={btnRef}
              type="button"
              className="menu-trigger"
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              <span className={`menu-icon${open ? " is-open" : ""}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div id="site-menu" ref={panelRef} className={`site-menu${open ? " open" : ""}`} hidden={!open}>
          <nav className="site-menu__inner" aria-label="Site">
            <div className="site-menu__col">
              {MAIN_NAV.filter((i) => i.section !== "cfb" && i.section !== "cbb").map((i) => (
                <NavLink key={i.to} to={i.to} className="site-menu__top">{i.label}</NavLink>
              ))}
            </div>
            <div className="site-menu__col">
              <div className="site-menu__head">College football</div>
              {cfbNav().map((i) => <NavLink key={i.to} to={i.to} className="site-menu__link">{i.label}</NavLink>)}
            </div>
            <div className="site-menu__col">
              <div className="site-menu__head">College basketball</div>
              {cbbNav().map((i) => <NavLink key={i.to} to={i.to} className="site-menu__link">{i.label}</NavLink>)}
            </div>
            <div className="site-menu__col">
              <div className="site-menu__head"><Link to="/labs">Labs</Link></div>
              {LABS.map((l) => <NavLink key={l.id} to={l.home} className="site-menu__link">{l.name}</NavLink>)}
            </div>
          </nav>
        </div>
      </header>
      {sub && <SubNav items={sub.items} label={sub.label} />}
    </>
  );
}
