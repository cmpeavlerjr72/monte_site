// src/lib/bookTree.ts
//
// THE SETTLED TREE — the owner's own book, cut the way he grades the sim.
//
// The cuts are NOT invented here. They are the FIXED cells of the sim repo's
// `scripts/regime_scorecard.py` (owner rule 2026-09-08: "every run gets FIXED
// regime cuts ... never grade an engine through a betting rulebook"), applied
// to the account's realised money instead of a backtest:
//
//   A side          TOTAL over/under; SPREAD fav/dog and home/away;
//                   TEAMTOTAL fav-over/fav-under/dog-over/dog-under;
//                   ML fav/dog
//   B spread band   pk-3 / 3-7 / 7-14 / 14-24 / 24+      x family
//   C fav venue     home-favoured / away-favoured        x family
//   D total tercile low / mid / high, cut on the bets' own opens x over/under
//   E tier          P4 v P4 / P4 v G5 / G5 v G5 / FCS    x family
//   F phase         entry timing: 3-5d / 1-3d / same day / in-play x family
//   (plus a flat by-WEEK list off the root)
//
// FOUR RULES this file will not bend:
//
//  1. EVERY NODE SUMS TO ITS PARENT. A cut that cannot place a bet gets an
//     explicit bucket ("no line", "unknown") rather than dropping it, and
//     `checkTree` warns to the console if any group's parts miss the whole.
//     There is no test runner here, so the invariant is checked at runtime.
//  2. n < 10 IS UNDERPOWERED, marked, never hidden. Same rule the scorecard
//     uses (at its own n < 30), and the same reason: an absent cell reads as
//     "no signal" when it is really "no sample".
//  3. THE MONEY IS FEE-INCLUSIVE. net = revenue − cost − fees, and
//     ROI = net ÷ cost, so a row's own two numbers divide into each other
//     (standing rule 2026-08-28). The pre-fee figure — Kalshi's own, what the
//     owner's ledger reconciles to — is stated in the node's words.
//  4. THE GRADE IS THE MONEY, W/L/push from the sign of revenue − cost, never
//     `market_result` (which is "scalar" on a spread that settled in between).
//     Fees do not turn a won bet into a lost one, so the HIT RATE is graded
//     pre-fee while the dollars and the rate are not.
//
// The individual bets are deliberately NOT in the tree — they are the
// selection's own list (the "Show bets" sheet). A tree that inlines its leaves
// is a statement, not a cut.

import { gameClassFor, type GameClass } from "./edgeRules";
import {
  codeDateMs, matchupOfEventTitle, parseNcaafTicker, portalGameCode,
  type PortalSettlement,
} from "./kalshiPortal";
import { pairKeyOf } from "../../server/cfbNames";
import type { Season } from "./cfbData";

/* ------------------------------------------------------------- the game --- */

/** One published game, everything a cut needs to place a bet on it. */
export type BookGame = {
  slug: string;
  ns: Season;
  weekId: string;
  week: number;
  /** teamA = HOME, teamB = AWAY — the dataset's convention everywhere. */
  home: string;
  away: string;
  kickoffMs: number | null;
  /** summary.odds.spread_open, HOME perspective (negative = home favoured). */
  openSpread: number | null;
  openTotal: number | null;
  division: "fbs" | "fcs";
};

/** ±4 days between the ticker's date code and the card's kickoff. Same guard
 *  `computeSettlementRecord` uses: CFB pairs meet once a season, so this is a
 *  check against a stale index, not against a rematch. */
const DATE_GUARD_MS = 4 * 86_400_000;

/**
 * The settled market's game, by the server-attached event TITLE.
 *
 * The code join every live surface uses needs the Kalshi feed, and a settled
 * event has left it (status=open) — so on a page whose whole subject is
 * SETTLED bets the title join is the primary one, not the fallback. A
 * settlement with no title, or one whose matchup is on no published week,
 * returns null and lands under its family alone, marked "no line".
 */
export function matchGame(
  s: PortalSettlement,
  byPair: Map<string, BookGame>,
): BookGame | null {
  const m = matchupOfEventTitle(s.event_title);
  if (!m) return null;
  const hit = byPair.get(pairKeyOf(m[0], m[1]));
  if (!hit) return null;
  const code = parseNcaafTicker(s.ticker)?.code ?? portalGameCode(s.event_ticker);
  const cd = codeDateMs(code);
  if (cd !== null && hit.kickoffMs !== null && Math.abs(cd - hit.kickoffMs) > DATE_GUARD_MS) {
    return null;
  }
  return hit;
}

