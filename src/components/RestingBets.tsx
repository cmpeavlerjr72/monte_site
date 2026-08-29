// src/components/RestingBets.tsx
//
// THE RESTING-BETS BLOCK — the orders we already have, re-read.
//
// It sits ABOVE the ranked index in the owner console, because the two answer
// different questions and only one of them is time-critical:
//
//   RESTING BETS   money already committed, on a clock. Something may need
//                  doing to it RIGHT NOW — and until this block existed, the
//                  app said nothing about it at all: the suggestions compute
//                  excludes every held or resting ticker, so resting an order
//                  made the app go silent about that market forever.
//   THE INDEX      discovery. Which game has the next bet on it.
//
// One row per resting order this app placed, one VERDICT chip each, the market
// state (rest / ask / sim, one unit) on the row, the derivation behind it in
// the tap popover. The verdicts and their thresholds are computed
// in `src/lib/restingReview.ts`, off the SHARED band constants in
// suggestedBets.ts — this file renders, it never decides.
//
// ---------------------------------------------------------------------------
// COLOUR, and why each channel is the honest one here
// ---------------------------------------------------------------------------
//   CONVERT  --mode-take    it is a statement about EXECUTION MODE: stop being
//                           a maker on this market, become a taker.
//   HOLD     --mode-rest    the same channel, the other value: stay resting.
//   PULL     --neg          not a mode. PULL means the sim edge AT OUR OWN
//                           PRICE is ≤ 0, which is literally an edge SIGN — the
//                           one thing --pos/--neg are allowed to mean here.
//   —        muted          unpriced. Not a verdict, so it gets no channel.
// Every chip is direct-labelled in words, so identity never rests on colour.

import { useState } from "react";
import DryRunBadge from "./DryRunBadge";
import CancelConfirm from "./CancelOrder";
import { cents, signed } from "./SuggestedBets";
import {
  convertLostBoth, convertOrder, newIdempotencyKey, placeErrorText,
  type ConvertResponse,
} from "../lib/placeOrders";
import { timeToKickText, timingWords } from "../lib/suggestedBets";
import { pullIsInSight, type RestingReview, type RestingRow } from "../lib/restingReview";

/* --------------------------------- clock ---------------------------------- */
/** "8:30 PM", the viewer's own clock — the same short form `kickText` prints a
 *  kickoff in, so a pull time and a kickoff on the same screen read alike. */
const clockAt = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/* --------------------------------- money ---------------------------------- */
/**
 * Exact dollars. The rest of this block prints in CENTS because everything else
 * here is a per-contract price or edge; the exposure is the one thing measured
 * in the money actually at stake, so it gets the dollar register — the same one
 * the My Book strip uses for the same two numbers.
 */
const usd = (v: number): string => `$${v.toFixed(2)}`;
/** Whole dollars where there are no cents, so a round $20 payout is not "$20.00". */
const usdTrim = (v: number): string =>
  Math.abs(v - Math.round(v)) < 0.005 ? `$${Math.round(v)}` : usd(v);

/* ------------------------------ the verdict ------------------------------- */

/**
 * Why this row is a HOLD, in four words — the half of the chip that the
 * horizon does not occupy. There are exactly two ways to reach HOLD (see the
 * verdict ladder in restingReview.ts) and they are not the same sentence: with
 * an ask on the book, crossing is possible and simply is not worth its fee;
 * with no ask there is nothing to cross at all. Printing "take costs more than
 * the edge" over an empty book would be a false statement about a market.
 */
const holdWhy = (row: RestingRow): string =>
  row.ask === null ? "nothing offered to cross" : "take costs more than the edge";

/** The chip. ONE element carrying the whole verdict — the word, and the number
 *  that made it, when there is one. */
