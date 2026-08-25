// Client for /api/kalshi/cfb — Kalshi market data for the current CFB slate,
// already mapped onto our game slugs by the server.
//
// Everything here degrades quietly: the scoreboard shows the Kalshi row only
// when the feed says available, so a listing gap or an upstream outage removes
// the row instead of breaking the card.

export type KalshiSide = { line: number | null; yes_price: number | null };

/** One strike of a ladder. See the server for the sign conventions. */
export type KalshiRung = { line: number; yes_price: number };

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
};

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
