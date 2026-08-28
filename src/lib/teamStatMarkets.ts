// src/lib/teamStatMarkets.ts
//
// The ONE place that relates Kalshi's per-team stat markets to our published
// `team_stats.json` rungs. Both client consumers read this map:
//
//   - SuggestedBets, which prices a live stat quote against a rung, and
//   - the My-Kalshi portal, which prices a HELD stat position against the
//     same rung (before 2026-08-28 it could not, so every rec-yards holding
//     showed "Sim EV —").
//
// A second copy of this mapping is exactly the bug this file exists to
// prevent. It mirrors the server's `KALSHI_STAT_SERIES` by name; if a family
// is added there, add it here in the same change.

import { useEffect, useState } from "react";
import { getTeamStatsCached, type TeamStats } from "./cfbJson";
import type { Season } from "./cfbData";
import type { KalshiGame } from "./kalshi";
import { buildCodeToSlug, parseNcaafTicker } from "./kalshiPortal";

/** Kalshi per-team stat SERIES -> our team_stats.json stat key.
 *
 *  Mirrors `KALSHI_STAT_SERIES` in server/liveScores.ts. Families ABSENT here
 *  are absent on purpose and must stay absent: KXNCAAFTEAMTD counts defensive
 *  and return scores we do not simulate (ours is a FLOOR, not the number),
 *  and KXNCAAFTEAMFG / KXNCAAFTEAMTO are not simulated at all. They resolve to
 *  no stat, so they price to null and render "—" rather than a wrong number. */
export const STAT_FOR_SERIES: Record<string, string> = {
  KXNCAAFTEAMTOTAL: "points",
  KXNCAAFTEAMRECYDS: "rec_yards",
  KXNCAAFTEAMRSHYDS: "rush_yards",
  KXNCAAFTEAMYDS: "total_yards",
  KXNCAAFTEAMREC: "receptions",
  KXNCAAFTEAMRSHATT: "rush_att",
  KXNCAAFTEAMRSHTD: "rush_td",
  KXNCAAFTEAMRECTD: "rec_td",
  KXNCAAFTEAMSACK: "def_sacks",
  KXNCAAFTEAMINT: "def_ints",
};

/** Our stat key -> the Kalshi series that settles it. */
export const SERIES_FOR_STAT: Record<string, string> = Object.fromEntries(
  Object.entries(STAT_FOR_SERIES).map(([series, stat]) => [stat, series]),
);

/** "KXNCAAFTEAMRECYDS-26AUG29UNCTCU-UNC175" -> "KXNCAAFTEAMRECYDS". */
export const seriesOfTicker = (ticker: string): string =>
  String(ticker || "").split("-")[0];

/**
 * The published rung key for a Kalshi strike.
 *
 * Kalshi words a market as "175+" (settles when the stat reaches 175); our
 * exporter writes rungs at the HALF-INTEGER floor, `P(stat > 174.5)`, which
 * is the same event for an integer stat. Verified against the published week
 * (TCU/North Carolina rec_yards): ticker UNC175 -> rung "174.5" -> 0.6715.
 *
 * A strike that is not on the grid returns a key that simply misses, and the
 * caller leaves the probability null. NEVER interpolate — same rule the
 * exporter follows.
 */
export const rungKeyForStrike = (n: number): string => String(n - 0.5);

/* --------------------------- the published docs --------------------------- */

/**
 * `team_stats.json` for every namespace on the slate, keyed by namespace.
 *
 * ONE loader for the whole page: the scoreboard needs it to price held stat
 * positions and SuggestedBets needs it to price live stat quotes, and
 * `getTeamStatsCached` is memoised per (ns, week) so the second consumer
 * costs nothing. Deps are PRIMITIVES only (render-loop rule 1): a
 * comma-joined namespace signature and the week id.
 *
 * A namespace with no published file (FCS always, FBS pre-publish) is a quiet
 * miss, never an error — it just yields no probabilities.
 */
export function useTeamStatsDocs(
  namespaces: string, weekId: string,
): Record<string, TeamStats> {
  const [docs, setDocs] = useState<Record<string, TeamStats>>({});
  useEffect(() => {
    let alive = true;
    for (const ns of namespaces ? namespaces.split(",") : []) {
      getTeamStatsCached(ns as Season, weekId)
        .then((d) => {
          if (alive) setDocs((prev) => (prev[ns] ? prev : { ...prev, [ns]: d }));
        })
        .catch(() => { /* not published for this namespace: no probabilities */ });
    }
    return () => { alive = false; };
  }, [namespaces, weekId]);
  return docs;
}

/* ------------------------- pricing a held position ------------------------ */

/** What the resolver needs to know about one game on the board. */
export type StatGameRef = {
  /** Scoreboard card key — what `kalshiBySlug` is keyed by. */
  key: string;
  /** Published data slug — what `team_stats.json` is keyed by. */
  slug: string;
  ns: Season;
  /** teamA is HOME, matching both the week index and the ticker convention. */
  teamA: string;
  teamB: string;
};

