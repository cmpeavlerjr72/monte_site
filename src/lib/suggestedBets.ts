// src/lib/suggestedBets.ts
//
// The read-only twin of the FBS maker pipeline.
//
// `scripts/fbs_maker_pipeline.py` (cfb-props-sim) remains the PLACEMENT
// AUTHORITY: it prices, sizes, records state, and is the only thing that ever
// puts an order on the exchange. This module mirrors its selection rules so
// the owner can read the same conclusions at a bar, on a phone, off prices
// that are already in flight. Nothing here places, and nothing here should
// ever grow a placement control — if the two ever disagree, the pipeline is
// right and this file is the bug.
//
// Every constant below is the pipeline's own default, quoted by name so a
// future change there has an obvious counterpart here.
//
// ---------------------------------------------------------------------------
// FEES — read from Kalshi, not hardcoded
// ---------------------------------------------------------------------------
// Kalshi publishes a per-series `fee_type`. Checked 2026-08-28: every
// per-team family (KXNCAAFTEAMTOTAL + all nine stat ladders) is "quadratic",
// meaning TAKER FEES ONLY — resting an order on them is free — while the
// game-line families are "quadratic_with_maker_fees". A blanket
// maker = taker/4 would overstate the cost of exactly the markets this card
// is about. The server forwards the real params; the pipeline's constants are
// only the fallback for when that lookup fails.
//
// Formulas (Kalshi's published schedule, mirrored from the pipeline):
//   taker fee = 0.07 × multiplier × C × P × (1 − P), rounded UP to the cent
//   maker fee = 0.0175 × multiplier × C × P × (1 − P), rounded UP, and ONLY
//               where fee_type says maker fees apply
// The per-CONTRACT (unrounded) form is what the pipeline's thresholds use, so
// selection matches exactly; the rounded per-ORDER form is what the card
// displays and what sizing spends, because that is what the exchange charges.

import type { KalshiGame, KalshiStatQuote } from "./kalshi";

/* ------------------------- pipeline constants ---------------------------- */
/** `--take-threshold`: cross the ask only at this edge after taker fee. */
export const TAKE_THRESHOLD = 0.06;
/** `--min-maker-edge`: rest only at this edge after maker fee. */
export const MIN_MAKER_EDGE = 0.03;
/** `--margin`: a maker quote sits at least this far under our own fair. */
export const MAKER_MARGIN = 0.05;
/** `--min-price`: below this the tick is a third of the price (penny quote). */
export const MIN_PRICE = 0.03;
/** `--max-spread`: a wider book is not a book. */
export const MAX_SPREAD = 0.30;
/** `--sim-lo` / `--sim-hi`: outside this the sim is in its own tail. */
export const SIM_LO = 0.05;
export const SIM_HI = 0.95;
/** `--mid-lo` / `--mid-hi`: preferred rungs, where the book is thickest. */
export const MID_LO = 0.35;
export const MID_HI = 0.65;
/** `--max-rungs`: rungs in a ladder are NESTED, so cap per ladder. */
export const MAX_RUNGS = 2;
/** Game-winner markets are a single event, never a ladder. */
export const MAX_RUNGS_WINNER = 1;
/** `--ladder-risk`: dollars of risk per (game, family, team-side) ladder.
 *
 *  DEFAULT ONLY since 2026-08-28. The site's live value is the user's "Unit
 *  size" from the My Book console (`ownerPrefs.readUnit`), threaded through
 *  `buildSuggestions`/`groupLadders` so the displayed count, outlay and the
 *  Place popup all size off the same number. The maker pipeline keeps its own
 *  CLI `--ladder-risk`: two knobs, deliberately — that one sizes an unattended
 *  book, this one sizes what a human presses Place on. */
export const LADDER_RISK = 30;
export const TICK = 0.01;

/** Fallback only — used when Kalshi's series metadata could not be read. */
const FALLBACK_TAKER_RATE = 0.07;
const FALLBACK_MAKER_DIVISOR = 4;

