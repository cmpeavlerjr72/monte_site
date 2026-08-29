// src/lib/restingReview.ts
//
// THE RESTING-ORDER REVIEW: hold it, convert it, or pull it.
//
// ---------------------------------------------------------------------------
// The hole this fills
// ---------------------------------------------------------------------------
// The suggestions compute EXCLUDES every ticker the account already holds or
// has resting (`heldTickerSet` in suggestedBets.ts) — correctly: the pipeline
// treats a resting rung as having consumed its ladder slot, so re-suggesting it
// would double the position. The side effect is that the moment the owner rests
// a maker order, the app goes SILENT about that market. Nothing ever says "your
// rest should become a take now that kickoff is close", even though the maker
// pipeline's own doctrine (`scripts/fbs_maker_pipeline.py`) says exactly that:
// far out, resting is fine; a few hours out the take bar drops; inside the last
// hour there is no resting at all, because the pre-kickoff chain cancels every
// unfilled quote at kick−30.
//
// This module is the human half of that doctrine. It re-prices the orders we
// already have and gives each one ONE verdict.
//
// ---------------------------------------------------------------------------
// NO NEW NUMBERS. NOT ONE.
// ---------------------------------------------------------------------------
// Every threshold here is imported from `suggestedBets.ts` — the read-only twin
// of the pipeline — and nothing is restated:
//
//   `timingFor`      the band this game is in, and therefore the take bar
//   `timing.takeThreshold`  6.0¢ / 4.5¢ / 3.0¢ by time to kick
//   `takerFeePer` / `makerFeePer` / `orderFee`   Kalshi's own per-series fees
//   `pregameVerdict` the same gate the suggestions use
//
// If the pipeline's bands move, they move here, because they are the same
// constants. A threshold invented in this file would be a fourth opinion about
// the same decision, which is the bug this whole stack is arranged to prevent.
//
// ---------------------------------------------------------------------------
// The three verdicts
// ---------------------------------------------------------------------------
//   CONVERT  crossing the book RIGHT NOW clears this band's take bar, net of
//            the taker fee. The rest has done its job of trying; the clock has
//            made taking the better trade.
//   PULL     the sim edge AT OUR OWN RESTING PRICE is gone (≤ 0). That is the
//            serious one: the bet is no longer good even if it fills, so the
//            order should come off the book rather than wait for a fill we no
//            longer want.
//   HOLD     neither. The rest is still the right order.
//
// A fourth display state, "—", is not a verdict: it is the honest answer when
// the market cannot be priced (no published rung, no seeds, no book). It never
// counts as action needed.
//
// PREGAME ONLY, same as the suggestions: a kicked game's resting orders belong
// to the pre-kickoff canceller, not to a human review of pregame fairs.
//
// ZERO NEW NETWORK LOAD: the portal poll (30s) supplies the orders, the Kalshi
// poll (45s) supplies the book, the page's team_stats loader and seed cache
// supply the fairs, and the page's 30s wall clock supplies the band.

import { useMemo } from "react";
import type { KalshiGame } from "./kalshi";
import {
  cheerLabel, parseNcaafTicker, buildCodeToSlug,
  type PortalPayload,
} from "./kalshiPortal";
import { seriesOfTicker } from "./teamStatMarkets";
import {
  makerFeePer, orderFee, takerFeePer, timingFor, pregameVerdict,
  type FeeParams, type Timing,
} from "./suggestedBets";
import type { SuggestGame } from "./useSuggestions";

/** One market's book in the RAW MARKET's own denomination (P(YES) of the
 *  ticker), which is the denomination an order's side is expressed in. */
export type RawBook = { yes_bid: number | null; yes_ask: number | null };

/**
 * Ticker -> raw book, straight off the live Kalshi feed the page already polls.
 *
 * ORIENTATION IS THE WHOLE JOB. A spread rung the server MIRRORED to home
 * perspective carries a book oriented to the RUNG's yes — which is the market's
 * NO — so its raw book is the complement, swapped. Getting this backwards
 * prices the opposite bet at a plausible-looking number, which is the worst
 * kind of wrong (the same rule `gameCandidates` follows for its candidates).
 */
