// src/lib/placeOrders.ts
//
// Client side of the portal's ORDER-ENTRY routes. This is the only place in
// the frontend that can move real money, so it stays deliberately thin: it
// mints an idempotency key, POSTs an INTENT, and renders back whatever the
// server decided.
//
// Everything that matters is enforced server-side (server/liveScores.ts):
// auth, NCAAF-only tickers, per-order/per-request/24h caps, the live-book
// re-check immediately before signing, idempotent replay, the audit log, and
// the CFB_ORDERS_LIVE dry-run stage. Nothing here is a safety control — if a
// rail appears to live in this file, it is in the wrong file.
//
// INTENT, NOT MECHANICS. The request carries `mode: "rest" | "take"` and the
// server derives post_only / time_in_force from it. `post_only`, `type`,
// `time_in_force` and friends are REJECTED by the server if sent, so the
// client cannot ask for a market order even by accident.

export type PlaceMode = "rest" | "take";

/** One order as the wire wants it. `count_fp` is whole contracts. */
export type PlaceOrder = {
  ticker: string;
  side: "yes" | "no";
  mode: PlaceMode;
  price_dollars: number;
  count_fp: number;
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
  state?: { status: string; filled: number | null; remaining: number | null } | null;
  reason?: string;
  message?: string;
  http_status?: number;
  book?: { yes_bid: number | null; yes_ask: number | null; no_bid: number | null; no_ask: number | null };
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
  totals?: { cost: number; spent_24h: number; remaining_24h: number };
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
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cfb-token": token },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  let json: any = {};
  try { json = await r.json(); } catch { json = { error: "bad_response" }; }
  return { status: r.status, body: json };
}

export function placeOrders(token: string, idempotencyKey: string, orders: PlaceOrder[]) {
  return post("/api/portfolio/cfb/orders", token,
    { idempotency_key: idempotencyKey, orders });
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
  totals?: { cost: number; spent_24h: number; remaining_24h: number };
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
    { idempotency_key: idempotencyKey, ...req });
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
    case "cap_24h":
      return `Over the $${body.cap} rolling 24h cap ` +
             `($${body.spent_24h?.toFixed(2)} already committed).`;
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
