// src/lib/tailQuotes.ts
//
// PRICING FOR A PAGE THAT IS NOT THE SCOREBOARD.
//
// The Tail button needs one thing per contract: what the sim thinks of it and
// what the book is offering (src/components/TailButton.tsx). On the scoreboard
// that already exists — the page runs `useSuggestions` and every Bets panel
// reads it. The FEED runs nothing: it is a Supabase surface, and the standing
// rule for the account pages was NO data fetches beyond Supabase and the
// portal payload.
//
// The owner lifted that rule for exactly this (2026-09-09): "on the feed page
// build it for the games in view — fetch the week docs for just those games."
// This hook is that fetch, and it is deliberately thin: three week-level files
// (the week index, the Kalshi feed, team_stats.json), all of them already
// cached per week by the loaders they go through, and then THE SAME
// `useSuggestions` compute the scoreboard runs. There is no second pricing
// path here and there must never be one — a tail and a suggestion have to
// agree about a market or the gate is a lie.
//
// TWO NAMESPACES, FIXED. A college-football feed can hold FBS and FCS bets at
// once and they are separate datasets ("2026", "fcs-2026"). Both are loaded
// unconditionally rather than switched on what the feed happens to contain: a
// missing FCS export is a caught 404 and an empty map, and making the fetch
// depend on the feed's contents would make the button's availability depend on
// scroll position.
//
// COSTS NOTHING WHEN NOBODY CAN TRADE. `enabled` is false for a signed-out
// reader or one with no Kalshi credentials, and then not a byte is fetched and
// the compute runs over an empty slate.

import { useEffect, useMemo, useState } from "react";
import { getJsonWeekIndex, type JsonWeekRow } from "./cfbJson";
import { getKalshiCfb, indexKalshiBySlug, type KalshiGame, type KalshiPayload } from "./kalshi";
import { namespaceFor, type Season } from "./cfbData";
import { useTeamStatsDocs } from "./teamStatMarkets";
import { useSuggestions, type SuggestGame } from "./useSuggestions";
import {
  SIZING_DEFAULT, type Candidate, type FeeParams, type Sizing,
} from "./suggestedBets";

/** Re-price on the same cadence the board does: the pregame gate and the
 *  timing bands are clock-dependent, so a game that kicks has to leave the
 *  quotes on its own. */
const TICK_MS = 60_000;

export type TailQuotes = {
  /** `ticker|side` -> the candidate behind it. Empty until the files land. */
  quotes: Map<string, Candidate>;
  feeParams: Record<string, FeeParams>;
  quotedAt: Date;
  loading: boolean;
};

const NO_FEES: Record<string, FeeParams> = {};

export function useTailQuotes({
  season, weekId, unit, sizing = SIZING_DEFAULT, enabled = true,
}: {
  /** Calendar season as an integer — the feed's own column. */
  season: number;
  /** Dataset week directory ("week02"). */
  weekId: string;
  /** The viewer's unit; only sizes rows this hook does not use, but the
   *  compute wants one. */
  unit: number;
  sizing?: Sizing;
  enabled?: boolean;
}): TailQuotes {
  const fbsNs = String(season) as Season;
  const fcsNs = namespaceFor("fcs", fbsNs);
  const on = enabled && Number.isFinite(season) && Boolean(weekId);

  const [rows, setRows] = useState<{ ns: Season; row: JsonWeekRow }[]>([]);
  const [kalshi, setKalshi] = useState<{ ns: Season; payload: KalshiPayload }[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(() => Date.now());

  /** One string, so a re-render with identical content cannot retrigger the
   *  fetch (the render-loop rule — see useSlateEdges' header). */
  const sig = on ? `${fbsNs}|${fcsNs}|${weekId}` : "";

  useEffect(() => {
    if (!sig) { setRows([]); setKalshi([]); return; }
    const ac = new AbortController();
    let alive = true;
    setLoading(true);
    const both = [fbsNs, fcsNs];
    Promise.all([
      Promise.all(both.map((ns) =>
        getJsonWeekIndex(weekId, ns, ac.signal).catch(() => null))),
      Promise.all(both.map((ns) =>
        getKalshiCfb(ns, weekId, ac.signal).catch(() => null))),
    ]).then(([indexes, feeds]) => {
      if (!alive) return;
      const r: { ns: Season; row: JsonWeekRow }[] = [];
      indexes.forEach((list, i) => {
        for (const row of list ?? []) r.push({ ns: both[i], row });
      });
      setRows(r);
      setKalshi(feeds.flatMap((payload, i) =>
        payload ? [{ ns: both[i], payload }] : []));
    }).catch(() => { /* a week with nothing published prices nothing */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; ac.abort(); };
    // fbsNs/fcsNs/weekId are all inside `sig`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [on]);

  /** The published docs, through the page-level loader every other surface
   *  uses. A namespace with no team_stats.json simply has no entry. */
  const docs = useTeamStatsDocs(on ? `${fbsNs},${fcsNs}` : "", weekId);

  /** CARD KEYS. The key only has to be consistent BETWEEN the games list and
   *  the Kalshi map — nothing outside this hook reads it, because the quotes
   *  are keyed by contract. FCS slugs are prefixed for the same reason the
   *  board prefixes them: two datasets, no guarantee their slugs are disjoint. */
  const keyOf = (ns: Season, slug: string) =>
    ns === fbsNs ? slug : `${ns}:${slug}`;

  const games: SuggestGame[] = useMemo(() => rows.map(({ ns, row }) => {
    const ms = row.time_utc ? Date.parse(row.time_utc) : NaN;
    return {
      key: keyOf(ns, row.slug),
      slug: row.slug,
      ns,
      teamA: row.teamA,
      teamB: row.teamB,
      // The live feed is not on this page, so the gate leans on the clock
      // alone: a game whose kickoff has passed drops out by itself.
      started: false,
      kickoffMs: Number.isFinite(ms) ? ms : undefined,
      division: ns === fbsNs ? "fbs" : "fcs",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, fbsNs]);

  const kalshiBySlug = useMemo(() => {
    const m = new Map<string, KalshiGame>();
    for (const { ns, payload } of kalshi) {
      for (const [slug, g] of indexKalshiBySlug(payload)) m.set(keyOf(ns, slug), g);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kalshi, fbsNs]);

  const feeParams = useMemo(() => {
    const out: Record<string, FeeParams> = {};
    for (const { payload } of kalshi) Object.assign(out, payload.fee_params ?? {});
    return Object.keys(out).length ? out : NO_FEES;
  }, [kalshi]);

  /**
   * THE SAME COMPUTE THE BOARD RUNS. Everything below the quotes — selection,
   * the tail band, the filters, the ranking — is computed and thrown away
   * here; only `quoteByTicker` is read. That is deliberate: running the real
   * thing is what guarantees the feed's gate and the panel's rows are the same
   * opinion, and it is a pure memo over files this hook has already fetched.
   */
  const suggestions = useSuggestions({
    games,
    kalshiBySlug,
    feeParams,
    // No portal book on this page: nothing is netted against what the account
    // already holds. It affects SIZING of suggestions, never the candidates.
    portal: null,
    docs,
    unit,
    sizing,
    nowMs: tick,
    nonce: 0,
    modeFilter: "all",
    typeFilter: "all",
    showTails: true,
    sort: "edge",
    edgeRules: true,
  });

  return {
    quotes: suggestions.quoteByTicker,
    feeParams,
    quotedAt: suggestions.computedAt,
    loading,
  };
}
