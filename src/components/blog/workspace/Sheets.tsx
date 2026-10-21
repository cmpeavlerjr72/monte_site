// The draft workspace's sheets: image options, hero options, "add something here", publish, the ⋯ menu.

import { useEffect, useState } from "react";
import { TableEditor } from "./TableEditor";
import type { Act, Anchor, Upload, Ws, WsImage } from "./types";
import { FactsPanel } from "./Panels";
import { NoteBox, PhotoPick, Sheet, fmtTime } from "./ui";

export function ImageSheet({ it, act, upload, onClose }: { it: WsImage; act: Act; upload: Upload; onClose: () => void }) {
  const [alt, setAlt] = useState(it.alt || "");
  const [cap, setCap] = useState(it.caption || "");
  const [mode, setMode] = useState<"" | "replace">("");
  const go = async (type: string, args: Record<string, unknown>, label: string) => {
    const r = await act(type, { iid: it.id, ...args }, label);
    if (r.ok) onClose();
    return r.ok;
  };
  const photoLike = !it.graphic;
  return (
    <Sheet title={it.graphic ? "Graphic options" : "Image options"} onClose={onClose}>
      <p className="ws-small ws-muted">{it.what}{it.section_title ? ` · ${it.section_title}` : ""}{it.status === "proposed" ? " · proposed" : ""}</p>
      {it.status === "proposed" && (
        <div className="ws-row">
          <button type="button" className="pe-btn pe-btn--primary" onClick={() => go("image_use", {}, "Adding that image")}>Use it</button>
          <button type="button" className="pe-btn" onClick={() => go("image_swap", {}, "Finding another")}>Swap</button>
        </div>
      )}
      {it.graphic ? (
        <NoteBox label="Request a change" placeholder="e.g. make Smith silver, add the opponent logos, flip it to a bar chart" button="Send to the graphics desk"
          onSend={(t) => go("image_change", { request: t }, "Re-making the graphic")} autoFocus />
      ) : (
        <NoteBox label="Find a different one" placeholder="Words to search, or paste a Getty / X / YouTube link or Getty embed code" button="Find it" rows={2}
          onSend={(t) => go("image_note", { note: t }, "Finding a different one")} />
      )}
      {mode === "replace" ? (
        <PhotoPick button="Replace with this photo" askOwn withAlt
          onPick={async (file, o) => {
            try {
              const id = await upload(file);
              return await go("image_note", { note: "", upload: id, own: o.own, credit: o.credit, alt: o.alt }, "Swapping in your photo");
            } catch (e) {
              window.alert((e as Error).message);
              return false;
            }
          }} />
      ) : (
        <div className="ws-row"><button type="button" className="pe-btn" onClick={() => setMode("replace")}>Replace with my photo</button></div>
      )}
      <div className="ws-row">
        <button type="button" className="pe-btn" onClick={() => go("image_move", { dir: "up" }, "Moving it up")}>↑ Move up</button>
        <button type="button" className="pe-btn" onClick={() => go("image_move", { dir: "down" }, "Moving it down")}>↓ Move down</button>
        {it.can_hero && <button type="button" className="pe-btn" onClick={() => go("image_hero", {}, "Making it the hero")}>Make it the hero</button>}
      </div>
      {photoLike || it.graphic ? (
        <div className="ws-fields">
          <label className="ws-label" htmlFor="ws-alt">Alt text</label>
          <div className="ws-inline">
            <input id="ws-alt" className="ws-input" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="What it shows" />
            <button type="button" className="pe-btn" disabled={alt === (it.alt || "")} onClick={() => go("image_alt", { alt }, "Saving the alt text")}>Save</button>
          </div>
          <label className="ws-label" htmlFor="ws-cap">Caption</label>
          <div className="ws-inline">
            <input id="ws-cap" className="ws-input" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Caption under it" />
            <button type="button" className="pe-btn" disabled={cap === (it.caption || "")} onClick={() => go("image_caption", { caption: cap }, "Saving the caption")}>Save</button>
          </div>
        </div>
      ) : null}
      {it.page && <p className="ws-small"><a href={it.page} target="_blank" rel="noopener noreferrer">Open the source ↗</a></p>}
      <div className="ws-row ws-row--end">
        <button type="button" className="pe-btn pe-btn--danger" onClick={() => { if (window.confirm("Remove this image?")) go("image_drop", {}, "Removing it"); }}>Remove</button>
      </div>
    </Sheet>
  );
}