function VerdictChip({ row }: { row: RestingRow }) {
  const base = {
    fontSize: 10.5, fontWeight: 900, padding: "2px 7px", borderRadius: 999,
    whiteSpace: "nowrap", letterSpacing: 0.2, flex: "none",
  } as const;
  switch (row.verdict) {
    case "CONVERT":
      return (
        <span style={{ ...base, background: "var(--mode-take)", color: "var(--mode-take-ink)" }}>
          CONVERT · {signed(row.takeEdge ?? 0)} take
        </span>
      );
    case "HOLD":
      // A RECOMMENDATION, not a state. "HOLD" alone reads as a label on the
      // row's condition; the words say what to do and the one number says what
      // the rest is worth if it fills — which is the number that makes leaving
      // it working the right call. The derivation stays in the popover.
      //
      // NEAR THE PULL the number changes, because the fact that matters
      // changes. "HOLD — rest is still right · +4.2¢" was technically true on
      // an order 40 minutes from its automatic kick−30 cancel, and it hid the
      // terminal half: holding it does not mean waiting for a fill, it means
      // waiting for the chain to take it off the book. So inside the ≤3h bands
      // the chip spends its one number on the HORIZON instead of the edge —
      // the edge is still stated quantitatively in the popover, where a
      // derivation belongs, and the horizon is not stated anywhere else.
      //
      // The verdict itself is unchanged: this is the same HOLD, said with the
      // thing a reader has to know about it.
      if (pullIsInSight(row)) {
        // The horizon wording is ~55 characters, which is 330px of nowrap pill
        // on a 266px line — measured, and it ran off the left edge of the card
        // clipping the pull time itself, i.e. losing exactly the fact this
        // change exists to show. So THIS variant wraps inside its pill (the
        // short one still cannot, and still must not).
        return (
          <span style={{
            ...base, display: "inline-block", whiteSpace: "normal",
            lineHeight: 1.35, textAlign: "right", borderRadius: 12,
            background: "var(--mode-rest)", color: "var(--mode-rest-ink)",
          }}>
            {/* Each half is nowrap, so the ONE break the pill is allowed
                lands on the separator. Left to itself the browser broke
                "auto-pulls" in the middle, which turns the horizon into two
                fragments of a word. */}
            <span style={{ whiteSpace: "nowrap" }}>HOLD — {holdWhy(row)} ·</span>{" "}
            <span style={{ whiteSpace: "nowrap" }}>
              {row.pullDue ? "auto-pull is due now" : `auto-pulls ${clockAt(row.pullAtMs as number)}`}
            </span>
          </span>
        );
      }
      return (
        <span style={{ ...base, background: "var(--mode-rest)", color: "var(--mode-rest-ink)" }}>
          HOLD — rest is still right{row.restEdge === null ? "" : ` · ${signed(row.restEdge)}`}
        </span>
      );
    case "PULL":
      return (
        <span style={{ ...base, background: "var(--neg)", color: "var(--card)" }}>
          PULL — edge gone
        </span>
      );
    default:
      return (
        <span style={{
          ...base, background: "var(--fill)", color: "var(--muted)",
          border: "1px dashed var(--border)",
        }}>
          — no sim price
        </span>
      );
  }
}

/** The loud count for the index header. Rendered even when the card is
 *  collapsed: an action that is only visible behind a disclosure triangle is
 *  an action nobody takes. */
export function RestingBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      title={`${n} resting order${n === 1 ? "" : "s"} needs a decision — convert it or pull it`}
      style={{
        fontSize: 10, fontWeight: 900, letterSpacing: 0.3,
        padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
        background: "var(--mode-take)", color: "var(--mode-take-ink)",
      }}
    >
      {n} need action
    </span>
  );
}

/* -------------------------------- the block ------------------------------- */

