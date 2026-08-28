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

import { useMemo, useState } from "react";
import type { TeamStats as TeamStatsDoc } from "../lib/cfbJson";
import type { KalshiGame } from "../lib/kalshi";
import type { PortalPayload } from "../lib/kalshiPortal";
import {
  buildSuggestions, groupLadders, heldTickerSet, statCandidates,
  MIN_MAKER_EDGE, TAKE_THRESHOLD,
  type Candidate, type FeeParams, type LadderGroup,
} from "../lib/suggestedBets";
import {
  newIdempotencyKey, placeErrorText, placeOrders,
  type PlaceOrder, type PlaceResponse,
} from "../lib/placeOrders";
// One mapping, both consumers: this card and the portal's held-position
// pricing read the same series<->stat table (see teamStatMarkets.ts).
import { SERIES_FOR_STAT } from "../lib/teamStatMarkets";
import {
  readCardOpen, writeCardOpen, readModeFilter, writeModeFilter,
  readSuggestSort, writeSuggestSort,
  type ModeFilter, type SuggestSort,
} from "../lib/ownerPrefs";
import DryRunBadge from "./DryRunBadge";
import { getTeamLogo } from "../utils/teamLogo";
import type { Season } from "../lib/cfbData";

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
  /** Kickoff, epoch ms — the "Soonest" sort key. Undefined sorts last. */
  kickoffMs?: number;
};

const cents = (v: number) => `${Math.round(v * 100)}¢`;
const signed = (v: number) =>
  `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}¢`;
const clock = (d: Date) => d.toLocaleTimeString();

/* ------------------------------- mode colour ------------------------------ */
// Execution mode gets its OWN categorical channel (--mode-rest / --mode-take,
// validated in theme.css). It must never borrow --pos/--neg: on this card
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