/* ------------------------------------------------------------- the bet ---- */

export type BetResult = "won" | "lost" | "push";

/** Half a cent: below it a net is not a direction. */
const PUSH_EPS = 0.005;

/** ONE settled market, joined and classified — what the sheet lists and what
 *  every cut reads. */
export type SettledBet = {
  key: string;
  ticker: string;
  /** The side that was HELD. Both sides in one market is possible (that is how
   *  a position is closed); the words name the larger holding, and the money
   *  is unaffected either way because `cost` already sums both. */
  side: "yes" | "no";
  /** Ticker family segment: SPREAD / TOTAL / TEAMTOTAL / GAME / TEAMRECYDS … */
  fam: string;
  /** revenue − cost − fees. FEE-INCLUSIVE, and the numerator of the ROI. */
  net: number;
  /** revenue − cost. Kalshi's own figure; what the W/L grade reads. */
  netPreFee: number;
  cost: number;
  fees: number;
  revenue: number;
  /** Contracts held, and what one cost on average — the sheet's price cell. */
  count: number;
  avgPrice: number | null;
  result: BetResult;
  settledMs: number | null;
  settledTime: string;
  /** When the order went in, from app_orders (this app's own bets) — null
   *  when the bet was not placed through the app or the row is gone. */
  placedMs: number | null;
  game: BookGame | null;
  /** Placed through this app; null = the server could not attribute. */
  app: boolean | null;
};

/** Build the classified bet list. Pure: the join map and the placed times are
 *  handed in (see src/lib/bookGames.ts for the loads). */
export function settledBets(
  settlements: PortalSettlement[] | null,
  byPair: Map<string, BookGame>,
  placedMsByTicker: Map<string, number>,
): SettledBet[] {
  const out: SettledBet[] = [];
  for (const s of settlements ?? []) {
    const netPreFee = s.revenue - s.cost;
    const count = (s.yes_count ?? 0) + (s.no_count ?? 0);
    const settledMs = Date.parse(s.settled_time);
    out.push({
      key: `${s.ticker}|${s.settled_time}`,
      ticker: s.ticker,
      side: s.no_count > s.yes_count ? "no" : "yes",
      fam: parseNcaafTicker(s.ticker)?.fam ?? "",
      net: netPreFee - s.fees,
      netPreFee,
      cost: s.cost,
      fees: s.fees,
      revenue: s.revenue,
      count,
      avgPrice: count > 0 && s.cost > 0 ? s.cost / count : null,
      result: netPreFee > PUSH_EPS ? "won" : netPreFee < -PUSH_EPS ? "lost" : "push",
      settledMs: Number.isFinite(settledMs) ? settledMs : null,
      settledTime: s.settled_time,
      placedMs: placedMsByTicker.get(s.ticker) ?? null,
      game: matchGame(s, byPair),
      app: s.app === true ? true : s.app === false ? false : null,
    });
  }
  // Newest first everywhere below — a settled list reads like a statement.
  out.sort((a, b) => (b.settledMs ?? 0) - (a.settledMs ?? 0));
  return out;
}

/* ------------------------------------------------------- the vocabulary --- */

/** Display words for the per-team stat families. Same wording the bet slip
 *  uses (`STAT_WORDS` in kalshiPortal) — two names for one market is how a
 *  reader stops trusting either screen. */
const FAMILY_LABEL: Record<string, string> = {
  SPREAD: "Spread",
  TOTAL: "Total",
  TEAMTOTAL: "Team total",
  GAME: "Moneyline",
  TEAMRECYDS: "Team rec yds",
  TEAMRSHYDS: "Team rush yds",
  TEAMYDS: "Team total yds",
  TEAMREC: "Team receptions",
  TEAMRSHATT: "Team rush att",
  TEAMRSHTD: "Team rush TDs",
  TEAMRECTD: "Team rec TDs",
  TEAMSACK: "Team sacks",
  TEAMINT: "Team INTs",
  TEAMTD: "Team TDs",
  TEAMFG: "Team FGs",
  TEAMTO: "Team turnovers",
  "1HSPREAD": "1H spread",
  "2HSPREAD": "2H spread",
  "1HTOTAL": "1H total",
  "2HTOTAL": "2H total",
  "1H": "1H winner",
  "2H": "2H winner",
};

