// Slate-wide edge scan.
//
// The card's own market block loads compact.json lazily behind an
// IntersectionObserver, which is right for scrolling but useless for two
// features that need the WHOLE slate at once: sorting by edge, and the Top
// Edges panel. Both call ensureSlateEdges(), which fetches every game's
// compact through the same module-level cache the cards use — so a game
// already on screen costs nothing, and nothing is fetched twice.
//
// ~8 games x ~19KB is a rounding error; a 60-game slate would be ~1MB, which
// is why this is opt-in (triggered by the sort or the panel) rather than eager.

import { getCompactCached, type JsonWeekRow } from "./cfbJson";
import { buildMarketRows, makeSeedCounts, rowEdge, type MarketRow } from "./marketEdge";
import type { KalshiGame } from "./kalshi";
import type { Season } from "./cfbData";

/** What the scan needs from a card, without importing the page's types. */
export type EdgeInput = {
  slug: string;
  teamA: string;
  teamB: string;
  row: JsonWeekRow;
  bookSpread?: number;
  bookTotal?: number;
  simMargin?: number;
  simTotal?: number;
  pHome?: number;
  kickoffMs?: number;
};

export type GameEdges = {
  slug: string;
  teamA: string;
  teamB: string;
  rows: MarketRow[];
  /** Largest |edge| across this game's rows; null when Kalshi priced none. */
  bestAbs: number | null;
};

/** One row lifted out of its game, for the ranked list. */
export type EdgeEntry = {
  slug: string;
  teamA: string;
  teamB: string;
  row: MarketRow;
  edge: number;
};

export async function ensureSlateEdges(
  inputs: EdgeInput[],
  kalshiBySlug: Map<string, KalshiGame>,
  season: Season,
  signal?: AbortSignal
): Promise<Map<string, GameEdges>> {
  const out = new Map<string, GameEdges>();

  await Promise.all(
    inputs.map(async (g) => {
      let counts = null;
      try {
        counts = makeSeedCounts(await getCompactCached(g.row, season));
      } catch (err) {
        if ((err as any)?.name === "AbortError") throw err;
        // A missing compact means sim-only rows, not a failed slate.
        console.warn(`[edges] compact failed for ${g.slug}:`, err);
      }
      if (signal?.aborted) return;

      const rows = buildMarketRows({
        counts,
        teamA: g.teamA,
        teamB: g.teamB,
        bookSpread: g.bookSpread,
        bookTotal: g.bookTotal,
        simMargin: g.simMargin,
        simTotal: g.simTotal,
        pHome: g.pHome,
        kalshi: kalshiBySlug.get(g.slug),
      });

      let bestAbs: number | null = null;
      for (const r of rows) {
        const e = rowEdge(r);
        if (e === null) continue;
        const a = Math.abs(e);
        if (bestAbs === null || a > bestAbs) bestAbs = a;
      }

      out.set(g.slug, { slug: g.slug, teamA: g.teamA, teamB: g.teamB, rows, bestAbs });
    })
  );

  return out;
}

/**
 * Every priced row on the slate, ranked by edge descending.
 *
 * Ranked by SIGNED edge, not absolute: the list is "where the sim likes the
 * bet more than the market does", so a big negative is not a headline.
 */
export function rankEdges(edges: Map<string, GameEdges>, limit = 10): EdgeEntry[] {
  const all: EdgeEntry[] = [];
  for (const g of edges.values()) {
    for (const r of g.rows) {
      const e = rowEdge(r);
      if (e === null) continue;
      all.push({ slug: g.slug, teamA: g.teamA, teamB: g.teamB, row: r, edge: e });
    }
  }
  all.sort((a, b) => b.edge - a.edge);
  return all.slice(0, limit);
}

/** How many rows could be priced at all, for the panel's footer note. */
export function pricedRowCount(edges: Map<string, GameEdges>): { priced: number; total: number } {
  let priced = 0;
  let total = 0;
  for (const g of edges.values()) {
    for (const r of g.rows) {
      total++;
      if (rowEdge(r) !== null) priced++;
    }
  }
  return { priced, total };
}
