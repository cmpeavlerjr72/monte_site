// src/lib/supabase.ts
//
// THE ACCOUNTS CLIENT — anon key only, in the browser only. See
// docs/ACCOUNTS_DESIGN.md for the whole design; the rules that matter here:
//
//   * FEATURE-FLAGGED BY ENV. Without VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
//     `supabaseEnabled` is false, `supabase` is null, and every accounts
//     surface renders NOTHING — the app is byte-for-byte what it was before
//     accounts existed. Same fallback shape as pickem's web/src/pool/supabase.ts.
//   * THE ANON KEY IS NOT A SECRET and the service-role key must never reach
//     this file (it lives in Render env, server-side, and verifies JWTs).
//   * RLS DOES THE FILTERING. Nothing in the client decides who may see what;
//     a query that returns nothing is the database saying no, not a bug to
//     work around with a wider select.
//
// The session lives in localStorage (supabase-js default) so a reload keeps
// the user signed in; `getAccessToken` is how the server-facing fetches
// (placeOrders) attach `Authorization: Bearer <jwt>`.

import { useEffect, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

// Read the env OBJECT rather than two static members. Vite inlines the whole
// object at build, so the browser is unchanged — but node's type-stripping
// runs this module with no `import.meta.env` at all, and the repo's guard
// scripts (check_live_progress, check_fcs_*) import the real .ts files. A
// static member read there is a TypeError that fails a gate for a reason that
// has nothing to do with what the gate checks.
const viteEnv =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {};

const url = viteEnv.VITE_SUPABASE_URL;
const anonKey = viteEnv.VITE_SUPABASE_ANON_KEY;

/** True only when BOTH env vars are present at build time. Every accounts
 *  component checks this first and renders null when false. */
export const supabaseEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url!, anonKey!)
  : null;

// ---------------------------------------------------------------- types

export type ShareScope = "nobody" | "friends" | "everyone";

export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_emoji: string | null;
  share_book: ShareScope;
  is_trader: boolean;
  /** OPTIONAL real contact address. Never a credential: sign-in derives its
   *  address from the handle (see `loginEmailFor`), nothing is sent here by
   *  the app, and it may be null forever. */
  email: string | null;
  /** COSMETIC BADGES, at most 3 (the DB caps cardinality). Each entry is a
   *  catalog id — `team:<school>` or `badge:<id>` — resolved for display by
   *  src/lib/flares.ts. Public within the friend graph, like the handle: it
   *  says something about taste, never about money. */
  flares: string[];
};

/** One row of `feed_items` (the RLS-filtered UNION view). `kind` says which
 *  half it came from; an order row carries no note and a synthetic side.
 *
 *  THERE ARE NO DOLLARS IN THIS TYPE, and that is the point: the view carries
 *  UNITS and the market PRICE only (owner rule 2026-09-08). Counts, costs and
 *  fills are not selected for anyone, including the viewer's own rows, so no
 *  branch here could ever leak them. */
export type FeedItem = {
  /** Which branch of the union this row came from. "score" is a `feed_events`
   *  row — a fact about a GAME addressed to whoever is on it, not a placement
   *  — so it carries a payload and no price, size or ticker. */
  kind: "pick" | "order" | "score";
  id: number;
  user_id: string;
  handle: string;
  display_name: string;
  avatar_emoji: string | null;
  /** The poster's flares, joined in by the view (src/lib/flares.ts renders
   *  them). Null on a row from a server that predates the column. */
  flares: string[] | null;
  season: number | null;
  week: number | null;
  game_slug: string | null;
  market: string;
  side: string;
  line: number | null;
  price: number | null;
  /** SIZE, in units of the poster's OWN unit — never dollars. Null on a row
   *  written before units existed, or one whose unit size could not be read;
   *  the feed then simply shows no size, never a made-up 1u. */
  units: number | null;
  note: string | null;
  source: string;
  ticker: string | null;
  /** THE BET IN WORDS, as the bettor confirmed it ("Rutgers over 23.5
   *  points"). Null on a pick row and on any order placed before the feed
   *  started carrying it — the renderer then falls back to the ticker. */
  title: string | null;
  /** The matchup, so the row can wear the two teams' logos and highlight the
   *  side that was taken. Either may be null. */
  home_team: string | null;
  away_team: string | null;
  /** Our sim's P(YES) at placement, and its EV per $1 staked after the fee.
   *  Both are RATES — the model's opinion of the market, never a quantity of
   *  anyone's money, which is why they are publishable at all. */
  sim_p: number | null;
  ev_fee: number | null;
  /** WHICH LEAGUE this bet is on — a league id from src/lib/leagues.ts
   *  ("fbs" / "fcs" / "ncaab" / "ncaaw"). Null on every row placed before the
   *  book went sport-agnostic; null means NO CHIP, never a guessed one. */
  sport: string | null;
  /** The exchange's own order id for an order row, and the order a score
   *  update is ABOUT for a score row. An opaque identifier, never an amount —
   *  it is what lets a tail find the bet it copied inside the same
   *  RLS-filtered result set. Null on a pick and on legacy rows. */
  order_id: string | null;
  /** THIS BET IS A COPY of the order with that id. The renderer resolves it
   *  against the rows it already has: found, the line reads "roth tailed
   *  mvpeav"; not found (the parent is outside the loaded window, or the
   *  viewer may not see it), it reads as a tail without naming anyone. */
  tailed_from: string | null;
  /** Settled: when the exchange paid, the grade, and the money in the
   *  poster's OWN units, net of fees. All three null while a bet is open.
   *  `result` is graded pre-fee (the sign of revenue − cost) to agree with My
   *  Book's record; `units_net` is fee-inclusive, like every ROI here. */
  settled_at: string | null;
  result: "won" | "lost" | "push" | null;
  units_net: number | null;
  /** A score row's contents: the score, the period and clock, the bet's side
   *  in words, and the probability of that side either side of the play.
   *  Null on every other kind. */
  payload: FeedScorePayload | null;
  at: string;
};

