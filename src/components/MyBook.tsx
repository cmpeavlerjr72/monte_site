// src/components/MyBook.tsx
//
// The owner's Kalshi book, in the two places it shows up:
//
//   MyBookStrip — the block on a GAME CARD, one row per bet on that game
//   MyBookBar   — the cumulative "Book" row inside the My Book console
//
// DISPLAY (2026-08-28, the bar test — the same redesign MarketEdge and the
// Team Stats panel took). At rest a bet is ONE LINE:
//
//     ●  Texas −7.5              2-leg   $13   +$3.16
//     ^  ^                        ^       ^      ^
//     |  the bet in CHEER-side    |     stake   THE VERDICT: the sim's EV
//     |  words (a held NO is      |             on this bet, in dollars
//     |  flipped to its           legs of a
//     held / resting mark         parlay, if any
//
// and nothing else. What it replaced was three dense lines — a glyph + label +
// ×count, then "risk $X → win $Y · fees $Z", then TWO EV chips each carrying a
// tag, dollars, a probability AND american odds. That is the number-pair
// antipattern squared; the user's verdict was "still very wordy and not
// visually appealing". Every number it dropped is in the TAP POPOVER, written
// in words, one fact per line — count, risk → payout, fees, both sources'
// EV with their probability and odds, and the fill state of a resting order.
//
// Rules carried over from MarketEdge and not to be undone:
//   - ONE number at rest per element, and it is the decision number.
//   - Rows are fixed-height buttons, so the popover is placed by index
//     arithmetic instead of a measurement effect (no new render-loop surface),
//     and so a long school name can never reflow the block.
//   - The popover has a Close button and NO document-level listener.
//   - Tokens only. --pos/--neg mean the sign of a verdict here and nothing
//     else; held-vs-resting is carried by SHAPE (filled dot vs hollow ring)
//     with a words legend in the header, never by colour.

import { useState } from "react";
import { americanOdds, pctText } from "../lib/marketEdge";
import type { PortalBet, PortalTotals } from "../lib/kalshiPortal";

/* Geometry — fixed on purpose (see header). */
const ROW_H = 40;
const HEAD_H = 16;

/* ------------------------------------------------------------- money ---- */

/** Exact money, sign-aware — the popover's register. */
const usd = (v: number): string => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;

/** Glance money for a VERDICT: whole dollars once the cents are noise, exact
 *  cents under $10 — where an EV lives most of the time and the cents are the
 *  whole decision. */
function usdShort(v: number): string {
  const a = Math.abs(v);
  return `${v < 0 ? "−" : ""}$${a >= 10 ? Math.round(a) : a.toFixed(2)}`;
}

/** Glance money for a STAKE — the secondary number, so it rounds hard: whole
 *  dollars down to $1, cents only where cents are all there is. */
function usdStake(v: number): string {
  const a = Math.abs(v);
  return `$${a >= 1 ? Math.round(a) : a.toFixed(2)}`;
}

/** A signed verdict. Rounded to zero it is not a direction, so it loses its
 *  sign and its colour — a green "+$0.00" must never read as a bet worth
 *  having (the same rule MarketEdge applies to a 0¢ edge). */
function signedUsd(v: number, short = false): string {
  if (Math.abs(v) < 0.005) return short ? "$0" : "$0.00";
  return `${v > 0 ? "+" : "−"}${short ? usdShort(Math.abs(v)) : usd(Math.abs(v))}`;
}

type Tone = "pos" | "neg" | "flat";
const toneOf = (v: number | null): Tone =>
  v === null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "pos" : "neg";

/** Contract counts are fp strings upstream — 24, not 24.00; 1.5 stays 1.5. */
const fmtCount = (n: number): string => String(Number(n.toFixed(2)));
const plural = (n: number, w: string) => `${fmtCount(n)} ${w}${n === 1 ? "" : "s"}`;

/** Fair odds only where they mean something (at 99½% "-19900" is noise). */
const odds = (p: number): string => (p > 0.02 && p < 0.98 ? ` (${americanOdds(p)})` : "");

/* ------------------------------------------------------- the verdict ---- */

/**
 * Everything the resting row leaves out, in words, one fact per line. This is
 * both the popover's body and the row button's accessible label.
 */
export function betLines(b: PortalBet): string[] {
  const out: string[] = [];

  if (b.kind === "position") {
    out.push(`Held: ${plural(b.count, "contract")} of ${b.label}.`);
  } else {
    out.push(`Resting: ${plural(b.count, "contract")} of ${b.label} still working.`);
    if (b.filled && b.initial) {
      out.push(
        `Partly filled — ${fmtCount(b.filled)} of ${fmtCount(b.initial)} ordered have filled. ` +
        `Those show separately as a held position; this row is only the rest.`
      );
    }
  }

  if (b.legN > 1) {
    out.push(
      `Parlay — all ${b.legN} legs must hit.` +
      (b.title ? ` Kalshi calls it "${b.title}".` : "")
    );
  }

  out.push(
    b.kind === "position"
      ? `Risked ${usd(b.risked)} to win ${usd(b.toWin)}.`
      : `Would risk ${usd(b.risked)} to win ${usd(b.toWin)} if it fills.`
  );
  out.push(b.fees > 0 ? `Fees paid: ${usd(b.fees)}.` : "No fees paid on this one.");

  out.push(
    b.kalshiP === null || b.kalshiEV === null
      ? "Kalshi: nobody is quoting this market right now, so it has no price."
      : `Kalshi: ${pctText(b.kalshiP)}${odds(b.kalshiP)} · EV ${signedUsd(b.kalshiEV)}.`
  );
  out.push(
    b.simP === null || b.simEV === null
      ? "Sim: no price for this market — nothing we simulate maps to it, so there is no verdict."
      : `Sim: ${pctText(b.simP)}${odds(b.simP)} · EV ${signedUsd(b.simEV)}.`
  );
  return out;
}

