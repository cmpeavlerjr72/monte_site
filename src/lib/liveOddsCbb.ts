// src/lib/liveOddsCbb.ts
//
// The basketball drawer's "Live odds" numbers, from the game's live.json grid
// (the B3 consumer in liveGrid.ts / liveRecord.ts). Everything is in the SIM's
// orientation (A = sim home). Pure: the drawer only formats what this returns.

import { expectedRemaining, pCoverA, pOver, pWinA, type LiveGrid } from "./liveGrid";
import { projectedFinal, simStateOf } from "./liveRecord";

export type LiveOddsCbb = {
  /** Live P(A wins), 0..1 (push counts half). */
  pWinA: number;
  /** Final score implied by score so far + the sim's mean points still to come. */
  projA: number; projB: number;
  projMargin: number; projTotal: number;
  /** Against the stored lines, when the card has them. spread is A's line (negative = A favored). */
  spreadLineA?: number; totalLine?: number;
  pCoverA?: number; pOver?: number;
  /** projTotal - totalLine; projMargin + spreadLineA (positive = A covers). */
  totalDiff?: number; coverMargin?: number;
};

export type LiveOddsResult =
  | { kind: "ok"; odds: LiveOddsCbb }
  | { kind: "ot" }            // overtime with a lead: not priced until the OT model ships
  | { kind: "no-state" };     // no score/period/clock to price from

export function liveOddsCbb(
  grid: LiveGrid,
  s: { scoreA?: number; scoreB?: number; period?: number; clockSec?: number; spreadLineA?: number; totalLine?: number },
): LiveOddsResult {
  const st = simStateOf(s.scoreA, s.scoreB, s.period, s.clockSec, undefined, grid.clock);
  if (!st) return { kind: "no-state" };
  const w = pWinA(grid, st);
  const rem = expectedRemaining(grid, st);
  const pf = projectedFinal(grid, st);
  if (w === null || !rem || !pf) return st.ot ? { kind: "ot" } : { kind: "no-state" };
  const odds: LiveOddsCbb = {
    pWinA: w, projA: pf.A, projB: pf.B,
    projMargin: pf.A - pf.B, projTotal: pf.A + pf.B,
  };
  if (s.spreadLineA !== undefined && Number.isFinite(s.spreadLineA)) {
    odds.spreadLineA = s.spreadLineA;
    odds.pCoverA = pCoverA(grid, st, s.spreadLineA) ?? undefined;
    odds.coverMargin = odds.projMargin + s.spreadLineA;
  }
  if (s.totalLine !== undefined && Number.isFinite(s.totalLine)) {
    odds.totalLine = s.totalLine;
    odds.pOver = pOver(grid, st, s.totalLine) ?? undefined;
    odds.totalDiff = odds.projTotal - s.totalLine;
  }
  return { kind: "ok", odds };
}
