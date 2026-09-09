// src/pages/BookDashboard.tsx  —  route /mybook
//
// MY BOOK, AND ONLY MY BOOK (owner split 2026-09-08). What this account has
// riding, what is resting, and what has settled. Nothing else: the social half
// moved to /feed and everything about the person moved to /me, so the three
// destinations answer three different questions and none of them is a
// scroll past the other two.
//
// TOP LEVEL, NOT UNDER /cfb. The account and its Kalshi book are
// sport-agnostic — NCAAB lands on the same account next season — so this page
// is mounted at the root and `/cfb/mybook` redirects here. The scoreboards
// stay under /cfb and /cbb.
//
// THREE RULES, unchanged by the split:
//
//  1. SIGN-IN GATES THIS PAGE AND ONLY THIS PAGE. Scoreboard, Top Edges and
//     props stay public; here a signed-out visitor gets the AuthPanel inline.
//  2. NO NEW DATA FETCHES. The portal payload the site already polls, and
//     Supabase — nothing else.
//  3. THE SIM PRICES THE BOOK (owner, 2026-09-09 12:20 AM). It used to price
//     nothing: portal bets were computed with EMPTY slate maps and every row
//     read "Sim EV —", which is not honesty, it is a missing load. The page
//     now builds the SAME four pricing inputs the Scoreboard builds — the
//     Kalshi feed, the seed arrays for the book's own games, and the published
//     team_stats rungs + `game` block — through `useBookPricing`
//     (src/lib/bookPricing.ts), which imports the existing builders and adds
//     no math of its own. A position on a game no published week carries
//     still has no verdict, and says "no sim" rather than "—".

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AuthPanel from "../components/AuthPanel";
import MyBookStrip from "../components/MyBook";
import { supabaseEnabled, useProfile, useSession } from "../lib/supabase";
import {
  computePortalBets, readPortalToken, usePortalBook, writePortalToken,
  type BetGameNames,
} from "../lib/kalshiPortal";
import { useBookPricing } from "../lib/bookPricing";
import { useBookGames, usePlacedTimes } from "../lib/bookGames";
import { settledBets } from "../lib/bookTree";
import BookTree from "../components/BookTree";
import { fetchMySettings, localSettings } from "../lib/userSettings";

export default function BookDashboard() {
  const { session, loading } = useSession();
  const { profile, loading: profileLoading } = useProfile(session);
  const signedIn = Boolean(session && profile);

  /* ---- the portal book: the SAME payload the scoreboard polls ----
   * A signed-in owner (CFB_PORTAL_OWNERS) or a user with their own linked
   * Kalshi key gets in on the bearer alone; the legacy portal password still
   * works and is still offered, because it is the owner's way in through the
   * cutover. */
  const [token, setToken] = useState<string>(() => readPortalToken());
  const portal = usePortalBook(token, signedIn);
  /* The sim's side of every row: the Kalshi feed, the book's own seed arrays
   * and the published rungs, loaded once per CHANGE OF BOOK (not per poll).
   * Same builders the Scoreboard uses — see src/lib/bookPricing.ts. */
  const pricing = useBookPricing(portal.payload, portal.status === "ok");
  const book = useMemo(
    () => computePortalBets(
      portal.payload, pricing.kalshiBySlug, pricing.seeds,
      pricing.statYesP, pricing.gameYesP,
    ),
    [portal.payload, pricing],
  );

  useEffect(() => { document.title = "My Book · MVPeav"; }, []);

  /* ---- the SETTLED TREE's inputs ----
   * The join to each bet's published game (open spread, open total, kickoff,
   * conference class) and the app's own order log for entry timing. Both are
   * keyed on primitive signatures, so the 30s portal poll costs nothing. */
  const games = useBookGames(portal.settlements);
  const placed = usePlacedTimes(session?.user?.id ?? null);
  const settled = useMemo(
    () => settledBets(portal.settlements, games.byPair, placed),
    [portal.settlements, games.byPair, placed],
  );

  /* The UNIT is on the account, not this browser (userSettings.ts rule 1), so
   * it comes from the settings RPC with the local mirror as the fallback. */
  const [unit, setUnit] = useState<number>(() => localSettings().unit);
  useEffect(() => {
    let alive = true;
    fetchMySettings().then((v) => { if (alive && v) setUnit(v.unit); });
    return () => { alive = false; };
  }, [session?.user?.id]);

  if (!supabaseEnabled) {
    return (
      <Page>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Accounts are not configured for this build.
        </p>
      </Page>
    );
  }
  if (loading || (session && profileLoading)) {
    return <Page><Muted>Loading…</Muted></Page>;
  }
  if (!signedIn) {
    return (
      <Page>
        <AuthPanel prompt="Log in to see your book." />
      </Page>
    );
  }

  return (
    <Page who={profile?.handle}>
      <Section
        title="My positions"
        note="Held bets and resting orders, live from Kalshi.">
        <Positions
          token={token}
          pricingReady={pricing.ready}
          onToken={(t) => { writePortalToken(t); setToken(t); }}
          status={portal.status}
          bets={book.bets}
          totals={book.totals}
          accountLabel={portal.payload?.account_label}
          ordersLive={portal.payload?.orders_live === true}
          slugTeams={pricing.names}
        />
      </Section>

      {settled.length > 0 && (
        <Section
          title="Settled"
          note="The whole account, cut the way the sim is graded.">
          <SettledTree
            bets={settled} unit={unit}
            ready={games.ready} joined={games.joined}
            withLine={games.withLine} total={games.total}
          />
        </Section>
      )}

      <Section
        title="Elsewhere"
        note="The rest of the account lives on its own pages.">
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          What your friends are on is on <Link to="/feed">the feed</Link>.
          Your display name, flares, friends, unit size and Kalshi link are on{" "}
          <Link to="/me">your profile</Link>.
        </span>
      </Section>
    </Page>
  );
}

