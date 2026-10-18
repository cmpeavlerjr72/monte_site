// src/lib/liveRecord.ts
//
// PROJECTED RECORD (owner 2026-10-17): the slate record's ATS / Totals / ML,
// with every LIVE game graded as if its PROJECTED FINAL were the final:
//
//     projected final = current score + the sim's expected points still to
//                       come for each team, from this game state
//
// The open/close lines are then graded against that score by the record's
// own functions (weekLines.ts pickAndGrade*), so the projected row is the
// real record with live games filled in, and converges onto it as they end.
// Expected remaining points come from the game's live grid
// (lib/liveGrid.ts `remaining`: points still to come from the current
// clock + margin, independent of how the points so far were scored).

import { expectedRemaining, type Ball, type LiveGrid, type SimState } from "./liveGrid";
import type { LiveSituation } from "./espnGame";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Projected final score in the sim's A/B orientation, or null. */
export function projectedFinal(grid: LiveGrid, st: SimState): { A: number; B: number } | null {
  const r = expectedRemaining(grid, st);
  if (!r) return null;
  // margin = A - B, total = A + B  ->  A = (T + M) / 2, B = (T - M) / 2
  const A = st.scoreA + Math.max(0, (r.total + r.margin) / 2);
  const B = st.scoreB + Math.max(0, (r.total - r.margin) / 2);
  return { A, B };
}

/** Sim-orientation state from a live scoreboard row: A/B scores plus ESPN's
 *  period + seconds left in it. OT is priced as the end of regulation. */
export function simStateOf(
  scoreA: unknown, scoreB: unknown, period: unknown, clockSec: unknown, ball?: Ball,
): SimState | null {
  if (!isNum(scoreA) || !isNum(scoreB) || !isNum(period) || !isNum(clockSec)) return null;
  const elapsed = period >= 5 ? 3599 : Math.max(0, Math.min(3600, (period - 1) * 900 + (900 - clockSec)));
  return { elapsed, scoreA, scoreB, ot: period >= 5, ball };
}

/** The offense + yards to go from the scoreboard `situation` (absolute spot,
 *  ESPN-home goal line = 0, verified live 2026-10-17 on 7 games). Only for a
 *  scrimmage down 1-4 with a known offense; kickoffs / PATs / breaks ->
 *  undefined, and pricing falls back to clock + score. */
export function ballFromSituation(
  sit: LiveSituation | undefined, homeId: string | undefined, awayId: string | undefined,
  espnHomeIsA: boolean,
): Ball | undefined {
  if (!sit || !isNum(sit.yardLine) || !isNum(sit.down) || sit.down < 1 || sit.down > 4) return undefined;
  const p = sit.possessionId;
  if (!p || (p !== homeId && p !== awayId)) return undefined;
  const homeBall = p === homeId;
  const ytg = homeBall ? 100 - sit.yardLine : sit.yardLine;
  if (ytg < 1 || ytg > 99) return undefined;
  return { side: homeBall === espnHomeIsA ? "A" : "B", ytg };
}