/** Full-game families first (owner 2026-09-08: full-game markets are the ones
 *  that get attention; halves are display-only), then the stat ladders, then
 *  whatever Kalshi lists next. */
const FAMILY_ORDER = [
  "SPREAD", "TOTAL", "TEAMTOTAL", "GAME",
  "TEAMRECYDS", "TEAMRSHYDS", "TEAMYDS", "TEAMREC", "TEAMRSHATT",
  "TEAMRSHTD", "TEAMRECTD", "TEAMSACK", "TEAMINT", "TEAMTD", "TEAMFG", "TEAMTO",
];

export const familyLabel = (fam: string): string =>
  FAMILY_LABEL[fam] ?? (fam ? fam : "Other");

/* ------------------------------------------------------------- regime ----- */

/** |open spread| band — the scorecard's cut B. */
export function spreadBand(openSpread: number | null): { key: string; label: string } | null {
  if (openSpread === null) return null;
  const s = Math.abs(openSpread);
  if (s < 3) return { key: "b0", label: "pk–3" };
  if (s < 7) return { key: "b1", label: "3–7" };
  if (s < 14) return { key: "b2", label: "7–14" };
  if (s < 24) return { key: "b3", label: "14–24" };
  return { key: "b4", label: "24+" };
}

/** Which side of the field the FAVOURITE is on — cut C. Mirrors the Python's
 *  `open_spread < 0` reading, pick'em included (0 is not < 0). */
export function favVenue(openSpread: number | null): { key: string; label: string } | null {
  if (openSpread === null) return null;
  return openSpread < 0
    ? { key: "homefav", label: "Home favoured" }
    : { key: "awayfav", label: "Away favoured" };
}

/** Conference class, folded to the scorecard's four tiers — cut E. */
export function tierOf(g: BookGame | null): { key: string; label: string } | null {
  if (!g) return null;
  if (g.division === "fcs") return { key: "fcs", label: "FCS" };
  const c: GameClass | null = gameClassFor(g.home, g.away);
  if (c === null) return null;
  if (c === "P4 v P4") return { key: "p4p4", label: "P4 v P4" };
  if (c === "G5 v G5") return { key: "g5g5", label: "G5 v G5" };
  return { key: "p4g5", label: "P4 v G5" };
}

/** Total terciles are cut on THE BETS' OWN GAMES (the scorecard cuts on the
 *  frame's own opens, never on a fixed number), one game one vote. */
export function totalTercileCuts(bets: SettledBet[]): [number, number] | null {
  const byGame = new Map<string, number>();
  for (const b of bets) {
    const t = b.game?.openTotal;
    if (b.game && typeof t === "number") byGame.set(`${b.game.ns}/${b.game.slug}`, t);
  }
  const xs = [...byGame.values()].sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(q * xs.length)))];
  const lo = at(1 / 3);
  const hi = at(2 / 3);
  return lo < hi ? [lo, hi] : null;
}

/** Entry timing — the 2026 frame's phase cut, from the order's own placed
 *  time against kickoff. */
export function timingBucket(
  placedMs: number | null,
  kickoffMs: number | null,
): { key: string; label: string } | null {
  if (placedMs === null || kickoffMs === null) return null;
  const h = (kickoffMs - placedMs) / 3_600_000;
  if (h < 0) return { key: "t_live", label: "In-play" };
  if (h < 24) return { key: "t_day", label: "Same day" };
  if (h < 72) return { key: "t_1_3", label: "1–3 days out" };
  if (h < 120) return { key: "t_3_5", label: "3–5 days out" };
  return { key: "t_5p", label: "5+ days out" };
}

/* --------------------------------------------------------------- sides ---- */

/** True when the bet BACKS THE HOME TEAM; null where the family has no side.
 *  The event code's team blob is away+home concatenated, so `strikeIsHome`
 *  already knows which end the strike names — no name join needed. */
