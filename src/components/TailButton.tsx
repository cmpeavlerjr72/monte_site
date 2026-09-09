// src/components/TailButton.tsx
//
// HOP ON A FRIEND'S BET — from the feed, or from the game card, whichever the
// reader happens to be looking at (owner 2026-09-09).
//
// ────────────────────────────────────────────────────────────────────────────
// A TAIL IS AN ORDINARY BET. There is exactly one placement path in this app —
// `ConfirmSlip` -> `placeOrders` -> the server's order route — and this button
// is a second DOOR into it, never a second copy of it. It opens the same slip,
// on the same contract, as a TAKE at the current ask, sized in the tailer's own
// unit, on the tailer's own account, under the same caps, the same live-book
// re-check before signing, the same audit line, the same dry-run stage. The
// friend's account is not touched and the friend's stake does not set the
// tailer's: what carries across is WHICH BET, not whose money.
//
// THE SIM DECIDES WHETHER THE DOOR IS OPEN. `tailGate` (src/lib/suggestedBets)
// is the whole rule and it is the Bets panel's own arithmetic:
//
//     edge = simP − ask − takerFeePer(ask, feeParams[series])      > 0
//
// A friend's 41c fill is not an argument for paying 63c an hour later, so a
// bet the sim no longer likes at the CURRENT ask shows a muted button that
// says why ("edge gone at 63c") rather than no button — the reader asked about
// this bet, and silence would read as a bug. There is no Fade button anywhere:
// the inverse of a bet the sim dislikes is not a bet the sim likes.
//
// WHERE THE NUMBERS COME FROM. `TailProvider` carries ONE map of
// `ticker|side` -> the candidate behind it (`useSuggestions().quoteByTicker`):
// the sim's P(YES) and the live book, before any selection. So the gate and the
// panel can never disagree about a market — they read the same compute. A
// contract the compute cannot price (unpublished game, kicked off, no rung)
// has no entry and the button says "no sim for this market".
//
// UNITS, NEVER DOLLARS, ACROSS THE SOCIAL BOUNDARY. What travels from the
// poster is a UNIT COUNT. The budget is the TAILER'S unit times that count, so
// a 2u bet copied with a $10 unit risks $20 of the tailer's money and nobody
// learns anybody's unit size.

import { createContext, useContext, useMemo, useState } from "react";
import { ConfirmSlip } from "./SuggestedBets";
import {
  groupLadders, tailGate, tailSuggestion,
  type Candidate, type FeeParams, type Sizing,
} from "../lib/suggestedBets";
import { newIdempotencyKey } from "../lib/placeOrders";
import type { LeagueId } from "../lib/leagues";

/* ------------------------------ the context ------------------------------- */

/** Everything a Tail button needs that is the same for every row on a page:
 *  the pricing, the account, and who is looking. */
export type TailCtx = {
  /** `ticker|side` -> the candidate behind that contract. */
  quotes: Map<string, Candidate>;
  feeParams: Record<string, FeeParams>;
  /** The TAILER's unit size in dollars, and how they spend it. */
  unit: number;
  sizing: Sizing;
  /** Portal password, where this browser still holds one. The bearer is what
   *  actually attributes the order; both are sent (see placeOrders.ts). */
  token: string;
  /** The account may really submit — drives the slip's staged/live wording.
   *  The server's answer is still authoritative on the response itself. */
  ordersLive: boolean;
  /** Who is looking, so nobody is offered a copy of their own bet. */
  viewerId: string | null;
  /** null = this viewer may place. A string is the reason they may not, in
   *  the words the muted button shows ("sign in to tail"). */
  blocked: string | null;
  /** When the quotes were computed — the slip prints it. */
  quotedAt: Date;
};

const Ctx = createContext<TailCtx | null>(null);

export function TailProvider(
  { value, children }: { value: TailCtx | null; children: React.ReactNode },
) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------- the button ------------------------------- */

export type TailTarget = {
  /** The contract. Without both of these there is nothing to place. */
  ticker: string | null;
  side: "yes" | "no" | null;
  /** The bet being copied — its exchange order id, recorded as
   *  `app_orders.tailed_from`. */
  orderId: string | null;
  /** Whose bet it is. A viewer is never offered their own. */
  userId: string;
  /** Their size, in THEIR units — the multiplier on the tailer's unit. */
  units: number | null;
  /** Attribution carried into the copy, so the tail's own feed row reads like
   *  a bet and not like a ticker. Every one of them is optional. */
  title?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  sport?: string | null;
};

