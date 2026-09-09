// src/lib/bookGames.ts
//
// THE JOIN BEHIND THE SETTLED TREE: a settled Kalshi market -> the published
// game it was on -> that game's OPEN spread, OPEN total, kickoff and
// conference class.
//
// Why it is a title join. Every live surface joins a ticker to a game through
// the Kalshi feed's event code (`buildCodeToSlug`), but the feed polls
// status=open and a SETTLED event has left it — which is exactly the bug that
// hid the settled record for a day (2026-08-28). A page whose entire subject
// is settled bets therefore joins on the server-attached event TITLE, through
// the one name normalizer (`server/cfbNames.pairKeyOf`), with the ±4-day date
// guard from the ticker's own code. `matchGame` in bookTree.ts is that rule,
// pure; this module is the fetching around it.
//
// WHAT IT COSTS. One index.json per (namespace × week) — the file that carries
// teams and kickoff — and then ONE summary.json per game the book actually
// touches, for the odds block. Not the slate's summaries: a book on four games
// must not pull sixty files to read three fields.
//
// PLACED TIMES come from `app_orders`, the app's own order log, read under the
// user's own RLS (own rows always visible). A bet placed by hand on Kalshi or
// by the maker pipeline has no row, so it has no placed time and lands in the
// timing cut's "unknown" bucket — said out loud rather than guessed.

import { useEffect, useMemo, useState } from "react";
import {
  fcsAvailableFor, getCatalog, namespaceFor, resolveLatestSeason, type Season,
} from "./cfbData";
import { getGameSummaryCached, type JsonWeekRow } from "./cfbJson";
import { weekIndexCached } from "./bookPricing";
import { supabase } from "./supabase";
import { pairKeyOf } from "../../server/cfbNames";
import { matchGame, type BookGame } from "./bookTree";
import type { PortalSettlement } from "./kalshiPortal";

/** Kickoff in ms from an index row's `time_utc` (else its date at UTC noon,
 *  which is inside the ±4-day guard either way). Null when it has neither. */
function kickoffOf(row: JsonWeekRow): number | null {
  if (row.time_utc) {
    const t = Date.parse(row.time_utc);
    if (Number.isFinite(t)) return t;
  }
  if (row.date) {
    const t = Date.parse(`${row.date}T12:00:00Z`);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export type BookGamesState = {
  /** pairKey -> game, over every published week of the current season. */
  byPair: Map<string, BookGame>;
  /** False until the first load settles. */
  ready: boolean;
  /** How many of the settlements handed in found a published game, and how
   *  many of THOSE found an open spread. The page prints both: a join rate is
   *  a fact about the data, not a detail. */
  joined: number;
  withLine: number;
  total: number;
};

const EMPTY: BookGamesState = {
  byPair: new Map(), ready: false, joined: 0, withLine: 0, total: 0,
};

/**
 * Every published game of the current season, keyed for the title join, with
 * the odds block filled in for the games this book is on.
 *
 * Keyed on a primitive signature of the settlements (ticker + title), so the
 * 30-second portal poll re-renders without refetching anything.
 */
export function useBookGames(settlements: PortalSettlement[] | null): BookGamesState {
  const [state, setState] = useState<BookGamesState>(EMPTY);
  const sig = useMemo(
    () => (settlements ?? [])
      .map((s) => `${s.ticker}|${s.event_title ?? ""}`)
      .sort()
      .join(","),
    [settlements],
  );

  useEffect(() => {
    if (!sig) { setState(EMPTY); return; }
    let alive = true;
    (async () => {
      const rows = settlements ?? [];
      let season: Season | null = null;
      let weekIds: { ns: Season; weekId: string; week: number }[] = [];
      try {
        const resolved = await resolveLatestSeason();
        season = resolved.season;
        const namespaces: Season[] = [season];
        if (fcsAvailableFor(season)) namespaces.push(namespaceFor("fcs", season));
        const catalog = await getCatalog(season);
        for (const ns of namespaces) {
          for (const w of catalog.weeks) weekIds.push({ ns, weekId: w.id, week: w.week });
        }
      } catch {
        weekIds = [];
      }
      if (!alive) return;

      // ---- every published game, keyed for the title join ----
      const byPair = new Map<string, BookGame>();
      const rowByKey = new Map<string, { row: JsonWeekRow; ns: Season }>();
      await Promise.all(weekIds.map(async (w) => {
        const idx = await weekIndexCached(w.ns, w.weekId);
        if (!idx) return;
        for (const r of idx) {
          const g: BookGame = {
            slug: r.slug, ns: w.ns, weekId: w.weekId, week: w.week,
            home: r.teamA, away: r.teamB,
            kickoffMs: kickoffOf(r),
            openSpread: null, openTotal: null,
            division: String(w.ns).startsWith("fcs") ? "fcs" : "fbs",
          };
          // First week wins a duplicate pair — CFB pairs meet once, and the
          // ±4-day guard in matchGame is what rejects a wrong one anyway.
          const key = pairKeyOf(r.teamA, r.teamB);
          if (!byPair.has(key)) {
            byPair.set(key, g);
            rowByKey.set(`${w.ns}/${r.slug}`, { row: r, ns: w.ns });
          }
        }
      }));
      if (!alive) return;

      // ---- the odds block, for the joined games ONLY ----
      const need = new Set<string>();
      for (const s of rows) {
        const g = matchGame(s, byPair);
        if (g) need.add(`${g.ns}/${g.slug}`);
      }
      await Promise.all([...need].map(async (key) => {
        const hit = rowByKey.get(key);
        if (!hit) return;
        const sum = await getGameSummaryCached(hit.row, hit.ns);
        const g = byPair.get(pairKeyOf(hit.row.teamA, hit.row.teamB));
        if (!g || !sum) return;
        g.openSpread = sum.odds?.spread_open ?? null;
        g.openTotal = sum.odds?.over_under_open ?? null;
        if (sum.division === "fcs" || sum.division === "fbs") g.division = sum.division;
      }));
      if (!alive) return;

      let joined = 0;
      let withLine = 0;
      for (const s of rows) {
        const g = matchGame(s, byPair);
        if (!g) continue;
        joined++;
        if (g.openSpread !== null) withLine++;
      }
      setState({ byPair, ready: true, joined, withLine, total: rows.length });
    })();
    return () => { alive = false; };
    // `settlements` is read through the signature; depending on the array
    // itself would refetch every poll (render-loop rule 1).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return state;
}

/**
 * ticker -> the EARLIEST time this app placed an order on it.
 *
 * Earliest, not latest: the entry timing cut asks when the position was
 * opened, and adding to a position later must not re-date the original bet.
 */
export function usePlacedTimes(userId: string | null): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!supabase || !userId) { setMap(new Map()); return; }
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("app_orders")
        .select("ticker,placed_at")
        .eq("user_id", userId)
        .order("placed_at", { ascending: true })
        .limit(2000);
      if (!alive || error || !Array.isArray(data)) return;
      const out = new Map<string, number>();
      for (const r of data as { ticker: string; placed_at: string }[]) {
        const t = Date.parse(r.placed_at);
        if (!r.ticker || !Number.isFinite(t)) continue;
        if (!out.has(r.ticker)) out.set(r.ticker, t);
      }
      setMap(out);
    })();
    return () => { alive = false; };
  }, [userId]);
  return map;
}
