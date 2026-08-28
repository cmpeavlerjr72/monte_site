// src/lib/weekLines.ts
//
// Open/Close market lines for a whole slate, published as ONE file per week
// (weeks/<weekId>/lines.json) alongside the other per-week files on the same
// HuggingFace dataset cfbData/cfbJson already read. This module fetches that
// file, shape-checks it, and holds the PURE win/loss/push + PnL grading math
// so the betting-record panel (Scoreboard.tsx SlateTallyBar) and its node
// smoke test share one implementation.
//
// An unpublished lines.json is the EXPECTED state (pre-publish, FCS-only
// namespaces that never get one, a week the exporter has not reached yet) —
// every failure mode here is a quiet `null`, mirroring src/lib/liveGrid.ts.

import { dataUrl, type Season } from "./cfbData";
import { useEffect, useState } from "react";

/** Which line to grade against — open (bets go in early in the week, the
 *  site's standing benchmark) or close. Callers pass the frame's own number
 *  into the pure graders below; open and close picks may legitimately
 *  differ when the line moved across the sim's number. */
export type Frame = "open" | "close";

export type LineMarket = {
  open: number | null;
  close: number | null;
  n_open: number;
  n_close: number;
};

export type MlMarket = {
  home_open: number | null;
  away_open: number | null;
  home_close: number | null;
  away_close: number | null;
  n_open: number;
  n_close: number;
};

export type WeekLinesGame = {
  game_id: number;
  teamA: string; // home
  teamB: string; // away
  spread: LineMarket; // home-perspective, negative = home favored
  total: LineMarket;
  ml: MlMarket; // american sign
};

export type WeekLines = {
  season: number;
  week: number;
  generated_at: string;
  convention: string;
  /** Fixed juice the spread/total PnL assumes (-110 sportsbook convention).
   *  null on venue-priced files (the FCS/Kalshi variant has no fixed vig). */
  spread_total_price: number | null;
  /** Keyed by game slug (the site's own slug, matching card.jsonRow.slug). */
  games: Record<string, WeekLinesGame>;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function parseLineMarket(raw: any): LineMarket | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNumOrNull(raw.open) || !isNumOrNull(raw.close)) return null;
  if (!isNum(raw.n_open) || !isNum(raw.n_close)) return null;
  return { open: raw.open, close: raw.close, n_open: raw.n_open, n_close: raw.n_close };
}

function parseMlMarket(raw: any): MlMarket | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNumOrNull(raw.home_open) || !isNumOrNull(raw.away_open)) return null;
  if (!isNumOrNull(raw.home_close) || !isNumOrNull(raw.away_close)) return null;
  if (!isNum(raw.n_open) || !isNum(raw.n_close)) return null;
  return {
    home_open: raw.home_open, away_open: raw.away_open,
    home_close: raw.home_close, away_close: raw.away_close,
    n_open: raw.n_open, n_close: raw.n_close,
  };
}

function parseGame(raw: any): WeekLinesGame | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNum(raw.game_id) || !isStr(raw.teamA) || !isStr(raw.teamB)) return null;
  const spread = parseLineMarket(raw.spread);
  const total = parseLineMarket(raw.total);
  const ml = parseMlMarket(raw.ml);
  if (!spread || !total || !ml) return null;
  return { game_id: raw.game_id, teamA: raw.teamA, teamB: raw.teamB, spread, total, ml };
}

/** Parse + shape-check a raw lines.json payload. Malformed -> null (treated like unpublished). */
export function parseWeekLines(raw: any): WeekLines | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNum(raw.season) || !isNum(raw.week)) return null;
  if (!isStr(raw.generated_at) || !isStr(raw.convention)) return null;
  if (!isNum(raw.spread_total_price) && raw.spread_total_price !== null) return null;
  if (!raw.games || typeof raw.games !== "object") return null;

  const games: Record<string, WeekLinesGame> = {};
  for (const [slug, g] of Object.entries(raw.games as Record<string, unknown>)) {
    const parsed = parseGame(g);
    if (parsed) games[slug] = parsed;
    // A malformed single game entry is dropped, not fatal to the whole file.
  }

  return {
    season: raw.season,
    week: raw.week,
    generated_at: raw.generated_at,
    convention: raw.convention,
    spread_total_price: raw.spread_total_price,
    games,
  };
}

/**
 * Fetch weeks/<weekId>/lines.json for a namespace, through the same dataUrl
 * (proxy-then-hub) resolution cfbData/cfbJson use.
 *
 * 404 -> null (unpublished, expected). Any other failure (network, non-2xx,
 * malformed JSON) is ALSO a quiet null: this is an optional overlay, never a
 * page-level error state.
 */
