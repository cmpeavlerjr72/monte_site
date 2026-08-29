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
//     ●  Texas −7.5              2-leg   risk $13   +$3.16
//     ^  ^                        ^      wins $17     ^
//     |  the bet in CHEER-side    |         ^         |
//     |  words (a held NO is      |         |    THE VERDICT: the sim's EV
//     |  flipped to its           legs of   |    on this bet, in dollars
//     held / resting mark         a parlay  |
//                                           the EXPOSURE: what is staked and
//                                           what it pays if it settles our
//                                           way. Two halves of ONE identity —
//                                           stake + wins = contracts × $1 —
//                                           so they are formatted together
//                                           and always add up on screen.
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
//   - ONE number at rest per element, and it is the decision number. The
//     exposure cell is the one element that carries two, because they are two
//     halves of a single identity that has to be checkable at a glance
//     (stake + wins = contracts × $1); each is word-labelled and on its own
//     line, which is what keeps it from reading as a number-pair.
//   - Rows are fixed-height buttons, so the popover is placed by index
//     arithmetic instead of a measurement effect (no new render-loop surface),
//     and so a long school name can never reflow the block.
//   - The popover has a Close button and NO document-level listener.
//   - Tokens only. --pos/--neg mean the sign of a verdict here and nothing
//     else; held-vs-resting is carried by SHAPE (filled dot vs hollow ring)
//     with a words legend in the header, never by colour.

import { Fragment, useState } from "react";
import { americanOdds, pctText } from "../lib/marketEdge";
import CancelConfirm from "./CancelOrder";
import { cheerLabelWithGame } from "../lib/kalshiPortal";
import type { BetGameNames, PortalBet, PortalTotals, RecordBet, RecordLine, SettlementRecord } from "../lib/kalshiPortal";
import { getTeamLogo } from "../utils/teamLogo";

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

const isWhole = (v: number) => Math.abs(v - Math.round(v)) < 0.005;

/**
 * THE EXPOSURE PAIR — what is staked, and what it wins.
 *
 * A Kalshi contract settles at $1, so the two numbers on a row are the two
 * halves of one identity:
 *
 *     stake  +  wins  =  contracts × $1
 *
 * and they are therefore formatted TOGETHER, never each by its own rounding
 * rule. Rounded apart, a $13.50 stake beside a $16.50 win prints "$14" and
 * "$17" — a $31 payout on a $30 bet, which is a wrong number, not a rounded
 * one. So: whole dollars only when BOTH are whole; cents on both otherwise.
 * The addition then always works on screen.
 *
 * `risked` is whatever that row already counts as its outlay (fees are OUTSIDE
 * it on both a position and an order — see `computePortalBets`), so `toWin`,
 * which is `count − risked`, is consistent with it by construction. The fee is
 * itemised separately in the popover rather than folded into either number.
 */
