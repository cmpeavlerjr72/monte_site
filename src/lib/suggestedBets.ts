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
import type { TeamStatsGameLines } from "./cfbJson";
// The week-2 decision rules are a LABELLING layer bolted on top of the
// selection above, never inside it: `starFor` is the only thing this module
// calls, it runs AFTER a row is priced and sized, and it cannot change a
// price, an edge, a count or whether a row exists. See src/lib/edgeRules.ts.
import {
  starFor, type AbstainReason, type CellName, type RuleMode,
} from "./edgeRules";

/* ------------------------- pipeline constants ---------------------------- */
/** `--take-threshold`: cross the ask only at this edge after taker fee.
 *
 *  This is the FAR band's bar (>24h to kick). See THE TIMING BANDS below — the
 *  bar relaxes as kickoff approaches, because a rest that never fills is worth
 *  nothing and the pre-kickoff chain pulls it at kick−30 regardless. */
export const TAKE_THRESHOLD = 0.06;
/** `--min-maker-edge`: rest only at this edge after maker fee. */
export const MIN_MAKER_EDGE = 0.03;
/** `--margin`: a maker quote sits at least this far under our own fair. */
export const MAKER_MARGIN = 0.05;
/** `--min-price`: below this the tick is a third of the price (penny quote). */
export const MIN_PRICE = 0.03;
/** `--max-spread`: a wider book is not a book. */
export const MAX_SPREAD = 0.30;
/* ------------------------------ THE TAIL BAND ----------------------------- */
/**
 * ONE definition, three consumers.
 *
 * A contract is TAIL unless BOTH its own sim probability AND the market-side
 * price it would pay — that contract's ASK — sit inside [TAIL_LO, TAIL_HI].
 *
 * WAS (until 2026-08-28): a sim-only band of 0.05–0.95 here and in
 * `--sim-lo/--sim-hi`, plus `p <= 0.02 || p >= 0.98` for the published
 * `team_markets.json` TAIL flag. All three were effectively no-ops — they
 * caught only near-certainties, and said NOTHING about the price. That is how
 * rows like "FSU −15 NO TAKE @0.12 · +27.3¢" reached this card: a 27-cent
 * apparent edge bought at 12¢, which is
 *
 *   1. where the engine is historically weakest (the INV-43 lineage: the far
 *      ends of our distributions are the least trustworthy part of them),
 *   2. where a 1¢ tick is 8% of the price, so the quoting rules stop meaning
 *      much — the same reasoning already behind MIN_PRICE, and
 *   3. where a thin book misprices hardest, so the book's own staleness is at
 *      least as good an explanation for the "edge" as our skill is.
 *
 * User call, 2026-08-28: "the list is full of stuff on the edges like below
 * 20c which puts us in that region where we are the least confident."
 *
 * The same numbers live in cfb-props-sim `scripts/kalshi_team_edges.py`
 * (`TAIL_LO`/`TAIL_HI`/`is_tail`, the source of truth), which
 * `fbs_maker_pipeline.py` imports. If the three disagree, the Python is right
 * and this file is the bug — the standing rule for every constant here.
 *
 * NOT a fourth consumer, deliberately: `statBookQuality` in kalshi.ts keeps
 * its own STAT_SIM_LO/HI of 0.05–0.95. That gate decides whether the Team
 * Stats panel prints an edge CHIP next to a live quote — a display suppression
 * on a surface the user has already signed off — not whether a bet is
 * suggested or placed. Widening it would quietly strip chips off that chart,
 * so it was left alone; raise it as a question rather than "fixing" it.
 *
 * TAIL rows are NOT deleted: they are excluded from the default list and from
 * ranking, counted in the card footer, and revealable (muted, badged) with the
 * "show tails" toggle. Suppression that the user cannot see is how a filter
 * turns into a mystery.
 */
export const TAIL_LO = 0.20;
export const TAIL_HI = 0.80;
const BAND_EPS = 1e-9;
const inBand = (v: number) => v >= TAIL_LO - BAND_EPS && v <= TAIL_HI + BAND_EPS;
/**
 * `ask` MUST be the ask of the contract actually being BOUGHT — for a NO that
 * is 1 − yes_bid, which is what `gameCandidates` already hands over. The sim
 * leg is symmetric (inBand(p) === inBand(1 − p)), the price leg is not.
 */
export const isTail = (simP: number, ask: number): boolean =>
  !(inBand(simP) && inBand(ask));

/** `--sim-lo` / `--sim-hi`: the tail band's SIM leg, by the pipeline's own
 *  flag names. Same numbers, deliberately not a second knob. */
export const SIM_LO = TAIL_LO;
export const SIM_HI = TAIL_HI;

/* ============================ THE TIMING BANDS ============================ */
/**
 * Maker vs taker is a TIME decision, not just an edge decision (user, 2026-08-28:
 * "the maker/taker logic should take the timing into consideration").
 *
 * WHY. A resting order buys two things — the fee saving (on the per-team
 * families, a rest is FREE where a take is not) and the price improvement of
 * a tick or more under the ask. It pays for them with FILL RISK. That risk is
 * not constant: it is a function of how much time the quote has left to sit
 * there. And the time left is bounded twice over —
 *
 *   1. the book thins and the spread tightens into kickoff, so a quote a tick
 *      under the ask is passed by more often the later it is posted, and
 *   2. the standing pre-kickoff chain CANCELS every unfilled rest at
 *      kick−30min (`PULL_BEFORE_KICK_MIN` in fbs_maker_pipeline.py). A rest
 *      posted with 40 minutes to kick has ten minutes of life, not forty.
 *
 * So the same 4-cent net edge is a good rest on Tuesday and a bad one at
 * 5:30pm on Saturday, and the take bar — which exists to make us pay the taker
 * fee only for an edge big enough to be worth it — should come DOWN as the
 * alternative (resting) gets worse. That is the whole content of the ladder:
 *
 *   t > 24h        take ≥ 6.0¢   rest ≥ 3¢     the original, unchanged
 *   3h < t ≤ 24h   take ≥ 4.5¢   rest ≥ 3¢     resting still has a session
 *   1h < t ≤ 3h    take ≥ 3.0¢   rest ≥ 3¢     hours, not days, to fill
 *   t ≤ 1h         take ≥ 3.0¢   NO REST       ~30 min before the pull
 *
 * The last row is the one with teeth: inside an hour a rest has essentially no
 * time to fill before the kick−30 cancel, so a row that cannot clear the take
 * bar is DROPPED rather than suggested as a rest we know will be pulled. It is
 * reported as a suppression (with that reason in words), never silently.
 *
 * MIRRORED IN PYTHON, by name, next to the tail band: `TAKE_FAR/TAKE_NEAR/
 * TAKE_LATE`, `BAND_NEAR_H/BAND_LATE_H/REST_CUTOFF_H` and `timing_band()` in
 * cfb-props-sim `scripts/kalshi_team_edges.py`, imported by
 * `fbs_maker_pipeline.py` for both its plan pricing and its ESCALATION rule —
 * which was already this idea in one hard-coded step ("a maker quote that has
 * not filled by Friday will not fill by Saturday"). Same numbers, so a plan row
 * and a card row at equal time-to-kick reach the same verdict. If the two ever
 * disagree, the Python is the source and this file is the bug.
 */
