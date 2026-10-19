// The draft workspace's panels: the sticky bar, the activity feed, outline, questions, image ideas, facts.

import { useEffect, useState } from "react";
import type { Act, Ws, WsImage } from "./types";
import { NoteBox, elapsed, fmtTime } from "./ui";

const STAGE_LABEL: Record<string, string> = {
  planning: "Researching", outline: "Outline", writing: "Writing", drafted: "Draft", published: "Live", skipped: "Skipped",
};

export function TopBar({ ws, version, onPublish, onMenu }: { ws: Ws; version: number | null; onPublish: () => void; onMenu: () => void }) {
  const [, tick] = useState(0);
  const busy = ws.busy;
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  const stage = ws.stage || "planning";
  const pub = ws.publish || {};
  return (
    <div className="ws-bar" role="toolbar" aria-label="Draft workspace">
      <span className={`ws-chip ws-chip--${stage}`}>{STAGE_LABEL[stage] || stage}{version != null && stage !== "planning" && stage !== "outline" ? ` · v${version}` : ""}</span>
      <span className="ws-bar__busy" aria-live="polite">
        {busy ? <><span className="ws-spin" aria-hidden="true" />{busy.label || busy.what || "Working"}… {elapsed(busy.since)}</>
          : pub.scheduled_at ? <>🗓 {pub.scheduled_label || fmtTime(pub.scheduled_at)}</> : null}
      </span>
      {stage === "drafted" && (
        <button type="button" className="pe-btn pe-btn--primary ws-bar__pub" onClick={onPublish}>{pub.scheduled_at ? "Scheduled" : "Publish"}</button>
      )}
      <button type="button" className="pe-btn ws-bar__menu" aria-label="More" onClick={onMenu}>⋯</button>
    </div>
  );
}

export function Feed({ ws }: { ws: Ws }) {
  const [open, setOpen] = useState(false);
  const items = [...(ws.feed || [])].reverse();
  if (!items.length) return null;
  const shown = open ? items : items.slice(0, 1);
  return (
    <section className="ws-card ws-feed" aria-label="What the bot did">
      <ul>
        {shown.map((f, i) => (
          <li key={`${f.at}-${i}`} className={`ws-feed__item ws-feed__item--${f.level || "info"}`}>
            <span className="ws-feed__text">{f.text}</span>
            {f.at && <time className="ws-feed__at">{fmtTime(f.at)}</time>}
          </li>
        ))}
      </ul>
      {items.length > 1 && (
        <button type="button" className="ws-link" onClick={() => setOpen(!open)}>{open ? "Show less" : `Show all activity (${items.length})`}</button>
      )}
    </section>
  );
}

export function PlanningCard({ ws }: { ws: Ws }) {
  return (
    <section className="ws-card ws-hero-card">
      <div className="kicker">New draft</div>
      <h2 className="ws-h">Researching…</h2>
      {ws.request && <p className="ws-quote">“{ws.request}”</p>}
      {ws.reading_as && <p className="ws-muted">{ws.reading_as}</p>}
      <p className="ws-muted">The outline shows up right here in a few minutes. You can leave this page open; it updates by itself.</p>
    </section>
  );
}