/** `feed_events.payload` for kind 'score'. Everything in it is either public
 *  (a score, a clock) or a RATE (two probabilities) or a unit count — the
 *  same test every other feed column passes. */
export type FeedScorePayload = {
  score?: {
    home_team?: string; away_team?: string;
    home?: number; away?: number;
  };
  period?: number;
  clock?: string;
  /** The bet this update is about, in the words the slip used. */
  side?: string;
  prob_before?: number;
  prob_after?: number;
  units?: number;
  [k: string]: unknown;
};

/** Minimum a stranger lookup returns (find_profile RPC). */
export type FoundProfile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_emoji: string | null;
};


// --------------------------------------------------------------- hooks

/**
 * The signed-in session, or null. `loading` is true until the first
 * getSession resolves, so a gated surface can avoid flashing its
 * signed-out prompt at a signed-in user on every page load.
 *
 * With Supabase disabled this settles immediately at {session: null,
 * loading: false, enabled: false} and starts no listener at all.
 */
export function useSession(): { session: Session | null; loading: boolean; enabled: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  return { session, loading, enabled: supabaseEnabled };
}

/**
 * The signed-in user's own profile row, or null when they have not created
 * one yet (first sign-in) — which is exactly what AuthPanel's handle form
 * keys off. `reload` re-reads after an edit.
 */
export function useProfile(session: Session | null): {
  profile: Profile | null;
  loading: boolean;
  reload: () => void;
} {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const uid = session?.user?.id ?? "";

  useEffect(() => {
    if (!supabase || !uid) { setProfile(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_emoji, share_book, is_trader, email, flares")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [uid, nonce]);

  return { profile, loading, reload: () => setNonce((n) => n + 1) };
}

// -------------------------------------------------------------- tokens

/**
 * The current access token, for server calls that must be attributable to a
 * user (`Authorization: Bearer <jwt>`; server/liveScores.ts `supabaseAuth`).
 * Returns null when accounts are disabled or nobody is signed in — callers
 * then send only the legacy `x-cfb-token` password and the server behaves
 * exactly as it did before accounts existed.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Handles are lower-case `[a-z0-9_]{3,20}` — the CHECK constraint in
 *  supabase/migrations/20260908_accounts.sql, restated so the form can say no
 *  before the database does. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** Sign-up password floor (docs/ACCOUNTS_DESIGN.md: >= 10 chars). */
export const MIN_PASSWORD = 10;

/* ------------------------- THE DERIVED LOGIN ADDRESS ---------------------- */
/**
 * LOGIN IS BY USERNAME (owner decision 2026-09-08). Supabase Auth insists on
 * an email address, so the address is DERIVED from the username and never
 * typed by anyone:
 *
 *     `${handle.toLowerCase()}@mvpeav.com`
 *
 * It is a routing artefact, not a mailbox — this project has no SMTP sender,
 * email confirmation is OFF, and no mail is ever sent to it. A user's REAL
 * address, if they choose to leave one, lives on `profiles.email` and is only
 * so the owner can reach them.
 *
 * ONE FUNCTION, both directions of the flow: sign-up creates the account at
 * this address and sign-in re-derives the same one, so the two can never
 * disagree about who a username is.
 *
 * THE ONE EXCEPTION, for the cutover: an input that already contains "@" is
 * taken VERBATIM. Accounts created before this change were made with a real
 * address, and deriving one for them would lock them out of their own
 * account. A handle can never contain "@" (HANDLE_RE), so the two cases
 * cannot collide.
 */
// 2026-09-08 9:58 PM: Supabase public sign-up refuses an address whose domain
// has no DNS record ("email_address_invalid"); users.mvpeav.com has none, the
// site's own domain does. The admin API had accepted the subdomain, which is
// why the roth account was first created there and then moved.
export const AUTH_EMAIL_DOMAIN = "mvpeav.com";

export function loginEmailFor(username: string): string {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${AUTH_EMAIL_DOMAIN}`;
}
