// src/pages/blog/PreviewPost.tsx: /preview/:token, the owner's private draft preview (2026-10-16) and, since 2026-10-19,
// the whole DRAFT WORKSPACE.
//
// BlogBot uploads the draft (exactly as it would publish: hero, charts, embeds, captions, receipts) to a private store;
// the server answers /api/preview/<token> with {meta, body, version, held, hold} for a valid, unexpired token and a
// plain 404 otherwise. This page renders it with the same PostArticle as /blog/:slug. Never indexed (the server sends
// noindex; useDocumentMeta says so too); nothing links here.
//
// EDITING (2026-10-17). Opened from the bot's edit link (/preview/<token>#edit=<secret>), the page keeps the edit secret
// for this token in localStorage, drops it from the address bar, and lets the owner tap any paragraph, heading, list or
// quote to edit it in place. Save queues the edit on the server (X-Preview-Edit carries the secret); the owner's PC
// turns it into a new draft version within seconds and rebuilds the preview.
//
// THE WORKSPACE (2026-10-19, owner: "everything going through that page"). With the edit secret the server also hands
// back `ws` (cfb-props-sim/scripts/blogbot/WORKSPACE.md): the draft from the moment it's requested. Researching → the
// outline (type, take, "change the outline", Write it) and the owner's questions → the draft with image ideas, facts,
// a "+" after every block (upload / link / chart request / searches), options on every image and the hero (request a
// change, replace, move, alt, hero, remove), and Publish / Schedule with the X text shown before the one confirm tap.
// Every button is an ACTION queued like an edit; the bot answers each one and rebuilds this bundle. The read-only link
// (no secret) still shows only the article.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { SkeletonLines } from "../../components/Skeleton";
import type { BlockEdit } from "../../components/blog/Markdown";
import type { BlogMeta } from "../../lib/blog/posts";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { PostArticle } from "./BlogPost";
import { postAction, uploadPhoto, useJobs, type Job } from "../../components/blog/workspace/api";
import type { Act, Anchor, Ws } from "../../components/blog/workspace/types";
import { Feed, FactsNudge, ImageTray, LiveCard, OutlinePanel, PlanningCard, QuestionsPanel, TopBar } from "../../components/blog/workspace/Panels";
import { TableEditor, mdToGrid } from "../../components/blog/workspace/TableEditor";
import { AddSheet, FactsSheet, HeroSheet, ImageSheet, MenuSheet, PublishSheet, SectionSheet } from "../../components/blog/workspace/Sheets";

type Preview = { meta: BlogMeta; body: string; version: number | null; held: boolean; hold: string | null; editable?: boolean; ws?: Ws };
type SheetState =
  | { kind: "image"; iid: string } | { kind: "hero" } | { kind: "add"; anchor: Anchor } | { kind: "publish"; schedule?: boolean }
  | { kind: "menu" } | { kind: "facts" } | { kind: "section"; anchor: Anchor } | null;

const secretKey = (token: string) => `mvpeav:pvedit:${token}`;
const HEADING = /^#{1,6}\s+/;
const STUCK_MS = 90_000;

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

function BlockEditor({ source, busy, error, onSave, onCancel, onSection }: {
  source: string; busy: boolean; error: string | null; onSave: (text: string) => void; onCancel: () => void; onSection?: () => void;
}) {
  const grid = mdToGrid(source);                    // a tapped table opens as a grid, not raw | pipes | (2026-10-21)
  if (grid) {
    return (
      <div className="pe-editor">
        <TableEditor initial={grid} button="Save" busy={busy} onSave={onSave} onCancel={onCancel} onDelete={() => onSave("")} />
        {error && <p className="pe-editor__err" role="alert">{error}</p>}
      </div>
    );
  }
  return <TextBlockEditor source={source} busy={busy} error={error} onSave={onSave} onCancel={onCancel} onSection={onSection} />;
}

function TextBlockEditor({ source, busy, error, onSave, onCancel, onSection }: {
  source: string; busy: boolean; error: string | null; onSave: (text: string) => void; onCancel: () => void; onSection?: () => void;
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
        {onSection && <button type="button" className="pe-btn" disabled={busy} onClick={onSection}>Rewrite section…</button>}
        {!heading && <span className="pe-editor__hint">**bold** · *italic* · [link](url)</span>}
      </div>
    </div>
  );
}

