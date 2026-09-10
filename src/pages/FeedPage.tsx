// src/pages/FeedPage.tsx  —  route /feed
//
// WHAT YOUR FRIENDS ARE ON. Its own destination since the 2026-09-08 split:
// the book is the book, the profile is the account, and the feed is the social
// half — full width, nothing else competing with it.
//
// TOP LEVEL, NOT UNDER /cfb (owner 2026-09-08). The account, the Kalshi book
// and the friend graph are sport-agnostic — NCAAB arrives next season on the
// same account — so the account pages are mounted at the root and the
// scoreboards stay under /cfb and /cbb. `/cfb/feed` redirects here.
//
// IT FETCHES ALMOST NOTHING OF ITS OWN. `NetworkFeed` reads the RLS-filtered
// `feed_items` view and subscribes to app_orders inserts; the legacy
// env-paired Kalshi friend books read the portal route they always did, and
// render nothing at all when the server declares no pair.
//
// THE ONE EXCEPTION IS THE TAIL GATE (owner 2026-09-09), and since 2026-09-10
// it is shared: `useTailCtx` (src/lib/useTailCtx.ts) is the one wiring of
// week files + live book + the viewer's own account that every page hosting
// a Tail button uses — this one and a friend's page (/u/:handle). A handle
// anywhere in the feed is a link to that page.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import AuthPanel from "../components/AuthPanel";
import NetworkFeed from "../components/NetworkFeed";
import FriendBooks from "../components/FriendBooks";
import { supabaseEnabled, useProfile, useSession } from "../lib/supabase";
import type { BetGameNames } from "../lib/kalshiPortal";
import { TailProvider } from "../components/TailButton";
import { useTailCtx } from "../lib/useTailCtx";

/** Module-level so a memo keyed on them is stable — a fresh `new Map()` per
 *  render is the render-loop trap (docs/AGENT_BRIEF.md rule 4). */
const NO_TEAMS: Map<string, BetGameNames> = new Map();
const NO_CODES: Map<string, string> = new Map();
const NO_PRICE = (): number | null => null;

export default function FeedPage() {
  const { session, loading } = useSession();
  const { profile, loading: profileLoading } = useProfile(session);
  const signedIn = Boolean(session && profile);

  /** Only for the single-week fallback inside NetworkFeed; this page reads the
   *  feed as a timeline (`allWeeks`), so it is a default, not a filter. */
  const { tailCtx, token, settings, sizing, season, week } =
    useTailCtx(session, signedIn);

  useEffect(() => { document.title = "Feed · MVPeav"; }, []);

  if (!supabaseEnabled) {
    return (
      <Shell>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Accounts are not configured for this build.
        </p>
      </Shell>
    );
  }
  if (loading || (session && profileLoading)) {
    return <Shell><Muted>Loading…</Muted></Shell>;
  }
  if (!signedIn) {
    return (
      <Shell>
        <AuthPanel prompt="Log in to see what your friends are on." />
      </Shell>
    );
  }

  return (
    <Shell who={`@${profile?.handle}`}>
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Every bet your friends place through this site lands here as they
          place it. Tap a handle for everything that person is on. Add friends
          by username on <Link to="/me">your profile</Link>.
        </span>

        <TailProvider value={tailCtx}>
          <NetworkFeed
            season={season}
            week={week}
            allWeeks
            startOpen
          />
        </TailProvider>

        {/* The legacy env-paired Kalshi friend books — the owner's paired
            accounts, read-only, through the server route they have always
            used. It renders NOTHING when the server declares no pair, which is
            every account but the owner's. */}
        <FriendBooks token={token} unit={settings.unit} sizing={sizing}
                     slugTeams={NO_TEAMS} codeToSlug={NO_CODES}
                     yesP={NO_PRICE} />
      </div>
    </Shell>
  );
}

function Shell({ children, who }: { children: React.ReactNode; who?: string }) {
  return (
    <section className="card" style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
        marginBottom: 12,
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>
          What your friends are on
        </h1>
        {who && <span style={{ fontSize: 12, color: "var(--muted)" }}>{who}</span>}
        <Link to="/cfb/scoreboard" style={{ marginLeft: "auto", fontSize: 11 }}>
          Scoreboard →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: "var(--muted)" }}>{children}</span>;
}
