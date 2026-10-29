// src/pages/DeskWrite.tsx: /desk/write/<id>, where a writer writes (owner 2026-10-28). Replaces Word: type here, it
// autosaves to the server (and keeps a local copy in case the connection drops), insert requests / links / photos
// for the editor, ask the research bot to look something up while you keep writing, then send it to the editor.
// Any account with the writer role (src/lib/deskAccess.ts) can use it; the server checks the role on every call.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, EmptyState, Pill } from "../components/ui";
import { supabaseEnabled, useSession, getAccessToken } from "../lib/supabase";
import { deskFetch, useDeskAccess } from "../lib/deskAccess";
import { Editor, type EditorHandle } from "../components/desk/Editor";
import { DOC_ID_RE, dropLocal, emptyDoc, newDocId, readLocal, wordCount, writeLocal, type Block, type DeskDoc } from "../lib/deskDoc";
import "../styles/desk.css";
import "../styles/deskwrite.css";

const SPORTS = [["nfl", "NFL"], ["cfb", "College football"], ["cbb", "College basketball"], ["nhl", "NHL"], ["other", "Something else"]];
const SAVE_DEBOUNCE_MS = 1200;
const LOOKUP_POLL_MS = 12_000;

type Lookup = { id: string; q: string; at: string | null; doc_id: string | null; status: string; answer: string | null; facts: string[];
  sources: { title: string; url: string }[]; confidence: string | null; answered_at: string | null };

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const photoCache = new Map<string, Promise<string | null>>();
function photoUrlFor(name: string): Promise<string | null> {
  const hit = photoCache.get(name);
  if (hit) return hit;
  const p = (async () => {
    try {
      const jwt = await getAccessToken();
      const r = await fetch(`/api/desk/photos/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${jwt}` } });
      if (!r.ok) return null;
      return URL.createObjectURL(await r.blob());
    } catch { return null; }
  })();
  photoCache.set(name, p);
  return p;
}

async function uploadPhoto(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error("That photo is over 15 MB. Send a smaller one.");
  const type = file.type || "image/jpeg";
  const r = await deskFetch<{ upload: string }>("/api/desk/photos", { method: "POST", headers: { "Content-Type": type }, body: file });
  photoCache.set(r.upload, Promise.resolve(URL.createObjectURL(file)));
  return r.upload;
}