/* ------------------------------- positions ------------------------------- */

function Positions({
  token, onToken, status, bets, totals, accountLabel, ordersLive, pricingReady,
  slugTeams,
}: {
  token: string;
  /** slug -> the game's real names, from the same pricing load. What lets a
   *  row draw the team as its LOGO instead of the ticker's letter code. */
  slugTeams: Map<string, BetGameNames>;
  /** False until the week docs have answered — a book-wide "no sim" that is
   *  only not-loaded-yet would be a lie the page tells for a second. */
  pricingReady: boolean;
  onToken: (t: string) => void;
  status: ReturnType<typeof usePortalBook>["status"];
  bets: ReturnType<typeof computePortalBets>["bets"];
  totals: ReturnType<typeof computePortalBets>["totals"];
  accountLabel?: string;
  ordersLive: boolean;
}) {
  // A SIGNED-IN NON-TRADER is the common case now, and it is not an error:
  // this account simply has no Kalshi behind it yet. Say that, and point at
  // the card that fixes it — never a password box, which would be the wrong
  // offer entirely.
  if (status === "forbidden") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          Trading is not enabled on this account.
        </span>
        <Muted>
          Link your own Kalshi account on <Link to="/me">your profile</Link>{" "}
          and your positions, resting orders and settlements appear here.
        </Muted>
      </div>
    );
  }
  if (status === "locked") {
    return <Muted>Too many failed logins — the portal is cooling down for a minute.</Muted>;
  }
  if (status === "unconfigured") {
    return <Muted>The server has no Kalshi portal configured.</Muted>;
  }
  if (status === "idle" || status === "unauthorized") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {status === "unauthorized" && (
          <span style={{ fontSize: 11, color: "var(--neg)" }}>
            That portal password was not accepted.
          </span>
        )}
        <Muted>
          No Kalshi account on this login yet. Link your own on{" "}
          <Link to="/me">your profile</Link> — or, if you have the site's
          portal password, connect with it.
        </Muted>
        <form
          style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            const t = String(new FormData(e.currentTarget).get("tok") || "").trim();
            if (t) onToken(t);
          }}
        >
          <input name="tok" type="password" placeholder="portal password"
                 className="ui-sel" autoComplete="current-password"
                 style={{ fontSize: 12 }} />
          <button type="submit" className="ui-btn" style={BTN}>Connect</button>
        </form>
      </div>
    );
  }
  if (status === "loading") return <Muted>Loading your book…</Muted>;
  if (status === "error") return <Muted>Kalshi is unreachable right now — retrying.</Muted>;

  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {accountLabel ? `Connected — ${accountLabel}` : "Connected"}
          {ordersLive ? "" : " · orders staged (nothing is sent to Kalshi)"}
        </span>
        {token && (
          <button type="button" className="ui-btn" onClick={() => onToken("")}
                  style={{ ...BTN, marginLeft: "auto" }}>
            Disconnect password
          </button>
        )}
      </div>

      {bets.length === 0 ? (
        <Muted>Nothing held and nothing resting.</Muted>
      ) : (
        <>
          {/* Sim EV is real here now: `useBookPricing` loaded the same feed,
              seeds and published rungs the Scoreboard prices with. */}
          <MyBookStrip bets={bets} token={token} slugTeams={slugTeams} mixed />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {!pricingReady
              ? "Pricing the book against the published sims…"
              : totals.simPriced === totals.n
                ? "Sim EV is the published sim's verdict on each market, against the price this book paid."
                : `Sim EV is priced on ${totals.simPriced} of ${totals.n}. "no sim" means the game is not on a published week; "—" means the week is published but nothing we simulate maps to that market.`}
          </span>
          <span style={{ fontSize: 11 }}>
            {totals.n} in the book · risked ${totals.risked.toFixed(2)} to win
            ${totals.toWin.toFixed(2)}
          </span>
        </>
      )}
    </div>
  );
}

