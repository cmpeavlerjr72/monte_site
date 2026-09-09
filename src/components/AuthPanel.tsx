// src/components/AuthPanel.tsx
//
// SIGN IN / SIGN UP / RESET, plus the first-sign-in profile row. The one
// place in the app that touches Supabase Auth (docs/ACCOUNTS_DESIGN.md).
//
// Three rules it is built around:
//
//   1. FEATURE FLAG FIRST. `supabaseEnabled` false => this renders null, so a
//      build without VITE_SUPABASE_URL/ANON_KEY is the app exactly as it was.
//   2. Email confirmation is OFF in the project (owner 2026-09-08: no SMTP
//      sender to maintain), so sign-up normally returns a session and lands on
//      the handle form at once. If the dashboard setting is ever flipped on, a
//      sign-up that returns no session is SUCCESS, not an error — say so
//      plainly ("check your email")
//      rather than leaving a spinner and a form that looks like it failed.
//   3. A PROFILE IS REQUIRED before any accounts feature works: `picks`,
//      `friendships` and `app_orders` all have a foreign key to profiles.id.
//      So a session with no profile row lands on the handle form, and nothing
//      else is offered until it is filled.
//
// Passwords: >= 10 characters (owner decision). The rule is stated on the
// form, not just enforced, because a silent disable is the worst version of a
// password rule.

import { useState, type FormEvent } from "react";
import {
  HANDLE_RE, MIN_PASSWORD, supabase, supabaseEnabled, useProfile, useSession,
} from "../lib/supabase";

type Mode = "signin" | "signup" | "reset";

export type AuthPanelProps = {
  /** One line above the form saying WHAT signing in unlocks here. */
  prompt?: string;
  /** Prompt style: a single line with a "Sign in" toggle, expanded on tap.
   *  Used wherever the panel sits inside another block (the feed, the
   *  console) rather than owning the page. */
  compact?: boolean;
  /** Called once a session AND a profile exist. */
  onReady?: () => void;
};

export default function AuthPanel({ prompt, compact = false, onReady }: AuthPanelProps) {
  const { session, loading } = useSession();
  const { profile, loading: profileLoading, reload } = useProfile(session);
  const [open, setOpen] = useState(!compact);

  // Accounts are not configured for this build: render nothing, anywhere.
  if (!supabaseEnabled || !supabase) return null;
  // Don't flash a signed-out prompt at a signed-in user on every page load.
  if (loading) return null;

  if (session && profile) {
    return (
      <SignedInLine
        handle={profile.handle}
        displayName={profile.display_name}
        emoji={profile.avatar_emoji}
        onSignedOut={() => { void supabase?.auth.signOut(); }}
      />
    );
  }

  if (session && !profile) {
    if (profileLoading) return null;
    return <ProfileForm userId={session.user.id} onDone={() => { reload(); onReady?.(); }} />;
  }

  if (compact && !open) {
    return (
      <div style={ROW}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {prompt ?? "Sign in to use this."}
        </span>
        <button type="button" className="ui-btn" onClick={() => setOpen(true)}
                style={{ padding: "3px 10px", fontSize: 11 }}>
          Sign in
        </button>
      </div>
    );
  }

  return <CredentialsForm prompt={prompt} compact={compact} />;
}

const ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
};

function SignedInLine({ handle, displayName, emoji, onSignedOut }: {
  handle: string; displayName: string; emoji: string | null; onSignedOut: () => void;
}) {
  return (
    <div style={ROW}>
      <span style={{ fontSize: 12 }}>
        <span aria-hidden style={{ marginRight: 5 }}>{emoji || "🏈"}</span>
        <span style={{ fontWeight: 700 }}>{displayName}</span>
        <span style={{ color: "var(--muted)" }}> @{handle}</span>
      </span>
      <button type="button" className="ui-btn" onClick={onSignedOut}
              style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}>
        Sign out
      </button>
    </div>
  );
}

/**
 * Email + password, with the reset flow beside it. Sign-up and reset both end
 * in an email, and both say so in words instead of appearing to hang.
 */
