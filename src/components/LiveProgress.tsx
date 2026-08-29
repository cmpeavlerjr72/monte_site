// src/components/LiveProgress.tsx
//
// LIVE PROGRESS — where a held per-team stat bet actually stands, right now.
//
// The owner's ask (2026-08-29): "we have the reception yards bets but we don't
// have any way to actually track the yards as they accumulate." Every other
// block on the card prices a market. This one watches it settle.
//
// It sits directly ABOVE the My Book strip and wears the same geometry (16px
// head, 40px rows, index-positioned popover), so the two read as one column of
// money on the card: what the bets ARE, and where they STAND.
//
//     TCU 225+ rec yds                    187        38 to go
//     ^                                    ^   ^         ^
//     the bet, in Kalshi's own wording     |   the bar,  THE VERDICT: what is
//     (the strike belongs to the BET, so   |   full at   left, or the state it
//     it is never repeated as a reading)   |   the       has already reached
//                                          |   strike
//                                          where the stat stands
//
// DISPLAY RULES, and why each is what it is:
//
//   - The two live numbers are the two halves of ONE fact — where it is, and
//     what is left — which is the same argument the My Book strip's stake cell
//     makes for "risk / wins". Each is word-labelled or shaped (a bar is not a
//     number to parse), so neither reads as an inline number-pair. Everything
//     else — the player-by-player breakdown, the source, the clock the reading
//     was taken at — is in the TAP POPOVER, in words, one fact per line.
//   - COLOUR MEANS THE BET'S CURRENT STANDING here, and nothing else, exactly
//     the way --pos/--neg mean the sign of an EV one block down and the sign of
//     a settled result in the record block. A chip is always direct-labelled
//     ("CLEARED", "BUSTED", "HIT", "MISSED"), never colour-alone, and a bet
//     still in flight gets NO colour at all — "38 to go" is a fact, not a
//     verdict, and green on it would be the card cheering for itself.
//   - The BAR IS NEVER TONED. It fills toward the strike on a NO bet exactly as
//     it does on a YES — the same yards, drawn the same — and the chip is what
//     says which direction is good. A red bar for a NO would be colouring the
//     stat rather than the bet.
//   - THE ROWS EXIST BEFORE THE DATA DOES. Whether a bet is trackable is known
//     from its ticker alone, so the block mounts at full height with dashed
//     placeholders and fills in — the reading landing must never push the card
//     (the same CLS sensitivity as the deferred re-sort in Scoreboard.tsx).

import { useState } from "react";
import {
  progressFor, type LiveTeamStats, type ProgressBet, type StatProgress,
} from "../lib/liveProgress";
import { cheerLabel } from "../lib/kalshiPortal";

/* Geometry — fixed, and shared with MyBookStrip on purpose (see header). */
const ROW_H = 40;
const HEAD_H = 16;

export default function LiveProgressStrip({
  bets, espnHomeIsA, stats,
}: {
  /** Already filtered to trackable markets and de-duplicated by the caller —
   *  the row order is the caller's. */
  bets: ProgressBet[];
  /** The card's ESPN join: our teamA is ESPN's home side. Structural, so a
   *  neutral-site flip cannot put one team's yards on the other's bet. */
  espnHomeIsA: boolean;
  /** Null until the first reading lands (or on a game with no box score yet) —
   *  the rows still render, as placeholders. */
  stats: LiveTeamStats | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!bets.length) return null;

  const rows = bets.map((b) => ({
    key: `${b.ticker}|${b.side}`,
    bet: b,
    p: progressFor(b.ticker, b.side, espnHomeIsA, stats),
  }));
  const openIdx = rows.findIndex((r) => r.key === open);
  const openRow = openIdx >= 0 ? rows[openIdx] : null;

  return (
    <div className="liveprog">
      <div className="liveprog__head">
        <span>Live progress</span>
        <span>{stats?.final ? "Final" : stats?.detail || "ESPN box score"}</span>
      </div>

      {rows.map((r) => (
        <ProgressRow
          key={r.key}
          p={r.p}
          fallbackLabel={cheerLabel(r.bet.ticker, r.bet.side)}
          on={r.key === open}
          onToggle={() => setOpen((k) => (k === r.key ? null : r.key))}
        />
      ))}

      {openRow && (
        <div
          role="status"
          className="mybook__pop"
          style={{
            // Same rule as the book strip: directly under the tapped row,
            // except the LAST row, which pins to the top so a verdict never
            // runs off the card and never covers the row you just tapped.
            top: openIdx === rows.length - 1 && rows.length > 1
              ? HEAD_H
              : HEAD_H + (openIdx + 1) * ROW_H,
          }}
        >
          {(openRow.p?.lines ?? [
            "No reading yet — ESPN has not published a box score for this game.",
          ]).map((line, i) => <div key={i}>{line}</div>)}
          <button type="button" className="ui-btn mybook__close" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One tracked bet. The placeholder branch (no reading yet) keeps the row's full
 * 40px so the block cannot resize under the card when data lands, and says so
 * in a dash rather than a zero — 0 yards is a real reading and must not be
 * faked while we are still waiting for one.
 */
function ProgressRow({ p, fallbackLabel, on, onToggle }: {
  p: StatProgress | null;
  fallbackLabel: string;
  on: boolean;
  onToggle: () => void;
}) {
  const pending = p === null;
  return (
    <button
      type="button"
      className="liveprog__row"
      data-on={on ? "true" : undefined}
      onClick={onToggle}
      aria-expanded={on}
      aria-label={
        p
          ? p.lines.join(" ")
          : `${fallbackLabel} — no live reading yet.`
      }
    >
      <span className="liveprog__label">{p?.label ?? fallbackLabel}</span>
      <span className="liveprog__meter">
        <span className="liveprog__value">{pending ? "—" : p.value}</span>
        <span className="liveprog__track">
          <span
            className="liveprog__fill"
            style={{ width: `${pending ? 0 : Math.round(p.frac * 100)}%` }}
          />
        </span>
      </span>
      <span className="liveprog__chip" data-tone={p?.tone ?? "flat"}>
        {pending ? "—" : p.chip}
      </span>
    </button>
  );
}
