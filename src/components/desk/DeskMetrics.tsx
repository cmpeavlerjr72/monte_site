// The editor's article metrics on /desk (owner 2026-10-21): "a metrics section on my drafts page so that I can see how
// different things are performing to try to guide the direction of future articles". Data: GET /api/desk/metrics
// (server/liveScores.ts), built from the site's own page_events. The fair comparison between posts is readers in the
// first 48 hours, so groups only count posts at least 48h old.

import { useEffect, useMemo, useState } from "react";
import { Pill, Stat } from "../ui";
import { deskFetch } from "../../lib/deskAccess";

type Post = {
  slug: string; title: string; date: string; author: string; type: string; slot: string; weekday: string; age_hours: number;
  views: number; readers: number; readers_48h: number; new_pct: number | null; read_tracked: number;
  half_pct: number | null; end_pct: number | null; onward_pct: number | null; sources: { source: string; readers: number }[];
};
type Group = { key: string; posts: number; avg_48h: number; median_48h: number; end_pct: number | null; best: string | null };
type Metrics = {
  days: number; generated: string; read_tracking_since: string; tracking_since: string;
  totals: { blog_readers_7d: number; blog_readers_prev_7d: number; posts: number; avg_48h: number | null };
  by_day: { day: string; readers: number }[]; by_type: Group[]; by_slot: Group[]; by_author: Group[];
  sources: { source: string; readers: number }[]; posts: Post[];
};

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((100 * value) / max)) : 0;
  return (
    <span className="dm-bar" title={label}>
      <span className="dm-bar__fill" style={{ width: `${w}%` }} />
    </span>
  );
}