export const TAKE_THRESHOLD_NEAR = 0.045;
export const TAKE_THRESHOLD_LATE = 0.03;
/** Band edges, in ms of time-to-kick. */
export const BAND_NEAR_MS = 24 * 60 * 60 * 1000;
export const BAND_LATE_MS = 3 * 60 * 60 * 1000;
/** Inside this, a rest has no time to fill before the kick−30 pull. */
export const REST_CUTOFF_MS = 60 * 60 * 1000;

export type TimingBand = "far" | "near" | "soon" | "imminent";

export type Timing = {
  band: TimingBand;
  /** Net edge after taker fee required to cross the ask in this band. */
  takeThreshold: number;
  /** May a rest be suggested at all? False only inside REST_CUTOFF_MS. */
  restOk: boolean;
  /** Time to kick in ms; null when the kickoff is unknown. */
  msToKick: number | null;
};

/**
 * The band for one game. An UNKNOWN kickoff is treated as `far`: the strictest
 * take bar and resting allowed, i.e. exactly the pre-2026-08-28 behaviour. A
 * missing time must never be the reason a bar gets easier — the relaxation is
 * paid for by knowing that time is short, and we do not know that.
 */
export function timingFor(kickoffMs: number | null | undefined, now: number): Timing {
  if (typeof kickoffMs !== "number" || !Number.isFinite(kickoffMs)) {
    return { band: "far", takeThreshold: TAKE_THRESHOLD, restOk: true, msToKick: null };
  }
  const dt = kickoffMs - now;
  if (dt > BAND_NEAR_MS) {
    return { band: "far", takeThreshold: TAKE_THRESHOLD, restOk: true, msToKick: dt };
  }
  if (dt > BAND_LATE_MS) {
    return { band: "near", takeThreshold: TAKE_THRESHOLD_NEAR, restOk: true, msToKick: dt };
  }
  if (dt > REST_CUTOFF_MS) {
    return { band: "soon", takeThreshold: TAKE_THRESHOLD_LATE, restOk: true, msToKick: dt };
  }
  return { band: "imminent", takeThreshold: TAKE_THRESHOLD_LATE, restOk: false, msToKick: dt };
}

/** "2h to kick" / "35 min to kick" / "3d to kick". Rounded the way a person
 *  says it, because this number is read, not computed against. */
export function timeToKickText(msToKick: number | null): string {
  if (msToKick === null) return "kick time unknown";
  if (msToKick <= 0) return "past kick time";
  const mins = Math.round(msToKick / 60000);
  if (mins < 90) return `${mins} min to kick`;
  const hours = msToKick / 3600000;
  if (hours < 48) {
    const h = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
    return `${h}h to kick`;
  }
  return `${Math.round(hours / 24)}d to kick`;
}

/** "6¢" / "4.5¢" — a trailing zero on a threshold reads as false precision. */
const barText = (v: number) => {
  const c = Math.round(v * 1000) / 10;
  return `${Number.isInteger(c) ? c : c.toFixed(1)}¢`;
};

/** The popover's sentence: where we are in the ladder, and what it changed. */
export function timingWords(t: Timing): string {
  const when = timeToKickText(t.msToKick);
  const bar = barText(t.takeThreshold);
  const from = ` (from ${barText(TAKE_THRESHOLD)})`;
  switch (t.band) {
    case "far":
      return t.msToKick === null
        ? `Kick time unknown — treated as far out, so the full take ` +
          `threshold of ${bar} stands and resting is allowed.`
        : `${when} — plenty of time for a rest to fill, so the full take ` +
          `threshold of ${bar} stands.`;
    case "near":
      return `${when} — a rest still has a session to fill, but not days, ` +
             `so the take threshold relaxes to ${bar}${from}.`;
    case "soon":
      return `${when} — resting has little time to fill before the kick−30 ` +
             `pull, so the take threshold relaxes to ${bar}${from}.`;
    case "imminent":
      return `${when} — a rest posted now would be cancelled at kick−30 ` +
             `before it filled, so resting is off the table entirely and ` +
             `only a take clearing ${bar} qualifies.`;
  }
}

/* ========================= PREGAME ONLY — the gate ======================== */
/**
 * A game is suggestible ONLY while it is genuinely pregame. This is a
 * CORRECTNESS rule, not a preference: every fair on this card is a pregame
 * distribution, so an "edge" measured against a live book is not an edge, it is
 * a wrong number pointed at real money.
 *
 * Two independent signals, and BOTH must say pregame when both exist:
 *
 *   LIVE STATE  — ESPN's `state` for the game, when the feed has joined it at
 *                 all ("pre" / "in" / "post" / "final"). Positive evidence, but
 *                 only when present: many games never get an ESPN join (verified
 *                 2026-08-28 — Lafayette/Georgetown has NO espn entry on the
 *                 wk0 board), and a blocked-espn.com network has none at all.
 *   THE CLOCK   — the scheduled kickoff, minus a buffer.
 *
 * PRECEDENCE, and why it is the conservative one. The tempting rule is
 * "live-state `pre` wins over the clock", on the grounds that a DELAYED kick is
 * still genuinely pregame and its fairs are still valid — which is true. It is
 * rejected anyway, because the two situations that produce (state=pre, clock
 * passed) are indistinguishable from here:
 *
 *   (a) a real weather/TV delay — the fairs are fine, and refusing to suggest
 *       costs us one marginal bet, or
 *   (b) a feed that has simply not updated yet — ESPN flips `pre`→`in` on its
 *       own cadence, our poll adds up to another 60s, and that lag window is
 *       EXACTLY when a stale pregame fair against a book that has already
 *       started moving looks like the best edge on the card.
 *
 * We cannot tell (a) from (b), and the costs are wildly asymmetric: (a) loses a
 * marginal bet, (b) loses money on a distribution we know is wrong. So the
 * clock is a VETO that `pre` cannot override — "both signals must agree when
 * both exist". By the same asymmetry the reverse direction is absolute too: a
 * live state of `in`/`post`/`final` vetoes a kickoff time still in the future
 * (an early start, or a bad schedule row).
 *
 * The 5-minute buffer is not decoration: kick times drift by a minute or two,
 * and a bet placed 60 seconds before kickoff has to survive the confirm slip,
 * the server's live-book re-check, and the exchange — with nothing left over.
 *
 * WITH NEITHER SIGNAL there is no evidence the game has not started, so it is
 * dropped and COUNTED (the card prints the count in words). A suppression the
 * reader cannot see is how a filter becomes a mystery.
 */
export const PREGAME_BUFFER_MS = 5 * 60 * 1000;

export type PregameInputs = {
  /** The FEED's verdict and nothing else: an in-progress live event, a `post`
   *  or `final` state, or a finals CSV that already has this score. It must NOT
   *  fold in a kick-time test — the clock is this function's own second signal,
   *  and mixing them here is how a "which one fired?" answer gets lost. */
  started?: boolean;
  /** Raw ESPN state, present only where the feed joined this game. */
  liveState?: string;
  /** Scheduled kickoff, epoch ms. */
  kickoffMs?: number;
};

export type PregameVerdict = { ok: true } | { ok: false; reason: string };