export function buildFeedBook(
  kalshiBySlug: Map<string, KalshiGame>,
): Map<string, RawBook> {
  const out = new Map<string, RawBook>();
  const inv = (v: number | null | undefined) =>
    v === null || v === undefined ? null : 1 - v;
  const put = (
    ticker: string | undefined,
    bid: number | null | undefined,
    ask: number | null | undefined,
    mirrored?: boolean,
  ) => {
    if (!ticker) return;
    out.set(ticker, mirrored
      ? { yes_bid: inv(ask), yes_ask: inv(bid) }
      : { yes_bid: bid ?? null, yes_ask: ask ?? null });
  };
  for (const g of kalshiBySlug.values()) {
    for (const q of g.stat_quotes ?? []) put(q.ticker, q.yes_bid, q.yes_ask);
    for (const q of g.winner_quotes ?? []) put(q.ticker, q.yes_bid, q.yes_ask);
    for (const r of g.spread_ladder ?? []) put(r.ticker, r.yes_bid, r.yes_ask, r.mirrored);
    for (const r of g.total_ladder ?? []) put(r.ticker, r.yes_bid, r.yes_ask, r.mirrored);
  }
  return out;
}

/**
 * The pre-kickoff chain cancels every unfilled quote at kick−30
 * (`PULL_BEFORE_KICK_MIN` in cfb-props-sim's fbs_maker_pipeline.py, the same
 * rule `REST_CUTOFF_MS` in suggestedBets.ts is sized against — inside the last
 * hour a rest has ~30 minutes of life, not sixty).
 *
 * DISPLAY ONLY. No verdict reads it: this is the number that lets a HOLD say
 * WHEN it stops being a hold, which is the fact a bare "HOLD — rest is still
 * right" hid at 40 minutes from the pull.
 */
export const PULL_BEFORE_KICK_MS = 30 * 60 * 1000;

export type RestingVerdict = "CONVERT" | "HOLD" | "PULL" | "UNPRICED";

export type RestingRow = {
  /** React key and the id both routes address. */
  orderId: string;
  ticker: string;
  side: "yes" | "no";
  /** Bet-slip words for the outcome being cheered for. Same vocabulary the
   *  My Book strip uses — one label for one bet across the app. */
  label: string;
  /** Scoreboard card key, so a row can jump to the game it is on. */
  cardKey: string;
  teamA: string;
  teamB: string;
  /** Contracts still working. */
  count: number;
  /** What we are resting at, in OUR side's denomination. */
  restPrice: number;
  /**
   * THE EXPOSURE OF THE REST, on the same terms the row already states it:
   * `count` contracts at `restPrice`. A contract settles at $1, so
   *
   *     restStake + restWin === count      (exactly, by construction)
   *
   * and `restFee` — the maker fee this series would charge WHEN IT FILLS, zero
   * on the families that charge none — sits outside both, exactly as the My
   * Book strip keeps fees outside its stake. Scope is the REMAINING order:
   * anything already filled is a held position and is counted there.
   */
  restStake: number;
  restWin: number;
  restFee: number | null;
  /** What crossing costs right now, our side — null when nothing is offered. */
  ask: number | null;
  /** Where that book came from: the 45s slate feed, or the portal payload's
   *  own per-ticker read (30s). Named in the popover, because a number's
   *  freshness is part of the number. */
  bookFrom: "feed" | "portal" | null;
  /** Sim P of OUR side. Null when nothing prices this market. */
  simP: number | null;
  /** Net edge if we crossed at `ask` right now (after the TAKER fee). */
  takeEdge: number | null;
  /** Net edge at our own resting price (after the maker fee — zero on the
   *  per-team families, which charge none). */
  restEdge: number | null;
  /** Per-contract taker fee at `ask`, for the popover. */
  takeFeePer: number | null;
  /** Rounded per-ORDER taker fee and total outlay at `count` — what the
   *  exchange would actually charge, and what the slip spends. */
  takeFee: number | null;
  takeOutlay: number | null;
  timing: Timing;
  /**
   * THE HORIZON — when this specific order gets cancelled whether or not it
   * has filled: kickoff − 30 minutes. Null when the kickoff is unknown, which
   * is also the case `timingFor` treats as `far`, so a null can never reach a
   * chip that wants to print a time.
   */
  pullAtMs: number | null;
  /** That mark is already behind us (we are inside the last 30 minutes, and
   *  the chain's next sweep takes this order). A time in the past must not be
   *  printed as a future event. */
  pullDue: boolean;
  verdict: RestingVerdict;
  /** The verdict in one sentence, for the chip's title and the popover. */
  reason: string;
  feeType: string;
};

/**
 * Is the automatic pull close enough that a verdict has to carry it?
 *
 * Answered off the SHARED band ladder, not a threshold of its own: "soon" and
 * "imminent" are the ≤3h bands, which is exactly the window in which the take
 * bar has already relaxed because resting is running out of runway. That is
 * the same fact stated in wording rather than in cents, so it has to move with
 * the same boundary (the NO NEW NUMBERS doctrine at the top of this file).
 */
export const pullIsInSight = (r: RestingRow): boolean =>
  r.pullAtMs !== null && (r.timing.band === "soon" || r.timing.band === "imminent");

