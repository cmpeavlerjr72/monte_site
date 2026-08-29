// My-Kalshi portfolio portal client — the owner's resting orders and fills,
// fetched from OUR server's token-gated /api/portfolio/cfb and grouped by
// game so the scoreboard can badge and pin the games the owner has money on.
//
// The token is the owner's shared secret (set as CFB_PORTFOLIO_TOKEN on the
// server). It lives in localStorage as a per-browser convenience — this is a
// single-operator, read-only view; a leaked token exposes the owner's own
// order list, never the ability to trade. All storage access is guarded the
// usePrefs way: failure degrades to logged-out, never a crash.
//
// Ticker -> game join: every Kalshi NCAAF ticker embeds one game code
// ("KXNCAAFSPREAD-26AUG27CARKUTM-UTM4" -> "26AUG27CARKUTM"), and the site's
// KalshiGame rows carry the same code in event_ticker — so the join is a
// string split, not a name parse (the ONE name join stays in cfbNames).

import { useEffect, useRef, useState } from "react";
import type { KalshiGame } from "./kalshi";
// The bet-type taxonomy has ONE definition, in the suggestions engine. The
// settled record classifies with the same function the type filter does, so a
// series Kalshi adds later lands in the same bucket in both places (import
// only — suggestedBets.ts is read-only).
import { familyForSeries } from "./suggestedBets";

const TOKEN_KEY = "cfb.portalToken";
const POLL_MS = 30_000;

export function readPortalToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function writePortalToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — login simply will not persist */
  }
}

/** One leg of a multivariate combo. The combo's own ticker is an opaque
 *  shard hash; these per-game market tickers are what joins to cards. */
export type PortalLeg = { market_ticker: string; side: string };

export type PortalOrder = {
  ticker: string; order_id: string; side: string;
  yes_price: number | null; no_price: number | null;
  initial: number | null; filled: number | null; remaining: number | null;
  created_time: string;
  /** Present on combo entries; the row renders on EVERY leg's card. */
  legs?: PortalLeg[]; title?: string;
  /** Live book on the entry's own market, refreshed with each payload. */
  mkt_yes_bid?: number | null; mkt_yes_ask?: number | null;
  /**
   * THIS APP placed it — the server tested the order's client_order_id against
   * its own ORDERS_TAG. The tag itself is never restated on the client: one
   * definition, server-side, and this boolean is what it decided.
   *
   * It is the gate on every per-order control in the UI (the ✕ and the
   * resting-order review), because it is exactly what the cancel and convert
   * routes will accept. Absent on a server that predates the flag — treat as
   * false, which offers no controls rather than offering ones that would 404.
   */
  app?: boolean;
};
export type PortalFill = {
  ticker: string; side: string; action: string;
  count: number | null; yes_price: number | null; no_price: number | null;
  fee: number | null; is_taker: boolean; created_time: string;
};
/** Held contracts, computed SERVER-side from /portfolio/positions — the
 *  ground truth for "what filled". Fills alone cannot reconstruct a held
 *  side: Kalshi logs a NO buy as a YES-book "sell". */
export type PortalPosition = {
  ticker: string; side: string; count: number;
  avg_price: number | null; fees: number | null;
  legs?: PortalLeg[]; title?: string;
  mkt_yes_bid?: number | null; mkt_yes_ask?: number | null;
};
export type PortalPayload = {
  fetched_at: string; orders: PortalOrder[]; fills: PortalFill[];
  positions: PortalPosition[];
  /** Order-entry staging state (server's CFB_ORDERS_LIVE). FALSE means the
   *  order routes validate, cap, re-check the book and log — and submit
   *  nothing. The confirm popup wears its DRY RUN badge off this, so the
   *  staging is visible BEFORE the press, not only in the response. Optional
   *  because a server that predates order entry simply omits it. */
  orders_live?: boolean;
};