export default function RestingBets({
  review, token, ordersLive, quotedAt, onOpenGame,
}: {
  review: RestingReview;
  token: string;
  ordersLive: boolean;
  /** When the page compute last ran — the slip quotes it, as the bets slip does. */
  quotedAt: Date;
  /** Jump to the game a row is on. */
  onOpenGame: (cardKey: string) => void;
}) {
  /** Which row's popover is open, and what it is showing. */
  const [pop, setPop] = useState<{ id: string; mode: "info" | "cancel" } | null>(null);
  /** The convert slip. `idem` is minted ONCE per opening, so a double-tap on
   *  Confirm replays server-side across the WHOLE two-step instead of
   *  cancelling twice or taking twice. */
  const [slip, setSlip] = useState<{ row: RestingRow; idem: string } | null>(null);
  /** Orders this session has confirmed gone. The next portal poll is the truth;
   *  this only stops a pulled row sitting there looking actionable for 30s. */
  const [gone, setGone] = useState<Set<string>>(new Set());

  const rows = review.rows.filter((r) => !gone.has(r.orderId));
  if (!rows.length && !review.notOurs && !review.postKick) return null;

  const need = rows.filter((r) => r.verdict === "CONVERT" || r.verdict === "PULL").length;

  return (
    <section style={{
      border: `1px solid ${need ? "var(--mode-take)" : "var(--border)"}`,
      borderRadius: 10, padding: 8, display: "grid", gap: 6,
      background: "var(--fill)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--brand-text)" }}>
          Resting bets ({rows.length})
        </span>
        <RestingBadge n={need} />
        {!ordersLive && <DryRunBadge title="Order entry is staged: converting runs the full path, cancels nothing and submits nothing." />}
      </div>

      <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.5 }}>
        Orders this app has working. They are excluded from the suggestions
        below — a resting rung has already taken its ladder slot — so this is
        the only place they are re-priced.
      </div>

      {rows.map((r) => {
        const on = pop?.id === r.orderId;
        return (
          <div key={r.orderId}>
            <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
              <button
                type="button"
                onClick={() => setPop(on && pop?.mode === "info" ? null : { id: r.orderId, mode: "info" })}
                aria-expanded={on}
                style={{
                  flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                  // minmax(0,1fr), not the default `auto`: a grid track sized
                  // to min-content cannot shrink, and one nowrap chip inside it
                  // would push the whole owner console past a 390px screen
                  // (measured 410px of scrollWidth before this).
                  display: "grid", gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 3, padding: "7px 8px", borderRadius: 7,
                  border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                  background: "var(--card)", color: "var(--text)",
                  font: "inherit", fontSize: 12,
                }}
              >
                {/* TWO LINES, laid out like the index rows above: the words on
                    the left, THE VERDICT right-aligned in a column of its own,
                    so every row's verdict lands at the same x and the eye reads
                    the column instead of hunting mid-row. */}
                <span style={{
                  fontWeight: 700, lineHeight: 1.25, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {r.label}
                </span>
                {/* WRAPS rather than truncates. The chip is nowrap by design, so
                    on a 390px screen a nowrap context next to it ellipsised down
                    to "20 …" — a number-shaped noise. Wrapping puts the chip on
                    its own right-aligned line instead, and the context stays
                    readable. */}
                <span style={{
                  display: "flex", alignItems: "center", gap: 6,
                  minWidth: 0, flexWrap: "wrap", rowGap: 3,
                }}>
                  {/* The rest's own economics, then THE MARKET STATE, then the
                      clock. The three prices sit together in the same unit so
                      the market's position between our rest and the sim reads
                      directly (owner ask 2026-08-29: a HOLD chip alone left
                      them "in the dark as to state of the market"): rest 42¢ ·
                      ask 51¢ · sim 58¢ says at a glance how far the book is
                      from filling us and how close it is to a CONVERT. "wins
                      $X" is what {count} @ {price} pays if it fills and
                      settles our way — the same identity the My Book strip
                      prints, on the same scope (the REMAINING order; anything
                      already filled is a held position and is counted there). */}
                  <span style={{ fontSize: 10.5, color: "var(--muted)", minWidth: 0 }}>
                    {r.count} resting @ {cents(r.restPrice)}
                    {" · "}{r.ask === null ? "no ask" : `ask ${cents(r.ask)}`}
                    {" · "}sim {r.simP === null ? "—" : cents(r.simP)}
                    {" · "}wins {usdTrim(r.restWin)}
                    {" · "}{timeToKickText(r.timing.msToKick)}
                  </span>
                  {/* `0 1 auto` + minWidth 0, not `none`: a chip that cannot
                      shrink cannot wrap either, and the horizon wording is
                      wider than this line. Shrinking only ever costs the
                      wrappable variant a second line — the nowrap ones are
                      narrower than the track and are untouched. */}
                  <span style={{ marginLeft: "auto", flex: "0 1 auto", minWidth: 0 }}>
                    <VerdictChip row={r} />
                  </span>
                </span>
              </button>
              <div style={{ display: "grid", gap: 3, flex: "none", width: 68 }}>
                <button
                  type="button" className="ui-btn"
                  data-on={r.verdict === "CONVERT" ? "true" : "false"}
                  disabled={r.ask === null}
                  title={r.ask === null
                    ? "Nothing is offered on this side right now, so there is nothing to cross"
                    : `Cancel the rest and take at ${cents(r.ask)}`}
                  onClick={() => setSlip({ row: r, idem: newIdempotencyKey() })}
                  style={{
                    padding: "2px 0", fontSize: 10.5, fontWeight: 800,
                    opacity: r.ask === null ? 0.45 : 1,
                    cursor: r.ask === null ? "not-allowed" : "pointer",
                  }}
                >
                  Convert
                </button>
                <button
                  type="button" className="ui-btn"
                  onClick={() => setPop({ id: r.orderId, mode: "cancel" })}
                  title="Pull this resting order off the book"
                  style={{ padding: "2px 0", fontSize: 10.5, fontWeight: 700 }}
                >
                  Cancel
                </button>
              </div>
            </div>

            {on && (
              <div style={{
                margin: "4px 0 5px", padding: "7px 9px", fontSize: 11.5,
                lineHeight: 1.5, color: "var(--text)", background: "var(--card)",
                border: "1px solid var(--brand)", borderRadius: 7,
                display: "grid", gap: 4,
              }}>
                {pop?.mode === "cancel" ? (
                  <CancelConfirm
                    token={token}
                    orderId={r.orderId}
                    label={r.label}
                    onCancelled={(id) => setGone((s) => new Set(s).add(id))}
                    onDismiss={() => setPop(null)}
                  />
                ) : (
                  <>
                    <div style={{ fontWeight: 700 }}>{r.reason}</div>
                    {/* The quantitative reason above says why holding is right.
                        This says how long "holding" lasts — the terminal fact a
                        HOLD chip on its own never carried. */}
                    {r.verdict === "HOLD" && (
                      <div style={{ color: "var(--muted)" }}>
                        Unfilled orders are pulled automatically 30 min before kick
                        {r.pullAtMs === null
                          ? "."
                          : r.pullDue
                            ? " — this one is already past that mark, so the next sweep takes it."
                            : ` — this one at ${clockAt(r.pullAtMs)}.`}
                      </div>
                    )}
                    <div style={{ color: "var(--muted)" }}>{timingWords(r.timing)}</div>
                    {/* ITEMISED, in the order the money moves: payout, stake,
                        fee. The fee is named separately because it is outside
                        the stake — folding it in would break the identity the
                        row's "wins" number is read against. */}
                    <div style={{ color: "var(--muted)" }}>
                      Settles at {usd(r.count)} if it fills and goes our way —
                      {" "}{usd(r.restStake)} staked, so it wins {usd(r.restWin)}.
                      {" "}{r.restFee ? `Maker fee on the fill: ${usd(r.restFee)}.`
                                      : "No maker fee on this series, and nothing is charged until it fills."}
                    </div>
                    <div style={{ color: "var(--muted)" }}>
                      Resting {r.count} at {cents(r.restPrice)} ·
                      {" "}{r.ask === null ? "nothing offered to cross" : `crossing costs ${cents(r.ask)}`}
                      {r.takeFeePer !== null &&
                        ` · taker fee ${(r.takeFeePer * 100).toFixed(1)}¢/contract`}
                      {" · "}fee type {r.feeType}
                      {r.bookFrom && ` · book from the ${r.bookFrom === "feed" ? "45s slate feed" : "portal read"}`}
                    </div>
                    <div style={{ color: "var(--muted)" }}>
                      Sim fair {r.simP === null ? "—" : `${Math.round(r.simP * 100)}%`} ·
                      {" "}rest edge {r.restEdge === null ? "—" : signed(r.restEdge)} ·
                      {" "}take edge {r.takeEdge === null ? "—" : signed(r.takeEdge)}
                      {" · "}{r.teamB} @ {r.teamA}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="ui-btn" onClick={() => onOpenGame(r.cardKey)}
                              style={{ padding: "2px 9px", fontSize: 10.5, fontWeight: 700 }}>
                        Go to the game →
                      </button>
                      <button type="button" className="ui-btn" onClick={() => setPop(null)}
                              style={{ padding: "2px 9px", fontSize: 10.5 }}>
                        Close
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* What this block is NOT reviewing, in words. A row that quietly is not
          here is how a review becomes a false all-clear. */}
      {(review.postKick > 0 || review.notOurs > 0) && (
        <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.5 }}>
          {review.postKick > 0 && (
            <div>
              {review.postKick} resting order{review.postKick === 1 ? "" : "s"} on
              {" "}game{review.postKick === 1 ? "" : "s"} that {review.postKick === 1 ? "is" : "are"}
              {" "}no longer pregame — our fairs there are wrong, so they are not
              re-priced here. The pre-kickoff chain pulls them at kick−30.
            </div>
          )}
          {review.notOurs > 0 && (
            <div>
              {review.notOurs} resting order{review.notOurs === 1 ? "" : "s"} not
              placed by this app (the maker pipeline's, or your own) — visible in
              your book, never actionable from here.
            </div>
          )}
        </div>
      )}

      {slip && (
        <ConvertSlip
          row={slip.row}
          idem={slip.idem}
          token={token}
          ordersLive={ordersLive}
          quotedAt={quotedAt}
          onGone={(id) => setGone((s) => new Set(s).add(id))}
          onClose={() => setSlip(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------ convert slip ------------------------------ */
/**
 * The bet, the price, the fee, the edge — then Confirm. Same shape as the bets
 * panel's ConfirmSlip, deliberately: this is the second thing in the app that
 * can move real money and it must not feel like a different app.
 *
 * WHAT IS DIFFERENT, and why it is said out loud:
 *   - it is TWO steps, and the second can fail on its own. The server reports
 *     the composite state (`cancelled_not_placed`) and this slip prints it as
 *     the loudest thing on screen, because the owner then has NO order on that
 *     market and needs to know before he closes the popup.
 *   - the price is a HARD BOUND. The server re-reads the book and refuses if
 *     the crossing price has got worse, leaving the rest exactly where it is.
 *   - in staged mode NOTHING is cancelled. A dry run that pulled a real order
 *     while placing nothing would leave the book strictly worse off.
 */
function ConvertSlip({
  row, idem, token, ordersLive, quotedAt, onGone, onClose,
}: {
  row: RestingRow;
  idem: string;
  token: string;
  ordersLive: boolean;
  quotedAt: Date;
  onGone: (orderId: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<{ status: number; body: ConvertResponse } | null>(null);

  const ask = row.ask;
  const send = async () => {
    if (ask === null) return;
    setBusy(true);
    try {
      const r = await convertOrder(token, idem, {
        order_id: row.orderId,
        ticker: row.ticker,
        side: row.side,
        count_fp: row.count,
        limit_price: ask,
      });
      setResp(r as { status: number; body: ConvertResponse });
      // The rest is gone in BOTH good outcomes — converted, or cancelled with
      // the take refused. Either way the row as it stands is stale.
      const b = (r.body ?? {}) as ConvertResponse;
      if (!b.dry_run && (b.cancel?.ok || b.error === "cancelled_not_placed" ||
                         b.error === "cancelled_nothing_left")) {
        onGone(row.orderId);
      }
    } catch {
      setResp({ status: 0, body: { error: "network", detail: "Request failed — nothing was sent." } });
    } finally {
      setBusy(false);
    }
  };

  const body = resp?.body;
  const dry = body?.dry_run ?? !ordersLive;
  const ok = resp !== null && resp.status === 200 && !body?.error;
  const lostBoth = body ? convertLostBoth(body) : false;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Convert resting order to a take"
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
            {resp ? "Result" : "Convert this rest to a take"}
          </span>
          {dry && <DryRunBadge title="CFB_ORDERS_LIVE is not set — nothing is cancelled and nothing is submitted." />}
        </div>

        {!resp && (
          <>
            <div style={{
              border: "1px solid var(--border)", borderRadius: 9, padding: "8px 10px",
              display: "grid", gap: 5, fontSize: 12,
            }}>
              <div style={{ fontWeight: 800 }}>{row.label}</div>
              <div style={{ color: "var(--muted)" }}>
                {row.count} contract{row.count === 1 ? "" : "s"} still working at
                {" "}{cents(row.restPrice)} — cancelled, then bought at
                {" "}<strong style={{ color: "var(--text)" }}>{ask === null ? "—" : cents(ask)}</strong>.
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: "var(--muted)" }}>
                  ${((ask ?? 0) * row.count).toFixed(2)} + ${(row.takeFee ?? 0).toFixed(2)} taker fee
                  {" = "}<strong style={{ color: "var(--text)" }}>${(row.takeOutlay ?? 0).toFixed(2)}</strong>
                </span>
                <span style={{
                  marginLeft: "auto", fontWeight: 800, whiteSpace: "nowrap",
                  color: (row.takeEdge ?? 0) > 0 ? "var(--pos)" : "var(--neg)",
                }}>
                  {signed(row.takeEdge ?? 0)} net
                </span>
              </div>
            </div>

            <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5, display: "grid", gap: 4 }}>
              <div>{row.reason}</div>
              <div>
                {ask === null ? "" : `${cents(ask)} is a HARD BOUND: `}
                the server re-reads the live book first and refuses if crossing
                has got more expensive — the rest is then left exactly where it
                is. Prices as of {quotedAt.toLocaleTimeString()}.
              </div>
              <div>
                Two steps, one press: the rest is cancelled and CONFIRMED
                cancelled before the take is sent. If the take is then refused,
                you will have no order on this market — it will say so, and the
                ticker comes back as a normal suggestion on the next compute.
              </div>
              {dry && (
                <div>
                  Staged mode. Confirming runs the whole path — password, caps, a
                  fresh read of the book, the audit log — and cancels nothing.
                </div>
              )}
            </div>
          </>
        )}

        {resp && (
          <div style={{ display: "grid", gap: 7, fontSize: 12 }}>
            {lostBoth && (
              <div style={{
                padding: "8px 10px", borderRadius: 9, fontWeight: 800,
                border: "2px solid var(--neg)", color: "var(--neg)",
                background: "color-mix(in oklab, var(--neg) 10%, var(--card))",
              }}>
                Rest cancelled, take NOT placed. You have no order on this
                market right now. It is unheld, so it will reappear as a normal
                suggestion on the next compute — place it there if you still
                want it.
              </div>
            )}
            {ok ? (
              <>
                <div style={{ fontWeight: 800, color: dry ? "var(--text)" : "var(--pos)" }}>
                  {dry
                    ? "Validated — the rest was NOT cancelled and nothing was submitted."
                    : "Converted: the rest was cancelled and the take went in."}
                  {body?.replayed && " (replay of the same press — nothing happened twice.)"}
                </div>
                {(dry ? body?.would_place : body?.placed)?.map((p) => (
                  <div key={p.client_order_id} style={{
                    border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px",
                    color: "var(--muted)", fontSize: 11.5,
                  }}>
                    <div style={{ color: "var(--text)", fontWeight: 700 }}>
                      {p.count} @ {cents(p.price_dollars)} · TAKE · {p.side.toUpperCase()}
                    </div>
                    <div>{p.ticker}</div>
                    {p.order_id && <div>order {p.order_id}</div>}
                    {p.tif_downgraded && (
                      <div>
                        Exchange rejected immediate-or-cancel — placed
                        good-till-cancelled, so any unfilled remainder is RESTING
                        at {cents(p.price_dollars)}.
                      </div>
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
                {!dry && (
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>
                    Your book strip picks this up on its next poll.
                  </div>
                )}
              </>
            ) : (
              <>
                {!lostBoth && (
                  <div style={{ fontWeight: 800, color: "var(--neg)" }}>
                    {body?.cancel?.ok ? "Only half done." : "Not converted — your rest is untouched."}
                  </div>
                )}
                <div style={{ color: "var(--text)" }}>
                  {body?.detail || placeErrorText(body ?? {})}
                </div>
                {body?.book && (
                  <div style={{ color: "var(--muted)", fontSize: 11.5 }}>
                    Live book: yes bid {body.book.yes_bid ?? "—"} / yes ask {body.book.yes_ask ?? "—"}
                  </div>
                )}
                {body?.errors?.map((e, i) => (
                  <div key={e.client_order_id ?? i} style={{ color: "var(--muted)", fontSize: 11.5 }}>
                    {e.ticker}: {e.message}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          {!resp && (
            <button type="button" className="ui-btn" data-on="true" onClick={send}
                    disabled={busy || ask === null}
                    style={{
                      flex: 1, padding: "9px 12px", fontWeight: 800,
                      opacity: ask === null ? 0.5 : 1,
                      cursor: ask === null ? "not-allowed" : "pointer",
                    }}>
              {busy ? "Working…" : dry ? "Confirm (dry run)" : `Confirm · take ${row.count} @ ${ask === null ? "—" : cents(ask)}`}
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
