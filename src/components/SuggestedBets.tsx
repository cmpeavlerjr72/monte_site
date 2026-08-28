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
  buildSuggestions, gameCandidates, groupLadders, heldTickerSet,
  statCandidates, orderFee, pregameVerdict, timingWords,
  MIN_MAKER_EDGE, TAKE_THRESHOLD, TAKE_THRESHOLD_LATE, TAKE_THRESHOLD_NEAR,
  TAIL_HI, TAIL_LO,
  type Candidate, type FeeParams, type LadderGroup, type Suggestion,
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
  readSuggestSort, writeSuggestSort, readTypeFilter, writeTypeFilter,
  readShowTails, writeShowTails,
  type ModeFilter, type SuggestSort, type BetTypeFilter,
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
  /** The LIVE FEED's verdict alone: an in-progress event, a post/final state,
   *  or a finals CSV. Never a kick-time test — the clock is the gate's own
   *  second signal (see `pregameVerdict`). */
  started: boolean;
  /** ESPN's raw state ("pre"/"in"/"post"/"final"), or undefined where the feed
   *  never joined this game — which is common, not exceptional. */
  liveState?: string;
  /** Kickoff, epoch ms — the "Soonest" sort key, the pregame gate's clock leg,
   *  and the row's maker/taker timing band. Undefined sorts last. */
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

/**
 * The TAIL mark. Deliberately colourless — `--muted` ink on a dashed outline,
 * never `--pos`/`--neg` (edge sign) and never the mode hues. It says "we do
 * not stand behind this row", which is not a bet direction and not an
 * execution mode, so it gets neither channel.
 */
function TailBadge({ inline = false }: { inline?: boolean }) {
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
  game, slug, n, nTail, onJump,
}: {
  game: SuggestGame | undefined;
  slug: string;
  n: number;
  /** Revealed tail markets in this section, counted SEPARATELY — they are not
   *  bets the card is making, so they never inflate the bet count. */
  nTail: number;
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
      {/* ONE count, in one unit. A section that survives only because tails
          are revealed says so in words rather than showing "0 bets". */}
      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {n > 0 ? `${n} bet${n === 1 ? "" : "s"}` : nTail > 0 ? "tail only" : ""}
      </span>
    </button>
  );
}

