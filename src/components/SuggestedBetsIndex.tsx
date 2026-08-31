// src/components/SuggestedBetsIndex.tsx
//
// The owner's RANKED INDEX — one row per game, at the top of the page.
//
// Why an index and not the old table. Discovery is a cross-game question
// ("where is tonight's money?") and it belongs above the slate; ranking games
// is this surface's own question. Tapping a row EXPANDS it in place into the
// game's ladders, each with the same PlaceStrip + confirm slip the projection
// charts use (owner ask 2026-08-31: "we should be able to place directly from
// there instead of having to go to the game and find that specific bet").
// The expanded block keeps an "Open game" button for the full per-game panel
// — filters, the rung browse, projections — which stays where it always was.
//
// It reads the SAME page-level compute the panels and the card badges read
// (src/lib/useSuggestions.ts), under the same filters, so the number here and
// the number on a card can never disagree — and a placement from here goes
// down the identical PlaceStrip -> ConfirmSlip path a panel placement does,
// so there is exactly one pricing, sizing and confirmation implementation.
// Refresh re-runs that compute against the newest feed the page already
// holds — it fetches nothing.

import { useState } from "react";
import { getTeamLogo } from "../utils/teamLogo";
import DryRunBadge from "./DryRunBadge";
import RestingBets, { RestingBadge } from "./RestingBets";
import { kickText, PlaceStrip, signed } from "./SuggestedBets";
import type { RestingReview } from "../lib/restingReview";
// Only the COLLAPSE state is this component's own; the filters and the order
// live in Scoreboard (one compute, one set of filters) and persist there.
import { readCardOpen, writeCardOpen, type SuggestSort } from "../lib/ownerPrefs";
import { TAIL_HI, TAIL_LO, type FeeParams } from "../lib/suggestedBets";
import type { SuggestSection, Suggestions } from "../lib/useSuggestions";

const clockText = (d: Date) => d.toLocaleTimeString();

/**
 * ONE ROW PER GAME: who is playing, when it kicks, how many bets are on it and
 * the best net edge among them. The row is a 44px tap target: this page is
 * read on a phone. Tapping EXPANDS the row into the game's ladders, one
 * PlaceStrip each (see the header) — the caret rotates like every other
 * disclosure on the page.
 */
function IndexRow({ sec, showTails, expanded, onToggle, onOpen, unit, token, feeParams, quotedAt, ordersLive }: {
  sec: SuggestSection;
  showTails: boolean;
  expanded: boolean;
  onToggle: (slug: string) => void;
  onOpen: (slug: string) => void;
  unit: number;
  token: string;
  feeParams: Record<string, FeeParams>;
  quotedAt: Date;
  ordersLive: boolean;
}) {
  const away = sec.game?.teamB ?? "";
  const home = sec.game?.teamA ?? "";
  const kick = kickText(sec.game?.kickoffMs);
  const n = sec.groups.length;
  const nTail = sec.tailGroups.length;
  const hasEdge = Number.isFinite(sec.bestEdge);
  const logo = (name: string) => {
    const src = getTeamLogo(name);
    return src ? (
      <img src={src} alt="" width={16} height={16} loading="lazy"
           style={{ objectFit: "contain", flex: "none" }} />
    ) : null;
  };
  return (
    <div style={{
      borderRadius: 9, border: `1px solid ${expanded ? "var(--brand)" : "var(--border)"}`,
      background: "var(--card)",
    }}>
      <button
        type="button"
        onClick={() => onToggle(sec.slug)}
        aria-expanded={expanded}
        title={expanded ? "Collapse" : "Show this game's bets"}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          minHeight: 44, textAlign: "left", cursor: "pointer",
          padding: "7px 9px", borderRadius: 9,
          border: "none", background: "none",
          color: "var(--text)", font: "inherit",
        }}
      >
        <span style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            {logo(away)}
            <span style={{ fontSize: 12, fontWeight: 800 }}>{away || sec.slug}</span>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>@</span>
            {logo(home)}
            <span style={{ fontSize: 12, fontWeight: 800 }}>{home}</span>
          </span>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {kick && `${kick} · `}
            {/* ONE count, in one unit. Tails are counted SEPARATELY — they are
                not bets this surface is making, so they never inflate it. */}
            {n > 0 ? `${n} bet${n === 1 ? "" : "s"}` : "tail only"}
            {showTails && nTail > 0 ? ` · ${nTail} tail` : ""}
          </span>
        </span>
        {/* The VERDICT: one number, the best net edge on this game. A tail-only
            row has no edge we stand behind, so it prints none. */}
        <span style={{
          flex: "none", fontWeight: 800, fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
          color: hasEdge ? (sec.bestEdge > 0 ? "var(--pos)" : "var(--neg)") : "var(--muted)",
        }}>
          {hasEdge ? signed(sec.bestEdge) : "—"}
        </span>
        <span aria-hidden="true" style={{
          flex: "none", width: 0, height: 0,
          borderTop: "4px solid transparent",
          borderBottom: "4px solid transparent",
          borderLeft: "6px solid var(--muted)",
          transform: expanded ? "rotate(90deg)" : "none",
          transition: "transform .12s",
        }} />
      </button>

      {/* THE EXPANSION: this game's ladders, placeable in place. One
          PlaceStrip per ladder — the identical component (and confirm slip)
          the projection charts place from, so there is one implementation of
          pricing, sizing, per-rung editing and the dry-run badge. Tails
          appear only while the reveal is on, same as everywhere else. */}
      {expanded && (
        <div style={{ padding: "0 9px 8px", display: "grid", gap: 0 }}>
          {[...sec.groups, ...sec.tailGroups].map((g) => (
            <PlaceStrip
              key={(g.tail ? "tail:" : "") + g.ladder}
              group={g}
              unit={unit}
              token={token}
              feeParams={feeParams}
              quotedAt={quotedAt}
              ordersLive={ordersLive}
            />
          ))}
          <button
            type="button" className="ui-btn"
            onClick={() => onOpen(sec.slug)}
            title="Scroll to the game card and open its full Bets panel (filters, every rung, projections)"
            style={{ justifySelf: "start", padding: "3px 10px", fontSize: 11, fontWeight: 700 }}
          >
            Open game ↗
          </button>
        </div>
      )}
    </div>
  );
}

