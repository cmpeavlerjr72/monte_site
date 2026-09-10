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

import { pmfPOver, type Pmf, type PropLadderRung, type PropOddsRow } from "./cfbJson";
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
  /** Compact display label ("Pass Yds", "Any TD") for narrow columns/rows —
   *  owner rule 2026-09-09 night. Prefers the publisher's `stat_short`;
   *  falls back to the local STAT_SHORT_LABELS map so a payload published
   *  before the field existed still renders compactly. */
  statShort: string;
  /** Full stat name, for a hover/title on the compact label — never shown
   *  inline, so it can stay as long as it needs to be. */
  statFull: string;
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

  /* ---- one-sided (binary exchange) rows ---------------------------------- */
  /** True when the venue lists only the over, so `side` was not a choice. */
  overOnly: boolean;
  venue?: string;
  /** Publisher EV per $1 staked, fee-inclusive (flat 2c). Preferred over the
   *  locally-derived `ev` whenever present, because the venue's fee model
   *  lives with the publisher, not here. */
  evFee?: number;
  feeModel?: string;
  /** How many trades back the price. A one-print price is a data point, not
   *  a quote you can hit at size. */
  nTrades?: number;
  priceCents?: number;
  ladder: boolean;
  ladderRungs?: PropLadderRung[];
  ladderCombinedEv?: number;
  /** False when the rungs are not neighbours on the venue's full listed
   *  ladder — the shape claim is then interpolated across unpriced strikes. */
  ladderBoardAdjacent?: boolean;
  /** True on the single best-EV rung of this (player, stat) — owner rule
   *  2026-09-09 night: the ranked "Top overs" list shows at most one row per
   *  (player, stat). `undefined` when the payload predates the field, in
   *  which case `rankProps` falls back to a local best-EV dedupe. */
  topRung?: boolean;
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
  if (!(row.fair_over > 0 && row.fair_over < 1)) return null;

  // The sim's P(over). The PMF is the authority whenever the stat has one —
  // it is exact integer counts and it is the same number the distribution
  // panel draws. A stat the sim publishes no PMF for (an anytime-TD market is
  // rush_td + rec_td, a sum players_dist.json does not carry) falls back to
  // the publisher's own `sim_over`, which was computed off the same seeds.
  let simOver: number;
  if (pmf && pmf.size) {
    // Defensive zero-stat filter. A player the sim never gives this stat to
    // has all PMF mass at 0, so any over line reads as a ~100% under "edge" —
    // the King Miller case. The publisher drops these at the source; the site
    // must not surface one from a stale or hand-edited file either.
    if (pmfPOver(pmf, 0) === 0) return null;
    simOver = pmfPOver(pmf, row.line);
  } else if (row.sim_over !== undefined) {
    if (row.sim_over <= 0) return null;
    simOver = row.sim_over;
  } else {
    return null;
  }

  // ONE-SIDED VENUE. A binary exchange lists only the over: there is no under
  // contract and the owner cannot sell one, so `side` is a property of the
  // venue and NOT something to choose. Picking the sim-favoured side here
  // would surface unders nobody can place — which, on a board where the sim
  // sits below the market, is most of the file.
  const overOnly = row.side === "over";
  const side: PropSide = overOnly
    ? "over"
    : simOver > row.fair_over
      ? "over"
      : "under";

  const simP = side === "over" ? simOver : 1 - simOver;
  const fairP = side === "over" ? row.fair_over : 1 - row.fair_over;
  // On an over-only venue this is SIGNED: negative means the market's over is
  // dearer than the sim thinks it is worth, which is real information and not
  // a row to hide. Ranking is what excludes it, not the math.
  const edge = simP - fairP;

  const best = side === "over" ? row.best_over : row.best_under;
  const profit = best ? profitPerDollar(best.price) : null;
  const localEv = profit === null ? undefined : simP * profit - (1 - simP);

  return {
    slug: ctx.slug,
    teamA: ctx.teamA,
    teamB: ctx.teamB,
    player: row.player,
    playerTeam: ctx.playerTeam,
    stat: row.stat,
    statLabel: EXTRA_STAT_LABELS[row.stat] ?? statLabel(row.stat),
    statShort: row.stat_short ?? STAT_SHORT_LABELS[row.stat]
      ?? EXTRA_STAT_LABELS[row.stat] ?? statLabel(row.stat),
    statFull: STAT_FULL_LABELS[row.stat] ?? EXTRA_STAT_LABELS[row.stat]
      ?? statLabel(row.stat),
    line: row.line,
    side,
    simP,
    fairP,
    edge,
    price: best?.price,
    book: best?.book,
    ev: localEv,
    nBooks: row.n_books,
    volTercile: row.vol_tercile,
    flagged: row.vol_tercile === "T3" && side === "over",
    overOnly,
    venue: row.venue,
    // The venue's fee model lives with the publisher, so its fee-inclusive
    // number wins over anything re-derived here.
    evFee: row.ev_fee2 ?? localEv,
    feeModel: row.fee_model,
    nTrades: row.n_trades,
    priceCents: row.px_cents,
    ladder: row.ladder_candidate === true,
    ladderRungs: row.ladder_detail,
    ladderCombinedEv: row.ladder_ev_combined,
    ladderBoardAdjacent: row.ladder_board_adjacent,
    topRung: row.top_rung,
  };
}

