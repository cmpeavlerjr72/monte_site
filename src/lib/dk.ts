// Client for /api/dk/cfb — DraftKings Predictions (DKeX) as a SECOND VENUE,
// read-only. Same shape as src/lib/kalshi.ts: the server maps DK events onto
// our game slugs; this file fetches, indexes by slug, and finds the DK quote
// for one Bets-tab rung.
//
// NOTHING HERE PLACES AN ORDER. The chip links to DK's own event page and the
// owner trades by hand in their logged-in browser (owner 2026-10-12; DK has
// no public trading API and scripting its session is off the table).
//
// Degrades quietly: no payload, no game, or no matching line = no chip.

import type { Suggestion } from "./suggestedBets";

/** One side of one DK contract. Dollars per $1 contract. */
export type DkQuote = {
  /** DK board selection id. */
  sel: string;
  ticker: string;
  side: "yes" | "no";
  ask: number | null;
  /** Ask + DK's per-contract fee — what a buy actually costs. */
  ask_fee: number | null;
  bid: number | null;
  fee: number | null;
  /** Shares available at the ask. */
  depth: number | null;
};

/** One strike. Quote keys: home/away (spread) or over/under (totals). */
export type DkLineRung = {
  line: number;
  main?: boolean;
  home?: DkQuote;
  away?: DkQuote;
  over?: DkQuote;
  under?: DkQuote;
};

export type DkPeriod = {
  moneyline: { home: DkQuote | null; away: DkQuote | null };
  /** HOME-perspective line (negative = home favored), as Kalshi's ladder. */
  spread: DkLineRung[];
  total: DkLineRung[];
};

export type DkGame = {
  slug: string;
  event_id: string;
  event_seo: string | null;
  /** predictions.draftkings.com event page. */
  url: string;
  start: string | null;
  status: string | null;
  /** DK's team names, already oriented so home = our teamA. */
  home: string;
  away: string;
  game: DkPeriod;
  first_half: DkPeriod;
  first_quarter: DkPeriod;
  team_total: { home: DkLineRung[]; away: DkLineRung[] };
  anytime_td: { player: string; quote: DkQuote }[];
};

export type DkPayload = {
  available: boolean;
  updated: string;
  reason?: string;
  /** "live" = fetched from DK now; "snapshot" = the daily published file. */
  source?: "live" | "snapshot";
  /** When these prices were read. */
  as_of?: string;
  matched?: number;
  unmatched?: string[];
  stale?: boolean;
  games: DkGame[];
};

const EMPTY: DkPayload = { available: false, updated: "", games: [] };

export async function getDkCfb(
  season: string,
  weekId: string,
  signal?: AbortSignal,
): Promise<DkPayload> {
  try {
    const res = await fetch(
      `/api/dk/cfb?season=${encodeURIComponent(season)}&week=${encodeURIComponent(weekId)}`,
      { signal },
    );
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as DkPayload;
    return json && typeof json === "object" && Array.isArray(json.games) ? json : EMPTY;
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw err;
    console.warn("[dk] feed unavailable:", err);
    return EMPTY;
  }
}

export function indexDkBySlug(p: DkPayload): Map<string, DkGame> {
  const m = new Map<string, DkGame>();
  if (!p.available) return m;
  for (const g of p.games) if (g?.slug) m.set(g.slug, g);
  return m;
}

export type DkMatch = {
  quote: DkQuote;
  /** DK's own line for this quote (null for a moneyline). */
  line: number | null;
  /** True when DK does not list the exact strike and a neighbour was used. */
  approx: boolean;
};

/**
 * The quote on `key` side at `line`, or the nearest strike within `tol` —
 * the same rule as kalshi.ts `rungAt` (a near miss is returned flagged so the
 * UI annotates it; anything further is a different bet and returns null).
 */
export function dkRungAt(
  ladder: DkLineRung[] | undefined,
  line: number,
  key: "home" | "away" | "over" | "under",
  tol = 1.0,
): DkMatch | null {
  if (!ladder || !ladder.length || !Number.isFinite(line)) return null;
  let best: DkLineRung | null = null;
  let bestDist = Infinity;
  for (const r of ladder) {
    if (!r[key]) continue;
    const d = Math.abs(r.line - line);
    if (d < bestDist) { best = r; bestDist = d; }
  }
  if (!best || bestDist > tol) return null;
  return { quote: best[key]!, line: best.line, approx: bestDist > 1e-9 };
}

/**
 * DK's quote for the SAME bet as one Bets-tab rung (full-game families only):
 *
 *   KXNCAAFGAME       r.team to win            -> moneyline home/away
 *   KXNCAAFSPREAD     strike = home line L;    -> spread rung L, home side when
 *                     the row backs teamA         the row backs home, else away
 *   KXNCAAFTOTAL      Over/Under r.strike      -> total rung, over/under
 *   KXNCAAFTEAMTOTAL  "<team> K+" (integer K)  -> that team's O/U at K − 0.5
 *
 * Everything else (yardage, receptions, sacks...) has no DK market.
 */
export function dkQuoteForRung(
  r: Suggestion,
  dk: DkGame | undefined,
  homeTeam: string | undefined,
): DkMatch | null {
  if (!dk || !homeTeam) return null;
  const isHome = r.team === homeTeam;
  switch (r.series) {
    case "KXNCAAFGAME": {
      const q = dk.game.moneyline[isHome ? "home" : "away"];
      return q ? { quote: q, line: null, approx: false } : null;
    }
    case "KXNCAAFSPREAD":
      return dkRungAt(dk.game.spread, r.strike, isHome ? "home" : "away");
    case "KXNCAAFTOTAL":
      return dkRungAt(dk.game.total, r.strike, /^Under\b/i.test(r.label) ? "under" : "over");
    case "KXNCAAFTEAMTOTAL":
      return dkRungAt(dk.team_total[isHome ? "home" : "away"], r.strike - 0.5, "over");
    default:
      return null;
  }
}