function GroupTable({ title, rows, note }: { title: string; rows: Group[]; note?: string }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.avg_48h), 1);
  return (
    <section className="dm-sec">
      <h3 className="desk-h3">{title}</h3>
      <table className="dm-table">
        <thead><tr><th scope="col"></th><th scope="col">Avg readers, first 48h</th><th scope="col" className="dm-num">Posts</th><th scope="col" className="dm-num">Finish</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.key}{r.best && <span className="dm-sub">Best: {r.best}</span>}</th>
              <td><span className="dm-barcell"><Bar value={r.avg_48h} max={max} label={`${r.key}: ${r.avg_48h} avg, ${r.median_48h} median`} /><b>{r.avg_48h}</b></span></td>
              <td className="dm-num">{r.posts}</td>
              <td className="dm-num">{r.end_pct == null ? "–" : `${r.end_pct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="desk-small desk-muted">{note}</p>}
    </section>
  );
}

/** A few plain sentences from the numbers, only where there's enough to say something. */
function takeaways(m: Metrics): string[] {
  const out: string[] = [];
  const t = m.by_type.filter((g) => g.posts >= 2);
  if (t.length >= 2) out.push(`${t[0].key} posts draw the most readers in their first 48 hours (${t[0].avg_48h} on average across ${t[0].posts}); ${t[t.length - 1].key} the fewest (${t[t.length - 1].avg_48h}).`);
  const s = m.by_slot.filter((g) => g.posts >= 2);
  if (s.length >= 2) out.push(`${s[0].key} posts average ${s[0].avg_48h} readers in 48h, vs ${s[s.length - 1].avg_48h} for ${s[s.length - 1].key.toLowerCase()}.`);
  const src = m.sources.filter((x) => x.source !== "Inside the site");
  const tot = src.reduce((a, x) => a + x.readers, 0);
  if (src.length && tot >= 10) out.push(`${src[0].source} brings the most readers from outside the site (${Math.round((100 * src[0].readers) / tot)}% of them).`);
  const ends = m.posts.filter((p) => p.end_pct != null && p.read_tracked >= 10).sort((a, b) => (b.end_pct as number) - (a.end_pct as number));
  if (ends.length >= 3) out.push(`Most finished: "${ends[0].title}" (${ends[0].end_pct}% read to the end). Least: "${ends[ends.length - 1].title}" (${ends[ends.length - 1].end_pct}%).`);
  return out;
}

export function DeskMetrics() {
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<"new" | "r48" | "end">("new");
  useEffect(() => {
    let off = false;
    setErr(null);
    deskFetch<Metrics>(`/api/desk/metrics?days=${days}`).then((j) => { if (!off) setM(j); }).catch((e) => { if (!off) setErr(String(e.message || e)); });
    return () => { off = true; };
  }, [days]);

  const posts = useMemo(() => {
    if (!m) return [];
    const ps = m.posts.slice();
    if (sort === "r48") ps.sort((a, b) => b.readers_48h - a.readers_48h);
    if (sort === "end") ps.sort((a, b) => (b.end_pct ?? -1) - (a.end_pct ?? -1));
    return ps;
  }, [m, sort]);

  if (err) return <p className="desk-err">{err}</p>;
  if (!m) return <p className="desk-muted">Loading the numbers…</p>;
  const tr = m.totals;
  const delta = tr.blog_readers_prev_7d ? Math.round((100 * (tr.blog_readers_7d - tr.blog_readers_prev_7d)) / tr.blog_readers_prev_7d) : null;
  const finishes = m.posts.filter((p) => p.end_pct != null && p.read_tracked >= 5);
  const finishAvg = finishes.length ? Math.round(finishes.reduce((s, p) => s + (p.end_pct as number), 0) / finishes.length) : null;
  const maxDay = Math.max(...m.by_day.map((d) => d.readers), 1);
  const max48 = Math.max(...m.posts.map((p) => p.readers_48h), 1);
  const srcMax = Math.max(...m.sources.map((s) => s.readers), 1);
  const lines = takeaways(m);
  const trackingNew = Date.now() - Date.parse(m.read_tracking_since) < 3 * 86_400_000;

  return (
    <div className="dm">
      <div className="dm-controls">
        <label className="desk-field dm-range"><span>Range</span>
          <select className="ui-sel" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>

      <div className="dm-tiles">
        <Stat label="Blog readers, last 7 days" value={tr.blog_readers_7d.toLocaleString()}
          note={delta == null ? "first full week" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}% vs the week before`} />
        <Stat label="Posts in range" value={tr.posts} />
        <Stat label="Avg readers per post, first 48h" value={tr.avg_48h ?? "–"} note="posts at least 2 days old" />
        <Stat label="Read to the end" value={finishAvg == null ? "–" : `${finishAvg}%`}
          note={finishAvg == null ? "tracking started Oct 21" : "average across posts"} />
      </div>

      {lines.length > 0 && (
        <section className="dm-sec">
          <h3 className="desk-h3">What the numbers say</h3>
          <ul className="dm-takeaways">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      )}

      {m.by_day.length > 1 && (
        <section className="dm-sec">
          <h3 className="desk-h3">Blog readers per day</h3>
          <div className="dm-days" role="img" aria-label={`Blog readers per day: ${m.by_day.map((d) => `${d.day} ${d.readers}`).join(", ")}`}>
            {m.by_day.map((d) => (
              <span key={d.day} className="dm-day" title={`${fmtDay(d.day + "T12:00:00-04:00")}: ${d.readers} readers`}>
                <span className="dm-day__bar" style={{ height: `${Math.max(3, Math.round((100 * d.readers) / maxDay))}%` }} />
              </span>
            ))}
          </div>
          <div className="dm-days__axis"><span>{fmtDay(m.by_day[0].day + "T12:00:00-04:00")}</span><span>peak {maxDay}</span><span>{fmtDay(m.by_day[m.by_day.length - 1].day + "T12:00:00-04:00")}</span></div>
        </section>
      )}

      <GroupTable title="By article type" rows={m.by_type} />
      <GroupTable title="By posting time (Eastern)" rows={m.by_slot} />
      {m.by_author.length > 1 && <GroupTable title="By writer" rows={m.by_author} />}

      {m.sources.length > 0 && (
        <section className="dm-sec">
          <h3 className="desk-h3">Where article readers come from</h3>
          <table className="dm-table">
            <tbody>
              {m.sources.map((s) => (
                <tr key={s.source}>
                  <th scope="row">{s.source}</th>
                  <td><span className="dm-barcell"><Bar value={s.readers} max={srcMax} label={`${s.source}: ${s.readers}`} /><b>{s.readers}</b></span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="desk-small desk-muted">"Inside the site" = they were already on mvpeav.com and clicked over. Readers are counted once per article.</p>
        </section>
      )}

      <section className="dm-sec">
        <div className="dm-sechead">
          <h3 className="desk-h3">Every article</h3>
          <div className="dm-sort" role="group" aria-label="Sort articles">
            {([["new", "Newest"], ["r48", "Most readers"], ["end", "Most finished"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`ui-btn${sort === k ? " is-on" : ""}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
            ))}
          </div>
        </div>
        <ul className="desk-list">
          {posts.map((p) => (
            <li key={p.slug} className="dm-post">
              <a className="desk-row__title" href={`/blog/${p.slug}`}>{p.title}</a>
              <div className="desk-row__meta">
                <Pill tone="outline">{p.type}</Pill>
                <span>{fmtWhen(p.date)}{p.author !== "MVPeav" ? ` · by ${p.author}` : ""}</span>
                {p.age_hours < 48 && <Pill tone="gold">first 48h still running</Pill>}
              </div>
              <div className="dm-post__nums">
                <span className="dm-barcell dm-post__main"><Bar value={p.readers_48h} max={max48} /><b>{p.readers_48h}</b><em>readers, first 48h</em></span>
                <span><b>{p.readers}</b><em>total</em></span>
                <span><b>{p.end_pct == null ? "–" : `${p.end_pct}%`}</b><em>read to the end</em></span>
                <span><b>{p.onward_pct == null ? "–" : `${p.onward_pct}%`}</b><em>kept browsing</em></span>
                <span><b>{p.sources[0]?.source ?? "–"}</b><em>top source</em></span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="desk-small desk-muted">
        From the site's own visit counts, which started {fmtDay(m.tracking_since)} (older posts aren't listed). A reader is one device; your own visits (any device you've signed in on as MVPeav) are left out and everyone else counts, and
        "read to the end" counts only visits since {fmtDay(m.read_tracking_since)}{trackingNew ? ", so it fills in over the next few days" : ""}.
        Updated {fmtWhen(m.generated)}.
      </p>
    </div>
  );
}
