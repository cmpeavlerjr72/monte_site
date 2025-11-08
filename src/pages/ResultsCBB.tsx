// src/pages/ResultsCBB.tsx
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Bar,
  Cell,
} from "recharts";

const DATASET_ROOT = "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026";

type Market = "ml" | "spread" | "total";
type ProfitMap = { spread: number; total: number; ml: number };
type DailyAgg = { date: string; profit_units: ProfitMap };

type DailyJson = {
  date: string;
  aggregate?: Partial<Record<Market, { profit_units?: number }>>;
  aggregate_pos_ev_by_market?: Partial<
    Record<Market, Partial<Record<Market, { profit_units?: number }>>>
  >;
};

const pad = (n: number) => String(n).padStart(2, "0");
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYMD = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const copy = new Date(d.getTime()); copy.setDate(copy.getDate() + n); return copy; };
const rangeYMD = (start: string, end: string) => { const out: string[] = []; let cur = fromYMD(start); const stop = fromYMD(end); while (cur <= stop) { out.push(toYMD(cur)); cur = addDays(cur, 1); } return out; };
const fmtUnits = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const fmtX = (ymd: string) => fromYMD(ymd).toLocaleDateString(undefined, { month: "short", day: "2-digit" });

function extractProfit(J: DailyJson, onlyEV: boolean): ProfitMap {
  if (onlyEV && J.aggregate_pos_ev_by_market) {
    const src = J.aggregate_pos_ev_by_market;
    const sumInner = (m: Market) =>
      src[m] ? Object.values(src[m]!).reduce((acc, v) => acc + (v?.profit_units ?? 0), 0) : 0;
    return { spread: sumInner("spread"), total: sumInner("total"), ml: sumInner("ml") };
  }
  return {
    spread: J.aggregate?.spread?.profit_units ?? 0,
    total:  J.aggregate?.total?.profit_units ?? 0,
    ml:     J.aggregate?.ml?.profit_units ?? 0,
  };
}

export default function ResultsCBB() {
  const today = useMemo(() => toYMD(new Date()), []);
  const thirtyAgo = useMemo(() => toYMD(addDays(new Date(), -30)), []);

  const [startDate, setStartDate] = useState(thirtyAgo);
  const [endDate, setEndDate] = useState(today);

  const [onlyEV, setOnlyEV] = useState(true);
  const [useML, setUseML] = useState(true);
  const [useSpread, setUseSpread] = useState(true);
  const [useTotal, setUseTotal] = useState(true);

  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<DailyAgg[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const dates = rangeYMD(startDate, endDate);
        const base = DATASET_ROOT.replace(/\/+$/, "");
        const pref = SEASON_PREFIX.replace(/^\/+|\/+$/g, "");
        const fetched = await Promise.all(
          dates.map(async (d) => {
            const url = `${base}/${pref}/days/${d}/daily_results.json`;
            try {
              const res = await fetch(url, { cache: "no-store" });
              if (!res.ok) throw new Error(String(res.status));
              const J: DailyJson = await res.json();
              return { date: J.date || d, profit_units: extractProfit(J, onlyEV) } as DailyAgg;
            } catch { return null; }
          })
        );
        const tidy = (fetched.filter(Boolean) as DailyAgg[]).sort((a, b) => a.date.localeCompare(b.date));
        if (alive) setDays(tidy);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to load daily results.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [startDate, endDate, onlyEV]);

  // Build candles (cumulative within selected range) + base/body for stacked bars
  const candles = useMemo(() => {
    let running = 0;
    return days.map((d) => {
      const dayProfit =
        (useSpread ? d.profit_units.spread : 0) +
        (useTotal  ? d.profit_units.total  : 0) +
        (useML     ? d.profit_units.ml     : 0);

      const open = running;
      const close = running + dayProfit;
      running = close;

      const up = close >= open;
      const base = Math.min(open, close);      // bottom of body
      const body = Math.abs(close - open);     // body height

      return { date: d.date, open, close, up, base, body, change: dayProfit };
    });
  }, [days, useML, useSpread, useTotal]);

  const finalPnL = candles.length ? candles[candles.length - 1].close : 0;

  // Y domain padding using opens/closes
  const yStats = useMemo(() => {
    const vals = candles.flatMap((c) => [c.open, c.close]);
    const min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    const pad = Math.max(1, (max - min) * 0.08);
    return { min: min - pad, max: max + pad };
  }, [candles]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28 }}>CBB Results — Candlestick</h1>
        <div style={{ marginTop: 6, color: "var(--muted)" }}>
          Each candle is daily profit (close − open). Green = positive; red = negative.
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Start</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>End</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <label style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 8 }}>
            <input type="checkbox" checked={onlyEV} onChange={(e) => setOnlyEV(e.target.checked)} />
            Only +EV picks
          </label>

          <span style={{ width: 1, height: 22, background: "var(--border)" }} />

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={useML} onChange={(e) => setUseML(e.target.checked)} /> ML
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={useSpread} onChange={(e) => setUseSpread(e.target.checked)} /> Spread
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={useTotal} onChange={(e) => setUseTotal(e.target.checked)} /> Total
          </label>

          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
            {loading ? "Loading…" : err ? <span style={{ color: "var(--accent)" }}>{err}</span> : `Days: ${candles.length} · Final P&L: ${fmtUnits(finalPnL)}u`}
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 12 }}>
        {!candles.length && !loading && <div>No daily results in range.</div>}

        {!!candles.length && (
          <div style={{ width: "100%", height: 480 }}>
            <ResponsiveContainer>
              <ComposedChart
                data={candles}
                margin={{ top: 10, right: 16, bottom: 4, left: 0 }}
                barCategoryGap="55%"
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={20} tickFormatter={fmtX} />
                <YAxis tick={{ fontSize: 12 }} width={66} domain={[yStats.min, yStats.max]} tickFormatter={(v) => fmtUnits(v)} />
                <Tooltip
                  contentStyle={{ borderRadius: 10 }}
                  formatter={(value: any, name: any) =>
                    name === "change" ? [fmtUnits(value), "Day P&L"] : [fmtUnits(value), name]}
                  labelFormatter={(label: string, payload: any) => {
                    const r = payload?.[0]?.payload;
                    return r ? `${fmtX(label)}  |  Open ${fmtUnits(r.open)} → Close ${fmtUnits(r.close)}  (Δ ${fmtUnits(r.change)})` : label;
                  }}
                />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />

                {/* Candles via stacked bars: transparent base positions the body correctly */}
                <Bar dataKey="base" stackId="body" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="body" stackId="body" barSize={14} isAnimationActive={false}>
                  {candles.map((d, i) => (
                    <Cell key={i} fill={d.up ? "#16a34a" : "#ef4444"} stroke={d.up ? "#0f7a33" : "#b92a2a"} strokeWidth={0.6} rx={3} ry={3} />
                  ))}
                </Bar>

                {/* Invisible “change” for tooltip */}
                <Bar dataKey="change" fill="transparent" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