function CredentialsForm({ prompt, compact }: { prompt?: string; compact: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"confirm" | "reset" | null>(null);

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const passOk = password.length >= MIN_PASSWORD;
  const canSubmit = mode === "reset" ? emailOk : emailOk && passOk;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy || !supabase) return;
    setBusy(true); setError(null); setSent(null);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(), password,
        });
        if (err) {
          setError(err.message.includes("Invalid login credentials")
            ? "Wrong email or password."
            : err.message);
        }
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(), password,
        });
        if (err) {
          setError(err.message.includes("already registered")
            ? "That email already has an account — sign in instead."
            : err.message);
        } else if (!data.session) {
          // Email confirmation is ON: no session yet is the happy path.
          setSent("confirm");
        }
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(
          email.trim(), { redirectTo: window.location.origin + "/cfb/me" });
        if (err) setError(err.message);
        else setSent("reset");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {sent === "confirm" ? "Check your email" : "Reset link sent"}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {sent === "confirm"
            ? "We sent a confirmation link. Open it, then come back and sign in."
            : "Open the link, choose a new password, and you'll land back here signed in."}
        </span>
        <button type="button" className="ui-btn" style={BTN}
                onClick={() => { setSent(null); setMode("signin"); }}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 6, maxWidth: 340 }}>
      {prompt && (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{prompt}</span>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["signin", "signup"] as const).map((m) => (
          <button key={m} type="button" className="ui-btn"
                  data-on={mode === m ? "true" : "false"}
                  onClick={() => { setMode(m); setError(null); }}
                  style={BTN}>
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <input
        className="ui-sel" type="email" name="email" autoComplete="email"
        placeholder="you@example.com" value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ fontSize: 12 }}
      />
      {mode !== "reset" && (
        <input
          className="ui-sel" type="password" name="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          placeholder={mode === "signin" ? "Password" : `Password (${MIN_PASSWORD}+ characters)`}
          value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ fontSize: 12 }}
        />
      )}
      {mode === "signup" && !passOk && password.length > 0 && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          At least {MIN_PASSWORD} characters.
        </span>
      )}
      {error && (
        <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{error}</span>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="ui-btn" disabled={!canSubmit || busy} style={BTN}>
          {busy ? "One sec…"
            : mode === "signin" ? "Sign in"
            : mode === "signup" ? "Create account"
            : "Send reset link"}
        </button>
        <button type="button" className="ui-btn" style={{ ...BTN, opacity: 0.85 }}
                onClick={() => { setMode(mode === "reset" ? "signin" : "reset"); setError(null); }}>
          {mode === "reset" ? "Back" : "Forgot password?"}
        </button>
      </div>
      {mode === "signup" && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          We send a confirmation link before the account works.
          {compact ? "" : " Trading stays with the owner's Kalshi accounts for now — an account gets you the feed and posting picks."}
        </span>
      )}
    </form>
  );
}

const BTN: React.CSSProperties = { padding: "3px 10px", fontSize: 11 };

/**
 * FIRST SIGN-IN. The handle is the permanent public identity (it is what a
 * friend types to find you), so it is validated against the same regex the
 * database CHECK uses and lower-cased on the way in. A taken handle comes
 * back as a unique-violation and is reported as such, not as "something
 * went wrong".
 */
function ProfileForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const h = handle.trim().toLowerCase();
  const handleOk = HANDLE_RE.test(h);
  const nameOk = displayName.trim().length >= 1 && displayName.trim().length <= 40;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!handleOk || !nameOk || busy || !supabase) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.from("profiles").insert({
      id: userId, handle: h, display_name: displayName.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.code === "23505"
        ? `@${h} is taken — pick another handle.`
        : err.message);
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 6, maxWidth: 340 }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Pick a handle</span>
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        Friends find you by typing it exactly. 3–20 characters, lower-case
        letters, numbers and underscores.
      </span>
      <input
        className="ui-sel" placeholder="handle" value={handle} maxLength={20}
        onChange={(e) => setHandle(e.target.value)} style={{ fontSize: 12 }}
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
      />
      <input
        className="ui-sel" placeholder="Display name" value={displayName} maxLength={40}
        onChange={(e) => setDisplayName(e.target.value)} style={{ fontSize: 12 }}
      />
      {handle.length > 0 && !handleOk && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Handles are 3–20 of a–z, 0–9 and _ .
        </span>
      )}
      {error && <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{error}</span>}
      <button type="submit" className="ui-btn" disabled={!handleOk || !nameOk || busy} style={BTN}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