export function backsHome(b: SettledBet): boolean | null {
  const t = parseNcaafTicker(b.ticker);
  if (!t || !t.strikeTeam) return null;
  if (b.fam !== "SPREAD" && b.fam !== "GAME") return null;
  // YES backs the strike team; NO is the complement bet on the other one.
  return b.side === "yes" ? t.strikeIsHome : !t.strikeIsHome;
}

/** True when the market's STRIKE TEAM is the home team (team totals and the
 *  per-team stat ladders: a NO is "stays under", not the other team). */
function strikeIsHome(b: SettledBet): boolean | null {
  const t = parseNcaafTicker(b.ticker);
  return t && t.strikeTeam ? t.strikeIsHome : null;
}

const favOf = (isHome: boolean | null, openSpread: number | null): boolean | null =>
  isHome === null || openSpread === null ? null : isHome === (openSpread < 0);

/* ---------------------------------------------------------- the numbers --- */

export type NodeStats = {
  n: number;
  w: number; l: number; push: number;
  net: number; netPreFee: number; cost: number; fees: number; revenue: number;
  /** net ÷ cost, fee-inclusive. Null when nothing was staked. */
  roi: number | null;
  /** wins ÷ decided (pushes are not a miss). Null when nothing decided. */
  hit: number | null;
};

export function statsOf(bets: SettledBet[]): NodeStats {
  const s: NodeStats = {
    n: 0, w: 0, l: 0, push: 0, net: 0, netPreFee: 0, cost: 0, fees: 0,
    revenue: 0, roi: null, hit: null,
  };
  for (const b of bets) {
    s.n++;
    s.net += b.net; s.netPreFee += b.netPreFee;
    s.cost += b.cost; s.fees += b.fees; s.revenue += b.revenue;
    if (b.result === "won") s.w++;
    else if (b.result === "lost") s.l++;
    else s.push++;
  }
  s.roi = s.cost > 0.005 ? s.net / s.cost : null;
  s.hit = s.w + s.l > 0 ? s.w / (s.w + s.l) : null;
  return s;
}

/* ----------------------------------------------------------- the cuts ----- */

/** Where one bet lands under one cut. Null = the cut cannot place it, and it
 *  goes to the cut's own explicit "unknown" bucket rather than vanishing. */
type Bucket = { key: string; label: string; words: string };

type Cut = {
  key: string;
  label: string;
  /** The cut's own sentence — what this level is asking. */
  words: string;
  /** Bucket for a bet, or null. */
  of: (b: SettledBet) => Bucket | null;
  /** Sort weight for a bucket key (lower first); unlisted keys sort last by
   *  label, so a family Kalshi adds tomorrow still renders in a stable place. */
  order: string[];
  /** What the "cannot place it" bucket is called here. */
  unknown: string;
  unknownWords: string;
};

const CUT_UNDER_10 =
  "Under 10 settled bets is a sample, not a result — the cell is shown because "
  + "hiding it would read as no signal when it is really no sample.";

const bandWords =
  "The sportsbook's OPEN spread on the game, in bands. The open is the "
  + "benchmark the whole book is graded at (bets go in Mon-Wed), and this is "
  + "the cut that separated week 1 more sharply than any measure of edge did.";
const venueWords =
  "Which side of the field the favourite was on, by the open line "
  + "(negative = home favoured). Bodybag road favourites and home favourites "
  + "are different bets even at the same number.";
const tierWords =
  "Conference class of the matchup, from the FBS conference table — P4 v P4, "
  + "P4 v G5, G5 v G5, or an FCS game (no book line, its own board).";
const tercileWords =
  "The game's OPEN total, cut into thirds ACROSS THE GAMES IN THIS BOOK — not "
  + "a fixed number. High- and low-total games are different environments and "
  + "an over is not the same bet in both.";
const timingWords =
  "When the order went in, against kickoff. Only bets placed through this app "
  + "carry a placed time; anything hand-placed or from the maker pipeline "
  + "lands in “unknown”.";

function cutBand(): Cut {
  return {
    key: "band", label: "By open spread", words: bandWords,
    of: (b) => {
      const v = spreadBand(b.game?.openSpread ?? null);
      return v ? { ...v, words: `Games whose open spread was ${v.label} points.` } : null;
    },
    order: ["b0", "b1", "b2", "b3", "b4"],
    unknown: "No line",
    unknownWords: "No published open spread for these games — an unjoined "
      + "settlement, or an FCS board no book prices.",
  };
}