export type RestingReview = {
  rows: RestingRow[];
  /** CONVERT + PULL — the badge's number. */
  needAction: number;
  /** Resting app orders skipped because their game is no longer pregame. They
   *  belong to the pre-kickoff canceller; counted so the block can say so
   *  rather than silently shrinking. */
  postKick: number;
  /** Resting orders this app did NOT place (the maker pipeline's, or the
   *  owner's own). Never actioned from here — counted, in words. */
  notOurs: number;
};

const EMPTY: RestingReview = { rows: [], needAction: 0, postKick: 0, notOurs: 0 };

/** Verdict order for the block: what needs doing, first. */
const RANK: Record<RestingVerdict, number> = {
  CONVERT: 0, PULL: 1, HOLD: 2, UNPRICED: 3,
};

export type RestingReviewInput = {
  portal: PortalPayload | null;
  /** The page's slate, for the pregame gate and the kickoff clock. Pass an
   *  EMPTY array for a non-owner: this must not run without a portal session. */
  games: SuggestGame[];
  kalshiBySlug: Map<string, KalshiGame>;
  feeParams: Record<string, FeeParams>;
  /** P(YES) of a raw market ticker — the SAME function the portal's held
   *  position Sim EV prices with (`buildPortalYesP`). Never a second pricer. */
  yesP: (ticker: string) => number | null;
  /** The page's ticking wall clock (30s). Drives the pregame gate and the band. */
  nowMs: number;
};

