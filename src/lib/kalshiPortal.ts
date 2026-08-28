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
  /** Live book on the entry's own market, refreshed with each payload. */
  mkt_yes_bid?: number | null; mkt_yes_ask?: number | null;
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
  mkt_yes_bid?: number | null; mkt_yes_ask?: number | null;
};
export type PortalPayload = {
  fetched_at: string; orders: PortalOrder[]; fills: PortalFill[];
  positions: PortalPosition[];
  /** Order-entry staging state (server's CFB_ORDERS_LIVE). FALSE means the
   *  order routes validate, cap, re-check the book and log — and submit
   *  nothing. The confirm popup wears its DRY RUN badge off this, so the
   *  staging is visible BEFORE the press, not only in the response. Optional
   *  because a server that predates order entry simply omits it. */
  orders_live?: boolean;
};

/** "KXNCAAFSPREAD-26AUG27CARKUTM-UTM4" -> "26AUG27CARKUTM" (else null). */
export function portalGameCode(ticker: string): string | null {
  const parts = String(ticker || "").split("-");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/* ------------------------------ bet metrics ------------------------------ */

export type SeedPair = { A: number[]; B: number[] };

/** Decomposed NCAAF game ticker. The event code's team blob is away+home
 *  concatenated; when the strike names one team, the other is the remainder
 *  and "ends with" tells us the strike team is HOME. */
export function parseNcaafTicker(ticker: string) {
  const p = String(ticker || "").split("-");
  if (p.length < 2) return null;
  const fam = p[0].replace("KXNCAAF", "");
  const code = p[1];
  const strike = p[2] || "";
  const m = strike.match(/^([A-Z]*?)(\d+)$/);
  const strikeTeam = m ? m[1] : (/^[A-Z]+$/.test(strike) ? strike : "");
  const n = m ? Number(m[2]) : null;
  const teams = code.replace(/^\d{2}[A-Z]{3}\d{2}/, "");
  let other = "";
  let strikeIsHome = false;
  if (strikeTeam && teams.endsWith(strikeTeam)) {
    other = teams.slice(0, teams.length - strikeTeam.length);
    strikeIsHome = true;
  } else if (strikeTeam && teams.startsWith(strikeTeam)) {
    other = teams.slice(strikeTeam.length);
  }
  return { fam, code, strike, strikeTeam, n, other, strikeIsHome };
}

/** Label of the outcome the owner is CHEERING for — NO sides are flipped to
 *  the complement bet ("no UND -24.5" reads "LIU +24.5"). */
export function cheerLabel(ticker: string, side: string): string {
  const t = parseNcaafTicker(ticker);
  if (!t) return ticker;
  const no = side === "no";
  const half = t.n !== null ? t.n - 0.5 : null;
  if (t.fam === "TOTAL" && half !== null) return `Total ${no ? "u" : "o"}${half}`;
  if (t.fam === "SPREAD" && half !== null) {
    return no ? `${t.other || "opp"} +${half}` : `${t.strikeTeam} -${half}`;
  }
  if (t.fam === "GAME" && t.strikeTeam) {
    return `${no ? (t.other || "opp") : t.strikeTeam} ML`;
  }
  return `${t.fam} ${t.strike}`.trim();
}

/** P(YES) of one game market under the sim's seed arrays; null = can't. */
export function simYesP(ticker: string, seeds: SeedPair | undefined): number | null {
  const t = parseNcaafTicker(ticker);
  if (!t || !seeds || !seeds.A.length || seeds.A.length !== seeds.B.length) return null;
  const { A, B } = seeds;
  let hit = 0;
  if (t.fam === "TOTAL" && t.n !== null) {
    const line = t.n - 0.5;
    for (let i = 0; i < A.length; i++) if (A[i] + B[i] > line) hit++;
  } else if ((t.fam === "SPREAD" && t.n !== null) || (t.fam === "GAME" && t.strikeTeam)) {
    const line = t.fam === "SPREAD" ? (t.n as number) - 0.5 : 0;
    for (let i = 0; i < A.length; i++) {
      if ((t.strikeIsHome ? A[i] - B[i] : B[i] - A[i]) > line) hit++;
    }
  } else return null;
  return hit / A.length;
}

export function buildCodeToSlug(kalshiBySlug: Map<string, KalshiGame>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [slug, kg] of kalshiBySlug) {
    const code = portalGameCode(kg.event_ticker);
    if (code) out.set(code, slug);
  }
  return out;
}

/** One displayed bet with its money metrics. EVs are $ vs the stake:
 *  p·count − risked. Kalshi p = live mid of the entry's own market, oriented
 *  to the held side; sim p multiplies leg probabilities (independence
 *  approximation on combos). Fees = paid so far (positions only). */
export type PortalBet = {
  key: string; kind: "position" | "order"; combo: boolean;
  label: string; side: string; count: number;
  risked: number; toWin: number; fees: number;
  kalshiP: number | null; kalshiEV: number | null;
  simP: number | null; simEV: number | null;
  slugs: string[]; title?: string;
  /** Legs in the entry (1 = a straight bet). A combo renders on EVERY leg's
   *  card, so the display has to be able to say "3-leg" there. */
  legN: number;
  /** RESTING ORDERS ONLY — the partial-fill picture. `count` is what is still
   *  working, so "38 of 57 filled" needs the other two numbers; the filled 38
   *  come back separately as a held position (positions are the ground truth).
   *  Null on positions. */
  filled: number | null; initial: number | null;
};

