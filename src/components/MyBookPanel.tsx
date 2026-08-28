// src/components/MyBookPanel.tsx
//
// The OWNER CONSOLE. Everything that is "mine" rather than "the slate's" lives
// here, in one block of labelled rows:
//
//   Account    login / logged-in state, disconnect
//   Unit size  dollars of risk per ladder — the number the whole site sizes on
//   Orders     the kill switch for orders this app placed
//   Book       the cumulative risk/EV bar, when there is a book
//   (children) the Suggested bets card
//
// It replaces a one-off "My Kalshi" toolbar button plus a floating login
// popover plus a detached totals bar. Structured as ROWS on purpose: the next
// owner feature is a row, not another button somewhere else on the page.

import { useState } from "react";
import DryRunBadge from "./DryRunBadge";
import { cancelAppOrders, placeErrorText, type PlaceResponse } from "../lib/placeOrders";
import { clampUnit, UNIT_MAX, UNIT_MIN } from "../lib/ownerPrefs";
import { MyBookBar } from "./MyBook";
import type { PortalTotals } from "../lib/kalshiPortal";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "7px 0", borderTop: "1px solid var(--border)",
    }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.4, minWidth: 66,
        textTransform: "uppercase", color: "var(--muted)",
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function MyBookPanel({
  token, onToken, note, connected, ordersLive, unit, onUnit,
  totals, unmatched, children,
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

      {token && totals.n > 0 && (
        <Row label="Book">
          {/* Same compression as one bet on a card: what is at stake, then the
              ONE verdict. Risk → payout, fees, both sources' EV and how many
              bets each could price are behind the tap. */}
          <MyBookBar totals={totals} unmatched={unmatched} />
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
