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
  feeType: string;
  /** Outside the [TAIL_LO, TAIL_HI] band on the sim, the ask, or both. Never
   *  ranked among the defaults; shown muted behind the "show tails" toggle. */
  tail: boolean;
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
  simP: number, bid: number | null, ask: number | null, fp: FeeParams | undefined
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
  /** See `Suggestion.rungText`. */
  rungText?: string;
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
type Priced = Candidate & { mode: "REST" | "TAKE"; price: number; edgePer: number };

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
        rungText: p.rungText,
        mode: p.mode, side: p.side ?? "yes", series: p.series,
        simP: p.simP, price: p.price,
        fee, edge: p.edgePer, count,
        outlay: round2(p.price * count + fee),
        feeType: fp?.fee_type ?? "unknown (assumed maker-charging)",
        tail,
      });
    }
  }
  rows.sort((a, b) => b.edge - a.edge);
  return rows;
}

export function buildSuggestions(
  candidates: Candidate[],
  feeParams: Record<string, FeeParams>,
  heldTickers: Set<string>,
  /** Dollars of risk per ladder — the user's unit size. */
  unit: number = LADDER_RISK
): BuildResult {
  const suppressed: Suppressed[] = [];
  const priced: Priced[] = [];

  for (const c of candidates) {
    // The account already has exposure here: the pipeline treats a held or
    // resting rung as consuming its ladder slot, so the card must not
    // re-suggest it.
    if (c.ticker && heldTickers.has(c.ticker)) {
      suppressed.push({ label: c.label, reason: "already held or resting", ticker: c.ticker });
      continue;
    }
    const r = priceOne(c.simP, c.bid, c.ask, feeParams[c.series]);
    if ("reason" in r) {
      suppressed.push({ label: c.label, reason: r.reason, ticker: c.ticker });
      continue;
    }
    priced.push({ ...c, ...r });
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

  const rows = selectLadders(bestPerMarket(core), feeParams, unit, false, suppressed);

  // A market that already produced an in-band bet must NOT also appear as a
  // tail: buying both contracts of one market is a self-hedge that pays two
  // fees. The reveal is only for markets that exist as a tail and nothing else.
  const betOn = new Set(rows.map((r) => r.ticker).filter(Boolean));
  const tailOnly = tails.filter((p) => !p.ticker || !betOn.has(p.ticker));
  const tailTickers = new Set(tailOnly.map((p) => p.ticker).filter(Boolean));
  const tailRows = selectLadders(
    bestPerMarket(tailOnly), feeParams, unit, true, null);

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
  return { rows, tailRows, tailMarkets: tailTickers.size, suppressed: perMarket };
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
      series: "KXNCAAFGAME", strike: 0, statText: "",
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
      series: "KXNCAAFSPREAD", strike: r.line, statText: "",
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
      series: "KXNCAAFTOTAL", strike: r.line, team: "", statText: "",
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
  /** Dollars of the $LADDER_RISK stake allotted per rung in this ladder. */
  each: number;
  /** Every rung is outside the tail band (the two sets never mix — they are
   *  selected in separate passes). Drives the muting and the TAIL badge. */
  tail: boolean;
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
      tail: rungs.every((r) => r.tail),
    });
  }
  groups.sort((a, b) => b.bestEdge - a.bestEdge);
  return groups;
}