/** "KXNCAAFSPREAD-26AUG27CARKUTM-UTM4" -> "26AUG27CARKUTM" (else null). */
export function portalGameCode(ticker: string): string | null {
  const parts = String(ticker || "").split("-");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/* ------------------------------ bet metrics ------------------------------ */

export type SeedPair = { A: number[]; B: number[] };

/** Decomposed NCAAF game ticker. The event code's team blob is away+home
 *  concatenated; when the strike names one team, the other is the remainder
 *  and "ends with" tells us the strike team is HOME. */
export function parseNcaafTicker(ticker: string) {
  const p = String(ticker || "").split("-");
  if (p.length < 2) return null;
  const fam = p[0].replace("KXNCAAF", "");
  const code = p[1];
  const strike = p[2] || "";
  const m = strike.match(/^([A-Z]*?)(\d+)$/);
  const strikeTeam = m ? m[1] : (/^[A-Z]+$/.test(strike) ? strike : "");
  const n = m ? Number(m[2]) : null;
  const teams = code.replace(/^\d{2}[A-Z]{3}\d{2}/, "");
  let other = "";
  let strikeIsHome = false;
  if (strikeTeam && teams.endsWith(strikeTeam)) {
    other = teams.slice(0, teams.length - strikeTeam.length);
    strikeIsHome = true;
  } else if (strikeTeam && teams.startsWith(strikeTeam)) {
    other = teams.slice(strikeTeam.length);
  }
  return { fam, code, strike, strikeTeam, n, other, strikeIsHome };
}

/**
 * Bet-slip wording for the per-team stat families, keyed by the ticker's
 * family segment. This is the DISPLAY vocabulary, not the pricing mapping —
 * `STAT_FOR_SERIES` in teamStatMarkets.ts stays the single authority for which
 * families the sim can price, and this map deliberately covers MORE of them:
 * TD/FG/TO are unpriceable (they render a "—" verdict) but they can still be
 * HELD, and a held bet must read as a bet ("UNLV 4+ TDs"), never as a raw
 * ticker fragment ("TEAMTD UNLV4").
 */
const STAT_WORDS: Record<string, string> = {
  TEAMTOTAL: "points",
  TEAMRECYDS: "rec yds",
  TEAMRSHYDS: "rush yds",
  TEAMYDS: "total yds",
  TEAMREC: "receptions",
  TEAMRSHATT: "rush att",
  TEAMRSHTD: "rush TDs",
  TEAMRECTD: "rec TDs",
  TEAMSACK: "sacks",
  TEAMINT: "INTs",
  TEAMTD: "TDs",
  TEAMFG: "FGs",
  TEAMTO: "turnovers",
};

/** Label of the outcome the owner is CHEERING for — NO sides are flipped to
 *  the complement bet ("no UND -24.5" reads "LIU +24.5"). Strikes keep
 *  KALSHI'S OWN wording ("175+", never "174.5+"): the house rule is that a
 *  number on screen is the one the venue settles on. */
export function cheerLabel(ticker: string, side: string): string {
  const t = parseNcaafTicker(ticker);
  if (!t) return ticker;
  const no = side === "no";
  const half = t.n !== null ? t.n - 0.5 : null;
  if (t.fam === "TOTAL" && half !== null) return `Total ${no ? "u" : "o"}${half}`;
  if (t.fam === "SPREAD" && half !== null) {
    return no ? `${t.other || "opp"} +${half}` : `${t.strikeTeam} -${half}`;
  }
  if (t.fam === "GAME" && t.strikeTeam) {
    return `${no ? (t.other || "opp") : t.strikeTeam} ML`;
  }
  const words = STAT_WORDS[t.fam];
  if (words && t.n !== null && t.strikeTeam) {
    // A stat market is a threshold, so its NO is "stays under", not a mirror
    // strike — say that in words rather than inventing a line.
    return no
      ? `${t.strikeTeam} under ${t.n} ${words}`
      : `${t.strikeTeam} ${t.n}+ ${words}`;
  }
  return `${t.fam} ${t.strike}`.trim();
}

/** P(YES) of one game market under the sim's seed arrays; null = can't. */
export function simYesP(ticker: string, seeds: SeedPair | undefined): number | null {
  const t = parseNcaafTicker(ticker);
  if (!t || !seeds || !seeds.A.length || seeds.A.length !== seeds.B.length) return null;
  const { A, B } = seeds;
  let hit = 0;
  if (t.fam === "TOTAL" && t.n !== null) {
    const line = t.n - 0.5;
    for (let i = 0; i < A.length; i++) if (A[i] + B[i] > line) hit++;
  } else if ((t.fam === "SPREAD" && t.n !== null) || (t.fam === "GAME" && t.strikeTeam)) {
    const line = t.fam === "SPREAD" ? (t.n as number) - 0.5 : 0;
    for (let i = 0; i < A.length; i++) {
      if ((t.strikeIsHome ? A[i] - B[i] : B[i] - A[i]) > line) hit++;
    }
  } else return null;
  return hit / A.length;
}

/**
 * P(YES) for ONE market ticker — the portal's pricing plumbing, in one place.
 *
 * Held positions, resting orders and the resting-order REVIEW all have to price
 * the same market the same way, so the two-source fallback lives here rather
 * than inside `computePortalBets`:
 *
 *   1. the SEED arrays, which price the game lines (total / spread / winner)
 *      by counting simulated outcomes,
 *   2. the published team_stats RUNGS for the per-team stat ladders, which are
 *      not in the seed arrays at all (see `teamStatMarkets.buildStatYesP`), and
 *   3. the published GAME block for the game lines (see
 *      `teamStatMarkets.buildGameYesP`).
 *
 * (3) is not a duplicate of (1). The seeds are only loaded for games the owner
 * already has entries on, and only when that game's compact.json exists — an
 * FCS card publishes no compacts, so every game-line ticker there priced to
 * null and the resting review had no verdict to give. The published block is
 * the same number the suggestions pipeline prices those markets with, so it is
 * the right fallback rather than a second opinion.
 *
 * Always RAW-MARKET denominated: P(the market's YES), never a side we chose.
 * A caller holding the NO takes the complement itself — the same convention
 * `simYesP` and the published rungs already use.
 *
 * Null means "we cannot price this", which is the honest answer and the reason
 * a row prints "—" instead of a number.
 */
export function buildPortalYesP(
  kalshiBySlug: Map<string, KalshiGame>,
  seedsBySlug: Map<string, SeedPair>,
  statYesP?: (ticker: string) => number | null,
  gameYesP?: (ticker: string) => number | null,
): (ticker: string) => number | null {
  const codeToSlug = buildCodeToSlug(kalshiBySlug);
  return (ticker: string): number | null => {
    const t = parseNcaafTicker(ticker);
    const slug = t ? codeToSlug.get(t.code) : undefined;
    return simYesP(ticker, slug ? seedsBySlug.get(slug) : undefined)
      ?? statYesP?.(ticker) ?? gameYesP?.(ticker) ?? null;
  };
}

export function buildCodeToSlug(kalshiBySlug: Map<string, KalshiGame>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [slug, kg] of kalshiBySlug) {
    const code = portalGameCode(kg.event_ticker);
    if (code) out.set(code, slug);
  }
  return out;
}

