// src/lib/liveGrid.ts
//
// Sim-conditional live overlay: a separate pipeline publishes, per FBS
// week-0 game, a (time x margin) lookup grid of OUR sim's conditional win
// probability / total / margin as `live.json` next to the game's other
// per-game files on the same HuggingFace dataset cfbData/cfbJson already
// read (weeks/<weekId>/games/<slug>/live.json). This module fetches that
// grid and looks a cell up for a given ESPN probability point.
//
// An unpublished live.json is the EXPECTED state (FCS games, past weeks,
// games the exporter has not reached yet) — every failure mode here is a
// quiet `null`, never a thrown error the UI would have to route around.

import { dataUrl, type Season } from "./cfbData";
import { useEffect, useState } from "react";

export type LiveGridCells = {
  time_bin_s: number;
  n_time: number;
  margin_bin: number;
  margin_min: number;
  margin_max: number;
  n_margin: number;
  min_n: number;
  /** [time_idx][margin_idx], home win probability in 0..1, or null below min_n. */
  p_home_win: (number | null)[][];
  mean_total: number[][];
  mean_margin: number[][];
  n: number[][];
};

export type LiveGrid = {
  game_id: number;
  slug: string;
  teamA: string; // home
  teamB: string; // away
  n_sims: number;
  grid: LiveGridCells;
  uncond: {
    p_home_win: number;
    mean_total: number;
    mean_margin: number;
  };
  /** Points still to come from a live state (exports from 2026-10-17). */
  remaining?: Remaining;
};

/** Survival of an integer quantity: v[j] = P(X >= k0 + j) in 0..1; 1 below
 *  k0, 0 past the end (the exporter publishes the full observed range). */
export type Curve = { k0: number; v: number[] };

export type Remaining = {
  time_bin_s: number;
  n_time: number;
  margin_edges: number[];
  /** [time bin][margin bin], null = thin -> use the time row. */
  margin_sf: (Curve | null)[][];
  total_sf: (Curve | null)[][];
  time_margin_sf: (Curve | null)[];
  time_total_sf: (Curve | null)[];
  /** Same, given WHO HAS THE BALL and WHERE (exports from 2026-10-17 pm,
   *  INV-162). Absent on older files -> the clock+score cells above. */
  fp?: RemainingFp;
};

/** [time bin][margin bin][possession 0=A,1=B][field zone] and the
 *  possession-only fallback [time bin][margin bin][possession]. */
export type RemainingFp = {
  zone_edges: number[];
  margin_sf: (Curve | null)[][][][];
  total_sf: (Curve | null)[][][][];
  poss_margin_sf: (Curve | null)[][][];
  poss_total_sf: (Curve | null)[][][];
};

/** The offense, in the SIM's orientation, and its yards to the end zone. */
export type Ball = { side: "A" | "B"; ytg: number };

