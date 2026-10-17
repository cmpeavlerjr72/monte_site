// src/pages/blog/PreviewPost.tsx: /preview/:token, the owner's private draft preview (2026-10-16).
//
// BlogBot uploads the draft (exactly as it would publish: hero, charts, embeds, captions, receipts) to a private store;
// the server answers /api/preview/<token> with {meta, body, version, held, hold} for a valid, unexpired token and a
// plain 404 otherwise. This page renders it with the same PostArticle as /blog/:slug, plus a slim banner. Never indexed
// (the server sends noindex; useDocumentMeta says so too); nothing links here.
//
// EDITING (2026-10-17). Opened from the bot's "✏️ Edit in preview" link (/preview/<token>#edit=<secret>), the page keeps
// the edit secret for this token in localStorage, drops it from the address bar, and lets the owner tap any paragraph,
// heading, list or quote to edit it in place. Save queues the edit on the server (X-Preview-Edit carries the secret);
// the owner's PC turns it into a new draft version within seconds and rebuilds the preview. The page shows the change
// right away, polls for the result ("Saved · v8", or why the bot refused it) and then reloads the real draft. Embeds,
// photos and callouts aren't tappable: those are changed from the bot.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { SkeletonLines } from "../../components/Skeleton";
import type { BlockEdit } from "../../components/blog/Markdown";
import type { BlogMeta } from "../../lib/blog/posts";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { PostArticle } from "./BlogPost";

type Preview = { meta: BlogMeta; body: string; version: number | null; held: boolean; hold: string | null; editable?: boolean };
type Job = { id: string; status: "working" | "saved" | "refused" | "failed"; version?: number | null; error?: string | null; since: number };

const secretKey = (token: string) => `mvpeav:pvedit:${token}`;
const HEADING = /^#{1,6}\s+/;
const POLL_MS = 2000;
const SLOW_MS = 90_000;

/** The edit secret: from the #edit= fragment (stored, then wiped from the address bar) or from an earlier visit. */
function readSecret(token: string): string {
  const m = /(?:^#|&)edit=([A-Za-z0-9_-]{16,128})/.exec(window.location.hash);
  if (m) {
    try { localStorage.setItem(secretKey(token), m[1]); } catch { /* private mode: kept for this visit only */ }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return m[1];
  }
  try { return localStorage.getItem(secretKey(token)) || ""; } catch { return ""; }
}

function forgetSecret(token: string) {
  try { localStorage.removeItem(secretKey(token)); } catch { /* nothing stored */ }
}

/** How many times `old` appears before `start`: tells the bot which copy was tapped when the same text repeats. */
function occurrencesBefore(body: string, old: string, start: number): number {
  let n = 0;
  for (let i = body.indexOf(old); i >= 0 && i < start; i = body.indexOf(old, i + old.length)) n++;
  return n;
}

function splice(body: string, start: number, end: number, next: string): string {
  if (next) return body.slice(0, start) + next + body.slice(end);
  const before = body.slice(0, start).replace(/\n+$/, ""), after = body.slice(end).replace(/^\n+/, "");
  return before + (before && after ? "\n\n" : "\n") + after;
}

function BlockEditor({ source, busy, error, onSave, onCancel }: {
  source: string; busy: boolean; error: string | null; onSave: (text: string) => void; onCancel: () => void;
}) {
  const heading = HEADING.test(source);
  const [text, setText] = useState(heading ? source.replace(HEADING, "") : source);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const t = ref.current;
    if (t) { t.style.height = "auto"; t.style.height = `${t.scrollHeight + 2}px`; }
  };
  useEffect(() => {
    fit();
    const t = ref.current;
    if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); }
  }, []);
  return (
    <div className={heading ? "pe-editor pe-editor--heading" : "pe-editor"}>
      <textarea
        ref={ref} value={text} rows={heading ? 1 : 4} disabled={busy} aria-label={heading ? "Edit heading" : "Edit paragraph"}
        onChange={(e) => { setText(heading ? e.target.value.replace(/\s*\n+\s*/g, " ") : e.target.value); fit(); }}
      />
      {error && <p className="pe-editor__err" role="alert">{error}</p>}
      <div className="pe-editor__bar">
        <button type="button" className="pe-btn pe-btn--primary" disabled={busy} onClick={() => onSave(text)}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="pe-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        {!heading && (
          <button type="button" className="pe-btn pe-btn--danger" disabled={busy}
            onClick={() => { if (window.confirm("Delete this paragraph?")) onSave(""); }}>Delete</button>
        )}
        {!heading && <span className="pe-editor__hint">**bold** · *italic* · [link](url)</span>}
      </div>
    </div>
  );
}

