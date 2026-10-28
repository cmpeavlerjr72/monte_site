// The editor's AI helpers on a guest writer's post (owner 2026-10-21): "a button that I can click to use AI to go
// find/insert pictures or create a title from the article if he doesn't give one". His words are never touched: pictures
// land in the image tray as ideas to approve, and the headline is the owner's pick (or his own words).

import { useState } from "react";
import type { Act, Ws } from "./types";
import { Sheet } from "./ui";

/** The card on top of a guest draft: who wrote it, his note, and the two AI buttons. */
export function GuestTools({ ws, act, onHeadline }: { ws: Ws; act: Act; onHeadline: () => void }) {
  const g = ws.guest;
  const [busy, setBusy] = useState(false);
  if (!g) return null;
  const finding = ws.busy?.what === "gimages" || busy;
  return (
    <section className="ws-card" aria-label="Guest post tools">
      <div className="kicker">Guest post · {g.byline || "guest writer"}</div>
      {g.untitled && <p className="ws-small">⚠️ He didn't give it a title. Pick one under <b>Headline</b> (I put in the first idea).</p>}
      {g.note && <p className="ws-small">✉️ His note: {g.note}</p>}
      {!!g.asks?.length && (
        <div className="ws-small">
          <b>📌 He asked for {g.asks.length} thing{g.asks.length === 1 ? "" : "s"}</b> (the 📌 lines in the body show where). Add each, then delete its line; it can't publish with one still in.
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {g.asks.map((a, i) => <li key={i}>{a.ask === "link" ? "link" : a.ask}: {a.text}</li>)}
          </ul>
        </div>
      )}
      <div className="ws-row ws-row--wrap">
        <button type="button" className="pe-btn pe-btn--primary" disabled={finding}
          onClick={async () => { setBusy(true); await act("guest_images", {}, "Looking for pictures"); setBusy(false); }}>
          {finding ? "Looking for pictures…" : "🖼 Find pictures for me"}
        </button>
        <button type="button" className="pe-btn" onClick={onHeadline}>🏷 Headline{g.ideas?.headlines?.length ? " ideas" : ""}</button>
      </div>
      <p className="ws-small ws-muted">AI only suggests: pictures show up below as ideas to approve, and you pick the headline. His words stay his.</p>
    </section>
  );
}

/** Headline + summary: AI ideas to tap, or type your own. */
export function HeadlineSheet({ ws, act, onClose }: { ws: Ws; act: Act; onClose: () => void }) {
  const g = ws.guest || {};
  const [head, setHead] = useState(g.untitled ? "" : g.headline || "");
  const [sum, setSum] = useState(g.summary || "");
  const [busy, setBusy] = useState(false);
  const thinking = ws.busy?.what === "gtitle";
  const go = async (type: string, args: Record<string, unknown>, label: string, close = false) => {
    setBusy(true);
    const r = await act(type, args, label);
    setBusy(false);
    if (r.ok && close) onClose();
    return r.ok;
  };
  const ideas = g.ideas?.headlines || [];
  return (
    <Sheet title="Headline" onClose={onClose}>
      <p className="ws-small ws-muted">Now: <b>{g.headline || "(none)"}</b></p>
      <button type="button" className="pe-btn pe-btn--primary" disabled={busy || thinking}
        onClick={() => go("guest_title", {}, "Writing headline ideas")}>
        {thinking ? "Writing ideas…" : ideas.length ? "✨ New AI ideas" : "✨ Get AI headline ideas"}
      </button>
      {!!ideas.length && (
        <div className="ws-menu" style={{ marginTop: 10 }}>
          {ideas.map((h) => (
            <button key={h} type="button" className="ws-menu__item" disabled={busy}
              onClick={() => go("title_set", { headline: h }, "Saving the headline", true)}>{h}</button>
          ))}
        </div>
      )}
      {g.ideas?.summary && (
        <div className="ws-row ws-row--wrap" style={{ marginTop: 10 }}>
          <span className="ws-small">Summary idea: {g.ideas.summary}</span>
          <button type="button" className="pe-btn pe-btn--small" disabled={busy}
            onClick={() => go("title_set", { description: g.ideas!.summary }, "Saving the summary")}>Use it</button>
        </div>
      )}
      <label className="ws-label" htmlFor="ws-head" style={{ marginTop: 14 }}>Or write your own headline</label>
      <div className="ws-inline">
        <input id="ws-head" className="ws-input" value={head} maxLength={140} onChange={(e) => setHead(e.target.value)} placeholder="Headline" />
        <button type="button" className="pe-btn" disabled={busy || !head.trim() || head.trim() === g.headline}
          onClick={() => go("title_set", { headline: head }, "Saving the headline", true)}>Save</button>
      </div>
      <label className="ws-label" htmlFor="ws-sum">Summary (under the headline, and when it's shared)</label>
      <div className="ws-inline">
        <input id="ws-sum" className="ws-input" value={sum} maxLength={200} onChange={(e) => setSum(e.target.value)} placeholder="One line" />
        <button type="button" className="pe-btn" disabled={busy || !sum.trim() || sum.trim() === g.summary}
          onClick={() => go("title_set", { description: sum }, "Saving the summary")}>Save</button>
      </div>
      <p className="ws-small ws-muted">A new headline also changes the post's web address (it isn't live yet, so nothing breaks).</p>
    </Sheet>
  );
}