function cutVenue(): Cut {
  return {
    key: "venue", label: "By favourite's venue", words: venueWords,
    of: (b) => {
      const v = favVenue(b.game?.openSpread ?? null);
      return v ? { ...v, words: `The open line made the ${v.key === "homefav" ? "home" : "away"} team the favourite.` } : null;
    },
    order: ["homefav", "awayfav"],
    unknown: "No line",
    unknownWords: "No published open spread, so neither team can be called the favourite.",
  };
}

function cutTier(): Cut {
  return {
    key: "tier", label: "By tier", words: tierWords,
    of: (b) => {
      const v = tierOf(b.game ?? null);
      return v ? { ...v, words: `${v.label} matchups.` } : null;
    },
    order: ["p4p4", "p4g5", "g5g5", "fcs"],
    unknown: "Unknown tier",
    unknownWords: "One or both schools are not in the FBS conference table and "
      + "the game is not on the FCS board — never guessed at.",
  };
}

function cutTercile(cuts: [number, number] | null): Cut {
  return {
    key: "tercile", label: "By total tercile", words: tercileWords,
    of: (b) => {
      const t = b.game?.openTotal;
      if (!cuts || typeof t !== "number") return null;
      if (t <= cuts[0]) return { key: "lo", label: `Low totals (≤ ${cuts[0]})`, words: `Games whose open total was ${cuts[0]} or less.` };
      if (t <= cuts[1]) return { key: "mid", label: `Mid totals (${cuts[0]}–${cuts[1]})`, words: `Games whose open total sat between ${cuts[0]} and ${cuts[1]}.` };
      return { key: "hi", label: `High totals (> ${cuts[1]})`, words: `Games whose open total was above ${cuts[1]}.` };
    },
    order: ["lo", "mid", "hi"],
    unknown: "No total",
    unknownWords: cuts
      ? "No published open total for these games."
      : "Fewer than three joined games with an open total — there is nothing to cut into thirds.",
  };
}

function cutTiming(): Cut {
  return {
    key: "timing", label: "By entry timing", words: timingWords,
    of: (b) => {
      const v = timingBucket(b.placedMs, b.game?.kickoffMs ?? null);
      return v ? { ...v, words: `Orders placed ${v.label.toLowerCase()}.` } : null;
    },
    order: ["t_5p", "t_3_5", "t_1_3", "t_day", "t_live"],
    unknown: "Unknown timing",
    unknownWords: "No placed time for these — placed by hand on Kalshi or by "
      + "the maker pipeline, so this app never logged an order row.",
  };
}

