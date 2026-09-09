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

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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
};

/** One row of `feed_items` (the RLS-filtered UNION view). `kind` says which
 *  half it came from; an order row carries no note and a synthetic side. */
export type FeedItem = {
  kind: "pick" | "order";
  id: number;
  user_id: string;
  handle: string;
  display_name: string;
  avatar_emoji: string | null;
  season: number | null;
  week: number | null;
  game_slug: string | null;
  market: string;
  side: string;
  line: number | null;
  price: number | null;
  note: string | null;
  source: string;
  ticker: string | null;
  at: string;
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
      .select("id, handle, display_name, avatar_emoji, share_book, is_trader")
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
