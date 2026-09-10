// src/pages/FriendPage.tsx  —  route /u/:handle
//
// ONE PERSON, EVERYTHING THEY ARE ON (owner 2026-09-10: "click on my friend's
// handle, either in the feed or on my friends list, and see all their open
// positions and tail directly from there instead of having to go through the
// feed to find everything").
//
// The feed answers "who is on this game". This page answers the other
// question — "what is this person on" — and it is reached from every place a
// handle is printed: a friend bucket in the feed, a row of the friends list on
// /me. It is the same rows, the same cards and the same Tail button as the
// feed, filtered to one poster; the friend header inside each card is dropped
// because the page's own title already says whose bets these are.
//
// OPEN FIRST. The point of the page is the Tail button, and only an open
// position has one, so the open positions are the page and the settled ones
// sit folded underneath with their record. A score update rides with the game
// it is about, in the open section only — once the position has settled the
// score is history.
//
// WHAT THE VIEWER MAY SEE IS THE DATABASE'S CALL, as everywhere: `feed_items`
// is a security_invoker view, so filtering it by handle returns exactly this
// person's rows that RLS lets THIS viewer read — a stranger with a private
// book comes back empty, and so does a friend whose share is "nobody". The
// header reads `profiles` under the same rules (own, friends, pending
// counterparts, book-visible); when that returns nothing the exact-handle RPC
// still names the person, so the page can say "you are not friends" rather
// than "no such account" to someone who typed a real handle.
//
// NO DOLLARS, NO COUNTS — units of the poster's own unit and market prices,
// which is all the view carries for anyone. A tail is sized in the VIEWER's
// unit (TailButton), so nobody learns anybody's unit size here either.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AuthPanel from "../components/AuthPanel";
import Flares from "../components/Flares";
import { FeedCards, useFeedItems } from "../components/NetworkFeed";
import { TailProvider } from "../components/TailButton";
import {
  supabase, supabaseEnabled, useProfile, useSession,
  type FeedItem, type FoundProfile,
} from "../lib/supabase";
import { bucketKeyOf, positionsOf } from "../lib/feedBuckets";
import { useTailCtx } from "../lib/useTailCtx";

type Person = {
  id: string;
  handle: string;
  display_name: string;
  avatar_emoji: string | null;
  flares: string[] | null;
  /** True when `profiles` itself answered — the viewer may see this person's
   *  book (own, friend, pending, or a public book). False when only the
   *  exact-handle RPC knew the name. */
  visible: boolean;
};

