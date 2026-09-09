// src/lib/bookPricing.ts
//
// SIM PRICING FOR A STANDALONE BOOK PAGE.
//
// /mybook used to hand `computePortalBets` two EMPTY maps, so every held row
// printed "Sim EV —" (owner, 2026-09-09 12:20 AM: "the standalone page never
// loads the sim data the Scoreboard uses to price a held ticker"). This module
// loads exactly what the Scoreboard loads, in the same order, and hands back
// the same four inputs — nothing about the pricing MATH lives here:
//
//   `buildStatYesP`  (teamStatMarkets) — the per-team stat ladders, off the
//                    published team_stats rungs
//   `buildGameYesP`  (teamStatMarkets) — winner / spread / total off the
//                    published `game` block
//   `simYesP`        (kalshiPortal, via `buildPortalYesP`) — the seed arrays,
//                    for the games the book is actually on
//
// WHAT IT FETCHES, and what it deliberately does not:
//
//   per (namespace × week)   the Kalshi feed (/api/kalshi/cfb, server-cached),
//                            the week index.json, team_stats.json
//   per GAME THE BOOK IS ON  compact.json (the seed arrays)
//
// The per-game fetch is scoped to the positions' own games — the whole slate's
// compacts is the megabyte-per-week fetch the JSON layout exists to avoid.
//
// TWO WEEKS, not one. A position placed last week is still open until its game
// kicks, and last week's index/stat docs are what price it, so the current week
// AND the one before it are loaded and their pricers CHAINED. FBS and FCS are
// two datasets with one layout (see AGENT_BRIEF "Divisions"), so both
// namespaces load the same way and merge.
//
// EVERY FAILURE IS A QUIET NULL. An unpublished week, a namespace with no
// dataset, a game with no compact: that bundle simply prices nothing, and the
// row says so in words. Nothing here can take the live book down.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fcsAvailableFor, getCatalog, namespaceFor, resolveLatestSeason, type Season,
} from "./cfbData";
import {
  getCompactCached, getJsonWeekIndex, getTeamStatsCached,
  type JsonWeekRow, type TeamStats,
} from "./cfbJson";
import { getKalshiCfb, indexKalshiBySlug, type KalshiGame } from "./kalshi";
import { buildGameYesP, buildStatYesP, type StatGameRef } from "./teamStatMarkets";
import {
  buildCodeToSlug, parseNcaafTicker,
  type BetGameNames, type PortalPayload, type SeedPair,
} from "./kalshiPortal";

/* ------------------------------------------------------------ week cache --
 * `getJsonWeekIndex` is not memoized upstream (the Scoreboard holds its rows
 * in state instead). This page mounts several consumers of the same index —
 * the pricer and the settled tree — so the promise is cached HERE, per
 * namespace+week, exactly like `getCompactCached` caches a compact. */

const weekIndexPromises = new Map<string, Promise<JsonWeekRow[] | null>>();

/** weeks/<weekId>/index.json rows for one namespace, cached per (ns, week). */
export function weekIndexCached(ns: Season, weekId: string): Promise<JsonWeekRow[] | null> {
  const key = `${ns}/${weekId}`;
  const memo = weekIndexPromises.get(key);
  if (memo) return memo;
  const p = getJsonWeekIndex(weekId, ns)
    .catch(() => null)
    .then((rows) => rows ?? null);
  weekIndexPromises.set(key, p);
  return p;
}

/** One (namespace, week) pair the book might be priced against. */
export type BookWeek = { ns: Season; weekId: string; week: number; label: string };

/**
 * The current week and the one before it, for every namespace that publishes.
 *
 * The catalog is the FBS season's; the FCS dataset publishes the same week
 * directories, so its ids are the FBS ids (a week the FCS export has not
 * reached simply 404s and that bundle prices nothing).
 */