/** Held vs still-working, as a shape. Never colour alone. */
function Mark({ resting }: { resting: boolean }) {
  return <span className="mybook__dot" data-resting={resting ? "true" : undefined} aria-hidden="true" />;
}

/** The words legend, said once per block — and only for the marks present. */
function Legend({ held, resting }: { held: boolean; resting: boolean }) {
  return (
    <span className="mybook__legend">
      {held && <><Mark resting={false} />held</>}
      {resting && <><Mark resting />resting</>}
    </span>
  );
}

/* ---------------------------------------------------------- the strip ---- */

/**
 * The owner's book on ONE game. Labels are cheer-side (a held NO is flipped to
 * the complement bet), so the row reads as the outcome being rooted for.
 */
export default function MyBookStrip({ bets }: { bets: PortalBet[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const openIdx = bets.findIndex((b) => b.key === open);
  const openBet = openIdx >= 0 ? bets[openIdx] : null;

  return (
    <div className="mybook">
      <div className="mybook__head">
        <span className="mybook__title">
          My book
          <Legend
            held={bets.some((b) => b.kind === "position")}
            resting={bets.some((b) => b.kind === "order")}
          />
        </span>
        <span>Sim EV</span>
      </div>

      {bets.map((b) => (
        <BetRow
          key={b.key}
          bet={b}
          on={b.key === open}
          onToggle={() => setOpen((k) => (k === b.key ? null : b.key))}
        />
      ))}

      {openBet && (
        <div
          role="status"
          className="mybook__pop"
          style={{
            // Directly under the tapped row; the LAST row instead pins the
            // popover to the top of the block, so a verdict never runs off the
            // bottom of the card and never covers the row you just tapped
            // (which would make tap-again-to-close unreachable).
            top: openIdx === bets.length - 1 && bets.length > 1
              ? HEAD_H
              : HEAD_H + (openIdx + 1) * ROW_H,
          }}
        >
          {betLines(openBet).map((line, i) => <div key={i}>{line}</div>)}
          <button type="button" className="ui-btn mybook__close" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/** One bet at rest: mark, words, stake, verdict. Four elements, two numbers. */
function BetRow({ bet, on, onToggle }: { bet: PortalBet; on: boolean; onToggle: () => void }) {
  const tone = toneOf(bet.simEV);
  return (
    <button
      type="button"
      className="mybook__row"
      data-on={on ? "true" : undefined}
      onClick={onToggle}
      aria-expanded={on}
      aria-label={betLines(bet).join(" ")}
    >
      <Mark resting={bet.kind === "order"} />
      <span className="mybook__label">{bet.label}</span>
      {bet.legN > 1 && <span className="mybook__legs">{bet.legN}-leg</span>}
      <span className="mybook__stake">{usdStake(bet.risked)}</span>
      <span className="mybook__ev" data-tone={tone}>
        {bet.simEV === null ? "—" : signedUsd(bet.simEV, true)}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ the bar ---- */

/** The whole book in one line, with the same compression as a single bet. */
export function MyBookBar({ totals, unmatched }: { totals: PortalTotals; unmatched: number }) {
  const [open, setOpen] = useState(false);
  const tone = toneOf(totals.simEV);

  // An EV summed over a SUBSET is never presented as if it covered the whole
  // book — the line says how many bets it actually spans.
  const across = (priced: number) =>
    priced === totals.n
      ? `across all ${plural(totals.n, "bet")}`
      : `across the ${priced} of ${totals.n} it can price`;

  const lines: string[] = [
    `${plural(totals.n, "bet")} in the book` +
      (unmatched ? `, ${unmatched} of them on games that are not on this board.` : "."),
    `Risked ${usd(totals.risked)} to win ${usd(totals.toWin)} if every one of them hits.`,
    `Fees paid: ${usd(totals.fees)}.`,
    totals.kalshiEV === null
      ? "Kalshi EV: none of these markets is being quoted right now."
      : `Kalshi EV ${signedUsd(totals.kalshiEV)}, ${across(totals.kalshiPriced)}.`,
    totals.simEV === null
      ? "Sim EV: the sim prices none of these markets, so there is no verdict."
      : `Sim EV ${signedUsd(totals.simEV)}, ${across(totals.simPriced)}.`,
  ];

  return (
    <div className="mybook-bar">
      <button
        type="button"
        className="mybook-bar__btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={lines.join(" ")}
      >
        {/* The console header one line up already counts the bets and the
            games; repeating it here is the wordiness this redesign removes. */}
        <span className="mybook-bar__lead">{usdStake(totals.risked)} at risk</span>
        <span className="mybook-bar__cap">Sim EV</span>
        <span className="mybook__ev" data-tone={tone}>
          {totals.simEV === null ? "—" : signedUsd(totals.simEV, true)}
        </span>
      </button>
      {open && (
        <div role="status" className="mybook__pop mybook__pop--inline">
          {lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  );
}
