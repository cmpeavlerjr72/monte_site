// src/components/FriendsPanel.tsx  —  the FRIENDS section of /cfb/mybook
//
// The friend graph: find by EXACT handle, request, accept or block, unfriend.
// It used to be the whole of /cfb/friends; since 2026-09-08 the dashboard owns
// it as one section and that route redirects here, because "my people" and "my
// money" are one page in the owner's head.
//
// THERE IS NO USER DIRECTORY, deliberately (docs/ACCOUNTS_DESIGN.md). The only
// way to reach a stranger is `find_profile(handle)`, a SECURITY DEFINER RPC
// that takes an exact handle and returns id + display name + emoji and nothing
// else. A partial-match search would be a scrapeable list of everyone who bets
// on this site; that is why it does not exist.
//
// Who may do what is the DATABASE's call, not this panel's:
//   * insert  — only with requester_id = me and status 'pending'
//   * update  — only the ADDRESSEE, and only to 'accepted' or 'blocked'
//   * delete  — either party (unfriend, or cancel a request you sent)
// The buttons here mirror those policies; if one is wrong the database
// refuses and the error is shown rather than swallowed.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AuthPanel from "./AuthPanel";
import {
  supabase, supabaseEnabled, useProfile, useSession, type FoundProfile,
} from "../lib/supabase";

type Party = {
  id: string; handle: string; display_name: string; avatar_emoji: string | null;
};

type Edge = {
  id: number;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "blocked";
  requester: Party | null;
  addressee: Party | null;
};

const SELECT =
  "id, requester_id, addressee_id, status," +
  "requester:profiles!requester_id(id,handle,display_name,avatar_emoji)," +
  "addressee:profiles!addressee_id(id,handle,display_name,avatar_emoji)";

export default function FriendsPanel() {
  const { session, loading } = useSession();
  const { profile, loading: profileLoading } = useProfile(session);
  const me = profile?.id ?? "";

  const [edges, setEdges] = useState<Edge[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !me) return;
    const { data, error } = await supabase
      .from("friendships")
      .select(SELECT)
      .order("created_at", { ascending: false });
    if (error) { setErr(error.message); return; }
    setErr(null);
    setEdges((data ?? []) as unknown as Edge[]);
  }, [me]);

  useEffect(() => { void load(); }, [load]);

  if (!supabaseEnabled) {
    return (
      <Shell>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Accounts are not configured for this build.
        </p>
      </Shell>
    );
  }
  if (loading || (session && profileLoading)) {
    return <Shell><span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span></Shell>;
  }
  if (!session || !profile) {
    return (
      <Shell>
        <AuthPanel prompt="Sign in to add friends and see what they are on." />
      </Shell>
    );
  }

  const other = (e: Edge): Party | null =>
    e.requester_id === me ? e.addressee : e.requester;

  const incoming = edges.filter((e) => e.status === "pending" && e.addressee_id === me);
  const outgoing = edges.filter((e) => e.status === "pending" && e.requester_id === me);
  const friends = edges.filter((e) => e.status === "accepted");
  const blocked = edges.filter((e) => e.status === "blocked");

  const act = async (fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(true); setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setErr(error.message);
    else void load();
  };

  const decide = (id: number, status: "accepted" | "blocked") =>
    act(async () => await supabase!.from("friendships").update({ status }).eq("id", id));

  const drop = (id: number) =>
    act(async () => await supabase!.from("friendships").delete().eq("id", id));

  return (
    <Shell>
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            you are <strong style={{ color: "var(--text)" }}>@{profile.handle}</strong>
          </span>
          <Link to="/cfb/me" style={{ marginLeft: "auto", fontSize: 11 }}>Edit profile →</Link>
        </div>

        <AddFriend me={me} onSent={load} known={edges} />

        {err && <span style={{ fontSize: 11, color: "var(--neg)" }}>{err}</span>}

        <Group label="Wants to be friends" empty="No incoming requests.">
          {incoming.map((e) => (
            <PartyRow key={e.id} party={other(e)}>
              <button type="button" className="ui-btn" disabled={busy} style={BTN}
                      onClick={() => decide(e.id, "accepted")}>Accept</button>
              <button type="button" className="ui-btn" disabled={busy}
                      style={{ ...BTN, color: "var(--neg)" }}
                      onClick={() => decide(e.id, "blocked")}>Block</button>
            </PartyRow>
          ))}
        </Group>

        {outgoing.length > 0 && (
          <Group label="Requested" empty="">
            {outgoing.map((e) => (
              <PartyRow key={e.id} party={other(e)}>
                <span style={{ fontSize: 10.5, color: "var(--muted)" }}>waiting</span>
                <button type="button" className="ui-btn" disabled={busy} style={BTN}
                        onClick={() => drop(e.id)}>Cancel</button>
              </PartyRow>
            ))}
          </Group>
        )}

        <Group label="Friends" empty="Nobody yet — find someone by their handle above.">
          {friends.map((e) => (
            <PartyRow key={e.id} party={other(e)}>
              <button type="button" className="ui-btn" disabled={busy} style={BTN}
                      onClick={() => drop(e.id)}>Unfriend</button>
            </PartyRow>
          ))}
        </Group>

        {blocked.length > 0 && (
          <Group label="Blocked" empty="">
            {blocked.map((e) => (
              <PartyRow key={e.id} party={other(e)}>
                <button type="button" className="ui-btn" disabled={busy} style={BTN}
                        onClick={() => drop(e.id)}>Remove</button>
              </PartyRow>
            ))}
          </Group>
        )}
      </div>
    </Shell>
  );
}