function exposure(risked: number, toWin: number): { risk: string; win: string } {
  const cents = !isWhole(risked) || !isWhole(toWin);
  const f = (v: number) => `$${cents ? v.toFixed(2) : String(Math.round(v))}`;
  return { risk: f(risked), win: f(toWin) };
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

  // ITEMISED, in the order the money moves: what it pays, what it cost, what
  // the difference is. Every contract settles at $1, so the payout is just the
  // count in dollars — saying it out loud is what makes the row's "wins $X"
  // checkable rather than a number to be trusted.
  out.push(
    b.kind === "position"
      ? `Settles at ${usd(b.count)} if it goes our way — ${usd(b.risked)} staked, ` +
        `so it wins ${usd(b.toWin)}.`
      : `Would settle at ${usd(b.count)} if it fills and goes our way — ` +
        `${usd(b.risked)} staked, so it wins ${usd(b.toWin)}.`
  );
  out.push(
    b.fees > 0
      ? `Fees paid: ${usd(b.fees)} — outside both numbers above.`
      : b.kind === "order"
        ? "No fee yet: a resting order is charged nothing until it fills."
        : "No fees paid on this one."
  );

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
export default function MyBookStrip({ bets, token = "" }: {
  bets: PortalBet[];
  /** Portal password. Present only for the owner, and only then does a resting
   *  row that THIS APP placed get its ✕. Without it the strip is exactly the
   *  read-only block it has always been. */
  token?: string;
}) {
  /**
   * ONE popover, two things it can be showing: the bet's derivation (a tap on
   * the row) or the cancel confirm (a tap on the ✕). Reusing the popover rather
   * than growing an inline confirm inside a fixed 40px row is what keeps the
   * index arithmetic below valid AND leaves room for the question, the answer
   * and two 30px buttons on a phone.
   */
  const [pop, setPop] = useState<{ key: string; mode: "info" | "cancel" } | null>(null);
  const openIdx = bets.findIndex((b) => b.key === pop?.key);
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

      {bets.map((b) => {
        // The ✕ is offered ONLY where the server would accept it: a resting
        // order this app placed (`app`, decided server-side against its own
        // cfbapp- tag). The maker pipeline's orders and hand-placed ones show
        // here and stay untouchable.
        const cancellable = Boolean(token) && b.kind === "order" && b.app === true && b.orderId;
        const row = (
          <BetRow
            bet={b}
            on={b.key === pop?.key}
            onToggle={() => setPop((p) => (p?.key === b.key && p.mode === "info" ? null : { key: b.key, mode: "info" }))}
          />
        );
        if (!cancellable) return <Fragment key={b.key}>{row}</Fragment>;
        return (
          <div className="mybook__rowline" key={b.key}>
            {row}
            <button
              type="button"
              className="mybook__x"
              data-on={pop?.key === b.key && pop.mode === "cancel" ? "true" : undefined}
              aria-label={`Cancel the resting order for ${b.label}`}
              title="Cancel this resting order"
              onClick={() => setPop({ key: b.key, mode: "cancel" })}
            >
              ✕
            </button>
          </div>
        );
      })}

      {openBet && pop && (
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
          {pop.mode === "cancel" && openBet.orderId ? (
            <CancelConfirm
              token={token}
              orderId={openBet.orderId}
              label={openBet.label}
              onDismiss={() => setPop(null)}
            />
          ) : (
            <>
              {betLines(openBet).map((line, i) => <div key={i}>{line}</div>)}
              <button type="button" className="ui-btn mybook__close" onClick={() => setPop(null)}>
                Close
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One bet at rest: mark, words, the exposure, the verdict.
 *
 * The exposure is ONE element carrying the two halves of one fact — staked,
 * and what it wins if it settles our way — stacked so each line reads as a
 * labelled number rather than as a number-pair to be parsed sideways, and so
 * the money column keeps a fixed width and stays a column down the strip. The
 * row height is unchanged (40px), which the popover's index arithmetic
 * depends on.
 */
function BetRow({ bet, on, onToggle }: { bet: PortalBet; on: boolean; onToggle: () => void }) {
  const tone = toneOf(bet.simEV);
  const { risk, win } = exposure(bet.risked, bet.toWin);
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
      <span className="mybook__stake">
        <span className="mybook__stake-risk">risk {risk}</span>
        <span className="mybook__stake-win">wins {win}</span>
      </span>
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

/* ------------------------------------------------ the settled record ---- */

/**
 * THE REALISED HALF of the console: what the owner's Kalshi bets on THIS SLATE
 * actually settled for, and which kind of bet did it.
 *
 * Same bar test as everything above. One line per row:
 *
 *     Slate            5-6-1        −$54.02   −12.4%
 *     Spreads           4-4          −$6.98    −3.1%
 *     ^                  ^              ^        ^
 *     the bet type    the record    THE VERDICT  the RATE it came at
 *
 * Three deliberate departures from the EV rows above, all because this is
 * SETTLED money rather than an estimate:
 *
 *   - the money is EXACT to the cent (`signedUsd`, not the rounding
 *     `usdShort` a live EV gets). A realised −$54.02 is a fact and rounding a
 *     fact to −$54 makes it look like an estimate.
 *   - the record ("5-6-1") sits on the row beside the verdict. It is not a
 *     second number competing with the money — it is the SAMPLE the money came
 *     from, and a −$54 with no count behind it cannot be reasoned about.
 *     Pushes are printed only when there are any, so a clean record reads
 *     "4-4" rather than "4-4-0".
 *   - ROI closes the row, DIM. Same argument as the record: −$54 says nothing
 *     about whether the bets were bad until you know what was staked to lose
 *     it. It is deliberately not a second chip — the money keeps the tinted
 *     verdict slot and the rate is read off it. The pair is MIXED on purpose:
 *     the dollars are PRE-fee (Kalshi's own number, and what the owner's
 *     ledger reconciles to), the rate is AFTER fees (the standing metric). The
 *     popover states all three figures so the mix cannot read as a bug.
 *
 * Everything else — how many markets, gross paid out, what they cost, the fees
 * — is in the tap popover, in words, one fact per line.
 *
 * TAPPING A ROW EXPANDS IT (2026-08-29). A tally is not checkable: the account
 * read 8-7 against the owner's own 8-5 ledger and the block, though
 * arithmetically right, could not be opened to show WHICH bets. So a row now
 * lists its settled bets, newest first — the slip words, a win/loss mark and
 * the signed money, which sum to the headline by construction — with the
 * aggregate words kept underneath. Bets NOT placed through this app carry an
 * "auto" tag, because this Kalshi account is shared with the maker pipeline.
 */
export function KalshiRecordBlock({ record, slugTeams }: {
  record: SettlementRecord;
  /** slug -> the card's real team names (teamA=home, teamB=away) — the same
   *  cards every other slug join in the page reads (`buildSlatePairs`'s
   *  source list), just keyed by slug instead of pairKey. Lets an expanded
   *  row upgrade its wording from the ticker's letter code to real names and
   *  logos, with no fetch of its own: a slug missing here (an off-slate
   *  settlement, or a card that scrolled out of the current filter) just
   *  means that one row falls back to the plain cheer-label wording. */
  slugTeams: Map<string, BetGameNames>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows: RecordLine[] = [record.slate, ...record.byType];

  return (
    <div className="mybook-record">
      {rows.map((line) => {
        const head = line.key === "slate";
        const lines = recordLines(line, head ? record.offSlate : 0);
        return (
          <Fragment key={line.key}>
            <button
              type="button"
              className="mybook-record__row"
              data-head={head ? "true" : undefined}
              data-on={open === line.key ? "true" : undefined}
              aria-expanded={open === line.key}
              // The bets the expansion SHOWS are read out here too, so the
              // screen-reader label is the same information as the panel and
              // not just its summary.
              aria-label={[...lines, ...line.bets.map(betPhrase)].join(" ")}
              onClick={() => setOpen((k) => (k === line.key ? null : line.key))}
            >
              <span className="mybook-record__label">{line.label}</span>
              <span className="mybook-record__wl">{recordText(line)}</span>
              <span className="mybook__ev mybook-record__net" data-tone={toneOf(line.net)}>
                {signedUsd(line.net)}
              </span>
              {/* The rate, not a second verdict — dim, and simply absent when
                  there is no cost to divide by. */}
              <span className="mybook-record__roi">{roiText(line)}</span>
            </button>
            {open === line.key && (
              <div role="status" className="mybook__pop mybook__pop--inline">
                {/* The bets FIRST — they are what the tap was asking for; the
                    derivation words stay underneath, unchanged. */}
                <div className="mybook-record__bets">
                  {line.bets.map((b) => <RecordBetRow key={b.key} bet={b} slugTeams={slugTeams} />)}
                </div>
                {lines.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * ONE settled bet inside an expanded row: what it was, whether it won, and
 * what it paid.
 *
 * The mark is a SHAPE-and-position cue that repeats the sign the money already
 * carries — colour is never the only carrier here (the same rule the held /
 * resting dots follow), and "+$28.80" beside it is the actual grade.
 *
 * The "auto" tag marks a bet this app did NOT place. It sits on the exception
 * on purpose: the owner's own bets are the unmarked default, so a clean list
 * has no chrome on it at all.
 */
function RecordBetRow({ bet, slugTeams }: { bet: RecordBet; slugTeams: Map<string, BetGameNames> }) {
  const tone: Tone = bet.result === "won" ? "pos" : bet.result === "lost" ? "neg" : "flat";
  // `bet.key` IS the settled market's ticker (see RecordBet's own doc) — the
  // join `slug` resolves the game, and the ticker + held `side` rebuild the
  // words with that game's real names. Unresolved slug => cheerLabelWithGame
  // falls back to bet.label's own wording internally.
  const game = slugTeams.get(bet.slug);
  const label = cheerLabelWithGame(bet.key, bet.side, game);
  const awayLogo = game ? getTeamLogo(game.teamB) : undefined;
  const homeLogo = game ? getTeamLogo(game.teamA) : undefined;
  return (
    <div className="mybook-record__bet">
      {(awayLogo || homeLogo) && (
        <span className="mybook-record__logos" aria-hidden="true">
          {awayLogo && (
            <img src={awayLogo} alt="" width={16} height={16} loading="lazy"
                 className="mybook-record__logo" />
          )}
          {homeLogo && (
            <img src={homeLogo} alt="" width={16} height={16} loading="lazy"
                 className="mybook-record__logo" />
          )}
        </span>
      )}
      <span className="mybook-record__mark" data-tone={tone} aria-hidden="true" />
      <span className="mybook-record__bet-label">{label}</span>
      {bet.app === false && (
        <span
          className="mybook-record__tag"
          title="Placed outside this app — the maker pipeline, or by hand on Kalshi. Same account, same money."
        >
          auto
        </span>
      )}
      <span className="mybook__ev mybook-record__net" data-tone={tone}>
        {signedUsd(bet.net)}
      </span>
    </div>
  );
}

/** One settled bet as a sentence — the expansion's accessible equivalent. */
function betPhrase(b: RecordBet): string {
  const verb = b.result === "won" ? "won" : b.result === "lost" ? "lost" : "pushed";
  return `${b.label} ${verb} ${signedUsd(b.net)}` +
    (b.app === false ? ", placed outside this app." : ".");
}

/** "5-6-1", or "4-4" when nothing pushed. */
export function recordText(line: RecordLine): string {
  return line.push > 0
    ? `${line.w}-${line.l}-${line.push}`
    : `${line.w}-${line.l}`;
}

/**
 * RETURN ON WHAT WAS RISKED — the standing metric (user, 2026-08-29):
 *
 *     ROI = (revenue − cost − fees) ÷ cost
 *
 * `cost` is the held side's stake (count × fill price, summed by `addTo`), so
 * this is the real per-dollar-staked rate, not a rate against some notional
 * bankroll. FEES ARE INSIDE IT: a rate that ignores the exchange's cut is not
 * the return the account actually earned.
 *
 * The DOLLAR figure beside it on the row is deliberately still the PRE-FEE net
 * — that is the number Kalshi's own app shows and the one the owner's ledger
 * reconciles to (their +$79.42 matched pre-fee exactly). The mix is intentional
 * and the popover reconciles all three figures in words so it can never read
 * as a bug: net before fees, the fees, net after fees, and that the percent
 * includes them. Callers pass the after-fee numerator.
 *
 * Null when there is nothing to divide by. A zero-cost row should not exist
 * (a settled market was bought), but "no percent" is the only honest print for
 * one, and it beats an ∞ or a NaN on a money card.
 */
export function roiOf(netAfterFees: number, cost: number): number | null {
  return cost > 0.005 ? netAfterFees / cost : null;
}

/** Signed to one decimal — and, like `signedUsd`, a rounded-to-zero rate is
 *  not a direction, so it loses its sign. */
export function signedPct(v: number): string {
  const pct = v * 100;
  if (Math.abs(pct) < 0.05) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

/** The row's inline rate — FEE-INCLUSIVE — or "" when it has no cost to
 *  divide by. */
export function roiText(line: RecordLine): string {
  const r = roiOf(line.net - line.fees, line.cost);
  return r === null ? "" : signedPct(r);
}

/**
 * The row's derivation, in words. Also the button's accessible label.
 *
 * The fee sentence is the one that has to be exactly right, so it is measured
 * rather than assumed: Kalshi's settlement `revenue` is the contracts' payout
 * and `*_total_cost_dollars` is count x price — a 50-contract row at 55c costs
 * exactly $27.50 with its $0.22 fee sitting OUTSIDE that. So the fee is stated
 * as what it is (charged at fill, outside both numbers), and the after-fee
 * figure is printed too, so nothing about the real money is hidden by the
 * headline's convention.
 */
export function recordLines(line: RecordLine, offSlate: number): string[] {
  const out: string[] = [];
  const head = line.key === "slate";
  const what = head ? "On this board" : line.label;
  const parts = [`${line.w} won`, `${line.l} lost`];
  if (line.push > 0) parts.push(`${line.push} pushed`);
  out.push(`${what}: ${plural(line.n, "settled market")} — ${parts.join(", ")}.`);
  out.push(
    `Paid out ${usd(line.revenue)} on contracts that cost ${usd(line.cost)}, ` +
    `so the net is ${signedUsd(line.net)}.`
  );
  out.push(
    line.fees > 0
      ? `Fees on those fills: ${usd(line.fees)} — charged when they filled, ` +
        `outside both numbers above. After them it is ${signedUsd(line.net - line.fees)}.`
      : "No fees on these."
  );
  // THE RECONCILIATION, because the row's two numbers are deliberately mixed:
  // the DOLLARS are pre-fee (what Kalshi's own app shows, and what the owner's
  // ledger reconciles to), the RATE is fee-inclusive (the standing metric).
  // Said in words with all three figures present, so the mix can never read as
  // an arithmetic bug.
  const roi = roiOf(line.net - line.fees, line.cost);
  if (roi !== null) {
    out.push(
      `Return: ${signedPct(roi)} on the ${usd(line.cost)} staked — ` +
      (line.fees > 0
        ? `the after-fee ${signedUsd(line.net - line.fees)} over that stake. The row's ` +
          "dollars stay pre-fee, which is what Kalshi's own app shows; the " +
          "percent always includes fees."
        : "the percent includes fees, and there were none on these.")
    );
  }
  // ATTRIBUTION. This Kalshi account is SHARED: the maker pipeline places on
  // it and so does the owner by hand, and those bets settle to the same
  // balance as the ones placed here. The headline deliberately stays the WHOLE
  // account's record — that is what settles to the balance, and ticker-level
  // attribution is far too rough to split a headline on — so the split is said
  // in words instead, right where the "auto" tags are visible.
  const auto = line.bets.filter((b) => b.app === false).length;
  if (auto > 0) {
    out.push(
      (auto === 1
        ? "1 of these was placed outside this app"
        : `${auto} of these were placed outside this app`) +
      " — the maker pipeline, or by hand on Kalshi. Same account, same money; " +
      'they carry the "auto" tag above.'
    );
  }
  if (head && line.bets.length && line.bets.every((b) => b.app === null)) {
    out.push(
      "Which of these came from this app is not known right now — the app's " +
      "own order log resets when the server restarts, so nothing is tagged " +
      "rather than everything being called someone else's."
    );
  }
  if (head && auto > 0) {
    out.push(
      "That split is by MARKET, not by fill: a market this app and the " +
      "pipeline both traded would read as this app's. It is the rough cut, " +
      "not an audit."
    );
  }
  if (head) {
    out.push(
      "Win or loss is the settlement money itself — paid out minus what the " +
      "contracts cost. It is the only grade that fits a held NO and a spread " +
      "that settles at an in-between value."
    );
    if (offSlate > 0) {
      out.push(
        offSlate === 1
          ? "One other settled market is on a game that is not on this board — " +
            "from another week, and not counted here."
          : `${offSlate} other settled markets are on games that are not on this ` +
            "board — from other weeks, and not counted here."
      );
    }
  }
  return out;
}