export async function fetchWeekLines(
  ns: Season,
  weekId: string,
  signal?: AbortSignal
): Promise<WeekLines | null> {
  let url: string;
  try {
    url = await dataUrl(`weeks/${weekId}/lines.json`, ns);
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
    return parseWeekLines(raw);
  } catch {
    return null;
  }
}

/**
 * Fetch a week's lines once on mount (or when the (ns, weekId) identity
 * changes). Static per-week published data — no polling. Either being
 * null/empty means "don't fetch" -> null.
 */
export function useWeekLines(ns: Season | null, weekId: string | null): WeekLines | null {
  const [lines, setLines] = useState<WeekLines | null>(null);

  useEffect(() => {
    setLines(null);
    if (!ns || !weekId) return;
    let alive = true;
    const ac = new AbortController();
    fetchWeekLines(ns, weekId, ac.signal).then((l) => {
      if (alive) setLines(l);
    });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [ns, weekId]);

  return lines;
}

/* ============================================================================
 * Pure grading math.
 *
 * Every function grades ONE frame's own line (the caller picks which number
 * to pass — open or close). A null line, or a sim that lands EXACTLY on the
 * line (no side to pick), returns null rather than a fabricated pick; the
 * caller skips that game for that market, same as a missing price. An actual
 * final that lands exactly on the line is a real push, not a null — the pick
 * still exists, it just didn't matter.
 *
 * pnl is in flat 1-unit-risk terms: a spread/total win pays 100/110 of a
 * unit (the site's standing −110 convention), a loss costs 1 unit, a push is
 * 0. ML pnl is priced at the actual american price for the picked side.
 * ========================================================================== */

export type GradeResult<Side extends string> = {
  side: Side;
  result: "win" | "loss" | "push";
  pnl: number;
};

const SPREAD_TOTAL_WIN_PNL = 100 / 110;
const LOSS_PNL = -1;
const EPS = 1e-9;

/** Home minus away favors home when negative (home-perspective spread). */
export function pickAndGradeSpread(
  medA: number,
  medB: number,
  line: number | null | undefined,
  finA: number,
  finB: number
): GradeResult<"home" | "away"> | null {
  if (!isNum(line)) return null;
  const l = line as number;

  const diff = (medA + l) - medB;
  if (Math.abs(diff) < EPS) return null; // sim landed exactly on the line -> no pick

  const side: "home" | "away" = diff > 0 ? "home" : "away";

  const coverA = (finA + l) - finB;
  let result: "win" | "loss" | "push";
  if (Math.abs(coverA) < EPS) {
    result = "push";
  } else {
    const homeCovered = coverA > 0;
    result = (side === "home") === homeCovered ? "win" : "loss";
  }

  const pnl = result === "win" ? SPREAD_TOTAL_WIN_PNL : result === "loss" ? LOSS_PNL : 0;
  return { side, result, pnl };
}

export function pickAndGradeTotal(
  medA: number,
  medB: number,
  line: number | null | undefined,
  finA: number,
  finB: number
): GradeResult<"over" | "under"> | null {
  if (!isNum(line)) return null;
  const l = line as number;

  const predTotal = medA + medB;
  const diff = predTotal - l;
  if (Math.abs(diff) < EPS) return null; // sim landed exactly on the line -> no pick

  const side: "over" | "under" = diff > 0 ? "over" : "under";

  const actualTotal = finA + finB;
  const actualDiff = actualTotal - l;
  let result: "win" | "loss" | "push";
  if (Math.abs(actualDiff) < EPS) {
    result = "push";
  } else {
    const actualOver = actualDiff > 0;
    result = (side === "over") === actualOver ? "win" : "loss";
  }

  const pnl = result === "win" ? SPREAD_TOTAL_WIN_PNL : result === "loss" ? LOSS_PNL : 0;
  return { side, result, pnl };
}

/** American-odds profit per 1 unit risked on a WIN (positive a -> a/100, negative a -> 100/|a|). */
function mlWinPnl(price: number): number {
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

export function pickAndGradeML(
  pHome: number,
  mlHome: number | null | undefined,
  mlAway: number | null | undefined,
  finA: number,
  finB: number
): GradeResult<"home" | "away"> | null {
  const side: "home" | "away" = pHome >= 0.5 ? "home" : "away";
  const price = side === "home" ? mlHome : mlAway;
  if (!isNum(price)) return null;
  const p = price as number;

  let result: "win" | "loss" | "push";
  if (finA === finB) {
    result = "push";
  } else {
    const winnerSide: "home" | "away" = finA > finB ? "home" : "away";
    result = winnerSide === side ? "win" : "loss";
  }

  const pnl = result === "win" ? mlWinPnl(p) : result === "loss" ? LOSS_PNL : 0;
  return { side, result, pnl };
}
