// src/components/AccountMenu.tsx
//
// THE ACCOUNT CONTROL IN THE TOP RIBBON (owner ask 2026-09-08). One button,
// two states, and it is the ONLY entry point to accounts on every page:
//
//   signed out — "Log in / Sign up" opens the AuthPanel in a slide-down under
//                the ribbon. Nothing else about the page changes; the
//                scoreboard, Top Edges and props stay public.
//   signed in  — the username, opening a small menu: My Book, Feed, Profile,
//                Log out. Those are the three account destinations (owner
//                split 2026-09-08) and they are mounted at the TOP level,
//                because an account is sport-agnostic.
//
// Rules:
//
//  * FEATURE FLAG FIRST. Accounts not configured for this build =>
//    `supabaseEnabled` is false and this renders NOTHING. A ribbon button that
//    opens a form that cannot work is worse than no button.
//  * THE PANEL IS THEME-TOKENED. The ribbon itself is brand-coloured and the
//    legacy hamburger dropdown hardcodes white; this panel is a --card surface
//    with --text/--border/--muted so it reads in both themes.
//  * ONE SOURCE OF SESSION TRUTH. `useSession` / `useProfile` — the same hooks
//    every other accounts surface reads. This component decides nothing about
//    who anyone is; it only shows it.

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AuthPanel from "./AuthPanel";
import { supabase, supabaseEnabled, useProfile, useSession } from "../lib/supabase";
import { fetchMySettings } from "../lib/userSettings";

export default function AccountMenu() {
  const { session, loading } = useSession();
  const { profile } = useProfile(session);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click and on Escape — same behaviour as the ribbon's
  // hamburger, so the two menus feel like one control set.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close on navigation (the menu's own links are navigations).
  useEffect(() => { setOpen(false); }, [pathname]);

  // THE SETTINGS MIRROR. The sizing settings live on the account now
  // (src/lib/userSettings.ts), but the scoreboard reads them synchronously
  // from localStorage at mount. This control is on EVERY page, so it is where
  // the account copy is pulled down and mirrored — once per signed-in session,
  // keyed on the uid primitive, and it sets no state of its own, so it cannot
  // drive a render loop.
  const uid = session?.user?.id ?? "";
  useEffect(() => {
    if (!uid) return;
    void fetchMySettings();
  }, [uid]);

  if (!supabaseEnabled) return null;

  const signedIn = Boolean(session && profile);
  const label = loading
    ? "…"
    : signedIn
      ? `${profile?.avatar_emoji || "🏈"} ${profile?.handle}`
      : "Log in";

  return (
    <div className="acct-wrap" ref={wrapRef}>
      <button
        type="button"
        className="acct-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {!signedIn && !loading && <span className="acct-signup"> / Sign up</span>}
      </button>

      {open && (
        <div className="acct-panel" role="menu">
          {signedIn ? (
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ padding: "2px 4px 8px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  {profile?.display_name}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  @{profile?.handle}
                </div>
              </div>
              {/* THREE DESTINATIONS, in the order a signed-in reader wants
                  them: what I have riding, what my friends are on, who I am.
                  Top-level paths — the account is sport-agnostic. */}
              <Link to="/mybook" className="acct-item" role="menuitem">My Book</Link>
              <Link to="/feed" className="acct-item" role="menuitem">Feed</Link>
              <Link to="/me" className="acct-item" role="menuitem">Profile</Link>
              <button
                type="button"
                className="acct-item"
                role="menuitem"
                onClick={() => { setOpen(false); void supabase?.auth.signOut(); }}
                style={{ textAlign: "left", background: "none", border: 0, font: "inherit", cursor: "pointer" }}
              >
                Log out
              </button>
            </div>
          ) : (
            <AuthPanel
              prompt="Log in to post picks, follow your friends and open your dashboard."
              onReady={() => setOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
