// src/pages/Profile.tsx  —  route /me
//
// THE ACCOUNT. Everything about the PERSON lives here (owner split
// 2026-09-08): who you are, who can see you, who your friends are, how you
// size a bet, and which Kalshi account you trade through. The book is at
// /mybook and the social feed is at /feed; this page is the third
// destination and it is the only one that WRITES to your account.
//
// TOP LEVEL, NOT UNDER /cfb. An account is sport-agnostic — NCAAB arrives next
// season on the same login, the same book and the same friends — so the
// account pages are mounted at the root. `/cfb/me` and `/cfb/friends` redirect
// here.
//
// SHARE_BOOK IS THE PRIVACY CONTROL, and it is written in words rather than as
// an enum, because the choice is about people, not about a database column:
// nobody / friends / everyone. Every read of another user's picks and orders
// goes through `can_view_book()` in the migration, so this select is the whole
// of it — there is no second place that leaks.
//
// FLARES are cosmetic: up to three school logos beside your name, wherever you
// are named (src/lib/flares.ts). They say nothing about money, which is why
// they are readable across the friend graph like a handle or an avatar.
//
// THE SIZING SETTINGS ARE HALF-PRIVATE and the page says which half out loud:
// the unit SIZE is private to the account (reachable only through
// `my_settings()`), while a friend sees the bets it produces in UNITS.
//
// DELETE ACCOUNT calls `delete_own_account()` (SECURITY DEFINER), which drops
// the auth user; profile, friendships, picks and app_orders cascade from it.
// It is irreversible, so it is behind a TYPED confirmation, never a single
// button — and it says out loud what it does NOT touch (Kalshi orders, which
// are the exchange's record).

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AuthPanel from "../components/AuthPanel";
import FriendsPanel from "../components/FriendsPanel";
import FillAlertsRow from "../components/FillAlertsRow";
import KalshiLinkCard from "../components/KalshiLinkCard";
import UnitModeControl from "../components/UnitModeControl";
import Flares from "../components/Flares";
import {
  supabase, supabaseEnabled, useProfile, useSession, type ShareScope,
} from "../lib/supabase";
import { MAX_FLARES, readFlare, teamFlare, teamFlareOptions, validFlares } from "../lib/flares";
import { clampUnit, UNIT_MAX, UNIT_MIN } from "../lib/ownerPrefs";
import {
  fetchMySettings, localSettings, saveMySettings, type UserSettings,
} from "../lib/userSettings";
import type { UnitMode } from "../lib/suggestedBets";
import { readPortalToken } from "../lib/kalshiPortal";

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
  const [email, setEmail] = useState("");
  const [share, setShare] = useState<ShareScope>("friends");
  const [flares, setFlares] = useState<string[]>([]);
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
    setEmail(profile.email ?? "");
    setShare(profile.share_book);
    setFlares(validFlares(profile.flares ?? []));
  }, [profile]);

  /* ---- the sizing knobs, ON THE ACCOUNT ----
   * They live on the profile (owner rule 2026-09-08) because the feed prices
   * every bet in UNITS of the poster's own unit, which the server has to be
   * able to read. `userSettings` mirrors each read and write into this
   * browser's prefs, so the scoreboard's synchronous read still works and a
   * signed-out visitor is unaffected. The page starts from the local mirror so
   * nothing flickers while the RPC lands. */
  const [settings, setSettings] = useState<UserSettings>(() => localSettings());
  const [unitText, setUnitText] = useState<string>(() => String(localSettings().unit));
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const uid = session?.user?.id ?? "";
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void fetchMySettings().then((s) => {
      if (!alive || !s) return;
      setSettings(s);
      setUnitText(String(s.unit));
    });
    return () => { alive = false; };
  }, [uid]);

  const persist = (next: UserSettings) => {
    setSettings(next);
    void saveMySettings(next).then((e) => setSaveErr(e));
  };
  const commitUnit = () => {
    const v = clampUnit(unitText);
    setUnitText(String(v));
    persist({ ...settings, unit: v });
  };
  const onSizingMode = (v: UnitMode) => persist({ ...settings, mode: v });
  const onMultiple = (v: number) => persist({ ...settings, multiple: v });

  /** The portal password, if this browser holds one — the fill-alerts row
   *  needs it and this page does not fetch the book. */
  const token = useMemo(() => readPortalToken(), []);

  useEffect(() => { document.title = "Profile · MVPeav"; }, []);

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
        <AuthPanel prompt="Sign in to set up your profile, add friends and follow the feed." />
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
        email: email.trim() || null,
        share_book: share,
        // Validated against the catalog here so a stale chip cannot be saved;
        // the DB's `cardinality(flares) <= 3` is the rule that actually holds.
        flares: validFlares(flares),
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

  const emailOk = email.trim() === "" || /\S+@\S+\.\S+/.test(email.trim());
  const savedFlares = validFlares(profile.flares ?? []);
  const dirty =
    displayName.trim() !== profile.display_name ||
    (emoji.trim() || null) !== (profile.avatar_emoji ?? null) ||
    (email.trim() || null) !== (profile.email ?? null) ||
    share !== profile.share_book ||
    validFlares(flares).join("|") !== savedFlares.join("|");

  return (
    <Shell>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span aria-hidden style={{ fontSize: 16 }}>{emoji || "🏈"}</span>
          <span style={{ fontSize: 13, fontWeight: 800 }}>@{profile.handle}</span>
          <Flares flares={validFlares(flares)} />
          <span style={{ fontSize: 11, color: "var(--muted)", flexBasis: "100%" }}>
            your username is permanent — it is what you log in with, and what
            friends type to find you
          </span>
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

        <FlareEditor value={flares} onChange={setFlares} />

        {/* OPTIONAL, and not a credential: you log in with the username
            above, never with this. It exists so the owner can reach you (a
            password reset is a message to him — the site sends no email). */}
        <Field label="Email">
          <input className="ui-sel" value={email} maxLength={254} type="email"
                 onChange={(e) => setEmail(e.target.value)}
                 placeholder="optional"
                 style={{ fontSize: 13, width: "100%", maxWidth: 280 }} />
          <span style={{ fontSize: 10.5, color: "var(--muted)", flexBasis: "100%" }}>
            {emailOk
              ? "Optional. You log in with your username, never this — it is only so the owner can reach you. Nothing is ever sent to it."
              : "That does not look like an email address — fix it or clear the box."}
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
          <button type="button" className="ui-btn" disabled={!dirty || busy || !emailOk}
                  onClick={save} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && <span style={{ fontSize: 11, color: "var(--pos)" }}>{msg}</span>}
          {err && <span style={{ fontSize: 11, color: "var(--neg)" }}>{err}</span>}
        </div>

        {/* ------------------------------ sizing ------------------------- */}
        <Block title="How I size a bet"
               note="The scoreboard sizes every suggestion off these.">
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
              <UnitModeControl
                mode={settings.mode}
                onMode={onSizingMode}
                multiple={settings.multiple}
                onMultiple={onMultiple}
              />
            </div>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
              Your unit is the dollars a suggestion spends (${UNIT_MIN}–${UNIT_MAX}),
              and the switch beside it is HOW it spends them. They are saved to
              your account and are what the scoreboard sizes with the next time
              it loads.
            </span>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
              {/* The privacy half of the same setting, said where it is set. */}
              <b>Nobody else sees this number.</b> Your unit size is private to
              your account — friends see your bets in <b>units</b>
              (“1.5 units at 59¢”) and never in dollars.
            </span>
            {saveErr && (
              <span style={{ fontSize: 10.5, color: "var(--neg)" }}>
                Saved on this device, but the account copy failed: {saveErr}
              </span>
            )}
            {token && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={LABEL}>Fill alerts</span>
                <FillAlertsRow token={token} />
              </div>
            )}
          </div>
        </Block>

        {/* ------------------------------ friends ------------------------ */}
        <Block title="Friends" note="Add someone by their exact username.">
          <FriendsPanel />
        </Block>

        {/* ------------------------------ Kalshi ------------------------- */}
        <Block title="My Kalshi account"
               note="Trade your own money from this site.">
          <KalshiLinkCard />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            Your positions and settled record are on{" "}
            <Link to="/mybook">My Book</Link>.
          </span>
        </Block>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <AuthPanel />
        </div>

        <div style={{
          borderTop: "1px solid var(--border)", paddingTop: 12,
          display: "grid", gap: 6,
        }}>
          <span style={LABEL}>Delete account</span>
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

