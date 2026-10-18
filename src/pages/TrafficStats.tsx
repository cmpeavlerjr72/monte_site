// src/pages/TrafficStats.tsx: OWNER-ONLY traffic dashboard at /stats (2026-10-18).
//
// No nav entry. The page asks GET /api/me/traffic, which answers only for a uid
// named in the server's CFB_PORTAL_OWNERS; anyone else gets a polite "owner
// only" card and no numbers. Data comes from src/lib/track.ts -> POST /api/t ->
// public.page_events (no IP / no PII).
//
// Bar-test layout: a one-line verdict first (visitors + best source), then one
// bar per row, one number at rest. Sources are ranked by sessions, and the
// right-hand column is what makes a source worth more effort: how many of its
// visitors went on to click a bet button.

import { useEffect, useMemo, useState } from "react";
import { useSession, getAccessToken, supabaseEnabled } from "../lib/supabase";

type Row = { key: string; n: number };
type Traffic = {
  days: number; generated: string; rows: number; truncated: boolean;
  totals: { views: number; visitors: number; sessions: number; new_visitors: number; clicks: number; signed_in_visitors: number };
  by_day: { day: string; views: number; visitors: number }[];
  pages: { path: string; views: number; visitors: number; landings: number }[];
  sources: { source: string; sessions: number; visitors: number; views: number; pages_per_session: number; clicks: number; bet_clicks: number }[];
  clicks: Row[]; click_pages: Row[]; devices: Row[]; countries: Row[];
};

const RANGES = [1, 7, 30, 90];

function nice(n: number) { return n.toLocaleString("en-US"); }

function sourceLabel(s: string) {
  if (s.startsWith("tag:")) return `🏷 ${s.slice(4)}`;
  return s;
}

function Bar({ value, max, color = "var(--brand)" }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 8, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 999 }} />
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="ui-card" style={{ display: "grid", gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </section>
  );
}

function BarList({ rows, label, value, extra, max }: {
  rows: any[]; label: (r: any) => React.ReactNode; value: (r: any) => number; extra?: (r: any) => React.ReactNode; max?: number;
}) {
  const m = max ?? Math.max(1, ...rows.map(value));
  if (!rows.length) return <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing yet.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label(r)}</span>
            <span style={{ fontWeight: 700, flex: "none" }}>{nice(value(r))}{extra ? <span style={{ fontWeight: 500, color: "var(--muted)" }}> {extra(r)}</span> : null}</span>
          </div>
          <Bar value={value(r)} max={m} />
        </div>
      ))}
    </div>
  );
}

export default function TrafficStats() {
  const { session, loading } = useSession();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Traffic | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const jwt = await getAccessToken();
        const r = await fetch(`/api/me/traffic?days=${days}`, { headers: { authorization: `Bearer ${jwt}` }, cache: "no-store" });
        if (!alive) return;
        if (r.status === 403) { setErr("owner_only"); setData(null); return; }
        if (r.status === 401) { setErr("sign_in"); setData(null); return; }
        if (!r.ok) { setErr(`Error ${r.status}`); return; }
        setData(await r.json());
      } catch (e: any) { if (alive) setErr(e?.message ?? "failed"); }
      finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [session, days]);

  const best = useMemo(() => {
    if (!data) return null;
    const ext = data.sources.filter((s) => s.source !== "direct / unknown");
    return ext[0] ?? null;
  }, [data]);

  if (!supabaseEnabled) return <div className="ui-card">Stats need accounts enabled on this build.</div>;
  if (loading) return <div className="ui-card">Loading…</div>;
  if (!session || err === "sign_in") return <div className="ui-card">Sign in with the owner account to see traffic.</div>;
  if (err === "owner_only") return <div className="ui-card">This page is for the site owner.</div>;

  const t = data?.totals;
  const maxDay = Math.max(1, ...(data?.by_day ?? []).map((d) => d.visitors));

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Traffic</h1>
        <div role="tablist" style={{ display: "flex", gap: 4 }}>
          {RANGES.map((d) => (
            <button key={d} type="button" className="ui-btn" data-on={d === days ? "true" : undefined}
                    onClick={() => setDays(d)} aria-pressed={d === days}>
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="ui-card" style={{ color: "var(--neg)" }}>{err}</div>}
      {busy && !data && <div className="ui-card">Loading…</div>}

      {data && t && (
        <>
          {/* the verdict */}
          <section className="ui-card" style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>{nice(t.visitors)} <span style={{ fontSize: 16, fontWeight: 600, color: "var(--muted)" }}>visitors</span></div>
            <div style={{ fontSize: 14, color: "var(--muted)" }}>
              {nice(t.views)} page views · {nice(t.new_visitors)} new · {nice(t.clicks)} tracked clicks
              {best ? <> · top source <b style={{ color: "var(--text)" }}>{sourceLabel(best.source)}</b> ({nice(best.sessions)} visits)</> : null}
            </div>
            {data.rows === 0 && <div style={{ fontSize: 13 }}>No data yet — tracking started 2026-10-18. Visits show up here within seconds.</div>}
          </section>

          <Card title="Visitors per day" sub="Eastern time">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {data.by_day.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.visitors} visitors, ${d.views} views`} style={{ flex: 1, display: "grid", alignItems: "end", height: "100%" }}>
                  <div style={{ height: `${Math.max(3, (d.visitors / maxDay) * 100)}%`, background: "var(--brand)", borderRadius: "4px 4px 0 0" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
              <span>{data.by_day[0]?.day.slice(5)}</span><span>{data.by_day[data.by_day.length - 1]?.day.slice(5)}</span>
            </div>
          </Card>

          <Card title="Where visitors come from" sub="Visits per source · 🏷 = a ?src= tag on a link we posted · right number = bet-button clicks from those visits">
            <BarList rows={data.sources.slice(0, 20)} label={(r) => sourceLabel(r.source)} value={(r) => r.sessions}
                     extra={(r) => `· ${r.pages_per_session} pg/visit · ${r.bet_clicks} bet`} />
          </Card>

          <Card title="Top pages" sub="Page views · articles, game boards, quads…">
            <BarList rows={data.pages.slice(0, 25)} label={(r) => r.path} value={(r) => r.views}
                     extra={(r) => `· ${r.visitors} people`} />
          </Card>

          <Card title="Landing pages" sub="Where visits start (the page a link sent them to)">
            <BarList rows={[...data.pages].filter((p) => p.landings > 0).sort((a, b) => b.landings - a.landings).slice(0, 15)}
                     label={(r) => r.path} value={(r) => r.landings} />
          </Card>

          <Card title="What people click" sub="Tracked buttons and outbound links">
            <BarList rows={data.clicks.slice(0, 20)} label={(r) => r.key} value={(r) => r.n} />
          </Card>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <Card title="Devices" sub="Per visitor">
              <BarList rows={data.devices} label={(r) => r.key} value={(r) => r.n} />
            </Card>
            <Card title="Countries" sub="Per visitor (from Cloudflare)">
              <BarList rows={data.countries} label={(r) => r.key} value={(r) => r.n} />
            </Card>
          </div>

          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {nice(data.rows)} events · generated {new Date(data.generated).toLocaleString()}{data.truncated ? " · TRUNCATED (narrow the range)" : ""}
          </div>
        </>
      )}
    </div>
  );
}
