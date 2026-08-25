// Player-prop edge math.
//
// Same semantic as the game-market edges: pick the side the sim likes more
// than the market, and report how much more. The difference is the market
// input — a consensus de-vigged P(over) from props_odds.json rather than a
// Kalshi ladder — and the sim input, which is the player's integer PMF from
// players_dist.json counted directly.
//
// NOTE ON SIGN: because the side is CHOSEN as the one where the sim is higher,
// a prop edge is non-negative by construction. Game edges can be negative (the
// side is fixed by the book's line, not chosen). That asymmetry is why the
// merged "overall" list skews toward props, and it is inherent to the spec.

import { pmfPOver, type Pmf, type PropOddsRow } from "./cfbJson";
import { statLabel } from "./parlay";

export type PropSide = "over" | "under";

export type PropEdge = {
  slug: string;
  teamA: string;
  teamB: string;
  player: string;
  /** The player's own team, for the row's logo. */
  playerTeam: string;
  stat: string;
  statLabel: string;
  line: number;
  side: PropSide;
  /** Sim probability of the chosen side. */
  simP: number;
  /** Consensus de-vigged probability of the chosen side. */
  fairP: number;
  /** simP - fairP, non-negative by construction. */
  edge: number;
  /** Best available American price for the chosen side, if quoted. */
  price?: number;
  book?: string;
  /** EV per $1 staked at that price. */
  ev?: number;
  nBooks?: number;
  volTercile?: "T1" | "T2" | "T3";
  /**
   * High-usage overs carry a documented over-projection bias (INV-69), so the
   * panel tags them rather than presenting them as clean edges.
   */
  flagged: boolean;
};

/** Profit per $1 staked at an American price. */
export function profitPerDollar(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american < 0 ? 100 / -american : american / 100;
}

/**
 * One prop row -> one edge, or null when the sim has no distribution for it.
 *
 * `pmf` must be the player's PMF for `row.stat` from players_dist.json. The
 * player key joins verbatim; no normalization happens anywhere in this path.
 */
export function propEdge(
  row: PropOddsRow,
  pmf: Pmf | undefined,
  ctx: { slug: string; teamA: string; teamB: string; playerTeam: string }
): PropEdge | null {
  if (!pmf || !pmf.size) return null;
  if (!(row.fair_over > 0 && row.fair_over < 1)) return null;

  // Defensive zero-stat filter. A player the sim never gives this stat to has
  // all PMF mass at 0, so any over line reads as a ~100% under "edge" — the
  // King Miller case. The publisher is dropping these at the source; the site
  // must not surface one from a stale or hand-edited file either.
  if (pmfPOver(pmf, 0) === 0) return null;

  const simOver = pmfPOver(pmf, row.line);
  const side: PropSide = simOver > row.fair_over ? "over" : "under";

  const simP = side === "over" ? simOver : 1 - simOver;
  const fairP = side === "over" ? row.fair_over : 1 - row.fair_over;
  const edge = simP - fairP;

  const best = side === "over" ? row.best_over : row.best_under;
  const profit = best ? profitPerDollar(best.price) : null;

  return {
    slug: ctx.slug,
    teamA: ctx.teamA,
    teamB: ctx.teamB,
    player: row.player,
    playerTeam: ctx.playerTeam,
    stat: row.stat,
    statLabel: statLabel(row.stat),
    line: row.line,
    side,
    simP,
    fairP,
    edge,
    price: best?.price,
    book: best?.book,
    ev: profit === null ? undefined : simP * profit - (1 - simP),
    nBooks: row.n_books,
    volTercile: row.vol_tercile,
    flagged: row.vol_tercile === "T3" && side === "over",
  };
}

/** "J. Craig" — surnames stay whole so two Craigs stay distinguishable. */
export function shortPlayer(name: string): string {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** "J. Craig · Pass Yds o243.5" */
export function propLabel(e: PropEdge): string {
  return `${shortPlayer(e.player)} · ${e.statLabel} ${e.side === "over" ? "o" : "u"}${e.line}`;
}
