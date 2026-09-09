// src/components/FillAlertsRow.tsx
//
// WEB PUSH when a resting order fills or a bet settles (owner ask 2026-08-29:
// "notifications as resting stuff fills so that I don't miss anything"). The
// server half polls Kalshi each minute and pushes to every subscribed device;
// this control is enable + test for THIS device.
//
// It moved out of the scoreboard console with the 2026-09-08 restructure: it
// is a per-DEVICE preference, so it belongs with the other settings on the My
// Book dashboard rather than on the board itself. The worker behind it is
// push-only by rule (src/sw.ts — no fetch handler, so it can never strand a
// phone on a cached page).

import { useEffect, useState } from "react";
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
export default function FillAlertsRow({ token }: { token: string }) {
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
        {msg || "Pushes when a resting order fills and when bets settle, even with the site closed."}
      </span>
    </>
  );
}