export async function bookWeeks(): Promise<{ season: Season; weeks: BookWeek[] }> {
  const { season, catalog } = await resolveLatestSeason();
  const ordered = [...catalog.weeks].sort((a, b) => a.week - b.week);
  const recent = ordered.slice(-2);
  const namespaces: Season[] = [season];
  if (fcsAvailableFor(season)) namespaces.push(namespaceFor("fcs", season));
  const weeks: BookWeek[] = [];
  for (const ns of namespaces) {
    for (const w of recent) {
      weeks.push({ ns, weekId: w.id, week: w.week, label: w.label });
    }
  }
  return { season, weeks };
}

/** Every NCAAF market ticker the payload touches, legs included. */
export function payloadTickers(payload: PortalPayload | null): string[] {
  if (!payload) return [];
  const out = new Set<string>();
  const entries = [...payload.orders, ...payload.positions];
  for (const e of entries) {
    if (e.legs?.length) for (const l of e.legs) out.add(l.market_ticker);
    else out.add(e.ticker);
  }
  return [...out];
}

/** Distinct Kalshi event codes in the book — the join key, and the signature
 *  an effect can be keyed on without re-running every 30-second poll. */
export function payloadCodes(payload: PortalPayload | null): string[] {
  const codes = new Set<string>();
  for (const tk of payloadTickers(payload)) {
    const t = parseNcaafTicker(tk);
    if (t?.code) codes.add(t.code);
  }
  return [...codes].sort();
}

/** What `computePortalBets` needs, assembled. */
export type BookPricing = {
  /** Merged across namespaces and weeks, re-keyed so two datasets can never
   *  collide on a slug. Keys are opaque; only this module mints them. */
  kalshiBySlug: Map<string, KalshiGame>;
  seeds: Map<string, SeedPair>;
  /** Same keys as `kalshiBySlug` -> the game's real team names. Display-only,
   *  and free: the week index rows the pricer already read carry them. It is
   *  what lets the dashboard's book rows draw the team as its LOGO instead of
   *  the ticker's letter code (owner 2026-09-09). */
  names: Map<string, BetGameNames>;
  statYesP: (ticker: string) => number | null;
  gameYesP: (ticker: string) => number | null;
  /** The (ns, week) pairs that actually answered — for the page's own words. */
  weeks: BookWeek[];
  /** False until the first load settles, so the page can say "pricing…"
   *  instead of printing a book-wide "no sim" that is only not-loaded-yet. */
  ready: boolean;
};

const EMPTY_PRICING: BookPricing = {
  kalshiBySlug: new Map(), seeds: new Map(), names: new Map(),
  statYesP: () => null, gameYesP: () => null,
  weeks: [], ready: false,
};

/** Chain of per-bundle pricers: the first that has an answer wins. Same
 *  precedence `buildPortalYesP` already uses between its own sources. */
const chain = (fns: ((t: string) => number | null)[]) =>
  (ticker: string): number | null => {
    for (const f of fns) {
      const p = f(ticker);
      if (p !== null) return p;
    }
    return null;
  };

/**
 * ONE bundle: one namespace, one week. Everything it returns is scoped to the
 * codes the book actually touches.
 */
