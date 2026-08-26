// My-Kalshi portfolio portal client — the owner's resting orders and fills,
// fetched from OUR server's token-gated /api/portfolio/cfb and grouped by
// game so the scoreboard can badge and pin the games the owner has money on.
//
// The token is the owner's shared secret (set as CFB_PORTFOLIO_TOKEN on the
// server). It lives in localStorage as a per-browser convenience — this is a
// single-operator, read-only view; a leaked token exposes the owner's own
// order list, never the ability to trade. All storage access is guarded the
// usePrefs way: failure degrades to logged-out, never a crash.
//
// Ticker -> game join: every Kalshi NCAAF ticker embeds one game code
// ("KXNCAAFSPREAD-26AUG27CARKUTM-UTM4" -> "26AUG27CARKUTM"), and the site's
// KalshiGame rows carry the same code in event_ticker — so the join is a
// string split, not a name parse (the ONE name join stays in cfbNames).

import { useEffect, useRef, useState } from "react";
import type { KalshiGame } from "./kalshi";

const TOKEN_KEY = "cfb.portalToken";
const POLL_MS = 30_000;

export function readPortalToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function writePortalToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — login simply will not persist */
  }
}

/** One leg of a multivariate combo. The combo's own ticker is an opaque
 *  shard hash; these per-game market tickers are what joins to cards. */
export type PortalLeg = { market_ticker: string; side: string };

export type PortalOrder = {
  ticker: string; order_id: string; side: string;
  yes_price: number | null; no_price: number | null;
  initial: number | null; filled: number | null; remaining: number | null;
  created_time: string;
  /** Present on combo entries; the row renders on EVERY leg's card. */
  legs?: PortalLeg[]; title?: string;
};
export type PortalFill = {
  ticker: string; side: string; action: string;
  count: number | null; yes_price: number | null; no_price: number | null;
  fee: number | null; is_taker: boolean; created_time: string;
};
/** Held contracts, computed SERVER-side from /portfolio/positions — the
 *  ground truth for "what filled". Fills alone cannot reconstruct a held
 *  side: Kalshi logs a NO buy as a YES-book "sell". */
export type PortalPosition = {
  ticker: string; side: string; count: number;
  avg_price: number | null; fees: number | null;
  legs?: PortalLeg[]; title?: string;
};
export type PortalPayload = {
  fetched_at: string; orders: PortalOrder[]; fills: PortalFill[];
  positions: PortalPosition[];
};

/** "KXNCAAFSPREAD-26AUG27CARKUTM-UTM4" -> "26AUG27CARKUTM" (else null). */
export function portalGameCode(ticker: string): string | null {
  const parts = String(ticker || "").split("-");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/** Everything the scoreboard shows for one game. */
export type PortalGameBook = {
  orders: PortalOrder[];
  positions: PortalPosition[];
};

/**
 * Group orders/positions by game card key, joining through the slate's own
 * Kalshi map. Tickers whose game code is not on the visible slate (last
 * week's games, a division filtered out) are counted, not shown — the badge
 * strip must never invent a card.
 */
export function groupBookBySlug(
  payload: PortalPayload | null,
  kalshiBySlug: Map<string, KalshiGame>,
): { bySlug: Map<string, PortalGameBook>; unmatched: number } {
  const bySlug = new Map<string, PortalGameBook>();
  if (!payload) return { bySlug, unmatched: 0 };

  const codeToSlug = new Map<string, string>();
  for (const [slug, kg] of kalshiBySlug) {
    const code = portalGameCode(kg.event_ticker);
    if (code) codeToSlug.set(code, slug);
  }

  let unmatched = 0;
  const bookAt = (slug: string): PortalGameBook => {
    let b = bySlug.get(slug);
    if (!b) { b = { orders: [], positions: [] }; bySlug.set(slug, b); }
    return b;
  };
  /** Single market -> its game's book; combo -> the book of EVERY leg whose
   *  game is on the visible slate. Nothing mapped counts once as off-slate. */
  const booksFor = (e: { ticker: string; legs?: PortalLeg[] }): PortalGameBook[] => {
    const tickers = e.legs?.length ? e.legs.map((l) => l.market_ticker) : [e.ticker];
    const slugs = new Set<string>();
    for (const t of tickers) {
      const code = portalGameCode(t);
      const slug = code ? codeToSlug.get(code) : undefined;
      if (slug) slugs.add(slug);
    }
    if (!slugs.size) { unmatched++; return []; }
    return [...slugs].map(bookAt);
  };

  for (const o of payload.orders) for (const b of booksFor(o)) b.orders.push(o);
  for (const p of payload.positions) for (const b of booksFor(p)) b.positions.push(p);
  return { bySlug, unmatched };
}

export type PortalState = {
  payload: PortalPayload | null;
  /** "idle" = no password stored; "error" covers network/500;
   *  "unauthorized" = wrong password (offer re-login); "locked" = too many
   *  failed attempts, server cooling down; "unconfigured" = server has no
   *  CFB_PORTAL_PASSWORD env yet. */
  status: "idle" | "loading" | "ok" | "unauthorized" | "locked" | "unconfigured" | "error";
};

/**
 * Poll the portal while a token is present. The effect depends only on the
 * token string (render-loop rule 1: primitives only in deps).
 */
export function usePortalBook(token: string): PortalState {
  const [state, setState] = useState<PortalState>({ payload: null, status: token ? "loading" : "idle" });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ payload: null, status: "idle" });
      return;
    }
    let alive = true;
    const ac = new AbortController();

    const pull = async () => {
      try {
        const r = await fetch("/api/portfolio/cfb", {
          headers: { "x-cfb-token": token },
          cache: "no-store",
          signal: ac.signal,
        });
        if (!alive) return;
        if (r.status === 401) { setState({ payload: null, status: "unauthorized" }); return; }
        if (r.status === 429) { setState((s) => ({ payload: s.payload, status: "locked" })); return; }
        if (r.status === 503) { setState({ payload: null, status: "unconfigured" }); return; }
        if (!r.ok) { setState((s) => ({ payload: s.payload, status: "error" })); return; }
        const payload = (await r.json()) as PortalPayload;
        if (alive) setState({ payload, status: "ok" });
      } catch (err: any) {
        if (alive && err?.name !== "AbortError") {
          setState((s) => ({ payload: s.payload, status: "error" }));
        }
      }
    };

    setState((s) => ({ payload: s.payload, status: "loading" }));
    pull();
    timer.current = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      ac.abort();
      if (timer.current) clearInterval(timer.current);
    };
  }, [token]);

  return state;
}