/** "Sat 3:30 PM" — enough to order a multi-day slate without a date column. */
function kickText(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { weekday: "short" })} ` +
         `${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * The section header: AWAY @ HOME, kick time, and how many bets are in this
 * game. teamA is HOME on every card in this app, so the away team is named
 * first — the way a slate is read aloud. Logos are a synchronous lookup from
 * the already-loaded team table, so they cost nothing; a school without one
 * simply has no mark.
 */
function GameHeader({
  game, slug, n, onJump,
}: {
  game: SuggestGame | undefined;
  slug: string;
  n: number;
  onJump?: (cardKey: string) => void;
}) {
  const away = game?.teamB ?? "";
  const home = game?.teamA ?? "";
  const kick = kickText(game?.kickoffMs);
  const logo = (name: string) => {
    const src = getTeamLogo(name);
    return src ? (
      <img src={src} alt="" width={15} height={15} loading="lazy"
           style={{ objectFit: "contain", flex: "none" }} />
    ) : null;
  };
  return (
    <button
      type="button"
      onClick={() => onJump?.(slug)}
      title="Jump to this game on the board"
      style={{
        display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        width: "100%", textAlign: "left", cursor: "pointer",
        padding: "1px 2px 3px", border: "none", background: "none",
        color: "var(--text)", font: "inherit",
      }}
    >
      {logo(away)}
      <span style={{ fontSize: 11.5, fontWeight: 800 }}>{away || slug}</span>
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>@</span>
      {logo(home)}
      <span style={{ fontSize: 11.5, fontWeight: 800 }}>{home}</span>
      {kick && (
        <span style={{ fontSize: 10, color: "var(--muted)" }}>· {kick}</span>
      )}
      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {n} bet{n === 1 ? "" : "s"}
      </span>
    </button>
  );
}

export default function SuggestedBets({
  games, kalshiBySlug, feeParams, portal, docs, unit, token, onJump,
}: {
  games: SuggestGame[];
  kalshiBySlug: Map<string, KalshiGame>;
  feeParams: Record<string, FeeParams>;
  portal: PortalPayload | null;
  /** Published team_stats per namespace. Loaded ONCE at the page level
   *  (`useTeamStatsDocs`) because the portal's held-position pricing needs the
   *  same documents — one loader, two consumers. */
  docs: Record<string, TeamStatsDoc>;
  /** Dollars of risk per ladder — the user's unit size from the My Book
   *  console. Sizing, outlay and the Place popup all read this one number. */
  unit: number;
  /** Portal password — the same header the reads use. Placement needs it. */
  token: string;
  onJump?: (cardKey: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<boolean>(() => readCardOpen());
  const [modeFilter, setModeFilter] = useState<ModeFilter>(() => readModeFilter());
  const [sort, setSort] = useState<SuggestSort>(() => readSuggestSort());
  /** The confirm slip. `idem` is minted ONCE per opening, so a double-tap on
   *  Confirm replays server-side instead of placing twice. */
  const [slip, setSlip] = useState<{ group: LadderGroup; idem: string } | null>(null);

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
        (stat) => SERIES_FOR_STAT[stat] ?? "",
      ));
    }
    const built = buildSuggestions(candidates, feeParams, held, unit);
    return { ...built, computedAt: new Date() };
    // `nonce` is the manual refresh: it re-runs the compute against whatever
    // feed the page currently holds, and never triggers a fetch of its own.
  }, [games, kalshiBySlug, feeParams, portal, docs, unit, nonce]);

  // Card key -> game, so a same-game run of ladder rows can carry a header
  // and the "Soonest" sort can find a kickoff.
  const gameByKey = useMemo(() => new Map(games.map((g) => [g.key, g])), [games]);

  // Presentation only: fold each ladder's picked rungs (nested markets, up to
  // MAX_RUNGS) into one display row, then FILTER by execution mode and ORDER.
  // Selection and sizing already happened above; none of this touches either,
  // so a filter can never change what a surviving row would cost.
  const allGroups = useMemo(() => groupLadders(rows, unit), [rows, unit]);

  /**
   * ONE SECTION PER GAME. Suggestions concentrate hard — two, three, four
   * ladders on the same matchup is the normal case — and a flat list of them
   * ran together no matter what divider sat between the runs. So a game is a
   * CONTAINER: its own header and its own rows, with real space around it.
   * A game with a single suggestion still gets a section; consistent beats
   * clever.
   *
   * Sorting orders SECTIONS, never rows across sections — games stay
   * atomic in both orders. Within a section rows are always best-edge first.
   * The mode filter drops ROWS; a section left with none disappears.
   */
  const sections = useMemo(() => {
    const kept = modeFilter === "all" ? allGroups : allGroups.filter((g) =>
      g.rungs.some((r) => (modeFilter === "rest") === (r.mode === "REST")));
    const bySlug = new Map<string, LadderGroup[]>();
    for (const g of kept) {
      const arr = bySlug.get(g.slug);
      if (arr) arr.push(g); else bySlug.set(g.slug, [g]);
    }
    const out = [...bySlug].map(([slug, list]) => {
      const inner = [...list].sort((a, b) => b.bestEdge - a.bestEdge);
      return {
        slug,
        game: gameByKey.get(slug),
        groups: inner,
        bestEdge: inner[0].bestEdge,
        // Unknown kickoff sorts LAST rather than first, so a missing time
        // never masquerades as the most urgent game on the board.
        kickoffMs: gameByKey.get(slug)?.kickoffMs ?? Infinity,
      };
    });
    out.sort((a, b) => sort === "soon"
      ? (a.kickoffMs !== b.kickoffMs ? a.kickoffMs - b.kickoffMs : b.bestEdge - a.bestEdge)
      : b.bestEdge - a.bestEdge);
    return out;
  }, [allGroups, modeFilter, sort, gameByKey]);

  const shownCount = sections.reduce((n, s) => n + s.groups.length, 0);
  const hiddenByFilter = allGroups.length - shownCount;
  const pregameCount = games.filter((g) => !g.started).length;
  // Undefined on a server that predates order entry: treat as staged-off,
  // which is the safe reading.
  const ordersLive = portal?.orders_live === true;

  return (
    <section style={{
      border: "1px solid var(--brand)", borderRadius: 12,
      background: "var(--card)", padding: 10, display: "grid", gap: open ? 8 : 0,
    }}>
      {/* Header row — present in BOTH states. The kill switch is NOT here: it
          lives in the My Book console alongside the other owner controls. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => { const v = !open; setOpen(v); writeCardOpen(v); }}
          aria-expanded={open}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "2px 4px",
            border: "none", background: "none", color: "var(--text)",
            font: "inherit", cursor: "pointer", textAlign: "left",
          }}
        >
          {/* CSS caret, not a glyph: "▶" renders in emoji presentation on
              some platforms and came out as a blue box at phone width. */}
          <span aria-hidden="true" style={{
            width: 0, height: 0, flex: "none",
            borderTop: "5px solid transparent",
            borderBottom: "5px solid transparent",
            borderLeft: "6px solid var(--muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .12s",
          }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>
            Suggested bets ({shownCount})
          </span>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            · computed {clock(computedAt)}
          </span>
        </button>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {!ordersLive && (
            <DryRunBadge title="Order entry is staged: the server validates and logs, and submits nothing." />
          )}
          {open && (
            <button type="button" className="ui-btn" onClick={() => setNonce((n) => n + 1)}
                    style={{ padding: "2px 8px", fontSize: 11 }}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          {/* Filter + order. Both persist; both are PRESENTATION — a filter
              never changes what a surviving row costs. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 3 }} role="group" aria-label="Execution mode filter">
              {([["all", "All"], ["rest", "Maker"], ["take", "Taker"]] as const).map(([v, label]) => (
                <button
                  key={v} type="button" className="ui-btn"
                  data-on={modeFilter === v ? "true" : "false"}
                  onClick={() => { setModeFilter(v); writeModeFilter(v); }}
                  style={{ padding: "2px 9px", fontSize: 11, fontWeight: 700 }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 3 }} role="group" aria-label="Sort order">
              {([["edge", "Best edge"], ["soon", "Soonest"]] as const).map(([v, label]) => (
                <button
                  key={v} type="button" className="ui-btn"
                  data-on={sort === v ? "true" : "false"}
                  onClick={() => { setSort(v); writeSuggestSort(v); }}
                  style={{ padding: "2px 9px", fontSize: 11, fontWeight: 700 }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* The words legend the bar test asks for: say which colour is
              which, once, instead of making the reader infer it. */}
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

          {/* ONE meta line. It used to be four, which is four gray lines
              before the first bet on a phone. The header already stamps the
              compute time, so this does not repeat it. */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--muted)" }}>
            <span aria-hidden="true" style={{
              width: 6, height: 6, borderRadius: 999, background: "var(--pos)",
              display: "inline-block", flex: "none",
            }} />
            <span>
              Live · {pregameCount} pregame game{pregameCount === 1 ? "" : "s"} ·
              {" "}${unit}/ladder · rest {Math.round(MIN_MAKER_EDGE * 100)}¢+ /
              {" "}take {Math.round(TAKE_THRESHOLD * 100)}¢+ · edges NET of fee,
              re-checked at placement
            </span>
          </div>

          {sections.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {hiddenByFilter > 0
                ? `Nothing in this mode — ${hiddenByFilter} suggestion${hiddenByFilter === 1 ? "" : "s"} hidden by the filter.`
                : "Nothing clears the thresholds right now."}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {sections.map((sec) => (
                <div key={sec.slug} style={{
                  border: "1px solid var(--border)", borderRadius: 10,
                  background: "var(--fill)", padding: 7,
                  display: "grid", gap: 5,
                }}>
                  <GameHeader
                    game={sec.game}
                    slug={sec.slug}
                    n={sec.groups.length}
                    onJump={onJump}
                  />
                  <div style={{ display: "grid", gap: 4 }}>
              {sec.groups.map((g) => {
                const on = g.ladder === sel;
                const single = g.rungs.length === 1;
                const head = g.rungs[0];
                // Mode at a glance: the row wears a slim accent in its own
                // execution-mode hue. A ladder whose rungs disagree takes the
                // BEST rung's hue, and shows a chip for each mode anyway.
                const modes = Array.from(new Set(g.rungs.map((r) => r.mode)));
                const bestMode = g.rungs.reduce((m, r) => (r.edge > m.edge ? r : m), g.rungs[0]).mode;
                return (
                  <div key={g.ladder}>
                    <div style={{
                      display: "flex", alignItems: "stretch", gap: 4,
                    }}>
                      <button
                        type="button"
                        onClick={() => { setSel(on ? null : g.ladder); onJump?.(g.slug); }}
                        style={{
                          flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                          display: "grid", gap: 3,
                          padding: "6px 8px", borderRadius: 7,
                          border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                          borderLeft: `4px solid ${modeHue(bestMode)}`,
                          background: "var(--card)", color: "var(--text)",
                          font: "inherit", fontSize: 12,
                        }}
                      >
                        {/* TWO FIXED LINES, always in the same order: the bet
                            in words, then chip / sizing / edge. The edge is
                            the last thing on line 2 in a column of its own, so
                            every row's number lands at the same x — a wrapping
                            single line put them all over the place, which is
                            what read as sloppy. */}
                        <span style={{ fontWeight: 700, lineHeight: 1.25 }}>
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
                            color: g.bestEdge > 0 ? "var(--pos)" : "var(--neg)",
                          }}>
                            {signed(g.bestEdge)}
                          </span>
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
                        style={{
                          // Fixed width, so the edge column above it lines up
                          // across every row of every section.
                          width: 62, flex: "none", padding: 0,
                          fontSize: 11, fontWeight: 800,
                        }}
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
                                <span style={{ fontWeight: 700 }}>{rr.strike}+</span>
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
                </div>
              ))}
            </div>
          )}

          {hiddenByFilter > 0 && sections.length > 0 && (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {hiddenByFilter} suggestion{hiddenByFilter === 1 ? "" : "s"} hidden by the mode filter.
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
