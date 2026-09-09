// src/lib/placeOrders.ts
//
// Client side of the portal's ORDER-ENTRY routes. This is the only place in
// the frontend that can move real money, so it stays deliberately thin: it
// mints an idempotency key, POSTs an INTENT, and renders back whatever the
// server decided.
//
// Everything that matters is enforced server-side (server/liveScores.ts):
// auth, NCAAF-only tickers, per-order/per-request caps, the live-book
// re-check immediately before signing, idempotent replay, the audit log, and
// the CFB_ORDERS_LIVE dry-run stage. Nothing here is a safety control — if a
// rail appears to live in this file, it is in the wrong file.
//
// INTENT, NOT MECHANICS. The request carries `mode: "rest" | "take"` and the
// server derives post_only / time_in_force from it. `post_only`, `type`,
// `time_in_force` and friends are REJECTED by the server if sent, so the
// client cannot ask for a market order even by accident.

import { declaredOrderCap } from "./ownerPrefs";
// ACCOUNTS (docs/ACCOUNTS_DESIGN.md): a placement that can be ATTRIBUTED to a
// signed-in user gets mirrored into `app_orders` server-side. The bearer is
// what makes it attributable; without it (accounts off, or nobody signed in)
// the request is byte-for-byte the one this file has always sent.
import { getAccessToken } from "./supabase";

export type PlaceMode = "rest" | "take";

/** One order as the wire wants it. `count_fp` is whole contracts. */
export type PlaceOrder = {
  ticker: string;
  side: "yes" | "no";
  mode: PlaceMode;
  price_dollars: number;
  count_fp: number;
  /** OPTIONAL ATTRIBUTION for the accounts feed — which board this bet came
   *  from. The server sanitises these to null rather than rejecting a bad
   *  value: metadata must never be why a confirmed bet is refused, and none
   *  of it reaches Kalshi. */
  season?: number;
  week?: number;
  game_slug?: string;
  /** THE FEED'S SENTENCE, from the confirm slip that already holds it: the bet
   *  in the words the user pressed Confirm on ("Rutgers over 23.5 points"),
   *  the two teams so the feed row can wear their logos, and our sim's opinion
   *  — P(YES) and EV per $1 after the fee. Same contract as the three above:
   *  sanitised server-side, never sent to Kalshi, never a rail. */
  title?: string;
  home_team?: string;
  away_team?: string;
  sim_p?: number;
  ev_fee?: number;
};

/** Echo of one order, as the server describes it back. */
export type PlaceEcho = {
  ticker: string;
  side: "yes" | "no";
  mode: PlaceMode;
  price_dollars: number;
  count: number;
  fee: number;
  cost: number;
  client_order_id: string;
  yes_price?: number;
  book_side?: "bid" | "ask";
  post_only?: boolean;
  time_in_force?: string;
  order_id?: string;
  tif_downgraded?: boolean;
  state?: {
    status: string; filled: number | null; remaining: number | null;
    /** What the fills actually cost / were charged, from the exchange's own
     *  ledger fields — an IOC take can fill BETTER than its limit, so
     *  price × filled would overstate the money. Absent on older servers. */
    fill_cost?: number; fill_fees?: number;
    /** How many read-backs the server needed before the order was terminal
     *  (2026-09-08: the IOC cancel can lag the placement response). */
    read_tries?: number;
  } | null;
  /** PARTIAL TAKE only: the fresh ask on this order's OWN side after the IOC
   *  came back, and how many contracts sit there — what "continue at the next
   *  price" would pay. Absent when the take filled whole, the remainder
   *  rested (tif_downgraded), or the re-read failed. */
  next_ask?: number | null;
  next_ask_size?: number | null;
  reason?: string;
  message?: string;
  http_status?: number;
  book?: {
    yes_bid: number | null; yes_ask: number | null; no_bid: number | null; no_ask: number | null;
    /** Contracts at the best YES ask / YES bid (a NO taker lifts 1 − yes_bid,
     *  so the NO side's size is the YES bid's). Absent on older servers. */
    yes_ask_size?: number | null; yes_bid_size?: number | null;
  };
};

export type PlaceResponse = {
  /** TRUE means nothing was submitted — CFB_ORDERS_LIVE is not set. */
  dry_run?: boolean;
  idempotency_key?: string;
  /** When the live book was re-read, server-side, just before deciding. */
  checked_at?: string;
  placed?: PlaceEcho[];
  would_place?: PlaceEcho[];
  errors?: PlaceEcho[];
  rejected?: PlaceEcho[];
  totals?: { cost: number; spent_24h: number };
  note?: string;
  /** Set on every refusal: "book_moved", "cap_order", "forbidden_field", … */
  error?: string;
  detail?: string;
  cap?: number;
  total?: number;
  spent_24h?: number;
  /** The key had already been used; this is the ORIGINAL answer replayed. */
  replayed?: boolean;
};

/**
 * A fresh key per CONFIRM PRESS. Two presses of the same confirmed slip reuse
 * it, so a double-tap on a phone cannot place twice; a retry after a rejection
 * mints a new one, because the prices have moved and it is a new decision.
 */
