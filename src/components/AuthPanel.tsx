// src/components/AuthPanel.tsx
//
// SIGN IN / SIGN UP by USERNAME, plus the first-sign-in profile row. The one
// place in the app that touches Supabase Auth (docs/ACCOUNTS_DESIGN.md).
//
// FOUR rules it is built around:
//
//   1. FEATURE FLAG FIRST. `supabaseEnabled` false => this renders null, so a
//      build without VITE_SUPABASE_URL/ANON_KEY is the app exactly as it was.
//   2. THE LOGIN IS A USERNAME (owner decision 2026-09-08). Supabase Auth
//      wants an address, so one is DERIVED — `loginEmailFor(handle)`, i.e.
//      `<handle>@mvpeav.com` — by BOTH sign-up and sign-in, so the two
//      can never disagree about who a username is. Nobody types an address to
//      get in. A REAL address is optional, goes on `profiles.email`, and
//      exists only so the owner can reach a user.
//   3. NO EMAIL RESET UI. There is no SMTP sender on this project, so a
//      "reset link" button would be a button that does nothing. The form says
//      to ask the owner instead — an honest dead end beats a silent one.
//   4. THE USERNAME IS CLAIMED BEFORE THE AUTH USER EXISTS. Sign-up asks
//      `find_profile` first, so a taken name fails while nothing has been
//      created. The derived address is a second, race-proof guard: a taken
//      handle is a taken auth address, and Auth refuses it on its own.
//
// Email confirmation is OFF in the project (owner 2026-09-08), so a sign-up
// normally returns a session immediately. If that dashboard setting is ever
// flipped on, a sign-up returning no session is SUCCESS, not an error, and it
// says so rather than leaving a form that looks like it failed.
//
// Passwords: >= 10 characters. The rule is stated on the form, not just
// enforced, because a silent disable is the worst version of a password rule.

import { useState, type FormEvent } from "react";
import {
  HANDLE_RE, MIN_PASSWORD, loginEmailFor, supabase, supabaseEnabled,
  useProfile, useSession,
} from "../lib/supabase";

type Mode = "signin" | "signup";

export type AuthPanelProps = {
  /** One line above the form saying WHAT signing in unlocks here. */
  prompt?: string;
  /** Prompt style: a single line with a "Sign in" toggle, expanded on tap.
   *  Used wherever the panel sits inside another block (the feed, the
   *  console) rather than owning the page. */
  compact?: boolean;
  /** Called once a session AND a profile exist. */
  onReady?: () => void;
  /** Open on "Create account" instead of "Sign in" (the ribbon's Sign up). */
  startMode?: Mode;
  /** Hide the signed-in line — for hosts that render their own (the ribbon
   *  menu shows the username itself, so the panel would say it twice). */
  hideSignedIn?: boolean;
};

export default function AuthPanel({
  prompt, compact = false, onReady, startMode = "signin", hideSignedIn = false,
}: AuthPanelProps) {
  const { session, loading } = useSession();
  const { profile, loading: profileLoading, reload } = useProfile(session);
  const [open, setOpen] = useState(!compact);

  // Accounts are not configured for this build: render nothing, anywhere.
  if (!supabaseEnabled || !supabase) return null;
  // Don't flash a signed-out prompt at a signed-in user on every page load.
  if (loading) return null;

  if (session && profile) {
    if (hideSignedIn) return null;
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

  return <CredentialsForm prompt={prompt} compact={compact} startMode={startMode} />;
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
        <span style={{ color: "var(--muted)" }}> {handle}</span>
      </span>
      <button type="button" className="ui-btn" onClick={onSignedOut}
              style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}>
        Sign out
      </button>
    </div>
  );
}

/**
 * USERNAME + PASSWORD, and on sign-up an OPTIONAL real email.
 *
 * The sign-up order is deliberate: check the name, then create the auth user,
 * then write the profile row. Every step that can fail says which one did, in
 * the words of the thing the user typed ("that username is taken"), never as
 * a database error about a unique constraint.
 */
