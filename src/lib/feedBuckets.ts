// src/lib/feedBuckets.ts
//
// THE FEED, GROUPED BY GAME — and the same grouping read back on a game card.
//
// ────────────────────────────────────────────────────────────────────────────
// ONE BUCKET IS ONE GAME (owner 2026-09-09)
//
// A timeline of individual bets answers "what happened next". Nobody watching
// football asks that. They ask "who is on this game", and the answer was
// scattered down a chronological list: mvpeav's total, roth's tail of it, a
// score update, mvpeav's second rung, all separated by three other games.
//
// So the unit of the feed is the GAME. A bucket carries every item on one
// matchup, ordered by the time of the LATEST thing that happened in it, so a
// new action on an old game pulls that game back to the top — which is what a
// feed is for.
//
// TWO THINGS A BUCKET SHOWS, and they are different questions:
//
//   1. THE LATEST ACTION, as its own full row. "What just happened."
//   2. THE POSITIONS: one line per (poster, position), where a position is a
//      contract — market + side — not an order. "Who is on this, at what."
//
// A POSITION IS THE UNIT, NOT A FILL. A ladder is placed as two rungs; a
// partial fill is chased at the next price; a re-offer is taken a cent higher.
// That is one bet in a bettor's head and three rows in a database, so a
// position folds them: total units, and the UNITS-WEIGHTED AVERAGE PRICE
// across them (owner: "when there are multiple at different prices show the
// average"). Weighting by units rather than by row is the only honest mean —
// two units at 40c and one at 70c is 50c, not 55c.
//
// ROWS WITH NO SIZE STILL COUNT. `units` is null on a row placed before the
// units column existed, or one whose unit size could not be read. Those rows
// are averaged with equal weight instead of being dropped, because dropping
// them would silently change the price a reader is shown; a position made
// entirely of them reports its units as null and prints no size at all.
//
// NOTHING HERE FETCHES, FILTERS BY VIEWER, OR KNOWS ABOUT MONEY. It reshapes
// rows that `feed_items` (a security_invoker view) already decided this viewer
// may see, and `feed_items` carries no cost, count or fill for anyone.

import type { FeedItem } from "./supabase";

/* ------------------------------- positions -------------------------------- */

/** One poster's whole position on one contract, folded from every row of it. */
export type FeedPosition = {
  /** Stable across a re-fetch: poster + contract. */
  key: string;
  user_id: string;
  handle: string;
  display_name: string;
  flares: string[] | null;
  /** The bet in a few characters — "Georgia Tech 20+", "Rutgers o23.5". */
  label: string;
  /** The contract, when these rows are exchange orders (a legacy hand-posted
   *  pick has neither, and cannot be tailed). */
  ticker: string | null;
  side: "yes" | "no" | null;
  /** The order id a TAIL of this position copies: the most recent one. */
  orderId: string | null;
  /** Units-weighted mean price in dollars, or null when no row carried one. */
  avgPrice: number | null;
  /** Total units across the position; null when no row carried a size. */
  units: number | null;
  /** How many rows this folds — "3 fills at different prices". */
  fills: number;
  /** Loaded rows that copied any order in this position. */
  tails: number;
  /** The most recent row's timestamp, epoch ms. */
  lastMs: number;
  /** Settled units net, summed over the rows that have settled; null while
   *  none has. `settledFills` says how much of the position that covers. */
  net: number | null;
  settledFills: number;
  /** HOW IT ENDED, folded from the rows that ended (null while none has).
   *  'sell' is a FLIP — sold before settlement, so it never won or lost the
   *  game — and a position earns that word only when EVERY row that closed is
   *  sell-closed. MIXED (some sold, some held to the whistle) reads as
   *  'settlement': the position did reach settlement, part of it settled
   *  there, and calling the whole thing a flip would be the same overclaim in
   *  the other direction. */
  closedBy: "settlement" | "sell" | null;
  /** The contract-weighted mean price the closed part LEFT at, in dollars.
   *  Null unless `closedBy` is 'sell' — a settlement has no exit price. */
  exitPrice: number | null;
  /** The sim's verdict on the NEWEST fill: EV per $1 after the fee, and P(yes).
   *  A position's opinion is its latest row's — the rows underneath are in
   *  `items` for a reader who wants every fill. */
  ev: number | null;
  simP: number | null;
  /** Every row folded into this position, newest first. */
  items: FeedItem[];
  /** Attribution the tail's own order carries forward (same game, same words). */
  sport: string | null;
  home_team: string | null;
  away_team: string | null;
  game_slug: string | null;
  season: number | null;
  week: number | null;
  title: string | null;
};

