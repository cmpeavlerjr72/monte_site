// src/components/CancelOrder.tsx
//
// CANCEL ONE ORDER — the question, the press, and the true answer.
//
// Two surfaces need this and they must behave identically: the ✕ on a resting
// row in the My Book strip (on a game card) and the Cancel action in the
// resting-order review (in the owner console). So the interaction lives here
// once — confirm, call, report — and each surface only decides where to put it.
//
// WHAT IT WILL AND WILL NOT REACH. The route filters on the app's own
// `cfbapp-` client_order_id tag, so the maker pipeline's resting book and the
// owner's hand-placed orders are unreachable from the app. The UI only offers
// the control where `PortalOrder.app` says the server would accept it — the
// flag comes from the server's own tag test, never from a prefix restated here.
//
// HONESTY. An order that filled, or was already cancelled, comes back as that
// state and is printed as that state. A cancel is never reported as a success
// because the request did not error: the server distinguishes "not yours"
// (404) from "yours, but no longer resting" (409 + the order's real status),
// and both of those read differently from "cancelled".

import { useState } from "react";
import { cancelAppOrder, placeErrorText, type PlaceResponse } from "../lib/placeOrders";

/** What the server said, in one sentence a human can act on. */
function cancelText(status: number, body: any): { ok: boolean; text: string } {
  if (status === 200) {
    const n = Array.isArray(body?.cancelled) ? body.cancelled.length : 0;
    const failed = Array.isArray(body?.failed) ? body.failed.length : 0;
    if (n === 1) {
      const st = body.cancelled[0]?.state;
      const filled = typeof st?.filled === "number" && st.filled > 0 ? st.filled : 0;
      return {
        ok: true,
        text: filled
          ? `Cancelled — but ${filled} contract${filled === 1 ? "" : "s"} had ` +
            `already filled and stay as a held position.`
          : "Cancelled. Your book updates on its next poll.",
      };
    }
    if (failed) {
      return { ok: false, text: "Kalshi refused the cancel — the order is still working." };
    }
    return { ok: false, text: "Nothing was cancelled." };
  }
  if (body?.error === "not_resting") {
    return {
      ok: false,
      text: body.detail || "That order is no longer resting, so there was nothing to cancel.",
    };
  }
  if (body?.error === "not_app_order") {
    return {
      ok: false,
      text: "This app did not place that order, so it cannot cancel it. " +
            "Pull it from Kalshi, or from the maker pipeline that placed it.",
    };
  }
  return { ok: false, text: placeErrorText((body ?? {}) as PlaceResponse) };
}

/**
 * The inline confirm. Renders the question, then the answer — never a spinner
 * that disappears leaving the reader guessing which of the two happened.
 *
 * `onCancelled` fires only on a CONFIRMED cancel, so a caller that hides the
 * row optimistically hides it for the right reason; the next portal poll is
 * still the truth, and a cancel that did not take brings the row back.
 */
export default function CancelConfirm({
  token, orderId, label, onCancelled, onDismiss,
}: {
  token: string;
  orderId: string;
  /** The bet in slip words — the question names what is being pulled. */
  label: string;
  onCancelled?: (orderId: string) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const r = await cancelAppOrder(token, orderId);
      const a = cancelText(r.status, r.body);
      setAnswer(a);
      if (a.ok) onCancelled?.(orderId);
    } catch {
      setAnswer({ ok: false, text: "Cancel failed — network. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  };

  if (answer) {
    return (
      <div style={{ display: "grid", gap: 5 }}>
        <div style={{ color: answer.ok ? "var(--text)" : "var(--neg)", fontWeight: 700 }}>
          {answer.text}
        </div>
        <button type="button" className="ui-btn" onClick={onDismiss}
                style={{ justifySelf: "start", padding: "2px 9px", fontSize: 11 }}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ fontWeight: 700 }}>Cancel this order?</div>
      <div style={{ color: "var(--muted)" }}>
        {label} — the resting order comes off the book. Nothing already filled
        is affected.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="ui-btn" data-on="true" onClick={run} disabled={busy}
                style={{ padding: "3px 10px", fontSize: 11, fontWeight: 800 }}>
          {busy ? "Cancelling…" : "Yes, cancel it"}
        </button>
        <button type="button" className="ui-btn" onClick={onDismiss} disabled={busy}
                style={{ padding: "3px 10px", fontSize: 11 }}>
          Keep it
        </button>
      </div>
    </div>
  );
}