/**
 * Labels for venue stats that are NOT site PMF stats.
 *
 * Deliberately separate from `PROP_STATS`: that list is also the parlay leg
 * picker's menu and every key in it must be priceable from seeds.json. An
 * anytime-TD market is rush_td + rec_td — a sum seeds.json does not carry — so
 * putting it in PROP_STATS would offer a leg the slip cannot evaluate. It gets
 * a display name here and nothing more.
 */
const EXTRA_STAT_LABELS: Record<string, string> = {
  anytime_td: "Anytime TD",
};

/**
 * Compact stat labels, one place in the site (owner rule 2026-09-09 night:
 * full stat names truncate at phone width). This is the FALLBACK used when
 * a props payload predates `stat_short` — `propEdge()` prefers the
 * publisher's own field whenever it is present, so this map only has to
 * agree with `scripts/props_edge_dkex.py`'s STAT_SHORT, not stay in lockstep
 * with it.
 */
const STAT_SHORT_LABELS: Record<string, string> = {
  pass_yds: "Pass Yds",
  rush_yds: "Rush Yds",
  rec_yds: "Rec Yds",
  pass_td: "Pass TD",
  anytime_td: "Any TD",
};

/** Full stat names, for the hover/title on a compact label — never shown
 *  inline. Keys not listed here fall back to `statLabel`/EXTRA_STAT_LABELS,
 *  which are already short enough to double as their own full name. */
const STAT_FULL_LABELS: Record<string, string> = {
  pass_yds: "Passing Yards",
  rush_yds: "Rushing Yards",
  rec_yds: "Receiving Yards",
  pass_td: "Passing Touchdowns",
  anytime_td: "Anytime Touchdown",
};

/** True when the parlay slip cannot price this stat from seeds.json. */
export function isSlipPriceable(e: PropEdge): boolean {
  return !(e.stat in EXTRA_STAT_LABELS);
}

/** True for a yes/no market with no numeric line (e.g. anytime TD) — the
 *  row prints the stat alone, never "stat oNN". */
export function hasNoLine(e: PropEdge): boolean {
  return e.stat in EXTRA_STAT_LABELS;
}

/** "J. Craig" — surnames stay whole so two Craigs stay distinguishable. */
export function shortPlayer(name: string): string {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * "J. Craig · Pass Yds o243.5".
 *
 * A yes/no market has no line to print: "Anytime TD o0.5" states a threshold
 * the bet does not have, so the market's own wording is used instead.
 */
export function propLabel(e: PropEdge): string {
  if (e.stat in EXTRA_STAT_LABELS) {
    return `${shortPlayer(e.player)} · ${e.statLabel}`;
  }
  return `${shortPlayer(e.player)} · ${e.statLabel} ${e.side === "over" ? "o" : "u"}${e.line}`;
}