export function computeRestingReview({
  portal, games, kalshiBySlug, feeParams, yesP, nowMs,
}: RestingReviewInput): RestingReview {
  const orders = portal?.orders ?? [];
  if (!orders.length || !games.length) return EMPTY;

  const codeToKey = buildCodeToSlug(kalshiBySlug);
  const gameByKey = new Map(games.map((g) => [g.key, g]));
  const feed = buildFeedBook(kalshiBySlug);

  const rows: RestingRow[] = [];
  let postKick = 0, notOurs = 0;

  for (const o of orders) {
    // A combo trades several markets at once; neither route takes one, and
    // "convert" is not even a defined operation on it.
    if (o.legs?.length) continue;
    if (o.app !== true) { notOurs += 1; continue; }
    const side = o.side === "no" ? "no" : "yes";
    const count = Math.floor(o.remaining ?? 0);
    if (count < 1) continue;
    const restPrice = side === "no" ? o.no_price : o.yes_price;
    if (restPrice === null || restPrice === undefined) continue;

    const t = parseNcaafTicker(o.ticker);
    const cardKey = t ? codeToKey.get(t.code) : undefined;
    const game = cardKey ? gameByKey.get(cardKey) : undefined;
    if (!game) continue;                      // off-slate: nothing to price it with
    // THE SAME GATE AS THE SUGGESTIONS. A kicked game's fairs are pregame
    // distributions and this review is built out of them, so a live game is
    // not reviewable here — its rests are the pre-kickoff chain's business.
    if (!pregameVerdict(game, nowMs).ok) { postKick += 1; continue; }

    const timing = timingFor(game.kickoffMs, nowMs);
    const fp = feeParams[seriesOfTicker(o.ticker)];

    // Book: the slate feed first (45s, the same quotes every suggestion is
    // priced off), the portal payload's own per-ticker read as the fallback.
    const fb = feed.get(o.ticker);
    const raw: RawBook | null = fb
      ? fb
      : (o.mkt_yes_bid ?? null) !== null || (o.mkt_yes_ask ?? null) !== null
        ? { yes_bid: o.mkt_yes_bid ?? null, yes_ask: o.mkt_yes_ask ?? null }
        : null;
    const bookFrom: RestingRow["bookFrom"] = fb ? "feed" : raw ? "portal" : null;
    // The ask on OUR side. A NO buy lifts (1 − the yes bid): the same mirror
    // `gameCandidates` and the server's live re-check both use.
    const ask = raw === null
      ? null
      : side === "yes"
        ? raw.yes_ask
        : raw.yes_bid === null ? null : round2(1 - raw.yes_bid);

    const yes = yesP(o.ticker);
    const simP = yes === null ? null : side === "no" ? 1 - yes : yes;

    const takeFeePer = ask === null ? null : takerFeePer(ask, fp);
    const takeEdge = simP === null || ask === null || takeFeePer === null
      ? null : simP - ask - takeFeePer;
    const restEdge = simP === null
      ? null : simP - restPrice - makerFeePer(restPrice, fp);
    const takeFee = ask === null ? null : orderFee(ask, count, false, fp);
    const takeOutlay = ask === null || takeFee === null
      ? null : round2(ask * count + takeFee);

    // DISPLAY ONLY — nothing below reads these, and no verdict depends on them.
    // `restWin` is derived from the ROUNDED stake so the two halves add up to
    // `count` on screen to the cent, never to a cent either side of it.
    const restStake = round2(restPrice * count);
    const restWin = round2(count - restStake);
    const restFee = orderFee(restPrice, count, true, fp);
    const pullAtMs = typeof game.kickoffMs === "number" && Number.isFinite(game.kickoffMs)
      ? game.kickoffMs - PULL_BEFORE_KICK_MS
      : null;

    let verdict: RestingVerdict;
    let reason: string;
    if (simP === null) {
      verdict = "UNPRICED";
      reason = "The sim has no price for this market — no published rung and " +
               "no seeds — so there is no verdict to give. The order is left " +
               "exactly as it is.";
    } else if (takeEdge !== null && takeEdge >= timing.takeThreshold) {
      // CONVERT IS TESTED FIRST. On any order that could actually be resting,
      // the two tests cannot both fire: a rest sits UNDER the ask, so its edge
      // is the bigger of the two, and a take edge clearing a positive bar means
      // the rest edge cleared it too. Should a book ever be strange enough to
      // produce both (a resting price above the current ask, which would have
      // crossed and filled), CONVERT is still the right answer — "the bet is no
      // longer good" is false when crossing right now clears the bar.
      verdict = "CONVERT";
      reason = `Crossing now is worth ${cents1(takeEdge)} after the taker fee, ` +
               `which clears this band's ${bar(timing.takeThreshold)} bar. ` +
               `The rest is still ${cents1(restEdge ?? 0)} — better per contract, ` +
               `but only if it fills.`;
    } else if (restEdge !== null && restEdge <= 0) {
      verdict = "PULL";
      reason = `At our own resting price of ${cents0(restPrice)} the sim edge is ` +
               `${cents1(restEdge)} — gone. This is not a bet worth having even ` +
               `if it fills, so the order should come off the book.`;
    } else {
      verdict = "HOLD";
      reason = ask === null
        ? `Nothing is offered on this side right now, so there is nothing to ` +
          `cross. The rest is still worth ${cents1(restEdge ?? 0)} if it fills.`
        : `Crossing now is worth ${cents1(takeEdge ?? 0)}, under this band's ` +
          `${bar(timing.takeThreshold)} bar, and the rest is still worth ` +
          `${cents1(restEdge ?? 0)}. Leave it working.`;
    }

    rows.push({
      orderId: o.order_id,
      ticker: o.ticker,
      side,
      label: cheerLabel(o.ticker, side),
      cardKey: cardKey as string,
      teamA: game.teamA, teamB: game.teamB,
      count,
      restPrice,
      restStake, restWin, restFee,
      ask, bookFrom,
      simP, takeEdge, restEdge, takeFeePer, takeFee, takeOutlay,
      timing,
      pullAtMs, pullDue: pullAtMs !== null && pullAtMs <= nowMs,
      verdict, reason,
      feeType: fp?.fee_type ?? "unknown (assumed maker-charging)",
    });
  }

  rows.sort((a, b) => {
    if (RANK[a.verdict] !== RANK[b.verdict]) return RANK[a.verdict] - RANK[b.verdict];
    const ax = a.timing.msToKick ?? Infinity;
    const bx = b.timing.msToKick ?? Infinity;
    return ax - bx;
  });

  return {
    rows,
    needAction: rows.filter((r) => r.verdict === "CONVERT" || r.verdict === "PULL").length,
    postKick,
    notOurs,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
/** "+4.2¢" — the same signed-cents register the suggestion rows print in. */
const cents1 = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}¢`;
const cents0 = (v: number) => `${Math.round(v * 100)}¢`;
/** A THRESHOLD is unsigned, and a trailing zero on one reads as false
 *  precision: "6¢", "4.5¢" — the same register suggestedBets prints bars in. */
const bar = (v: number) => {
  const c = Math.round(v * 1000) / 10;
  return `${Number.isInteger(c) ? c : c.toFixed(1)}¢`;
};

/** The compute, memoised on the page's own inputs. No effect, no fetch, no
 *  timer: it re-runs when a feed the page already holds delivers. */
export function useRestingReview(input: RestingReviewInput): RestingReview {
  const { portal, games, kalshiBySlug, feeParams, yesP, nowMs } = input;
  return useMemo(
    () => computeRestingReview({ portal, games, kalshiBySlug, feeParams, yesP, nowMs }),
    [portal, games, kalshiBySlug, feeParams, yesP, nowMs],
  );
}