function CredentialsForm({ prompt, compact, startMode }: {
  prompt?: string; compact: boolean; startMode: Mode;
}) {
  const [mode, setMode] = useState<Mode>(startMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const uname = username.trim().toLowerCase();
  // A sign-IN also accepts a legacy real address verbatim (see loginEmailFor):
  // accounts made before usernames existed must still be able to get in.
  const nameOk = mode === "signup"
    ? HANDLE_RE.test(uname)
    : uname.length >= 3;
  // The length rule is a SIGN-UP rule. Existing accounts (roth: "Bearcats",
  // created by the admin API) must still log in with what they have.
  const passOk = mode === "signin" ? password.length > 0 : password.length >= MIN_PASSWORD;
  const contactOk = contact.trim() === "" || /\S+@\S+\.\S+/.test(contact.trim());
  const canSubmit = nameOk && passOk && (mode === "signin" || contactOk);

  const signUp = async () => {
    if (!supabase) return;
    // 1. Claim the NAME first, so a taken one fails before anything exists.
    const { data: found, error: findErr } = await supabase
      .rpc("find_profile", { p_handle: uname });
    if (findErr) { setError(findErr.message); return; }
    const taken = Array.isArray(found) ? found.length > 0 : Boolean(found);
    if (taken) { setError(`${} is taken — pick another username.`); return; }

    // 2. The auth user, at the DERIVED address. A taken handle is a taken
    //    address, so this is also the race-proof version of the check above.
    const { data, error: err } = await supabase.auth.signUp({
      email: loginEmailFor(uname), password,
    });
    if (err) {
      setError(/already registered|already been registered/i.test(err.message)
        ? `${} is taken — pick another username.`
        : err.message);
      return;
    }
    if (!data.session) {
      // Email confirmation got turned back on in the dashboard. Nothing here
      // can complete the profile row until they are signed in.
      setSent(true);
      return;
    }
    // 3. The profile row. Its handle IS the username, which is what makes the
    //    two identities one thing.
    const uid = data.session.user.id;
    const { error: pErr } = await supabase.from("profiles").insert({
      id: uid, handle: uname, display_name: uname,
      email: contact.trim() || null,
    });
    if (pErr) {
      setError(pErr.code === "23505"
        ? `${} is taken — pick another username.`
        : pErr.message);
    }
    // Either way the session now exists, so the panel re-renders: with a
    // profile it shows the signed-in line, without one the handle form.
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy || !supabase) return;
    setBusy(true); setError(null);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: loginEmailFor(uname), password,
        });
        if (err) {
          setError(err.message.includes("Invalid login credentials")
            ? "Wrong username or password."
            : err.message);
        }
      } else {
        await signUp();
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
        <span style={{ fontSize: 12, fontWeight: 700 }}>Account created</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          This project has confirmation switched on right now, so the account
          is not live until the owner confirms it. Ask him, then sign in.
        </span>
        <button type="button" className="ui-btn" style={BTN}
                onClick={() => { setSent(false); setMode("signin"); }}>
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
            {m === "signin" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>
      <input
        className="ui-sel" type="text" name="username" autoComplete="username"
        placeholder="username" value={username} maxLength={64}
        onChange={(e) => setUsername(e.target.value)}
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        style={{ fontSize: 12 }}
      />
      <input
        className="ui-sel" type="password" name="password"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        placeholder={mode === "signin" ? "Password" : `Password (${MIN_PASSWORD}+ characters)`}
        value={password} onChange={(e) => setPassword(e.target.value)}
        style={{ fontSize: 12 }}
      />
      {mode === "signup" && (
        <>
          <input
            className="ui-sel" type="email" name="email" autoComplete="email"
            placeholder="email (optional)" value={contact}
            onChange={(e) => setContact(e.target.value)}
            style={{ fontSize: 12 }}
          />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            Your username is how you log in and how friends find you: 3–20
            characters, lower-case letters, numbers and underscores. The email
            is optional and only so the owner can reach you — we never send
            anything to it.
          </span>
        </>
      )}
      {mode === "signup" && username.length > 0 && !nameOk && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Usernames are 3–20 of a–z, 0–9 and _ .
        </span>
      )}
      {mode === "signup" && !passOk && password.length > 0 && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          At least {MIN_PASSWORD} characters.
        </span>
      )}
      {mode === "signup" && !contactOk && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          That does not look like an email address — or leave it blank.
        </span>
      )}
      {error && (
        <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{error}</span>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="ui-btn" data-primary="true" disabled={!canSubmit || busy} style={BTN}>
          {busy ? "One sec…" : mode === "signin" ? "Log in" : "Sign up"}
        </button>
        {mode === "signin" && (
          <button type="button" className="ui-btn" style={{ ...BTN, opacity: 0.85 }}
                  onClick={() => setHelpOpen((v) => !v)}>
            Forgot password?
          </button>
        )}
      </div>
      {helpOpen && mode === "signin" && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {/* No SMTP sender on this project, so there is no reset email to
              send. Say that plainly rather than shipping a button that
              silently does nothing. */}
          There is no automatic reset — the site sends no email. Message the
          owner and he will set a new password on your account.
        </span>
      )}
      {mode === "signup" && !compact && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          An account gets you the feed, posting picks and your own dashboard.
          You can link your own Kalshi account from the dashboard afterwards.
        </span>
      )}
    </form>
  );
}

const BTN: React.CSSProperties = { padding: "3px 10px", fontSize: 11 };

/**
 * A SESSION WITH NO PROFILE ROW. Normally unreachable now — sign-up writes the
 * row itself — but it is the recovery path for an account made before
 * usernames existed, and for the rare case where step 3 of sign-up failed
 * after the auth user was created. The handle is validated against the same
 * regex the database CHECK uses; a taken one comes back as a unique violation
 * and is reported as such, not as "something went wrong".
 */
function ProfileForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const h = handle.trim().toLowerCase();
  const handleOk = HANDLE_RE.test(h);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!handleOk || busy || !supabase) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.from("profiles").insert({
      id: userId, handle: h, display_name: h,
    });
    setBusy(false);
    if (err) {
      setError(err.code === "23505"
        ? `${} is taken — pick another username.`
        : err.message);
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 6, maxWidth: 340 }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Pick a username</span>
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        Friends find you by typing it exactly. 3–20 characters, lower-case
        letters, numbers and underscores.
      </span>
      <input
        className="ui-sel" placeholder="username" value={handle} maxLength={20}
        onChange={(e) => setHandle(e.target.value)} style={{ fontSize: 12 }}
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
      />
      {handle.length > 0 && !handleOk && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Usernames are 3–20 of a–z, 0–9 and _ .
        </span>
      )}
      {error && <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{error}</span>}
      <button type="submit" className="ui-btn" data-primary="true" disabled={!handleOk || busy} style={BTN}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