/* -------------------------------- flares ---------------------------------- */

/**
 * THE FLARE EDITOR. Current flares as removable chips, a searchable school
 * picker, and the count in words ("2 of 3").
 *
 * The cap is stated three times on purpose and each statement is a different
 * kind of promise: the sentence here is the courtesy, the disabled picker is
 * the affordance, and `cardinality(flares) <= 3` in the migration is the rule.
 */
function FlareEditor({ value, onChange }: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => teamFlareOptions(), []);
  const chosen = validFlares(value);
  const full = chosen.length >= MAX_FLARES;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((s) => s.toLowerCase().includes(q) && !chosen.includes(teamFlare(s)))
      .slice(0, 8);
  }, [query, options, chosen]);

  const add = (school: string) => {
    if (full) return;
    onChange([...chosen, teamFlare(school)]);
    setQuery("");
  };
  const drop = (v: string) => onChange(chosen.filter((x) => x !== v));

  return (
    <Field label="Flares">
      <div style={{ display: "grid", gap: 6, flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {chosen.length === 0 && (
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>none yet</span>
          )}
          {chosen.map((v) => {
            const f = readFlare(v);
            if (!f) return null;
            return (
              <span key={v} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                border: "1px solid var(--border)", borderRadius: 999,
                padding: "2px 6px 2px 4px", fontSize: 11,
              }}>
                <img src={f.logo} alt="" width={16} height={16}
                     style={{ objectFit: "contain" }} />
                {f.team}
                <button type="button" onClick={() => drop(v)}
                        aria-label={`Remove ${f.team}`} title={`Remove ${f.team}`}
                        style={{
                          border: 0, background: "none", cursor: "pointer",
                          color: "var(--muted)", font: "inherit", padding: 0,
                          lineHeight: 1,
                        }}>
                  ×
                </button>
              </span>
            );
          })}
          <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: "auto" }}>
            {chosen.length} of {MAX_FLARES}
          </span>
        </div>

        <input className="ui-sel" value={query} disabled={full}
               onChange={(e) => setQuery(e.target.value)}
               placeholder={full ? "three is the limit — remove one to swap" : "add a school"}
               aria-label="Search schools"
               style={{ fontSize: 12, maxWidth: 280 }} />

        {matches.length > 0 && (
          <div style={{
            display: "flex", gap: 5, flexWrap: "wrap",
          }}>
            {matches.map((s) => (
              <button key={s} type="button" className="ui-btn" onClick={() => add(s)}
                      title={s}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "3px 8px", fontSize: 11,
                      }}>
                <Flares flares={[teamFlare(s)]} size={15} />
                {s}
              </button>
            ))}
          </div>
        )}

        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Up to three schools, FBS or FCS, shown beside your name everywhere you
          appear. Cosmetic only — a flare says nothing about your bets or your
          money.
        </span>
      </div>
    </Field>
  );
}

/* -------------------------------- shell ----------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 16, maxWidth: 660, margin: "0 auto" }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
        marginBottom: 12,
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Profile</h1>
        <Link to="/mybook" style={{ marginLeft: "auto", fontSize: 11 }}>My Book →</Link>
        <Link to="/feed" style={{ fontSize: 11 }}>Feed →</Link>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.4, minWidth: 110,
        textTransform: "uppercase", color: "var(--muted)", paddingTop: 5,
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Block({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      borderTop: "1px solid var(--border)", paddingTop: 10,
      display: "grid", gap: 8, minWidth: 0,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{title}</span>
        {note && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--muted)",
};

function Dots() {
  return <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span>;
}