export function pregameVerdict(g: PregameInputs, now: number): PregameVerdict {
  const state = (g.liveState || "").toLowerCase();

  // 1. THE FEED. `in`/`post`/`final` (or a finals source) vetoes outright, even
  //    against a kickoff still in the future — an early start or a wrong
  //    schedule row is not a reason to price a live game off pregame fairs.
  if (state && state !== "pre") return { ok: false, reason: `live state ${state}` };
  if (g.started) return { ok: false, reason: "live feed says under way" };

  // 2. THE CLOCK — a veto that a live `pre` cannot override (see above).
  if (typeof g.kickoffMs === "number" && Number.isFinite(g.kickoffMs)) {
    return g.kickoffMs - now > PREGAME_BUFFER_MS
      ? { ok: true }
      : { ok: false, reason: "inside 5 min of kickoff" };
  }

  // 3. No clock. A live `pre` is then the only evidence we have, and it IS
  //    evidence — take it. With neither signal, refuse.
  if (state === "pre") return { ok: true };
  return { ok: false, reason: "no kickoff time and no live state" };
}

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

/* =========================== THE UNIT SIZING MODE ========================= *
 *
 * Owner ask 2026-09-08: "a unit is a unit" is only ONE of the three ways a
 * bettor means it, and Kalshi's binary makes the difference bigger than a
 * sportsbook does.
 *
 * THE ARITHMETIC, once, so every number below can be undone in the reader's
 * head. A contract costs P dollars and pays $1. For n contracts at price P:
 *
 *     risk    R = n·P                     (the money that leaves and can lose)
 *     fee     F = ceil(k·P·(1−P)·n)       to the cent, per ORDER (see orderFee)
 *     net win W = n·(1−P) − F  ≈  n·(1−P)·(1 − k·P)
 *
 * with k = 0.07 for a taker, 0.0175 for a maker on a family that charges maker
 * fees, and 0 for a rest on the per-team families (which charge takers only).
 * The closed form is what picks the first n; the ROUNDED per-order fee is what
 * the loops below settle against, because that is what the exchange charges.
 *
 * THE THREE MODES:
 *
 *   risk    R = unit.  Today's behaviour, unchanged and DEFAULT — the largest
 *           n whose full outlay (R + F) fits the unit.
 *   to-win  W = unit.  n = ceil(unit / ((1−P)·(1 − k·P))), so a 30¢ dog and an
 *           86¢ favourite both return one unit of profit, and the favourite
 *           risks more to do it.
 *   book    The owner's sportsbook habit. A favourite (P > 0.50, i.e. negative
 *           American odds) is sized TO WIN a unit; a dog (P ≤ 0.50, positive
 *           odds) RISKS a unit and wins whatever it wins. That is exactly how
 *           a −150 and a +150 offset each other on a book's slip.
 *
 * THE GUARD. `maxRiskMultiple` (default 3) is a hard ceiling on the OUTLAY of
 * a to-win row: at 95¢ a full unit of profit costs twenty units of risk, which
 * is not a bet, it is a loan to the exchange. The row is sized down to the
 * ceiling and SAYS SO — the slip prints "capped at 3× unit" with the price and
 * the net win it actually reaches, because a silently shrunk bet is a lie
 * about the size the owner asked for.
 *
 * ONE FUNCTION. `sizeContracts` below is the only place contracts are solved
 * for in this app: `sizeSuggestion` (every picked row, every browse row, every
 * ConfirmSlip and pre-press echo) and the Friend Feed's Join button both call
 * it. A second copy is how the browse wheel and the picked rows drifted apart
 * once already (fixed 2026-08-30 by extracting `sizeSuggestion`).
 */
export type UnitMode = "risk" | "to-win" | "book";
export type Sizing = {
  mode: UnitMode;
  /** Hard ceiling on a to-win row's outlay, in units. */
  maxRiskMultiple: number;
};
/** DEFAULT: today's behaviour, byte for byte. */
export const SIZING_DEFAULT: Sizing = { mode: "risk", maxRiskMultiple: 1 };
export const MAX_RISK_MULTIPLE_DEFAULT = 3;
export const MAX_RISK_MULTIPLE_MIN = 1;
/** Mirrored by the client's declared per-order cap (see placeOrders.ts) and
 *  bounded again by the server's absolute $500 per-order ceiling. */
export const MAX_RISK_MULTIPLE_MAX = 5;

export const clampRiskMultiple = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return MAX_RISK_MULTIPLE_DEFAULT;
  return Math.min(MAX_RISK_MULTIPLE_MAX, Math.max(MAX_RISK_MULTIPLE_MIN, n));
};

/** Which arithmetic a price actually gets. `book` is not a third formula — it
 *  CHOOSES one, on the sign of the American odds. */
export function appliedMode(mode: UnitMode, price: number): "risk" | "to-win" {
  if (mode === "to-win") return "to-win";
  if (mode === "book") return price > 0.5 + 1e-9 ? "to-win" : "risk";
  return "risk";
}

export type SizedContracts = {
  count: number;
  /** price × count — the money at risk, fee excluded. */
  risk: number;
  /** Per-ORDER fee, rounded up to the cent as the exchange charges it. */
  fee: number;
  /** price × count + fee — what actually leaves the account. */
  outlay: number;
  /** count × (1 − price) − fee — what lands if this settles YES. */
  netWin: number;
  /** The arithmetic that ran. "book" resolves to one of these per price. */
  applied: "risk" | "to-win";
  /** The maxRiskMultiple ceiling stopped this short of a full unit of profit. */
  capped: boolean;
};

/**
 * Solve ONE rung's contract count. The only sizing arithmetic in the app.
 *
 * `unit` is the dollars this rung is entitled to — already split across its
 * ladder and already min'd with any held-market headroom by the caller.
 * `ceiling` is the hard OUTLAY cap for the stretch modes (unit ×
 * maxRiskMultiple, itself min'd with that same headroom, because headroom is
 * a commitment ceiling and a mode may not spend past it).
 */