export type FeeParams = { fee_type: string; fee_multiplier: number };

/** Does this series charge a fee on RESTING liquidity? */
export function seriesChargesMakerFee(fp: FeeParams | undefined): boolean {
  // Unknown series: assume the more expensive world rather than flattering
  // the edge. An overstated fee costs us a marginal bet; an understated one
  // shows an edge that is not there.
  if (!fp) return true;
  return /maker/i.test(fp.fee_type);
}

const rate = (fp: FeeParams | undefined): number =>
  FALLBACK_TAKER_RATE * (fp?.fee_multiplier ?? 1);

/** Per-CONTRACT taker fee, unrounded — the pipeline's threshold form. */
export const takerFeePer = (p: number, fp?: FeeParams): number =>
  rate(fp) * p * (1 - p);

/** Per-CONTRACT maker fee, unrounded. Zero where the series has none. */
export const makerFeePer = (p: number, fp?: FeeParams): number =>
  seriesChargesMakerFee(fp) ? takerFeePer(p, fp) / FALLBACK_MAKER_DIVISOR : 0;

/** Per-ORDER fee as the exchange actually charges it: rounded UP to the cent. */
export function orderFee(p: number, count: number, maker: boolean, fp?: FeeParams): number {
  const per = maker ? makerFeePer(p, fp) : takerFeePer(p, fp);
  if (per <= 0) return 0;
  return Math.ceil(per * count * 100) / 100;
}

/* ------------------------------ candidates -------------------------------- */
export type Suggestion = {
  key: string;
  ticker: string;
  slug: string;
  /** Ladder identity: (game, family, team-side). */
  ladder: string;
  /** Kalshi's own wording, e.g. "TCU 225+ rec yds". */
  label: string;
  /** Display-only pieces of `label`, kept structured for grouping ladder-mates. */
  team: string;
  statText: string;
  strike: number;
  mode: "REST" | "TAKE";
  /** Which contract the bet BUYS. Load-bearing for order entry: `price`,
   *  `bid` and `ask` are all YES-denominated and `simP` is P(YES), so every
   *  stat-ladder candidate is a YES buy. Anything that ever adds a NO
   *  candidate must set this, or the placed order is the opposite bet. */
  side: "yes" | "no";
  simP: number;
  price: number;
  /** Per-order fee in dollars at the sized count. */
  fee: number;
  /** NET edge in probability units: sim − price − fee/count. Never gross. */
  edge: number;
  count: number;
  /** price × count + fee. */
  outlay: number;
  feeType: string;
};

export type Suppressed = { label: string; reason: string };

const floorTick = (v: number) => Math.floor(v / TICK + 1e-9) * TICK;

/**
 * Price ONE contract exactly as `price_side` in the pipeline does, then hand
 * back a mode + net edge. Returns a reason string instead when the pipeline
 * would skip it.
 */
