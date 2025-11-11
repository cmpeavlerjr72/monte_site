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

/* ---------- DATASET CONFIG ---------- */
const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026";

/* ---------- TYPES ---------- */
type Market = "ml" | "spread" | "total";
type ProfitMap = { spread: number; total: number; ml: number };

type Counts = { wins: number; losses: number; pushes: number; graded: number };
type RecordMap = { spread: Counts; total: Counts; ml: Counts };

type DailyAgg = {
  date: string;
  profit_units: ProfitMap;
  record: RecordMap;
};

type Bucket = {
  wins?: number;
  losses?: number;
  pushes?: number;
  bets_graded?: number;
  win_share?: number;
  profit_units?: number;
};

type DailyJson = {
  date: string;
  aggregate?: Partial<Record<Market, Bucket>>;
  aggregate_pos_ev_by_market?: Partial<
    Record<Market, Partial<Record<Market, Bucket>>>
  >;
  aggregate_favorite_underdog?: {
    ml?: {
      favorite?: Bucket;
      underdog?: Bucket;
      pos_ev_favorite?: Bucket;
      pos_ev_underdog?: Bucket;
    };
    spread?: {
      favorite?: Bucket;
      underdog?: Bucket;
      pos_ev_favorite?: Bucket;
      pos_ev_underdog?: Bucket;
    };
    total?: {
      over?: Bucket;
      under?: Bucket;
      pos_ev_over?: Bucket;
      pos_ev_under?: Bucket;
    };
  };
};

/* ---------- UTILS ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYMD = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
};
const rangeYMD = (start: string, end: string) => {
  const out: string[] = [];
  let cur = fromYMD(start);
  const stop = fromYMD(end);
  while (cur <= stop) {
    out.push(toYMD(cur));
    cur = addDays(cur, 1);
  }
  return out;
};
const fmtUnits = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const fmtX = (ymd: string) =>
  fromYMD(ymd).toLocaleDateString(undefined, { month: "short", day: "2-digit" });

/* ---- Counts helpers (type-safe) ---- */
const toCounts = (c?: Partial<Counts>): Counts => ({
  wins: c?.wins ?? 0,
  losses: c?.losses ?? 0,
  pushes: c?.pushes ?? 0,
  graded: c?.graded ?? 0,
});
const emptyC: Counts = { wins: 0, losses: 0, pushes: 0, graded: 0 };
const addCounts = (a?: Partial<Counts>, b?: Partial<Counts>): Counts =>
  toCounts({
    wins: (a?.wins ?? 0) + (b?.wins ?? 0),
    losses: (a?.losses ?? 0) + (b?.losses ?? 0),
    pushes: (a?.pushes ?? 0) + (b?.pushes ?? 0),
    graded: (a?.graded ?? 0) + (b?.graded ?? 0),
  });

/* Convert a results Bucket => Counts */
const countsFromBucket = (b?: Bucket): Counts =>
  toCounts({
    wins: b?.wins ?? 0,
    losses: b?.losses ?? 0,
    pushes: b?.pushes ?? 0,
    graded: b?.bets_graded ?? 0,
  });

/* ---------- FILTER STATE ---------- */
type Side3 = "all" | "favorite" | "underdog";
type TotSide3 = "all" | "over" | "under";

type FilterState = {
  // market on/off
  useML: boolean;
  useSpread: boolean;
  useTotal: boolean;

  // ML side & ev
  mlSide: Side3;
  mlEV: boolean;

  // Spread side & ev
  spSide: Side3;
  spEV: boolean;

  // Total side & ev
  totSide: TotSide3;
  totEV: boolean;
};

/* ---------- PROFIT + RECORD EXTRACTORS ---------- */
function profitAggregate(J: DailyJson, m: Market): number {
  return J.aggregate?.[m]?.profit_units ?? 0;
}
function recordAggregate(J: DailyJson, m: Market): Counts {
  return countsFromBucket(J.aggregate?.[m]);
}

function evFallbackProfit(J: DailyJson, m: Market): number {
  const inner = J.aggregate_pos_ev_by_market?.[m];
  if (!inner) return 0;
  return Object.values(inner).reduce((acc, v) => acc + (v?.profit_units ?? 0), 0);
}
function evFallbackRecord(J: DailyJson, m: Market): Counts {
  const inner = J.aggregate_pos_ev_by_market?.[m];
  if (!inner) return emptyC;
  return Object.values(inner).reduce(
    (acc, v) => addCounts(acc, countsFromBucket(v)),
    emptyC
  );
}