export function sizeContracts(args: {
  price: number;
  maker: boolean;
  fp?: FeeParams;
  unit: number;
  ceiling?: number;
  sizing?: Sizing;
}): SizedContracts {
  const { price, maker, fp, unit } = args;
  const sizing = args.sizing ?? SIZING_DEFAULT;
  const applied = appliedMode(sizing.mode, price);
  const feeOf = (n: number) => orderFee(price, n, maker, fp);
  const outlayOf = (n: number) => price * n + feeOf(n);
  const netWinOf = (n: number) => n * (1 - price) - feeOf(n);

  let count: number;
  if (applied === "risk") {
    // TODAY'S ARITHMETIC, character for character (this branch is the default
    // and must stay byte-identical): the fee-free count, stepped down while
    // the real rounded fee pushes total outlay over the budget.
    count = Math.max(1, Math.floor(unit / Math.max(price, 1e-9)));
    while (count > 1 && price * count + feeOf(count) > unit + 1e-9) count -= 1;
  } else {
    const ceiling = Math.max(unit, args.ceiling ?? unit);
    // Closed form off the PER-CONTRACT fee...
    const per = maker ? makerFeePer(price, fp) : takerFeePer(price, fp);
    count = Math.max(1, Math.ceil(unit / Math.max((1 - price) - per, 1e-9)));
    // ...then the ceiling, in one step rather than a decrement walk (at 95¢ a
    // full unit of profit is hundreds of contracts past a 3× cap).
    count = Math.min(count, Math.max(1, Math.floor(ceiling / Math.max(price, 1e-9))));
    // The exchange rounds the fee UP per order, so the closed form can land a
    // contract or two short of a full unit of profit. Correct upward while the
    // ceiling still allows it, then down until the outlay fits.
    let guard = 0;
    while (netWinOf(count) < unit - 1e-9 &&
           outlayOf(count + 1) <= ceiling + 1e-9 && guard++ < 64) count += 1;
    while (count > 1 && outlayOf(count) > ceiling + 1e-9) count -= 1;
  }

  const fee = feeOf(count);
  const netWin = netWinOf(count);
  return {
    count,
    risk: round2(price * count),
    fee,
    outlay: round2(price * count + fee),
    netWin: round2(netWin),
    applied,
    // Half a cent of tolerance: a rounded-up fee can leave a full-size row a
    // fraction short, which is not what "capped" means.
    capped: applied === "to-win" && netWin < unit - 0.005,
  };
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
  /** How this rung reads on its own inside a grouped ladder, WITHOUT the team
   *  ("225+", "−7.5", "Over 48.5"). A stat rung has none and falls back to
   *  `${strike}+`; a game line must supply one, because "−7.5+" and "48.5+"
   *  are not bets anyone placed. */
  rungText?: string;
  mode: "REST" | "TAKE";
  /** Which contract the bet BUYS. Load-bearing for order entry: `price`,
   *  `bid` and `ask` are all YES-denominated and `simP` is P(YES), so every
   *  stat-ladder candidate is a YES buy. Anything that ever adds a NO
   *  candidate must set this, or the placed order is the opposite bet. */
  side: "yes" | "no";
  /** Kalshi series ticker this rung trades on (e.g. "KXNCAAFTEAMRECYDS").
   *  Feeds the bet-TYPE filter via `familyForSeries` below. */
  series: string;
  simP: number;
  price: number;
  /** Per-order fee in dollars at the sized count. */
  fee: number;
  /** NET edge in probability units: sim − price − fee/count. Never gross. */
  edge: number;
  count: number;
  /** price × count + fee. */
  outlay: number;
  /** price × count — the money at risk, fee excluded. */
  risk: number;
  /** count × (1 − price) − fee — what this returns if it settles YES. */
  netWin: number;
  /** Which arithmetic sized it: "risk" (a unit at stake) or "to-win" (a unit
   *  of profit). The `book` mode resolves to one of these per price. */
  sizeMode: "risk" | "to-win";
  /** A to-win row the maxRiskMultiple ceiling stopped short of a full unit. */
  capped: boolean;
  /** The per-rung unit this row was sized against — the ladder's split of the
   *  owner's unit. Both "to net $X" and "capped at N× unit" quote it. */
  unitShare: number;
  feeType: string;
  /** Outside the [TAIL_LO, TAIL_HI] band on the sim, the ask, or both. Never
   *  ranked among the defaults; shown muted behind the "show tails" toggle. */
  tail: boolean;
  /** Where this game sat in the timing ladder when the row was priced — the
   *  bar this row had to clear, and the popover's sentence. */
  timing: Timing;
  /* --- week-2 decision rules (src/lib/edgeRules.ts). LABELS ONLY: nothing
   *     below changes `price`, `edge`, `count` or whether the row exists. --- */
  /** R1/R2 primary abstention reason, or null. A row that carries one still
   *  renders and still places — it renders MUTED and says why. */
  abstain: AbstainReason | null;
  /** Every abstention that fired, for the popover. */
  abstainReasons: AbstainReason[];
  /** R3 cell this row stands in, or null. Drives the star and its tag. */
  cell: CellName | null;
  /** R3+R4 verdict: does this row earn the ★ TARGET label. */
  star: boolean;
  /** How hard the rules bit on this row (board reached, or kill switch off). */
  ruleMode: RuleMode;
};

export type Suppressed = {
  label: string;
  reason: string;
  /** The market this candidate was on. Present so the reported count is one
   *  per MARKET: a market whose YES was suppressed but whose NO became a
   *  suggestion is not suppressed, it is a bet. */
  ticker?: string;
};

const floorTick = (v: number) => Math.floor(v / TICK + 1e-9) * TICK;

/**
 * Price ONE contract exactly as `price_side` in the pipeline does, then hand
 * back a mode + net edge. Returns a reason string instead when the pipeline
 * would skip it.
 */
function priceOne(
  simP: number, bid: number | null, ask: number | null, fp: FeeParams | undefined,
  /** Where this game sits in the timing ladder. Sets the take bar, and decides
   *  whether resting is on the table at all. */
  timing: Timing,
): { mode: "REST" | "TAKE"; price: number; edgePer: number } | { reason: string } {
  if (bid === null || ask === null) return { reason: "no two-sided book" };
  if (bid <= 0 || ask >= 1) return { reason: "one-sided book" };
  // The pipeline's own guard (`ya <= yb` is refused there): a crossed or
  // locked book has no interior to quote inside, and the spread test below
  // would wave it through with a negative width.
  if (ask <= bid) return { reason: "crossed book" };
  if (ask - bid > MAX_SPREAD + 1e-9) {
    return { reason: `book ${Math.round((ask - bid) * 100)}c wide` };
  }
  // NOTE: the TAIL band is deliberately NOT tested here. A tail contract is
  // still priced, because the card can reveal it on demand; it is partitioned
  // out of the default list in `buildSuggestions` instead.

  const edgeTake = simP - ask - takerFeePer(ask, fp);
  if (edgeTake >= timing.takeThreshold) {
    return { mode: "TAKE", price: ask, edgePer: edgeTake };
  }
  // INSIDE THE LAST HOUR THERE IS NO REST. The pre-kickoff chain cancels every
  // unfilled rest at kick−30, so a quote posted now has minutes of life; a row
  // that could not clear the (already relaxed) take bar is DROPPED rather than
  // dressed up as a bet we know will be pulled unfilled.
  if (!timing.restOk) {
    return {
      reason: `${timeToKickText(timing.msToKick)} — no time to fill before ` +
              `the kick−30 pull, and take edge ${(edgeTake * 100).toFixed(1)}¢ ` +
              `is under ${Math.round(timing.takeThreshold * 100)}¢`,
    };
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
  /** See `Suggestion.rungText`. */
  rungText?: string;
  series: string;
  /** See `Suggestion.side`. Defaults to a YES buy, which is what every
   *  stat-ladder rung is. */
  side?: "yes" | "no";
  simP: number;
  bid: number | null;
  ask: number | null;
  /** This game's kickoff, epoch ms. Sets the row's timing band; absent means
   *  the `far` band (the strictest take bar) — see `timingFor`. */
  kickoffMs?: number;
  /* --- week-2 rule labels, attached by the caller (`labelCandidates` in
   *     useSuggestions.ts) because only the caller knows the game's regime.
   *     Absent = unlabelled, which falls back to the pre-rules star. --- */
  abstain?: AbstainReason | null;
  abstainReasons?: AbstainReason[];
  cell?: CellName | null;
  ruleMode?: RuleMode;
};

/**
 * Select, cap per ladder, and size. Mirrors `select_ladders`: a rung whose
 * sim sits in [0.35, 0.65] first, then the highest edge-after-fee per dollar
 * of risk, capped at 2 per ladder (1 for a winner market).
 */
type Priced = Candidate & {
  mode: "REST" | "TAKE"; price: number; edgePer: number; timing: Timing;
  /** Budget REMAINING for this market when the account already holds part
   *  of the unit there, ON THE AXIS THE ROW IS SIZED ON (2026-09-08):
   *  risk mode: unit − held cost; to-win / book-above-50c: unit − the profit
   *  the held position already stands to make. Absent = the full share. */
  budget?: number;
  /** The stretch modes' OUTLAY ceiling remaining: unit × maxRiskMultiple −
   *  held cost. Absent = the full share × multiple. */
  ceilingBudget?: number;
};

/** What one compute produces. `rows` is the list; `tailRows` is the opt-in
 *  reveal; `tailMarkets` is what the footer counts. */
export type BuildResult = {
  rows: Suggestion[];
  /** Markets that exist ONLY as a tail contract, priced and sized so the
   *  toggle can show them — never mixed into `rows`, never ranked with them. */
  tailRows: Suggestion[];
  /** Distinct MARKETS held out by the tail band. The footer's number. */
  tailMarkets: number;
  suppressed: Suppressed[];
  /** FULL-LADDER BROWSE (owner ask 2026-08-30, the Auburn −7.5 case): every
   *  priced market's better side, UNCAPPED by the ladder picker and including
   *  tail rungs (flagged) — the selection above PICKS, this list SHOWS. Each
   *  rung is sized at the full unit (a browse placement is one deliberate
   *  rung, not a ladder split). Sorted ladder-then-strike. */
  browse: Suggestion[];
};

/**
 * Cap per ladder, rank, and size — the second half of `select_ladders`. Split
 * out because it runs TWICE: once over the in-band contracts (the list) and
 * once over the tail contracts (the reveal), so a tail rung can never consume
 * a ladder slot that an in-band rung would have had.
 */
function selectLadders(
  priced: Priced[],
  feeParams: Record<string, FeeParams>,
  unit: number,
  tail: boolean,
  /** Where ladder-cap losers are reported. Null for the tail pass: those are
   *  already accounted for by the tail count and would double-report. */
  suppressed: Suppressed[] | null,
  sizing: Sizing = SIZING_DEFAULT,
): Suggestion[] {
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
      suppressed?.push({
        label: p.label, reason: `ladder already has ${cap} rung(s)`,
        ticker: p.ticker,
      });
    }
    const picked = ranked.slice(0, cap);
    // The unit is a LADDER budget, still split across the ladder's rungs —
    // and a rung with a held-headroom budget never sizes past it.
    const share = unit / Math.max(picked.length, 1);
    for (const p of picked) {
      // HEADROOM IS A CEILING IN BOTH MODES. A partly-held market may only be
      // topped up to the unit it has left, so the stretch modes cap against
      // that same number rather than multiplying it (owner rule 2026-08-30 —
      // exposure retires a market once it has consumed the unit).
      const headroom = p.budget ?? Infinity;
      const ceilRoom = p.ceilingBudget ?? headroom;
      rows.push(sizeSuggestion(p, feeParams,
        Math.min(share, headroom), tail, sizing,
        Math.min(share * sizing.maxRiskMultiple, ceilRoom)));
    }
  }
  rows.sort((a, b) => b.edge - a.edge);
  return rows;
}

