// src/lib/useSuggestions.ts
//
// ONE COMPUTE, at the page level.
//
// The owner's suggestions used to be computed inside the Suggested-bets card,
// which was fine while that card was the only surface. It is not any more: the
// ranked INDEX in the My Book console, the "Bets" tab BADGE on every game card
// and the per-game BETS PANEL all have to agree on the same numbers, at the
// same instant, under the same filters. Two consumers each running the memo
// would be two answers.
//
// So the compute lives here and Scoreboard calls it ONCE. Filter/sort state
// lives up there too (initialised from ownerPrefs, written back on change), so
// a chip pressed in a panel moves the index counts and the card badges with it.
//
// Nothing here selects, sizes or prices: that is all `suggestedBets.ts`, the
// read-only twin of `scripts/fbs_maker_pipeline.py`. This module gathers the
// candidates, hands them over, and GROUPS the answer for rendering. If the
// pipeline and this stack ever disagree on SELECTION, the pipeline is right.
//
// ZERO NEW NETWORK LOAD: every input is a feed the page already holds — the
// 45s Kalshi poll, the portal poll, the one page-level team_stats loader.

import { useMemo } from "react";
import type { TeamStats as TeamStatsDoc } from "./cfbJson";
import type { KalshiGame } from "./kalshi";
import type { PortalPayload } from "./kalshiPortal";
import {
  buildSuggestions, gameCandidates, groupLadders, heldCostByTicker,
  statCandidates, pregameVerdict,
  type Candidate, type FeeParams, type LadderGroup, type PregameVerdict,
  type Suggestion, type Suppressed,
} from "./suggestedBets";
// One mapping, three consumers: this compute, the portal's held-position
// pricing, and the panel's "see projection" jump (see teamStatMarkets.ts).
import { SERIES_FOR_STAT } from "./teamStatMarkets";
import type { BetTypeFilter, ModeFilter, SuggestSort } from "./ownerPrefs";
import type { Season } from "./cfbData";

/** Bet-slip wording, not column headings. */
const SHORT: Record<string, string> = {
  points: "points",
  rec_yards: "rec yds",
  rush_yards: "rush yds",
  total_yards: "total yds",
  receptions: "receptions",
  rush_att: "rush att",
  rush_td: "rush TDs",
  rec_td: "rec TDs",
  def_sacks: "sacks",
  def_ints: "INTs",
};

export type SuggestGame = {
  key: string;
  slug: string;
  ns: Season;
  teamA: string;
  teamB: string;
  /** The LIVE FEED's verdict alone: an in-progress event, a post/final state,
   *  or a finals CSV. Never a kick-time test — the clock is the gate's own
   *  second signal (see `pregameVerdict`). */
  started: boolean;
  /** ESPN's raw state ("pre"/"in"/"post"/"final"), or undefined where the feed
   *  never joined this game — which is common, not exceptional. */
  liveState?: string;
  /** Kickoff, epoch ms — the "Soonest" sort key, the pregame gate's clock leg,
   *  and the row's maker/taker timing band. Undefined sorts last. */
  kickoffMs?: number;
};

/** One game's suggestions: what the index ranks and what a panel renders. */
export type SuggestSection = {
  /** The scoreboard CARD KEY (what a jump scrolls to), not the data slug. */
  slug: string;
  game: SuggestGame | undefined;
  /** Real suggestions, best net edge first. */
  groups: LadderGroup[];
  /** The tail band's held-out ladders, only when the reveal is on. */
  tailGroups: LadderGroup[];
  /** Ranked on the REAL suggestions only; a tail-only game sorts last. */
  bestEdge: number;
  kickoffMs: number;
};

export type Suggestions = {
  /** Sections in the chosen order — the index's rows. */
  sections: SuggestSection[];
  /** Card key -> section, for a panel and a tab badge. */
  bySlug: Map<string, SuggestSection>;
  /** Card key -> ladders this game HAS but the filters are hiding. Lets a
   *  panel say "3 hidden" instead of looking empty for no reason. */
  hiddenBySlug: Map<string, number>;
  /** Card key -> tail-band ladders, counted whether or not the reveal is on,
   *  so the toggle line can be honest about what it is holding back. */
  tailCountBySlug: Map<string, number>;
  /** Card key -> why a game is (or is not) suggestible. The panel's empty
   *  state reads this instead of guessing. */
  pregameBySlug: Map<string, PregameVerdict>;
  /** Ladders shown across the slate, after filters. */
  shownCount: number;
  /** Ladders the filters are hiding across the slate. */
  hiddenByFilter: number;
  /** Distinct MARKETS held out by the tail band (slate-wide footer number). */
  tailMarkets: number;
  suppressed: Suppressed[];
  /** Card key -> every priced rung, uncapped (the full-ladder browse). Not
   *  filtered, not gated on a game having picked rows. */
  browseBySlug: Map<string, Suggestion[]>;
  computedAt: Date;
  pregameCount: number;
  blindCount: number;
};