/** One displayed bet with its money metrics. EVs are $ vs the stake:
 *  p·count − risked. Kalshi p = live mid of the entry's own market, oriented
 *  to the held side; sim p multiplies leg probabilities (independence
 *  approximation on combos). Fees = paid so far (positions only).
 *
 *  THE EXPOSURE IDENTITY, which the strip displays and must never break:
 *  a contract settles at $1, so `risked + toWin === count` exactly, for a held
 *  position and a resting order alike. `risked` is count × the price this row
 *  is counted at (avg fill price for a position, our own resting price for an
 *  order) and `fees` sits OUTSIDE both — it is itemised on its own rather than
 *  folded into either half, so the two numbers on screen always add up. */
export type PortalBet = {
  key: string; kind: "position" | "order"; combo: boolean;
  label: string; side: string; count: number;
  risked: number; toWin: number; fees: number;
  kalshiP: number | null; kalshiEV: number | null;
  simP: number | null; simEV: number | null;
  slugs: string[]; title?: string;
  /** Legs in the entry (1 = a straight bet). A combo renders on EVERY leg's
   *  card, so the display has to be able to say "3-leg" there. */
  legN: number;
  /** RESTING ORDERS ONLY — the partial-fill picture. `count` is what is still
   *  working, so "38 of 57 filled" needs the other two numbers; the filled 38
   *  come back separately as a held position (positions are the ground truth).
   *  Null on positions. */
  filled: number | null; initial: number | null;
  /** RESTING ORDERS ONLY — Kalshi's order id, which the cancel and convert
   *  routes address. Absent on positions and on combo rows. */
  orderId?: string;
  /** RESTING ORDERS ONLY — this app placed it (server's ORDERS_TAG test), so
   *  the cancel/convert routes will accept it. False for the maker pipeline's
   *  orders and for anything placed by hand: those are shown, never actioned. */
  app?: boolean;
  /** The one market this entry trades, when it is a straight bet. A combo has
   *  several and gets none — it is not convertible. */
  ticker?: string;
};

