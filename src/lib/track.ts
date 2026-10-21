// src/lib/track.ts: first-party traffic analytics (owner 2026-10-18).
//
// One tiny POST to /api/t per page view (every route change) and per key
// click. The server stores path, ?src= tag, referrer host, device class and a
// Cloudflare country code against two random ids made up here:
//   vid = one per device (localStorage), sid = one per tab session
//         (sessionStorage).
// No IP, name, email or user id ever leaves this file. Every storage call is
// wrapped in try/catch and every send is fire-and-forget: analytics must never
// be able to break or slow a page.
//
// SOURCE TAGS: links we post carry ?src=<tag> (x-reply, rsb-potd, cfbvegas...).
// The first tag a session sees is remembered for that session, so a reader who
// lands on /cfb/quads?src=x-quads and then opens three game pages is credited
// to x-quads for all four views.
//
// CLICKS: any element (or ancestor) with data-track="<label>" is logged, and so
// is any link to a sportsbook/exchange (kalshi, draftkings) without one.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "./supabase";

const ENDPOINT = "/api/t";
/** The owner's account (MVPeav). A device signed in as it tags itself once per tab session ("staff:owner"), so the desk's
 *  Metrics can leave that device's visits out (owner 2026-10-21: only MVPeav's own visits shouldn't count). */
const OWNER_UID = "fe22741b-0e66-4ab6-ac40-5b2722a1faf0";

function markOwner(uid: string | undefined) {
  if (uid !== OWNER_UID) return;
  try {
    if (window.sessionStorage.getItem("mv_owner")) return;
    window.sessionStorage.setItem("mv_owner", "1");
  } catch { /* still send once per load */ }
  trackClick("staff:owner");
}
let signedIn = false;
let lastView = "";

function rid(): string {
  try { return crypto.randomUUID().replace(/-/g, "").slice(0, 24); }
  catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function store(kind: "local" | "session", key: string, make: () => string): { value: string; fresh: boolean } {
  try {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    const v = s.getItem(key);
    if (v) return { value: v, fresh: false };
    const n = make();
    s.setItem(key, n);
    return { value: n, fresh: true };
  } catch {
    return { value: make(), fresh: false };
  }
}

function srcTag(): string | null {
  let tag: string | null = null;
  try { tag = new URLSearchParams(window.location.search).get("src"); } catch { /* */ }
  try {
    if (tag) { window.sessionStorage.setItem("mv_src", tag.slice(0, 60)); return tag.slice(0, 60); }
    return window.sessionStorage.getItem("mv_src");
  } catch { return tag; }
}

/** The external referrer, sent only on the session's first view: after that,
 *  document.referrer is just our own previous page or a stale value. */
function referrer(firstOfSession: boolean): string | null {
  if (!firstOfSession) return null;
  try { return document.referrer || null; } catch { return null; }
}

function send(body: Record<string, unknown>) {
  try {
    if (navigator.webdriver) return;
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "omit",
    }).catch(() => { /* never surface */ });
  } catch { /* never surface */ }
}

function ids() {
  const v = store("local", "mv_vid", rid);
  const s = store("session", "mv_sid", rid);
  return { vid: v.value, newVisitor: v.fresh, sid: s.value, newSession: s.fresh };
}

export function trackView(path: string) {
  if (path === lastView) return;          // StrictMode double-effects, same-path re-renders
  lastView = path;
  const { vid, newVisitor, sid, newSession } = ids();
  send({ k: "view", p: path, v: vid, s: sid, n: newVisitor, c: srcTag(), r: referrer(newSession), a: signedIn });
}

export function trackClick(label: string) {
  const { vid, sid } = ids();
  send({ k: "click", p: window.location.pathname + window.location.search, l: label.slice(0, 120), v: vid, s: sid, c: srcTag(), a: signedIn });
}

function outboundLabel(a: HTMLAnchorElement): string | null {
  try {
    const h = new URL(a.href, window.location.href).hostname;
    if (/kalshi\.com$/.test(h)) return "out:kalshi";
    if (/draftkings\.com$/.test(h) || /dkpredictions/.test(h)) return "out:draftkings";
    if (/fanduel\.com$/.test(h)) return "out:fanduel";
    if (/(^|\.)x\.com$|twitter\.com$/.test(h)) return "out:x";
    if (/reddit\.com$/.test(h)) return "out:reddit";
  } catch { /* */ }
  return null;
}

function onClick(ev: MouseEvent) {
  try {
    const el = ev.target as Element | null;
    if (!el || !el.closest) return;
    const tagged = el.closest("[data-track]") as HTMLElement | null;
    if (tagged) { trackClick(tagged.dataset.track || "unlabelled"); return; }
    const a = el.closest("a[href]") as HTMLAnchorElement | null;
    if (a) { const l = outboundLabel(a); if (l) trackClick(l); }
  } catch { /* never surface */ }
}

/** Mount once inside the router (App). Logs a view on every route change and
 *  wires the one document-level click listener. */
export function useTrafficTracking() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    document.addEventListener("click", onClick, { capture: true, passive: true });
    let unsub: (() => void) | undefined;
    try {
      if (supabase) {
        void supabase.auth.getSession().then(({ data }) => { signedIn = Boolean(data.session); markOwner(data.session?.user?.id); });
        const { data } = supabase.auth.onAuthStateChange((_e, s) => { signedIn = Boolean(s); markOwner(s?.user?.id); });
        unsub = () => data.subscription.unsubscribe();
      }
    } catch { /* */ }
    return () => { document.removeEventListener("click", onClick, { capture: true }); unsub?.(); };
  }, []);
  useEffect(() => {
    // strip the src tag from what we record as the page; it is sent separately
    let q = "";
    try {
      const sp = new URLSearchParams(search);
      sp.delete("src");
      const s = sp.toString();
      q = s ? `?${s}` : "";
    } catch { /* */ }
    // small delay so the signed-in state from getSession() lands on the first view
    const t = window.setTimeout(() => trackView(pathname + q), 150);
    return () => window.clearTimeout(t);
  }, [pathname, search]);
}
