// src/pages/Desk.tsx: THE WRITERS' DESK at /desk (owner 2026-10-21).
//
//   editor (MVPeav)  the queue: guest submissions waiting on him first, then every unpublished BlogBot draft, each with
//                    "Open workspace" (the same edit link the bot sends on Telegram).
//   writer (Cowboy Teddy)  a drop box: attach the Word file (or paste the text), add a title, send. Below it, where each
//                    of theirs stands: with the editor (with a read-only preview link), scheduled, live.
//
// The server (server/liveScores.ts, "THE WRITERS' DESK") checks the role on every call; BlogBot on the owner's PC turns
// a submission into a workspace draft within a minute (cfb-props-sim/scripts/blogbot/submissions.py).

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, EmptyState, PageHeader, Pill } from "../components/ui";
import { MIN_PASSWORD, supabase, supabaseEnabled, useSession } from "../lib/supabase";
import { deskFetch, useDeskAccess } from "../lib/deskAccess";
import { DeskCalendar, usePosted, type CalItem } from "../components/desk/DeskCalendar";
import "../styles/desk.css";

type QueueDraft = {
  did: string; title: string; stage: string; busy: string | null; created: string | null; updated: string | null;
  version: number | null; scheduled_at: string | null; author: string; guest: boolean; submitted: string | null; link: string;
};
type Queue = { built: string | null; drafts: QueueDraft[]; waiting: { id: string; title: string; byline: string; at: string | null; failed: boolean }[] };
type Mine = { submissions: { id: string; title: string; at: string | null; sport: string | null; status: string; message: string | null;
  scheduled_at: string | null; preview: string | null; url: string | null }[] };

const STAGE: Record<string, string> = { planning: "Researching", outline: "Outline", writing: "Writing", drafted: "Draft" };
const SPORTS = [["nfl", "NFL"], ["cfb", "College football"], ["cbb", "College basketball"], ["nhl", "NHL"], ["other", "Something else"]];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins >= 0 && mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DraftRow({ d }: { d: QueueDraft }) {
  const label = d.scheduled_at ? "Scheduled" : STAGE[d.stage] || d.stage;
  return (
    <li className="desk-row">
      <div className="desk-row__main">
        <a className="desk-row__title" href={d.link}>{d.title}</a>
        <div className="desk-row__meta">
          <Pill tone={d.scheduled_at ? "gold" : d.stage === "drafted" ? "navy" : "outline"}>{label}</Pill>
          <span>{d.guest ? `by ${d.author} · sent ${when(d.submitted)}` : `${d.version ? `v${d.version} · ` : ""}updated ${when(d.updated)}`}</span>
          {d.scheduled_at && <span>· goes live {when(d.scheduled_at)}</span>}
          {d.busy && <span className="desk-busy">· {d.busy}…</span>}
        </div>
      </div>
      <a className="ui-btn desk-row__open" href={d.link}>Open workspace</a>
    </li>
  );
}

