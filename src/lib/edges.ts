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
  getTeamMarketsCached, TeamMarketsNotPublished,
  type JsonWeekRow, type TeamMarketRow,
} from "./cfbJson";
import { propEdge, type PropEdge } from "./propEdge";
import { buildMarketRows, makeSeedCounts, rowEdge, type MarketRow } from "./marketEdge";
import type { KalshiGame } from "./kalshi";
import { DatasetUnavailable, type Division, type Season } from "./cfbData";

/** What the scan needs from a card, without importing the page's types. */
export type EdgeInput = {
  /**
   * Identity for this game across the scan, the Kalshi map and the card grid.
   * On a merged FBS+FCS slate this is the card key (FCS games carry a prefix),
   * NOT necessarily row.slug — the two datasets are indexed independently and
   * nothing guarantees their slugs are disjoint.
   */
  slug: string;
  teamA: string;
  teamB: string;
  row: JsonWeekRow;
  /**
   * Dataset namespace this game's files live in ("2026", "fcs-2026").
   * Defaults to the scan-level season, so single-division callers can omit it.
   */
  season?: Season;
  division?: Division;
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
  /** Single-book exports name the book once; shown in the column footer. */
  propsBook: string | null;
  /** Kalshi team-stat/period markets for the week, unsorted. FBS-only — see
   *  cfbJson's team_markets.json note; "missing" covers the FCS namespace too. */
  teamMarkets: TeamMarketRow[];
  teamMarketsStatus: "ok" | "missing" | "error";
  teamMarketsUpdated: string | null;
  teamMarketsTag: string | null;
  teamMarketsWithheld: number;
};