export default function PreviewPost() {
  const { token = "" } = useParams();
  const [doc, setDoc] = useState<Preview | null>(null);
  const [missing, setMissing] = useState(false);
  const [secret, setSecret] = useState("");
  const [editOn, setEditOn] = useState(true);
  const [active, setActive] = useState<{ start: number; end: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reloadDue, setReloadDue] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async (sec: string) => {
    const r = await fetch(`/api/preview/${encodeURIComponent(token)}`, {
      cache: "no-store", referrerPolicy: "no-referrer", headers: sec ? { "X-Preview-Edit": sec } : undefined,
    });
    const j = r.ok ? await r.json() : null;
    if (!j || !j.meta || typeof j.body !== "string") throw new Error("missing");
    if (sec && !j.editable) { forgetSecret(token); setSecret(""); }
    setDoc(j as Preview);
  }, [token]);

  useEffect(() => {
    let alive = true;
    setDoc(null); setMissing(false); setActive(null); setJobs([]);
    const sec = readSecret(token);
    setSecret(sec);
    load(sec).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [token, load]);

  // Poll queued edits until the bot answers each one; then reload the real draft (not while an editor is open: the
  // offsets it points at would move under it).
  const working = jobs.some((j) => j.status === "working");
  useEffect(() => {
    if (!working || !secret) return;
    const t = window.setInterval(async () => {
      setTick((n) => n + 1);
      const open = jobs.filter((j) => j.status === "working");
      const got = await Promise.all(open.map((j) =>
        fetch(`/api/preview/${encodeURIComponent(token)}/edits/${j.id}`, { cache: "no-store", headers: { "X-Preview-Edit": secret } })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      const done = got.filter((g) => g && g.status && g.status !== "working");
      if (!done.length) return;
      setJobs((cur) => cur.map((j) => {
        const g = done.find((d) => d.id === j.id);
        return g ? { ...j, status: g.status, version: g.version, error: g.error } : j;
      }));
      setReloadDue(true);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [working, jobs, secret, token]);

  useEffect(() => {
    if (reloadDue && !working && !active) {
      setReloadDue(false);
      load(secret).catch(() => { /* keep what's on screen */ });
    }
  }, [reloadDue, working, active, load, secret]);

  // "Saved · v8" shows for a few seconds, then gets out of the way.
  useEffect(() => {
    if (working || !jobs.length || !jobs.every((j) => j.status === "saved")) return;
    const t = window.setTimeout(() => setJobs([]), 5000);
    return () => window.clearTimeout(t);
  }, [working, jobs]);

  useDocumentMeta({ title: doc ? `Preview: ${doc.meta.title}` : "Preview", noindex: true });

  const body = doc?.body ?? "";
  const save = async (text: string) => {
    if (!doc || !active) return;
    const old = body.slice(active.start, active.end);
    const heading = HEADING.test(old);
    const next = heading ? (text.trim() ? old.match(HEADING)![0] + text.trim() : "") : text.trim();
    if (heading && !next) { setEditorError("A heading can't be empty. To drop a whole section, use the bot."); return; }
    if (next === old.trim()) { setActive(null); setEditorError(null); return; }
    setSending(true); setEditorError(null);
    try {
      const r = await fetch(`/api/preview/${encodeURIComponent(token)}/edits`, {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Preview-Edit": secret },
        body: JSON.stringify({ kind: heading ? "heading" : "block", old, new: next, nth: occurrencesBefore(body, old, active.start), base_version: doc.version }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status !== 202 || !j.id) {
        if (r.status === 403) { forgetSecret(token); setSecret(""); }
        setEditorError(j.message || "Couldn't save that edit. Try again.");
        return;
      }
      setDoc({ ...doc, body: splice(body, active.start, active.end, next) });
      setJobs((cur) => [...cur.filter((x) => x.status === "working"), { id: j.id, status: "working", since: Date.now() }]);
      setActive(null);
    } catch {
      setEditorError("No connection. Your text is still here; try Save again.");
    } finally {
      setSending(false);
    }
  };

  if (missing) {
    return (
      <EmptyState kicker="Preview" title="This preview isn't available">
        <p>The link is wrong, has expired, or the post has been published.</p>
      </EmptyState>
    );
  }
  if (!doc) return <div className="post"><SkeletonLines rows={8} height={16} /></div>;

  const canEdit = Boolean(doc.editable && secret);
  const edit: BlockEdit | undefined = canEdit && editOn ? {
    active: active?.start ?? null,
    onTap: (start, end) => { if (!sending) { setActive({ start, end }); setEditorError(null); } },
    render: (start, end) => (
      <BlockEditor key={start} source={body.slice(start, end)} busy={sending} error={editorError} onSave={save}
        onCancel={() => { setActive(null); setEditorError(null); }} />
    ),
  } : undefined;

  const banner = (
    <div className="post-preview-banner" role="note">
      <b>PREVIEW</b> · not published{doc.version != null ? ` · v${doc.version}` : ""}
      {doc.held ? <> · <b>held</b>{doc.hold ? `: ${doc.hold}` : ""} (private to you)</> : null}
      {canEdit && (
        <div className="pe-banner">
          <span>{editOn ? "✏️ Tap any paragraph or heading to edit it." : "Editing is off."}</span>
          <button type="button" className="pe-btn pe-btn--small" onClick={() => { setEditOn(!editOn); setActive(null); }}>
            {editOn ? "Turn off" : "Turn on"}
          </button>
        </div>
      )}
    </div>
  );

  const open = jobs.filter((j) => j.status === "working");
  const slow = open.some((j) => Date.now() - j.since > SLOW_MS);
  const last = [...jobs].reverse().find((j) => j.status !== "working");
  const bad = jobs.filter((j) => j.status === "refused" || j.status === "failed");
  let status: React.ReactNode = null;
  if (open.length) {
    status = <>Saving {open.length > 1 ? `${open.length} edits` : "your edit"}…{slow ? " The bot hasn't picked it up yet (is the PC on?). It's queued and will save when it does." : ""}</>;
  } else if (bad.length) {
    status = (
      <>
        {bad.length > 1 ? `${bad.length} edits weren't saved. ` : "Not saved: "}{bad[bad.length - 1].error || "try again."}
        <button type="button" className="pe-status__x" aria-label="Dismiss" onClick={() => setJobs((cur) => cur.filter((j) => j.status === "working"))}>×</button>
      </>
    );
  } else if (last?.status === "saved") {
    status = <>Saved{last.version != null ? ` · v${last.version}` : ""}</>;
  }

  return (
    <>
      <PostArticle post={{ ...doc.meta, draft: true }} body={doc.body} banner={banner} edit={edit} />
      {status && <div className={bad.length && !open.length ? "pe-status pe-status--bad" : "pe-status"} role="status" aria-live="polite">{status}</div>}
    </>
  );
}