/**
 * Build `ticker -> P(YES)` for the per-team stat families, read VERBATIM off
 * the published rungs.
 *
 * The team side comes from the TICKER, not a name join: an NCAAF event code's
 * team blob is away+home concatenated, so `parseNcaafTicker` already knows
 * whether the strike names the home team — and teamA is home on our side.
 *
 * Returns null (=> the caller shows "—") whenever anything is missing: an
 * excluded family, an unpublished namespace, a game not on this board, or a
 * strike that is not on the rung grid. Null is the honest answer; an
 * interpolated one would not be.
 */
export function buildStatYesP(
  docs: Record<string, TeamStats>,
  games: StatGameRef[],
  kalshiBySlug: Map<string, KalshiGame>,
): (ticker: string) => number | null {
  const codeToKey = buildCodeToSlug(kalshiBySlug);
  const byKey = new Map(games.map((g) => [g.key, g]));
  return (ticker: string): number | null => {
    const stat = STAT_FOR_SERIES[seriesOfTicker(ticker)];
    if (!stat) return null;
    const t = parseNcaafTicker(ticker);
    if (!t || t.n === null || !t.strikeTeam) return null;
    const g = byKey.get(codeToKey.get(t.code) ?? "");
    if (!g) return null;
    const rungs = docs[String(g.ns)]?.games?.[g.slug]?.stats
      ?.[t.strikeIsHome ? g.teamA : g.teamB]?.[stat]?.rungs;
    const p = rungs?.[rungKeyForStrike(t.n)];
    return typeof p === "number" ? p : null;
  };
}

/* ------------------------- pricing a GAME-LINE market --------------------- */

/**
 * Build `ticker -> P(YES)` for the three GAME-LINE families — winner, spread
 * and total — off the published `game` block (exporter schema 2).
 *
 * WHY THIS EXISTS. `buildStatYesP` covers the per-team stat families only, so
 * until 2026-08-28 a KXNCAAFTOTAL / KXNCAAFSPREAD / KXNCAAFGAME ticker priced
 * to null everywhere except where the game's SEED arrays happened to be loaded.
 * The resting-order review runs on that price: a book made mostly of game
 * totals got "— no sim price" on every row and therefore no recommendation at
 * all, which is the one thing that surface exists to give. The held positions'
 * Sim EV had the same hole.
 *
 * NO NEW MATH — and the join needs none. `gameCandidates` (suggestedBets.ts)
 * already reads exactly these rungs off exactly these feed entries, so this
 * walks the SAME feed structures and reads the SAME keys:
 *
 *   winner   the quote's side is the team, so P(YES) is that side's win prob.
 *   spread   the published margin grid is SIGNED HOME-PERSPECTIVE, so the rung
 *            at feed line L is `margin_rungs[String(-L)]`. On a MIRRORED rung
 *            (an away-team market the server flipped to home perspective) the
 *            rung's YES is the raw market's NO, so the raw market's P(YES) is
 *            the complement. Getting that backwards prices the opposite bet at
 *            a plausible-looking number — the worst kind of wrong.
 *   total    the Over is the market's YES: `total_rungs[String(L)]`. Totals are
 *            never mirrored (an over is an over from both ends), which is why
 *            no complement appears here — the same reason `gameCandidates`
 *            takes none.
 *
 * A strike that is not on the published grid, a namespace with no file, and a
 * game not on this board all yield null. NEVER interpolate.
 */
export function buildGameYesP(
  docs: Record<string, TeamStats>,
  games: StatGameRef[],
  kalshiBySlug: Map<string, KalshiGame>,
): (ticker: string) => number | null {
  // Built eagerly, one pass over the board: the feed entry IS the join (it
  // carries the ticker), so there is nothing to parse out of the ticker itself.
  const byTicker = new Map<string, number>();
  for (const g of games) {
    const lines = docs[String(g.ns)]?.games?.[g.slug]?.game;
    const kg = kalshiBySlug.get(g.key);
    if (!lines || !kg) continue;

    for (const q of kg.winner_quotes ?? []) {
      const p = q.side === "A" ? lines.winProbHome : lines.winProbAway;
      if (typeof p === "number" && q.ticker) byTicker.set(q.ticker, p);
    }
    for (const r of kg.spread_ladder ?? []) {
      const p = lines.marginRungs?.[String(-r.line)];
      if (typeof p !== "number" || !r.ticker) continue;
      byTicker.set(r.ticker, r.mirrored ? 1 - p : p);
    }
    for (const r of kg.total_ladder ?? []) {
      const p = lines.totalRungs?.[String(r.line)];
      if (typeof p === "number" && r.ticker) byTicker.set(r.ticker, p);
    }
  }
  return (ticker: string): number | null => {
    const p = byTicker.get(ticker);
    return p === undefined ? null : p;
  };
}
