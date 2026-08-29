// src/lib/push.ts
//
// Web Push subscription for OWNER FILL ALERTS — the client half of
// /api/push/* in server/liveScores.ts. The server polls the account's Kalshi
// fills once a minute and pushes when a RESTING (maker) order fills, so the
// owner hears about it with the site closed. Android delivers these with the
// browser closed; iOS only from an installed home-screen app (16.4+).
//
// The service worker involved is push-only (src/sw.ts — no fetch handler, by
// rule). Everything here is owner-gated: the subscribe POST carries the portal
// token, and the UI lives in the My Book console.
//
// RESILIENCE: the server's subscription store is a file on Render's ephemeral
// disk, so a deploy can wipe it. `resyncPushSubscription` re-POSTs the
// device's existing subscription on every owner page load — cheap, idempotent,
// and it heals the store without the user touching anything.

export type PushState =
  | "unsupported"   // no SW/Push/Notification API in this browser
  | "denied"        // permission refused at the browser level
  | "enabled"       // permission granted AND this device is subscribed
  | "off";          // available, not yet subscribed

function swReady(): Promise<ServiceWorkerRegistration> | null {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) ||
      !("Notification" in window)) return null;
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  const ready = swReady();
  if (!ready) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    // `serviceWorker.ready` NEVER rejects — with no registration (a failed
    // register(), dev mode) it pends forever and would leave the Alerts row
    // blank for good. Timing out to "off" shows the Enable button instead;
    // enabling then surfaces any real registration problem as an error.
    const reg = await Promise.race([
      ready,
      new Promise<null>((ok) => setTimeout(() => ok(null), 3000)),
    ]);
    if (!reg) return "off";
    const sub = await reg.pushManager.getSubscription();
    return sub ? "enabled" : "off";
  } catch {
    return "off";
  }
}

/** VAPID applicationServerKey arrives base64url; PushManager wants bytes. */
function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function postSubscription(token: string, sub: PushSubscription): Promise<void> {
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cfb-token": token },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(String(body?.error || `subscribe HTTP ${r.status}`));
  }
}

/**
 * Ask permission, subscribe this device, register it with the server.
 * Throws with a human-readable message on any refusal.
 */
export async function enablePushAlerts(token: string): Promise<void> {
  const ready = swReady();
  if (!ready) throw new Error("This browser has no push support.");

  const r = await fetch("/api/push/pubkey", { headers: { "x-cfb-token": token } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.publicKey) {
    throw new Error(body?.error === "push_not_configured"
      ? "The server has no VAPID keys yet (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Render)."
      : "Could not fetch the push key.");
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted.");

  const reg = await Promise.race([
    ready,
    new Promise<null>((ok) => setTimeout(() => ok(null), 8000)),
  ]);
  if (!reg) throw new Error("The service worker is not registered yet — reload the page and retry.");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(String(body.publicKey)).buffer as ArrayBuffer,
    }));
  await postSubscription(token, sub);
}

/** Silently re-register an existing subscription (deploy-wipe healing). */
export async function resyncPushSubscription(token: string): Promise<void> {
  try {
    const ready = swReady();
    if (!ready || Notification.permission !== "granted") return;
    const sub = await (await ready).pushManager.getSubscription();
    if (sub) await postSubscription(token, sub);
  } catch {
    /* resync is best-effort by definition */
  }
}

/** Round-trip test: server pushes a test notification to this device.
 *  A 200 with zero sends is a FAILURE — surface the push service's own words
 *  (a 403 here is the classic pasted-VAPID-key mismatch). */
export async function sendTestPush(token: string): Promise<void> {
  const r = await fetch("/api/push/test", {
    method: "POST",
    headers: { "x-cfb-token": token },
  });
  const body = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok) throw new Error(String(body?.error || `test HTTP ${r.status}`));
  const sent = Number(body?.sent ?? 0);
  if (sent > 0) return;
  const f = (body?.failures as Array<{ code: number; detail: string }> | undefined)?.[0];
  const gone = Number(body?.gone ?? 0);
  if (f) {
    throw new Error(
      `Push service refused (HTTP ${f.code}): ${f.detail}` +
      (f.code === 403 || f.code === 401
        ? " — usually a VAPID key mismatch: re-check both keys in Render env, then Disconnect/re-Enable here."
        : ""));
  }
  if (gone > 0) throw new Error("This device's subscription had expired — tap Enable fill alerts again.");
  throw new Error("No device subscriptions on the server — tap Enable fill alerts again.");
}
