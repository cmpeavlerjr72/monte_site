// src/components/SuggestedBets.tsx
//
// The per-game BETS PANEL — and, since 2026-08-28, the ONE surface in this app
// that can place a real order.
//
// ---------------------------------------------------------------------------
// Where this sits now (restructured 2026-08-28)
// ---------------------------------------------------------------------------
// The owner surface is two halves, because it answers two different questions:
//
//   WHICH GAME?   `SuggestedBetsIndex`, one slim ranked row per game in the My
//                 Book console. Discovery is cross-game, so it stays at the top
//                 of the page. It places nothing — it is a to-do list.
//   THIS GAME.    THIS FILE, opened as the "Bets" tab on a game card, right
//                 next to that game's projections. Deciding and placing is
//                 per-game, so the ladders, the fees, the sizing and the
//                 confirm slip live beside the chart they came from.
//
// Both read ONE compute (`src/lib/useSuggestions.ts`, called once in
// Scoreboard) under ONE set of filters, so the index count, the tab badge and
// the rows below can never disagree.
//
// A third, narrower surface lives here too: `PlaceStrip`, the one-line bet bar
// that rides above a PROJECTION panel after "See projection →". It is the same
// bet, the same confirm slip and the same rails — reached from the chart
// instead of from the list, because deciding while looking at the shape is the
// whole point of jumping there. It never prices anything itself: it looks the
// ladder up live by id and degrades to a sentence when it is gone.
//
// `scripts/fbs_maker_pipeline.py` in cfb-props-sim remains the AUTOMATED
// placement authority and stays post-only-only. This panel is the
// HUMAN-CONFIRMED path: it mirrors the pipeline's selection constants so the
// same conclusions can be read on a phone, and a Place button turns one into
// an order after an explicit confirm. If the two ever disagree on SELECTION,
// the pipeline is right and this file is the bug.
//
// ---------------------------------------------------------------------------
// AND THE ORDERS ALREADY WORKING: the resting-bets review
// ---------------------------------------------------------------------------
// This surface only ever speaks about markets the account is NOT in — the
// compute excludes every held or resting ticker, because a resting rung has
// already consumed its ladder slot. That left a hole the size of the pipeline's
// central doctrine: a maker order is supposed to BECOME a taker as kickoff
// approaches (far out, resting is fine; a few hours out the take bar drops;
// inside the last hour there is no resting at all, because the pre-kickoff
// chain cancels every unfilled quote at kick−30) — and nothing in the app ever
// said so, because the moment an order rested, that market went quiet.
//
// `src/lib/restingReview.ts` + `src/components/RestingBets.tsx` are the HUMAN
// PATH FOR THAT DOCTRINE: one row per resting order this app placed, one
// verdict — CONVERT / HOLD / PULL — off the SAME timing bands, the same fees
// and the same pregame gate as the rows below, imported from suggestedBets.ts
// and never restated. The block sits above the index in the owner console,
// because money already committed outranks discovery.
//
// The selection constants here still mirror the pipeline. The review's
// thresholds ARE those constants — there is no third opinion anywhere.
//
// ---------------------------------------------------------------------------
// Zero new Kalshi load
// ---------------------------------------------------------------------------
// Everything is computed from quotes ALREADY flowing through the page's
// /api/kalshi/cfb poll (45s TTL, bulk series paging). No orderbook-depth
// calls, no per-market fan-out, and opening a panel fetches NOTHING: the rows
// are a slice of a compute the page already ran. Because that compute is a
// pure function of the feed, it re-runs whenever the poll delivers — live for
// free. "Refresh" (in the index header) only re-runs it against the newest
// feed the page holds.
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
// kick time has passed even if the live feed has not caught up yet. A panel
// opened on such a game says so in words rather than showing an empty list.
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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  groupLadders, orderFee, timingWords,
  MIN_MAKER_EDGE, TAKE_THRESHOLD, TAKE_THRESHOLD_LATE, TAKE_THRESHOLD_NEAR,
  TAIL_HI, TAIL_LO,
  type FeeParams, type LadderGroup, type Suggestion,
} from "../lib/suggestedBets";
import type { PregameVerdict } from "../lib/suggestedBets";
import {
  newIdempotencyKey, placeErrorText, placeOrders,
  type PlaceOrder, type PlaceResponse,
} from "../lib/placeOrders";
// One mapping, three consumers: this panel's "see projection" jump, the
// suggestions compute and the portal's held-position pricing (teamStatMarkets).
import { STAT_FOR_SERIES } from "../lib/teamStatMarkets";
// Filter state (and its persistence) lives in Scoreboard — ONE source of
// truth for the index counts, the card badges and these rows. This panel only
// reports a press.
import type { BetTypeFilter, ModeFilter } from "../lib/ownerPrefs";
import { readUnit } from "../lib/ownerPrefs";
import DryRunBadge from "./DryRunBadge";
import type { SuggestSection } from "../lib/useSuggestions";

export const cents = (v: number) => `${Math.round(v * 100)}¢`;
export const signed = (v: number) =>
  `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}¢`;
export const clock = (d: Date) => d.toLocaleTimeString();

/* ------------------------------- mode colour ------------------------------ */
// Execution mode gets its OWN categorical channel (--mode-rest / --mode-take,
// validated in theme.css). It must never borrow --pos/--neg: on this surface
// those mean the sign of an edge and nothing else, so a red "take now" would
// read as a bad bet. Every chip is also direct-labelled, so identity never
// depends on colour alone.
const modeHue = (mode: "REST" | "TAKE") =>
  mode === "REST" ? "var(--mode-rest)" : "var(--mode-take)";
const modeInk = (mode: "REST" | "TAKE") =>
  mode === "REST" ? "var(--mode-rest-ink)" : "var(--mode-take-ink)";

function ModeChip({ mode, price }: { mode: "REST" | "TAKE"; price?: number }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 900, padding: "1px 6px", borderRadius: 999,
      whiteSpace: "nowrap", letterSpacing: 0.2,
      background: modeHue(mode), color: modeInk(mode),
    }}>
      {mode}{price === undefined ? "" : ` @${cents(price)}`}
    </span>
  );
}

/**
 * The TAIL mark. Deliberately colourless — `--muted` ink on a dashed outline,
 * never `--pos`/`--neg` (edge sign) and never the mode hues. It says "we do
 * not stand behind this row", which is not a bet direction and not an
 * execution mode, so it gets neither channel.
 */
