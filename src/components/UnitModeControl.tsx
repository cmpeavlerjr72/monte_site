// src/components/UnitModeControl.tsx
//
// HOW a unit is spent, beside HOW MUCH.
//
// Owner ask 2026-09-08. On a sportsbook "a unit" is ambiguous and nobody
// notices, because −150 and +150 sit a few percent apart. On a binary exchange
// the same word means wildly different money: on an 86¢ favourite a $30 unit
// RISKED nets $4.47, while a $30 unit WON risks $88.58 (measured — see
// `node scripts/check_unit_sizing.mjs`, which prints the whole table). So the
// choice gets a control of its own, next to the unit input, and the row that
// spends it says which rule it used.
//
// THE ARITHMETIC IS NOT HERE. It is `sizeContracts` in src/lib/suggestedBets.ts
// ("THE UNIT SIZING MODE"), the one place in the app that solves for contracts.
// This file is the switch and the words.
//
// HOUSE STYLE. Three named segments, direct-labelled, never colour-alone; the
// definitions live behind ONE press rather than in three lines of fine print
// competing with the money numbers on the same screen.

import { useState } from "react";
import {
  MAX_RISK_MULTIPLE_MAX, MAX_RISK_MULTIPLE_MIN, type UnitMode,
} from "../lib/suggestedBets";

const SEGMENTS: { mode: UnitMode; label: string }[] = [
  { mode: "risk", label: "Risk" },
  { mode: "to-win", label: "To win" },
  { mode: "book", label: "Book" },
];

/** One sentence per mode — the row's own tooltip, and the popover's body. */
export const MODE_WORDS: Record<UnitMode, string> = {
  risk: "Stake one unit and win whatever the price pays. A 30¢ dog returns "
    + "more than an 86¢ favourite, because you are risking the same money "
    + "for a longer shot.",
  "to-win": "Stake enough to NET one unit after the fee. Every bet returns "
    + "the same profit, so a favourite risks more than a dog to get there — "
    + "which is what the risk cap below is for.",
  book: "The sportsbook habit. A favourite (over 50¢, i.e. negative American "
    + "odds) is sized to WIN a unit; a dog (50¢ or under, positive odds) "
    + "RISKS a unit and wins whatever it wins — so a −150 and a +150 offset "
    + "each other exactly as they would on a book's slip.",
};

/**
 * The segmented control. `multiple` is rendered only where the owner can
 * change it (the My Book console) — the Bets panel gets the switch alone, with
 * the guard stated in the popover, because a per-panel copy of a global cap is
 * how two numbers start disagreeing.
 */
export default function UnitModeControl({
  mode, onMode, multiple, onMultiple, compact = false,
}: {
  mode: UnitMode;
  onMode: (v: UnitMode) => void;
  /** The maxRiskMultiple guard. Omit `onMultiple` to show it read-only. */
  multiple: number;
  onMultiple?: (v: number) => void;
  /** Bets-panel size: smaller type, no stepper. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pad = compact ? "1px 7px" : "3px 10px";
  const size = compact ? 10 : 11.5;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      flexWrap: "wrap", position: "relative",
    }}>
      <span
        role="radiogroup"
        aria-label="Unit sizing mode"
        style={{
          display: "inline-flex", borderRadius: 999, overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        {SEGMENTS.map((s) => {
          const on = s.mode === mode;
          return (
            <button
              key={s.mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onMode(s.mode)}
              title={MODE_WORDS[s.mode]}
              style={{
                padding: pad, fontSize: size, fontWeight: on ? 900 : 700,
                border: "none", cursor: "pointer", whiteSpace: "nowrap",
                // --brand-contrast, NOT --brand-text: the first is the ink
                // that reads ON the brand fill (what .ui-btn[data-on] uses),
                // the second is brand-coloured ink for headings ON the card.
                // Mixing them up paints navy on navy — an invisible label,
                // which is exactly what the first screenshot showed.
                background: on ? "var(--brand)" : "transparent",
                color: on ? "var(--brand-contrast)" : "var(--muted)",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </span>

      {/* THE RISK CAP. Only meaningful once something can stretch, so it is
          absent in `risk` mode rather than sitting there greyed and inviting
          a press that does nothing. */}
      {onMultiple && mode !== "risk" && (
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 10.5, color: "var(--muted)",
        }}>
          risk at most
          <input
            type="number" inputMode="numeric"
            min={MAX_RISK_MULTIPLE_MIN} max={MAX_RISK_MULTIPLE_MAX} step={1}
            value={multiple}
            onChange={(e) => onMultiple(Number(e.target.value))}
            aria-label="Maximum risk, in units, for one bet"
            className="ui-sel"
            style={{
              width: 46, fontSize: 12, fontWeight: 800, textAlign: "right",
            }}
          />
          × unit
        </label>
      )}

      <button
        type="button"
        className="ui-btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="What the three modes mean"
        style={{ padding: "0 7px", fontSize: size, fontWeight: 900 }}
      >
        ?
      </button>

      {open && (
        <div
          role="note"
          style={{
            position: "absolute", top: "100%", left: 0, zIndex: 40,
            marginTop: 5, width: "min(340px, 84vw)", padding: "9px 11px",
            borderRadius: 9, background: "var(--card)", color: "var(--text)",
            border: "1px solid var(--brand)",
            boxShadow: "0 12px 34px rgba(0,0,0,0.35)",
            fontSize: 11.5, lineHeight: 1.5, display: "grid", gap: 6,
          }}
        >
          {SEGMENTS.map((s) => (
            <div key={s.mode}>
              <b style={{ color: s.mode === mode ? "var(--brand-text)" : "var(--text)" }}>
                {s.label}
              </b>{" "}
              <span style={{ color: "var(--muted)" }}>{MODE_WORDS[s.mode]}</span>
            </div>
          ))}
          <div style={{ color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 5 }}>
            A contract costs its price and pays $1, and the taker fee is
            7% of price × (1 − price) per contract, so a unit of profit costs
            price ÷ (1 − price) units of risk before fees. The cap stops that
            at {multiple}× your unit — a capped bet says so on the slip, with
            the profit it does reach.
          </div>
        </div>
      )}
    </span>
  );
}