function statusLine(jobs: Job[]): { node: React.ReactNode; bad: boolean } | null {
  const open = jobs.filter((j) => j.status === "working");
  const bad = jobs.filter((j) => j.status === "refused" || j.status === "failed");
  const last = [...jobs].reverse().find((j) => j.status !== "working");
  if (open.length) {
    const stuck = open.some((j) => Date.now() - j.since > STUCK_MS);
    const label = open.length > 1 ? `${open.length} things` : open[0].label;
    return { node: <>{label}…{stuck ? " The bot hasn't picked it up yet (is the PC on?). It's queued and will go through when it does." : ""}</>, bad: false };
  }
  if (bad.length) {
    const b = bad[bad.length - 1];
    return { node: <>{bad.length > 1 ? `${bad.length} things didn't go through. ` : "Didn't go through: "}{b.message || b.error || "try again."}</>, bad: true };
  }
  if (last) {
    if (last.message) return { node: <>{last.message}</>, bad: false };
    if (last.status === "saved") return { node: <>Saved{last.version != null ? ` · v${last.version}` : ""}</>, bad: false };
    if (last.status === "queued") return { node: <>On it. The page updates when it's done.</>, bad: false };
    return { node: <>Done</>, bad: false };
  }
  return null;
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
  const [sheet, setSheet] = useState<SheetState>(null);
  const holdBody = useRef(false);                 // an editor is open or an edit is in flight: don't swap the body under it
  const bodyDue = useRef(false);

  const fetchDoc = useCallback(async (sec: string): Promise<Preview> => {
    const r = await fetch(`/api/preview/${encodeURIComponent(token)}`, {
      cache: "no-store", referrerPolicy: "no-referrer", headers: sec ? { "X-Preview-Edit": sec } : undefined,
    });
    const j = r.ok ? await r.json() : null;
    if (!j || !j.meta || typeof j.body !== "string") throw new Error("missing");
    return j as Preview;
  }, [token]);

  const apply = useCallback((j: Preview, sec: string) => {
    if (sec && !j.editable) { forgetSecret(token); setSecret(""); }
    setDoc((cur) => {
      if (cur && holdBody.current && (j.body !== cur.body || j.version !== cur.version)) {
        bodyDue.current = true;                   // keep the text he's looking at; take the rest (ws) now
        return { ...j, body: cur.body, version: cur.version };
      }
      bodyDue.current = false;
      return j;
    });
  }, [token]);

  const reload = useCallback(() => {
    fetchDoc(secret).then((j) => apply(j, secret)).catch(() => { /* keep what's on screen */ });
  }, [fetchDoc, apply, secret]);

  const { jobs, add, dismiss, working } = useJobs(token, secret, reload);
  const editsWorking = jobs.some((j) => j.kind === "edit" && j.status === "working");
  holdBody.current = !!active || editsWorking;

  useEffect(() => {
    let alive = true;
    setDoc(null); setMissing(false); setActive(null); setSheet(null);
    const sec = readSecret(token);
    setSecret(sec);
    fetchDoc(sec).then((j) => { if (alive) apply(j, sec); }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [token, fetchDoc, apply]);

  // No timer: the page reloads when something HE started changes (useJobs above) and when he comes back to the tab
  // (e.g. from a Telegram ping: outline ready, draft ready). Owner 2026-10-19.
  const ws = doc?.editable && secret ? doc.ws : undefined;
  useEffect(() => {
    if (!ws) return;
    const back = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [!!ws, reload]);

  // A body that arrived while he was editing goes in once he's done.
  useEffect(() => {
    if (bodyDue.current && !active && !editsWorking) reload();
  }, [active, editsWorking, reload]);

  useDocumentMeta({ title: doc ? `Preview: ${doc.meta.title}` : "Preview", noindex: true });

  const act: Act = useCallback(async (type, args = {}, label = "Sending") => {
    const r = await postAction(token, secret, type, args, doc?.version ?? null);
    if (!r.ok) {
      if (r.status === 403) { forgetSecret(token); setSecret(""); }
      window.alert(r.message);
      return { ok: false, message: r.message };
    }
    add({ id: r.id, kind: "action", label });
    return { ok: true };
  }, [token, secret, doc?.version, add]);

  const upload = useCallback((file: File) => uploadPhoto(token, secret, file), [token, secret]);

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
      holdBody.current = true;
      setDoc({ ...doc, body: splice(body, active.start, active.end, next) });
      add({ id: j.id, kind: "edit", label: "Saving your edit" });
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
  const stage = ws?.stage || (body ? "drafted" : "planning");
  const workspaceDraft = !!ws && (stage === "drafted" || stage === "published");
  const anchorOf = (start: number, end: number): Anchor => {
    const text = body.slice(start, end);
    return { text, nth: occurrencesBefore(body, text, start) };
  };

  const edit: BlockEdit | undefined = canEdit && editOn && body && (!ws || stage === "drafted") ? {
    active: active?.start ?? null,
    onTap: (start, end) => { if (!sending) { setActive({ start, end }); setEditorError(null); } },
    render: (start, end) => (
      <BlockEditor key={start} source={body.slice(start, end)} busy={sending} error={editorError} onSave={save}
        onCancel={() => { setActive(null); setEditorError(null); }}
        onSection={ws && !ws.guest ? () => setSheet({ kind: "section", anchor: anchorOf(start, end) }) : undefined} />
    ),
    ...(ws ? {
      onMedia: (wsid: string) => setSheet({ kind: "image", iid: wsid }),
      renderInsert: (start: number, end: number) => (
        <div className="ws-insert">
          <button type="button" className="ws-insert__btn" aria-label="Add an image, link or chart here"
            onClick={() => setSheet({ kind: "add", anchor: anchorOf(start, end) })}>+</button>
        </div>
      ),
    } : {}),
  } : undefined;

  const status = statusLine(jobs);
  const toast = status && (
    <div className={status.bad ? "pe-status pe-status--bad" : "pe-status"} role="status" aria-live="polite">
      {status.node}
      {status.bad && <button type="button" className="pe-status__x" aria-label="Dismiss" onClick={dismiss}>×</button>}
    </div>
  );

  // ---- read-only link, or an old bundle with no workspace: the article as it always was
  if (!ws) {
    if (!body) {
      return (
        <EmptyState kicker="Preview" title="Draft in progress">
          <p>{doc.meta.title || "This draft"} isn't written yet. Check back in a few minutes.</p>
        </EmptyState>
      );
    }
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
    return (
      <>
        <PostArticle post={{ ...doc.meta, draft: true }} body={doc.body} banner={banner} edit={edit} />
        {toast}
      </>
    );
  }

  // ---- the workspace
  const sheetImage = sheet?.kind === "image" ? (ws.images || []).find((i) => i.id === sheet.iid) : undefined;
  const close = () => setSheet(null);
  const waitingQs = (ws.questions || []).some((q) => q.status === "waiting" || !q.status);

  const banner = (
    <div className="post-preview-banner ws-banner" role="note">
      <b>PREVIEW</b> · private{doc.held ? <> · <b>held</b>{doc.hold ? `: ${doc.hold}` : ""}</> : null}
      {ws.guest && <div className="pe-banner"><span>✍️ {ws.guest.byline || "A guest"}'s piece: his words stay his. Fix typos by hand; add images and clips with “+”.</span></div>}
      {stage === "drafted" && (
        <div className="pe-banner">
          <span>{editOn ? "✏️ Tap text to edit · “+” to add · ✎ on images" : "Editing is off."}</span>
          <button type="button" className="pe-btn pe-btn--small" onClick={() => { setEditOn(!editOn); setActive(null); }}>
            {editOn ? "Turn off" : "Turn on"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="ws">
      <TopBar ws={ws} version={doc.version} onPublish={() => setSheet({ kind: "publish" })} onMenu={() => setSheet({ kind: "menu" })} />
      <div className="ws-top">
        <Feed ws={ws} />
        {stage === "planning" && <PlanningCard ws={ws} />}
        {(stage === "outline" || stage === "writing") && (
          <>
            {stage === "writing" && <section className="ws-card ws-hero-card"><h2 className="ws-h">Writing the draft…</h2><p className="ws-muted">The fact check runs before it shows up here. Usually a few minutes.</p></section>}
            <QuestionsPanel ws={ws} act={act} />
            <OutlinePanel ws={ws} act={act} readOnly={stage === "writing"} />
          </>
        )}
        {stage === "skipped" && <section className="ws-card"><h2 className="ws-h">Skipped</h2><p className="ws-muted">This draft was skipped. Start a new one from the bot.</p></section>}
      </div>
      {workspaceDraft && (
        <PostArticle
          post={{ ...doc.meta, draft: true }} body={doc.body} banner={banner} edit={edit}
          onHero={stage === "drafted" ? () => setSheet({ kind: "hero" }) : undefined}
          before={
            <div className="ws-before">
              <LiveCard ws={ws} />
              {waitingQs && <QuestionsPanel ws={ws} act={act} />}
              <FactsNudge ws={ws} onOpen={() => setSheet({ kind: "facts" })} />
              {stage === "drafted" && <ImageTray ws={ws} act={act} onMore={(iid) => setSheet({ kind: "image", iid })} />}
              {stage === "drafted" && !doc.meta.hero && (
                <button type="button" className="ws-card ws-nudge" onClick={() => setSheet({ kind: "hero" })}>🖼 No hero image yet. <span className="ws-link">Add one</span></button>
              )}
            </div>
          }
        />
      )}
      {sheet?.kind === "image" && sheetImage && <ImageSheet it={sheetImage} act={act} upload={upload} onClose={close} />}
      {sheet?.kind === "image" && !sheetImage && (
        <ImageSheet it={{ id: sheet.iid, what: "This image" }} act={act} upload={upload} onClose={close} />
      )}
      {sheet?.kind === "hero" && <HeroSheet ws={ws} act={act} upload={upload} onClose={close} />}
      {sheet?.kind === "add" && <AddSheet anchor={sheet.anchor} ws={ws} act={act} upload={upload} onClose={close} />}
      {sheet?.kind === "publish" && <PublishSheet ws={ws} act={act} onClose={close} startWith={sheet.schedule ? "schedule" : "now"} />}
      {sheet?.kind === "menu" && <MenuSheet ws={ws} act={act} onClose={close} onFacts={() => setSheet({ kind: "facts" })} onHero={() => setSheet({ kind: "hero" })}
        onSchedule={() => setSheet({ kind: "publish", schedule: true })} />}
      {sheet?.kind === "facts" && <FactsSheet ws={ws} act={act} onClose={close} />}
      {sheet?.kind === "section" && <SectionSheet anchor={sheet.anchor} act={act} onClose={close} />}
      {toast}
    </div>
  );
}
