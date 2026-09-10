// src/lib/useTailCtx.ts
//
// THE TAIL GATE, AS ONE HOOK — for every page that shows a friend's bet with
// a Tail button beside it (/feed, and /u/:handle since 2026-09-10).
//
// A Tail button may only offer a bet the sim still likes AT THE CURRENT ASK,
// and that is a judgement no Supabase row carries: it needs this week's
// published probabilities and the live Kalshi book. So a page that hosts Tail
// buttons loads the same three week files the scoreboard does and runs the
// same compute over them (src/lib/tailQuotes.ts) — one pricing path for the
// whole app, never a second opinion living on a social surface.
//
// This hook is that wiring, lifted out of FeedPage so a second page could not
// drift from the first: the viewer's own book (may they place at all, live or
// staged), the dataset week, the quotes, and the reason a button is muted, in
// the words it shows. None of it is fetched for a reader who cannot trade.

import { useMemo } from "react";
import type { Session } from "@supabase/supabase-js";
import type { TailCtx } from "../components/TailButton";
import { localSettings, type UserSettings } from "./userSettings";
import type { Sizing } from "./suggestedBets";
import { readPortalToken, usePortalBook } from "./kalshiPortal";
import { readSlateGames, type CachedSlate } from "./slateCache";
import { useTailQuotes } from "./tailQuotes";

export type TailWiring = {
  tailCtx: TailCtx;
  /** Portal password, where this browser still holds one. */
  token: string;
  settings: UserSettings;
  sizing: Sizing;
  /** The slate the scoreboard left in the cache, if any. */
  slate: CachedSlate | null;
  season: number;
  week: number;
};

export function useTailCtx(session: Session | null, signedIn: boolean): TailWiring {
  const token = useMemo(() => readPortalToken(), []);
  const settings = useMemo(() => localSettings(), []);
  const sizing: Sizing = {
    mode: settings.mode,
    maxRiskMultiple: settings.mode === "risk" ? 1 : settings.multiple,
  };
  const slate = useMemo(() => readSlateGames(), []);

  /** The viewer's own book: whether they may place at all, and whether their
   *  account is live or staged. `usePortalBook` takes the signed-in path when
   *  this browser holds no portal password, which is the ordinary case for
   *  everyone but the owner. */
  const portal = usePortalBook(token, signedIn);
  /** WHY a Tail button is muted, in the words it shows. Null = go. */
  const blocked =
    !signedIn ? "sign in to tail"
    : portal.status === "loading" ? "checking your book"
    : portal.status === "ok" ? null
    : portal.status === "forbidden" || portal.status === "idle"
      || portal.status === "unauthorized" ? "link a Kalshi key to tail"
    : "your book is unreachable";

  /** The dataset week directory. The scoreboard leaves it in the slate cache;
   *  a slate written before it did falls back to the naming convention, which
   *  is a guess that resolves to an empty quote map if it is wrong (every
   *  button then says "no sim for this market" rather than lying). */
  const season = slate?.season ?? new Date().getFullYear();
  const weekId = slate?.weekId
    ?? `week${String(slate?.week ?? 0).padStart(2, "0")}`;
  const tail = useTailQuotes({
    season, weekId, unit: settings.unit, sizing,
    // Not a byte is fetched for a reader who could not place the bet.
    enabled: signedIn && blocked !== "sign in to tail",
  });

  const tailCtx: TailCtx = useMemo(() => ({
    quotes: tail.quotes,
    feeParams: tail.feeParams,
    unit: settings.unit,
    sizing,
    token,
    ordersLive: portal.payload?.orders_live === true,
    viewerId: session?.user?.id ?? null,
    blocked,
    quotedAt: tail.quotedAt,
    // `sizing` is rebuilt every render from primitives; depending on its
    // identity would hand a new context down on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tail.quotes, tail.feeParams, tail.quotedAt, settings.unit,
       sizing.mode, sizing.maxRiskMultiple, token,
       portal.payload?.orders_live, session?.user?.id, blocked]);

  return { tailCtx, token, settings, sizing, slate, season, week: slate?.week ?? 0 };
}
