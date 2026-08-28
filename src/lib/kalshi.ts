// Client for /api/kalshi/cfb — Kalshi market data for the current CFB slate,
// already mapped onto our game slugs by the server.
//
// Everything here degrades quietly: the scoreboard shows the Kalshi row only
// when the feed says available, so a listing gap or an upstream outage removes
// the row instead of breaking the card.

export type KalshiSide = { line: number | null; yes_price: number | null };

/** One strike of a ladder. See the server for the sign conventions. */
export type KalshiRung = {
  line: number;
  yes_price: number;
  /** Ticker + both book sides, oriented to THIS rung's YES (the server
   *  mirrors an away-team spread rung's book along with its price). */
  ticker?: string;
  yes_bid?: number | null;
  yes_ask?: number | null;
};

export type KalshiGame = {
  slug: string;
  event_ticker: string;
  /** Implied probabilities, 0..1. teamA = home. */
  winner: { teamA_price: number | null; teamB_price: number | null };
  /** line = total points; yes_price = implied P(over line). */
  total: KalshiSide;
  /** line is HOME-perspective (negative = home favored). */
  spread: KalshiSide;
  /** Every priced strike, so we can quote the BOOK's line rather than Kalshi's. */
  total_ladder: KalshiRung[];
  spread_ladder: KalshiRung[];
  /** LIVE per-team stat-market quotes (KXNCAAFTEAM*), [] when none listed. */
  stat_quotes?: KalshiStatQuote[];
};

/**
 * One live quote on a per-team stat market, already resolved server-side to
 * our team_stats.json stat key and to this game's A/B side — so nothing here
 * needs a name join or a probability of its own.
 */
export type KalshiStatQuote = {
  stat: string;
  /** Kalshi market ticker — joins to the owner's positions/resting orders. */
  ticker?: string;
  side: "A" | "B";
  strike: number;
  yes_bid: number | null;
  yes_ask: number | null;
};

/** A live book judged good enough to quote an EDGE against. */
export type StatBookQuality = {
  mid: number;
  spread: number;
  /** False when one-sided or too wide — price may show, an edge may not. */
  tradeable: boolean;
};

/** Widest book we will still call a price. Beyond this the "mid" is fiction. */
export const STAT_MAX_SPREAD = 0.30;
/** Outside this the sim itself is in its own tail; no edge badge. */
export const STAT_SIM_LO = 0.05;
export const STAT_SIM_HI = 0.95;
/** Minimum |sim − mid| worth badging, in probability units (3 cents). */
export const STAT_EDGE_MIN = 0.03;

/**
 * Judge one live book. This is the LIVE replacement for team_markets.json's
 * precomputed THIN/TAIL/NOISE flags: same intent (never badge an edge against
 * a book that is not really there), expressed as simple comparisons on the
 * quote in hand because a live price has no precomputed flag to carry.
 */
export function statBookQuality(q: KalshiStatQuote, simP: number): StatBookQuality | null {
  const { yes_bid: bid, yes_ask: ask } = q;
  if (bid === null || ask === null) return null;
  const oneSided = bid <= 0 || ask >= 1;
  const spread = ask - bid;
  return {
    mid: (bid + ask) / 2,
    spread,
    tradeable:
      !oneSided && spread <= STAT_MAX_SPREAD &&
      simP >= STAT_SIM_LO && simP <= STAT_SIM_HI,
  };
}

/** Index a game's live stat quotes by `<stat>|<side>|<strike>`. */
export function indexStatQuotes(g: KalshiGame | undefined): Map<string, KalshiStatQuote> {
  const m = new Map<string, KalshiStatQuote>();
  for (const q of g?.stat_quotes ?? []) m.set(`${q.stat}|${q.side}|${q.strike}`, q);
  return m;
}

export type RungMatch = {
  rung: KalshiRung;
  /** True when we had to settle for a neighbouring strike. */
  approx: boolean;
};

/**
 * The rung at `line`, or the nearest one within `tol`.
 *
 * Books and Kalshi do not always list the same strike; quoting Kalshi's own
 * line next to the book's would compare two different bets, so a near miss is
 * returned flagged and the UI annotates it.
 */
export function rungAt(ladder: KalshiRung[] | undefined, line: number, tol = 1.0): RungMatch | null {
  if (!ladder || !ladder.length || !Number.isFinite(line)) return null;
  let best: KalshiRung | null = null;
  let bestDist = Infinity;
  for (const r of ladder) {
    const d = Math.abs(r.line - line);
    if (d < bestDist) { best = r; bestDist = d; }
  }
  if (!best || bestDist > tol) return null;
  return { rung: best, approx: bestDist > 1e-9 };
}

export type KalshiPayload = {
  available: boolean;
  updated: string;
  reason?: string;
  matched?: number;
  unmatched?: string[];
  /** Stat series that failed this build; their quotes are simply absent. */
  degraded_series?: string[];
  /** Retained older payload served after an upstream failure. */
  stale?: boolean;
  /** series ticker -> Kalshi's own fee params. Never hardcode these. */
  fee_params?: Record<string, { fee_type: string; fee_multiplier: number }>;
  games: KalshiGame[];
};

const EMPTY: KalshiPayload = { available: false, updated: "", games: [] };

export async function getKalshiCfb(
  season: string,
  weekId: string,
  signal?: AbortSignal
): Promise<KalshiPayload> {
  try {
    const res = await fetch(
      `/api/kalshi/cfb?season=${encodeURIComponent(season)}&week=${encodeURIComponent(weekId)}`,
      { signal }
    );
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as KalshiPayload;
    return json && typeof json === "object" && Array.isArray(json.games) ? json : EMPTY;
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw err;
    console.warn("[kalshi] feed unavailable:", err);
    return EMPTY;
  }
}

export function indexKalshiBySlug(p: KalshiPayload): Map<string, KalshiGame> {
  const m = new Map<string, KalshiGame>();
  if (!p.available) return m;
  for (const g of p.games) if (g?.slug) m.set(g.slug, g);
  return m;
}
