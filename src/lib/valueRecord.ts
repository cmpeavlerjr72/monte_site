// src/lib/valueRecord.ts: THE Value-rule record, computed in one place.
//
// The scoreboard's record strip (ScoreboardV2 computeLineRecord, Value mode)
// and the CFB home tile (components/site/RecordTile.tsx) both grade through
// `valueBetsForGame`, so they agree to the bet: open-line frame, spread and
// total at the file's flat price (-110), ML at the consensus price, 1 unit
// flat, a push is 0 units, bets only where the sim beats the price's
// break-even by MIN_EDGE (no value underdogs unless asked).
//
// Pure: no fetching here (lib/valueSeason.ts loads the weeks).

import { MIN_EDGE, pickValue, type Frame, type WeekLinesGame } from "./weekLines";

export type Market = "spread" | "total" | "ml";
export type Tally = { win: number; loss: number; push: number; pnl: number };
export const mkTally = (): Tally => ({ win: 0, loss: 0, push: 0, pnl: 0 });
export const tallyN = (t: Tally) => t.win + t.loss + t.push;

/** A game's final in the sim's A (home) / B orientation; null = no contest (every bet pushes). */
export type Final = { A: number; B: number } | null;

export type ValueBet = { market: Market; result: "win" | "loss" | "push"; pnl: number; edge: number; dog: boolean };

/** Edge buckets the board prints: 3-6 pts / 6-10 / 10+. */
export const edgeBucket = (edge: number): 0 | 1 | 2 => (edge >= 0.10 ? 2 : edge >= 0.06 ? 1 : 0);

const MARKETS: Market[] = ["spread", "total", "ml"];

/** Every value bet one game carries at one frame (0-3, one per market). */
export function valueBetsForGame(
  lg: WeekLinesGame, frame: Frame, stPrice: number | null, fin: Final, dogs = false, minEdge = MIN_EDGE,
): ValueBet[] {
  const out: ValueBet[] = [];
  for (const market of MARKETS) {
    const v = pickValue(market, lg, frame, stPrice, fin, dogs, minEdge);
    if (v) out.push({ market, result: v.result, pnl: v.pnl, edge: v.edge, dog: v.dog });
  }
  return out;
}

export type ValueGame = { lg: WeekLinesGame; price: number | null; fin: Final };

export type SeasonValue = {
  /** The Value rule, totals only (every edge bucket). */
  totals: Tally;
  /** The Value rule, every bet type, 10+ point edge bucket. */
  edge10: Tally;
  /** Games the value grader could price (their lines.json entry carries `sim`). */
  games: number;
};

const add = (t: Tally, b: ValueBet) => { t[b.result]++; t.pnl += b.pnl; };

/** Season-to-date records over every graded game, in the Value rule. */
export function seasonValue(games: ValueGame[], frame: Frame = "open"): SeasonValue {
  const totals = mkTally(), edge10 = mkTally();
  let priced = 0;
  for (const g of games) {
    if (!g.lg.sim) continue;
    priced++;
    for (const b of valueBetsForGame(g.lg, frame, g.price, g.fin, false)) {
      if (b.market === "total") add(totals, b);
      if (edgeBucket(b.edge) === 2) add(edge10, b);
    }
  }
  return { totals, edge10, games: priced };
}

/** Return per unit risked (every bet risks 1u; pushes count as a bet). */
export const roiOf = (t: Tally): number | null => (tallyN(t) ? t.pnl / tallyN(t) : null);
