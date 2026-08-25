// Market-edge math: book-line anchored rows for one game.
//
// Pure and dependency-light so both the card block and the slate-wide edge
// scan can use it without one importing the other. Sim probabilities are
// straight counts over compact.json's index-aligned per-seed columns — never a
// normal approximation of a median and a spread.

import { rungAt, type KalshiGame } from "./kalshi";

export type MarketRow = {
  key: string;
  market: string;             // "Total u49.5"
  simP: number | null;
  mktP: number | null;
  approxNote?: string;
};

export const pctText = (p: number) => `${(p * 100).toFixed(0)}%`;
export const signedNum = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Fair American odds for a probability. */
export function americanOdds(p: number): string {
  if (!(p > 0 && p < 1)) return "—";
  return p >= 0.5 ? String(Math.round((-p / (1 - p)) * 100)) : `+${Math.round(((1 - p) / p) * 100)}`;
}

export type SeedCounts = {
  n: number;
  totalUnder: (L: number) => number;
  totalOver: (L: number) => number;
  marginOver: (m: number) => number;
};

export function makeSeedCounts(compact: { A_pts: number[]; B_pts: number[] } | null | undefined): SeedCounts | null {
  if (!compact) return null;
  const n = Math.min(compact.A_pts.length, compact.B_pts.length);
  if (!n) return null;
  return {
    n,
    totalUnder: (L) => { let k = 0; for (let i = 0; i < n; i++) if (compact.A_pts[i] + compact.B_pts[i] < L) k++; return k / n; },
    totalOver: (L) => { let k = 0; for (let i = 0; i < n; i++) if (compact.A_pts[i] + compact.B_pts[i] > L) k++; return k / n; },
    marginOver: (m) => { let k = 0; for (let i = 0; i < n; i++) if (compact.A_pts[i] - compact.B_pts[i] > m) k++; return k / n; },
  };
}

/**
 * Build the market rows. Pure, so the exact numbers the card prints can be
 * verified straight off the seed arrays without rendering anything.
 */
export function buildMarketRows({
  counts, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi,
}: {
  counts: SeedCounts | null;
  teamA: string; teamB: string;
  bookSpread?: number; bookTotal?: number;
  simMargin?: number; simTotal?: number; pHome?: number;
  kalshi?: KalshiGame;
}): MarketRow[] {
  const out: MarketRow[] = [];

    /* ---- WIN: side = whoever the sim favours ---- */
    if (typeof pHome === "number") {
      const homeFav = pHome >= 0.5;
      const team = homeFav ? teamA : teamB;
      const simP = homeFav ? pHome : 1 - pHome;
      const mkt = homeFav ? kalshi?.winner.teamA_price : kalshi?.winner.teamB_price;
      out.push({ key: "win", market: `Win · ${team}`, simP, mktP: mkt ?? null });
    }

    /* ---- SPREAD: anchored to the book's line ---- */
    if (Number.isFinite(bookSpread) && counts && Number.isFinite(simMargin)) {
      const L = bookSpread as number;            // home-perspective
      const needed = -L;                          // home must win by more than this
      const pHomeCover = counts.marginOver(needed);
      // Which side does the sim's median margin land on?
      const simLeansHome = (simMargin as number) > needed;
      const side = simLeansHome
        ? { label: `${teamA} ${signedNum(L)}`, simP: pHomeCover }
        : { label: `${teamB} ${signedNum(-L)}`, simP: 1 - pHomeCover };

      const match = rungAt(kalshi?.spread_ladder, L);
      let mktP: number | null = null;
      let approxNote: string | undefined;
      if (match) {
        // Ladder rungs are P(home covers line); mirror for the away side.
        mktP = simLeansHome ? match.rung.yes_price : 1 - match.rung.yes_price;
        if (match.approx) approxNote = `@Kalshi ${signedNum(match.rung.line)}`;
      }
      out.push({ key: "spread", market: side.label, simP: side.simP, mktP, approxNote });
    }

    /* ---- TOTAL: anchored to the book's line ---- */
    if (Number.isFinite(bookTotal) && counts && Number.isFinite(simTotal)) {
      const L = bookTotal as number;
      const under = (simTotal as number) < L;
      const simP = under ? counts.totalUnder(L) : counts.totalOver(L);

      const match = rungAt(kalshi?.total_ladder, L);
      let mktP: number | null = null;
      let approxNote: string | undefined;
      if (match) {
        // Ladder rungs are P(over line).
        mktP = under ? 1 - match.rung.yes_price : match.rung.yes_price;
        if (match.approx) approxNote = `@Kalshi ${match.rung.line}`;
      }
      out.push({
        key: "total",
        market: `Total ${under ? "u" : "o"}${L}`,
        simP, mktP, approxNote,
      });
    }

  return out;
}

/** Signed edge for a row: sim probability minus Kalshi implied. */
export function rowEdge(r: MarketRow): number | null {
  return r.simP !== null && r.mktP !== null ? r.simP - r.mktP : null;
}