export function newIdempotencyKey(): string {
  try {
    const u = globalThis.crypto?.randomUUID?.();
    if (u) return u.replace(/-/g, "");
  } catch { /* fall through to the arithmetic key */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

async function post(url: string, token: string, body: unknown) {
  // BOTH credentials, when both exist. `x-cfb-token` stays the trading
  // authority through the owner cutover (docs/ACCOUNTS_DESIGN.md); the bearer
  // only says WHO pressed the button, so the server can file the placement
  // under a user. A build without accounts sends exactly the old headers.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-cfb-token": token,
  };
  const jwt = await getAccessToken();
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(body),
  });
  let json: any = {};
  try { json = await r.json(); } catch { json = { error: "bad_response" }; }
  return { status: r.status, body: json };
}

export function placeOrders(
  token: string, idempotencyKey: string, orders: PlaceOrder[],
  /** The per-order cap to declare. The confirm slip passes the number it
   *  ALREADY warned about, so the wire and the warning are one value; callers
   *  with no page state (Friend Feed Join, the partial-fill chase) let it fall
   *  back to the stored preferences. */
  cap: number = declaredOrderCap(),
) {
  // `unit_size` is THE PER-ORDER CAP THIS SLIP DECLARES (2x for the slip
  // total). Since the unit sizing MODE shipped (2026-09-08) that is the unit
  // times the mode's risk multiple — a to-win row at 86c legitimately outlays
  // more than one unit and would otherwise be refused by our own cap rather
  // than by a rail. `declaredOrderCap` is 1x the unit in `risk` mode, so the
  // default path declares exactly what it declared before. The RAIL is
  // unchanged and still server-side: clamp(unit_size, 1..500) per order, 2x
  // per slip — sending this is a preference inside the rail, never a
  // relaxation of it (see the header note).
  return post("/api/portfolio/cfb/orders", token,
    { idempotency_key: idempotencyKey, orders, unit_size: cap });
}

/** The kill switch. Reaches ONLY orders this app placed (server filters on the
 *  `cfbapp-` client_order_id tag), so the maker pipeline's book is safe. */
export function cancelAppOrders(token: string) {
  return post("/api/portfolio/cfb/orders/cancel", token, { all: true });
}

/** ONE resting order, by id — same route, same tag filter. An order that has
 *  already filled or been cancelled comes back as `not_resting` WITH its real
 *  state; one that is not ours comes back 404 `not_app_order`. Neither is ever
 *  reported as a successful cancel. */
export function cancelAppOrder(token: string, orderId: string) {
  return post("/api/portfolio/cfb/orders/cancel", token, { order_id: orderId });
}

/** A resting order becoming a take: cancel, confirm, then IOC at `limit_price`,
 *  server-side and under ONE idempotency key. See the CONVERT block in
 *  server/liveScores.ts for the whole contract — including the composite
 *  `cancelled_not_placed` state this client must say out loud. */
export type ConvertRequest = {
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  /** Contracts still working on the rest. The server takes the smaller of this
   *  and what the cancel confirms was left. */
  count_fp: number;
  /** The confirmed crossing price — a HARD bound. A worse ask is refused and
   *  the rest is left alone. */
  limit_price: number;
};

export type ConvertResponse = {
  dry_run?: boolean;
  idempotency_key?: string;
  checked_at?: string;
  /** Present once the cancel has been attempted. `ok:false` means the rest is
   *  still working and nothing was placed. */
  cancel?: { ok: boolean; order_id: string; ticker?: string; http_status?: number;
             state?: { status: string; filled: number | null; remaining: number | null } | null } | null;
  would_cancel?: { order_id: string; ticker: string; remaining: number | null };
  would_place?: PlaceEcho[];
  placed?: PlaceEcho[];
  errors?: PlaceEcho[];
  totals?: { cost: number; spent_24h: number };
  book?: { yes_bid: number | null; yes_ask: number | null; no_bid: number | null; no_ask: number | null };
  note?: string;
  /** "book_moved" | "no_offer" | "not_resting" | "not_app_order" |
   *  "cancel_failed" | "cancelled_not_placed" | "cancelled_nothing_left" | … */
  error?: string;
  detail?: string;
  cap?: number;
  total?: number;
  spent_24h?: number;
  state?: { status: string; filled: number | null; remaining: number | null } | null;
  replayed?: boolean;
};

export function convertOrder(token: string, idempotencyKey: string, req: ConvertRequest) {
  return post("/api/portfolio/cfb/orders/convert", token,
    { idempotency_key: idempotencyKey, ...req, unit_size: declaredOrderCap() });
}

/** THE state the UI must never soften: the rest is gone and no take replaced
 *  it, so the market is UNHELD and the ticker will reappear as a normal
 *  suggestion on the next compute. */
export const convertLostBoth = (b: ConvertResponse): boolean =>
  b.error === "cancelled_not_placed";

/** Human sentence for a server refusal, for the confirm popup's result area. */
export function placeErrorText(body: PlaceResponse): string {
  if (body.rejected?.length) {
    return body.rejected.map((r) => r.message || r.reason || "rejected").join(" · ");
  }
  switch (body.error) {
    case "cap_order":
      return `Over the $${body.cap} per-order cap — ${body.detail ?? ""}`.trim();
    case "cap_request":
      return `Over the $${body.cap} per-slip cap (this slip: $${body.total?.toFixed(2)}).`;
    case "in_flight":
      return "That slip is already being placed — waiting on the exchange.";
    case "book_unavailable":
      return "Could not re-read the live book, so nothing was sent.";
    case "kalshi_credentials_missing":
      return "The server has no Kalshi credentials configured.";
    case "bad_password":
      return "Portal password rejected — log in again.";
    case "locked":
      return "Too many failed logins; the portal is cooling down.";
    default:
      return body.detail || body.error || "Order refused.";
  }
}
