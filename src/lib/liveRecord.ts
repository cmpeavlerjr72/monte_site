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

import { expectedRemaining, type LiveGrid, type SimState } from "./liveGrid";

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
export function simStateOf(scoreA: unknown, scoreB: unknown, period: unknown, clockSec: unknown): SimState | null {
  if (!isNum(scoreA) || !isNum(scoreB) || !isNum(period) || !isNum(clockSec)) return null;
  const elapsed = period >= 5 ? 3599 : Math.max(0, Math.min(3600, (period - 1) * 900 + (900 - clockSec)));
  return { elapsed, scoreA, scoreB, ot: period >= 5 };
}