export default function DeskWrite() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { session, loading } = useSession();
  const access = useDeskAccess();
  const [doc, setDoc] = useState<DeskDoc | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: "clean" | "dirty" | "saving" | "saved" | "error"; at?: string; msg?: string }>({ state: "clean" });
  const [words, setWords] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [side, setSide] = useState(false);
  const editor = useRef<EditorHandle | null>(null);
  const docRef = useRef<DeskDoc | null>(null);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const saving = useRef(false);

  useEffect(() => { document.title = "Write · MVPeav"; }, []);

  // load: the server copy, or a local copy with edits the server never got, or a brand-new document
  useEffect(() => {
    if (!session || !access.writer || !DOC_ID_RE.test(id)) return;
    let alive = true;
    (async () => {
      let server: DeskDoc | null = null;
      try { server = (await deskFetch<{ doc: DeskDoc }>(`/api/desk/docs/${id}`)).doc; }
      catch (e: any) { if (!/isn't here/.test(String(e?.message))) { if (alive) setLoadErr(String(e?.message || e)); return; } }
      const local = readLocal(id);
      let d = server || (local?.doc ?? emptyDoc(id));
      if (local?.dirty && local.doc && (!server || local.base_rev === server.rev)) {
        d = { ...local.doc, rev: server?.rev ?? 0, submitted: server?.submitted ?? null };   // unsaved edits from a closed tab
        dirty.current = true;
      }
      if (!alive) return;
      docRef.current = d; setDoc(d); setWords(wordCount(d.blocks)); setEditorKey((k) => k + 1);
      if (dirty.current) { setSave({ state: "dirty" }); schedule(); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.user?.id, access.writer]);

  const persist = useCallback(async () => {
    const d = docRef.current;
    if (!d || saving.current || d.submitted) return;
    saving.current = true; dirty.current = false;
    setSave({ state: "saving" });
    try {
      const r = await deskFetch<{ rev: number; updated: string; words: number }>(`/api/desk/docs/${d.id}`, {
        method: "PUT", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ base_rev: d.rev, title: d.title, sport: d.sport, summary: d.summary, note: d.note, blocks: d.blocks }),
      });
      const cur = docRef.current!;
      docRef.current = { ...cur, rev: r.rev, updated: r.updated };
      setDoc(docRef.current);
      writeLocal(d.id, { base_rev: r.rev, dirty: dirty.current, doc: docRef.current, at: Date.now() });
      setSave({ state: dirty.current ? "dirty" : "saved", at: r.updated });
      if (dirty.current) schedule();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/changed somewhere else|been sent/.test(msg)) {
        // a newer copy exists (another tab / phone) or it was sent: take the server's copy
        try {
          const srv = (await deskFetch<{ doc: DeskDoc }>(`/api/desk/docs/${d.id}`)).doc;
          docRef.current = srv; setDoc(srv); setWords(wordCount(srv.blocks)); setEditorKey((k) => k + 1); dropLocal(d.id);
          setSave({ state: "error", msg });
        } catch { setSave({ state: "error", msg }); }
      } else {
        dirty.current = true;
        setSave({ state: "error", msg: `${msg} Your text is kept on this device; retrying.` });
        timer.current = window.setTimeout(() => void persist(), 8000);
      }
    } finally {
      saving.current = false;
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
  }, [persist]);

  const change = useCallback((patch: Partial<DeskDoc>) => {
    const cur = docRef.current;
    if (!cur || cur.submitted) return;
    docRef.current = { ...cur, ...patch };
    dirty.current = true;
    writeLocal(cur.id, { base_rev: cur.rev, dirty: true, doc: docRef.current, at: Date.now() });
    if (patch.blocks) setWords(wordCount(patch.blocks));
    else setDoc(docRef.current);
    setSave((s) => (s.state === "saving" ? s : { state: "dirty" }));
    schedule();
  }, [schedule]);

  const onBlocks = useCallback((blocks: Block[]) => change({ blocks }), [change]);

  // save on the way out (tab hidden / closed) and on unmount
  useEffect(() => {
    const flush = () => { if (dirty.current && docRef.current && !docRef.current.submitted) void persist(); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    const onBefore = (e: BeforeUnloadEvent) => { if (dirty.current || saving.current) { flush(); e.preventDefault(); } };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onBefore);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("beforeunload", onBefore); flush(); };
  }, [persist]);

  const send = async (fields: SendFields) => {
    const d = docRef.current!;
    const { mode, image_bot, ...docFields } = fields;
    change(docFields);
    if (timer.current) window.clearTimeout(timer.current);
    await persist();
    if (dirty.current) throw new Error("Couldn't save the latest changes. Check the connection and try again.");
    const r = await deskFetch<{ id: string }>("/api/desk/submissions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_id: d.id, ...docFields, mode, image_bot }),
    });
    const now = new Date().toISOString();
    docRef.current = { ...docRef.current!, submitted: { sid: r.id, at: now } };
    setDoc(docRef.current); dropLocal(d.id); setSent(r.id); setSendOpen(false); setEditorKey((k) => k + 1);
  };

  const makeCopy = async () => {
    const d = docRef.current!;
    const nid = newDocId();
    const copy: DeskDoc = { ...emptyDoc(nid, d.sport), title: d.title ? `${d.title} (copy)` : "", summary: d.summary, note: d.note, blocks: d.blocks };
    writeLocal(nid, { base_rev: 0, dirty: true, doc: copy, at: Date.now() });
    nav(`/desk/write/${nid}`);
  };

  if (!supabaseEnabled) return <EmptyState kicker="Writers' desk" title="Accounts aren't on in this build" />;
  if (loading || (session && !access.known)) return <div className="desk"><Card><p className="desk-muted">Loading…</p></Card></div>;
  if (!session) return <EmptyState kicker="Writers' desk" title="Log in to write for MVPeav"><p>Use the Log in button at the top of the page, then come back here.</p></EmptyState>;
  if (!access.writer) return <EmptyState kicker="Writers' desk" title="This account can't write yet"><p>Writing for the site is invite-only. If MVPeav asked you to write, tell him your username.</p></EmptyState>;
  if (!DOC_ID_RE.test(id)) return <EmptyState kicker="Writers' desk" title="That isn't a document"><p><Link to="/desk">Back to the desk</Link></p></EmptyState>;
  if (loadErr) return <div className="desk"><Card><p className="desk-err">{loadErr}</p><p><Link to="/desk">Back to the desk</Link></p></Card></div>;
  if (!doc) return <div className="desk"><Card><p className="desk-muted">Opening…</p></Card></div>;

  const locked = Boolean(doc.submitted);
  const status = locked ? "Sent to the editor" : save.state === "saving" ? "Saving…" : save.state === "saved" ? `Saved ${ago(save.at)}`
    : save.state === "dirty" ? "Unsaved changes" : save.state === "error" ? "Couldn't save" : doc.rev ? `Saved ${ago(doc.updated)}` : "Not saved yet";

  return (
    <div className={`dwp${side ? " dwp--side" : ""}`}>
      <div className="dwp__top">
        <Link to="/desk" className="desk-link">← Writers' desk</Link>
        <span className={`dwp__status dwp__status--${locked ? "sent" : save.state}`}>{status}</span>
        <span className="desk-muted desk-small">{words} words</span>
        {!locked && <button type="button" className="ui-btn" data-on="true" disabled={words < 15} onClick={() => setSendOpen(true)}>Send to the editor</button>}
        {locked && <button type="button" className="ui-btn" onClick={makeCopy}>Make a copy</button>}
      </div>
      {save.state === "error" && save.msg && <p className="desk-err">{save.msg}</p>}
      {sent && <p className="desk-ok">Sent. It's in the editor's queue now; you'll see it under “What you've sent” on the desk.</p>}
      {locked && !sent && <p className="desk-muted desk-small">This one was sent {ago(doc.submitted?.at)}. It's read-only here; make a copy to work from it again.</p>}
      <div className="dwp__main">
        <div className="dwp__paper">
          <input className="dwp__title" value={doc.title} maxLength={140} placeholder="Headline (optional: the editor can write one)"
            disabled={locked} onChange={(e) => change({ title: e.target.value })} />
          <Editor key={editorKey} initial={doc.blocks} readOnly={locked} onChange={onBlocks} uploadPhoto={uploadPhoto} photoUrl={photoUrlFor}
            handle={(h) => { editor.current = h; }}
            extraTools={<button type="button" className={`dw-tb dw-tb--wide${side ? " is-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setSide((s) => !s)}>🔎 Lookup</button>} />
        </div>
        <aside className={`dwp__side${side ? " is-open" : ""}`} aria-label="Lookups">
          <LookupPanel docId={doc.id} onClose={() => setSide(false)} onInsert={(t) => editor.current?.insertParagraph(t)} locked={locked} />
        </aside>
      </div>
      {sendOpen && <SendSheet doc={doc} onClose={() => setSendOpen(false)} onSend={send} />}
    </div>
  );
}

function LookupPanel({ docId, onClose, onInsert, locked }: { docId: string; onClose: () => void; onInsert: (t: string) => void; locked: boolean }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lookup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows((await deskFetch<{ lookups: Lookup[] }>("/api/desk/lookups")).lookups); setErr(null); }
    catch (e: any) { setErr(String(e?.message || e)); }
  }, []);
  const pending = useMemo(() => (rows || []).some((r) => r.status === "asked" || r.status === "working"), [rows]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, LOOKUP_POLL_MS);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 4 || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await deskFetch<{ id: string; q: string; at: string; status: string }>("/api/desk/lookups", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: q.trim(), doc_id: docId }),
      });
      setRows((rs) => [{ id: r.id, q: r.q, at: r.at, doc_id: docId, status: "asked", answer: null, facts: [], sources: [], confidence: null, answered_at: null }, ...(rs || [])]);
      setQ("");
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };

  return (
    <div className="dwl">
      <div className="dwl__head">
        <strong>🔎 Lookup</strong>
        <button type="button" className="dw-ins__btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="desk-small desk-muted">Need a number or a fact? Ask, keep writing, and the answer lands here in a minute or two with its sources.</p>
      <form className="dwl__ask" onSubmit={ask}>
        <input className="ui-sel" value={q} maxLength={600} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Cowboys' record in one-score games this season" />
        <button type="submit" className="ui-btn" data-on="true" disabled={busy || q.trim().length < 4}>{busy ? "Sending…" : "Look it up"}</button>
      </form>
      {err && <p className="desk-err">{err}</p>}
      {rows === null ? <p className="desk-muted desk-small">Loading…</p> : rows.length === 0 ? <p className="desk-muted desk-small">Nothing asked yet.</p> : (
        <ul className="dwl__list">
          {rows.map((r) => (
            <li key={r.id} className={`dwl__item dwl__item--${r.status}`}>
              <div className="dwl__q">{r.q}</div>
              <div className="dwl__meta">
                <Pill tone={r.status === "done" ? "pos" : r.status === "failed" ? "neg" : "gold"}>
                  {r.status === "done" ? `Answer${r.confidence ? ` · ${r.confidence} confidence` : ""}` : r.status === "failed" ? "Couldn't find it" : "Looking…"}
                </Pill>
                <span>asked {ago(r.at)}</span>
              </div>
              {r.answer && <p className="dwl__a">{r.answer}</p>}
              {r.facts.length > 0 && <ul className="dwl__facts">{r.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
              {r.sources.length > 0 && (
                <p className="dwl__src">{r.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</p>
              )}
              {r.answer && !locked && (
                <div className="ws-row">
                  <button type="button" className="ui-btn dwl__btn" onClick={() => onInsert(r.answer || "")}>Put it in the piece</button>
                  <button type="button" className="ui-btn dwl__btn" onClick={() => { void navigator.clipboard?.writeText([r.answer, ...r.facts].join("\n")); }}>Copy</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SendFields = { title: string; sport: string; summary: string; note: string; mode: "written" | "outline"; image_bot: boolean };

function SendSheet({ doc, onClose, onSend }: { doc: DeskDoc; onClose: () => void; onSend: (f: SendFields) => Promise<void> }) {
  const [title, setTitle] = useState(doc.title);
  const [sport, setSport] = useState(doc.sport || "nfl");
  const [summary, setSummary] = useState(doc.summary);
  const [note, setNote] = useState(doc.note);
  // owner 2026-10-29: a writer may send an OUTLINE and have BlogBot write the piece (he edits it after), and may let the
  // image bot fill in pictures for every section
  const [mode, setMode] = useState<"written" | "outline">("written");
  const [imageBot, setImageBot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const asks = doc.blocks.filter((b) => b.kind === "insert").length;
  const words = doc.blocks.reduce((n, b) => n + (b.kind === "insert" ? 0 : b.html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length), 0);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "written" && words < 50) { setErr("That's short for a finished article. If it's an outline, pick “Have BlogBot write it” below."); return; }
    setBusy(true); setErr(null);
    try { await onSend({ title: title.trim(), sport, summary: summary.trim(), note: note.trim(), mode, image_bot: imageBot }); }
    catch (e: any) { setErr(String(e?.message || e)); setBusy(false); }
  };
  return (
    <div className="dw-sheet" role="dialog" aria-modal="true" aria-label="Send to the editor" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="dw-sheet__box" onSubmit={go}>
        <div className="dw-sheet__head"><strong>Send to the editor</strong><button type="button" className="dw-ins__btn" onClick={onClose} aria-label="Close">✕</button></div>
        <label className="desk-field">
          <span>Headline <em>(optional: leave it blank and the editor writes one)</em></span>
          <input className="ui-sel" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="desk-field">
          <span>Section</span>
          <select className="ui-sel" value={sport} onChange={(e) => setSport(e.target.value)}>{SPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="desk-field">
          <span>One-line summary <em>(optional)</em></span>
          <input className="ui-sel" value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)} placeholder="Shows under the headline and when it's shared" />
        </label>
        <label className="desk-field">
          <span>Note for the editor <em>(optional)</em></span>
          <textarea className="ui-sel" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Anything he should know: when it should go up, what to look for…" />
        </label>
        <fieldset className="desk-field dw-send__mode">
          <span>What should happen to it?</span>
          <label className="dw-send__opt">
            <input type="radio" name="mode" checked={mode === "written"} onChange={() => setMode("written")} />
            <span><b>It's finished: use my words as written.</b> The editor fixes typos, adds pictures and clips, and publishes.</span>
          </label>
          <label className="dw-send__opt">
            <input type="radio" name="mode" checked={mode === "outline"} onChange={() => setMode("outline")} />
            <span><b>It's an outline: have BlogBot write it.</b> Your headings and points are the structure; the bot researches and writes a full draft under your name, then you open it and tweak it, add your color, swap pictures. The editor publishes when you're done.</span>
          </label>
        </fieldset>
        <label className="dw-send__opt">
          <input type="checkbox" checked={imageBot} onChange={(e) => setImageBot(e.target.checked)} />
          <span><b>Let the image bot fill in pictures.</b> Every section gets a picture idea or a graphic; the editor approves them.</span>
        </label>
        <p className="desk-small desk-muted">
          {mode === "written" ? "Your words go up exactly as you wrote them." : "BlogBot writes it from your outline; what you send here is the plan, not the article."}
          {asks > 0 && ` Your ${asks} insert${asks === 1 ? "" : "s"} go with it.`} You can't edit it here after sending (make a copy if you need to).
        </p>
        {err && <p className="desk-err">{err}</p>}
        <div className="dw-sheet__foot">
          <button type="button" className="ui-btn" disabled={busy} onClick={onClose}>Not yet</button>
          <button type="submit" className="ui-btn" data-on="true" disabled={busy}>{busy ? "Sending…" : "Send it"}</button>
        </div>
      </form>
    </div>
  );
}