export default function SuggestedBetsIndex({
  suggestions, review, token, unit, sort, onSort, onRefresh, ordersLive,
  feeParams, showTails, onShowTails, onClearFilters, onOpenGame,
}: {
  suggestions: Suggestions;
  /** The owner's own resting orders, re-priced — the ACTION half of this
   *  surface. It sits above the index rows because it is the only part with a
   *  clock on it, and its badge shows even when the card is collapsed. */
  review: RestingReview;
  /** Portal password — the resting block can cancel and convert, and the
   *  expanded rows place. */
  token: string;
  /** Dollars of risk per ladder — printed so the counts have a unit. */
  unit: number;
  sort: SuggestSort;
  onSort: (v: SuggestSort) => void;
  /** Re-runs the page compute against the feed it already holds. No fetch. */
  onRefresh: () => void;
  ordersLive: boolean;
  /** Kalshi's per-series fee params — the expanded rows' PlaceStrips re-price
   *  fees at edited counts, same as everywhere else they place. */
  feeParams: Record<string, FeeParams>;
  showTails: boolean;
  onShowTails: (v: boolean) => void;
  /** Mode + bet-type filters back to "all" — the one-tap way out of an empty
   *  list caused by a filter the reader forgot was on. */
  onClearFilters: () => void;
  /** Scroll to the game, flash it, and open its Bets panel. */
  onOpenGame: (slug: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(() => readCardOpen());
  /** Which game row is expanded in place (one at a time — a phone screen).
   *  Session-local on purpose: the collapse state is a reading position, not
   *  a preference. */
  const [expanded, setExpanded] = useState<string | null>(null);
  const {
    sections, shownCount, hiddenByFilter, tailMarkets, suppressed,
    computedAt, pregameCount, blindCount,
  } = suggestions;

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
            · computed {clockText(computedAt)}
          </span>
        </button>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {/* ACTION NEEDED, visible collapsed. A resting order whose verdict
              has turned is the one thing on this surface with a deadline, and
              a deadline behind a disclosure triangle is a deadline missed. */}
          <RestingBadge n={review.needAction} />
          {!ordersLive && (
            <DryRunBadge title="Order entry is staged: the server validates and logs, and submits nothing." />
          )}
          {open && (
            <button type="button" className="ui-btn" onClick={onRefresh}
                    style={{ padding: "2px 8px", fontSize: 11 }}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          {/* THE ORDERS WE ALREADY HAVE, first. Discovery can wait; a rest
              whose band has moved cannot. */}
          <RestingBets
            review={review}
            token={token}
            ordersLive={ordersLive}
            quotedAt={computedAt}
            onOpenGame={onOpenGame}
          />

          {/* Order. The mode / bet-type filters live in the per-game panel
              beside the rows they drop; the ORDER of the games is this
              surface's own question, so it stays here. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Order</span>
            <div style={{ display: "flex", gap: 3 }} role="group" aria-label="Sort order">
              {([["edge", "Best edge"], ["soon", "Soonest"]] as const).map(([v, label]) => (
                <button
                  key={v} type="button" className="ui-btn"
                  data-on={sort === v ? "true" : "false"}
                  onClick={() => onSort(v)}
                  style={{ padding: "3px 9px", fontSize: 11, fontWeight: 700 }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
              tap a game to place its bets right here
            </span>
          </div>

          {sections.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {hiddenByFilter > 0
                ? `Nothing matches these filters — ${hiddenByFilter} suggestion${hiddenByFilter === 1 ? "" : "s"} hidden.`
                : "Nothing clears the thresholds right now."}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 5 }}>
              {sections.map((sec) => (
                <IndexRow
                  key={sec.slug}
                  sec={sec}
                  showTails={showTails}
                  expanded={expanded === sec.slug}
                  onToggle={(slug) => setExpanded((cur) => cur === slug ? null : slug)}
                  onOpen={onOpenGame}
                  unit={unit}
                  token={token}
                  feeParams={feeParams}
                  quotedAt={computedAt}
                  ordersLive={ordersLive}
                />
              ))}
            </div>
          )}

          {/* ---------------------------- diagnostics ---------------------------
              What the list is NOT showing, in words. A suppression the reader
              cannot see is how a filter becomes a mystery. */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--muted)" }}>
            <span aria-hidden="true" style={{
              width: 6, height: 6, borderRadius: 999, background: "var(--pos)",
              display: "inline-block", flex: "none",
            }} />
            <span>
              Live · {pregameCount} pregame game{pregameCount === 1 ? "" : "s"} ·
              {" "}${unit}/ladder · edges NET of fee, re-checked at placement
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

          {hiddenByFilter > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 10, color: "var(--muted)" }}>
              <span>
                {hiddenByFilter} suggestion{hiddenByFilter === 1 ? "" : "s"} hidden
                by the mode / bet-type filters (set inside a game's Bets panel).
              </span>
              <button type="button" className="ui-btn" onClick={onClearFilters}
                      style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>
                Show all types
              </button>
            </div>
          )}

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
                onClick={() => onShowTails(!showTails)}
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
    </section>
  );
}