/** The SIDE cut, which is the one thing that differs per family. */
function cutSide(fam: string): Cut {
  const base = { key: "side", label: "By side", order: [] as string[] };
  if (fam === "TOTAL") {
    return {
      ...base,
      words: "Over or under, on the full-game total.",
      of: (b) => (b.side === "yes"
        ? { key: "over", label: "Over", words: "Bets on the game going OVER the strike." }
        : { key: "under", label: "Under", words: "Bets on the game staying UNDER the strike." }),
      order: ["over", "under"],
      unknown: "Unknown side",
      unknownWords: "The ticker does not parse into a side.",
    };
  }
  if (fam === "SPREAD" || fam === "GAME") {
    return {
      ...base,
      words: fam === "SPREAD"
        ? "Backing the favourite or the dog by the OPEN line, and backing the home or the away team. Two readings of the same bets; each one adds to the family total."
        : "Backing the favourite or the dog by the OPEN line.",
      of: (b) => {
        const f = favOf(backsHome(b), b.game?.openSpread ?? null);
        if (f === null) return null;
        return f
          ? { key: "fav", label: "Favourite", words: "Bets backing the side the open line made the favourite." }
          : { key: "dog", label: "Dog", words: "Bets backing the side the open line made the underdog." };
      },
      order: ["fav", "dog"],
      unknown: "No line",
      unknownWords: "No open spread, so neither side can be called the favourite.",
    };
  }
  if (fam === "TEAMTOTAL") {
    return {
      ...base,
      words: "The four corners of a team total: whose points, and which way.",
      of: (b) => {
        const f = favOf(strikeIsHome(b), b.game?.openSpread ?? null);
        if (f === null) return null;
        const over = b.side === "yes";
        const key = `${f ? "fav" : "dog"}-${over ? "over" : "under"}`;
        const label = `${f ? "Favourite" : "Dog"} ${over ? "over" : "under"}`;
        return { key, label, words: `${label}: the ${f ? "favourite" : "underdog"}'s own points, ${over ? "over" : "under"} the strike.` };
      },
      order: ["fav-over", "fav-under", "dog-over", "dog-under"],
      unknown: "No line",
      unknownWords: "No open spread, so the team cannot be called the favourite or the dog.",
    };
  }
  if (fam.startsWith("TEAM")) {
    return {
      ...base,
      words: "A stat ladder is a threshold: the YES clears it, the NO stays under it.",
      of: (b) => (b.side === "yes"
        ? { key: "over", label: "Clears the number", words: "Bets that the team gets to the strike." }
        : { key: "under", label: "Stays under", words: "Bets that the team stays under the strike." }),
      order: ["over", "under"],
      unknown: "Unknown side",
      unknownWords: "The ticker does not parse into a side.",
    };
  }
  // A family this page has no side READING for — halves, quarters, overtime,
  // first-to-score. The held side is still a fact, so it is reported as the
  // raw side rather than dressed up as an over/under it is not.
  return {
    ...base,
    words: "This family has no fav/dog or over/under reading here, so the cut "
      + "is the raw side that was held — the market's YES, or its NO.",
    of: (b) => (b.side === "yes"
      ? { key: "yes", label: "Held the YES", words: "Bets holding the market's own YES side." }
      : { key: "no", label: "Held the NO", words: "Bets holding the market's own NO side." }),
    order: ["yes", "no"],
    unknown: "Unknown side",
    unknownWords: "The ticker does not parse into a side.",
  };
}

/** The SECOND spread reading — home/away — kept as its own group so the
 *  fav/dog group still sums to the family exactly (rule 1). */
function cutVenueSide(): Cut {
  return {
    key: "side2", label: "By home / away", words:
      "The same spread bets read the other way: which end of the field they backed.",
    of: (b) => {
      const h = backsHome(b);
      if (h === null) return null;
      return h
        ? { key: "home", label: "Backed home", words: "Bets on the home team's side of the line." }
        : { key: "away", label: "Backed away", words: "Bets on the away team's side of the line." };
    },
    order: ["home", "away"],
    unknown: "Unknown side",
    unknownWords: "The ticker names no team, so it backs neither end.",
  };
}

/* ----------------------------------------------------------- the tree ----- */

export type TreeNode = {
  key: string;
  label: string;
  /** The node's own sentence — verdict first, then why this cell exists. */
  words: string;
  depth: number;
  stats: NodeStats;
  bets: SettledBet[];
  groups: TreeGroup[];
  /** n < 10: shown, muted, and said out loud. */
  underpowered: boolean;
};

export type TreeGroup = {
  key: string;
  label: string;
  words: string;
  nodes: TreeNode[];
};

export const UNDERPOWERED_N = 10;

function makeNode(
  key: string, label: string, words: string, depth: number, bets: SettledBet[],
  groups: (node: { key: string; bets: SettledBet[]; depth: number }) => TreeGroup[],
): TreeNode {
  const stats = statsOf(bets);
  return {
    key, label, words, depth, stats, bets,
    groups: groups({ key, bets, depth }),
    underpowered: stats.n > 0 && stats.n < UNDERPOWERED_N,
  };
}

/** Apply one cut to a bet list, newest-first inside every bucket. */
function applyCut(
  cut: Cut, parentKey: string, bets: SettledBet[], depth: number,
  groups: (n: { key: string; bets: SettledBet[]; depth: number }) => TreeGroup[],
): TreeGroup | null {
  const buckets = new Map<string, { label: string; words: string; bets: SettledBet[] }>();
  const unknown: SettledBet[] = [];
  for (const b of bets) {
    const v = cut.of(b);
    if (!v) { unknown.push(b); continue; }
    const cur = buckets.get(v.key);
    if (cur) cur.bets.push(b);
    else buckets.set(v.key, { label: v.label, words: v.words, bets: [b] });
  }
  if (!buckets.size) return null;                    // nothing this cut can say
  const rank = (k: string) => {
    const i = cut.order.indexOf(k);
    return i < 0 ? cut.order.length : i;
  };
  const nodes = [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].label.localeCompare(b[1].label))
    .map(([k, v]) => makeNode(
      `${parentKey}/${cut.key}:${k}`, v.label, v.words, depth, v.bets, groups,
    ));
  if (unknown.length) {
    nodes.push(makeNode(
      `${parentKey}/${cut.key}:unknown`, cut.unknown, cut.unknownWords,
      depth, unknown, groups,
    ));
  }
  return { key: `${parentKey}/${cut.key}`, label: cut.label, words: cut.words, nodes };
}

