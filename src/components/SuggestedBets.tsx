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
// `scripts/fbs_maker_pipeline.py` in cfb-props-sim remains the AUTOMATED
// placement authority and stays post-only-only. This panel is the
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

import { useState } from "react";
import {
  orderFee, timingWords,
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
 * ------------------------------------------------------------------------ */
export type ProjectionTarget =
  | { kind: "teamstats"; team: string; stat: string }
  | { kind: "scores" };

export function projectionTargetFor(g: LadderGroup): ProjectionTarget | null {
  if (g.family === "game") return { kind: "scores" };
  const series = g.rungs[0]?.series ?? "";
  const stat = STAT_FOR_SERIES[series];
  const team = g.rungs[0]?.team ?? "";
  if (!stat || !team) return null;
  return { kind: "teamstats", team, stat };
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
                    ? `Show ${target.team}'s simulated distribution for this stat`
                    : "Show the simulated score distribution"}
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
export default function GameBetsPanel({
  section, verdict, hiddenByFilter, tailCount, unit, token, feeParams,
  quotedAt, ordersLive, modeFilter, onModeFilter, typeFilter, onTypeFilter,
  showTails, onShowTails, onProject,
}: {
  /** This game's slice of the page compute, or undefined when it has none. */
  section: SuggestSection | undefined;
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

/* ----------------------------- confirm popup ------------------------------ */
/**
 * Display-only echoes of the SERVER's rails (server/liveScores.ts). They are
 * not controls — the server enforces them and rejects regardless — but since
 * the contracts field is now editable, the slip says which edit the exchange
 * will refuse BEFORE the press instead of after it.
 */
const CAP_ORDER = 40;
const CAP_REQUEST = 80;
const MAX_ORDERS = 8;

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
 * every cap (per-order, per-request, 24h) is satisfied a fortiori. Totals
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