/** Size ONE priced rung to a dollar budget and emit the full Suggestion.
 *  Extracted from `selectLadders` (2026-08-30) so the browse list below sizes
 *  a rung with the identical arithmetic the picked rows use — and since
 *  2026-09-08 the one place the unit MODE (risk / to-win / book) is applied.
 *  The arithmetic itself is `sizeContracts`, shared with the Friend Feed's
 *  Join button so no surface can size a bet a second way. */
function sizeSuggestion(
  p: Priced,
  feeParams: Record<string, FeeParams>,
  share: number,
  tail: boolean,
  sizing: Sizing = SIZING_DEFAULT,
  /** Hard OUTLAY ceiling for the stretch modes. Defaults to `share`, which is
   *  no stretch at all — the risk-mode budget. */
  ceiling: number = share,
): Suggestion {
  const fp = feeParams[p.series];
  const maker = p.mode === "REST";
  const sized = sizeContracts({
    price: p.price, maker, fp, unit: share, ceiling, sizing,
  });
  const { count, fee } = sized;
  // R3+R4 runs LAST, on the finished row, because it reads the price this row
  // would actually pay or post and the net edge after that row's own fee.
  // It decides a LABEL and nothing else.
  const ruleMode: RuleMode = p.ruleMode ?? "off";
  const cell = p.cell ?? null;
  const abstain = p.abstain ?? null;
  return {
    key: `${p.ticker}|${p.mode}`,
    ticker: p.ticker, slug: p.slug, ladder: p.ladder, label: p.label,
    team: p.team, statText: p.statText, strike: p.strike,
    rungText: p.rungText,
    mode: p.mode, side: p.side ?? "yes", series: p.series,
    simP: p.simP, price: p.price,
    fee, edge: p.edgePer, count,
    outlay: sized.outlay,
    risk: sized.risk, netWin: sized.netWin,
    sizeMode: sized.applied, capped: sized.capped, unitShare: round2(share),
    feeType: fp?.fee_type ?? "unknown (assumed maker-charging)",
    tail,
    timing: p.timing,
    abstain, abstainReasons: p.abstainReasons ?? [], cell, ruleMode,
    star: starFor(
      { cell, abstain, tail, price: p.price, edge: p.edgePer, series: p.series },
      ruleMode,
    ),
  };
}

