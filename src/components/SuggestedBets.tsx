// src/components/SuggestedBets.tsx
//
// Owner-only "Suggested bets" — and, since 2026-08-28, the ONE surface in this
// app that can place a real order.
//
// `scripts/fbs_maker_pipeline.py` in cfb-props-sim remains the AUTOMATED
// placement authority and stays post-only-only. This card is the
// HUMAN-CONFIRMED path: it mirrors the pipeline's selection constants so the
// same conclusions can be read on a phone, and a Place button turns one into
// an order after an explicit confirm. If the two ever disagree on SELECTION,
// the pipeline is right and this file is the bug.
//
// ---------------------------------------------------------------------------
// Zero new Kalshi load
// ---------------------------------------------------------------------------
// Everything is computed from quotes ALREADY flowing through the page's
// /api/kalshi/cfb poll (45s TTL, bulk series paging). No orderbook-depth
// calls, no per-market fan-out. Because the compute is a pure function of
// that feed, it re-runs whenever the poll delivers — live for free. "Refresh"
// only re-runs the compute against the newest feed the page holds.
//
// The one exception is deliberate: pressing Confirm makes the SERVER re-read
// the live orderbook for those tickers before it signs anything. That is per
// human action, not per poll, and it is the whole point — the displayed price
// is a 45s-old quote and an order must never be sent against a stale book.
//
// ---------------------------------------------------------------------------
// PREGAME ONLY — a correctness rule, not a preference
// ---------------------------------------------------------------------------
// Our sim fairs are pregame distributions. Once a ball is kicked they are
// wrong, and an "edge" against a live book would be an invitation to lose
// money. In-progress and final games are excluded, and so is any game whose
// kick time has passed even if the live feed has not caught up yet.
//
// ---------------------------------------------------------------------------
// Fees are never gross
// ---------------------------------------------------------------------------
// Every displayed edge is NET of the fee that applies to that row's mode, at
// that row's price, using Kalshi's own per-series fee params (see
// suggestedBets.ts — the per-team families charge no maker fee at all). The
// confirm popup itemizes it, at the row's OWN mode: a TAKE row is priced with
// the taker fee, a REST row with the maker fee.
//
// ---------------------------------------------------------------------------
// What this component does NOT do
// ---------------------------------------------------------------------------
// No client-side rails. Caps, ticker allowlist, the live-book re-check,
// idempotency, the audit log and the CFB_ORDERS_LIVE dry-run stage all live in
// server/liveScores.ts. No position bookkeeping either: after a live placement
// the portfolio strip picks it up on its own next poll.

import { useEffect, useMemo, useState } from "react";
import { getTeamStatsCached, type TeamStats as TeamStatsDoc } from "../lib/cfbJson";
import type { KalshiGame } from "../lib/kalshi";
import type { PortalPayload } from "../lib/kalshiPortal";
import {
  buildSuggestions, groupLadders, heldTickerSet, statCandidates,
  LADDER_RISK, MIN_MAKER_EDGE, TAKE_THRESHOLD,
  type Candidate, type FeeParams, type LadderGroup,
} from "../lib/suggestedBets";
import {
  cancelAppOrders, newIdempotencyKey, placeErrorText, placeOrders,
  type PlaceOrder, type PlaceResponse,
} from "../lib/placeOrders";
import type { Season } from "../lib/cfbData";

/** Our stat key -> the Kalshi series that settles it (server's map, inverted). */
const SERIES_FOR: Record<string, string> = {
  points: "KXNCAAFTEAMTOTAL",
  rec_yards: "KXNCAAFTEAMRECYDS",
  rush_yards: "KXNCAAFTEAMRSHYDS",
  total_yards: "KXNCAAFTEAMYDS",
  receptions: "KXNCAAFTEAMREC",
  rush_att: "KXNCAAFTEAMRSHATT",
  rush_td: "KXNCAAFTEAMRSHTD",
  rec_td: "KXNCAAFTEAMRECTD",
  def_sacks: "KXNCAAFTEAMSACK",
  def_ints: "KXNCAAFTEAMINT",
};

/** Bet-slip wording, not column headings. */
const SHORT: Record<string, string> = {
  points: "points",
  rec_yards: "rec yds",
  rush_yards: "rush yds",
  total_yards: "total yds",
  receptions: "receptions",
  rush_att: "rush att",
  rush_td: "rush TDs",
  rec_td: "rec TDs",
  def_sacks: "sacks",
  def_ints: "INTs",
};