export type GameEdges = {
  slug: string;
  teamA: string;
  teamB: string;
  /** Which dataset the game came from, so a merged ranking can badge it. */
  division?: Division;
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
  division?: Division;
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

  // Two week-level files, fetched once for the whole slate. Both kicked off
  // before either is awaited so they run concurrently with each other (and
  // with the per-game Promise.all below starts right after).
  const propsPromise = getPropsOddsCached(season, weekId);
  const teamMarketsPromise = getTeamMarketsCached(season, weekId);

  // Props: a 404 is the expected state until the props pipeline publishes,
  // not a failure.
  let propsOdds: Awaited<typeof propsPromise> | null = null;
  let propsStatus: SlateScan["propsStatus"] = "missing";
  try {
    propsOdds = await propsPromise;
    propsStatus = "ok";
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw err;
    // "not published" covers two shapes: the file 404s inside a live dataset,
    // or the whole namespace is not up yet (FCS pre-publish). Neither is an
    // error the viewer should see as one.
    const notPublished =
      err instanceof PropsNotPublished ||
      (err as any)?.name === "PropsNotPublished" ||
      err instanceof DatasetUnavailable ||
      (err as any)?.name === "DatasetUnavailable";
    if (!notPublished) {
      console.warn("[edges] props_odds failed:", err);
      propsStatus = "error";
    }
  }

  // Team markets: FBS-only file, so the FCS namespace 404s here forever —
  // same "not published" treatment as props.
  let teamMarketsResult: Awaited<typeof teamMarketsPromise> | null = null;
  let teamMarketsStatus: SlateScan["teamMarketsStatus"] = "missing";
  try {
    teamMarketsResult = await teamMarketsPromise;
    teamMarketsStatus = "ok";
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw err;
    const notPublished =
      err instanceof TeamMarketsNotPublished ||
      (err as any)?.name === "TeamMarketsNotPublished" ||
      err instanceof DatasetUnavailable ||
      (err as any)?.name === "DatasetUnavailable";
    if (!notPublished) {
      console.warn("[edges] team_markets failed:", err);
      teamMarketsStatus = "error";
    }
  }

  const props: PropEdge[] = [];

  await Promise.all(
    inputs.map(async (g) => {
      // Per-game namespace: on a merged FBS+FCS slate the two halves live in
      // different datasets, and getCompactCached keys its memo by it too.
      const gameSeason = g.season ?? season;
      let counts = null;
      try {
        counts = makeSeedCounts(await getCompactCached(g.row, gameSeason));
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

      out.set(g.slug, {
        slug: g.slug, teamA: g.teamA, teamB: g.teamB,
        division: g.division, rows, bestSigned,
      });

      // Props for this game, if the week's file quoted any. players_dist is
      // only fetched for games that actually have prop rows.
      //
      // FCS publishes no props (has_players/has_props false, no props_odds.json
      // in that namespace), so this lookup simply misses for FCS games and the
      // dist fetch below never fires — the flag and the miss agree.
      const propRows = propsOdds?.byGame.get(g.slug);
      if (!propRows?.length) return;
      try {
        const dist = await getPlayersDistCached(g.row, gameSeason);
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

  return {
    byGame: out, props, propsStatus,
    propsUpdated: propsOdds?.updated ?? null,
    propsBook: propsOdds?.book ?? null,
    teamMarkets: teamMarketsResult?.rows ?? [],
    teamMarketsStatus,
    teamMarketsUpdated: teamMarketsResult?.updated ?? null,
    teamMarketsTag: teamMarketsResult?.tag ?? null,
    teamMarketsWithheld: teamMarketsResult?.withheldCount ?? 0,
  };
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
      // rowEdge is null whenever either side is unpriced — which is the normal
      // state for an FCS game with no Kalshi listing and no book line. Such a
      // game is EXCLUDED from the ranking here rather than ranked as NaN.
      const e = rowEdge(r);
      if (e === null) continue;
      all.push({
        slug: g.slug, teamA: g.teamA, teamB: g.teamB,
        division: g.division, row: r, edge: e,
      });
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

/**
 * Site rule (user, 2026-08-26): a market flagged THIN (untradeable quote),
 * TAIL (strike far from the sim median), or NOISE (edge inside the sim's own
 * noise band) is never surfaced as an edge — same spirit as rule 5's
 * zero-stat PMF filter, enforced in the math layer so no view can forget it.
 * Unknown future flags do NOT block: the toolkit only ships flags that
 * document a defect in the QUOTE or the ESTIMATE, and a new one must be
 * added here deliberately.
 */
const BLOCKED_TEAM_MARKET_FLAGS = new Set(["THIN", "TAIL", "NOISE"]);
export const isTradeableTeamMarket = (r: TeamMarketRow): boolean =>
  !r.flags.some((f) => BLOCKED_TEAM_MARKET_FLAGS.has(f));

/* ================= team_stats rungs <-> Kalshi team-stat markets ===========
 * The Team Stats panel overlays live prices on the rungs it already displays.
 * The join and every number it needs live HERE, in the math layer, for the
 * same reason the flag rule does: no view can forget the site rule, and the
 * panel itself stays a formatter.
 * ========================================================================= */

/** Our team_stats stat key -> the Kalshi series that settles the SAME event.
 *
 *  `td_offensive` is deliberately ABSENT. KXNCAAFTEAMTD's rules count every
 *  touchdown a team records and do not exclude defensive or return scores,
 *  which we do not simulate — our stat is a FLOOR for that market, so a price
 *  printed beside it would manufacture a false edge. `fg_made` is absent for
 *  the same class of reason: we publish no number at all. */
export const TEAM_STAT_SERIES: Readonly<Record<string, string>> = {
  points: "KXNCAAFTEAMTOTAL",
  rec_yards: "KXNCAAFTEAMRECYDS",
  rush_td: "KXNCAAFTEAMRSHTD",
  rec_td: "KXNCAAFTEAMRECTD",
};

/** One market quote attached to one (stat, team, strike) rung. */
export type TeamStatQuote = {
  yesBid: number;
  yesAsk: number;
  /** Display price for the YES event ("over K"), i.e. the book's midpoint. */
  mid: number;
  /** False when THIN/TAIL/NOISE — price may show, an EDGE never may. */
  tradeable: boolean;
  flags: string[];
  ticker: string;
};

/** Edge threshold in probability units (3 cents). */
export const TEAM_STAT_EDGE_MIN = 0.03;

/**
 * sim P(over K) minus the market's YES midpoint, or null when there is no
 * edge to show. Null on a flagged quote (site rule) and null below the 3c
 * threshold. `simP` is the rung the panel already displays and the file's own
 * `sim_p` for the same market — the same sim, same tag — so this is one
 * subtraction of two published numbers, never a re-derivation.
 */
export function teamStatEdge(q: TeamStatQuote, simP: number): number | null {
  if (!q.tradeable) return null;
  const e = simP - q.mid;
  return Math.abs(e) >= TEAM_STAT_EDGE_MIN ? e : null;
}

/**
 * Index this game's team-stat markets by `<statKey>|<team>|<strike>`.
 *
 * Team identity for these families lives in the market TITLE, which always
 * leads with the school ("North Carolina scores over 13.5 points"). We match
 * team names taken VERBATIM from team_stats.json (brief rule 1 — nothing is
 * retyped) and, when both names match, keep the LONGER one so a name that is
 * a prefix of its opponent's can never steal the row.
 */
export function indexTeamStatQuotes(
  rows: TeamMarketRow[],
  slug: string,
  teams: string[]
): Map<string, TeamStatQuote> {
  const seriesToStat = new Map<string, string>();
  for (const [stat, series] of Object.entries(TEAM_STAT_SERIES)) {
    seriesToStat.set(series, stat);
  }
  const out = new Map<string, TeamStatQuote>();

  for (const r of rows) {
    if (r.slug !== slug) continue;
    const stat = seriesToStat.get(r.series);
    if (!stat || r.strike === null) continue;

    let team: string | null = null;
    for (const t of teams) {
      if (!r.title.startsWith(t)) continue;
      if (team === null || t.length > team.length) team = t;
    }
    if (!team) continue;

    out.set(`${stat}|${team}|${r.strike}`, {
      yesBid: r.yes_bid,
      yesAsk: r.yes_ask,
      mid: (r.yes_bid + r.yes_ask) / 2,
      tradeable: isTradeableTeamMarket(r),
      flags: r.flags,
      ticker: r.market_ticker,
    });
  }
  return out;
}

/**
 * Team-market rows ranked by fee-adjusted EV descending, optionally within
 * one market family (series). Flagged rows are dropped here (see the site
 * rule above), so every caller gets only placeable edges. The per-series
 * view exists because a single blowout ladder can own the unfiltered top 10
 * (four USC 1H rungs on the first real slate) — each family deserves its
 * own top 10.
 *
 * The export already sorts ev_fee desc, but re-sorting here means a caller
 * never has to trust an external file's ordering silently.
 */
export function rankTeamMarkets(rows: TeamMarketRow[], limit = 10, series?: string): TeamMarketRow[] {
  const pool = rows.filter(isTradeableTeamMarket)
    .filter((r) => (series ? r.series === series : true));
  return [...pool].sort((a, b) => b.ev_fee - a.ev_fee).slice(0, limit);
}


/** Hours since the props file was published, for the staleness note. */
export function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}