function EditorQueue() {
  const [q, setQ] = useState<Queue | null>(null);
  const posted = usePosted();
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    deskFetch<Queue>("/api/desk/queue").then((j) => { setQ(j); setErr(null); }).catch((e) => setErr(String(e.message || e)));
  }, []);
  useEffect(() => {
    load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  if (err) return <Card><p className="desk-err">{err}</p></Card>;
  if (!q) return <Card><p className="desk-muted">Loading the queue…</p></Card>;
  // unscheduled drafts sit up top until they're scheduled or posted; those move to the calendar below
  const open = q.drafts.filter((d) => !d.scheduled_at);
  const guests = open.filter((d) => d.guest);
  const mine = open.filter((d) => !d.guest);
  const cal: CalItem[] = [
    ...q.drafts.filter((d) => d.scheduled_at).map((d) => ({ key: `s:${d.did}`, at: d.scheduled_at as string, title: d.title,
      kind: "scheduled" as const, href: d.link, author: d.author })),
    ...posted,
  ];
  const stale = q.built ? Date.now() - new Date(q.built).getTime() > 6 * 3600_000 : true;
  return (
    <>
      <Card title="Waiting on you" kicker="Submitted by writers" action={<button type="button" className="ui-btn" onClick={load}>Refresh</button>}>
        {guests.length === 0 && q.waiting.length === 0 ? (
          <p className="desk-muted">Nothing submitted right now.</p>
        ) : (
          <ul className="desk-list">
            {q.waiting.map((w) => (
              <li key={w.id} className="desk-row">
                <div className="desk-row__main">
                  <span className="desk-row__title">{w.title || "(no title: headline ideas coming)"}</span>
                  <div className="desk-row__meta">
                    <Pill tone={w.failed ? "neg" : "outline"}>{w.failed ? "Couldn't read" : "Arriving"}</Pill>
                    <span>by {w.byline} · sent {when(w.at)}</span>
                    {!w.failed && <span>· the bot sets up its workspace within a minute (the PC has to be on)</span>}
                    {w.failed && <span>· ask them to send it again as a .docx or pasted text</span>}
                  </div>
                </div>
              </li>
            ))}
            {guests.map((d) => <DraftRow key={d.did} d={d} />)}
          </ul>
        )}
      </Card>
      <Card title="Your drafts" kicker="Not scheduled yet">
        {mine.length === 0 ? <p className="desk-muted">No unscheduled drafts. Start one from the bot.</p> : (
          <ul className="desk-list">{mine.map((d) => <DraftRow key={d.did} d={d} />)}</ul>
        )}
        <p className="desk-small desk-muted">
          {q.built ? `List from the bot, ${when(q.built)}.` : "The bot hasn't sent its list yet."}
          {stale ? " It updates whenever a draft changes; if the PC is off, new drafts won't show here." : ""}
        </p>
      </Card>
      <Card title="Calendar" kicker="Scheduled and posted">
        <DeskCalendar items={cal} />
      </Card>
    </>
  );
}

function SubmitForm({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("nfl");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const ready = (title.trim().length === 0 || title.trim().length >= 3) && (paste ? text.trim().split(/\s+/).length >= 50 : Boolean(file));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr(null); setSent(null);
    try {
      let upload: string | undefined;
      if (!paste && file) {
        if (!/\.docx$/i.test(file.name)) throw new Error("Attach a Word file (.docx). In Word: File → Save As → Word Document.");
        if (file.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB. Take the pictures out and send the text.");
        const up = await deskFetch<{ upload: string }>("/api/desk/uploads", { method: "POST", headers: { "Content-Type": DOCX }, body: file });
        upload = up.upload;
      }
      await deskFetch<{ id: string }>("/api/desk/submissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, sport, summary, note, ...(paste ? { text } : { upload, file_name: file?.name }) }),
      });
      setSent(title.trim() || "your article");
      setTitle(""); setSummary(""); setNote(""); setText(""); setFile(null); setFileKey((k) => k + 1);
      onSent();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="desk-form" onSubmit={submit}>
      <label className="desk-field">
        <span>Title <em>(optional: leave it blank and the editor will write one)</em></span>
        <input className="ui-sel" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Your headline" />
      </label>
      <label className="desk-field">
        <span>Section</span>
        <select className="ui-sel" value={sport} onChange={(e) => setSport(e.target.value)}>
          {SPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {!paste ? (
        <label className="desk-field">
          <span>Your article (Word file)</span>
          <input key={fileKey} className="ui-sel" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" className="desk-link" onClick={() => setPaste(true)}>No Word file? Paste the text instead</button>
        </label>
      ) : (
        <label className="desk-field">
          <span>Your article (paste it here)</span>
          <textarea className="ui-sel desk-text" value={text} onChange={(e) => setText(e.target.value)} rows={12}
            placeholder="Paste the whole article. Put a short line like “Eagles:” on its own line wherever you want a section heading." />
          <button type="button" className="desk-link" onClick={() => setPaste(false)}>Attach a Word file instead</button>
        </label>
      )}
      <label className="desk-field">
        <span>One-line summary <em>(optional)</em></span>
        <input className="ui-sel" value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)}
          placeholder="Shows under the headline and when it's shared" />
      </label>
      <label className="desk-field">
        <span>Note for the editor <em>(optional)</em></span>
        <textarea className="ui-sel" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)}
          placeholder="Photo ideas, a clip you want in it, when it should go up…" />
      </label>
      <p className="desk-small desk-muted">
        Your words go up exactly as you wrote them. The editor fixes typos, adds pictures and clips, and publishes it.
        Pictures inside the Word file don't come through, so put any you want in the note.
      </p>
      {err && <p className="desk-err">{err}</p>}
      {sent && <p className="desk-ok">Sent {sent === "your article" ? sent : `“${sent}”`}. It's in the editor's queue now.</p>}
      <button type="submit" className="ui-btn desk-submit" data-on="true" disabled={!ready || busy}>{busy ? "Sending…" : "Submit for editing"}</button>
    </form>
  );
}