export type PortalTotals = {
  n: number; risked: number; toWin: number; fees: number;
  kalshiEV: number | null; simEV: number | null;
  /** How many of the n bets each source could actually price. A summed EV over
   *  a subset must never be presented as if it covered the whole book. */
  simPriced: number; kalshiPriced: number;
};

export function computePortalBets(
  payload: PortalPayload | null,
  kalshiBySlug: Map<string, KalshiGame>,
  seedsBySlug: Map<string, SeedPair>,
  /** P(YES) for market families the SEED arrays cannot price — the per-team
   *  stat ladders, read off the published team_stats rungs (see
   *  `teamStatMarkets.buildStatYesP`). Optional: without it those legs price
   *  to null exactly as they did before 2026-08-28. */
  statYesP?: (ticker: string) => number | null,
): { bets: PortalBet[]; bySlug: Map<string, PortalBet[]>; unmatched: number; totals: PortalTotals } {
  const bets: PortalBet[] = [];
  const bySlug = new Map<string, PortalBet[]>();
  let unmatched = 0;
  const codeToSlug = buildCodeToSlug(kalshiBySlug);
  const slugOf = (tk: string): string | undefined => {
    const t = parseNcaafTicker(tk);
    return t ? codeToSlug.get(t.code) : undefined;
  };

  const push = (
    e: PortalOrder | PortalPosition, kind: PortalBet["kind"],
    count: number | null, price: number | null, fees: number,
    fill?: { filled: number | null; initial: number | null },
  ) => {
    if (count === null || price === null || count <= 0) return;
    const legs = e.legs?.length
      ? e.legs.map((l) => ({ ticker: l.market_ticker, side: l.side }))
      : [{ ticker: e.ticker, side: e.side }];
    const slugs = [...new Set(legs.map((l) => slugOf(l.ticker)).filter(Boolean))] as string[];
    if (!slugs.length) unmatched++;
    const risked = count * price;
    const bid = e.mkt_yes_bid ?? null;
    const ask = e.mkt_yes_ask ?? null;
    // A 0/1 book is EMPTY (nobody quoting), not a 50% opinion.
    const degenerate = (bid ?? 0) <= 0.01 && (ask ?? 1) >= 0.99;
    const mid = degenerate ? null
      : bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask;
    const kalshiP = mid === null ? null : e.side === "no" ? 1 - mid : mid;
    let simP: number | null = 1;
    for (const l of legs) {
      const s = slugOf(l.ticker);
      // Seeds price the GAME lines (total/spread/winner). The per-team stat
      // ladders are not in the seed arrays at all, so they fall through to the
      // published rungs. Either way a NO leg is the complement.
      const py = simYesP(l.ticker, s ? seedsBySlug.get(s) : undefined)
        ?? statYesP?.(l.ticker) ?? null;
      if (py === null) { simP = null; break; }
      simP *= l.side === "no" ? 1 - py : py;
    }
    if (simP !== null && e.legs?.length && e.side === "no") simP = 1 - simP;
    const bet: PortalBet = {
      key: `${kind}:${e.ticker}:${(e as PortalOrder).order_id ?? e.side}`,
      kind, combo: Boolean(e.legs?.length),
      label: e.legs?.length
        ? legs.map((l) => cheerLabel(l.ticker, l.side)).join(" + ")
        : cheerLabel(e.ticker, e.side),
      side: e.side, count, risked, toWin: count - risked, fees,
      kalshiP, kalshiEV: kalshiP === null ? null : kalshiP * count - risked,
      simP, simEV: simP === null ? null : simP * count - risked,
      slugs, title: e.title,
      legN: legs.length,
      filled: fill?.filled ?? null, initial: fill?.initial ?? null,
    };
    bets.push(bet);
    for (const s of slugs) {
      const arr = bySlug.get(s) ?? [];
      arr.push(bet);
      bySlug.set(s, arr);
    }
  };

  if (payload) {
    for (const p of payload.positions) push(p, "position", p.count, p.avg_price, p.fees ?? 0);
    for (const o of payload.orders) {
      push(o, "order", o.remaining, o.side === "no" ? o.no_price : o.yes_price, 0,
           { filled: o.filled, initial: o.initial });
    }
  }

  const totals: PortalTotals = {
    n: bets.length, risked: 0, toWin: 0, fees: 0,
    kalshiEV: null, simEV: null, simPriced: 0, kalshiPriced: 0,
  };
  for (const b of bets) {
    totals.risked += b.risked;
    totals.toWin += b.toWin;
    totals.fees += b.fees;
    if (b.kalshiEV !== null) { totals.kalshiEV = (totals.kalshiEV ?? 0) + b.kalshiEV; totals.kalshiPriced++; }
    if (b.simEV !== null) { totals.simEV = (totals.simEV ?? 0) + b.simEV; totals.simPriced++; }
  }
  return { bets, bySlug, unmatched, totals };
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