export function TailBadge({ inline = false }: { inline?: boolean }) {
  return (
    <span
      title={`Sim probability or the ask being paid is outside ${Math.round(TAIL_LO * 100)}–${Math.round(TAIL_HI * 100)}¢`}
      style={{
        fontSize: 9, fontWeight: 900, letterSpacing: 0.4,
        padding: "0 4px", borderRadius: 4, whiteSpace: "nowrap",
        border: "1px dashed var(--border)", color: "var(--muted)",
        marginRight: inline ? 5 : 0, verticalAlign: "middle",
      }}
    >
      TAIL
    </span>
  );
}

/** "Sat 3:30 PM" — enough to order a multi-day slate without a date column. */
export function kickText(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { weekday: "short" })} ` +
         `${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/* ---------------------------- chart pre-focus ------------------------------
 * "See projection" is an EXPLICIT button, never an implicit side effect of
 * tapping a row: a bet slip that silently swaps the panel underneath you is
 * how a mis-tap becomes a mis-read. A per-team stat ladder points at that
 * team's block in the Team Stats chart; a game line points at the simulated
 * scores panel, which is where winner/spread/total live. Anything we cannot
 * map (a series Kalshi added since) simply gets no button.
 *
 * THE TARGET CARRIES THE VALUE BEING PRICED, not just the chart. Landing on
 * the right block and leaving the reader to find which of eleven rungs the bet
 * was on is most of the way to nowhere: a stat target names its STRIKE and a
 * scores target names its METRIC and LINE, so the chart opens with the marker
 * already on the number the money is going onto.
 *
 * It also carries the ORIGINATING LADDER's id, which is what lets the
 * projection panel offer a place strip for that exact bet (see `PlaceStrip`).
 * The id is only ever a lookup key — the group itself is re-read live from the
 * page compute, never carried across a recompute.
 * ------------------------------------------------------------------------ */

/** The scores panel's four tabs. Mirrors `Metric` in Scoreboard.tsx. */
export type ScoreMetric = "spread" | "total" | "teamLeft" | "teamRight";

export type ProjectionTarget =
  | {
      kind: "teamstats"; team: string; stat: string;
      /** Kalshi's own integer strike ("175+" -> 175), so the chart can pick the
       *  ONE flag this bet is about out of the whole ladder. */
      strike?: number;
      groupId?: string;
    }
  | {
      kind: "scores"; metric: ScoreMetric;
      /** The line, in the axis's own convention: a home-perspective spread
       *  (−7.5 means the home team laying 7.5) or a game total. */
      line?: number;
      groupId?: string;
    };

/**
 * A ladder's stable id, and the one the panel's rows already key on.
 *
 * A tail ladder and its in-band twin share a `ladder` string (same game, same
 * family, same team) — they are two halves of one ladder split by the band —
 * so the tail half is namespaced or the two would resolve to each other.
 */
export const groupIdOf = (g: LadderGroup): string =>
  g.tail ? `tail:${g.ladder}` : g.ladder;

/**
 * Find a ladder in the CURRENT compute by id.
 *
 * Always call this against the live `useSuggestions` result at render time.
 * Holding on to a `LadderGroup` object across a recompute is how a place strip
 * would show a 45-second-old price on a game that has since kicked off.
 * Returns null when the ladder is gone — the caller says so in words.
 */
export function findGroupById(
  section: SuggestSection | undefined, id: string | undefined,
): LadderGroup | null {
  if (!section || !id) return null;
  return [...section.groups, ...section.tailGroups]
    .find((g) => groupIdOf(g) === id) ?? null;
}

export function projectionTargetFor(g: LadderGroup): ProjectionTarget | null {
  const id = groupIdOf(g);
  // The BEST rung, because that is the rung whose net edge the row prints. A
  // two-rung ladder points the chart at the number the verdict came from.
  const best = g.rungs.length
    ? g.rungs.reduce((m, r) => (r.edge > m.edge ? r : m), g.rungs[0])
    : null;
  if (!best) return null;
  if (g.family === "game") {
    switch (best.series) {
      // `strike` is the exporter's signed HOME-perspective line for a spread
      // rung and the game total for a total rung — both already in the scores
      // axis's own units, so there is nothing to convert.
      case "KXNCAAFTOTAL":
        return { kind: "scores", metric: "total", line: best.strike, groupId: id };
      case "KXNCAAFSPREAD":
        return { kind: "scores", metric: "spread", line: best.strike, groupId: id };
      // A moneyline IS the spread at pick'em: "wins" = "covers −0.5". Same
      // convention marketEdge.ts uses for its win rows, reused so the two
      // surfaces cannot drift apart.
      case "KXNCAAFGAME":
        return { kind: "scores", metric: "spread", line: -0.5, groupId: id };
      // A game family Kalshi adds later still gets the right chart, just no
      // pre-loaded line — never a wrong one.
      default:
        return { kind: "scores", metric: "spread", groupId: id };
    }
  }
  const stat = STAT_FOR_SERIES[best.series];
  const team = best.team;
  if (!stat || !team) return null;
  return { kind: "teamstats", team, stat, strike: best.strike, groupId: id };
}

/* ------------------------------- filter chips ------------------------------ */
/**
 * Mode and bet-type filters. They mutate the PAGE-LEVEL state (Scoreboard),
 * because the index counts, the card badges and these rows all read one
 * compute — a filter that only applied here would make the badge lie.
 * Persisted per browser, exactly as before.
 */
function FilterChips({
  modeFilter, onModeFilter, typeFilter, onTypeFilter,
}: {
  modeFilter: ModeFilter;
  onModeFilter: (v: ModeFilter) => void;
  typeFilter: BetTypeFilter;
  onTypeFilter: (v: BetTypeFilter) => void;
}) {
  const chip = { padding: "3px 9px", fontSize: 11, fontWeight: 700 } as const;
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }} role="group" aria-label="Execution mode filter">
        {([["all", "All"], ["rest", "Maker"], ["take", "Taker"]] as const).map(([v, label]) => (
          <button
            key={v} type="button" className="ui-btn"
            data-on={modeFilter === v ? "true" : "false"}
            onClick={() => onModeFilter(v)}
            style={chip}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Second filter row: bet TYPE, by Kalshi series family. Composes with
          the mode filter (both apply); an unrecognised future series
          (`family` null) only shows under "All", never crashes. */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }} role="group" aria-label="Bet type filter">
        {([
          ["all", "All"], ["game", "Game lines"], ["td", "TD props"],
          ["yardage", "Yardage"], ["team", "Team totals"],
        ] as const).map(([v, label]) => (
          <button
            key={v} type="button" className="ui-btn"
            data-on={typeFilter === v ? "true" : "false"}
            onClick={() => onTypeFilter(v)}
            style={chip}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- ladder rows ------------------------------- */
/**
 * One game's ladders. Real suggestions first, then — only when the toggle is
 * on — the tail band's held-out markets behind their own labelled divider.
 * ONE map, so the row markup exists once; `g.tail` is the only thing that
 * changes how it looks.
 */
function LadderRows({
  groups, tailGroups, unit, onPlace, onProject,
}: {
  groups: LadderGroup[];
  tailGroups: LadderGroup[];
  unit: number;
  onPlace: (g: LadderGroup) => void;
  onProject: (t: ProjectionTarget) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);

  return (
    <div style={{ display: "grid", gap: 5 }}>
      {[...groups, ...tailGroups].map((g, gi) => {
        // A tail ladder and its in-band twin share a `ladder` string (same
        // game, same family, same team) — they are two halves of one ladder
        // split by the band. React keys and the expand selection both need the
        // PAIR to be distinct, or ticking one opens both and React drops a row.
        const gid = g.tail ? `tail:${g.ladder}` : g.ladder;
        const on = gid === sel;
        const single = g.rungs.length === 1;
        const head = g.rungs[0];
        // Mode at a glance: the row wears a slim accent in its own
        // execution-mode hue. A ladder whose rungs disagree takes the BEST
        // rung's hue, and shows a chip for each mode anyway.
        const modes = Array.from(new Set(g.rungs.map((r) => r.mode)));
        const bestMode = g.rungs.reduce((m, r) => (r.edge > m.edge ? r : m), g.rungs[0]).mode;
        // A TAIL row keeps its number but LOSES its colour: green on an edge
        // we do not stand behind would be the panel lying in its loudest
        // channel. The badge and the muted ink say so instead.
        const edgeColor = g.tail
          ? "var(--muted)"
          : g.bestEdge > 0 ? "var(--pos)" : "var(--neg)";
        const firstTail = g.tail && gi === groups.length;
        const target = projectionTargetFor(g);
        return (
          <div key={gid}>
            {firstTail && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                margin: "5px 0 3px", fontSize: 10, color: "var(--muted)",
              }}>
                <TailBadge />
                <span>
                  sim or price outside {Math.round(TAIL_LO * 100)}–{Math.round(TAIL_HI * 100)}¢
                  {" "}— shown on request, never ranked
                </span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
              <button
                type="button"
                onClick={() => setSel(on ? null : gid)}
                style={{
                  flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                  display: "grid", gap: 3,
                  padding: "7px 8px", borderRadius: 7,
                  // A tail row is DASHED and sits on the section fill rather
                  // than the card: at a glance it reads as a provisional row,
                  // the same dotted convention the approximate-strike marks use.
                  border: `1px ${g.tail ? "dashed" : "solid"} ${on ? "var(--brand)" : "var(--border)"}`,
                  borderLeft: `4px solid ${g.tail ? "var(--border)" : modeHue(bestMode)}`,
                  background: g.tail ? "var(--fill)" : "var(--card)",
                  color: g.tail ? "var(--muted)" : "var(--text)",
                  font: "inherit", fontSize: 12,
                }}
              >
                {/* TWO FIXED LINES, always in the same order: the bet in
                    words, then chip / sizing / edge. The edge is the last
                    thing on line 2 in a column of its own, so every row's
                    number lands at the same x. */}
                <span style={{ fontWeight: 700, lineHeight: 1.25 }}>
                  {g.tail && <TailBadge inline />}
                  {single ? head.label : g.headline}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {single
                    ? <ModeChip mode={head.mode} price={head.price} />
                    : modes.map((m) => <ModeChip key={m} mode={m} />)}
                  <span style={{
                    fontSize: 10.5, color: "var(--muted)", minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {single
                      ? `${head.count} @ ${cents(head.price)} · $${head.outlay.toFixed(2)}`
                      : `${g.rungs.length} rungs · $${g.each} each`}
                  </span>
                  <span style={{
                    marginLeft: "auto", flex: "none", fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    color: edgeColor,
                  }}>
                    {g.bestEdge >= TARGET_EDGE && (
                      <span style={{ color: "#f0b429" }} title={TARGET_TITLE}>★ </span>
                    )}
                    {signed(g.bestEdge)}
                  </span>
                </span>
              </button>
              {/* Every mode gets a Place button. A REST rung rests post-only;
                  a TAKE rung is a LIMIT order at this exact price — never a
                  market order (user decision 2026-08-28). A ladder's rungs go
                  as ONE request. */}
              <button
                type="button"
                className="ui-btn"
                onClick={() => onPlace(g)}
                title={`Place ${g.rungs.length} order${g.rungs.length === 1 ? "" : "s"}`}
                style={{
                  // Fixed width, so the edge column above it lines up across
                  // every row of the panel.
                  width: 62, flex: "none", padding: 0,
                  fontSize: 11, fontWeight: 800,
                }}
              >
                Place
              </button>
            </div>

            {/* The chart this bet came out of, one tap away and NAMED. The
                "Bets" tab stays visible above the panel, so getting back is
                the button you just came from — no back-plumbing. */}
            {target && (
              <div style={{ display: "flex", marginTop: 2 }}>
                <button
                  type="button" className="ui-btn"
                  onClick={() => onProject(target)}
                  title={target.kind === "teamstats"
                    ? `Show ${target.team}'s simulated distribution with the ${target.strike}+ market marked`
                    : `Show the simulated score distribution${
                        target.line === undefined ? "" : ` with ${target.line} marked`}`}
                  style={{ padding: "1px 8px", fontSize: 10.5, fontWeight: 700 }}
                >
                  See projection →
                </button>
              </div>
            )}

            {on && (
              <div style={{
                margin: "4px 0 5px", padding: "6px 8px", fontSize: 11.5,
                lineHeight: 1.5, color: "var(--text)",
                background: "var(--card)", border: "1px solid var(--brand)",
                borderRadius: 7,
              }}>
                {g.tail && (
                  <div style={{ color: "var(--muted)", marginBottom: 4 }}>
                    Held out of the list: the sim, the ask, or both sit
                    outside {Math.round(TAIL_LO * 100)}–{Math.round(TAIL_HI * 100)}¢.
                    That is where our own model is least trusted and where a
                    thin book misprices hardest, so the edge above is printed
                    without a verdict colour.
                  </div>
                )}
                {/* TIME CONTEXT, in words. The mode chip already says REST or
                    TAKE; this says why that bar was the bar. */}
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>
                  {timingWords(g.timing)}
                </div>
                {single ? (
                  <>
                    Sim {Math.round(head.simP * 100)}% · price {cents(head.price)} ·
                    fee {(head.fee * 100 / Math.max(head.count, 1)).toFixed(1)}¢/contract
                    {" "}({head.fee.toFixed(2)} total) · net edge {signed(head.edge)}
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>
                      {head.count} contracts, outlay ${head.outlay.toFixed(2)} of ${unit}
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
                        {/* A stat rung is "225+"; a game line is "−7.5" or
                            "Over 48.5", which the builder supplies. */}
                        <span style={{ fontWeight: 700 }}>
                          {rr.rungText ?? `${rr.strike}+`}
                        </span>
                        <ModeChip mode={rr.mode} price={rr.price} />
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
                      ${unit} ladder, ${g.each} per rung
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
  );
}

/* =============================== the panel ================================ */
/**
 * ONE GAME's suggested bets, opened from that game's card. Everything money
 * happens here: the ladders, the sizing, the fee itemisation and the confirm
 * slip. The index above only ranks.
 */
/* ------------------------------ rung wheel -------------------------------- */
/** Fixed wheel-item width. The container pads `calc(50% - ITEM_W/2)` on both
 *  ends, so item i sits dead-centre exactly at scrollLeft = i * ITEM_W —
 *  which is what makes the scroll→selection arithmetic a one-liner. */
const WHEEL_ITEM_W = 58;

/**
 * The roller wheel (owner ask 2026-08-30): strikes roll left/right with
 * scroll-snap; the CENTERED strike is the selection, and the readout under
 * the wheel shows that rung's mode@price, sim value and net edge, with the
 * Place button. Opens centred on the best non-tail edge, so the wheel's
 * resting position is already the most interesting strike.
 */
function RungWheel({ rungs, onPlace }: {
  rungs: Suggestion[];
  onPlace: (r: Suggestion) => void;
}) {
  const bestIdx = useMemo(() => {
    let bi = 0, be = -Infinity;
    rungs.forEach((r, i) => {
      if (!r.tail && r.edge > be) { be = r.edge; bi = i; }
    });
    return be === -Infinity ? Math.floor(rungs.length / 2) : bi;
  }, [rungs]);
  const [sel, setSel] = useState(bestIdx);
  const ref = useRef<HTMLDivElement>(null);

  // Centre the best rung on mount (instant, not smooth — it is the wheel's
  // resting position, not an animation).
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = bestIdx * WHEEL_ITEM_W;
    setSel(bestIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestIdx, rungs.length]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.min(rungs.length - 1,
      Math.max(0, Math.round(el.scrollLeft / WHEEL_ITEM_W)));
    if (i !== sel) setSel(i);
  };
  const spinTo = (i: number) =>
    ref.current?.scrollTo({ left: i * WHEEL_ITEM_W, behavior: "smooth" });

  const r = rungs[Math.min(sel, rungs.length - 1)];
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div
        ref={ref}
        className="rung-wheel"
        onScroll={onScroll}
        role="listbox"
        aria-label="strike values"
        style={{
          display: "flex", overflowX: "auto",
          scrollSnapType: "x mandatory",
          padding: `2px calc(50% - ${WHEEL_ITEM_W / 2}px)`,
        }}
      >
        {rungs.map((x, i) => (
          <button
            key={x.key} type="button" role="option" aria-selected={i === sel}
            onClick={() => spinTo(i)}
            style={{
              flex: "none", width: WHEEL_ITEM_W, scrollSnapAlign: "center",
              background: "none", border: "none", cursor: "pointer",
              padding: "2px 0", display: "grid", gap: 2, justifyItems: "center",
              fontVariantNumeric: "tabular-nums",
              fontWeight: i === sel ? 800 : 600,
              fontSize: i === sel ? 13 : 11.5,
              color: i === sel
                ? "var(--text)"
                : x.tail ? "var(--muted)" : "var(--muted)",
              opacity: i === sel ? 1 : 0.75,
              transition: "font-size 120ms, opacity 120ms",
            }}
          >
            <span>{x.rungText ?? x.label}</span>
            {/* The edge hint under every value: where the money is while
                rolling. Muted for tails — the wheel never colours an edge
                the model does not stand behind. */}
            <span aria-hidden="true" style={{
              width: 18, height: 3, borderRadius: 2,
              background: x.tail
                ? "var(--muted)"
                : x.edge > 0 ? "var(--pos)" : "var(--neg)",
              opacity: x.tail ? 0.5 : Math.min(1, 0.35 + Math.abs(x.edge) * 3),
            }} />
          </button>
        ))}
      </div>
      {r && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, fontSize: 11.5,
          justifyContent: "center", flexWrap: "wrap",
          color: r.tail ? "var(--muted)" : "var(--text)",
        }}>
          <ModeChip mode={r.mode} price={r.price} />
          <span style={{ color: "var(--muted)" }}>sim {(r.simP * 100).toFixed(0)}%</span>
          {r.tail && <TailBadge inline />}
          <span style={{
            fontWeight: 800, fontVariantNumeric: "tabular-nums",
            color: r.tail ? "var(--muted)" : r.edge > 0 ? "var(--pos)" : "var(--neg)",
          }}>
            {!r.tail && r.edge >= TARGET_EDGE && (
              <span style={{ color: "#f0b429" }} title={TARGET_TITLE}>★ </span>
            )}
            {signed(r.edge)}
          </span>
          <button
            type="button" className="ui-btn"
            onClick={() => onPlace(r)}
            style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700 }}
          >
            Place ${r.outlay.toFixed(0)}
          </button>
        </div>
      )}
    </div>
  );
}

/** Browse rows for one game, grouped by ladder in the lib's ladder-then-
 *  strike order (already sorted upstream — Map preserves it). */
function browseLadders(rows: Suggestion[]): Map<string, Suggestion[]> {
  const m = new Map<string, Suggestion[]>();
  for (const r of rows) {
    const arr = m.get(r.ladder);
    if (arr) arr.push(r); else m.set(r.ladder, [r]);
  }
  return m;
}

/** "AUB spread" / "total" — one header per browsed ladder, from its rungs. */
function ladderHeadline(rungs: Suggestion[]): string {
  const r = rungs[0];
  return `${r.team} ${r.statText}`.replace(/\s+/g, " ").trim() || r.label;
}

export default function GameBetsPanel({
  section, browse, verdict, hiddenByFilter, tailCount, unit, token, feeParams,
  quotedAt, ordersLive, modeFilter, onModeFilter, typeFilter, onTypeFilter,
  showTails, onShowTails, onProject,
}: {
  /** This game's slice of the page compute, or undefined when it has none. */
  section: SuggestSection | undefined;
  /** EVERY priced rung on this game (full-ladder browse), uncapped by the
   *  picker — owner ask 2026-08-30: scroll the whole spread/total ladder and
   *  see the edge at each strike, not just the picked rungs. */
  browse: Suggestion[];
  /** Why this game is (or is not) suggestible — the empty state's reason. */
  verdict: PregameVerdict | undefined;
  /** Ladders this game HAS that the current filters are hiding. */
  hiddenByFilter: number;
  /** Tail-band ladders on this game, counted whether or not they are shown. */
  tailCount: number;
  /** Dollars of risk per ladder — the owner's unit size from My Book. */
  unit: number;
  /** Portal password — the same header the reads use. Placement needs it. */
  token: string;
  feeParams: Record<string, FeeParams>;
  /** When the page's compute last ran; the slip quotes it. */
  quotedAt: Date;
  ordersLive: boolean;
  modeFilter: ModeFilter;
  onModeFilter: (v: ModeFilter) => void;
  typeFilter: BetTypeFilter;
  onTypeFilter: (v: BetTypeFilter) => void;
  showTails: boolean;
  onShowTails: (v: boolean) => void;
  /** Switch this card's open panel to the chart this bet came from. */
  onProject: (t: ProjectionTarget) => void;
}) {
  /** The confirm slip. `idem` is minted ONCE per opening, so a double-tap on
   *  Confirm replays server-side instead of placing twice. */
  const [slip, setSlip] = useState<{ group: LadderGroup; idem: string } | null>(null);
  /** The full-ladder browse, collapsed by default — the picked rows stay the
   *  headline; this is the walk-the-ladder view behind one press. */
  const [showBrowse, setShowBrowse] = useState(false);

  const groups = section?.groups ?? [];
  const tailGroups = section?.tailGroups ?? [];
  const nothing = groups.length === 0 && tailGroups.length === 0;
  const clearFilters = () => { onModeFilter("all"); onTypeFilter("all"); };

  return (
    <div style={{ display: "grid", gap: 7 }}>
      <FilterChips
        modeFilter={modeFilter} onModeFilter={onModeFilter}
        typeFilter={typeFilter} onTypeFilter={onTypeFilter}
      />

      {/* The words legend the bar test asks for: say which colour is which,
          once, instead of making the reader infer it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10.5, color: "var(--muted)", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden="true" style={{
            width: 9, height: 9, borderRadius: 3, background: "var(--mode-rest)",
            display: "inline-block", flex: "none",
          }} />
          rest (maker fee)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden="true" style={{
            width: 9, height: 9, borderRadius: 3, background: "var(--mode-take)",
            display: "inline-block", flex: "none",
          }} />
          take now (taker fee)
        </span>
        <span>green/red is the EDGE, not the mode</span>
      </div>

      {/* The bars this game's rows had to clear, and what a row costs. The
          take bar is a LADDER in time, so it is printed as one rather than as
          a single number that is wrong for most of the slate. */}
      <div style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.5 }}>
        ${unit}/ladder · rest {Math.round(MIN_MAKER_EDGE * 100)}¢+
        {" "}(none inside 1h of kick) / take
        {" "}{Math.round(TAKE_THRESHOLD * 100)}¢ &gt;24h,
        {" "}{(TAKE_THRESHOLD_NEAR * 100).toFixed(1)}¢ 3–24h,
        {" "}{Math.round(TAKE_THRESHOLD_LATE * 100)}¢ under 3h ·
        {" "}edges NET of fee, re-checked against the live book at placement
      </div>

      {nothing ? (
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, display: "grid", gap: 6 }}>
          {verdict && !verdict.ok ? (
            <span>
              Nothing here: this game is no longer pregame ({verdict.reason}).
              Suggestions are PREGAME ONLY — our fairs are pregame
              distributions, so an "edge" measured against a live book is not
              an edge, it is a wrong number pointed at real money.
            </span>
          ) : hiddenByFilter > 0 ? (
            <>
              <span>
                {hiddenByFilter} suggestion{hiddenByFilter === 1 ? "" : "s"} on
                this game {hiddenByFilter === 1 ? "is" : "are"} hidden by the
                mode / bet-type filters above.
              </span>
              <span>
                <button type="button" className="ui-btn" onClick={clearFilters}
                        style={{ padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>
                  Show all types
                </button>
              </span>
            </>
          ) : (
            <span>
              Nothing on this game clears the thresholds right now — no listed
              market, no published rung at those strikes, or no edge left after
              the fee.
            </span>
          )}
        </div>
      ) : (
        <LadderRows
          groups={groups}
          tailGroups={tailGroups}
          unit={unit}
          onPlace={(g) => setSlip({ group: g, idem: newIdempotencyKey() })}
          onProject={onProject}
        />
      )}

      {hiddenByFilter > 0 && !nothing && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 10, color: "var(--muted)" }}>
          <span>
            {hiddenByFilter} more suggestion{hiddenByFilter === 1 ? "" : "s"} on
            this game hidden by the filters.
          </span>
          <button type="button" className="ui-btn" onClick={clearFilters}
                  style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>
            Show all types
          </button>
        </div>
      )}

      {/* THE TAIL LINE. Held-out ladders are counted, explained in one
          sentence, and one press away — a filter the reader cannot see is how
          a filter becomes a mystery. */}
      {tailCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
          fontSize: 10, color: "var(--muted)",
        }}>
          <span>
            {tailCount} tail ladder{tailCount === 1 ? "" : "s"} on this game
            {showTails ? " shown, muted" : " hidden"} — sim or price outside
            {" "}{Math.round(TAIL_LO * 100)}–{Math.round(TAIL_HI * 100)}¢,
            where the model is least confident.
          </span>
          <button
            type="button" className="ui-btn"
            data-on={showTails ? "true" : "false"}
            aria-pressed={showTails}
            onClick={() => onShowTails(!showTails)}
            style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700 }}
          >
            {showTails ? "Hide tails" : "Show tails"}
          </button>
        </div>
      )}

      {/* FULL-LADDER BROWSE (owner ask 2026-08-30, the Auburn −7.5 case).
          Every priced rung on this game — uncapped by the picker, tails
          muted — so the reader can walk the whole spread/total ladder and
          take the strike THEY want. Placement goes through the exact same
          ConfirmSlip as a picked row: one rung, sized at the full unit. */}
      {browse.length > 0 && (
        <div style={{ display: "grid", gap: 5 }}>
          <button
            type="button" className="ui-btn"
            data-on={showBrowse ? "true" : "false"}
            aria-pressed={showBrowse}
            onClick={() => setShowBrowse(!showBrowse)}
            style={{ padding: "2px 9px", fontSize: 10.5, fontWeight: 700, justifySelf: "start" }}
          >
            {showBrowse ? "Hide" : "Browse"} all rungs ({browse.length})
          </button>
          {showBrowse && [...browseLadders(browse)].map(([lad, rungs]) => (
            <div key={lad} style={{ display: "grid", gap: 2 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                {ladderHeadline(rungs)}
              </div>
              <RungWheel
                rungs={rungs}
                onPlace={(r) => setSlip({
                  group: groupLadders([r], unit)[0],
                  idem: newIdempotencyKey(),
                })}
              />
            </div>
          ))}
        </div>
      )}

      {!ordersLive && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: "var(--muted)", flexWrap: "wrap" }}>
          <DryRunBadge title="Order entry is staged: the server validates and logs, and submits nothing." />
          <span>Confirming runs the full path and submits nothing.</span>
        </div>
      )}

      {slip && (
        <ConfirmSlip
          group={slip.group}
          idem={slip.idem}
          token={token}
          feeParams={feeParams}
          quotedAt={quotedAt}
          ordersLive={ordersLive}
          onClose={() => setSlip(null)}
        />
      )}
    </div>
  );
}