/** WHICH CONTRACT a row is about, as a key. For an app order `market` is the
 *  literal "order" and `side` is "<yes|no> <TICKER>", so the pair already
 *  names one contract exactly; a legacy pick falls back to its own market and
 *  side. Never the label: two posters wording the same bet differently must
 *  still land on one position. */
export const contractKey = (i: FeedItem): string => `${i.market}|${i.side}`;

/** The exchange side an order row bought, read off the view's composed
 *  `side` column ("yes KXNCAAF…"). Null for anything that is not an order. */
export function orderSide(i: FeedItem): "yes" | "no" | null {
  if (i.kind !== "order") return null;
  const w = String(i.side || "").trim().split(/\s+/)[0]?.toLowerCase();
  return w === "yes" || w === "no" ? w : null;
}

/**
 * Fold rows into positions, newest position first.
 *
 * `tailCounts` maps an order id to how many LOADED rows copied it — computed
 * by the caller over the rows this viewer already has, so a count can never
 * announce a bet they may not see.
 */
export function positionsOf(
  items: FeedItem[], tailCounts?: Map<string, number>,
): FeedPosition[] {
  const by = new Map<string, FeedPosition & {
    wSum: number; pSum: number;
    /** The exit price's own weighted sum, over the sell-closed rows only. */
    xwSum: number; xpSum: number;
    /** How the closed rows closed — the two counts decide `closedBy`. */
    sold: number; held: number;
  }>();
  for (const i of items) {
    if (i.kind === "score") continue;
    const key = `${i.user_id}|${contractKey(i)}`;
    const at = new Date(i.at).getTime();
    const ms = Number.isFinite(at) ? at : 0;
    const units = i.units != null && Number.isFinite(i.units) && i.units > 0
      ? i.units : null;
    // Units when we have them, one row = one vote when we do not. See the
    // header: dropping a size-less row would silently move the price shown.
    const w = units ?? 1;
    let p = by.get(key);
    if (!p) {
      p = {
        key, user_id: i.user_id, handle: i.handle,
        display_name: i.display_name, flares: i.flares,
        label: compactBet(i),
        ticker: i.ticker, side: orderSide(i), orderId: i.order_id,
        avgPrice: null, units: null, fills: 0, tails: 0, lastMs: ms,
        net: null, settledFills: 0, closedBy: null, exitPrice: null,
        ev: null, simP: null, items: [],
        sport: i.sport, home_team: i.home_team, away_team: i.away_team,
        game_slug: i.game_slug, season: i.season, week: i.week, title: i.title,
        wSum: 0, pSum: 0, xwSum: 0, xpSum: 0, sold: 0, held: 0,
      };
      by.set(key, p);
    }
    p.fills += 1;
    p.items.push(i);
    if (units != null) p.units = (p.units ?? 0) + units;
    if (i.price != null && Number.isFinite(i.price)) {
      p.wSum += w;
      p.pSum += w * i.price;
    }
    if (i.result && i.units_net != null && Number.isFinite(i.units_net)) {
      p.net = (p.net ?? 0) + i.units_net;
      p.settledFills += 1;
      // A row that ended before `closed_by` existed ended at settlement —
      // that is what every ended row in the table did until a sale could be
      // recorded — so only an explicit 'sell' counts as sold.
      if (i.closed_by === "sell") {
        p.sold += 1;
        if (i.exit_price != null && Number.isFinite(i.exit_price)) {
          p.xwSum += w;
          p.xpSum += w * i.exit_price;
        }
      } else p.held += 1;
    }
    if (i.order_id && tailCounts) p.tails += tailCounts.get(i.order_id) ?? 0;
    // NEWEST WINS for everything that describes the position now: which order
    // a tail copies, the words, the attribution. The rows arrive newest first,
    // so the first row seen is the newest one.
    if (ms > p.lastMs || p.fills === 1) {
      p.lastMs = ms;
      p.orderId = i.order_id;
      p.label = compactBet(i);
      p.ev = i.ev_fee != null && Number.isFinite(i.ev_fee) ? i.ev_fee : null;
      p.simP = i.sim_p != null && Number.isFinite(i.sim_p) ? i.sim_p : null;
    }
  }
  const out: FeedPosition[] = [];
  for (const p of by.values()) {
    p.avgPrice = p.wSum > 0 ? p.pSum / p.wSum : null;
    // ALL of it sold, or it is not a flip. See the type: a mixed position
    // did reach settlement and is described by that.
    p.closedBy = p.sold + p.held === 0 ? null
      : p.held === 0 ? "sell" : "settlement";
    p.exitPrice = p.closedBy === "sell" && p.xwSum > 0
      ? p.xpSum / p.xwSum : null;
    p.items.sort((a, b) => msOf(b.at) - msOf(a.at));
    const { wSum: _w, pSum: _p, xwSum: _xw, xpSum: _xp,
            sold: _s, held: _h, ...rest } = p;
    out.push(rest);
  }
  out.sort((a, b) => b.lastMs - a.lastMs);
  return out;
}