export function buildSuggestions(
  candidates: Candidate[],
  feeParams: Record<string, FeeParams>,
  heldCost: Map<string, number>,
  /** Dollars of risk per ladder — the user's unit size. */
  unit: number = LADDER_RISK,
  /** The instant every row is priced against. Passed in rather than read here
   *  so ONE clock drives the pregame gate upstream and the timing bands below —
   *  two `Date.now()` calls a few ms apart can straddle a band edge and put a
   *  row's chip out of step with its own popover. */
  now: number = Date.now(),
  /** How a unit is spent: risk / to-win / book, plus the to-win risk ceiling.
   *  Defaults to `risk`, which is the arithmetic that shipped before
   *  2026-09-08. See THE UNIT SIZING MODE above. */
  sizing: Sizing = SIZING_DEFAULT,
  /** Profit the account ALREADY stands to make per ticker (held contracts ×
   *  (1 − cost basis) + resting), from `heldByTicker`. Only read by the
   *  stretch modes; risk mode keeps the cost-axis headroom byte-for-byte. */
  heldWin: Map<string, number> = new Map(),
): BuildResult {
  const suppressed: Suppressed[] = [];
  const priced: Priced[] = [];

  for (const c of candidates) {
    const h = c.ticker ? (heldCost.get(c.ticker) ?? 0) : 0;
    const timing = timingFor(c.kickoffMs, now);
    const r = priceOne(c.simP, c.bid, c.ask, feeParams[c.series], timing);
    // HEADROOM ON THE ROW'S OWN AXIS (owner, 2026-09-08: "book" mode, $48
    // already risked on RUTG24 at 61c, unit to win $50, and the app would only
    // let another $1.50 through). The old rule measured the remainder in
    // RISK dollars (unit − held cost) in every mode, so a to-win row could
    // never be sized past one unit of risk in a market it already held. The
    // remainder is now measured the way the row is sized: to-win rows get
    // (unit − profit already held) to spend, under the outlay ceiling
    // (unit × multiple − held cost). Risk mode is unchanged.
    const applied = appliedMode(sizing.mode, "reason" in r ? (c.ask ?? 0) : r.price);
    const hw = c.ticker ? (heldWin.get(c.ticker) ?? (h > 0 ? h : 0)) : 0;
    const winRoom = unit - hw;
    const riskRoom = unit * sizing.maxRiskMultiple - h;
    const headroom = applied === "risk" ? unit - h : winRoom;
    const minAsk = Math.max(0.05, c.ask ?? 0.05);
    const blocked = h > 0 && (applied === "risk"
      ? headroom < minAsk
      : (winRoom < Math.max(0.05, 1 - minAsk) || riskRoom < minAsk));
    if (blocked) {
      suppressed.push({
        label: c.label,
        reason: !Number.isFinite(h)
          ? "already held or resting"
          : applied === "risk"
            ? `already committed $${h.toFixed(2)} of the $${unit} unit`
            : `already stands to win $${hw.toFixed(2)} of the $${unit} unit (risk $${h.toFixed(2)})`,
        ticker: c.ticker,
      });
      continue;
    }
    if ("reason" in r) {
      suppressed.push({ label: c.label, reason: r.reason, ticker: c.ticker });
      continue;
    }
    priced.push({ ...c, ...r, timing,
                  budget: h > 0 ? headroom : undefined,
                  ceilingBudget: h > 0 && applied !== "risk" ? riskRoom : undefined });
  }

  // ONE CONTRACT PER MARKET — the pipeline's shape, and a correctness rule.
  //
  // A Kalshi market has two contracts: its YES and its NO (the Under of an
  // over rung, the dog on the favourite's winner market). `price_side` in the
  // pipeline prices BOTH and keeps whichever is better, emitting a single row
  // per market. A candidate source that offers both sides — which the
  // game-line builder must, since that is the only way to express an Under or
  // a fade — would otherwise let one ladder pick both halves of the same
  // market: a self-hedge that pays two fees to bet on nothing.
  // THE TAIL PARTITION HAPPENS BEFORE "best side of the market" — and that
  // ordering is the whole point. A tail contract usually carries the FATTER
  // apparent edge (that is why the user was seeing them), so choosing the
  // better side first would let the untrusted half of a market bury a
  // perfectly good in-band bet on the other half. The pipeline drops tail
  // contracts before it prices sides; this does the same.
  const core: Priced[] = [], tails: Priced[] = [];
  for (const p of priced) {
    (isTail(p.simP, p.ask ?? 1) ? tails : core).push(p);
  }

  // ONE CONTRACT PER MARKET — the pipeline's shape, and a correctness rule.
  //
  // A Kalshi market has two contracts: its YES and its NO (the Under of an
  // over rung, the dog on the favourite's winner market). `price_side` in the
  // pipeline prices BOTH and keeps whichever is better, emitting a single row
  // per market. A candidate source that offers both sides — which the
  // game-line builder must, since that is the only way to express an Under or
  // a fade — would otherwise let one ladder pick both halves of the same
  // market: a self-hedge that pays two fees to bet on nothing.
  const bestPerMarket = (list: Priced[]): Priced[] => {
    const best = new Map<string, Priced>();
    list.forEach((p, i) => {
      // A candidate with no ticker cannot collide with anything; give it a key
      // of its own rather than letting empty strings merge unrelated rows.
      const key = p.ticker || `no-ticker#${i}`;
      const cur = best.get(key);
      if (!cur || p.edgePer > cur.edgePer) best.set(key, p);
    });
    return [...best.values()];
  };

  const rows = selectLadders(
    bestPerMarket(core), feeParams, unit, false, suppressed, sizing);

  // A market that already produced an in-band bet must NOT also appear as a
  // tail: buying both contracts of one market is a self-hedge that pays two
  // fees. The reveal is only for markets that exist as a tail and nothing else.
  const betOn = new Set(rows.map((r) => r.ticker).filter(Boolean));
  const tailOnly = tails.filter((p) => !p.ticker || !betOn.has(p.ticker));
  const tailTickers = new Set(tailOnly.map((p) => p.ticker).filter(Boolean));
  const tailRows = selectLadders(
    bestPerMarket(tailOnly), feeParams, unit, true, null, sizing);

  // The suppressed COUNT is per MARKET, not per contract. Every game-line
  // market yields two candidates (its YES and its NO), and the losing half of
  // a market that DID produce a bet is not a suppression — reporting it as one
  // would turn a useful footer into a four-digit number that means nothing.
  // A market held out by the tail band is likewise not "suppressed": it has
  // its own line in the footer and its own toggle.
  const seen = new Set<string>();
  const perMarket = suppressed.filter((s) => {
    if (!s.ticker) return true;                 // nothing to collapse against
    if (betOn.has(s.ticker)) return false;      // this market became a bet
    if (tailTickers.has(s.ticker)) return false; // counted as a tail instead
    if (seen.has(s.ticker)) return false;       // its other contract said it
    seen.add(s.ticker);
    return true;
  });

  // Full-ladder browse (see BuildResult). isTail is re-derived per rung —
  // the core/tails split above is per-list, and a browse row must carry its
  // OWN flag so the table can mute exactly the untrusted rungs.
  const browse = bestPerMarket([...core, ...tails])
    .map((p) => sizeSuggestion(p, feeParams,
      Math.min(unit, p.budget ?? Infinity), isTail(p.simP, p.ask ?? 1), sizing,
      Math.min(unit * sizing.maxRiskMultiple, p.budget ?? Infinity)))
    .sort((a, b) => (a.ladder < b.ladder ? -1 : a.ladder > b.ladder ? 1
      : a.strike - b.strike));

  return { rows, tailRows, tailMarkets: tailTickers.size,
           suppressed: perMarket, browse };
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

/**
 * Dollars already COMMITTED per ticker: held positions at cost
 * (count × avg price) plus resting orders (price × remaining). Owner rule
 * 2026-08-30 (the GT −6.5 partial fill, $4.86 held of a $50 unit): exposure
 * only retires a market once it has consumed the unit — until then the rung
 * stays, sized to the HEADROOM. A row whose cost cannot be known (missing
 * avg price / remaining) contributes Infinity, which reproduces the old
 * any-exposure-suppresses behaviour as the conservative fallback.
 */
export function heldCostByTicker(
  positions: {
    ticker: string; count: number; avg_price?: number | null;
  }[] | undefined,
  orders: {
    ticker: string; side?: string; yes_price?: number | null;
    no_price?: number | null; remaining?: number | null;
  }[] | undefined,
): Map<string, number> {
  return heldByTicker(positions, orders).cost;
}

/**
 * What the account already has in each market, on BOTH axes: `cost` (dollars
 * risked: held contracts × cost basis + resting orders × their price) and
 * `win` (the profit those contracts stand to make: held × (1 − cost basis) +
 * resting × (1 − price), gross of fees). The stretch sizing modes measure
 * headroom in `win`; risk mode in `cost`. Unknown prices poison the market
 * (Infinity) exactly as before.
 */
export function heldByTicker(
  positions: {
    ticker: string; count: number; avg_price?: number | null;
  }[] | undefined,
  orders: {
    ticker: string; side?: string; yes_price?: number | null;
    no_price?: number | null; remaining?: number | null;
  }[] | undefined,
): { cost: Map<string, number>; win: Map<string, number> } {
  const cost = new Map<string, number>();
  const win = new Map<string, number>();
  const add = (m: Map<string, number>, t: string, v: number) => m.set(t, (m.get(t) ?? 0) + v);
  for (const p of positions ?? []) {
    if (!p.count) continue;
    const n = Math.abs(p.count);
    if (p.avg_price !== null && p.avg_price !== undefined) {
      add(cost, p.ticker, n * p.avg_price);
      add(win, p.ticker, n * Math.max(0, 1 - p.avg_price));
    } else {
      add(cost, p.ticker, Infinity);
      add(win, p.ticker, Infinity);
    }
  }
  for (const o of orders ?? []) {
    const n = o.remaining;
    if (n === null || n === undefined) { add(cost, o.ticker, Infinity); add(win, o.ticker, Infinity); continue; }
    if (!n) continue;
    const px = o.side === "no" ? o.no_price : o.yes_price;
    if (px === null || px === undefined) { add(cost, o.ticker, Infinity); add(win, o.ticker, Infinity); continue; }
    add(cost, o.ticker, n * px);
    add(win, o.ticker, n * Math.max(0, 1 - px));
  }
  return { cost, win };
}

/** Stat-quote candidates for one game, using the panel's own published rungs. */
export function statCandidates(
  game: KalshiGame,
  slug: string,
  teamA: string,
  teamB: string,
  statLabel: (stat: string) => string,
  rungP: (team: string, stat: string, strike: number) => number | null,
  seriesFor: (stat: string) => string,
  /** Kickoff, epoch ms — the row's timing band. See `timingFor`. */
  kickoffMs?: number,
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
      kickoffMs,
    });
  }
  return out;
}