/**
 * THE TREE.
 *
 * Root = every settled bet. Level 1 = family. Level 2 = the side cut for that
 * family. Levels 3+ = the regime cuts, hung off BOTH the family node (the
 * scorecard's "x family") and each side node (its "x over/under"), so the
 * question "which spread band did my dog bets lose in" is one path, not a
 * mental join. Below that, leaves: a fourth level of cutting on this many
 * bets is noise with a label on it.
 */
export function buildBookTree(bets: SettledBet[]): TreeNode {
  const cuts = totalTercileCuts(bets);
  const regime = (): Cut[] => [cutBand(), cutVenue(), cutTercile(cuts), cutTier(), cutTiming()];

  const leafGroups = () => [] as TreeGroup[];

  // Level 3 nodes are leaves; level 2 (side) carries the regime cuts.
  const sideGroups = (n: { key: string; bets: SettledBet[]; depth: number }): TreeGroup[] =>
    regime()
      .map((c) => applyCut(c, n.key, n.bets, n.depth + 1, leafGroups))
      .filter((g): g is TreeGroup => g !== null);

  const familyGroups = (n: { key: string; bets: SettledBet[]; depth: number }): TreeGroup[] => {
    const fam = n.bets[0]?.fam ?? "";
    const out: TreeGroup[] = [];
    const side = applyCut(cutSide(fam), n.key, n.bets, n.depth + 1, sideGroups);
    if (side) out.push(side);
    if (fam === "SPREAD") {
      const alt = applyCut(cutVenueSide(), n.key, n.bets, n.depth + 1, sideGroups);
      if (alt) out.push(alt);
    }
    for (const c of regime()) {
      const g = applyCut(c, n.key, n.bets, n.depth + 1, leafGroups);
      if (g) out.push(g);
    }
    return out;
  };

  // ---- level 1: family ----
  const byFam = new Map<string, SettledBet[]>();
  for (const b of bets) {
    const k = FAMILY_LABEL[b.fam] ? b.fam : "OTHER";
    (byFam.get(k) ?? byFam.set(k, []).get(k)!).push(b);
  }
  const famRank = (k: string) => {
    const i = FAMILY_ORDER.indexOf(k);
    return i < 0 ? FAMILY_ORDER.length : i;
  };
  const famNodes = [...byFam.entries()]
    .sort((a, b) => famRank(a[0]) - famRank(b[0]) || familyLabel(a[0]).localeCompare(familyLabel(b[0])))
    .map(([fam, list]) => makeNode(
      `root/fam:${fam}`, familyLabel(fam),
      fam === "OTHER"
        ? "Families this page has no wording for yet — halves, periods, anything Kalshi listed since. Counted, never guessed at."
        : `Every settled ${familyLabel(fam).toLowerCase()} market in the book.`,
      1, list, familyGroups,
    ));

  // ---- level 1 (second reading): season week, flat, newest first ----
  const byWeek = new Map<string, SettledBet[]>();
  for (const b of bets) {
    const k = b.game ? `${b.game.week}` : "unknown";
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(b);
  }
  const weekNodes = [...byWeek.entries()]
    .sort((a, b) => (a[0] === "unknown" ? 1 : b[0] === "unknown" ? -1 : Number(b[0]) - Number(a[0])))
    .map(([w, list]) => makeNode(
      `root/week:${w}`,
      w === "unknown" ? "Week unknown" : `Week ${w}`,
      w === "unknown"
        ? "Settlements that joined no published game, so they carry no week."
        : `Everything that settled on week ${w}'s slate.`,
      1, list, leafGroups,
    ));

  const groups: TreeGroup[] = [];
  if (famNodes.length) {
    groups.push({
      key: "root/fam", label: "By family",
      words: "What kind of market it was. Every deeper cut hangs off this one, "
        + "because a spread and a team total are not the same bet in the same regime.",
      nodes: famNodes,
    });
  }
  if (weekNodes.length) {
    groups.push({
      key: "root/week", label: "By week",
      words: "The season, newest first. A flat list on purpose: a week is a "
        + "date, not a regime, and cutting it further would just re-split the "
        + "cells above on a smaller sample.",
      nodes: weekNodes,
    });
  }

  const stats = statsOf(bets);
  return {
    key: "root",
    label: "All settled",
    words: "Every settled market on this Kalshi account. Money is fee-inclusive "
      + "(paid out, minus what the contracts cost, minus the fees charged at "
      + "fill) and ROI is that net over what was staked. Win, loss and push are "
      + "the settlement money itself, before fees — a fee does not turn a won "
      + "bet into a lost one.",
    depth: 0, stats, bets, groups,
    underpowered: stats.n > 0 && stats.n < UNDERPOWERED_N,
  };
}