/* -------------------------------- buckets --------------------------------- */

export type FeedBucket = {
  /** The game: its slug when the rows carry one, else the event ticker. */
  key: string;
  /** Every item on this game, newest first. */
  items: FeedItem[];
  /** items[0] — the thing that just happened. */
  latest: FeedItem;
  /** The most recent score update on this game, when there is one. */
  score: FeedItem | null;
  positions: FeedPosition[];
  /** Latest action, epoch ms — the sort key. */
  atMs: number;
  home: string | null;
  away: string | null;
  sport: string | null;
};

/** The EVENT half of a Kalshi ticker: "KXNCAAFGAME-25SEP06RUTG-RUTG" ->
 *  "KXNCAAFGAME-25SEP06RUTG". Every market on one game shares it, which makes
 *  it the fallback identity for a row placed before `game_slug` was carried. */
export function eventOf(ticker: string | null | undefined): string | null {
  const t = String(ticker ?? "").trim();
  if (!t) return null;
  const parts = t.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : t;
}

/** Which game a row belongs to. `game_slug` is the real answer; the event
 *  ticker is the fallback; a row with neither is its own bucket rather than
 *  being lumped into a mixed one. */
export function bucketKeyOf(i: FeedItem): string {
  return i.game_slug || eventOf(i.ticker) || `${i.kind}:${i.id}`;
}

/**
 * Group the feed by game, most recent action first.
 *
 * The caller hands rows already ordered newest first (the view orders by `at`
 * descending), so first appearance is the latest action and the bucket order
 * falls out of insertion order — but the sort is explicit anyway, because a
 * bucket's time is a MAXIMUM over its rows and relying on the input's order to
 * express that is the kind of assumption that breaks the day a caller passes a
 * merged list.
 */