/* ----------------------------- game-line candidates ------------------------ */
/**
 * Candidates for the three GAME-LINE families, against the published `game`
 * block (exporter schema 2).
 *
 * Until 2026-08-28 the card built candidates from the per-team stat families
 * only, so the "Game lines" filter chip was empty BY CONSTRUCTION. The
 * missing piece was never the UI: it was that winner/spread/total fairs had
 * no published home — they lived inside the maker pipeline, recomputed per
 * seed from compact.json. `team_stats.json` now publishes them, so this
 * function only reads and subtracts, like everything else here.
 *
 * THREE CONVENTIONS DO ALL THE WORK, and each one is a way to lose money if
 * it is wrong:
 *
 * 1. NO IS THE MIRROR, exactly as `price_side` does it: sim → 1 − sim, and
 *    the contract's book is (1 − yes_ask, 1 − yes_bid). That is how an Under
 *    (the NO of an over rung) and a dog (the NO of the favourite) are
 *    reachable at all. Both contracts of a market are emitted; only the
 *    better one survives `buildSuggestions`, which keeps one per ticker.
 *
 * 2. SPREAD RUNGS ARE HOME-PERSPECTIVE. The server normalises Kalshi's
 *    "<Team> wins by over K" to a signed home line L, where the rung's YES is
 *    P(margin > −L) — which is why the published margin grid is signed. A
 *    rung whose raw market named the AWAY team is `mirrored`, and then this
 *    rung's YES is that market's NO: the order side flips even though the
 *    price does not. Getting that backwards places the opposite bet at the
 *    right price, which is the worst kind of wrong.
 *
 * 3. LADDER IDENTITY IS THE RAW MARKET'S TEAM, matching the pipeline's
 *    `ladder_key`: spread rungs are grouped per named team (P(home by >7.5)
 *    and P(away by >7.5) are not complements — the middle is neither), totals
 *    share one ladder, and BOTH winner markets share one, because buying
 *    "A wins" and selling "B wins" are the same bet seen from either end.
 *
 * A strike that is not on the published grid simply has no bet. Never
 * interpolate — the exporter's rule, and the panel's.
 */
export function gameCandidates(
  game: KalshiGame,
  /** Scoreboard card key (what a row scrolls to), not the data slug. */
  cardKey: string,
  teamA: string,
  teamB: string,
  lines: TeamStatsGameLines,
  /** Kickoff, epoch ms — the row's timing band. See `timingFor`. */
  kickoffMs?: number,
): Candidate[] {
  const out: Candidate[] = [];
  // The NO contract's own book. Mirrors the pipeline's (1 - ya, 1 - yb).
  const noBid = (yesAsk: number | null | undefined) =>
    yesAsk === null || yesAsk === undefined ? null : 1 - yesAsk;
  const noAsk = (yesBid: number | null | undefined) =>
    yesBid === null || yesBid === undefined ? null : 1 - yesBid;
  // U+2212 MINUS, not a hyphen: "−7.5" reads as a spread, "-7.5" reads as a
  // stray dash at 11px.
  const spreadText = (line: number) =>
    `${line > 0 ? "+" : "−"}${Math.abs(line)}`;

  /* ---- winner (KXNCAAFGAME): one ladder, one rung, both markets ---- */
  const winLadder = `${cardKey}|KXNCAAFGAME|`;
  for (const q of game.winner_quotes ?? []) {
    const p = q.side === "A" ? lines.winProbHome : lines.winProbAway;
    if (p === null || p === undefined || !q.ticker) continue;
    const yesTeam = q.side === "A" ? teamA : teamB;
    const noTeam = q.side === "A" ? teamB : teamA;
    const base = {
      ticker: q.ticker, slug: cardKey, ladder: winLadder,
      series: "KXNCAAFGAME", strike: 0, statText: "", kickoffMs,
    };
    out.push({
      ...base, team: yesTeam, label: `${yesTeam} to win`,
      rungText: `${yesTeam} to win`, side: "yes",
      simP: p, bid: q.yes_bid, ask: q.yes_ask,
    });
    out.push({
      ...base, team: noTeam, label: `${noTeam} to win`,
      rungText: `${noTeam} to win`, side: "no",
      simP: 1 - p, bid: noBid(q.yes_ask), ask: noAsk(q.yes_bid),
    });
  }

  /* ---- spread (KXNCAAFSPREAD): P(home margin > −line) ---- */
  for (const r of game.spread_ladder ?? []) {
    // The signed key the exporter publishes. A rung off the grid (a strike
    // deeper than ±29.5) simply yields nothing.
    const p = lines.marginRungs?.[String(-r.line)];
    if (typeof p !== "number" || !r.ticker) continue;
    const namedTeam = r.mirrored ? teamB : teamA;   // the RAW market's team
    const base = {
      ticker: r.ticker, slug: cardKey,
      ladder: `${cardKey}|KXNCAAFSPREAD|${namedTeam}`,
      series: "KXNCAAFSPREAD", strike: r.line, statText: "", kickoffMs,
    };
    out.push({
      ...base, team: teamA,
      label: `${teamA} ${spreadText(r.line)}`,
      rungText: spreadText(r.line),
      // Buying this rung's YES on a mirrored rung means a NO order.
      side: r.mirrored ? "no" : "yes",
      simP: p, bid: r.yes_bid ?? null, ask: r.yes_ask ?? null,
    });
    out.push({
      ...base, team: teamB,
      label: `${teamB} ${spreadText(-r.line)}`,
      rungText: spreadText(-r.line),
      side: r.mirrored ? "yes" : "no",
      simP: 1 - p, bid: noBid(r.yes_ask), ask: noAsk(r.yes_bid),
    });
  }

  /* ---- total (KXNCAAFTOTAL): Over is YES, Under is the same market's NO ---- */
  const totLadder = `${cardKey}|KXNCAAFTOTAL|`;
  for (const r of game.total_ladder ?? []) {
    const p = lines.totalRungs?.[String(r.line)];
    if (typeof p !== "number" || !r.ticker) continue;
    const base = {
      ticker: r.ticker, slug: cardKey, ladder: totLadder,
      series: "KXNCAAFTOTAL", strike: r.line, team: "", statText: "", kickoffMs,
    };
    out.push({
      ...base, label: `Over ${r.line} points`, rungText: `Over ${r.line}`,
      side: "yes", simP: p, bid: r.yes_bid ?? null, ask: r.yes_ask ?? null,
    });
    out.push({
      ...base, label: `Under ${r.line} points`, rungText: `Under ${r.line}`,
      side: "no", simP: 1 - p,
      bid: noBid(r.yes_ask), ask: noAsk(r.yes_bid),
    });
  }

  return out;
}

