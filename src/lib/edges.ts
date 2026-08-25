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

import {
  getCompactCached, getPlayersDistCached, getPropsOddsCached, PropsNotPublished,
  type JsonWeekRow,
} from "./cfbJson";
import { propEdge, type PropEdge } from "./propEdge";
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

/** Everything one slate scan produces: game markets AND player props. */
export type SlateScan = {
  byGame: Map<string, GameEdges>;
  /** All priced prop edges on the slate, unsorted. */
  props: PropEdge[];
  /** "ok" once the file loads; "missing" is the expected pre-publish state. */
  propsStatus: "ok" | "missing" | "error";
  /** props_odds.json `updated`, for the staleness note. */
  propsUpdated: string | null;
};

export type GameEdges = {
  slug: string;
  teamA: string;
  teamB: string;
  rows: MarketRow[];
  /**
   * Best SIGNED edge across this game's rows; null when Kalshi priced none.
   *
   * Signed, not absolute: a game whose only large edge is negative means the
   * market likes it more than we do, which is not a reason to surface it. It
   * should sort low, not high.
   */
  bestSigned: number | null;
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
  weekId: string,
  signal?: AbortSignal
): Promise<SlateScan> {
  const out = new Map<string, GameEdges>();

  // Week-level props file, fetched once for the whole slate. A 404 is the
  // expected state until the props pipeline publishes, not a failure.
  let propsOdds: Awaited<ReturnType<typeof getPropsOddsCached>> | null = null;
  let propsStatus: SlateScan["propsStatus"] = "missing";
  try {
    propsOdds = await getPropsOddsCached(season, weekId);
    propsStatus = "ok";
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw err;
    if (!(err instanceof PropsNotPublished) && (err as any)?.name !== "PropsNotPublished") {
      console.warn("[edges] props_odds failed:", err);
      propsStatus = "error";
    }
  }

  const props: PropEdge[] = [];

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

      let bestSigned: number | null = null;
      for (const r of rows) {
        const e = rowEdge(r);
        if (e === null) continue;
        if (bestSigned === null || e > bestSigned) bestSigned = e;
      }

      out.set(g.slug, { slug: g.slug, teamA: g.teamA, teamB: g.teamB, rows, bestSigned });

      // Props for this game, if the week's file quoted any. players_dist is
      // only fetched for games that actually have prop rows.
      const propRows = propsOdds?.byGame.get(g.slug);
      if (!propRows?.length) return;
      try {
        const dist = await getPlayersDistCached(g.row, season);
        if (signal?.aborted) return;
        const byPlayer = new Map(dist.players.map((pl) => [pl.player, pl]));
        for (const row of propRows) {
          const pl = byPlayer.get(row.player);   // canonical name, joins verbatim
          if (!pl) continue;
          const e = propEdge(row, pl.stats[row.stat], {
            slug: g.slug, teamA: g.teamA, teamB: g.teamB, playerTeam: pl.team,
          });
          if (e) props.push(e);
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") throw err;
        console.warn(`[edges] players_dist failed for ${g.slug}:`, err);
      }
    })
  );

  return { byGame: out, props, propsStatus, propsUpdated: propsOdds?.updated ?? null };
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

/** Prop edges ranked by edge descending. */
export function rankProps(props: PropEdge[], limit = 10): PropEdge[] {
  return [...props].sort((a, b) => b.edge - a.edge).slice(0, limit);
}

/** One row of the merged "overall" list: a game market or a player prop. */
export type OverallEntry =
  | { kind: "game"; edge: number; game: EdgeEntry }
  | { kind: "prop"; edge: number; prop: PropEdge };

/** Both pools merged and ranked by signed edge descending. */
export function rankOverall(
  edges: Map<string, GameEdges>,
  props: PropEdge[],
  limit = 10
): OverallEntry[] {
  const all: OverallEntry[] = [
    ...rankEdges(edges, Number.MAX_SAFE_INTEGER).map(
      (g): OverallEntry => ({ kind: "game", edge: g.edge, game: g })
    ),
    ...props.map((p): OverallEntry => ({ kind: "prop", edge: p.edge, prop: p })),
  ];
  all.sort((a, b) => b.edge - a.edge);
  return all.slice(0, limit);
}

/** Hours since the props file was published, for the staleness note. */
export function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}