export type PortalTotals = {
  n: number; risked: number; toWin: number; fees: number;
  kalshiEV: number | null; simEV: number | null;
  /** How many of the n bets each source could actually price. A summed EV over
   *  a subset must never be presented as if it covered the whole book. */
  simPriced: number; kalshiPriced: number;
};

export function computePortalBets(
  payload: PortalPayload | null,
  kalshiBySlug: Map<string, KalshiGame>,
  seedsBySlug: Map<string, SeedPair>,
  /** P(YES) for market families the SEED arrays cannot price — the per-team
   *  stat ladders, read off the published team_stats rungs (see
   *  `teamStatMarkets.buildStatYesP`). Optional: without it those legs price
   *  to null exactly as they did before 2026-08-28. */
  statYesP?: (ticker: string) => number | null,
  /** P(YES) for the GAME-LINE families off the published game block (see
   *  `teamStatMarkets.buildGameYesP`) — what prices a held total or spread on a
   *  game whose seed arrays were never loaded. Same optionality. */
  gameYesP?: (ticker: string) => number | null,
): { bets: PortalBet[]; bySlug: Map<string, PortalBet[]>; unmatched: number; totals: PortalTotals } {
  const bets: PortalBet[] = [];
  const bySlug = new Map<string, PortalBet[]>();
  let unmatched = 0;
  const codeToSlug = buildCodeToSlug(kalshiBySlug);
  const slugOf = (tk: string): string | undefined => {
    const t = parseNcaafTicker(tk);
    return t ? codeToSlug.get(t.code) : undefined;
  };
  // ONE pricing implementation, shared with the resting-order review. See
  // `buildPortalYesP`.
  const yesP = buildPortalYesP(kalshiBySlug, seedsBySlug, statYesP, gameYesP);

  const push = (
    e: PortalOrder | PortalPosition, kind: PortalBet["kind"],
    count: number | null, price: number | null, fees: number,
    fill?: { filled: number | null; initial: number | null },
  ) => {
    if (count === null || price === null || count <= 0) return;
    const legs = e.legs?.length
      ? e.legs.map((l) => ({ ticker: l.market_ticker, side: l.side }))
      : [{ ticker: e.ticker, side: e.side }];
    const slugs = [...new Set(legs.map((l) => slugOf(l.ticker)).filter(Boolean))] as string[];
    if (!slugs.length) unmatched++;
    const risked = count * price;
    const bid = e.mkt_yes_bid ?? null;
    const ask = e.mkt_yes_ask ?? null;
    // A 0/1 book is EMPTY (nobody quoting), not a 50% opinion.
    const degenerate = (bid ?? 0) <= 0.01 && (ask ?? 1) >= 0.99;
    const mid = degenerate ? null
      : bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask;
    const kalshiP = mid === null ? null : e.side === "no" ? 1 - mid : mid;
    let simP: number | null = 1;
    for (const l of legs) {
      // Seeds price the GAME lines (total/spread/winner) where they are
      // loaded; the per-team stat ladders are not in the seed arrays at all,
      // and a game with no compact has no seeds either. Both fall through to
      // the published rungs. Either way a NO leg is the complement.
      const py = yesP(l.ticker);
      if (py === null) { simP = null; break; }
      simP *= l.side === "no" ? 1 - py : py;
    }
    if (simP !== null && e.legs?.length && e.side === "no") simP = 1 - simP;
    const bet: PortalBet = {
      key: `${kind}:${e.ticker}:${(e as PortalOrder).order_id ?? e.side}`,
      kind, combo: Boolean(e.legs?.length),
      label: e.legs?.length
        ? legs.map((l) => cheerLabel(l.ticker, l.side)).join(" + ")
        : cheerLabel(e.ticker, e.side),
      side: e.side, count, risked, toWin: count - risked, fees,
      kalshiP, kalshiEV: kalshiP === null ? null : kalshiP * count - risked,
      simP, simEV: simP === null ? null : simP * count - risked,
      slugs, title: e.title,
      legN: legs.length,
      filled: fill?.filled ?? null, initial: fill?.initial ?? null,
      // Order identity travels with the row so a per-order control (the ✕, the
      // review's Convert) can address it. A combo is deliberately left without
      // one: it trades several markets and neither route takes it.
      orderId: kind === "order" ? (e as PortalOrder).order_id : undefined,
      app: kind === "order" ? (e as PortalOrder).app === true : undefined,
      ticker: e.legs?.length ? undefined : e.ticker,
    };
    bets.push(bet);
    for (const s of slugs) {
      const arr = bySlug.get(s) ?? [];
      arr.push(bet);
      bySlug.set(s, arr);
    }
  };

  if (payload) {
    for (const p of payload.positions) push(p, "position", p.count, p.avg_price, p.fees ?? 0);
    for (const o of payload.orders) {
      push(o, "order", o.remaining, o.side === "no" ? o.no_price : o.yes_price, 0,
           { filled: o.filled, initial: o.initial });
    }
  }

  const totals: PortalTotals = {
    n: bets.length, risked: 0, toWin: 0, fees: 0,
    kalshiEV: null, simEV: null, simPriced: 0, kalshiPriced: 0,
  };
  for (const b of bets) {
    totals.risked += b.risked;
    totals.toWin += b.toWin;
    totals.fees += b.fees;
    if (b.kalshiEV !== null) { totals.kalshiEV = (totals.kalshiEV ?? 0) + b.kalshiEV; totals.kalshiPriced++; }
    if (b.simEV !== null) { totals.simEV = (totals.simEV ?? 0) + b.simEV; totals.simPriced++; }
  }
  return { bets, bySlug, unmatched, totals };
}