export function OutlinePanel({ ws, act, readOnly }: { ws: Ws; act: Act; readOnly: boolean }) {
  const o = ws.outline;
  const [takeOpen, setTakeOpen] = useState(false);
  if (!o) return null;
  return (
    <section className="ws-card" aria-label="Outline">
      <div className="kicker">Outline</div>
      {ws.reading_as && <p className="ws-muted ws-small">{ws.reading_as}</p>}
      <h2 className="ws-h">{o.headline}</h2>
      {o.description && <p className="ws-desc">{o.description}</p>}
      {(o.extra || []).map((x) => <p key={x} className="ws-extra">{x}</p>)}
      {(o.flags || []).map((x) => <p key={x} className="ws-flag">🚫 {x}</p>)}
      {o.lede && <p><b>Opening:</b> {o.lede}</p>}
      {!!o.sections?.length && (
        <ol className="ws-secs">
          {o.sections.map((s) => <li key={s.key}><b>{s.title}</b>{s.line ? `: ${s.line}` : ""}</li>)}
        </ol>
      )}
      {!!o.key_numbers?.length && (
        <details className="ws-details">
          <summary>Key numbers ({o.key_numbers.length})</summary>
          <ul>{o.key_numbers.map((k) => <li key={k}>{k}</li>)}</ul>
        </details>
      )}
      {!readOnly && (
        <>
          {!!ws.types?.length && (
            <div className="ws-types" role="group" aria-label="Article type">
              {ws.types.map((t) => (
                <button key={t.id} type="button" className={t.id === ws.type ? "ws-type ws-type--on" : "ws-type"} aria-pressed={t.id === ws.type}
                  onClick={() => { if (t.id !== ws.type) act("outline_type", { type: t.id }, `Switching to ${t.label}`); }}>{t.label}</button>
              ))}
            </div>
          )}
          <div className="ws-take">
            <span><b>Your take:</b> {ws.take || <span className="ws-muted">none (played straight)</span>}</span>
            <button type="button" className="ws-link" onClick={() => setTakeOpen(!takeOpen)}>{takeOpen ? "Cancel" : ws.take ? "Change" : "Add one"}</button>
          </div>
          {takeOpen && (
            <NoteBox placeholder="What do you think? The article argues it." button="Save my take" initial={ws.take || ""} allowEmpty
              onSend={async (t) => { const r = await act("outline_take", { take: t }, "Updating your take"); if (r.ok) setTakeOpen(false); return r.ok; }} />
          )}
          <NoteBox label="Change the outline" placeholder="e.g. lead with the defense, drop the injury section" button="Redo the outline"
            onSend={async (t) => (await act("outline_redo", { note: t }, "Redoing the outline")).ok} />
          <div className="ws-row ws-row--big">
            <button type="button" className="pe-btn pe-btn--primary ws-big" onClick={() => act("outline_write", {}, "Writing the draft")}>✍️ Write it</button>
            <button type="button" className="pe-btn" onClick={() => act("outline_redo", { note: "" }, "Redoing the outline")}>Redo</button>
            <button type="button" className="pe-btn pe-btn--danger" onClick={() => { if (window.confirm("Skip this draft?")) act("draft_skip", {}, "Skipping the draft"); }}>Skip</button>
          </div>
        </>
      )}
    </section>
  );
}