export function HeroSheet({ ws, act, upload, onClose }: { ws: Ws; act: Act; upload: Upload; onClose: () => void }) {
  const h = ws.hero;
  const [alt, setAlt] = useState(h?.alt || "");
  const go = async (type: string, args: Record<string, unknown>, label: string) => {
    const r = await act(type, args, label);
    if (r.ok) onClose();
    return r.ok;
  };
  return (
    <Sheet title={h ? "Hero options" : "Add a hero"} onClose={onClose}>
      {h?.credit && <p className="ws-small ws-muted">Credit: {h.credit}</p>}
      {h?.graphic && (
        <NoteBox label="Request a change" placeholder="What should change on the hero graphic?" button="Send to the graphics desk"
          onSend={(t) => go("hero_change", { request: t }, "Re-making the hero")} />
      )}
      <h3 className="ws-sub">{h ? "Replace it with a photo" : "Upload a photo"}</h3>
      <p className="ws-small ws-muted">Cropped to 16:9 for the top of the post and 1200×630 for the share card. Tip: a side-by-side of two players works great.</p>
      <PhotoPick button={h ? "Use as the hero" : "Make it the hero"} askOwn withAlt
        onPick={async (file, o) => {
          try {
            const id = await upload(file);
            return await go("hero_set", { upload: id, alt: o.alt, own: o.own, ...(o.own ? {} : { credit: o.credit }) }, "Setting the hero");
          } catch (e) {
            window.alert((e as Error).message);
            return false;
          }
        }} />
      {h && (
        <div className="ws-fields">
          <label className="ws-label" htmlFor="ws-halt">Alt text</label>
          <div className="ws-inline">
            <input id="ws-halt" className="ws-input" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="What the hero shows" />
            <button type="button" className="pe-btn" disabled={alt === (h.alt || "")} onClick={() => go("hero_alt", { alt }, "Saving the alt text")}>Save</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

type AddMode = "" | "upload" | "link" | "graphic" | "commons" | "table";

/** "+" -> Table: build it, then it goes in after the block he tapped "+" under. */
function TableAdd({ go }: { go: (type: string, args: Record<string, unknown>, label: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return <TableEditor button="Add the table" busy={busy}
    onSave={async (md) => { setBusy(true); const ok = await go("table_add", { md }, "Adding the table"); if (!ok) setBusy(false); }} />;
}

export function AddSheet({ anchor, ws, act, upload, onClose }: { anchor: Anchor; ws: Ws; act: Act; upload: Upload; onClose: () => void }) {
  const [mode, setMode] = useState<AddMode>("");
  const after = { text: anchor.text, nth: anchor.nth };
  const go = async (type: string, args: Record<string, unknown>, label: string) => {
    const r = await act(type, { after, ...args }, label);
    if (r.ok) onClose();
    return r.ok;
  };
  const snippet = anchor.text.replace(/^#+\s*/, "").replace(/\s+/g, " ").slice(0, 90);
  const editorial = (ws.getty_browse || []).length > 0 || ["preview", "storyline", "betting", "recap", "roundup"].includes(ws.type || "");
  return (
    <Sheet title="Add here" onClose={onClose}>
      <p className="ws-small ws-muted">After: “{snippet}{anchor.text.length > 90 ? "…" : ""}”</p>
      {!mode && (
        <div className="ws-menu">
          <button type="button" className="ws-menu__item" onClick={() => setMode("upload")}>📷 Upload a photo</button>
          <button type="button" className="ws-menu__item" onClick={() => setMode("link")}>🔗 Paste a link (Getty, X, YouTube)</button>
          <button type="button" className="ws-menu__item" onClick={() => setMode("table")}>📋 Table</button>
          <button type="button" className="ws-menu__item" onClick={() => setMode("graphic")}>📊 Request a chart or graphic</button>
          <button type="button" className="ws-menu__item" onClick={() => setMode("commons")}>🖼 Search Commons photos</button>
          {editorial && <button type="button" className="ws-menu__item" onClick={() => go("image_add", { source: "getty_search" }, "Looking on Getty")}>📸 Getty ideas for this spot</button>}
          <button type="button" className="ws-menu__item" onClick={() => go("image_add", { source: "chart" }, "Adding the margin chart")}>📈 Sim margin chart</button>
          <button type="button" className="ws-menu__item" onClick={() => go("image_add", { source: "stat_card" }, "Adding the stat card")}>🧾 Stat comparison card</button>
        </div>
      )}
      {mode === "upload" && (
        <PhotoPick button="Add it here" askOwn withAlt
          onPick={async (file, o) => {
            try {
              const id = await upload(file);
              return await go("image_add", { source: "upload", upload: id, own: o.own, ...(o.own ? {} : { credit: o.credit }), ...(o.alt ? { alt: o.alt } : {}) }, "Adding your photo");
            } catch (e) {
              window.alert((e as Error).message);
              return false;
            }
          }} />
      )}
      {mode === "link" && (
        <NoteBox label="Link" placeholder="https://www.gettyimages.com/detail/…, an x.com post, a YouTube link, or Getty's embed code" button="Add it here" rows={3} autoFocus
          onSend={(t) => go("image_add", { source: "link", url: t }, "Adding that")} />
      )}
      {mode === "graphic" && (
        <NoteBox label="What should it show?" placeholder="e.g. Legree vs Smith yards per game, bars in team colors with logos" button="Send to the graphics desk" rows={4} autoFocus
          onSend={(t) => go("graphic_new", { request: t }, "Making the graphic")} />
      )}
      {mode === "table" && <TableAdd go={go} />}
      {mode === "commons" && (
        <NoteBox label="Search Commons" placeholder="e.g. Reser Stadium" button="Search" rows={1} autoFocus
          onSend={(t) => go("image_add", { source: "commons", query: t }, "Searching Commons")} />
      )}
      {mode && <button type="button" className="ws-link" onClick={() => setMode("")}>← Other options</button>}
    </Sheet>
  );
}

/** ET wall time from a datetime-local value: sent as a naive "YYYY-MM-DDTHH:MM" (the PC runs on Eastern time). */
/** Today's date and the time right now in Eastern time, as the strings a date / time input uses. */
function etNow(): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** "2026-10-20" + "09:00" -> "Tue Oct 20, 9:00 AM ET" (no time-zone math: these ARE Eastern). */
function etLabel(date: string, time: string): string {
  if (!date || !time) return "";
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const [h, m] = time.split(":").map(Number);
  return `${day}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
}

/** Pick when it goes live: the bot's quick picks, or any day + time (Eastern). -> publish_prepare {when}. */
function SchedulePicker({ ws, act, busy }: { ws: Ws; act: Act; busy: boolean }) {
  const now = etNow();
  // Default: the next 9:00 AM Eastern (today before 9, else tomorrow) so it never opens on a time that's passed.
  const next9 = now.time < "09:00" ? now.date
    : new Date(Date.parse(`${now.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(next9);
  const [time, setTime] = useState("09:00");
  const past = !!date && !!time && `${date}T${time}` <= `${now.date}T${now.time}`;
  const quick = ws.publish?.quick || [];
  return (
    <div className="ws-sched">
      {quick.length > 0 && (
        <div className="ws-sched__quick">
          {quick.map((q) => (
            <button key={q.when} type="button" className="pe-btn" disabled={busy}
              onClick={() => act("publish_prepare", { when: q.when }, `Getting it ready for ${q.label}`)}>{q.label}</button>
          ))}
        </div>
      )}
      <p className="ws-label">Or pick a day and time (Eastern)</p>
      <div className="ws-sched__pick">
        <input className="ws-input" type="date" aria-label="Day" value={date} min={now.date} onChange={(e) => setDate(e.target.value)} />
        <input className="ws-input" type="time" aria-label="Time (Eastern)" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
      </div>
      <p className={past ? "ws-small ws-flag" : "ws-small"}>{past ? "That time has already passed." : <>Goes live <b>{etLabel(date, time)}</b>, and posts to X then.</>}</p>
      <button type="button" className="pe-btn pe-btn--primary ws-big" disabled={busy || past || !date || !time}
        onClick={() => act("publish_prepare", { when: `${date}T${time}` }, `Getting it ready for ${etLabel(date, time)}`)}>🗓 Check &amp; schedule</button>
    </div>
  );
}

export function PublishSheet({ ws, act: send, onClose, startWith = "now" }: { ws: Ws; act: Act; onClose: () => void; startWith?: "now" | "schedule" }) {
  const p = ws.publish || {};
  const [mode, setMode] = useState<"now" | "schedule">(startWith);
  const [repick, setRepick] = useState(false);
  // What it's doing right now, shown IN the sheet (the checks take ~30 s): set on a tap, cleared when the bot's answer
  // changes the publish state (or the send fails).
  const [doing, setDoing] = useState<string | null>(null);
  const stateKey = [p.pending?.when ?? (p.pending ? "now" : ""), (p.blocks || []).join("|"), p.scheduled_at || "", p.live_url || ""].join("#");
  useEffect(() => { setDoing(null); setRepick(false); }, [stateKey]);
  const act: Act = async (type, args = {}, label = "Sending") => {
    const when = (args as { when?: string }).when;
    setDoing(type === "publish_prepare" ? `Running the checks${when ? ` for ${label.replace(/^Getting it ready( for )?/, "") || "that time"}` : ""}… about 30 seconds. Then you confirm here.`
      : type === "publish_confirm" ? (p.pending?.when ? "Scheduling it…" : "Publishing… live in 5–10 minutes. You'll get a Telegram ping when it's up.")
      : type === "schedule_cancel" ? "Cancelling the schedule…" : type === "publish_cancel" ? "Cancelling…" : `${label}…`);
    const r = await send(type, args, label);
    if (!r.ok) setDoing(null);
    return r;
  };
  const busy = !!ws.busy || !!doing;
  const tabs = (
    <div className="ws-tabs" role="tablist" aria-label="When">
      <button type="button" role="tab" aria-selected={mode === "now"} className={mode === "now" ? "ws-tab ws-tab--on" : "ws-tab"} onClick={() => setMode("now")}>Publish now</button>
      <button type="button" role="tab" aria-selected={mode === "schedule"} className={mode === "schedule" ? "ws-tab ws-tab--on" : "ws-tab"} onClick={() => setMode("schedule")}>🗓 Schedule</button>
    </div>
  );
  return (
    <Sheet title={p.live_url ? "Live" : p.scheduled_at ? "Scheduled" : "Publish or schedule"} onClose={onClose}>
      {doing && <p className="ws-progress" role="status" aria-live="polite"><span className="ws-spin" aria-hidden="true" />{doing}</p>}
      {p.live_url ? (
        <p>✅ Live: <a href={p.live_url} target="_blank" rel="noopener noreferrer">{p.live_url}</a></p>
      ) : p.scheduled_at && !p.pending ? (
        <>
          <p className="ws-ok">✅ Scheduled. It goes live <b>{p.scheduled_label || `${fmtTime(p.scheduled_at)} ET`}</b> and posts to X then, by itself; you don't need the page open.</p>
          <div className="ws-row">
            <button type="button" className="pe-btn" onClick={() => setRepick(!repick)}>Change the time</button>
            <button type="button" className="pe-btn pe-btn--danger" onClick={() => act("schedule_cancel", {}, "Cancelling the schedule")}>Cancel the schedule</button>
          </div>
          {repick && <SchedulePicker ws={ws} act={act} busy={busy} />}
        </>
      ) : p.pending ? (
        <>
          <p><b>{p.pending.when ? `🗓 Goes live ${p.pending.when_label || `${fmtTime(p.pending.when)} ET`}` : "Goes live now"}</b>{p.pending.when ? "" : " (5–10 min after the deploy)"}</p>
          {p.pending.url && <p className="ws-small ws-break">{p.pending.url}</p>}
          {p.pending.x_text && (
            <>
              <h3 className="ws-sub">{p.pending.when ? "Posts to X at the same time" : "Also posts to X"}</h3>
              <blockquote className="ws-x">{p.pending.x_text}</blockquote>
            </>
          )}
          {(p.pending.warns || []).map((w) => <p key={w} className="ws-flag">⚠️ {w}</p>)}
          <div className="ws-row ws-row--big">
            <button type="button" className="pe-btn pe-btn--primary ws-big" disabled={busy} onClick={() => act("publish_confirm", {}, p.pending?.when ? "Scheduling it" : "Publishing")}>
              ✅ {p.pending.when ? "Schedule it" : "Publish now"}
            </button>
            <button type="button" className="pe-btn" onClick={() => act("publish_cancel", {}, "Cancelled")}>Cancel</button>
          </div>
          <p className="ws-small ws-muted">One tap does both. No second approval.</p>
          <button type="button" className="ws-link" onClick={() => setRepick(!repick)}>{p.pending.when ? "Pick a different time" : "🗓 Schedule it for later instead"}</button>
          {repick && <SchedulePicker ws={ws} act={act} busy={busy} />}
        </>
      ) : (
        <>
          {!!p.blocks?.length && (
            <>
              <h3 className="ws-sub">🚫 Can't publish yet</h3>
              <ul className="ws-list">{p.blocks.map((b) => <li key={b}>{b}</li>)}</ul>
              <div className="ws-row">
                {p.blocks.some((b) => /✗|fact/i.test(b)) && <>
                  <button type="button" className="pe-btn" onClick={() => act("facts_fix", {}, "Fixing the ✗ facts")}>Fix them for me</button>
                  <button type="button" className="pe-btn" onClick={() => act("facts_keep", {}, "Keeping them")}>They're right</button>
                </>}
                {p.no_hero_ok && <button type="button" className="pe-btn" onClick={() => act("publish_prepare", { no_hero: true }, "Checking it again")}>Publish without a hero</button>}
              </div>
            </>
          )}
          {tabs}
          {mode === "now" ? (
            <>
              <p className="ws-small ws-muted">I'll run the checks and show you exactly what goes live and what posts to X before anything happens.</p>
              <button type="button" className="pe-btn pe-btn--primary ws-big" disabled={busy} onClick={() => act("publish_prepare", {}, "Getting it ready")}>Check &amp; publish now…</button>
            </>
          ) : (
            <>
              <p className="ws-small ws-muted">Pick when it goes live. I'll run the checks and show you what goes live and what posts to X; it then publishes by itself at that time.</p>
              <SchedulePicker ws={ws} act={act} busy={busy} />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

export function MenuSheet({ ws, act, onFacts, onHero, onSchedule, onClose }: { ws: Ws; act: Act; onFacts: () => void; onHero: () => void; onSchedule?: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<"" | "all">("");
  const drafted = ws.stage === "drafted";
  const ai = drafted && !ws.guest;            // a guest writer's words are never rewritten (owner 2026-10-20)
  const go = async (type: string, args: Record<string, unknown>, label: string) => {
    const r = await act(type, args, label);
    if (r.ok) onClose();
    return r.ok;
  };
  return (
    <Sheet title="Draft" onClose={onClose}>
      {mode === "all" ? (
        <>
          <NoteBox label="Rewrite everything with a note" placeholder="e.g. tighter, more about the defense, less sims talk" button="Rewrite all" rows={4} autoFocus
            onSend={(t) => go("rewrite_all", { note: t }, "Rewriting the draft")} />
          <button type="button" className="ws-link" onClick={() => setMode("")}>← Back</button>
        </>
      ) : (
        <div className="ws-menu">
          {ai && <button type="button" className="ws-menu__item" onClick={() => setMode("all")}>✍️ Rewrite all with a note</button>}
          {ai && <button type="button" className="ws-menu__item" onClick={() => go("tone_down", {}, "Toning it down")}>🔉 Tone it down</button>}
          {ai && <button type="button" className="ws-menu__item" onClick={() => go("stool", {}, "Turning it up")}>🔊 Turn it up (Barstool pass)</button>}
          {drafted && <button type="button" className="ws-menu__item" disabled={ws.can_undo === false} onClick={() => go("undo_last", {}, "Undoing the last change")}>↩️ Undo last change</button>}
          {drafted && onSchedule && <button type="button" className="ws-menu__item" onClick={() => { onClose(); onSchedule(); }}>🗓 Schedule it{ws.publish?.scheduled_label ? ` · ${ws.publish.scheduled_label}` : ""}</button>}
          {drafted && <button type="button" className="ws-menu__item" onClick={() => { onClose(); onHero(); }}>🖼 Hero image</button>}
          {drafted && <button type="button" className="ws-menu__item" onClick={() => { onClose(); onFacts(); }}>🔎 Facts{ws.facts?.summary ? ` · ${ws.facts.summary}` : ""}</button>}
          <button type="button" className="ws-menu__item" onClick={() => go("refresh", {}, "Refreshing")}>🔄 Refresh the page from the bot</button>
          {ws.stage !== "published" && ws.stage !== "skipped" && (
            <button type="button" className="ws-menu__item ws-menu__item--danger" onClick={() => { if (window.confirm("Skip this draft? It won't be published.")) go("draft_skip", {}, "Skipping the draft"); }}>✖ Skip this draft</button>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function FactsSheet({ ws, act, onClose }: { ws: Ws; act: Act; onClose: () => void }) {
  return <Sheet title="Facts" onClose={onClose}><FactsPanel ws={ws} act={act} /></Sheet>;
}

/** "Rewrite this section with a note", from a paragraph's editor. */
export function SectionSheet({ anchor, act, onClose }: { anchor: Anchor; act: Act; onClose: () => void }) {
  return (
    <Sheet title="Rewrite this section" onClose={onClose}>
      <NoteBox label="What should change?" placeholder="e.g. less about the schedule, add the target-share number" button="Rewrite the section" rows={4} autoFocus
        onSend={async (t) => { const r = await act("section_rewrite", { after: anchor, note: t }, "Rewriting the section"); if (r.ok) onClose(); return r.ok; }} />
    </Sheet>
  );
}