/* ---------------------------------------------------- the settled record ---- */

/**
 * ONE settled market, already normalised to DOLLARS by the server (see
 * `portalSettlements` in server/liveScores.ts — the upstream `revenue` is in
 * CENTS and has no dollar sibling, which is exactly why that conversion lives
 * server-side and is never repeated here).
 *
 * `fees` were charged at FILL time and are OUTSIDE revenue and cost — measured
 * against the real account, not assumed.
 */
export type PortalSettlement = {
  ticker: string;
  event_ticker: string;
  /** Kalshi's own word: "yes" | "no" | "scalar". Reported, never graded on. */
  market_result: string;
  yes_count: number;
  no_count: number;
  revenue: number;
  cost: number;
  fees: number;
  settled_time: string;
};

/**
 * Bet-type buckets for the settled record.
 *
 * The stat families are the suggestions engine's own (`familyForSeries`), so
 * the record and the type filter can never disagree about what a market is.
 * The game-line bucket is the one place this goes FINER than the filter: the
 * filter offers a single "Game lines" chip, but a settled record whose whole
 * point is "which kind of bet is losing me money" has to separate a winner
 * from a spread from a total. Same taxonomy, one extra level of detail.
 */
export type BetTypeKey = "winner" | "spread" | "total" | "td" | "yardage" | "team" | "other";