export function QuestionsPanel({ ws, act }: { ws: Ws; act: Act }) {
  const qs = ws.questions || [];
  const [editing, setEditing] = useState<string | null>(null);
  if (!qs.length) return null;
  const waiting = qs.filter((q) => q.status === "waiting" || !q.status).length;
  return (
    <section className="ws-card" aria-label="Your lines">
      <div className="kicker">Your lines{waiting ? ` · ${waiting} waiting` : ""}</div>
      <p className="ws-muted ws-small">Your answer shapes that part of the article; specifics you give stay as you said them. Skip and that part makes no personal claim.</p>
      {qs.map((q) => {
        const open = (q.status === "waiting" || !q.status) || editing === q.id;
        return (
          <div key={q.id} className="ws-q">
            <p className="ws-q__ask"><b>{q.ask}</b>{q.section ? <span className="ws-muted"> · {q.section}</span> : null}</p>
            {open ? (
              <>
                <NoteBox placeholder="Your answer" button="Save" initial={q.answer || ""}
                  onSend={async (t) => { const r = await act("answer", { qid: q.id, text: t }, "Saving your answer"); if (r.ok) setEditing(null); return r.ok; }} />
                <button type="button" className="ws-link" onClick={() => { act("answer", { qid: q.id, text: "" }, "Skipping that question"); setEditing(null); }}>Skip this one</button>
              </>
            ) : (
              <p className="ws-q__ans">
                {q.status === "skipped" ? <span className="ws-muted">Skipped</span> : <>“{q.answer}”</>}
                {" "}<button type="button" className="ws-link" onClick={() => setEditing(q.id)}>Change</button>
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

const KIND: Record<string, string> = {
  commons: "Commons photo", getty: "Getty photo", x: "X post", youtube: "YouTube", card: "our card", chart: "chart",
  own: "your photo", upload: "photo you sent", graphic: "our graphic", raw: "image",
};

export function ImageTray({ ws, act, onMore }: { ws: Ws; act: Act; onMore: (iid: string) => void }) {
  const ideas = (ws.images || []).filter((i) => !i.in_body && i.status !== "approved");
  const stuck = (ws.images || []).filter((i) => !i.in_body && i.status === "approved");
  const browse = ws.getty_browse || [];
  if (!ideas.length && !stuck.length && !browse.length) return null;
  return (
    <section className="ws-card" aria-label="Image ideas">
      <div className="kicker">{ideas.length ? `${ideas.length} image idea${ideas.length === 1 ? "" : "s"} waiting` : "Images"}</div>
      <div className="ws-tray">
        {ideas.map((it) => <IdeaCard key={it.id} it={it} act={act} onMore={onMore} />)}
        {stuck.map((it) => (
          <div key={it.id} className="ws-idea">
            <p className="ws-small"><b>{it.what || KIND[it.kind || ""] || "Image"}</b> is approved but isn't showing{it.needs_embed ? " (Getty hasn't given its embed yet)" : ""}.</p>
            <div className="ws-row"><button type="button" className="pe-btn" onClick={() => onMore(it.id)}>Options</button></div>
          </div>
        ))}
      </div>
      {!!browse.length && (
        <p className="ws-small">📸 Browse the game's own photos, then paste a link with “+” in the article:{" "}
          {browse.map((b, i) => <span key={b.url}>{i ? " · " : ""}<a href={b.url} target="_blank" rel="noopener noreferrer">{b.label}</a></span>)}
        </p>
      )}
    </section>
  );
}

function IdeaCard({ it, act, onMore }: { it: WsImage; act: Act; onMore: (iid: string) => void }) {
  const [note, setNote] = useState(false);
  return (
    <div className="ws-idea">
      {it.thumb ? <img className="ws-idea__thumb" src={it.thumb} alt={it.alt || it.what || ""} loading="lazy" />
        : <div className="ws-idea__thumb ws-idea__thumb--none">{it.kind === "getty" ? "Getty photo" : KIND[it.kind || ""] || "Image"}</div>}
      <div className="ws-idea__meta">
        <p className="ws-small"><b>{it.what || KIND[it.kind || ""]}</b></p>
        <p className="ws-small ws-muted">{KIND[it.kind || ""] || it.kind}{it.section_title ? ` · ${it.section_title}` : ""}</p>
        {it.why && <p className="ws-small ws-muted">{it.why}</p>}
        {it.page && <a className="ws-small" href={it.page} target="_blank" rel="noopener noreferrer">{it.kind === "getty" ? "Open on Getty" : "Source"} ↗</a>}
      </div>
      <div className="ws-row">
        <button type="button" className="pe-btn pe-btn--primary" onClick={() => act("image_use", { iid: it.id }, "Adding that image")}>Use</button>
        <button type="button" className="pe-btn" onClick={() => act("image_swap", { iid: it.id }, "Finding another")}>Swap</button>
        <button type="button" className="pe-btn pe-btn--danger" onClick={() => act("image_drop", { iid: it.id }, "Dropping it")}>Drop</button>
        <button type="button" className="pe-btn" onClick={() => setNote(!note)}>Different…</button>
        {it.can_hero && <button type="button" className="pe-btn" onClick={() => act("image_hero", { iid: it.id }, "Making it the hero")}>Hero</button>}
        <button type="button" className="ws-link" onClick={() => onMore(it.id)}>More</button>
      </div>
      {note && (
        <NoteBox placeholder="Words to search (“Bryant-Denny at night”), or paste a Getty / X / YouTube link" button="Find it" rows={2}
          onSend={async (t) => { const r = await act("image_note", { iid: it.id, note: t }, "Finding a different one"); if (r.ok) setNote(false); return r.ok; }} />
      )}
    </div>
  );
}

export function FactsPanel({ ws, act }: { ws: Ws; act: Act }) {
  const f = ws.facts;
  if (!f) return <p className="ws-muted">No fact list for this draft yet.</p>;
  const bad = f.bad || [], inj = f.injuries || [];
  return (
    <div className="ws-facts">
      {f.summary && <p><b>{f.summary}</b></p>}
      {(f.notes || []).map((n) => <p key={n} className="ws-small">{n}</p>)}
      {!!bad.length && (
        <>
          <h3 className="ws-sub">Marked ✗ ({bad.length})</h3>
          <ul className="ws-list">
            {bad.map((b) => <li key={b.id}><span className="ws-muted">{b.section ? `${b.section}: ` : ""}</span>{b.claim}{b.fix ? <> → <i>{b.fix}</i></> : null}</li>)}
          </ul>
          <div className="ws-row">
            <button type="button" className="pe-btn pe-btn--primary" onClick={() => act("facts_fix", {}, "Fixing the ✗ facts")}>Fix them for me</button>
            <button type="button" className="pe-btn" onClick={() => act("facts_keep", {}, "Keeping them")}>They're right, keep them</button>
          </div>
        </>
      )}
      {!!inj.length && (
        <>
          <h3 className="ws-sub">Injury claims our data can't confirm ({inj.length})</h3>
          {inj.map((e) => (
            <div key={e.id} className="ws-inj">
              <p className="ws-small"><span className="ws-muted">{e.section ? `${e.section}: ` : ""}</span>“{e.claim}”</p>
              <div className="ws-row">
                {e.url ? <a className="pe-btn" href={e.url} target="_blank" rel="noopener noreferrer">Source ↗</a> : <span className="ws-small ws-muted">No source link</span>}
                <button type="button" className="pe-btn" onClick={() => act("injury", { eid: e.id, verdict: "keep" }, "Keeping it")}>👍 Keep</button>
                <button type="button" className="pe-btn pe-btn--danger" onClick={() => act("injury", { eid: e.id, verdict: "cut" }, "Cutting it")}>👎 Cut</button>
              </div>
            </div>
          ))}
        </>
      )}
      {!bad.length && !inj.length && <p className="ws-muted ws-small">Nothing waiting on you here.</p>}
    </div>
  );
}

/** A one-line nudge on the draft when the facts or injuries need him. */
export function FactsNudge({ ws, onOpen }: { ws: Ws; onOpen: () => void }) {
  const f = ws.facts;
  const n = (f?.bad?.length || 0) + (f?.injuries?.length || 0);
  if (!f || !n) return null;
  return (
    <button type="button" className="ws-card ws-nudge" onClick={onOpen}>
      🔎 {f.bad?.length ? `${f.bad.length} fact${f.bad.length === 1 ? "" : "s"} marked ✗` : ""}{f.bad?.length && f.injuries?.length ? " · " : ""}
      {f.injuries?.length ? `${f.injuries.length} injury claim${f.injuries.length === 1 ? "" : "s"} to check` : ""} <span className="ws-link">Open</span>
    </button>
  );
}

export function LiveCard({ ws }: { ws: Ws }) {
  const url = ws.publish?.live_url;
  if (!url) return null;
  return (
    <section className="ws-card ws-live">✅ Live: <a href={url} target="_blank" rel="noopener noreferrer">{url}</a></section>
  );
}
