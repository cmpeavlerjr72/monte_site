// Client for /api/kalshi/cfb — Kalshi market data for the current CFB slate,
// already mapped onto our game slugs by the server.
//
// Everything here degrades quietly: the scoreboard shows the Kalshi row only
// when the feed says available, so a listing gap or an upstream outage removes
// the row instead of breaking the card.

export type KalshiSide = { line: number | null; yes_price: number | null };

export type KalshiGame = {
  slug: string;
  event_ticker: string;
  /** Implied probabilities, 0..1. teamA = home. */
  winner: { teamA_price: number | null; teamB_price: number | null };
  /** line = total points; yes_price = implied P(over line). */
  total: KalshiSide;
  /** line is HOME-perspective (negative = home favored). */
  spread: KalshiSide;
};

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