/* AFD helpers */
function mlProfitRecord(J: DailyJson, side: Side3, ev: boolean): { profit: number | null; rec: Counts | null } {
  const src = J.aggregate_favorite_underdog?.ml;
  if (!src) return { profit: null, rec: null };
  if (side === "all") {
    if (!ev) return { profit: null, rec: null };
    return {
      profit: (src.pos_ev_favorite?.profit_units ?? 0) + (src.pos_ev_underdog?.profit_units ?? 0),
      rec: addCounts(countsFromBucket(src.pos_ev_favorite), countsFromBucket(src.pos_ev_underdog)),
    };
  }
  if (side === "favorite")
    return {
      profit: (ev ? src.pos_ev_favorite : src.favorite)?.profit_units ?? 0,
      rec: countsFromBucket(ev ? src.pos_ev_favorite : src.favorite),
    };
  // underdog
  return {
    profit: (ev ? src.pos_ev_underdog : src.underdog)?.profit_units ?? 0,
    rec: countsFromBucket(ev ? src.pos_ev_underdog : src.underdog),
  };
}

function spProfitRecord(J: DailyJson, side: Side3, ev: boolean): { profit: number | null; rec: Counts | null } {
  const src = J.aggregate_favorite_underdog?.spread;
  if (!src) return { profit: null, rec: null };
  if (side === "all") {
    if (!ev) return { profit: null, rec: null };
    return {
      profit: (src.pos_ev_favorite?.profit_units ?? 0) + (src.pos_ev_underdog?.profit_units ?? 0),
      rec: addCounts(countsFromBucket(src.pos_ev_favorite), countsFromBucket(src.pos_ev_underdog)),
    };
  }
  if (side === "favorite")
    return {
      profit: (ev ? src.pos_ev_favorite : src.favorite)?.profit_units ?? 0,
      rec: countsFromBucket(ev ? src.pos_ev_favorite : src.favorite),
    };
  // underdog
  return {
    profit: (ev ? src.pos_ev_underdog : src.underdog)?.profit_units ?? 0,
    rec: countsFromBucket(ev ? src.pos_ev_underdog : src.underdog),
  };
}

function totProfitRecord(J: DailyJson, side: TotSide3, ev: boolean): { profit: number | null; rec: Counts | null } {
  const src = J.aggregate_favorite_underdog?.total;
  if (!src) return { profit: null, rec: null };
  if (side === "all") {
    if (!ev) return { profit: null, rec: null };
    return {
      profit: (src.pos_ev_over?.profit_units ?? 0) + (src.pos_ev_under?.profit_units ?? 0),
      rec: addCounts(countsFromBucket(src.pos_ev_over), countsFromBucket(src.pos_ev_under)),
    };
  }
  if (side === "over")
    return {
      profit: (ev ? src.pos_ev_over : src.over)?.profit_units ?? 0,
      rec: countsFromBucket(ev ? src.pos_ev_over : src.over),
    };
  // under
  return {
    profit: (ev ? src.pos_ev_under : src.under)?.profit_units ?? 0,
    rec: countsFromBucket(ev ? src.pos_ev_under : src.under),
  };
}

function extractProfitAndRecord(J: DailyJson, fs: FilterState): { profit: ProfitMap; rec: RecordMap } {
  // ML
  const mlAFD = mlProfitRecord(J, fs.mlSide, fs.mlEV);
  const mlProfit =
    mlAFD.profit ??
    (fs.mlEV && fs.mlSide === "all" ? evFallbackProfit(J, "ml") : profitAggregate(J, "ml"));
  const mlRec =
    mlAFD.rec ??
    (fs.mlEV && fs.mlSide === "all" ? evFallbackRecord(J, "ml") : recordAggregate(J, "ml"));

  // Spread
  const spAFD = spProfitRecord(J, fs.spSide, fs.spEV);
  const spProfit =
    spAFD.profit ??
    (fs.spEV && fs.spSide === "all" ? evFallbackProfit(J, "spread") : profitAggregate(J, "spread"));
  const spRec =
    spAFD.rec ??
    (fs.spEV && fs.spSide === "all" ? evFallbackRecord(J, "spread") : recordAggregate(J, "spread"));

  // Total
  const totAFD = totProfitRecord(J, fs.totSide, fs.totEV);
  const totProfit =
    totAFD.profit ??
    (fs.totEV && fs.totSide === "all" ? evFallbackProfit(J, "total") : profitAggregate(J, "total"));
  const totRec =
    totAFD.rec ??
    (fs.totEV && fs.totSide === "all" ? evFallbackRecord(J, "total") : recordAggregate(J, "total"));

  return {
    profit: { ml: mlProfit, spread: spProfit, total: totProfit },
    rec: { ml: mlRec, spread: spRec, total: totRec },
  };
}