export function bucketize(
  items: FeedItem[], tailCounts?: Map<string, number>,
): FeedBucket[] {
  const by = new Map<string, FeedItem[]>();
  const order: string[] = [];
  for (const i of items) {
    const k = bucketKeyOf(i);
    const arr = by.get(k);
    if (arr) arr.push(i);
    else { by.set(k, [i]); order.push(k); }
  }
  const out: FeedBucket[] = [];
  for (const k of order) {
    const rows = by.get(k)!;
    rows.sort((a, b) => msOf(b.at) - msOf(a.at));
    const score = rows.find((r) => r.kind === "score") ?? null;
    // The teams, from the first row that names them — a score payload names
    // them even when the order rows do not.
    let home: string | null = null, away: string | null = null;
    for (const r of rows) {
      home = home ?? r.payload?.score?.home_team ?? r.home_team ?? null;
      away = away ?? r.payload?.score?.away_team ?? r.away_team ?? null;
      if (home && away) break;
    }
    out.push({
      key: k, items: rows, latest: rows[0], score,
      positions: positionsOf(rows, tailCounts),
      atMs: msOf(rows[0].at),
      home, away,
      sport: rows.find((r) => r.sport)?.sport ?? null,
    });
  }
  out.sort((a, b) => b.atMs - a.atMs);
  return out;
}

const msOf = (at: string): number => {
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
};

/* ------------------------------- the words -------------------------------- */

/** THE BET IN WORDS. The confirmed title when the row carries one; a posted
 *  pick spells out side + line; otherwise the exchange's own string, which is
 *  ugly but true. The unabbreviated version — the popover's. */
export function betText(item: FeedItem): string {
  if (item.title) return item.title;
  if (item.kind === "order") return item.ticker || item.side;
  const line = item.line == null ? "" : ` ${item.line > 0 ? "+" : ""}${item.line}`;
  return `${item.side}${line}`;
}

/**
 * THE BET AS A GLYPH STRING: "Rutgers over 23.5 points" becomes "Rutgers
 * o23.5", "Memphis -20.5" becomes "Memphis −20.5", a moneyline becomes ML.
 *
 * Purely a RE-SPELLING of the row's own confirmed title — no fact is added,
 * dropped or rounded, and the untouched sentence is one tap away — so a title
 * this does not recognise passes through exactly as written rather than being
 * mangled into a shape it does not have.
 */
export function compactBet(item: FeedItem): string {
  return betText(item)
    .replace(/\s+/g, " ")
    .replace(/\bover\s+/gi, "o")
    .replace(/\bunder\s+/gi, "u")
    .replace(/\s*\bpoints?\b/gi, "")
    .replace(/\bmoneyline\b/gi, "ML")
    .replace(/\bto win\b/gi, "ML")
    .replace(/(^|\s)-(?=\d)/g, "$1−")
    .trim();
}

/** A size in units for a FACE: "1.5u", "0.16u", "1u". Null renders as nothing
 *  at all — never as a guessed unit. */
export function unitsShort(u: number | null): string | null {
  if (u == null || !Number.isFinite(u) || u <= 0) return null;
  const r = Math.round(u * 100) / 100;
  return `${r.toFixed(2).replace(/\.?0+$/, "")}u`;
}

/** A size in units in the words people use: "1.5 units", "1 unit". */
export function unitsText(u: number | null): string | null {
  if (u == null || !Number.isFinite(u) || u <= 0) return null;
  const r = Math.round(u * 100) / 100;
  const n = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
  return `${n} unit${r === 1 ? "" : "s"}`;
}

/** "now" / "4m" / "3h" / "2d" — a corner mark, not a phrase. */
export function ago(at: string | number): string {
  const t = typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(t) || t <= 0) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** A team in a few characters: initials for a multi-word school, the first
 *  three letters for a one-word one. A DISPLAY abbreviation, never an identity
 *  — the logo carries that and the popover spells the name out. */
export function shortTeam(name: string | null | undefined): string {
  const n = String(name ?? "").trim();
  if (!n) return "";
  const w = n.split(/\s+/).filter((x) => !/^(of|the|at|and|&)$/i.test(x));
  if (w.length >= 2) return w.map((x) => x[0]).join("").toUpperCase().slice(0, 4);
  return n.slice(0, 3).toUpperCase();
}

/** The matchup in words, for a bucket header: "Rutgers at Ohio State". Falls
 *  back to whichever half is known, then to the bucket's own key. */
export function matchupWords(b: { home: string | null; away: string | null; key: string }): string {
  if (b.home && b.away) return `${b.away} at ${b.home}`;
  return b.home || b.away || b.key;
}
