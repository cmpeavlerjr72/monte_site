// src/components/MyBookPanel.tsx
//
// The OWNER CONSOLE. Everything that is "mine" rather than "the slate's" lives
// here, in one block of labelled rows:
//
//   Account    login / logged-in state, disconnect
//   Unit size  dollars of risk per ladder — the number the whole site sizes on
//   Orders     the kill switch for orders this app placed
//   Book       the cumulative risk/EV bar, when there is a book
//   Record     REAL settled W/L + PnL on this slate, broken out by bet type
//   (children) the Suggested bets card
//
// It replaces a one-off "My Kalshi" toolbar button plus a floating login
// popover plus a detached totals bar. Structured as ROWS on purpose: the next
// owner feature is a row, not another button somewhere else on the page.

import { useEffect, useState } from "react";
import DryRunBadge from "./DryRunBadge";
import { cancelAppOrders, placeErrorText, type PlaceResponse } from "../lib/placeOrders";
import { clampUnit, UNIT_MAX, UNIT_MIN } from "../lib/ownerPrefs";
import { KalshiRecordBlock, MyBookBar } from "./MyBook";
import type { BetGameNames, PortalTotals, SettlementRecord } from "../lib/kalshiPortal";
import {
  enablePushAlerts, getPushState, resyncPushSubscription, sendTestPush,
  type PushState,
} from "../lib/push";

/**
 * FILL ALERTS — Web Push when a resting order fills (owner ask 2026-08-29:
 * "notifications as resting stuff fills so that I don't miss anything").
 * The server half polls Kalshi fills each minute and pushes maker fills to
 * every subscribed device; this row is enable + test for THIS device. The
 * worker behind it is push-only by rule (src/sw.ts — no fetch handler).
 */
function FillAlertsRow({ token }: { token: string }) {
  const [state, setState] = useState<PushState | "checking">("checking");
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getPushState().then((s) => { if (alive) setState(s); });
    // Deploy-wipe healing: a subscribed device re-registers itself on every
    // owner session, so the server's ephemeral store refills without help.
    void resyncPushSubscription(token);
    return () => { alive = false; };
  }, [token]);

  const run = (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true); setMsg("");
    fn()
      .then(async () => { setMsg(okMsg); setState(await getPushState()); })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (state === "checking") return null;
  if (state === "unsupported") {
    return (
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        This browser has no push support (iPhone: install to the home screen first).
      </span>
    );
  }
  if (state === "denied") {
    return (
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        Notifications are blocked for this site in the browser settings.
      </span>
    );
  }
  return (
    <>
      {state === "enabled" ? (
        <>
          <span style={{ fontSize: 12, color: "var(--pos)" }}>On for this device</span>
          <button type="button" className="ui-btn" disabled={busy}
                  onClick={() => run(() => sendTestPush(token), "Test sent — it should arrive within seconds.")}
                  style={{ padding: "3px 10px", fontSize: 11 }}>
            Send test
          </button>
        </>
      ) : (
        <button type="button" className="ui-btn" disabled={busy}
                onClick={() => run(() => enablePushAlerts(token), "Enabled — this device gets fill alerts.")}
                style={{ padding: "3px 10px", fontSize: 11 }}>
          {busy ? "Enabling…" : "Enable fill alerts"}
        </button>
      )}
      <span style={{ fontSize: 10.5, color: msg.includes("Enabled") || msg.includes("Test sent") ? "var(--pos)" : "var(--muted)" }}>
        {msg || "Pushes when a resting order fills, even with the site closed."}
      </span>
    </>
  );
}

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
  token, onToken, note, connected, ordersLive, unit, onUnit,
  totals, unmatched, record, slugTeams, children,
}: {
  token: string;
  /** "" disconnects. Persisting is the caller's job (writePortalToken). */
  onToken: (t: string) => void;
  /** One-line status from the page ("3 bets · 2 games on this board", …). */
  note: string;
  /** Portal session is live (status === "ok"). */
  connected: boolean;
  /** Server's CFB_ORDERS_LIVE. False => placements are staged, not sent. */
  ordersLive: boolean;
  unit: number;
  onUnit: (v: number) => void;
  totals: PortalTotals;
  unmatched: number;
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
  // Local text state so a half-typed "1" is not clamped to 1 mid-keystroke;
  // the committed value is clamped on blur / Enter.
  const [unitText, setUnitText] = useState<string>(String(unit));
  const [kill, setKill] = useState<{ busy: boolean; msg: string } | null>(null);

  const commitUnit = () => {
    const v = clampUnit(unitText);
    onUnit(v);
    setUnitText(String(v));
  };

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
        {token && !ordersLive && (
          <span style={{ marginLeft: "auto" }}>
            <DryRunBadge title="Order entry is staged (CFB_ORDERS_LIVE unset): the server validates, caps, re-checks the book and logs — and submits nothing." />
          </span>
        )}
      </div>

      <Row label="Account">
        {token ? (
          <>
            <span style={{ fontSize: 12, color: connected ? "var(--pos)" : "var(--muted)" }}>
              {connected ? "Connected" : "Connecting…"}
            </span>
            <button type="button" className="ui-btn" onClick={() => onToken("")}
                    style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}>
              Disconnect
            </button>
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

      <Row label="Unit size">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>$</span>
          <input
            type="number" inputMode="numeric"
            min={UNIT_MIN} max={UNIT_MAX} step={1}
            value={unitText}
            onChange={(e) => setUnitText(e.target.value)}
            onBlur={commitUnit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitUnit(); } }}
            className="ui-sel"
            aria-label="Unit size in dollars per ladder"
            style={{ width: 76, fontSize: 13, fontWeight: 800, textAlign: "right" }}
          />
        </label>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          per ladder (${UNIT_MIN}–${UNIT_MAX}) — sizes every suggestion and slip
        </span>
      </Row>

      {token && (
        <Row label="Orders">
          <button type="button" className="ui-btn" onClick={runKill} disabled={kill?.busy}
                  title="Cancel every resting order this app placed (cfbapp-tagged only — the maker pipeline's book is untouched)"
                  style={{ padding: "3px 10px", fontSize: 11 }}>
            {kill?.busy ? "Cancelling…" : "Cancel my app orders"}
          </button>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {kill?.msg || "Pulls only orders placed from this app."}
          </span>
        </Row>
      )}

      {token && (
        <Row label="Alerts">
          <FillAlertsRow token={token} />
        </Row>
      )}

      {token && totals.n > 0 && (
        <Row label="Book">
          {/* Same compression as one bet on a card: what is at stake, then the
              ONE verdict. Risk → payout, fees, both sources' EV and how many
              bets each could price are behind the tap. */}
          <MyBookBar totals={totals} unmatched={unmatched} />
        </Row>
      )}

      {/* The REALISED half, directly under the open book: what these games
          have already settled for. Nothing settled on this board yet (or no
          settlement joins it) => no row at all, rather than an honest-looking
          0-0 that is really "we have no data". */}
      {token && record.slate.n > 0 && (
        <Row label="Record" top>
          <KalshiRecordBlock record={record} slugTeams={slugTeams} />
        </Row>
      )}

      {children && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 1 }}>
          {children}
        </div>
      )}
    </section>
  );
}