/* ---------- COMPONENT ---------- */
export default function ResultsCBB() {
  /* dates */
  const today = useMemo(() => toYMD(new Date()), []);
  const thirtyAgo = useMemo(() => toYMD(addDays(new Date(), -30)), []);
  const [startDate, setStartDate] = useState(thirtyAgo);
  const [endDate, setEndDate] = useState(today);

  /* filters */
  const [fs, setFs] = useState<FilterState>({
    useML: true,
    useSpread: true,
    useTotal: true,

    mlSide: "all",
    mlEV: false,

    spSide: "all",
    spEV: false,

    totSide: "all",
    totEV: false,
  });

  /* data */
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<DailyAgg[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
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
              const { profit, rec } = extractProfitAndRecord(J, fs);
              return { date: J.date || d, profit_units: profit, record: rec } as DailyAgg;
            } catch {
              return null;
            }
          })
        );

        const tidy = (fetched.filter(Boolean) as DailyAgg[]).sort((a, b) =>
          a.date.localeCompare(b.date)
        );
        if (alive) setDays(tidy);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to load daily results.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startDate, endDate, fs]);

  /* candles (cumulative) */
  const candles = useMemo(() => {
    let running = 0;
    return days.map((d) => {
      const dayProfit =
        (fs.useSpread ? d.profit_units.spread : 0) +
        (fs.useTotal ? d.profit_units.total : 0) +
        (fs.useML ? d.profit_units.ml : 0);

      const open = running;
      const close = running + dayProfit;
      running = close;

      const up = close >= open;
      const base = Math.min(open, close);
      const body = Math.abs(close - open);

      return { date: d.date, open, close, up, base, body, change: dayProfit };
    });
  }, [days, fs]);

  const finalPnL = candles.length ? candles[candles.length - 1].close : 0;

  /* per-market + overall records (respect market toggles) */
  const perMarket = useMemo(() => {
    const sum = (picker: (r: RecordMap) => Counts) =>
      days.reduce<Counts>((acc, d) => addCounts(acc, picker(d.record)), emptyC);

    const ml = sum((r) => r.ml);
    const sp = sum((r) => r.spread);
    const tot = sum((r) => r.total);

    const winPct = (c: Counts) => {
      const denom = c.wins + c.losses;
      return denom ? (c.wins / denom) * 100 : 0;
    };

    const overall = toCounts({
      wins: (fs.useML ? ml.wins : 0) + (fs.useSpread ? sp.wins : 0) + (fs.useTotal ? tot.wins : 0),
      losses:
        (fs.useML ? ml.losses : 0) + (fs.useSpread ? sp.losses : 0) + (fs.useTotal ? tot.losses : 0),
      pushes:
        (fs.useML ? ml.pushes : 0) + (fs.useSpread ? sp.pushes : 0) + (fs.useTotal ? tot.pushes : 0),
      graded:
        (fs.useML ? ml.graded : 0) + (fs.useSpread ? sp.graded : 0) + (fs.useTotal ? tot.graded : 0),
    });

    return {
      ml: { counts: ml, pct: winPct(ml) },
      spread: { counts: sp, pct: winPct(sp) },
      total: { counts: tot, pct: winPct(tot) },
      overall: { counts: overall, pct: winPct(overall) },
    };
  }, [days, fs]);

  /* y domain */
  const yStats = useMemo(() => {
    const vals = candles.flatMap((c) => [c.open, c.close]);
    const min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    const pad = Math.max(1, (max - min) * 0.08);
    return { min: min - pad, max: max + pad };
  }, [candles]);

  const recLine = (label: string, c: Counts, pct: number) =>
    `${label}: ${c.wins}-${c.losses}-${c.pushes} (Win%: ${fmtUnits(pct)}%)`;

  /* ---------- RENDER ---------- */
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28 }}>
          CBB Results — Candlestick
        </h1>
        <div style={{ marginTop: 6, color: "var(--muted)" }}>
          Each candle is daily profit (close − open). Green = positive; red =
          negative.
        </div>

        {/* Controls */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto 1fr",
            rowGap: 10,
            columnGap: 16,
            alignItems: "center",
            marginTop: 10,
          }}
        >
          {/* Dates */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Start</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>End</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Summary (now with per-market records) */}
          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.9, textAlign: "right" }}>
            {loading ? (
              "Loading…"
            ) : err ? (
              <span style={{ color: "var(--accent)" }}>{err}</span>
            ) : (
              <>
                <div>{`Days: ${candles.length} · Final P&L: ${fmtUnits(finalPnL)}u`}</div>
                <div style={{ marginTop: 2 }}>
                  {recLine("Overall", perMarket.overall.counts, perMarket.overall.pct)}
                </div>
                <div style={{ marginTop: 2, opacity: fs.useML ? 1 : 0.5 }}>
                  {recLine("ML", perMarket.ml.counts, perMarket.ml.pct)}
                </div>
                <div style={{ marginTop: 2, opacity: fs.useSpread ? 1 : 0.5 }}>
                  {recLine("Spread", perMarket.spread.counts, perMarket.spread.pct)}
                </div>
                <div style={{ marginTop: 2, opacity: fs.useTotal ? 1 : 0.5 }}>
                  {recLine("Total", perMarket.total.counts, perMarket.total.pct)}
                </div>
              </>
            )}
          </div>

          {/* Market toggles */}
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useML}
                onChange={(e) => setFs((p) => ({ ...p, useML: e.target.checked }))}
              />
              ML
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useSpread}
                onChange={(e) =>
                  setFs((p) => ({ ...p, useSpread: e.target.checked }))
                }
              />
              Spread
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useTotal}
                onChange={(e) =>
                  setFs((p) => ({ ...p, useTotal: e.target.checked }))
                }
              />
              Total
            </label>
          </div>
          <div />

          {/* ML dropdown + EV */}
          <div
            style={{
              gridColumn: "1 / span 3",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            <strong style={{ width: 52 }}>ML:</strong>
            <select
              value={fs.mlSide}
              onChange={(e) =>
                setFs((p) => ({ ...p, mlSide: e.target.value as Side3 }))
              }
            >
              <option value="all">All</option>
              <option value="favorite">Favorites</option>
              <option value="underdog">Underdog</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.mlEV}
                onChange={(e) => setFs((p) => ({ ...p, mlEV: e.target.checked }))}
              />
              +EV
            </label>
          </div>

          {/* Spread dropdown + EV */}
          <div
            style={{
              gridColumn: "1 / span 3",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            <strong style={{ width: 52 }}>Spread:</strong>
            <select
              value={fs.spSide}
              onChange={(e) =>
                setFs((p) => ({ ...p, spSide: e.target.value as Side3 }))
              }
            >
              <option value="all">All</option>
              <option value="favorite">Favorites</option>
              <option value="underdog">Underdog</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.spEV}
                onChange={(e) => setFs((p) => ({ ...p, spEV: e.target.checked }))}
              />
              +EV
            </label>
          </div>

          {/* Totals dropdown + EV */}
          <div
            style={{
              gridColumn: "1 / span 3",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            <strong style={{ width: 52 }}>Total:</strong>
            <select
              value={fs.totSide}
              onChange={(e) =>
                setFs((p) => ({ ...p, totSide: e.target.value as TotSide3 }))
              }
            >
              <option value="all">All</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.totEV}
                onChange={(e) => setFs((p) => ({ ...p, totEV: e.target.checked }))}
              />
              +EV
            </label>
          </div>
        </div>
      </section>

      {/* Chart */}
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
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                  tickFormatter={fmtX}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={66}
                  domain={[yStats.min, yStats.max]}
                  tickFormatter={(v) => fmtUnits(v)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 10 }}
                  formatter={(value: any, name: any) =>
                    name === "change"
                      ? [fmtUnits(value), "Day P&L"]
                      : [fmtUnits(value), name]
                  }
                  labelFormatter={(label: string, payload: any) => {
                    const r = payload?.[0]?.payload;
                    return r
                      ? `${fmtX(label)}  |  Open ${fmtUnits(r.open)} → Close ${fmtUnits(
                          r.close
                        )}  (Δ ${fmtUnits(r.change)})`
                      : label;
                  }}
                />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />

                {/* Candles: stacked base + body (no wicks) */}
                <Bar dataKey="base" stackId="body" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="body" stackId="body" barSize={14} isAnimationActive={false}>
                  {candles.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.up ? "#16a34a" : "#ef4444"}
                      stroke={d.up ? "#0f7a33" : "#b92a2a"}
                      strokeWidth={0.6}
                      rx={3}
                      ry={3}
                    />
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