/* ------------------------------- settled tree ----------------------------- */

/**
 * THE SETTLED TREE (owner, 2026-09-09 12:15 AM). It replaces the flat
 * "Settled 5W-6L −$54.02" block that stood here: a headline plus one line per
 * bet type could say WHAT lost, never WHERE — which regime, which side, which
 * band, which week — and "where" is the whole question the regime scorecard
 * exists to answer (scripts/regime_scorecard.py, owner rule 2026-09-08).
 *
 * The cuts are that scorecard's FIXED cells, applied to the account's own
 * money. Dollars are right here and only here: this is the owner's book, not a
 * backtest's unit ledger, so the tree prints real dollars with the profile's
 * unit beside them.
 *
 * The JOIN RATE is stated, never assumed. A settled market reaches its open
 * spread, open total, kickoff and conference class only through the published
 * week files; one that joins nothing still counts, under its family, marked
 * "no line" — and the line under the tree says how many of them there are,
 * because a cut computed on two thirds of a book is a different claim from one
 * computed on all of it.
 */
function SettledTree({ bets, unit, ready, joined, withLine, total }: {
  bets: ReturnType<typeof settledBets>;
  unit: number;
  ready: boolean;
  joined: number;
  withLine: number;
  total: number;
}) {
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <BookTree bets={bets} unit={unit} />
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        {!ready
          ? "Joining these to their published games…"
          : `${joined} of ${total} settled markets joined a published game; ` +
            `${withLine} of those carry a book open spread. The rest still count — ` +
            "they sit under their family, marked \"no line\", and every regime cut " +
            "says how many it could not place."}
        {unit > 0
          ? ` Units are at your $${unit.toFixed(2)} unit, from your profile.`
          : " Set a unit size on your profile to see these in units."}
      </span>
    </div>
  );
}

/* --------------------------------- shell --------------------------------- */

function Page({ children, who }: { children: React.ReactNode; who?: string }) {
  return (
    <section className="card" style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>My Book</h1>
        {who && <span style={{ fontSize: 12, color: "var(--muted)" }}>{who}</span>}
        <Link to="/cfb/scoreboard" style={{ marginLeft: "auto", fontSize: 11 }}>
          Scoreboard →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Section({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10,
      display: "grid", gap: 8, minWidth: 0,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{title}</span>
        {note && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: "var(--muted)" }}>{children}</span>;
}

const BTN: React.CSSProperties = { padding: "3px 10px", fontSize: 11 };
const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--muted)",
};