const MINE_STATUS: Record<string, [string, "outline" | "navy" | "gold" | "pos" | "neg"]> = {
  submitted: ["Sent", "outline"], editing: ["With the editor", "navy"], scheduled: ["Scheduled", "gold"],
  published: ["Live", "pos"], skipped: ["Not running", "outline"], failed: ["Couldn't read", "neg"],
};

function MySubmissions({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<Mine["submissions"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    deskFetch<Mine>("/api/desk/mine").then((j) => { setRows(j.submissions); setErr(null); }).catch((e) => setErr(String(e.message || e)));
  }, [reloadKey]);
  if (err) return <p className="desk-err">{err}</p>;
  if (!rows) return <p className="desk-muted">Loading…</p>;
  if (!rows.length) return <p className="desk-muted">Nothing sent yet.</p>;
  return (
    <ul className="desk-list">
      {rows.map((r) => {
        const [label, tone] = MINE_STATUS[r.status] || [r.status, "outline"];
        return (
          <li key={r.id} className="desk-row">
            <div className="desk-row__main">
              {r.url ? <a className="desk-row__title" href={r.url}>{r.title}</a> : <span className="desk-row__title">{r.title || "(no title yet)"}</span>}
              <div className="desk-row__meta">
                <Pill tone={tone}>{label}</Pill>
                <span>sent {when(r.at)}</span>
                {r.scheduled_at && <span>· goes live {when(r.scheduled_at)}</span>}
                {r.message && <span>· {r.message}</span>}
              </div>
            </div>
            {r.preview && <a className="ui-btn desk-row__open" href={r.preview}>See the preview</a>}
            {r.url && <a className="ui-btn desk-row__open" href={r.url}>Read it live</a>}
          </li>
        );
      })}
    </ul>
  );
}

function PasswordCard() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || pw.length < MIN_PASSWORD || busy) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Password changed. Use it next time you log in." });
    if (!error) setPw("");
  };
  return (
    <form className="desk-form desk-form--row" onSubmit={save}>
      <input className="ui-sel" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
        placeholder={`New password (${MIN_PASSWORD}+ characters)`} />
      <button type="submit" className="ui-btn" disabled={pw.length < MIN_PASSWORD || busy}>{busy ? "Saving…" : "Change password"}</button>
      {msg && <p className={msg.ok ? "desk-ok" : "desk-err"}>{msg.text}</p>}
    </form>
  );
}

export default function Desk() {
  const { session, loading } = useSession();
  const access = useDeskAccess();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { document.title = "Writers' desk · MVPeav"; }, []);

  if (!supabaseEnabled) return <EmptyState kicker="Writers' desk" title="Accounts aren't on in this build" />;
  if (loading || (session && !access.known)) return <div className="desk"><Card><p className="desk-muted">Loading…</p></Card></div>;
  if (!session) {
    return (
      <EmptyState kicker="Writers' desk" title="Log in to write for MVPeav">
        <p>Use the Log in button at the top of the page, then come back here.</p>
      </EmptyState>
    );
  }
  if (!access.writer) {
    return (
      <EmptyState kicker="Writers' desk" title="This account can't submit yet">
        <p>Writing for the site is invite-only. If MVPeav asked you to write, tell him your username and he'll switch it on.</p>
      </EmptyState>
    );
  }

  const submit = (
    <>
      <SubmitForm onSent={() => setReloadKey((k) => k + 1)} />
      <h3 className="desk-h3">What you've sent</h3>
      <MySubmissions reloadKey={reloadKey} />
    </>
  );

  return (
    <div className="desk">
      <PageHeader kicker="Writers' desk" title={access.editor ? "Drafts and submissions" : "Submit an article"}
        sub={access.editor
          ? "Unscheduled drafts up top; the calendar shows what's scheduled and what's posted. Open a workspace to edit, add pictures and publish."
          : `Writing as ${access.byline || "you"}. Send your article and the editor takes it from there.`} />
      {access.editor ? (
        <>
          <EditorQueue />
          <Card title="Submit an article yourself" kicker="Drop box">
            <details className="desk-details"><summary>Open the drop box</summary>{submit}</details>
          </Card>
        </>
      ) : (
        <Card title="New article">{submit}</Card>
      )}
      <Card title="Your login" kicker={session.user.email?.replace(/@mvpeav\.com$/, "") || undefined}>
        <PasswordCard />
      </Card>
    </div>
  );
}
