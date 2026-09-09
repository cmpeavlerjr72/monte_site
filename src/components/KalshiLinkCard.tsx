// src/components/KalshiLinkCard.tsx
//
// LINK YOUR OWN KALSHI ACCOUNT — the dashboard card that hands the server an
// API key id and a private key so a user can trade their own money here.
//
// This is the most sensitive control on the site, so the rules it is built
// around are the ones that keep it honest rather than the ones that make it
// pretty:
//
//  1. THE PRIVATE KEY IS TYPED ONCE AND NEVER KEPT HERE. The file is read as
//     text, POSTed over HTTPS, and the picker is cleared the moment the
//     request returns — success or failure. It is never written to
//     localStorage, never held in a ref, and never rendered back.
//  2. THE CARD SAYS WHAT HAPPENS TO IT, in words: encrypted at rest, only the
//     server can read it, never shown again, unlink here or revoke on Kalshi.
//     A security promise the user cannot read is not a promise.
//  3. THE SERVER PROVES THE PAIR before storing anything (one signed read of
//     the account's balance), so "Linked" on this card means "this key works",
//     not "this key was accepted as a string".
//  4. UNLINKING IS TYPED, like deleting an account: it stops the app being
//     able to trade for you, and a mis-tap should not do that.
//
// Most people doing this have never made an API key, so the walkthrough is a
// first-class part of the card and not a link somewhere else. The screenshots
// under each step are OPTIONAL FILES (public/help/kalshi/stepN.png): a missing
// one hides its own image and leaves the words, because a broken-image icon on
// a security screen reads as a broken site.

import { useEffect, useRef, useState } from "react";
import { getAccessToken } from "../lib/supabase";

type LinkState = {
  linked: boolean;
  key_id_masked: string | null;
  linked_at: string | null;
  orders_live?: boolean;
};

const UNLINK_PHRASE = "unlink";