const BET_TYPE_LABEL: Record<BetTypeKey, string> = {
  winner: "Winners",
  spread: "Spreads",
  total: "Totals",
  // Wording copied from the type-filter chips, deliberately: two names for one
  // bucket is how a reader stops trusting either screen.
  td: "TD props",
  yardage: "Yardage",
  team: "Team totals",
  other: "Other",
};

/** Display order — the filter row's order, with game lines expanded. */
const BET_TYPE_ORDER: BetTypeKey[] = ["winner", "spread", "total", "td", "yardage", "team", "other"];

export function betTypeOf(ticker: string): BetTypeKey {
  const series = String(ticker || "").split("-")[0].toUpperCase();
  const fam = familyForSeries(series);
  if (fam === "game") {
    if (series === "KXNCAAFGAME") return "winner";
    if (series === "KXNCAAFSPREAD") return "spread";
    if (series === "KXNCAAFTOTAL") return "total";
    // A game-level family we have no word for yet (halves, OT…). It still
    // COUNTS — it just says "Other" rather than being labelled a guess.
    return "other";
  }
  return fam ?? "other";
}

/** A settled tally: the record, the money, and the parts it came from. */
export type RecordLine = {
  key: string;
  label: string;
  /** Markets, not dollars — one settled market is one bet here. */
  n: number;
  w: number; l: number; push: number;
  /** revenue − cost, in dollars. Fees are NOT in it (they are itemised). */
  net: number;
  revenue: number; cost: number; fees: number;
};

export type SettlementRecord = {
  /** The headline: every settled market that joins a game on this board. */
  slate: RecordLine;
  /** One line per bet type PRESENT, in taxonomy order. */
  byType: RecordLine[];
  /** Settled markets dropped because they join no displayed game (other
   *  weeks). Never folded into the record — said out loud in the popover. */
  offSlate: number;
};

/** Half a cent: below it a net is not a direction, so it is a PUSH. Same
 *  threshold `signedUsd` uses to drop a sign in MyBook. */
const PUSH_EPS = 0.005;

const emptyLine = (key: string, label: string): RecordLine => ({
  key, label, n: 0, w: 0, l: 0, push: 0, net: 0, revenue: 0, cost: 0, fees: 0,
});

function addTo(line: RecordLine, s: PortalSettlement): void {
  const net = s.revenue - s.cost;
  line.n++;
  line.net += net;
  line.revenue += s.revenue;
  line.cost += s.cost;
  line.fees += s.fees;
  if (net > PUSH_EPS) line.w++;
  else if (net < -PUSH_EPS) line.l++;
  else line.push++;
}

/**
 * The owner's REAL settled results, scoped to the games on this board.
 *
 * Two rules the display depends on:
 *
 *  1. THE JOIN is the one everything else uses — the event code embedded in the
 *     ticker, through `buildCodeToSlug(kalshiBySlug)`. A settlement that joins
 *     no displayed game is another week's and is EXCLUDED from the record
 *     rather than quietly inflating it; the count of those is returned so the
 *     popover can say so.
 *  2. THE GRADE IS THE MONEY. Win/loss/push is the sign of revenue − cost, and
 *     nothing else. `market_result` is "yes" | "no" | "scalar", and a scalar
 *     settlement (a spread that graded at an intermediate value — seen live,
 *     LAF10 paying 20c a contract) has no yes/no reading at all. Grading on the
 *     money is the only rule that is correct for all three, and it is also the
 *     only one that is right when the held side is the NO.
 */