export type SuggestGame = {
  key: string;
  slug: string;
  ns: Season;
  teamA: string;
  teamB: string;
  /** True when the game has kicked, is live, or is final. */
  started: boolean;
};

const cents = (v: number) => `${Math.round(v * 100)}¢`;
const signed = (v: number) =>
  `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}¢`;
const clock = (d: Date) => d.toLocaleTimeString();

/* --------------------------- collapse memory ----------------------------- */
// Starts COLLAPSED: this card is a dense list under everything else on the
// page, and it is now also the card with the money buttons on it.
const OPEN_KEY = "cfb.suggestedBets.open";
function readOpen(): boolean {
  try { return window.localStorage.getItem(OPEN_KEY) === "1"; }
  catch { return false; }
}
function writeOpen(v: boolean): void {
  try { window.localStorage.setItem(OPEN_KEY, v ? "1" : "0"); }
  catch { /* storage unavailable — the preference just will not persist */ }
}

export default function SuggestedBets({
  games, kalshiBySlug, feeParams, portal, weekId, token, onJump,
}: {
  games: SuggestGame[];
  kalshiBySlug: Map<string, KalshiGame>;
  feeParams: Record<string, FeeParams>;
  portal: PortalPayload | null;
  weekId: string;
  /** Portal password — the same header the reads use. Placement needs it. */
  token: string;
  onJump?: (cardKey: string) => void;
}) {
  const [docs, setDocs] = useState<Record<string, TeamStatsDoc>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<boolean>(() => readOpen());
  /** The confirm slip. `idem` is minted ONCE per opening, so a double-tap on
   *  Confirm replays server-side instead of placing twice. */
  const [slip, setSlip] = useState<{ group: LadderGroup; idem: string } | null>(null);
  const [kill, setKill] = useState<{ busy: boolean; msg: string } | null>(null);

  // team_stats per namespace on the slate; the loader is memoized per
  // (ns, week) so this costs nothing beyond what the panel already fetched.
  const namespaces = useMemo(
    () => Array.from(new Set(games.map((g) => String(g.ns)))).sort().join(","),
    [games]
  );
  useEffect(() => {
    let alive = true;
    const list = namespaces ? namespaces.split(",") : [];
    for (const ns of list) {
      getTeamStatsCached(ns as Season, weekId)
        .then((d) => { if (alive) setDocs((prev) => (prev[ns] ? prev : { ...prev, [ns]: d })); })
        .catch(() => { /* not published for this namespace: no suggestions */ });
    }
    return () => { alive = false; };
  }, [namespaces, weekId]);

  const { rows, suppressed, computedAt } = useMemo(() => {
    const held = heldTickerSet(portal?.positions, portal?.orders);
    const candidates: Candidate[] = [];
    for (const g of games) {
      // PREGAME ONLY.
      if (g.started) continue;
      const kg = kalshiBySlug.get(g.key);
      if (!kg) continue;
      const doc = docs[String(g.ns)];
      const stats = doc?.games?.[g.slug]?.stats;
      if (!stats) continue;
      candidates.push(...statCandidates(
        // `key` is what the scoreboard scrolls to; `slug` only indexes the
        // published stats above.
        kg, g.key, g.teamA, g.teamB,
        (stat) => SHORT[stat] ?? stat,
        (team, stat, strike) => {
          // Published rung, read verbatim. No interpolation, no client-side
          // distribution math — a strike off the grid simply has no bet.
          const r = stats[team]?.[stat]?.rungs;
          const v = r?.[String(strike)];
          return typeof v === "number" ? v : null;
        },
        (stat) => SERIES_FOR[stat] ?? "",
      ));
    }
    const built = buildSuggestions(candidates, feeParams, held);
    return { ...built, computedAt: new Date() };
    // `nonce` is the manual refresh: it re-runs the compute against whatever
    // feed the page currently holds, and never triggers a fetch of its own.
  }, [games, kalshiBySlug, feeParams, portal, docs, nonce]);

  // Presentation only: fold each ladder's picked rungs (nested markets, up to
  // MAX_RUNGS) into one display row, ranked by its best rung's net edge.
  // Selection and sizing already happened above; this never touches either.
  const groups = useMemo(() => groupLadders(rows), [rows]);

  // Card key -> game, so a same-game run of ladder rows can carry a header.
  const gameByKey = useMemo(() => new Map(games.map((g) => [g.key, g])), [games]);

  const pregameCount = games.filter((g) => !g.started).length;
  // Undefined on a server that predates order entry: treat as staged-off,
  // which is the safe reading.
  const ordersLive = portal?.orders_live === true;

  const runKill = async () => {
    setKill({ busy: true, msg: "" });
    try {
      const r = await cancelAppOrders(token);
      const n = Array.isArray(r.body?.cancelled) ? r.body.cancelled.length : 0;
      setKill({
        busy: false,
        msg: r.status === 200
          ? (n ? `Cancelled ${n} app order${n === 1 ? "" : "s"}.`
               : "No resting app orders to cancel.")
          : placeErrorText(r.body as PlaceResponse),
      });
    } catch {
      setKill({ busy: false, msg: "Cancel failed — network." });
    }
  };

  return (
    <section style={{
      border: "1px solid var(--brand)", borderRadius: 12,
      background: "var(--card)", padding: 10, display: "grid", gap: open ? 8 : 0,
    }}>
      {/* Header row — present in BOTH states. The kill switch lives here on
          purpose: a control that pulls resting money must not be hidden
          behind a collapsed panel. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => { const v = !open; setOpen(v); writeOpen(v); }}
          aria-expanded={open}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "2px 4px",
            border: "none", background: "none", color: "var(--text)",
            font: "inherit", cursor: "pointer", textAlign: "left",
          }}
        >
          <span aria-hidden="true" style={{
            display: "inline-block", fontSize: 10, color: "var(--muted)",
            transform: open ? "rotate(90deg)" : "none", transition: "transform .12s",
          }}>
            ▶
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>
            Suggested bets ({groups.length})
          </span>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            · computed {clock(computedAt)}
          </span>
        </button>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {!ordersLive && (
            <DryRunBadge title="Order entry is staged: the server validates and logs, and submits nothing." />
          )}
          <button type="button" className="ui-btn" onClick={runKill} disabled={kill?.busy}
                  title="Cancel every resting order this app placed (cfbapp- tagged only)"
                  style={{ padding: "2px 8px", fontSize: 11 }}>
            {kill?.busy ? "Cancelling…" : "Cancel my app orders"}
          </button>
          {open && (
            <button type="button" className="ui-btn" onClick={() => setNonce((n) => n + 1)}
                    style={{ padding: "2px 8px", fontSize: 11 }}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {kill?.msg && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{kill.msg}</div>
      )}

      {open && (
        <>
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {pregameCount} pregame game{pregameCount === 1 ? "" : "s"} · $
            {LADDER_RISK} per ladder · rest at {Math.round(MIN_MAKER_EDGE * 100)}¢+,
            take at {Math.round(TAKE_THRESHOLD * 100)}¢+ (both after fee)
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--muted)" }}>
            <span aria-hidden="true" style={{
              width: 6, height: 6, borderRadius: 999, background: "var(--pos)",
              display: "inline-block", flex: "none",
            }} />
            Computed at {clock(computedAt)} · live. Edges are NET of fee. Prices
            are re-verified against the live book at placement.
          </div>

          {groups.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Nothing clears the thresholds right now.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 3 }}>
              {groups.map((g, i) => {
                const on = g.ladder === sel;
                const single = g.rungs.length === 1;
                const head = g.rungs[0];
                // Same-game visual cue: a run of >=2 consecutive rows sharing a
                // game reads as one concentration, not N independent picks.
                const isRunStart = groups[i - 1]?.slug !== g.slug;
                let runLen = 1;
                for (let j = i + 1; j < groups.length && groups[j].slug === g.slug; j++) runLen++;
                const game = gameByKey.get(g.slug);
                return (
                  <div key={g.ladder}>
                    {isRunStart && runLen > 1 && game && (
                      <div style={{
                        fontSize: 9.5, fontWeight: 700, color: "var(--muted)",
                        textTransform: "uppercase", letterSpacing: 0.3,
                        borderTop: "1px solid var(--border)",
                        padding: "5px 2px 2px", marginTop: i === 0 ? 0 : 2,
                      }}>
                        {game.teamA} vs {game.teamB} — {runLen} bets, one game
                      </div>
                    )}
                    <div style={{
                      display: "flex", alignItems: "stretch", gap: 4,
                    }}>
                      <button
                        type="button"
                        onClick={() => { setSel(on ? null : g.ladder); onJump?.(g.slug); }}
                        style={{
                          flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                          display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
                          padding: "5px 7px", borderRadius: 7,
                          border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                          background: "var(--card)", color: "var(--text)",
                          font: "inherit", fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{single ? head.label : g.headline}</span>
                        {single ? (
                          <>
                            <span style={{
                              fontSize: 10, fontWeight: 800, padding: "1px 6px",
                              borderRadius: 999, border: "1px solid var(--border)",
                              color: "var(--muted)", whiteSpace: "nowrap",
                            }}>
                              {head.mode} @{cents(head.price)}
                            </span>
                            <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                              ${LADDER_RISK} → {head.count} @ {cents(head.price)}
                            </span>
                          </>
                        ) : (
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: "1px 6px",
                            borderRadius: 999, border: "1px solid var(--border)",
                            color: "var(--muted)", whiteSpace: "nowrap",
                          }}>
                            {g.rungs.length} rungs · ${g.each} each
                          </span>
                        )}
                        <span style={{
                          marginLeft: "auto", fontWeight: 800,
                          fontVariantNumeric: "tabular-nums",
                          color: g.bestEdge > 0 ? "var(--pos)" : "var(--neg)",
                        }}>
                          {signed(g.bestEdge)}
                        </span>
                      </button>
                      {/* Every mode gets a Place button. A REST rung rests
                          post-only; a TAKE rung is a LIMIT order at this exact
                          price — never a market order (user decision
                          2026-08-28). A ladder's rungs go as ONE request. */}
                      <button
                        type="button"
                        className="ui-btn"
                        onClick={() => setSlip({ group: g, idem: newIdempotencyKey() })}
                        title={`Place ${g.rungs.length} order${g.rungs.length === 1 ? "" : "s"}`}
                        style={{ padding: "0 10px", fontSize: 11, fontWeight: 800, flex: "none" }}
                      >
                        Place
                      </button>
                    </div>
                    {on && (
                      <div style={{
                        margin: "3px 0 5px", padding: "6px 8px", fontSize: 11.5,
                        lineHeight: 1.5, color: "var(--text)",
                        background: "var(--card)", border: "1px solid var(--brand)",
                        borderRadius: 7,
                      }}>
                        {single ? (
                          <>
                            Sim {Math.round(head.simP * 100)}% · price {cents(head.price)} ·
                            fee {(head.fee * 100 / Math.max(head.count, 1)).toFixed(1)}¢/contract
                            {" "}({head.fee.toFixed(2)} total) · net edge {signed(head.edge)}
                            <div style={{ color: "var(--muted)", marginTop: 2 }}>
                              {head.count} contracts, outlay ${head.outlay.toFixed(2)} of ${LADDER_RISK}
                              {" · "}fee type {head.feeType}
                              {" · "}{head.ticker}
                            </div>
                          </>
                        ) : (
                          <>
                            {g.rungs.map((rr, ri) => (
                              <div key={rr.key} style={{
                                display: "flex", alignItems: "baseline", gap: 8,
                                padding: "3px 0",
                                borderTop: ri === 0 ? "none" : "1px solid var(--border)",
                              }}>
                                <span style={{ fontWeight: 700 }}>{rr.strike}+</span>
                                <span style={{ color: "var(--muted)" }}>{rr.mode} @{cents(rr.price)}</span>
                                <span style={{ color: "var(--muted)" }}>
                                  {rr.count} ct · fee {rr.fee.toFixed(2)}
                                </span>
                                <span style={{
                                  marginLeft: "auto", fontWeight: 700,
                                  color: rr.edge > 0 ? "var(--pos)" : "var(--neg)",
                                }}>
                                  {signed(rr.edge)}
                                </span>
                              </div>
                            ))}
                            <div style={{ color: "var(--muted)", marginTop: 4 }}>
                              ${LADDER_RISK} ladder, ${g.each} per rung
                              {" · "}outlay ${g.rungs.reduce((s, rr) => s + rr.outlay, 0).toFixed(2)}
                              {" · "}fee type {head.feeType}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {suppressed.length > 0 && (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {suppressed.length} candidate{suppressed.length === 1 ? "" : "s"} suppressed
              (thin or one-sided book, sim in its own tail, ladder cap, penny quote,
              or already held).
            </div>
          )}
        </>
      )}

      {slip && (
        <ConfirmSlip
          group={slip.group}
          idem={slip.idem}
          token={token}
          quotedAt={computedAt}
          ordersLive={ordersLive}
          onClose={() => setSlip(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------ dry-run badge ----------------------------- */
// Deliberately NOT --pos/--neg: those two carry ONE meaning on this card (the
// sign of an edge) and overloading them would make a staged order read as a
// bad bet. --accent is the site's third, non-semantic hue.
function DryRunBadge({ title }: { title?: string }) {
  return (
    <span title={title} style={{
      fontSize: 9.5, fontWeight: 900, letterSpacing: 0.6, padding: "2px 7px",
      borderRadius: 999, whiteSpace: "nowrap",
      background: "var(--accent)", color: "var(--accent-contrast)",
      border: "1px solid color-mix(in oklab, var(--accent) 70%, var(--text))",
    }}>
      DRY RUN
    </span>
  );
}

/* ----------------------------- confirm popup ------------------------------ */
/**
 * The bet in words, then Confirm. Everything shown here is a client-side
 * restatement of an already-computed suggestion; the SERVER re-reads the live
 * book before it signs, so a price that has moved comes back as a rejection
 * naming the new ask rather than as a bad fill.
 */
function ConfirmSlip({
  group, idem, token, quotedAt, ordersLive, onClose,
}: {
  group: LadderGroup;
  idem: string;
  token: string;
  quotedAt: Date;
  ordersLive: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<{ status: number; body: PlaceResponse } | null>(null);

  const rungs = group.rungs;
  const contracts = rungs.reduce((s, r) => s + r.count, 0);
  const fee = rungs.reduce((s, r) => s + r.fee, 0);
  const outlay = rungs.reduce((s, r) => s + r.outlay, 0);
  const anyTake = rungs.some((r) => r.mode === "TAKE");

  const send = async () => {
    setBusy(true);
    const orders: PlaceOrder[] = rungs.map((r) => ({
      ticker: r.ticker,
      side: r.side,
      // Intent only. The server derives post_only / time_in_force from it and
      // rejects the request outright if we try to send those ourselves.
      mode: r.mode === "REST" ? "rest" : "take",
      price_dollars: r.price,
      count_fp: r.count,
    }));
    try {
      setResp(await placeOrders(token, idem, orders));
    } catch {
      setResp({ status: 0, body: { error: "network", detail: "Request failed — nothing was sent." } });
    } finally {
      setBusy(false);
    }
  };

  const body = resp?.body;
  const ok = resp !== null && (resp.status === 200) && !body?.error;
  const dry = body?.dry_run ?? !ordersLive;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm order"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "grid", placeItems: "center", padding: 16, zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)", maxHeight: "86vh", overflowY: "auto",
          padding: 14, borderRadius: 14, display: "grid", gap: 9,
          background: "var(--card)", color: "var(--text)",
          border: "1px solid var(--brand)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: "var(--brand-text)" }}>
            {resp ? "Result" : rungs.length > 1 ? "Place these bets" : "Place this bet"}
          </span>
          {dry && <DryRunBadge title="CFB_ORDERS_LIVE is not set — nothing is submitted to Kalshi." />}
        </div>

        {dry && !resp && (
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
            Staged mode. Confirming runs the full path — password, caps, a fresh
            read of the live book, the audit log — and submits nothing.
          </div>
        )}

        {/* --- the bet, in words --- */}
        {!resp && (
          <div style={{ display: "grid", gap: 6 }}>
            {rungs.map((r) => (
              <div key={r.key} style={{
                border: "1px solid var(--border)", borderRadius: 9, padding: "7px 9px",
                display: "grid", gap: 3, fontSize: 12,
              }}>
                <div style={{ fontWeight: 800 }}>{r.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 900, padding: "1px 6px", borderRadius: 999,
                    border: "1px solid var(--border)", color: "var(--muted)",
                  }}>
                    {r.mode} @ {cents(r.price)}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {r.count} contracts · ${(r.price * r.count).toFixed(2)}
                    {" + "}${r.fee.toFixed(2)} {r.mode === "TAKE" ? "taker" : "maker"} fee
                    {" = "}<strong style={{ color: "var(--text)" }}>${r.outlay.toFixed(2)}</strong>
                  </span>
                  <span style={{
                    marginLeft: "auto", fontWeight: 800,
                    color: r.edge > 0 ? "var(--pos)" : "var(--neg)",
                  }}>
                    {signed(r.edge)} net
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                  {r.mode === "TAKE"
                    ? `Fills at ${cents(r.price)} or better, never worse — it is a limit order, not a market order. Anything that does not fill immediately is cancelled; if the exchange ignores immediate-or-cancel the remainder rests at ${cents(r.price)} and the result below will say so.`
                    : `Rests at ${cents(r.price)}, post-only: if the book has moved so this would cross, it is rejected rather than filled as a taker.`}
                </div>
              </div>
            ))}
          </div>
        )}

        {!resp && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
            <div>
              <strong style={{ color: "var(--text)" }}>
                {contracts} contract{contracts === 1 ? "" : "s"} · ${outlay.toFixed(2)} total
              </strong>
              {" "}(${(outlay - fee).toFixed(2)} stake + ${fee.toFixed(2)} fee)
            </div>
            <div>
              Prices as of {clock(quotedAt)} · re-verified against the live book
              at placement.
            </div>
            {anyTake && (
              <div>Taker rows pay the full fee; resting rows pay the maker fee (zero on these families).</div>
            )}
          </div>
        )}

        {/* --- the answer --- */}
        {resp && (
          <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
            {ok ? (
              <>
                <div style={{ fontWeight: 800, color: dry ? "var(--text)" : "var(--pos)" }}>
                  {dry
                    ? `Validated — ${(body?.would_place?.length ?? 0)} order(s) would be placed.`
                    : `Placed ${body?.placed?.length ?? 0} order(s).`}
                  {body?.replayed && " (replay of an identical slip — nothing placed twice.)"}
                </div>
                {(dry ? body?.would_place : body?.placed)?.map((p) => (
                  <div key={p.client_order_id} style={{
                    border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px",
                    color: "var(--muted)", fontSize: 11.5,
                  }}>
                    <div style={{ color: "var(--text)", fontWeight: 700 }}>
                      {p.count} @ {cents(p.price_dollars)} · {p.mode.toUpperCase()} · {p.side.toUpperCase()}
                    </div>
                    <div>{p.ticker}</div>
                    {p.order_id && <div>order {p.order_id}</div>}
                    {p.tif_downgraded && (
                      <div>Exchange rejected immediate-or-cancel — placed good-till-cancelled, so any unfilled remainder is RESTING at {cents(p.price_dollars)}. "Cancel my app orders" pulls it.</div>
                    )}
                    {p.state && (
                      <div>
                        status {p.state.status}
                        {p.state.filled !== null && ` · filled ${p.state.filled}`}
                        {p.state.remaining ? ` · ${p.state.remaining} still resting` : ""}
                      </div>
                    )}
                  </div>
                ))}
                {(body?.errors?.length ?? 0) > 0 && body?.errors?.map((e) => (
                  <div key={e.client_order_id} style={{ color: "var(--neg)", fontSize: 11.5 }}>
                    {e.ticker}: {e.message}
                  </div>
                ))}
                {!dry && (
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>
                    Your book strip picks this up on its next poll.
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontWeight: 800, color: "var(--neg)" }}>
                  Not placed.
                </div>
                <div style={{ color: "var(--text)" }}>{placeErrorText(body ?? {})}</div>
                {body?.rejected?.map((r) => r.book && (
                  <div key={r.client_order_id} style={{ color: "var(--muted)", fontSize: 11.5 }}>
                    {r.ticker} — live book: bid {r.book.yes_bid ?? "—"} / ask {r.book.yes_ask ?? "—"}
                  </div>
                ))}
                <div style={{ color: "var(--muted)", fontSize: 11 }}>
                  Close this, hit Refresh, and re-read the row at the new price.
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          {!resp && (
            <button type="button" className="ui-btn" data-on="true" onClick={send}
                    disabled={busy}
                    style={{ flex: 1, padding: "9px 12px", fontWeight: 800 }}>
              {busy ? "Sending…" : dry ? "Confirm (dry run)" : "Confirm"}
            </button>
          )}
          <button type="button" className="ui-btn" onClick={onClose}
                  style={{ flex: resp ? 1 : "none", padding: "9px 12px" }}>
            {resp ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