const BTN: React.CSSProperties = { padding: "3px 10px", fontSize: 11 };

/**
 * EXACT HANDLE ONLY. `find_profile` is the whole search surface; a miss is
 * reported as "no account with that handle" rather than as an error, because
 * a typo is the common case.
 */
function AddFriend({ me, onSent, known }: {
  me: string; onSent: () => void; known: Edge[];
}) {
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<FoundProfile | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const search = async () => {
    if (!supabase || busy) return;
    const h = handle.trim().toLowerCase();
    if (!h) return;
    setBusy(true); setMsg(null); setFound(null);
    const { data, error } = await supabase.rpc("find_profile", { p_handle: h });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    const row = (Array.isArray(data) ? data[0] : data) as FoundProfile | undefined;
    setFound(row ?? "none");
  };

  const request = async () => {
    if (!supabase || !found || found === "none" || busy) return;
    if (found.id === me) { setMsg("That is you."); return; }
    if (known.some((e) => e.requester_id === found.id || e.addressee_id === found.id)) {
      setMsg("You already have a request or friendship with them.");
      return;
    }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("friendships").insert({
      requester_id: me, addressee_id: found.id,
    });
    setBusy(false);
    if (error) setMsg(error.message);
    else { setMsg(`Request sent to @${found.handle}.`); setFound(null); setHandle(""); onSent(); }
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={LABEL}>Add a friend</span>
      <form style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
            onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="ui-sel" value={handle} maxLength={20}
               onChange={(e) => setHandle(e.target.value)}
               placeholder="their exact handle"
               autoCapitalize="none" autoCorrect="off" spellCheck={false}
               style={{ fontSize: 12, flex: "1 1 160px", minWidth: 0 }} />
        <button type="submit" className="ui-btn" disabled={busy || !handle.trim()} style={BTN}>
          {busy ? "…" : "Find"}
        </button>
      </form>
      {found === "none" && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          No account with that handle. Handles are exact — no partial search.
        </span>
      )}
      {found && found !== "none" && (
        <PartyRow party={found as Party}>
          <button type="button" className="ui-btn" disabled={busy} style={BTN}
                  onClick={request}>Send request</button>
        </PartyRow>
      )}
      {msg && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{msg}</span>}
    </div>
  );
}

function PartyRow({ party, children }: { party: Party | null; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, minHeight: 40,
      padding: "4px 0", borderTop: "1px solid var(--border)",
    }}>
      <span aria-hidden style={{ fontSize: 15 }}>{party?.avatar_emoji || "🏈"}</span>
      <span style={{ fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ fontWeight: 700 }}>{party?.display_name ?? "—"}</span>
        <span style={{ color: "var(--muted)" }}> @{party?.handle ?? "…"}</span>
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>{children}</span>
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "var(--muted)",
};

function Group({ label, empty, children }: {
  label: string; empty: string; children: React.ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!has && !empty) return null;
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={LABEL}>{label}</span>
      {has ? children : (
        <span style={{ fontSize: 10.5, color: "var(--muted)", paddingTop: 4 }}>{empty}</span>
      )}
    </div>
  );
}

/** A section of the dashboard, not a page: the heading above it is the
 *  dashboard's, so this is only a box. */
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 10, minWidth: 0 }}>{children}</div>;
}