export default function KalshiLinkCard() {
  const [state, setState] = useState<LinkState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "off" | "error">("loading");
  const [keyId, setKeyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [howOpen, setHowOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const jwt = await getAccessToken();
    if (!jwt) { setStatus("error"); return; }
    try {
      const r = await fetch("/api/me/kalshi", {
        headers: { authorization: `Bearer ${jwt}` }, cache: "no-store",
      });
      if (r.status === 503) { setStatus("off"); return; }
      if (!r.ok) { setStatus("error"); return; }
      setState((await r.json()) as LinkState);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => { void load(); }, []);

  /** Read the picked .pem / .txt as text, send it once, forget it. */
  const link = async () => {
    setErr(null); setMsg(null);
    const file = fileRef.current?.files?.[0];
    if (!keyId.trim()) { setErr("Paste the Key ID from Kalshi first."); return; }
    if (!file) { setErr("Pick the private key file you saved from Kalshi."); return; }
    setBusy(true);
    try {
      const pem = await file.text();
      // Kalshi hands out a .pem, but a browser or a copy-paste can leave you
      // with a .txt holding the same thing. The CONTENT is the test.
      if (!pem.includes("BEGIN")) {
        setErr("That file does not look like a private key — it should start with “-----BEGIN”. " +
               "Pick the key file Kalshi gave you, not the Key ID.");
        setBusy(false);
        return;
      }
      const jwt = await getAccessToken();
      const r = await fetch("/api/me/kalshi", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ key_id: keyId.trim(), pem }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(linkErrorText(String(body?.error || ""), r.status));
      } else {
        setMsg("Linked. Your key is encrypted on our server — it is never shown again.");
        setKeyId("");
        await load();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      // The file input is cleared whatever happened: nothing keeps a private
      // key sitting in the page.
      if (fileRef.current) fileRef.current.value = "";
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (confirm.trim().toLowerCase() !== UNLINK_PHRASE) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const jwt = await getAccessToken();
      const r = await fetch("/api/me/kalshi", {
        method: "DELETE", headers: { authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) { setErr("Could not unlink — try again."); return; }
      setConfirm("");
      setMsg("Unlinked. The stored key has been deleted.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return <Muted>Checking whether you have a Kalshi account linked…</Muted>;
  }
  if (status === "off") {
    return <Muted>Linking a Kalshi account is not switched on for this site yet.</Muted>;
  }
  if (status === "error") {
    return <Muted>Could not check your Kalshi link right now.</Muted>;
  }

  const linked = Boolean(state?.linked);

  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      {linked ? (
        <>
          <div style={{ fontSize: 12 }}>
            <b style={{ color: "var(--pos)" }}>Linked</b>
            <span style={{ color: "var(--muted)" }}>
              {" "}as key {state?.key_id_masked}
              {state?.linked_at ? ` since ${dateWords(state.linked_at)}` : ""}
            </span>
          </div>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {state?.orders_live
              ? "Orders you confirm here are sent to Kalshi on your own account."
              : "Trading is STAGED for linked accounts: everything is checked and " +
                "logged, and nothing is sent to Kalshi until the site owner turns " +
                "live trading on."}
          </span>
          <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <span style={LABEL}>Unlink</span>
            <span style={{ fontSize: 10.5, color: "var(--muted)", maxWidth: 520 }}>
              This deletes the stored key. Your Kalshi account and any orders
              already placed are untouched — you can also revoke the key on
              Kalshi at any time.
            </span>
            <input className="ui-sel" value={confirm}
                   onChange={(e) => setConfirm(e.target.value)}
                   placeholder={`type "${UNLINK_PHRASE}" to confirm`}
                   style={{ fontSize: 12, maxWidth: 240 }} />
            <button type="button" className="ui-btn"
                    disabled={busy || confirm.trim().toLowerCase() !== UNLINK_PHRASE}
                    onClick={() => void unlink()}
                    style={{ ...BTN, color: "var(--neg)", width: "fit-content" }}>
              {busy ? "Unlinking…" : "Unlink my Kalshi account"}
            </button>
          </div>
        </>
      ) : (
        <>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Link your own Kalshi account to place your own bets from this site.
            You need two things from Kalshi: a <b>Key ID</b> and the{" "}
            <b>private key file</b> it gives you when you create the key.
          </span>

          <Walkthrough open={howOpen} onToggle={() => setHowOpen((v) => !v)} />

          <label style={{ display: "grid", gap: 4 }}>
            <span style={LABEL}>Key ID</span>
            <input className="ui-sel" value={keyId} maxLength={120}
                   onChange={(e) => setKeyId(e.target.value)}
                   placeholder="paste the Key ID from Kalshi"
                   autoCapitalize="none" autoCorrect="off" spellCheck={false}
                   style={{ fontSize: 12, width: "100%", maxWidth: 380 }} />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={LABEL}>Private key file</span>
            <input ref={fileRef} type="file" accept=".pem,.txt,text/plain"
                   className="ui-sel" style={{ fontSize: 11.5, maxWidth: 380 }} />
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
              The file Kalshi gave you — a .pem or .txt starting with
              “-----BEGIN”.
            </span>
          </label>

          <button type="button" className="ui-btn" data-primary="true" disabled={busy}
                  onClick={() => void link()}
                  style={{ ...BTN, fontWeight: 700, width: "fit-content" }}>
            {busy ? "Checking with Kalshi…" : "Link my Kalshi account"}
          </button>
        </>
      )}

      {msg && <span style={{ fontSize: 11, color: "var(--pos)" }}>{msg}</span>}
      {err && <span style={{ fontSize: 11, color: "var(--neg)" }}>{err}</span>}

      <span style={{ fontSize: 10.5, color: "var(--muted)", maxWidth: 560 }}>
        {/* Rule 2: the promise is written where the key is typed. */}
        What we do with it: the private key is <b>encrypted</b> before it is
        stored, only our server can read it, and it is <b>never shown again</b>
        {" "}— not to you, not to anyone. You can unlink it here, or revoke the
        key on Kalshi, at any time.
      </span>
    </div>
  );
}

/** Server error codes, in the words of what the person did. */
function linkErrorText(code: string, status: number): string {
  switch (code) {
    case "bad_key_id":
      return "That Key ID does not look right — copy it from the same key you downloaded the file for.";
    case "bad_pem":
      return "That file does not look like a private key. It should start with “-----BEGIN”. " +
             "If you only have the Key ID, create a new key on Kalshi and save the file it gives you.";
    case "kalshi_rejected":
      return "Kalshi did not accept that key id + file — check you copied the Key ID from the " +
             "same key, and that the key has not been revoked.";
    case "linking_not_configured":
      return "Linking is not switched on for this site yet.";
    case "sign_in_required":
      return "Log in again and retry.";
    case "too_large":
      return "That file is too big to be a private key.";
    default:
      return `Could not link (HTTP ${status}). Try again in a moment.`;
  }
}

/**
 * THE FIRST-TIMER WALKTHROUGH. Collapsed by default (someone doing this a
 * second time does not need it), numbered, and in plain words. The screenshots
 * are the owner's own, already blurred; step 4 has no file yet and its slot
 * simply stays hidden until one appears.
 *
 * Kalshi renames its menus from time to time, so every step names the thing to
 * LOOK FOR rather than promising an exact path.
 */
function Walkthrough({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 8,
      background: "var(--fill)", padding: "6px 9px",
    }}>
      <button type="button" className="ui-btn" onClick={onToggle} aria-expanded={open}
              style={{ ...BTN, display: "flex", gap: 7, alignItems: "center",
                       justifyContent: "flex-start", textAlign: "left", width: "100%" }}>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span>First time? Here is how to get a Kalshi API key</span>
      </button>
      {open && (
        <ol style={{
          margin: "8px 0 2px", paddingLeft: 20, display: "grid", gap: 12,
          fontSize: 11.5, lineHeight: 1.45,
        }}>
          <Step
            img="step1.png"
            alt="Kalshi's top-right account menu open, with Account & security in the list"
            caption="Kalshi's top-right menu — choose “Account & security”."
          >
            Log in at <b>kalshi.com</b> (the real site, not the demo one). Open
            the menu at the top right, choose <b>Account &amp; security</b>, and
            find the <b>API keys</b> section.
          </Step>
          <Step
            img="step2.png"
            alt="Kalshi's Create API key dialog: a nickname box, an optional public key box, and permission checkboxes"
            caption="The Create API key dialog — name it, leave the public key box empty, tick the permissions."
          >
            Press <b>Create API key</b>. Give it a nickname (“monte-site” works),
            leave the optional public key box <b>empty</b> so Kalshi makes the
            key for you, and tick the permissions it needs to trade:{" "}
            <b>Read all data</b> and <b>Full access</b>.
          </Step>
          <Step
            img="step3.png"
            alt="Kalshi's Keep your key safe screen, showing the API key id box and the private key box"
            caption="Shown once: the API key id, and the private key to save."
          >
            Kalshi now shows the <b>API key id</b> and the <b>private key</b>{" "}
            — <b>once</b>. Copy the key id, and save the private key file (or
            copy its text into a file). It starts with “-----BEGIN”. Kalshi
            cannot show it again: if you lose it, create a new key here and
            delete the old one.
          </Step>
          <Step
            img="step4.png"
            alt="This site's link card with the Key ID and private key file filled in"
            caption="Back here: the Key ID in the first box, the file in the second."
          >
            Come back here: paste the <b>Key ID</b> in the first box, pick the{" "}
            <b>private key file</b> in the second, and press <b>Link</b>. We
            check the pair against your Kalshi balance before saving anything.
          </Step>
          <li style={{ color: "var(--muted)", listStyle: "none", marginLeft: -20 }}>
            Kalshi changes the wording of its menus from time to time — look for
            “API keys” wherever your account settings live.
          </li>
        </ol>
      )}
    </div>
  );
}

/**
 * One numbered step, with an OPTIONAL screenshot. `onError` hides the image
 * element outright, so a file the owner has not dropped in yet costs nothing
 * on screen — never a broken-image icon.
 */
function Step({ img, alt, caption, children }: {
  img: string; alt: string; caption: string; children: React.ReactNode;
}) {
  const [ok, setOk] = useState(true);
  return (
    <li>
      <div>{children}</div>
      {ok && (
        <figure style={{ margin: "6px 0 0" }}>
          <img
            src={`/help/kalshi/${img}`}
            alt={alt}
            loading="lazy"
            onError={() => setOk(false)}
            style={{
              display: "block", width: "100%", maxWidth: 420, height: "auto",
              border: "1px solid var(--border)", borderRadius: 6,
            }}
          />
          <figcaption style={{ fontSize: 10, color: "var(--muted)", paddingTop: 3 }}>
            {caption}
          </figcaption>
        </figure>
      )}
    </li>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: "var(--muted)" }}>{children}</span>;
}

function dateWords(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? "then"
    : t.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const BTN: React.CSSProperties = { padding: "4px 12px", fontSize: 11.5 };
const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--muted)",
};