/* -------------------------------------------------------- the self-check -- */

/**
 * RULE 1, ENFORCED AT RUNTIME. There is no test runner in this repo, so the
 * invariant that makes a tree readable — every group's parts add up to the
 * node above them — is asserted on the built tree and warned about in the
 * console. A silent tree that does not sum is worse than no tree.
 */
export function checkTree(root: TreeNode): string[] {
  const problems: string[] = [];
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const walk = (node: TreeNode) => {
    for (const g of node.groups) {
      const n = g.nodes.reduce((a, x) => a + x.stats.n, 0);
      const net = g.nodes.reduce((a, x) => a + x.stats.net, 0);
      const cost = g.nodes.reduce((a, x) => a + x.stats.cost, 0);
      if (n !== node.stats.n || !eq(net, node.stats.net) || !eq(cost, node.stats.cost)) {
        problems.push(
          `${g.key}: parts ${n} bets / ${net.toFixed(2)} net / ${cost.toFixed(2)} cost ` +
          `!= whole ${node.stats.n} / ${node.stats.net.toFixed(2)} / ${node.stats.cost.toFixed(2)}`,
        );
      }
      for (const child of g.nodes) walk(child);
    }
  };
  walk(root);
  if (problems.length) {
    console.warn("[bookTree] node totals do not sum to their parent:", problems);
  }
  return problems;
}

/* ------------------------------------------------------------- wording ---- */

export const underpoweredWords = CUT_UNDER_10;

/** A node's derivation, in words, one fact per line — the popover body and the
 *  row's accessible label. Verdict first (docs/AGENT_BRIEF house style). */
export function nodeLines(node: TreeNode, unit: number): string[] {
  const s = node.stats;
  const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  const signed = (v: number) => (Math.abs(v) < 0.005 ? "$0.00" : `${v > 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`);
  const out: string[] = [];
  out.push(
    s.roi === null
      ? `${node.label}: ${s.n} settled ${s.n === 1 ? "bet" : "bets"}, nothing staked to divide by.`
      : `${node.label}: ${signed(s.net)} on ${money(s.cost)} staked — ` +
        `${(s.roi * 100 >= 0 ? "+" : "−")}${Math.abs(s.roi * 100).toFixed(1)}%, fees included.`,
  );
  if (unit > 0) {
    out.push(`In units at your ${money(unit)} unit: ${(s.net / unit >= 0 ? "+" : "−")}${Math.abs(s.net / unit).toFixed(2)}u.`);
  }
  out.push(
    `${s.w} won, ${s.l} lost${s.push ? `, ${s.push} pushed` : ""}` +
    (s.hit === null ? "." : ` — ${(s.hit * 100).toFixed(0)}% of the decided ones.`),
  );
  out.push(
    s.fees > 0
      ? `Paid out ${money(s.revenue)} against ${money(s.cost)} of contracts, so ${signed(s.netPreFee)} before the ${money(s.fees)} of fees charged at fill.`
      : `Paid out ${money(s.revenue)} against ${money(s.cost)} of contracts. No fees on these.`,
  );
  out.push(node.words);
  if (node.underpowered) out.push(CUT_UNDER_10);
  return out;
}
