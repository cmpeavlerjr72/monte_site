// src/components/MyBookPanel.tsx
//
// THE SCOREBOARD'S MONEY STRIP. Everything on this page is about BETS now
// (owner restructure 2026-09-08: "the scoreboard is a bets menu"), so the
// console that used to hold every "mine" feature is down to the few facts a
// trader needs while looking at the board:
//
//   Account   the portal login / which account is connected
//   Book      what is open right now — resting orders and exposure — plus the
//             kill switch, which belongs beside the number it acts on
//   Record    what has already settled ON THESE GAMES
//   (children) the ranked Suggested-bets index
//
// WHAT LEFT, and where it went: Profile, Friends, the network feed, unit size
// and sizing mode, and fill alerts are all on the MY BOOK DASHBOARD
// (/cfb/mybook). They are about the person, not about this board, and the
// strip links to them rather than carrying them.
//
// WHAT STAYED, and why: the RECORD row is slate-scoped — it is the settled
// result of the games this board is showing, computed from the page's own
// slate join — so it cannot live on a page that loads no week. The legacy
// portal PASSWORD login stays too: it is the owner's way in through the
// accounts cutover, and removing it would take the book off the board.

import { useState } from "react";
import { Link } from "react-router-dom";
import DryRunBadge from "./DryRunBadge";
import { cancelAppOrders, placeErrorText, type PlaceResponse } from "../lib/placeOrders";
import { KalshiRecordBlock, MyBookBar } from "./MyBook";
import type {
  BetGameNames, PortalTotals, SettlementRecord,
} from "../lib/kalshiPortal";

function Row({ label, children, top = false }: {
  label: string;
  children: React.ReactNode;
  /** A row whose content is a STACK (the settled record) pins its label to the
   *  first line instead of floating it beside the middle of the block. */
  top?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: top ? "flex-start" : "center", gap: 10,
      flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid var(--border)",
    }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.4, minWidth: 66,
        textTransform: "uppercase", color: "var(--muted)",
        ...(top ? { paddingTop: 13 } : null),
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function MyBookPanel({
  token, onToken, note, connected, ordersLive, accountLabel,
  totals, unmatched, openOrders, record, slugTeams, children, signedIn = false,
}: {
  token: string;
  /** A Supabase session is the other way in: the book is connected without a
   *  password and the Account row shows no login form. */
  signedIn?: boolean;
  /** "" disconnects. Persisting is the caller's job (writePortalToken). */
  onToken: (t: string) => void;
  /** One-line status from the page ("3 bets · 2 games on this board", …). */
  note: string;
  /** Portal session is live (status === "ok"). */
  connected: boolean;
  /** Server's CFB_ORDERS_LIVE for THIS account. False => placements are
   *  staged, not sent. */
  ordersLive: boolean;
  /** Which Kalshi account the password logged into (multi-account server).
   *  Undefined until the first payload, or on a pre-multi-account server —
   *  the row then just says "Connected" with no name. */
  accountLabel?: string;
  totals: PortalTotals;
  unmatched: number;
  /** Resting orders still working — the one COUNT the strip owes a trader
   *  looking at the board ("what of mine is out there right now"). */
  openOrders: number;
  /** REAL settled results on the games this board is showing. The row renders
   *  only when something has actually settled on them — an empty record is not
   *  a 0-0 line, it is no line. */
  record: SettlementRecord;
  /** slug -> the card's real team names, passed straight through to
   *  `KalshiRecordBlock` — see that component's doc for what it is used for. */
  slugTeams: Map<string, BetGameNames>;
  /** The Suggested bets card — rendered inside the console it belongs to. */
  children?: React.ReactNode;
}) {
  const [kill, setKill] = useState<{ busy: boolean; msg: string } | null>(null);

  const runKill = async () => {
    setKill({ busy: true, msg: "" });
    try {
      const r = await cancelAppOrders(token);
      const n = Array.isArray(r.body?.cancelled) ? r.body.cancelled.length : 0;
      setKill({
        busy: false,
        msg: r.status === 200
          ? (n ? `Cancelled ${n} app order${n === 1 ? "" : "s"}.`
               : "No resting app orders to cancel.")
          : placeErrorText(r.body as PlaceResponse),
      });
    } catch {
      setKill({ busy: false, msg: "Cancel failed — network." });
    }
  };

  return (
    <section className="card" style={{
      padding: "8px 12px 10px", marginBottom: 16, display: "grid", gap: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", paddingBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>
          My Book
        </span>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{note}</span>
        {(token || signedIn) && !ordersLive && (
          <span style={{ marginLeft: "auto" }}>
            <DryRunBadge title="Order entry is staged for this account: the server validates, caps, re-checks the book and logs — and submits nothing." />
          </span>
        )}
      </div>

      <Row label="Account">
        {token || signedIn ? (
          <>
            <span style={{ fontSize: 12, color: connected ? "var(--pos)" : "var(--muted)" }}>
              {/* The password IS the account (multi-account server), so the
                  connected line names WHOSE book this is — a trader must never
                  have to infer whose money is on screen. */}
              {connected
                ? accountLabel ? `Connected — ${accountLabel}` : "Connected"
                : signedIn && !token ? "Connecting as you…" : "Connecting…"}
            </span>
            {token && <button type="button" className="ui-btn" onClick={() => onToken("")}
                    style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}>
              Disconnect
            </button>}
          </>
        ) : (
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
            <button type="submit" className="ui-btn" style={{ padding: "3px 10px", fontSize: 11 }}>
              Connect
            </button>
          </form>
        )}
      </Row>

      {(token || signedIn) && (
        <Row label="Book">
          {/* THE STRIP'S ONE MONEY LINE: what is still working, what it is
              worth, and the switch that pulls it. Everything else about the
              book — every bet, every settlement, the sizing knobs — is one tap
              away on the dashboard. */}
          <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            {openOrders === 0
              ? "no open orders"
              : `${openOrders} open order${openOrders === 1 ? "" : "s"}`}
          </span>
          {totals.n > 0 && (
            <span style={{ flex: "1 1 200px", minWidth: 0 }}>
              <MyBookBar totals={totals} unmatched={unmatched} />
            </span>
          )}
          <button type="button" className="ui-btn" onClick={runKill} disabled={kill?.busy}
                  title="Cancel every resting order this app placed (cfbapp-tagged only — the maker pipeline's book is untouched)"
                  style={{ padding: "3px 10px", fontSize: 11 }}>
            {kill?.busy ? "Cancelling…" : "Cancel my app orders"}
          </button>
          {kill?.msg && (
            <span style={{ fontSize: 10.5, color: "var(--muted)", flexBasis: "100%" }}>
              {kill.msg}
            </span>
          )}
        </Row>
      )}

      {/* The REALISED half: what these games have already settled for. Nothing
          settled on this board yet (or no settlement joins it) => no row at
          all, rather than an honest-looking 0-0 that is really "no data". It
          stays here rather than moving to the dashboard because it is a fact
          about THIS SLATE, computed from this page's own join. */}
      {(token || signedIn) && record.slate.n > 0 && (
        <Row label="Record" top>
          <KalshiRecordBlock record={record} slugTeams={slugTeams} />
        </Row>
      )}

      <Row label="Dashboard">
        <span style={{ fontSize: 10.5, color: "var(--muted)", minWidth: 0 }}>
          Your positions, friends, the feed, unit size and Kalshi linking live
          on <Link to="/mybook">My Book</Link>.
        </span>
      </Row>

      {children && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 1 }}>
          {children}
        </div>
      )}
    </section>
  );
}