export default function FriendPage() {
  const { handle: raw } = useParams();
  const handle = (raw ?? "").trim().toLowerCase();

  const { session, loading } = useSession();
  const { profile, loading: profileLoading } = useProfile(session);
  const signedIn = Boolean(session && profile);
  const isMe = Boolean(profile && profile.handle === handle);

  const { tailCtx } = useTailCtx(session, signedIn);

  /** Who this is. `undefined` = still looking; null = no such account. */
  const [who, setWho] = useState<Person | null | undefined>(undefined);
  const [showSettled, setShowSettled] = useState(false);

  useEffect(() => {
    document.title = `${handle ? `@${handle}` : "Friend"} · MVPeav`;
  }, [handle]);

  useEffect(() => {
    if (!supabase || !signedIn || !handle) return;
    let alive = true;
    setWho(undefined);
    (async () => {
      // Both at once (each is a round trip): the profile row when the viewer
      // may see this person's book, and the exact-handle RPC — which returns
      // the minimum, never the book — so a real handle behind a private book
      // still gets its name. The profile row wins when it exists.
      const [{ data }, { data: found }] = await Promise.all([
        supabase!
          .from("profiles")
          .select("id, handle, display_name, avatar_emoji, flares")
          .eq("handle", handle)
          .maybeSingle(),
        supabase!.rpc("find_profile", { p_handle: handle }),
      ]);
      if (!alive) return;
      if (data) {
        setWho({ ...(data as Omit<Person, "visible">), visible: true });
        return;
      }
      const row = (Array.isArray(found) ? found[0] : found) as FoundProfile | undefined;
      setWho(row ? { ...row, flares: null, visible: false } : null);
    })();
    return () => { alive = false; };
  }, [signedIn, handle]);

  const { items, err, live, loaded } = useFeedItems({
    signedIn: signedIn && Boolean(handle), handle, allWeeks: true, limit: 300,
  });

  /** OPEN vs SETTLED. An order row with no result is open; a score update
   *  belongs to the open section when its game still has an open position. */
  const { openItems, settledItems } = useMemo(() => {
    const open: FeedItem[] = [];
    const settled: FeedItem[] = [];
    const openGames = new Set<string>();
    for (const i of items) {
      if (i.kind === "score") continue;
      if (i.result) settled.push(i);
      else { open.push(i); openGames.add(bucketKeyOf(i)); }
    }
    for (const i of items) {
      if (i.kind === "score" && openGames.has(bucketKeyOf(i))) open.push(i);
    }
    return { openItems: open, settledItems: settled };
  }, [items]);

  /** The header's numbers, from positions (a ladder is one bet, not three). */
  const stats = useMemo(() => {
    const open = positionsOf(openItems).length;
    const done = positionsOf(settledItems);
    let won = 0, lost = 0, push = 0, flips = 0, net = 0;
    for (const p of done) {
      if (p.net != null) net += p.net;
      if (p.closedBy === "sell") flips += 1;
      else if (p.net != null && p.net > 0) won += 1;
      else if (p.net != null && p.net < 0) lost += 1;
      else push += 1;
    }
    return { open, settled: done.length, won, lost, push, flips, net };
  }, [openItems, settledItems]);

  if (!supabaseEnabled) {
    return (
      <Shell handle={handle}>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Accounts are not configured for this build.
        </p>
      </Shell>
    );
  }
  if (loading || (session && profileLoading)) {
    return <Shell handle={handle}><Muted>Loading…</Muted></Shell>;
  }
  if (!signedIn) {
    return (
      <Shell handle={handle}>
        <AuthPanel prompt={`Log in to see what @${handle} is on.`} />
      </Shell>
    );
  }
  if (!handle) {
    return (
      <Shell handle="">
        <Muted>No handle in the address. Pick a friend on <Link to="/me">your profile</Link>.</Muted>
      </Shell>
    );
  }

  const name = who?.display_name || handle;

  return (
    <Shell handle={handle}>
      {/* ------------------------------ who ------------------------------ */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        <span aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>
          {who?.avatar_emoji || "🏈"}
        </span>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {who === undefined ? "…" : who === null ? `@${handle}` : name}
            </span>
            <Flares flares={who?.flares} size={16} />
            {isMe && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>(you)</span>}
          </span>
          {who && who.display_name && who.display_name !== handle && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>@{handle}</span>
          )}
        </div>
        {loaded && (who?.visible || items.length > 0) && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
            <strong style={{ color: "var(--text)" }}>
              {stats.open} open
            </strong>
            {stats.settled > 0 && (
              <>
                {" · "}
                <span title={`${stats.won} won, ${stats.lost} lost`
                  + (stats.push ? `, ${stats.push} push` : "")
                  + (stats.flips ? `, ${stats.flips} sold before settlement` : "")
                  + ", in their own units net of fees"}>
                  {stats.won}–{stats.lost}
                  {stats.push > 0 && `–${stats.push}`}
                  {stats.flips > 0 && ` · ${stats.flips} flip${stats.flips === 1 ? "" : "s"}`}
                  {" · "}
                  <strong style={{ color: toneOf(stats.net) }}>
                    {sign(stats.net)}{Math.abs(stats.net).toFixed(2)}u
                  </strong>
                </span>
              </>
            )}
          </span>
        )}
      </div>

      {err && <span style={{ fontSize: 12, color: "var(--neg)" }}>{err}</span>}

      {/* ------------------------- not yours to see ----------------------- */}
      {who === null && loaded && (
        <Muted>No account with that handle. Handles are exact.</Muted>
      )}
      {who && !who.visible && loaded && items.length === 0 && (
        <Muted>
          You are not friends with @{handle}, or their book is private.
          Send a request on <Link to="/me">your profile</Link>.
        </Muted>
      )}

      {/* ------------------------------ open ----------------------------- */}
      {(who?.visible || items.length > 0) && (
        <div className="fd">
          <div className="fd__meta">
            <span style={{ fontWeight: 800, color: "var(--text)" }}>Open</span>
            <span className="fd__dot" aria-hidden>·</span>
            <span title={live
              ? "New bets appear as they are placed."
              : "The live channel is down; this page re-reads itself every minute."}>
              {live ? "live" : "refreshes every minute"}
            </span>
            {isMe && (
              <>
                <span className="fd__dot" aria-hidden>·</span>
                <Link to="/mybook" style={{ fontSize: 11 }}>My Book →</Link>
              </>
            )}
          </div>
          <TailProvider value={tailCtx}>
            <FeedCards
              items={openItems}
              solo
              empty={loaded
                ? (isMe ? "You have nothing open." : `@${handle} has nothing open right now.`)
                : "Loading…"}
            />
          </TailProvider>
        </div>
      )}

      {/* ----------------------------- settled --------------------------- */}
      {settledItems.length > 0 && (
        <div className="fd">
          <button type="button" className="fdc__more" style={{ justifySelf: "start" }}
                  onClick={() => setShowSettled((v) => !v)} aria-expanded={showSettled}>
            {showSettled ? "Hide settled" : `Settled · ${stats.settled}`}
            <span aria-hidden style={{ marginLeft: 5, opacity: 0.7 }}>
              {showSettled ? "▴" : "▾"}
            </span>
          </button>
          {showSettled && <FeedCards items={settledItems} solo />}
        </div>
      )}
    </Shell>
  );
}

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±");
const toneOf = (v: number) =>
  v > 0 ? "var(--pos)" : v < 0 ? "var(--neg)" : "var(--muted)";

function Shell({ children, handle }: { children: React.ReactNode; handle: string }) {
  return (
    <section className="card" style={{ padding: 16, maxWidth: 760, margin: "0 auto",
                                       display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>
          {handle ? `What @${handle} is on` : "Friend"}
        </h1>
        <Link to="/feed" style={{ marginLeft: "auto", fontSize: 11 }}>Feed →</Link>
        <Link to="/me" style={{ fontSize: 11 }}>Friends →</Link>
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: "var(--muted)" }}>{children}</span>;
}