function priceOne(
  simP: number, bid: number | null, ask: number | null, fp: FeeParams | undefined
): { mode: "REST" | "TAKE"; price: number; edgePer: number } | { reason: string } {
  if (bid === null || ask === null) return { reason: "no two-sided book" };
  if (bid <= 0 || ask >= 1) return { reason: "one-sided book" };
  if (ask - bid > MAX_SPREAD + 1e-9) {
    return { reason: `book ${Math.round((ask - bid) * 100)}c wide` };
  }
  if (simP < SIM_LO || simP > SIM_HI) return { reason: "sim in its own tail" };

  const edgeTake = simP - ask - takerFeePer(ask, fp);
  if (edgeTake >= TAKE_THRESHOLD) {
    return { mode: "TAKE", price: ask, edgePer: edgeTake };
  }
  const price = Math.min(round2(ask - TICK), floorTick(simP - MAKER_MARGIN));
  if (price < MIN_PRICE - 1e-9) return { reason: `penny quote (${(price * 100).toFixed(0)}c)` };
  const edge = simP - price - makerFeePer(price, fp);
  if (edge < MIN_MAKER_EDGE) {
    return { reason: `rest edge ${(edge * 100).toFixed(1)}c under ${MIN_MAKER_EDGE * 100}c` };
  }
  return { mode: "REST", price, edgePer: edge };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export type Candidate = {
  ticker: string;
  slug: string;
  ladder: string;
  label: string;
  /** Display-only pieces of `label`, kept structured for grouping ladder-mates. */
  team: string;
  statText: string;
  strike: number;
  series: string;
  /** See `Suggestion.side`. Defaults to a YES buy, which is what every
   *  stat-ladder rung is. */
  side?: "yes" | "no";
  simP: number;
  bid: number | null;
  ask: number | null;
};

/**
 * Select, cap per ladder, and size. Mirrors `select_ladders`: a rung whose
 * sim sits in [0.35, 0.65] first, then the highest edge-after-fee per dollar
 * of risk, capped at 2 per ladder (1 for a winner market).
 */
export function buildSuggestions(
  candidates: Candidate[],
  feeParams: Record<string, FeeParams>,
  heldTickers: Set<string>,
  /** Dollars of risk per ladder — the user's unit size. */
  unit: number = LADDER_RISK
): { rows: Suggestion[]; suppressed: Suppressed[] } {
  const suppressed: Suppressed[] = [];
  type Priced = Candidate & { mode: "REST" | "TAKE"; price: number; edgePer: number };
  const priced: Priced[] = [];

  for (const c of candidates) {
    // The account already has exposure here: the pipeline treats a held or
    // resting rung as consuming its ladder slot, so the card must not
    // re-suggest it.
    if (c.ticker && heldTickers.has(c.ticker)) {
      suppressed.push({ label: c.label, reason: "already held or resting" });
      continue;
    }
    const r = priceOne(c.simP, c.bid, c.ask, feeParams[c.series]);
    if ("reason" in r) {
      suppressed.push({ label: c.label, reason: r.reason });
      continue;
    }
    priced.push({ ...c, ...r });
  }

  const byLadder = new Map<string, Priced[]>();
  for (const p of priced) {
    const arr = byLadder.get(p.ladder);
    if (arr) arr.push(p);
    else byLadder.set(p.ladder, [p]);
  }

  const rows: Suggestion[] = [];
  for (const [ladder, group] of byLadder) {
    const cap = group[0].series === "KXNCAAFGAME" ? MAX_RUNGS_WINNER : MAX_RUNGS;
    const ranked = [...group].sort((a, b) => {
      const am = a.simP >= MID_LO && a.simP <= MID_HI ? 0 : 1;
      const bm = b.simP >= MID_LO && b.simP <= MID_HI ? 0 : 1;
      if (am !== bm) return am - bm;
      return b.edgePer / Math.max(b.price, 1e-9) - a.edgePer / Math.max(a.price, 1e-9);
    });
    for (const p of ranked.slice(cap)) {
      suppressed.push({ label: p.label, reason: `ladder already has ${cap} rung(s)` });
    }
    const picked = ranked.slice(0, cap);
    // The unit is a LADDER budget, still split across the ladder's rungs.
    const share = unit / Math.max(picked.length, 1);
    for (const p of picked) {
      const fp = feeParams[p.series];
      const maker = p.mode === "REST";
      // Sizing spends the FEE too: cost = price*count + fee <= share. Solve
      // by trying the fee-free count first and stepping down while the real
      // (rounded-up) fee pushes total outlay over budget.
      let count = Math.max(1, Math.floor(share / Math.max(p.price, 1e-9)));
      let fee = orderFee(p.price, count, maker, fp);
      while (count > 1 && p.price * count + fee > share + 1e-9) {
        count -= 1;
        fee = orderFee(p.price, count, maker, fp);
      }
      rows.push({
        key: `${p.ticker}|${p.mode}`,
        ticker: p.ticker, slug: p.slug, ladder, label: p.label,
        team: p.team, statText: p.statText, strike: p.strike,
        mode: p.mode, side: p.side ?? "yes", simP: p.simP, price: p.price,
        fee, edge: p.edgePer, count,
        outlay: round2(p.price * count + fee),
        feeType: fp?.fee_type ?? "unknown (assumed maker-charging)",
      });
    }
  }
  rows.sort((a, b) => b.edge - a.edge);
  return { rows, suppressed };
}

/** Tickers the owner already has exposure to (positions + resting orders). */
export function heldTickerSet(
  positions: { ticker: string; count: number }[] | undefined,
  orders: { ticker: string }[] | undefined
): Set<string> {
  const s = new Set<string>();
  for (const p of positions ?? []) if (p.count) s.add(p.ticker);
  for (const o of orders ?? []) s.add(o.ticker);
  return s;
}

/** Stat-quote candidates for one game, using the panel's own published rungs. */
export function statCandidates(
  game: KalshiGame,
  slug: string,
  teamA: string,
  teamB: string,
  statLabel: (stat: string) => string,
  rungP: (team: string, stat: string, strike: number) => number | null,
  seriesFor: (stat: string) => string
): Candidate[] {
  const out: Candidate[] = [];
  for (const q of (game.stat_quotes ?? []) as KalshiStatQuote[]) {
    const team = q.side === "A" ? teamA : teamB;
    const p = rungP(team, q.stat, q.strike);
    if (p === null) continue;                 // no published rung: no bet
    const strike = Math.ceil(q.strike);
    const statText = statLabel(q.stat);
    out.push({
      ticker: q.ticker ?? "",
      slug,
      ladder: `${slug}|${q.stat}|${q.side}`,
      label: `${team} ${strike}+ ${statText}`,
      team, statText, strike,
      series: seriesFor(q.stat),
      simP: p,
      bid: q.yes_bid, ask: q.yes_ask,
    });
  }
  return out;
}

/* ------------------------------- grouping --------------------------------- */
/**
 * Presentation-only: fold a ladder's picked rungs (nested markets — 2 per
 * ladder, capped by MAX_RUNGS above) into ONE display row. Selection and
 * sizing are untouched; this only decides how already-built `Suggestion`s are
 * grouped and ranked for rendering. Ranking uses the BEST rung's net edge,
 * matching the headline chip.
 */
export type LadderGroup = {
  ladder: string;
  /** Card key to scroll to (see `statCandidates` — this is the scoreboard key, not the data slug). */
  slug: string;
  /** Rungs sorted by strike ascending, for popover itemization. */
  rungs: Suggestion[];
  /** Best rung's net edge — drives ranking AND the at-rest verdict chip. */
  bestEdge: number;
  /** Single-line headline for a >1-rung ladder, e.g. "NMST 14+ & 17+ points". */
  headline: string;
  /** Dollars of the $LADDER_RISK stake allotted per rung in this ladder. */
  each: number;
};

export function groupLadders(
  rows: Suggestion[], unit: number = LADDER_RISK,
): LadderGroup[] {
  const byLadder = new Map<string, Suggestion[]>();
  for (const r of rows) {
    const arr = byLadder.get(r.ladder);
    if (arr) arr.push(r); else byLadder.set(r.ladder, [r]);
  }
  const groups: LadderGroup[] = [];
  for (const [ladder, group] of byLadder) {
    const rungs = [...group].sort((a, b) => a.strike - b.strike);
    const best = group.reduce((m, r) => (r.edge > m.edge ? r : m), group[0]);
    const strikes = rungs.map((r) => `${r.strike}+`).join(" & ");
    groups.push({
      ladder,
      slug: best.slug,
      rungs,
      bestEdge: best.edge,
      headline: rungs.length > 1 ? `${best.team} ${strikes} ${best.statText}` : best.label,
      each: round2(unit / group.length),
    });
  }
  groups.sort((a, b) => b.bestEdge - a.bestEdge);
  return groups;
}
