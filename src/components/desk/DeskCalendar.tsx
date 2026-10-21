// The editor's posting calendar on /desk (owner 2026-10-21): "put a calendar to show anything that is scheduled or already
// posted". Scheduled = BlogBot drafts with a publish time (from the desk queue); posted = the live site's /blog/index.json,
// so hand-published and guest posts show too. Days are Eastern time, like the schedule itself.

import { useEffect, useMemo, useState } from "react";
import { Pill } from "../ui";

export type CalItem = { key: string; at: string; title: string; kind: "scheduled" | "posted"; href: string; author?: string; thumb?: string | null };

/** The hero, small (owner 2026-10-21: "a thumbnail version of the hero image for each"). An empty frame when there's none. */
export function Thumb({ src, size = "md" }: { src?: string | null; size?: "xs" | "md" }) {
  const [bad, setBad] = useState(false);
  return (
    <span className={`dthumb dthumb--${size}${!src || bad ? " dthumb--none" : ""}`} aria-hidden="true">
      {src && !bad ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} /> : size === "md" ? "No hero yet" : null}
    </span>
  );
}

const TZ = "America/New_York";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Live posts from the site's own index (every published article, whoever wrote it). */
export function usePosted(): CalItem[] {
  const [rows, setRows] = useState<CalItem[]>([]);
  useEffect(() => {
    let off = false;
    fetch("/blog/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: { slug: string; title: string; date: string; author?: string; thumb?: string | null; hero?: string | null }[]) => {
        if (off || !Array.isArray(j)) return;
        setRows(j.filter((p) => p.date && !Number.isNaN(new Date(p.date).getTime())).map((p) => ({
          key: `p:${p.slug}`, at: p.date, title: p.title, kind: "posted", href: `/blog/${p.slug}`, author: p.author,
          thumb: p.thumb || p.hero || null,
        })));
      })
      .catch(() => {});
    return () => { off = true; };
  }, []);
  return rows;
}

export function DeskCalendar({ items }: { items: CalItem[] }) {
  const todayKey = dayKey(new Date());
  const [ty, tm] = todayKey.split("-").map(Number);
  const [month, setMonth] = useState({ y: ty, m: tm });            // m is 1-12
  const [picked, setPicked] = useState(todayKey);

  const byDay = useMemo(() => {
    const out: Record<string, CalItem[]> = {};
    for (const it of items) (out[dayKey(new Date(it.at))] ||= []).push(it);
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.at.localeCompare(b.at));
    return out;
  }, [items]);

  const first = new Date(Date.UTC(month.y, month.m - 1, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= days; d++) cells.push(`${month.y}-${String(month.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const step = (n: number) => setMonth(({ y, m }) => { const t = m - 1 + n; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 + 1 }; });
  const label = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const list = byDay[picked] || [];
  const pickedLabel = new Date(`${picked}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  const upcoming = items.filter((i) => i.kind === "scheduled").sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="dcal">
      <div className="dcal__bar">
        <button type="button" className="ui-btn" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <strong className="dcal__month">{label}</strong>
        <button type="button" className="ui-btn" onClick={() => step(1)} aria-label="Next month">›</button>
        {(month.y !== ty || month.m !== tm) && (
          <button type="button" className="desk-link" onClick={() => { setMonth({ y: ty, m: tm }); setPicked(todayKey); }}>Today</button>
        )}
      </div>
      <div className="dcal__grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((w) => <div key={w} className="dcal__wd">{w}</div>)}
        {cells.map((k, i) => {
          if (!k) return <div key={`x${i}`} className="dcal__cell dcal__cell--empty" />;
          const its = byDay[k] || [];
          const cls = ["dcal__cell", k === todayKey && "is-today", k === picked && "is-picked", k < todayKey && "is-past"].filter(Boolean).join(" ");
          return (
            <button key={k} type="button" className={cls} onClick={() => setPicked(k)}
              aria-label={`${k}: ${its.length ? its.map((x) => `${x.kind} ${x.title}`).join("; ") : "nothing"}`}>
              <span className="dcal__num">{Number(k.slice(8))}</span>
              <span className="dcal__chips">
                {its.slice(0, 3).map((x) => (
                  <span key={x.key} className={`dcal__chip dcal__chip--${x.kind}`}><Thumb src={x.thumb} size="xs" /><span className="dcal__chiptxt">{x.title}</span></span>
                ))}
                {its.length > 3 && <span className="dcal__more">+{its.length - 3}</span>}
              </span>
              <span className="dcal__dots" aria-hidden="true">
                {its.slice(0, 4).map((x) => <i key={x.key} className={`dcal__dot dcal__dot--${x.kind}`} />)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="dcal__legend">
        <span><i className="dcal__dot dcal__dot--scheduled" /> Scheduled</span>
        <span><i className="dcal__dot dcal__dot--posted" /> Posted</span>
      </div>

      <h3 className="desk-h3">{k2(picked, todayKey, pickedLabel)}</h3>
      {list.length === 0 ? <p className="desk-muted desk-small">Nothing scheduled or posted that day.</p> : (
        <ul className="desk-list">{list.map((x) => <CalRow key={x.key} x={x} />)}</ul>
      )}
      {upcoming.length > 0 && (
        <>
          <h3 className="desk-h3">Coming up</h3>
          <ul className="desk-list">{upcoming.map((x) => <CalRow key={x.key} x={x} withDay />)}</ul>
        </>
      )}
    </div>
  );
}

const k2 = (picked: string, today: string, label: string) => (picked === today ? `Today · ${label}` : label);

function CalRow({ x, withDay }: { x: CalItem; withDay?: boolean }) {
  const day = new Date(x.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
  return (
    <li className="desk-row desk-row--thumb">
      <a href={x.href} tabIndex={-1}><Thumb src={x.thumb} /></a>
      <div className="desk-row__main">
        <a className="desk-row__title" href={x.href}>{x.title}</a>
        <div className="desk-row__meta">
          <Pill tone={x.kind === "scheduled" ? "gold" : "pos"}>{x.kind === "scheduled" ? "Scheduled" : "Posted"}</Pill>
          <span>{withDay ? `${day} · ` : ""}{timeOf(x.at)} ET{x.author && x.author !== "MVPeav" ? ` · by ${x.author}` : ""}</span>
        </div>
      </div>
      <a className="ui-btn desk-row__open" href={x.href}>{x.kind === "scheduled" ? "Open workspace" : "View post"}</a>
    </li>
  );
}