async function loadBundle(
  w: BookWeek,
  codes: Set<string>,
): Promise<{
  kalshi: Map<string, KalshiGame>;
  seeds: Map<string, SeedPair>;
  names: Map<string, BetGameNames>;
  statYesP: (t: string) => number | null;
  gameYesP: (t: string) => number | null;
  matched: number;
} | null> {
  const payload = await getKalshiCfb(String(w.ns), w.weekId).catch(() => null);
  const kalshi = payload ? indexKalshiBySlug(payload) : new Map<string, KalshiGame>();
  if (!kalshi.size) return null;

  const codeToSlug = buildCodeToSlug(kalshi);
  const wanted = new Set<string>();
  for (const c of codes) {
    const slug = codeToSlug.get(c);
    if (slug) wanted.add(slug);
  }
  if (!wanted.size) return null;

  const rows = (await weekIndexCached(w.ns, w.weekId)) ?? [];
  const byRowSlug = new Map(rows.map((r) => [r.slug, r]));

  let doc: TeamStats | null = null;
  try { doc = await getTeamStatsCached(w.ns, w.weekId); } catch { doc = null; }
  const docs: Record<string, TeamStats> = doc ? { [String(w.ns)]: doc } : {};

  // The pricers are asked about the games the BOOK is on, no more: they index
  // by ticker, and a ref for a game nothing is held on can only add work.
  const refs: StatGameRef[] = [];
  const names = new Map<string, BetGameNames>();
  for (const slug of wanted) {
    const r = byRowSlug.get(slug);
    if (!r) continue;
    refs.push({ key: slug, slug, ns: w.ns, teamA: r.teamA, teamB: r.teamB });
    names.set(slug, { teamA: r.teamA, teamB: r.teamB });
  }

  // Seed arrays, one compact per game the book is on (never the whole slate).
  const seeds = new Map<string, SeedPair>();
  await Promise.all([...wanted].map(async (slug) => {
    const r = byRowSlug.get(slug);
    if (!r) return;
    try {
      const c = await getCompactCached(r, w.ns);
      if (Array.isArray(c.A_pts) && Array.isArray(c.B_pts) && c.A_pts.length) {
        seeds.set(slug, { A: c.A_pts, B: c.B_pts });
      }
    } catch { /* that game prices off the published rungs, or not at all */ }
  }));

  return {
    kalshi,
    seeds,
    names,
    statYesP: buildStatYesP(docs, refs, kalshi),
    gameYesP: buildGameYesP(docs, refs, kalshi),
    matched: wanted.size,
  };
}

/**
 * The book's sim pricing inputs.
 *
 * Keyed on the CODES in the book (a primitive signature), so the 30-second
 * portal poll re-renders without re-fetching a thing — render-loop rule 1.
 */
export function useBookPricing(payload: PortalPayload | null, enabled = true): BookPricing {
  const [state, setState] = useState<BookPricing>(EMPTY_PRICING);
  const codes = useMemo(() => payloadCodes(payload), [payload]);
  const sig = codes.join(",");
  const codesRef = useRef(codes);
  codesRef.current = codes;

  useEffect(() => {
    if (!enabled || !sig) { setState(EMPTY_PRICING); return; }
    let alive = true;
    (async () => {
      const want = new Set(codesRef.current);
      let weeks: BookWeek[] = [];
      try { weeks = (await bookWeeks()).weeks; } catch { weeks = []; }
      if (!alive) return;

      const bundles = await Promise.all(weeks.map((w) => loadBundle(w, want).catch(() => null)));
      if (!alive) return;

      const kalshiBySlug = new Map<string, KalshiGame>();
      const seeds = new Map<string, SeedPair>();
      const names = new Map<string, BetGameNames>();
      const stats: ((t: string) => number | null)[] = [];
      const games: ((t: string) => number | null)[] = [];
      const answered: BookWeek[] = [];

      bundles.forEach((b, i) => {
        if (!b) return;
        const w = weeks[i];
        // Opaque merged key: two datasets publish independent slug spaces and
        // nothing promises they are disjoint (AGENT_BRIEF, Divisions).
        const keyOf = (slug: string) => `${w.ns}#${w.weekId}#${slug}`;
        for (const [slug, kg] of b.kalshi) kalshiBySlug.set(keyOf(slug), kg);
        for (const [slug, sp] of b.seeds) seeds.set(keyOf(slug), sp);
        for (const [slug, n] of b.names) names.set(keyOf(slug), n);
        stats.push(b.statYesP);
        games.push(b.gameYesP);
        answered.push(w);
      });

      setState({
        kalshiBySlug, seeds, names,
        statYesP: chain(stats), gameYesP: chain(games),
        weeks: answered, ready: true,
      });
    })();
    return () => { alive = false; };
  }, [sig, enabled]);

  return state;
}