/* ============================== place strip =============================== */
/**
 * PLACE THE BET FROM THE CHART IT CAME OUT OF.
 *
 * "See projection →" used to be a one-way door: read the distribution, then
 * navigate back to the Bets tab and find the row again to act on it. The strip
 * closes that loop — while the reader is looking at the shape, the bet that
 * sent them there is a button away, with the same confirm slip, the same
 * server rails and the same dry-run staging as the panel. There is exactly ONE
 * placement implementation in this app (`ConfirmSlip` below) and this is a
 * second entry point into it, never a second copy of it.
 *
 * SCOPE. It appears ONLY when the reader arrived from a bets row (the focus
 * payload carries a ladder id) and only for a live owner session. It is not
 * place-from-chart for arbitrary rungs: a chart is a reading surface, and a
 * Place button on every strike would turn a mis-tap into an order.
 *
 * NEVER STALE. `group` is looked up LIVE by id against the current compute on
 * every render (see `findGroupById`); the compute re-runs on the 45s feed poll
 * and the 30s clock, so a game that kicks off or a filter that hides the
 * ladder makes this degrade to one quiet sentence instead of showing a price
 * that no longer exists. The slip itself still re-reads the live book
 * server-side before it signs anything.
 */
export function PlaceStrip({
  group, unit, token, feeParams, quotedAt, ordersLive,
}: {
  /** The originating ladder, re-read from the CURRENT compute — or null when
   *  it is no longer suggested. */
  group: LadderGroup | null;
  unit: number;
  token: string;
  feeParams: Record<string, FeeParams>;
  quotedAt: Date;
  ordersLive: boolean;
}) {
  const [slip, setSlip] = useState<{ group: LadderGroup; idem: string } | null>(null);

  if (!group) {
    return (
      <div style={{
        marginBottom: 7, padding: "6px 9px", borderRadius: 8,
        border: "1px dashed var(--border)", background: "var(--fill)",
        fontSize: 11, color: "var(--muted)",
      }}>
        This bet is no longer suggested — the game has kicked, the book moved,
        or a filter is hiding it. The chart below is unchanged.
      </div>
    );
  }

  const single = group.rungs.length === 1;
  const head = group.rungs[0];
  const bestMode = group.rungs.reduce(
    (m, r) => (r.edge > m.edge ? r : m), group.rungs[0]).mode;
  const outlay = group.rungs.reduce((s, r) => s + r.outlay, 0);

  return (
    <>
      <div style={{
        marginBottom: 7, padding: "7px 9px", borderRadius: 8,
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${group.tail ? "var(--border)" : modeHue(bestMode)}`,
        background: "var(--fill)",
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      }}>
        {/* The bet, in bet-slip words — the same string the row said. */}
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", minWidth: 0 }}>
          {group.tail && <TailBadge inline />}
          {single ? head.label : group.headline}
        </span>
        {single
          ? <ModeChip mode={head.mode} price={head.price} />
          : Array.from(new Set(group.rungs.map((r) => r.mode)))
              .map((m) => <ModeChip key={m} mode={m} />)}
        {/* Sizing, from the owner's unit. Muted: it is context, not the
            verdict. */}
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {single
            ? `${head.count} @ ${cents(head.price)} · $${head.outlay.toFixed(2)}`
            : `${group.rungs.length} rungs · $${group.each} each · $${outlay.toFixed(2)} of $${unit}`}
        </span>
        {!ordersLive && (
          <DryRunBadge title="Order entry is staged: the server validates and logs, and submits nothing." />
        )}
        {/* THE ONE NUMBER: net edge in cents, colourless on a tail row. */}
        <span style={{
          marginLeft: "auto", fontWeight: 800, fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
          color: group.tail
            ? "var(--muted)"
            : group.bestEdge > 0 ? "var(--pos)" : "var(--neg)",
        }}>
          {!group.tail && group.bestEdge >= TARGET_EDGE && (
            <span style={{ color: "#f0b429" }} title={TARGET_TITLE}>★ </span>
          )}
          {signed(group.bestEdge)}
        </span>
        <button
          type="button" className="ui-btn"
          onClick={() => setSlip({ group, idem: newIdempotencyKey() })}
          title={`Place ${group.rungs.length} order${group.rungs.length === 1 ? "" : "s"}`}
          style={{ flex: "none", padding: "3px 12px", fontSize: 11, fontWeight: 800 }}
        >
          Place
        </button>
      </div>

      {slip && (
        <ConfirmSlip
          group={slip.group}
          idem={slip.idem}
          token={token}
          feeParams={feeParams}
          quotedAt={quotedAt}
          ordersLive={ordersLive}
          onClose={() => setSlip(null)}
        />
      )}
    </>
  );
}

/* ----------------------------- confirm popup ------------------------------ */
/**
 * Display-only echoes of the SERVER's rails (server/liveScores.ts). They are
 * not controls — the server enforces them and rejects regardless — but since
 * the contracts field is now editable, the slip says which edit the exchange
 * will refuse BEFORE the press instead of after it.
 */
// Unit-size-linked since 2026-08-30 (owner ask): the server caps each order
// at the unit size the request declares (clamped 1..500 server-side, $40
// fallback when absent) and each slip at 2x that. Mirror the same formula
// here so the pre-press note names the same number the server will use.
const capOrderNow = () => Math.min(500, Math.max(1, Math.round(readUnit())));
const MAX_ORDERS = 8;

/** TARGET star: same bar as the edge board's `target` flag — the fee-adj
 *  EV >= 0.10 bucket where the wk0-2026 settlement grade showed realized ROI
 *  matching modeled EV. A cue, never a filter (owner rule 2026-08-30). */
const TARGET_EDGE = 0.10;
const TARGET_TITLE =
  "TARGET: net edge ≥ 10¢ after fees — the wk0-graded bucket where realized ROI matched the model";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** One rung's editable state: in or out, and how many contracts. */
type RungEdit = { include: boolean; raw: string };

/**
 * The bet in words, then Confirm. Everything shown here is a client-side
 * restatement of an already-computed suggestion; the SERVER re-reads the live
 * book before it signs, so a price that has moved comes back as a rejection
 * naming the new ask rather than as a bad fill.
 *
 * PER-RUNG CHOICE (user, 2026-08-28: "when we lump ladder stuff together, I
 * should have the ability to take them separately or together — right now I'm
 * forced to place the ladders together"). Every rung carries an include
 * checkbox (both on by default) and an editable contracts field prefilled with
 * the computed split. Deselecting a rung drops it from the `orders` array the
 * server already accepts — no server change, and strictly fewer orders, so
 * every cap (per-order, per-request) is satisfied a fortiori. Totals
 * below re-add live, net of the fee at the EDITED count, because the exchange
 * rounds the fee up per order and a bumped count can change what it costs by
 * more than the price × count arithmetic suggests.
 *
 * Placing one rung alone keeps that rung's computed size; the field is there
 * so the user can bump it to a full unit himself, with the cost of doing so
 * printed on the same line.
 */
function ConfirmSlip({
  group, idem, token, feeParams, quotedAt, ordersLive, onClose,
}: {
  group: LadderGroup;
  idem: string;
  token: string;
  /** Needed to re-price the fee at an EDITED count — Kalshi's own per-series
   *  params, the same ones selection used. */
  feeParams: Record<string, FeeParams>;
  quotedAt: Date;
  ordersLive: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<{ status: number; body: PlaceResponse } | null>(null);

  const rungs = group.rungs;
  const multi = rungs.length > 1;
  const [edits, setEdits] = useState<Record<string, RungEdit>>(() =>
    Object.fromEntries(rungs.map((r) => [r.key, { include: true, raw: String(r.count) }])));

  /** Re-priced per rung at the CURRENT count. `count` is NaN when the field is
   *  empty or not a whole number ≥ 1 — that is a blocking state, not a zero. */
  const lines = rungs.map((r: Suggestion) => {
    const e = edits[r.key] ?? { include: true, raw: String(r.count) };
    const n = Number(e.raw);
    const count = Number.isFinite(n) && n >= 1 && Number.isInteger(n)
      ? Math.min(n, 99999) : NaN;
    const ok = Number.isFinite(count);
    const fee = ok ? orderFee(r.price, count, r.mode === "REST", feeParams[r.series]) : 0;
    return {
      r, e, count, ok, fee,
      cost: ok ? round2(r.price * count + fee) : 0,
      changed: ok && count !== r.count,
    };
  });
  const picked = lines.filter((l) => l.e.include);
  const contracts = picked.reduce((s, l) => s + (l.ok ? l.count : 0), 0);
  const fee = round2(picked.reduce((s, l) => s + l.fee, 0));
  const outlay = round2(picked.reduce((s, l) => s + l.cost, 0));
  const anyTake = picked.some((l) => l.r.mode === "TAKE");
  const anyRest = picked.some((l) => l.r.mode === "REST");
  const badCount = picked.some((l) => !l.ok);
  const CAP_ORDER = capOrderNow();
  const CAP_REQUEST = CAP_ORDER * 2;
  const overRequest = outlay > CAP_REQUEST + 1e-9;
  const tooMany = picked.length > MAX_ORDERS;
  const canSend = picked.length > 0 && !badCount;

  const setRaw = (key: string, raw: string) =>
    setEdits((s) => ({ ...s, [key]: { ...(s[key] ?? { include: true, raw }), raw } }));
  const toggle = (key: string) =>
    setEdits((s) => ({
      ...s,
      [key]: { ...(s[key] ?? { include: true, raw: "" }), include: !(s[key]?.include ?? true) },
    }));

  const send = async () => {
    setBusy(true);
    // ONLY the included rungs. The endpoint already takes an orders array, so
    // a one-rung slip is the same request with one element.
    const orders: PlaceOrder[] = picked.map((l) => ({
      ticker: l.r.ticker,
      side: l.r.side,
      // Intent only. The server derives post_only / time_in_force from it and
      // rejects the request outright if we try to send those ourselves.
      mode: l.r.mode === "REST" ? "rest" : "take",
      price_dollars: l.r.price,
      count_fp: l.count,
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
            {resp ? "Result" : picked.length > 1 ? "Place these bets" : "Place this bet"}
          </span>
          {dry && <DryRunBadge title="CFB_ORDERS_LIVE is not set — nothing is submitted to Kalshi." />}
        </div>

        {dry && !resp && (
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
            Staged mode. Confirming runs the full path — password, caps, a fresh
            read of the live book, the audit log — and submits nothing.
          </div>
        )}

        {/* --- the bet, in words — one card per rung, each one optional --- */}
        {!resp && (
          <div style={{ display: "grid", gap: 6 }}>
            {multi && (
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                Take them together or separately — untick a rung to leave it
                out, and edit either count.
              </div>
            )}
            {lines.map(({ r, e, count, ok, fee: rFee, cost, changed }) => (
              <div key={r.key} style={{
                border: `1px ${e.include ? "solid" : "dashed"} var(--border)`,
                borderRadius: 9, padding: "7px 9px",
                display: "grid", gap: 4, fontSize: 12,
                background: e.include ? "transparent" : "var(--fill)",
                opacity: e.include ? 1 : 0.6,
              }}>
                <label style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontWeight: 800, cursor: multi ? "pointer" : "default",
                  // 40px tap target for the whole title line, not just the box.
                  minHeight: multi ? 34 : undefined,
                }}>
                  {multi && (
                    <input
                      type="checkbox"
                      checked={e.include}
                      onChange={() => toggle(r.key)}
                      aria-label={`Include ${r.label}`}
                      style={{ width: 18, height: 18, flex: "none", accentColor: "var(--brand)" }}
                    />
                  )}
                  <span style={{ minWidth: 0 }}>{r.label}</span>
                </label>

                {/* Line 2 — the SIZE, and nothing that competes with it. */}
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 900, padding: "1px 6px", borderRadius: 999,
                    border: "1px solid var(--border)", color: "var(--muted)",
                    whiteSpace: "nowrap",
                  }}>
                    {r.mode} @ {cents(r.price)}
                  </span>
                  {/* EDITABLE SIZE — single-market rows get it too. */}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={e.raw}
                    disabled={!e.include}
                    onChange={(ev) => setRaw(r.key, ev.target.value)}
                    aria-label={`Contracts for ${r.label}`}
                    aria-invalid={!ok}
                    style={{
                      width: 58, padding: "4px 6px", fontSize: 12, fontWeight: 800,
                      borderRadius: 6, background: "var(--card)", color: "var(--text)",
                      border: `1px solid ${ok ? "var(--border)" : "var(--neg)"}`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>contracts</span>
                  {changed && ok && (
                    <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                      (suggested {r.count})
                    </span>
                  )}
                </div>

                {/* Line 3 — what it costs and what it is worth, side by side.
                    The cost is the thing the edit changes and the edge is the
                    reason to place it, so they belong on one line. */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {ok ? (
                      <>
                        ${(r.price * count).toFixed(2)} + ${rFee.toFixed(2)} fee
                        {" = "}<strong style={{ color: "var(--text)" }}>${cost.toFixed(2)}</strong>
                      </>
                    ) : (
                      <span style={{ color: "var(--neg)" }}>
                        enter a whole number of contracts, 1 or more
                      </span>
                    )}
                  </span>
                  <span style={{
                    marginLeft: "auto", fontWeight: 800, whiteSpace: "nowrap",
                    color: r.edge > 0 ? "var(--pos)" : "var(--neg)",
                  }}>
                    {signed(r.edge)} net
                  </span>
                </div>

                {e.include && ok && cost > CAP_ORDER + 1e-9 && (
                  <div style={{ fontSize: 10.5, color: "var(--neg)" }}>
                    ${cost.toFixed(2)} is over the ${CAP_ORDER} per-order cap — the
                    server will refuse this one.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!resp && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
            {picked.length === 0 ? (
              <div style={{ color: "var(--text)", fontWeight: 800 }}>
                Nothing selected — tick at least one rung.
              </div>
            ) : badCount ? (
              <div style={{ color: "var(--text)", fontWeight: 800 }}>
                Give every ticked rung a whole number of contracts, 1 or more.
              </div>
            ) : (
              <div>
                <strong style={{ color: "var(--text)" }}>
                  {contracts} contract{contracts === 1 ? "" : "s"}
                  {" · "}${outlay.toFixed(2)} total
                </strong>
                {" "}(${(outlay - fee).toFixed(2)} stake + ${fee.toFixed(2)} fee)
                {multi && ` · ${picked.length} of ${rungs.length} rung${rungs.length === 1 ? "" : "s"}`}
              </div>
            )}
            <div>
              Prices as of {clock(quotedAt)} · re-verified against the live book
              at placement.
            </div>
            {/* The mechanics, said ONCE. It used to be repeated in full under
                every rung, which at 375px pushed Confirm below the fold. */}
            {anyTake && (
              <div>
                TAKE is a LIMIT order at the confirmed price — it fills there or
                better, never worse, and anything unfilled is cancelled. If the
                exchange ignores immediate-or-cancel, the remainder rests and the
                result will say so. Taker rows pay the full fee.
              </div>
            )}
            {anyRest && (
              <div>
                REST sits post-only: if the book has moved so the quote would
                cross, the exchange rejects it rather than filling it as a taker.
                Maker fee only — zero on the per-team families.
              </div>
            )}
            {(overRequest || tooMany) && (
              <div style={{ color: "var(--neg)" }}>
                {overRequest && `$${outlay.toFixed(2)} is over the $${CAP_REQUEST} per-slip cap. `}
                {tooMany && `More than ${MAX_ORDERS} orders in one slip. `}
                The server refuses the whole request — untick or shrink a rung.
              </div>
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
                  Close this, hit Refresh in the index, and re-read the row at
                  the new price.
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          {!resp && (
            <button type="button" className="ui-btn" data-on="true" onClick={send}
                    disabled={busy || !canSend}
                    title={canSend ? undefined : "Tick a rung and give it a whole contract count"}
                    style={{
                      flex: 1, padding: "9px 12px", fontWeight: 800,
                      opacity: canSend ? 1 : 0.5,
                      cursor: canSend ? "pointer" : "not-allowed",
                    }}>
              {busy
                ? "Sending…"
                : `${dry ? "Confirm (dry run)" : "Confirm"}` +
                  (canSend && multi
                    ? ` · ${picked.length} order${picked.length === 1 ? "" : "s"}`
                    : "")}
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