export default function SuggestedBets({
  games, kalshiBySlug, feeParams, portal, docs, unit, token, nowMs, onJump,
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
  /** A TICKING wall clock from the page (30s), not `Date.now()` read here.
   *  Both time-dependent rules on this card — the pregame gate and the
   *  maker/taker timing bands — must move on their own, not only when the ESPN
   *  live poll happens to deliver. It is also a dependency of the compute memo,
   *  which is what makes a game DROP OFF the card when it kicks. */
  nowMs: number;
  onJump?: (cardKey: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<boolean>(() => readCardOpen());
  const [modeFilter, setModeFilter] = useState<ModeFilter>(() => readModeFilter());
  const [typeFilter, setTypeFilter] = useState<BetTypeFilter>(() => readTypeFilter());
  const [sort, setSort] = useState<SuggestSort>(() => readSuggestSort());
  /** Reveal the tail band's held-out markets. Default OFF, persisted. */
  const [showTails, setShowTails] = useState<boolean>(() => readShowTails());
  /** The confirm slip. `idem` is minted ONCE per opening, so a double-tap on
   *  Confirm replays server-side instead of placing twice. */
  const [slip, setSlip] = useState<{ group: LadderGroup; idem: string } | null>(null);

  const {
    rows, tailRows, tailMarkets, suppressed, computedAt, pregameCount, blindCount,
  } = useMemo(() => {
    const held = heldTickerSet(portal?.positions, portal?.orders);
    const candidates: Candidate[] = [];
    // Games that are genuinely pregame, and games dropped for having NEITHER a
    // kickoff time nor a live state — the one refusal a reader could otherwise
    // mistake for "no edges here".
    let nPregame = 0, nBlind = 0;
    for (const g of games) {
      // PREGAME ONLY — the rule, its precedence and its reasoning all live in
      // `pregameVerdict`. It runs against the page's ticking clock, so this
      // whole memo re-evaluates every 30s and a game LEAVES the card when it
      // kicks, with or without an ESPN join.
      const verdict = pregameVerdict(g, nowMs);
      if (!verdict.ok) {
        if (verdict.reason === "no kickoff time and no live state") nBlind += 1;
        continue;
      }
      nPregame += 1;
      const kg = kalshiBySlug.get(g.key);
      if (!kg) continue;
      // Per-CARD namespace, never the page's season: a merged "Both" slate
      // holds FBS and FCS cards at once and each reads its own dataset.
      const published = docs[String(g.ns)]?.games?.[g.slug];
      if (!published) continue;
      const stats = published.stats;
      if (stats && Object.keys(stats).length) {
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
          g.kickoffMs,
        ));
      }
      // Game lines (winner / spread / total). Absent on a week published
      // before exporter schema 2 — quiet, never an error. A game-level-only
      // namespace (FCS: no player sweep, so `stats` is empty by design)
      // contributes THESE and only these.
      if (published.game) {
        candidates.push(...gameCandidates(
          kg, g.key, g.teamA, g.teamB, published.game, g.kickoffMs));
      }
    }
    // ONE clock for the gate above and the timing bands inside: two Date.now()
    // reads a few ms apart can land on opposite sides of a band edge.
    const built = buildSuggestions(candidates, feeParams, held, unit, nowMs);
    return {
      ...built, computedAt: new Date(),
      pregameCount: nPregame, blindCount: nBlind,
    };
    // `nonce` is the manual refresh: it re-runs the compute against whatever
    // feed the page currently holds, and never triggers a fetch of its own.
    // `nowMs` ticks every 30s upstream, which is what makes a kicked-off game
    // fall out of this list on its own.
  }, [games, kalshiBySlug, feeParams, portal, docs, unit, nonce, nowMs]);

  // Card key -> game, so a same-game run of ladder rows can carry a header
  // and the "Soonest" sort can find a kickoff.
  const gameByKey = useMemo(() => new Map(games.map((g) => [g.key, g])), [games]);

  // Presentation only: fold each ladder's picked rungs (nested markets, up to
  // MAX_RUNGS) into one display row, then FILTER by execution mode and ORDER.
  // Selection and sizing already happened above; none of this touches either,
  // so a filter can never change what a surviving row would cost.
  const allGroups = useMemo(() => groupLadders(rows, unit), [rows, unit]);
  // The tail band's held-out markets, grouped the same way but kept in their
  // OWN list: they are appended under each game's real suggestions when the
  // toggle is on, and never sorted among them.
  const allTailGroups = useMemo(
    () => groupLadders(tailRows, unit), [tailRows, unit]);

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
   * The mode filter drops ROWS (a ladder can mix REST/TAKE rungs); the
   * bet-type filter drops whole LADDERS (a ladder never mixes series, so its
   * `family` is one value). Both compose — either can empty a section.
   */
  const sections = useMemo(() => {
    const pass = (g: LadderGroup) => {
      const modeOk = modeFilter === "all" ||
        g.rungs.some((r) => (modeFilter === "rest") === (r.mode === "REST"));
      const typeOk = typeFilter === "all" || g.family === typeFilter;
      return modeOk && typeOk;
    };
    const kept = allGroups.filter(pass);
    // Tails obey the SAME filters — they are a reveal, not an escape hatch.
    const keptTails = showTails ? allTailGroups.filter(pass) : [];

    const bySlug = new Map<string, { core: LadderGroup[]; tail: LadderGroup[] }>();
    const slot = (slug: string) => {
      let s = bySlug.get(slug);
      if (!s) { s = { core: [], tail: [] }; bySlug.set(slug, s); }
      return s;
    };
    for (const g of kept) slot(g.slug).core.push(g);
    for (const g of keptTails) slot(g.slug).tail.push(g);

    const out = [...bySlug].map(([slug, { core, tail }]) => {
      const inner = [...core].sort((a, b) => b.bestEdge - a.bestEdge);
      const tails = [...tail].sort((a, b) => b.bestEdge - a.bestEdge);
      return {
        slug,
        game: gameByKey.get(slug),
        groups: inner,
        tailGroups: tails,
        // Ranked on the REAL suggestions only. A game that has nothing but
        // tails sorts last (−Infinity) instead of jumping the queue on the
        // strength of an edge we do not stand behind.
        bestEdge: inner.length ? inner[0].bestEdge : -Infinity,
        // Unknown kickoff sorts LAST rather than first, so a missing time
        // never masquerades as the most urgent game on the board.
        kickoffMs: gameByKey.get(slug)?.kickoffMs ?? Infinity,
      };
    });
    out.sort((a, b) => sort === "soon"
      ? (a.kickoffMs !== b.kickoffMs ? a.kickoffMs - b.kickoffMs : b.bestEdge - a.bestEdge)
      : b.bestEdge - a.bestEdge);
    return out;
  }, [allGroups, allTailGroups, showTails, modeFilter, typeFilter, sort, gameByKey]);

  const shownCount = sections.reduce((n, s) => n + s.groups.length, 0);
  const hiddenByFilter = allGroups.length - shownCount;
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

          {/* Second filter row: bet TYPE, by Kalshi series family. Same chip
              styling as the mode/sort row above — one visual system. Composes
              with the mode filter (both apply); an unrecognised future series
              (`family` null) only shows under "All", never crashes. */}
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }} role="group" aria-label="Bet type filter">
            {([
              ["all", "All"], ["game", "Game lines"], ["td", "TD props"],
              ["yardage", "Yardage"], ["team", "Team totals"],
            ] as const).map(([v, label]) => (
              <button
                key={v} type="button" className="ui-btn"
                data-on={typeFilter === v ? "true" : "false"}
                onClick={() => { setTypeFilter(v); writeTypeFilter(v); }}
                style={{ padding: "2px 9px", fontSize: 11, fontWeight: 700 }}
              >
                {label}
              </button>
            ))}
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
            {/* The take bar is a LADDER now, so it is printed as one rather
                than as a single number that is wrong for most of the slate.
                Rest keeps one bar but gains a cutoff: none inside 1h. */}
            <span>
              Live · {pregameCount} pregame game{pregameCount === 1 ? "" : "s"} ·
              {" "}${unit}/ladder · rest {Math.round(MIN_MAKER_EDGE * 100)}¢+
              {" "}(none inside 1h of kick) / take
              {" "}{Math.round(TAKE_THRESHOLD * 100)}¢ &gt;24h,
              {" "}{(TAKE_THRESHOLD_NEAR * 100).toFixed(1)}¢ 3–24h,
              {" "}{Math.round(TAKE_THRESHOLD_LATE * 100)}¢ under 3h ·
              {" "}edges NET of fee, re-checked at placement
            </span>
          </div>

          {/* The one pregame refusal a reader could mistake for "no edges".
              Everything else the gate drops (kicked off, live, final) is
              self-evidently gone; a game with neither a kickoff time nor an
              ESPN join is not, so it is counted out loud. */}
          {blindCount > 0 && (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {blindCount} game{blindCount === 1 ? "" : "s"} skipped: no kickoff
              time and no live state, so there is no way to tell whether they
              have started.
            </div>
          )}

          {sections.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {hiddenByFilter > 0
                ? `Nothing matches these filters — ${hiddenByFilter} suggestion${hiddenByFilter === 1 ? "" : "s"} hidden.`
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
                    nTail={sec.tailGroups.length}
                    onJump={onJump}
                  />
                  <div style={{ display: "grid", gap: 4 }}>
              {/* Real suggestions first, then — only when the toggle is on —
                  the tail band's held-out markets, behind their own labelled
                  divider. ONE map, so the row markup exists once; `g.tail` is
                  the only thing that changes how it looks. */}
              {[...sec.groups, ...sec.tailGroups].map((g, gi) => {
                // A tail ladder and its in-band twin share a `ladder` string
                // (same game, same family, same team) — they are two halves of
                // one ladder split by the band. React keys and the expand
                // selection both need the PAIR to be distinct, or ticking one
                // opens both and React drops a row.
                const gid = g.tail ? `tail:${g.ladder}` : g.ladder;
                const on = gid === sel;
                const single = g.rungs.length === 1;
                const head = g.rungs[0];
                // Mode at a glance: the row wears a slim accent in its own
                // execution-mode hue. A ladder whose rungs disagree takes the
                // BEST rung's hue, and shows a chip for each mode anyway.
                const modes = Array.from(new Set(g.rungs.map((r) => r.mode)));
                const bestMode = g.rungs.reduce((m, r) => (r.edge > m.edge ? r : m), g.rungs[0]).mode;
                // A TAIL row keeps its number but LOSES its colour: green on
                // an edge we do not stand behind would be the card lying in
                // its loudest channel. The badge and the muted ink say so
                // instead — the Team Stats convention, where a suppressed
                // flag keeps its mark and loses its chip.
                const edgeColor = g.tail
                  ? "var(--muted)"
                  : g.bestEdge > 0 ? "var(--pos)" : "var(--neg)";
                const firstTail = g.tail && gi === sec.groups.length;
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
                    <div style={{
                      display: "flex", alignItems: "stretch", gap: 4,
                    }}>
                      <button
                        type="button"
                        onClick={() => { setSel(on ? null : gid); onJump?.(g.slug); }}
                        style={{
                          flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                          display: "grid", gap: 3,
                          padding: "6px 8px", borderRadius: 7,
                          // A tail row is DASHED and sits on the section fill
                          // rather than the card: at a glance it reads as a
                          // provisional row, the same dotted-underline
                          // convention the approximate-strike marks use.
                          border: `1px ${g.tail ? "dashed" : "solid"} ${on ? "var(--brand)" : "var(--border)"}`,
                          borderLeft: `4px solid ${g.tail ? "var(--border)" : modeHue(bestMode)}`,
                          background: g.tail ? "var(--fill)" : "var(--card)",
                          color: g.tail ? "var(--muted)" : "var(--text)",
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
                        {g.tail && (
                          <div style={{ color: "var(--muted)", marginBottom: 4 }}>
                            Held out of the list: the sim, the ask, or both sit
                            outside {Math.round(TAIL_LO * 100)}–{Math.round(TAIL_HI * 100)}¢.
                            That is where our own model is least trusted and where
                            a thin book misprices hardest, so the edge below is
                            printed without a verdict colour.
                          </div>
                        )}
                        {/* TIME CONTEXT, in words. The mode chip already says
                            REST or TAKE; this says why that bar was the bar —
                            "2h to kick — resting has little time to fill before
                            the kick−30 pull, so the take bar 3¢ (from 6¢)". */}
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
                                {/* A stat rung is "225+"; a game line is
                                    "−7.5" or "Over 48.5", which the builder
                                    supplies — "48.5+" is not a bet. */}
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
                </div>
              ))}
            </div>
          )}

          {hiddenByFilter > 0 && sections.length > 0 && (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {hiddenByFilter} suggestion{hiddenByFilter === 1 ? "" : "s"} hidden by the filters.
            </div>
          )}

          {/* THE TAIL LINE. Held-out markets are counted, explained in one
              sentence, and one press away — a filter the reader cannot see is
              how a filter becomes a mystery. */}
          {tailMarkets > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
              fontSize: 10, color: "var(--muted)",
            }}>
              <span>
                {tailMarkets} tail market{tailMarkets === 1 ? "" : "s"}
                {showTails ? " shown, muted" : " hidden"} — sim or price outside
                {" "}{Math.round(TAIL_LO * 100)}–{Math.round(TAIL_HI * 100)}¢,
                where the model is least confident.
              </span>
              <button
                type="button" className="ui-btn"
                data-on={showTails ? "true" : "false"}
                aria-pressed={showTails}
                onClick={() => { const v = !showTails; setShowTails(v); writeShowTails(v); }}
                style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700 }}
              >
                {showTails ? "Hide tails" : "Show tails"}
              </button>
            </div>
          )}

          {suppressed.length > 0 && (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {suppressed.length} candidate{suppressed.length === 1 ? "" : "s"} suppressed
              (thin or one-sided book, ladder cap, penny quote, or already held).
            </div>
          )}
        </>
      )}

      {slip && (
        <ConfirmSlip
          group={slip.group}
          idem={slip.idem}
          token={token}
          feeParams={feeParams}
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
                  Close this, hit Refresh, and re-read the row at the new price.
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
