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
};

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
  };
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
  const centerIdx = clamp(Math.round(margin / g.margin_bin), -halfSpan, halfSpan) + halfSpan;

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