/** One resolved grid cell, home win probability in 0..1 (NOT 0..100). */
export type GridLookup = {
  pHomeWin: number;
  meanTotal: number;
  meanMargin: number;
  n: number;
  /** 0 = exact cell hit; 1 or 2 = the margin bin had to be widened by that many steps. */
  widened: number;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumMatrix = (v: unknown): v is number[][] =>
  Array.isArray(v) && v.every((row) => Array.isArray(row));

/** Parse + shape-check a raw live.json payload. Malformed -> null (treated like unpublished). */
export function parseLiveGrid(raw: any): LiveGrid | null {
  const g = raw?.grid;
  const u = raw?.uncond;
  if (!g || !u) return null;
  if (!isNumMatrix(g.p_home_win) || !isNumMatrix(g.mean_total) ||
      !isNumMatrix(g.mean_margin) || !isNumMatrix(g.n)) {
    return null;
  }
  if (![g.time_bin_s, g.n_time, g.margin_bin, g.margin_min, g.margin_max, g.n_margin, g.min_n]
    .every(isNum)) {
    return null;
  }
  if (!isNum(u.p_home_win) || !isNum(u.mean_total) || !isNum(u.mean_margin)) return null;

  return {
    game_id: Number(raw.game_id ?? 0),
    slug: String(raw.slug ?? ""),
    teamA: String(raw.teamA ?? ""),
    teamB: String(raw.teamB ?? ""),
    n_sims: Number(raw.n_sims ?? 0),
    grid: {
      time_bin_s: g.time_bin_s,
      n_time: g.n_time,
      margin_bin: g.margin_bin,
      margin_min: g.margin_min,
      margin_max: g.margin_max,
      n_margin: g.n_margin,
      min_n: g.min_n,
      p_home_win: g.p_home_win,
      mean_total: g.mean_total,
      mean_margin: g.mean_margin,
      n: g.n,
    },
    uncond: { p_home_win: u.p_home_win, mean_total: u.mean_total, mean_margin: u.mean_margin },
    remaining: parseRemaining(raw?.remaining && { ...raw.remaining, fp_block: raw?.remaining_fp }),
  };
}

const toCurve = (c: any): Curve | null =>
  c && isNum(c.k0) && Array.isArray(c.v) ? { k0: c.k0, v: c.v.map((x: number) => x / 1000) } : null;

function parseRemaining(r: any): Remaining | undefined {
  if (!r || !isNum(r.time_bin_s) || !isNum(r.n_time) || !Array.isArray(r.margin_edges)) return undefined;
  const grid = (g: any) => (Array.isArray(g) ? g.map((row: any) => (Array.isArray(row) ? row.map(toCurve) : [])) : []);
  const row = (g: any) => (Array.isArray(g) ? g.map(toCurve) : []);
  return {
    time_bin_s: r.time_bin_s, n_time: r.n_time, margin_edges: r.margin_edges,
    margin_sf: grid(r.margin_sf), total_sf: grid(r.total_sf),
    time_margin_sf: row(r.time_margin_sf), time_total_sf: row(r.time_total_sf),
    fp: parseRemainingFp(r.fp_block),
  };
}

/** Packed curve [k0, code]: code = [v0, v0-v1, v1-v2, ...] per-mille, one
 *  char per value (index in `alph`) when < 62, else '-' + 2 base-64 chars. */
function unpackCurve(c: any, alph: string): Curve | null {
  if (!Array.isArray(c) || !isNum(c[0]) || typeof c[1] !== "string") return null;
  const s: string = c[1];
  const v: number[] = [];
  let cur = 0;
  for (let i = 0; i < s.length; ) {
    let x: number;
    if (s[i] === "-") { x = alph.indexOf(s[i + 1]) * 64 + alph.indexOf(s[i + 2]); i += 3; }
    else { x = alph.indexOf(s[i]); i += 1; }
    if (x < 0) return null;
    cur = v.length === 0 ? x : cur - x;
    v.push(cur / 1000);
  }
  return v.length ? { k0: c[0], v } : null;
}

function parseRemainingFp(r: any): RemainingFp | undefined {
  if (!r || typeof r.alph !== "string" || !Array.isArray(r.zone_edges) ||
      !Array.isArray(r.margin_sf) || !Array.isArray(r.poss_margin_sf)) return undefined;
  const a: string = r.alph;
  const deep = (g: any, depth: number): any =>
    depth === 0 ? unpackCurve(g, a) : Array.isArray(g) ? g.map((x: any) => deep(x, depth - 1)) : [];
  return {
    zone_edges: r.zone_edges,
    margin_sf: deep(r.margin_sf, 4), total_sf: deep(r.total_sf, 4),
    poss_margin_sf: deep(r.poss_margin_sf, 3), poss_total_sf: deep(r.poss_total_sf, 3),
  };
}

/* ---------------------- live cover / over / ML pricing ---------------------
 * All in the SIM's orientation: teamA = sim home, margin = A - B.
 *   final = current score + points still to come from this state.
 * Push counts half, the same convention p_home_win uses for a tie. */

function sfAt(c: Curve, k: number): number {
  const j = k - c.k0;
  return j < 0 ? 1 : j >= c.v.length ? 0 : c.v[j];
}
/** P(X > x) + P(X == x)/2 for integer X. */
function pAbove(c: Curve, x: number): number {
  const fl = Math.floor(x);
  const above = sfAt(c, fl + 1);
  return fl === x ? above + 0.5 * (sfAt(c, fl) - above) : above;
}

function marginBin(edges: number[], m: number): number {
  let i = 0;
  while (i < edges.length && m >= edges[i]) i++;
  return i;
}

/** Evaluate f on the curves at the two time-bin midpoints around `elapsed`
 *  and blend linearly. Null when the game has no remaining block. */
const ZERO: Curve = { k0: 0, v: [1] }; // "nothing more is scored"

function atState(
  rem: Remaining, elapsed: number, simMargin: number,
  f: (m: Curve, t: Curve) => number, ot = false, ball?: Ball,
): number | null {
  const mb = marginBin(rem.margin_edges, simMargin);
  // Ball known (scrimmage down, spot, offense): price off who has it and
  // where -- the field-zone cell, else the possession-only cell. Otherwise
  // (kickoffs, breaks, older files) the clock + score cells.
  const fp = !ot && ball && ball.ytg >= 1 && ball.ytg <= 99 ? rem.fp : undefined;
  const pi = ball?.side === "B" ? 1 : 0;
  const zi = fp && ball ? marginBin(fp.zone_edges, ball.ytg) : 0;
  const val = (tb: number): number | null => {
    if (fp) {
      const fm = fp.margin_sf[tb]?.[mb]?.[pi]?.[zi], ft = fp.total_sf[tb]?.[mb]?.[pi]?.[zi];
      if (fm && ft) return f(fm, ft);
      const pm = fp.poss_margin_sf[tb]?.[mb]?.[pi], pt = fp.poss_total_sf[tb]?.[mb]?.[pi];
      if (pm && pt) return f(pm, pt);
    }
    const m = rem.margin_sf[tb]?.[mb] ?? rem.time_margin_sf[tb];
    const t = rem.total_sf[tb]?.[mb] ?? rem.time_total_sf[tb];
    return m && t ? f(m, t) : null;
  };
  const w = rem.time_bin_s;
  const pos = clamp((elapsed - w / 2) / w, 0, rem.n_time - 1);
  const lo = Math.floor(pos);
  const a = val(lo);
  // Past the last bin midpoint the data stops a minute short of the gun:
  // fade the remaining-points distribution into "nothing more is scored"
  // by 60:00. Not for a tied game or OT, where overtime points are real
  // (the tied late cells carry them).
  const lastMid = (rem.n_time - 1) * w + w / 2;
  if (elapsed > lastMid && a !== null && simMargin !== 0 && !ot) {
    const keep = clamp((rem.n_time * w - elapsed) / (rem.n_time * w - lastMid), 0, 1);
    return keep * a + (1 - keep) * f(ZERO, ZERO);
  }
  if (lo === pos || lo + 1 >= rem.n_time) return a;
  const b = val(lo + 1);
  if (a === null || b === null) return a ?? b;
  return a + (pos - lo) * (b - a);
}

/** Live state for pricing, sim orientation. OT has no clock axis: it is
 *  priced as the last regulation bin (the tied-late cells carry OT). */
export type SimState = { elapsed: number; scoreA: number; scoreB: number; ot?: boolean; ball?: Ball };

/** P(team A covers `lineA`) — lineA in A's perspective (−3.5 = A favored). */
export function pCoverA(g: LiveGrid, st: SimState, lineA: number): number | null {
  if (!g.remaining) return null;
  const cur = st.scoreA - st.scoreB;
  return atState(g.remaining, st.elapsed, cur, (m) => pAbove(m, -lineA - cur), st.ot, st.ball);
}
/** P(team B covers `lineB`) — lineB in B's perspective. */
export function pCoverB(g: LiveGrid, st: SimState, lineB: number): number | null {
  if (!g.remaining) return null;
  const cur = st.scoreA - st.scoreB;
  return atState(g.remaining, st.elapsed, cur, (m) => 1 - pAbove(m, lineB - cur), st.ot, st.ball);
}
/** P(final total over `line`). */
export function pOver(g: LiveGrid, st: SimState, line: number): number | null {
  if (!g.remaining) return null;
  const cur = st.scoreA + st.scoreB;
  return atState(g.remaining, st.elapsed, st.scoreA - st.scoreB, (_m, t) => pAbove(t, line - cur), st.ot, st.ball);
}
/** Mean of an integer variable from its survival curve. The curve starts at
 *  the observed minimum (P = 1 there), so E[X] = k0 + sum_{j>=1} P(X >= k0+j). */
function curveMean(c: Curve): number {
  let s = c.k0;
  for (let j = 1; j < c.v.length; j++) s += c.v[j];
  return s;
}

/** Expected points still to come from this state: margin (A - B) and total. */
export function expectedRemaining(g: LiveGrid, st: SimState): { margin: number; total: number } | null {
  if (!g.remaining) return null;
  const cur = st.scoreA - st.scoreB;
  const margin = atState(g.remaining, st.elapsed, cur, (m) => curveMean(m), st.ot, st.ball);
  const total = atState(g.remaining, st.elapsed, cur, (_m, t) => curveMean(t), st.ot, st.ball);
  return margin === null || total === null ? null : { margin, total };
}

/** P(team A wins) off the same remaining-margin curves (tie = half). */
export function pWinA(g: LiveGrid, st: SimState): number | null {
  return pCoverA(g, st, 0);
}

/**
 * Fetch weeks/<weekId>/games/<slug>/live.json for a namespace, through the
 * same dataUrl (proxy-then-hub) resolution cfbData/cfbJson use.
 *
 * 404 -> null (unpublished, expected). Any other failure (network, non-2xx,
 * malformed JSON) is ALSO a quiet null: this is an optional overlay, never
 * a page-level error state.
 */
export async function fetchLiveGrid(
  ns: Season,
  weekId: string,
  slug: string,
  signal?: AbortSignal
): Promise<LiveGrid | null> {
  let url: string;
  try {
    url = await dataUrl(`weeks/${weekId}/games/${slug}/live.json`, ns);
  } catch {
    return null; // dataset unresolvable (e.g. not-yet-published namespace)
  }
  let res: Response;
  try {
    // no-store: same rule as every other week fetch (AGENT_BRIEF #3).
    res = await fetch(url, { signal, cache: "no-store" });
  } catch {
    return null; // transient network error / aborted
  }
  if (!res.ok) return null; // includes 404 = not published yet
  try {
    const raw = await res.json();
    return parseLiveGrid(raw);
  } catch {
    return null;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Resolve one cell of the grid for a live game state.
 *
 * elapsedSeconds: regulation-clock seconds elapsed (3600 - secondsLeft).
 * Callers must not call this for OT points (secondsLeft < 0) — there is no
 * OT axis on the grid, so any elapsed value here is treated as regulation
 * and simply clamped into the last time bin.
 * margin: home - away.
 *
 * When the exact (time, margin) cell is below the grid's min_n, its
 * p_home_win is null; this widens the margin bin by +/-1 then +/-2 (nearest
 * non-null cell at that time; a tie at equal distance averages both) before
 * giving up and returning null.
 */
export function lookupGrid(
  grid: LiveGrid,
  elapsedSeconds: number,
  margin: number
): GridLookup | null {
  const g = grid.grid;
  if (!g.n_time || !g.n_margin) return null;

  const timeIdx = clamp(Math.floor(elapsedSeconds / g.time_bin_s), 0, g.n_time - 1);
  const halfSpan = (g.n_margin - 1) / 2; // e.g. 14 for n_margin=29, margin_bin=2 -> +/-28
  // Half-AWAY-from-zero, matching the exporter's margin_rule
  // (export_live_grid.py): JS Math.round is half-toward-+Infinity, which
  // would shift every negative odd margin one bin toward zero vs. how the
  // corpus was binned.
  const q = margin / g.margin_bin;
  const centerIdx = clamp(Math.sign(q) * Math.round(Math.abs(q)), -halfSpan, halfSpan) + halfSpan;

  const cellAt = (mi: number): GridLookup | null => {
    if (mi < 0 || mi >= g.n_margin) return null;
    const p = g.p_home_win[timeIdx]?.[mi];
    if (p === null || p === undefined) return null;
    return {
      pHomeWin: p,
      meanTotal: g.mean_total[timeIdx][mi],
      meanMargin: g.mean_margin[timeIdx][mi],
      n: g.n[timeIdx][mi],
      widened: 0,
    };
  };

  const exact = cellAt(centerIdx);
  if (exact) return exact;

  for (const radius of [1, 2]) {
    const lo = cellAt(centerIdx - radius);
    const hi = cellAt(centerIdx + radius);
    if (lo && hi) {
      // Equidistant -> average rather than pick a side.
      return {
        pHomeWin: (lo.pHomeWin + hi.pHomeWin) / 2,
        meanTotal: (lo.meanTotal + hi.meanTotal) / 2,
        meanMargin: (lo.meanMargin + hi.meanMargin) / 2,
        n: lo.n + hi.n,
        widened: radius,
      };
    }
    if (lo) return { ...lo, widened: radius };
    if (hi) return { ...hi, widened: radius };
  }
  return null; // nothing non-null within +/-2 bins -> give up, caller draws no point
}

/**
 * Fetch a game's live grid once on mount (or when the identity changes).
 * Static pregame-published data — no polling. Any of ns/weekId/slug being
 * null/empty means "don't fetch" (e.g. FCS cards, no jsonRow yet) -> null.
 */
export function useLiveGrid(
  ns: Season | null,
  weekId: string | null,
  slug: string | null
): LiveGrid | null {
  const [grid, setGrid] = useState<LiveGrid | null>(null);

  useEffect(() => {
    setGrid(null);
    if (!ns || !weekId || !slug) return;
    let alive = true;
    const ac = new AbortController();
    fetchLiveGrid(ns, weekId, slug, ac.signal).then((g) => {
      if (alive) setGrid(g);
    });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [ns, weekId, slug]);

  return grid;
}

/* -------------------- many games at once (live slate) --------------------
 * The scoreboard prices every LIVE card (and the projected record) off its
 * grid, so the page fetches them once here and hands each card its own.
 * One cached request per game for the life of the page: the file is a static
 * pregame publish, and a quiet null is cached too (unpublished = expected). */
const gridCache = new Map<string, Promise<LiveGrid | null>>();

export type LiveGridReq = { key: string; ns: Season; weekId: string; slug: string };

export function useLiveGrids(reqs: LiveGridReq[]): Map<string, LiveGrid> {
  const [grids, setGrids] = useState<Map<string, LiveGrid>>(() => new Map());
  // Primitive dependency (rule 4): the request list as one string.
  const sig = reqs.map((r) => `${r.key}|${r.ns}|${r.weekId}|${r.slug}`).join(",");
  useEffect(() => {
    let alive = true;
    const list = sig ? sig.split(",").map((s) => s.split("|")) : [];
    Promise.all(list.map(async ([key, ns, weekId, slug]) => {
      const ck = `${ns}|${weekId}|${slug}`;
      let p = gridCache.get(ck);
      if (!p) {
        p = fetchLiveGrid(ns as Season, weekId, slug);
        gridCache.set(ck, p);
      }
      return [key, await p] as const;
    })).then((pairs) => {
      if (!alive) return;
      const m = new Map<string, LiveGrid>();
      for (const [k, g] of pairs) if (g) m.set(k, g);
      setGrids(m);
    });
    return () => { alive = false; };
  }, [sig]);
  return grids;
}
