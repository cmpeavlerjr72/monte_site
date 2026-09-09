// src/pages/Profile.tsx  —  route /cfb/me
//
// The signed-in user's own settings: display name, avatar emoji, and the one
// setting that decides who can see anything they do — `share_book`.
//
// SHARE_BOOK IS THE PRIVACY CONTROL, and it is written in words rather than
// as an enum, because the choice is about people, not about a database
// column: nobody / friends / everyone. Every read of another user's picks and
// orders goes through `can_view_book()` in the migration, so this select is
// the whole of it — there is no second place that leaks.
//
// DELETE ACCOUNT calls `delete_own_account()` (SECURITY DEFINER), which drops
// the auth user; profile, friendships, picks and app_orders cascade from it.
// It is irreversible, so it is behind a TYPED confirmation, never a single
// button — and it says out loud what it does NOT touch (Kalshi orders, which
// are the exchange's record).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AuthPanel from "../components/AuthPanel";
import {
  supabase, supabaseEnabled, useProfile, useSession, type ShareScope,
} from "../lib/supabase";

const SHARE_WORDS: Record<ShareScope, { label: string; note: string }> = {
  nobody: { label: "Nobody", note: "Your picks and orders stay private." },
  friends: { label: "Friends", note: "Only people you have accepted see your picks and orders." },
  everyone: { label: "Everyone", note: "Any signed-in user can see your picks and orders." },
};

const DELETE_PHRASE = "delete my account";

export default function Profile() {
  const { session, loading } = useSession();
  const { profile, loading: profileLoading, reload } = useProfile(session);

  const [displayName, setDisplayName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [share, setShare] = useState<ShareScope>("friends");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Seed the form from the loaded row (and re-seed after a reload).
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setEmoji(profile.avatar_emoji ?? "");
    setShare(profile.share_book);
  }, [profile]);

  if (!supabaseEnabled) {
    return (
      <Shell>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Accounts are not configured for this build.
        </p>
      </Shell>
    );
  }

  if (loading || (session && profileLoading)) return <Shell><Dots /></Shell>;

  if (!session || !profile) {
    return (
      <Shell>
        <AuthPanel prompt="Sign in to set up your profile, add friends and post picks." />
      </Shell>
    );
  }

  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true); setMsg(null); setErr(null);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        avatar_emoji: emoji.trim() || null,
        share_book: share,
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) setErr(error.message);
    else { setMsg("Saved."); reload(); }
  };

  const remove = async () => {
    if (!supabase || confirmText.trim().toLowerCase() !== DELETE_PHRASE) return;
    setDeleting(true); setErr(null);
    const { error } = await supabase.rpc("delete_own_account");
    if (error) { setDeleting(false); setErr(error.message); return; }
    await supabase.auth.signOut();
    setDeleting(false);
  };

  const dirty =
    displayName.trim() !== profile.display_name ||
    (emoji.trim() || null) !== (profile.avatar_emoji ?? null) ||
    share !== profile.share_book;

  return (
    <Shell>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>@{profile.handle}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            your handle is permanent — it is what friends type to find you
          </span>
          <Link to="/cfb/friends" style={{ marginLeft: "auto", fontSize: 11 }}>
            Friends →
          </Link>
        </div>

        <Field label="Display name">
          <input className="ui-sel" value={displayName} maxLength={40}
                 onChange={(e) => setDisplayName(e.target.value)}
                 style={{ fontSize: 13, width: "100%", maxWidth: 280 }} />
        </Field>

        <Field label="Avatar">
          <input className="ui-sel" value={emoji} maxLength={8}
                 onChange={(e) => setEmoji(e.target.value)}
                 placeholder="🏈"
                 aria-label="Avatar emoji"
                 style={{ fontSize: 15, width: 72, textAlign: "center" }} />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            one emoji, shown beside your name in the feed
          </span>
        </Field>

        <Field label="Who sees my bets">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(SHARE_WORDS) as ShareScope[]).map((s) => (
              <button key={s} type="button" className="ui-btn"
                      data-on={share === s ? "true" : "false"}
                      onClick={() => setShare(s)}
                      style={{ padding: "4px 11px", fontSize: 11.5 }}>
                {SHARE_WORDS[s].label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 10.5, color: "var(--muted)", flexBasis: "100%" }}>
            {SHARE_WORDS[share].note}
          </span>
        </Field>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="ui-btn" disabled={!dirty || busy}
                  onClick={save} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && <span style={{ fontSize: 11, color: "var(--pos)" }}>{msg}</span>}
          {err && <span style={{ fontSize: 11, color: "var(--neg)" }}>{err}</span>}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <AuthPanel />
        </div>

        <div style={{
          borderTop: "1px solid var(--border)", paddingTop: 12,
          display: "grid", gap: 6,
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                         textTransform: "uppercase", color: "var(--muted)" }}>
            Delete account
          </span>
          <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 520 }}>
            This removes your profile, friendships, posted picks and the record
            of orders you placed here. It cannot be undone. Orders already sent
            to Kalshi are the exchange's record and are not touched.
          </span>
          <input className="ui-sel" value={confirmText}
                 onChange={(e) => setConfirmText(e.target.value)}
                 placeholder={`type "${DELETE_PHRASE}" to confirm`}
                 style={{ fontSize: 12, maxWidth: 280 }} />
          <button type="button" className="ui-btn"
                  disabled={confirmText.trim().toLowerCase() !== DELETE_PHRASE || deleting}
                  onClick={remove}
                  style={{
                    padding: "5px 14px", fontSize: 12, fontWeight: 700,
                    color: "var(--neg)", width: "fit-content",
                  }}>
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 900 }}>My account</h1>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.4, minWidth: 110,
        textTransform: "uppercase", color: "var(--muted)",
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Dots() {
  return <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span>;
}