export function computeSettlementRecord(
  settlements: PortalSettlement[] | null,
  kalshiBySlug: Map<string, KalshiGame>,
): SettlementRecord {
  const codeToSlug = buildCodeToSlug(kalshiBySlug);
  const slate = emptyLine("slate", "Slate");
  const byKey = new Map<BetTypeKey, RecordLine>();
  let offSlate = 0;

  for (const s of settlements || []) {
    const t = parseNcaafTicker(s.ticker);
    // Fall back to the event ticker's own code: same code, different carrier,
    // and it costs nothing to try before dropping a real settled bet.
    const code = t?.code ?? portalGameCode(s.event_ticker);
    const slug = code ? codeToSlug.get(code) : undefined;
    if (!slug) { offSlate++; continue; }
    addTo(slate, s);
    const key = betTypeOf(s.ticker);
    let line = byKey.get(key);
    if (!line) { line = emptyLine(key, BET_TYPE_LABEL[key]); byKey.set(key, line); }
    addTo(line, s);
  }

  const byType = BET_TYPE_ORDER
    .map((k) => byKey.get(k))
    .filter((l): l is RecordLine => Boolean(l));
  return { slate, byType, offSlate };
}

export type PortalState = {
  payload: PortalPayload | null;
  /** Settled NCAAF markets, newest first. Null until the first settlements
   *  read lands (or if that read fails — a settlements outage must never take
   *  the live book down with it, so it is tracked separately). */
  settlements: PortalSettlement[] | null;
  /** "idle" = no password stored; "error" covers network/500;
   *  "unauthorized" = wrong password (offer re-login); "locked" = too many
   *  failed attempts, server cooling down; "unconfigured" = server has no
   *  CFB_PORTAL_PASSWORD env yet. */
  status: "idle" | "loading" | "ok" | "unauthorized" | "locked" | "unconfigured" | "error";
};

/**
 * Poll the portal while a token is present. The effect depends only on the
 * token string (render-loop rule 1: primitives only in deps).
 */
export function usePortalBook(token: string): PortalState {
  const [state, setState] = useState<PortalState>({
    payload: null, settlements: null, status: token ? "loading" : "idle",
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ payload: null, settlements: null, status: "idle" });
      return;
    }
    let alive = true;
    const ac = new AbortController();

    const pull = async () => {
      try {
        const r = await fetch("/api/portfolio/cfb", {
          headers: { "x-cfb-token": token },
          cache: "no-store",
          signal: ac.signal,
        });
        if (!alive) return;
        if (r.status === 401) { setState({ payload: null, settlements: null, status: "unauthorized" }); return; }
        if (r.status === 429) { setState((s) => ({ ...s, status: "locked" })); return; }
        if (r.status === 503) { setState({ payload: null, settlements: null, status: "unconfigured" }); return; }
        if (!r.ok) { setState((s) => ({ ...s, status: "error" })); return; }
        const payload = (await r.json()) as PortalPayload;
        if (alive) setState((s) => ({ ...s, payload, status: "ok" }));
      } catch (err: any) {
        if (alive && err?.name !== "AbortError") {
          setState((s) => ({ ...s, status: "error" }));
        }
        return;
      }
      // The SETTLED half, on the same tick — no second timer. It is fetched
      // after the live book, never instead of it: a settlements failure leaves
      // the book "ok" and simply keeps the last record (the block just does
      // not update), because a realised record going stale must not look like
      // the live portal going down.
      try {
        const rs = await fetch("/api/portfolio/cfb/settlements", {
          headers: { "x-cfb-token": token },
          cache: "no-store",
          signal: ac.signal,
        });
        if (!alive || !rs.ok) return;
        const body = await rs.json();
        const rows = Array.isArray(body?.settlements) ? (body.settlements as PortalSettlement[]) : [];
        if (alive) setState((s) => ({ ...s, settlements: rows }));
      } catch {
        /* keep whatever record we already had */
      }
    };

    setState((s) => ({ ...s, status: "loading" }));
    pull();
    timer.current = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      ac.abort();
      if (timer.current) clearInterval(timer.current);
    };
  }, [token]);

  return state;
}