/* ------------------------------ bet-type family ---------------------------- */
/**
 * The second filter row's buckets (user spec, 2026-08-28):
 *   Game lines  — KXNCAAFGAME / KXNCAAFSPREAD / KXNCAAFTOTAL
 *   TD props    — KXNCAAFTEAMRSHTD / KXNCAAFTEAMRECTD
 *   Yardage     — KXNCAAFTEAMRECYDS / KXNCAAFTEAMRSHYDS / KXNCAAFTEAMYDS
 *   Team stats  — KXNCAAFTEAMTOTAL + the receptions/rush-att/sacks/INTs
 *                 families, rather than a fifth chip.
 * A ladder never mixes series (it is keyed by (game, stat, side) in
 * `statCandidates`), so the family is computed once per group, not per row.
 */
export type BetFamily = "game" | "td" | "yardage" | "team";

const FAMILY_BY_SERIES: Record<string, BetFamily> = {
  KXNCAAFGAME: "game",
  KXNCAAFSPREAD: "game",
  KXNCAAFTOTAL: "game",
  KXNCAAFTEAMRSHTD: "td",
  KXNCAAFTEAMRECTD: "td",
  KXNCAAFTEAMRECYDS: "yardage",
  KXNCAAFTEAMRSHYDS: "yardage",
  KXNCAAFTEAMYDS: "yardage",
  KXNCAAFTEAMTOTAL: "team",
  KXNCAAFTEAMREC: "team",
  KXNCAAFTEAMRSHATT: "team",
  KXNCAAFTEAMSACK: "team",
  KXNCAAFTEAMINT: "team",
};

/**
 * Bet-type bucket for a series. The table above is the explicit spec; a
 * series Kalshi adds later (or a candidate source that has not shipped yet,
 * e.g. game-winner/spread/total) falls through to a name heuristic instead of
 * vanishing — Kalshi's own naming convention is `KXNCAAF` + (`TEAM...` for a
 * per-team stat market, anything else for a game-level one), so that split is
 * the fallback. Only a malformed/empty series returns `null`, meaning the row
 * still counts and shows under "All" — it just has no more specific chip.
 * NEVER throw on an unrecognised family.
 */
export function familyForSeries(series: string): BetFamily | null {
  if (series in FAMILY_BY_SERIES) return FAMILY_BY_SERIES[series];
  const rest = (series || "").toUpperCase().replace(/^KXNCAAF/, "");
  if (!rest) return null;
  if (rest.startsWith("TEAM")) {
    if (rest.includes("TD")) return "td";
    if (rest.includes("YDS") || rest.includes("YARD")) return "yardage";
    return "team"; // per-team stat family we have not named yet — closest bucket
  }
  return "game"; // not TEAM-prefixed: a game-level family (spread/total/half/OT/…)
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
  /** Bet-TYPE bucket for the second filter row (see `familyForSeries`).
   *  `null` only for a malformed/unrecognised series — the group still shows
   *  under "All". */
  family: BetFamily | null;
  /** Best rung's net edge — drives ranking AND the at-rest verdict chip. */
  bestEdge: number;
  /** Single-line headline for a >1-rung ladder, e.g. "NMST 14+ & 17+ points". */
  headline: string;
  /** Dollars of the $LADDER_RISK stake allotted per rung in this ladder.
   *  RISK MODE ONLY — under to-win the rungs no longer split the unit evenly,
   *  and `risk` below is the honest number. */
  each: number;
  /** What this ladder actually costs: the rungs' outlay summed. */
  risk: number;
  /** What it returns if every rung lands: the rungs' net win summed. */
  netWin: number;
  /** "to-win" when ANY rung was sized to win rather than to risk — the sizing
   *  wording keys off it, so a mixed book-mode ladder says the truth. */
  sizeMode: "risk" | "to-win";
  /** Any rung hit the maxRiskMultiple ceiling. */
  capped: boolean;
  /** Every rung is outside the tail band (the two sets never mix — they are
   *  selected in separate passes). Drives the muting and the TAIL badge. */
  tail: boolean;
  /** A ladder is one GAME, so every rung shares one timing band. The popover's
   *  time-context sentence comes from here. */
  timing: Timing;
  /* --- week-2 rule labels, folded to the ladder (src/lib/edgeRules.ts) --- */
  /**
   * The BEST rung's abstention — the rung whose edge is the headline number.
   *
   * The headline label and the headline number must describe the SAME
   * contract. A spread ladder is keyed per named team but still spans strikes
   * on both sides of the number (a home −41.5 rung and an away +36.5 rung both
   * belong to the home team's ladder), so a ladder can genuinely mix an
   * abstained rung with a clean one — and when the abstained one is the rung
   * carrying the headline edge, saying nothing would be the row's loudest
   * number standing unqualified.
   */
  abstain: AbstainReason | null;
  /** EVERY rung abstains. Drives the MUTING, which `abstain` alone must not:
   *  greying a ladder whose other rung is a perfectly good bet would be the
   *  row lying about half of itself. */
  abstainAll: boolean;
  /** The BEST rung's cell — the rung whose edge is the headline number. */
  cell: CellName | null;
  /** The BEST rung's ★ verdict. The headline star and the headline edge are
   *  the same rung, always. */
  star: boolean;
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
    // A stat ladder always names one team, so the team is said ONCE and the
    // rungs collapse to "225+ & 250+". A game-line ladder can hold opposite
    // sides of the same family (the home −2.5 rung and the away +9.5 one both
    // belong to that team's spread ladder), and there the short form would
    // silently attribute one team's line to the other — so those spell out
    // both full labels instead. Never guess whose number is whose.
    const sameTeam = rungs.every((r) => r.team === best.team);
    const strikes = rungs.map((r) => r.rungText ?? `${r.strike}+`).join(" & ");
    const headline = rungs.length === 1
      ? best.label
      : sameTeam
        ? `${best.team} ${strikes} ${best.statText}`.replace(/\s+/g, " ").trim()
        : rungs.map((r) => r.label).join(" & ");
    groups.push({
      ladder,
      slug: best.slug,
      rungs,
      family: familyForSeries(rungs[0].series),
      bestEdge: best.edge,
      headline,
      each: round2(unit / group.length),
      risk: round2(rungs.reduce((t, r) => t + r.outlay, 0)),
      netWin: round2(rungs.reduce((t, r) => t + r.netWin, 0)),
      sizeMode: rungs.some((r) => r.sizeMode === "to-win") ? "to-win" : "risk",
      capped: rungs.some((r) => r.capped),
      tail: rungs.every((r) => r.tail),
      timing: best.timing,
      abstain: best.abstain,
      abstainAll: rungs.every((r) => r.abstain !== null),
      cell: best.cell,
      star: best.star,
    });
  }
  groups.sort((a, b) => b.bestEdge - a.bestEdge);
  return groups;
}
