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
//  3. THE SIM PRICES NOTHING HERE. Portal bets are computed with EMPTY slate
//     maps, so every row's KALSHI EV is live and real and its SIM EV is an
//     honest "—". A page that guessed at fair value would be inventing numbers
//     it has no data to support; the per-game Bets panel is where sim pricing
//     lives.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AuthPanel from "../components/AuthPanel";
import MyBookStrip from "../components/MyBook";
import { supabaseEnabled, useProfile, useSession } from "../lib/supabase";
import {
  cheerLabel, computePortalBets, readPortalToken, usePortalBook,
  writePortalToken,
} from "../lib/kalshiPortal";
import type { PortalSettlement, SeedPair } from "../lib/kalshiPortal";
import type { KalshiGame } from "../lib/kalshi";

/** Module-level so the compute memo below is keyed on the payload alone —
 *  a fresh `new Map()` per render is the render-loop trap this file must not
 *  fall into (docs/AGENT_BRIEF.md rule 4). */
const NO_KALSHI: Map<string, KalshiGame> = new Map();
const NO_SEEDS: Map<string, SeedPair> = new Map();

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
  const book = useMemo(
    () => computePortalBets(portal.payload, NO_KALSHI, NO_SEEDS),
    [portal.payload],
  );

  useEffect(() => { document.title = "My Book · MVPeav"; }, []);

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
    <Page who={`@${profile?.handle}`}>
      <Section
        title="My positions"
        note="Held bets and resting orders, live from Kalshi.">
        <Positions
          token={token}
          onToken={(t) => { writePortalToken(t); setToken(t); }}
          status={portal.status}
          bets={book.bets}
          totals={book.totals}
          settlements={portal.settlements}
          accountLabel={portal.payload?.account_label}
          ordersLive={portal.payload?.orders_live === true}
        />
      </Section>

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
  token, onToken, status, bets, totals, settlements, accountLabel, ordersLive,
}: {
  token: string;
  onToken: (t: string) => void;
  status: ReturnType<typeof usePortalBook>["status"];
  bets: ReturnType<typeof computePortalBets>["bets"];
  totals: ReturnType<typeof computePortalBets>["totals"];
  settlements: PortalSettlement[] | null;
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
          {/* Sim EV reads "—" on every row here, by design: this page loads no
              week, so it has no fair value to quote. The Kalshi side is live. */}
          <MyBookStrip bets={bets} token={token} />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            Sim EV is blank here — the fair values live with the games. Open a
            game's Bets panel on the <Link to="/cfb/scoreboard">scoreboard</Link>{" "}
            for the sim's verdict on a market.
          </span>
          <span style={{ fontSize: 11 }}>
            {totals.n} in the book · risked ${totals.risked.toFixed(2)} to win
            ${totals.toWin.toFixed(2)}
          </span>
        </>
      )}

      <Settled rows={settlements} />
    </div>
  );
}

/** The realised half, in the same words the book uses. Fee-inclusive by the
 *  standing rule: revenue − cost − fees, never a fee-blind number. */
function Settled({ rows }: { rows: PortalSettlement[] | null }) {
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;
  const net = (s: PortalSettlement) => s.revenue - s.cost - s.fees;
  const total = rows.reduce((a, s) => a + net(s), 0);
  const wins = rows.filter((s) => net(s) > 0).length;
  const losses = rows.filter((s) => net(s) < 0).length;
  const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`;
  const shown = open ? rows.slice(0, 60) : rows.slice(0, 6);

  return (
    <div style={{ display: "grid", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={LABEL}>Settled</span>
        <span style={{ fontSize: 11 }}>
          {wins}W–{losses}L ·{" "}
          <b style={{ color: total >= 0 ? "var(--pos)" : "var(--neg)" }}>{money(total)}</b>
        </span>
        {rows.length > shown.length && (
          <button type="button" className="ui-btn" onClick={() => setOpen(true)}
                  style={{ ...BTN, marginLeft: "auto" }}>
            Show all {rows.length}
          </button>
        )}
      </div>
      {shown.map((s, i) => {
        const n = net(s);
        return (
          <div key={`${s.ticker}|${s.settled_time}|${i}`} style={{
            display: "flex", gap: 8, alignItems: "center", minHeight: 26,
            fontSize: 11, flexWrap: "wrap",
          }}>
            <span style={{ minWidth: 0, flex: "1 1 160px" }}>
              {cheerLabel(s.ticker, s.yes_count >= s.no_count ? "yes" : "no")}
            </span>
            <span style={{ fontWeight: 800, color: n >= 0 ? "var(--pos)" : "var(--neg)" }}>
              {money(n)}
            </span>
          </div>
        );
      })}
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