export type SuggestionsInput = {
  /** Pass an EMPTY array for a non-owner: the slate-wide compute must not run
   *  at all without a live portal session. */
  games: SuggestGame[];
  kalshiBySlug: Map<string, KalshiGame>;
  feeParams: Record<string, FeeParams>;
  portal: PortalPayload | null;
  /** Published team_stats per namespace, from the page's ONE loader. */
  docs: Record<string, TeamStatsDoc>;
  /** Dollars of risk per ladder — the owner's unit size. */
  unit: number;
  /** The page's TICKING wall clock (30s). Both time-dependent rules — the
   *  pregame gate and the maker/taker bands — must move on their own, and it
   *  is a dependency of the compute below, which is what makes a game DROP OFF
   *  when it kicks. */
  nowMs: number;
  /** Manual refresh: re-runs the compute against whatever feed the page holds.
   *  Never triggers a fetch of its own. */
  nonce: number;
  modeFilter: ModeFilter;
  typeFilter: BetTypeFilter;
  showTails: boolean;
  sort: SuggestSort;
};

export function useSuggestions({
  games, kalshiBySlug, feeParams, portal, docs, unit, nowMs, nonce,
  modeFilter, typeFilter, showTails, sort,
}: SuggestionsInput): Suggestions {
  const {
    rows, tailRows, tailMarkets, suppressed, browse, computedAt, pregameCount,
    blindCount, verdicts,
  } = useMemo(() => {
    const held = heldCostByTicker(portal?.positions, portal?.orders);
    const candidates: Candidate[] = [];
    // Games that are genuinely pregame, and games dropped for having NEITHER a
    // kickoff time nor a live state — the one refusal a reader could otherwise
    // mistake for "no edges here".
    let nPregame = 0, nBlind = 0;
    const verdictBySlug = new Map<string, PregameVerdict>();
    for (const g of games) {
      // PREGAME ONLY — the rule, its precedence and its reasoning all live in
      // `pregameVerdict`. It runs against the page's ticking clock, so this
      // whole memo re-evaluates every 30s and a game LEAVES the list when it
      // kicks, with or without an ESPN join.
      const verdict = pregameVerdict(g, nowMs);
      verdictBySlug.set(g.key, verdict);
      if (!verdict.ok) {
        if (verdict.reason === "no kickoff time and no live state") nBlind += 1;
        continue;
      }
      nPregame += 1;
      const kg = kalshiBySlug.get(g.key);
      if (!kg) continue;
      // Per-CARD namespace, never the page's season: a merged "Both" slate
      // holds FBS and FCS cards at once and each reads its own dataset.
      const published = docs[String(g.ns)]?.games?.[g.slug];
      if (!published) continue;
      const stats = published.stats;
      if (stats && Object.keys(stats).length) {
        candidates.push(...statCandidates(
          // `key` is what the scoreboard scrolls to; `slug` only indexes the
          // published stats above.
          kg, g.key, g.teamA, g.teamB,
          (stat) => SHORT[stat] ?? stat,
          (team, stat, strike) => {
            // Published rung, read verbatim. No interpolation, no client-side
            // distribution math — a strike off the grid simply has no bet.
            const r = stats[team]?.[stat]?.rungs;
            const v = r?.[String(strike)];
            return typeof v === "number" ? v : null;
          },
          (stat) => SERIES_FOR_STAT[stat] ?? "",
          g.kickoffMs,
        ));
      }
      // Game lines (winner / spread / total). Absent on a week published
      // before exporter schema 2 — quiet, never an error. A game-level-only
      // namespace (FCS: no player sweep, so `stats` is empty by design)
      // contributes THESE and only these.
      if (published.game) {
        candidates.push(...gameCandidates(
          kg, g.key, g.teamA, g.teamB, published.game, g.kickoffMs));
      }
    }
    // ONE clock for the gate above and the timing bands inside: two Date.now()
    // reads a few ms apart can land on opposite sides of a band edge.
    const built = buildSuggestions(candidates, feeParams, held, unit, nowMs);
    return {
      ...built, computedAt: new Date(),
      pregameCount: nPregame, blindCount: nBlind, verdicts: verdictBySlug,
    };
    // `nonce` is the manual refresh: it re-runs the compute against whatever
    // feed the page currently holds, and never triggers a fetch of its own.
    // `nowMs` ticks every 30s upstream, which is what makes a kicked-off game
    // fall out of this list on its own.
  }, [games, kalshiBySlug, feeParams, portal, docs, unit, nonce, nowMs]);

  // Card key -> game, so a same-game run of ladder rows can carry a header
  // and the "Soonest" sort can find a kickoff.
  const gameByKey = useMemo(() => new Map(games.map((g) => [g.key, g])), [games]);

  // Presentation only: fold each ladder's picked rungs (nested markets, up to
  // MAX_RUNGS) into one display row, then FILTER by execution mode and ORDER.
  // Selection and sizing already happened above; none of this touches either,
  // so a filter can never change what a surviving row would cost.
  const allGroups = useMemo(() => groupLadders(rows, unit), [rows, unit]);
  /** Card key -> every priced rung (browse). Independent of the filters and
   *  of whether a game produced any PICKED row — a game with zero selections
   *  still browses. */
  const browseBySlug = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const r of browse) {
      const arr = m.get(r.slug);
      if (arr) arr.push(r); else m.set(r.slug, [r]);
    }
    return m;
  }, [browse]);
  // The tail band's held-out markets, grouped the same way but kept in their
  // OWN list: they are appended under a game's real suggestions when the
  // toggle is on, and never sorted among them.
  const allTailGroups = useMemo(
    () => groupLadders(tailRows, unit), [tailRows, unit]);

  /**
   * ONE SECTION PER GAME. Suggestions concentrate hard — two, three, four
   * ladders on the same matchup is the normal case — so a game is a CONTAINER:
   * its own rows, its own panel, its own row in the index.
   *
   * Sorting orders SECTIONS, never rows across sections — games stay atomic in
   * both orders. Within a section rows are always best-edge first. The mode
   * filter drops ROWS (a ladder can mix REST/TAKE rungs); the bet-type filter
   * drops whole LADDERS (a ladder never mixes series, so its `family` is one
   * value). Both compose — either can empty a section.
   */
  const grouped = useMemo(() => {
    const pass = (g: LadderGroup) => {
      const modeOk = modeFilter === "all" ||
        g.rungs.some((r) => (modeFilter === "rest") === (r.mode === "REST"));
      const typeOk = typeFilter === "all" || g.family === typeFilter;
      return modeOk && typeOk;
    };
    const kept = allGroups.filter(pass);
    // Tails obey the SAME filters — they are a reveal, not an escape hatch.
    const keptTails = allTailGroups.filter(pass);

    // What the filters are hiding, per game. Counted here rather than in a
    // panel so a panel with nothing in it can say WHY in one number.
    const hiddenBySlug = new Map<string, number>();
    for (const g of allGroups) {
      if (pass(g)) continue;
      hiddenBySlug.set(g.slug, (hiddenBySlug.get(g.slug) ?? 0) + 1);
    }
    // Tail ladders per game, counted whether or not the reveal is on.
    const tailCountBySlug = new Map<string, number>();
    for (const g of keptTails) {
      tailCountBySlug.set(g.slug, (tailCountBySlug.get(g.slug) ?? 0) + 1);
    }

    const bySlugRaw = new Map<string, { core: LadderGroup[]; tail: LadderGroup[] }>();
    const slot = (slug: string) => {
      let s = bySlugRaw.get(slug);
      if (!s) { s = { core: [], tail: [] }; bySlugRaw.set(slug, s); }
      return s;
    };
    for (const g of kept) slot(g.slug).core.push(g);
    if (showTails) for (const g of keptTails) slot(g.slug).tail.push(g);

    const out: SuggestSection[] = [...bySlugRaw].map(([slug, { core, tail }]) => {
      const inner = [...core].sort((a, b) => b.bestEdge - a.bestEdge);
      const tails = [...tail].sort((a, b) => b.bestEdge - a.bestEdge);
      return {
        slug,
        game: gameByKey.get(slug),
        groups: inner,
        tailGroups: tails,
        // Ranked on the REAL suggestions only. A game that has nothing but
        // tails sorts last (−Infinity) instead of jumping the queue on the
        // strength of an edge we do not stand behind.
        bestEdge: inner.length ? inner[0].bestEdge : -Infinity,
        // Unknown kickoff sorts LAST rather than first, so a missing time
        // never masquerades as the most urgent game on the board.
        kickoffMs: gameByKey.get(slug)?.kickoffMs ?? Infinity,
      };
    });
    out.sort((a, b) => sort === "soon"
      ? (a.kickoffMs !== b.kickoffMs ? a.kickoffMs - b.kickoffMs : b.bestEdge - a.bestEdge)
      : b.bestEdge - a.bestEdge);

    const bySlug = new Map(out.map((s) => [s.slug, s]));
    const shownCount = out.reduce((n, s) => n + s.groups.length, 0);
    return {
      sections: out, bySlug, hiddenBySlug, tailCountBySlug,
      shownCount, hiddenByFilter: allGroups.length - shownCount,
    };
  }, [allGroups, allTailGroups, showTails, modeFilter, typeFilter, sort, gameByKey]);

  return {
    ...grouped,
    browseBySlug,
    pregameBySlug: verdicts,
    tailMarkets,
    suppressed,
    computedAt,
    pregameCount,
    blindCount,
  };
}