/**
 * ONE BUTTON. Muted with a reason wherever it cannot fire — `data-primary`
 * stays set even then, because it is still the action of the row and a reader
 * scanning for it should find it in the same place, in the same shape.
 */
export default function TailButton(
  { target, compact = false }: { target: TailTarget; compact?: boolean },
) {
  const ctx = useContext(Ctx);
  const [slip, setSlip] = useState<{ idem: string } | null>(null);

  const quote = ctx && target.ticker && target.side
    ? ctx.quotes.get(`${target.ticker}|${target.side}`)
    : undefined;
  const gate = useMemo(
    () => tailGate(quote, ctx?.feeParams ?? {}),
    [quote, ctx?.feeParams],
  );

  /** The poster's size translated into the tailer's money. A poster whose
   *  units we never learned copies at ONE unit — the tailer's own default —
   *  rather than at nothing or at a guess of the poster's. */
  const budget = ctx
    ? ctx.unit * (target.units != null && target.units > 0 ? target.units : 1)
    : 0;

  /** The rung the slip renders: this contract, as a take at the gate's ask,
   *  sized to that budget. Built only when everything needed exists. */
  const group = useMemo(() => {
    if (!ctx || !quote || !gate.ok || gate.ask === null) return null;
    const rung = tailSuggestion({
      quote, ask: gate.ask, feeParams: ctx.feeParams,
      unit: budget, sizing: ctx.sizing,
    });
    return groupLadders([rung], budget)[0] ?? null;
  }, [ctx, quote, gate.ok, gate.ask, budget]);

  // NOT A BET ANYONE CAN COPY: no pricing context on this page, no contract on
  // the row (a legacy hand-typed pick), or it is the reader's own bet.
  if (!ctx || !target.ticker || !target.side) return null;
  if (ctx.viewerId && ctx.viewerId === target.userId) return null;

  const reason = ctx.blocked ?? (gate.ok ? null : gate.why);
  const ready = reason === null && group !== null;
  const size = compact
    ? { padding: "1px 8px", fontSize: 10 }
    : { padding: "3px 11px", fontSize: 11 };

  return (
    <>
      <button
        type="button"
        className="ui-btn"
        data-primary="true"
        data-on={ready ? "true" : undefined}
        disabled={!ready}
        onClick={() => setSlip({ idem: newIdempotencyKey() })}
        // The whole rule, in one line, on hover and as the accessible name.
        title={ready
          ? `Tail this bet — take it at ${cents(gate.ask)} on your own account, ` +
            `${gate.why}`
          : `Cannot tail: ${reason}`}
        aria-label={ready ? `Tail this bet at ${cents(gate.ask)}` : `Cannot tail: ${reason}`}
        style={{
          ...size, fontWeight: 800, flex: "none",
          opacity: ready ? 1 : 0.55,
          cursor: ready ? "pointer" : "not-allowed",
        }}
      >
        Tail
      </button>
      {/* THE REASON IS WORDS, NOT A COLOUR. A disabled button with no sentence
          beside it is a dead end; this is the sentence. */}
      {!ready && (
        <span style={{ fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {reason}
        </span>
      )}

      {slip && group && (
        <ConfirmSlip
          group={group}
          idem={slip.idem}
          token={ctx.token}
          // The slip declares the cap it just warned about, and this bet's
          // budget IS that cap: a 2u tail legitimately outlays two units.
          unit={budget}
          sizing={ctx.sizing}
          feeParams={ctx.feeParams}
          quotedAt={ctx.quotedAt}
          ordersLive={ctx.ordersLive}
          homeTeam={target.home_team || undefined}
          awayTeam={target.away_team || undefined}
          league={leagueOf(target.sport)}
          tailedFrom={target.orderId || undefined}
          onClose={() => setSlip(null)}
        />
      )}
    </>
  );
}

const cents = (p: number | null): string =>
  p === null ? "—" : `${Math.round(p * 100)}¢`;

/** A stored league id, or undefined. Unknown ids are dropped rather than
 *  guessed — the same rule src/lib/leagues.ts applies everywhere else. */
function leagueOf(sport: string | null | undefined): LeagueId | undefined {
  return sport === "fbs" || sport === "fcs" || sport === "ncaab" || sport === "ncaaw"
    ? sport
    : undefined;
}
