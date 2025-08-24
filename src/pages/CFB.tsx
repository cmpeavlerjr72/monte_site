// src/pages/CFB.tsx
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as Papa from "papaparse";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

/* ---------- Robust discovery (relative paths + many patterns) ---------- */
// Raw text (preferred)
const RAW1 = import.meta.glob("../data/**/scores/*.csv",     { as: "raw", eager: true }) as Record<string, string>;
const RAW2 = import.meta.glob("../data/**/scores/*.csv.csv", { as: "raw", eager: true }) as Record<string, string>;
const RAW3 = import.meta.glob("../data/**/scores/*.CSV",     { as: "raw", eager: true }) as Record<string, string>;
const RAW4 = import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "raw", eager: true }) as Record<string, string>;
// URL fallback (only if a path wasn’t captured by RAW*)
const URL1 = import.meta.glob("../data/**/scores/*.csv",     { as: "url", eager: true }) as Record<string, string>;
const URL2 = import.meta.glob("../data/**/scores/*.csv.csv", { as: "url", eager: true }) as Record<string, string>;
const URL3 = import.meta.glob("../data/**/scores/*.CSV",     { as: "url", eager: true }) as Record<string, string>;
const URL4 = import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "url", eager: true }) as Record<string, string>;

type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };

function extractWeekFromPath(p: string): string {
  const s = p.replace(/\\/g, "/"); // normalize Windows slashes
  const m1 = s.match(/\/(week[^/]+)\//i);
  if (m1) return m1[1].toLowerCase();
  const m2 = s.match(/\/data\/([^/]+)\//i);
  if (m2) return m2[1].toLowerCase();
  return "root";
}

function buildFiles(): FileInfo[] {
  const allRaw: Record<string, string> = { ...RAW1, ...RAW2, ...RAW3, ...RAW4 };
  const allUrl: Record<string, string> = { ...URL1, ...URL2, ...URL3, ...URL4 };
  const paths = Array.from(new Set([...Object.keys(allRaw), ...Object.keys(allUrl)]));
  return paths
    .map((p) => {
      const file = p.split("/").pop() || p;
      const week = extractWeekFromPath(p);
      return { path: p, week, file, raw: allRaw[p], url: allUrl[p] };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/* ---------- Types & helpers ---------- */
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // rows normalized to A vs B (alphabetical key)
type GameMap = Record<string, GameData>;
type Metric = "spread" | "total" | "teamLeft" | "teamRight";

function sortedKey(a: string, b: string) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join("__");
}
function niceGameTitle(g: GameData) {
  return `${g.teamA} vs ${g.teamB}`;
}

function computeHistogram(values: number[], opts?: { bins?: number; binWidth?: number }) {
  if (!values.length) return [] as { bin: string; count: number; start: number; end: number }[];
  const v = values.slice().sort((a, b) => a - b);
  const n = v.length, min = v[0], max = v[n - 1];
  const q1 = v[Math.floor(0.25 * (n - 1))];
  const q3 = v[Math.floor(0.75 * (n - 1))];
  const iqr = Math.max(1e-6, q3 - q1);
  let binWidth = opts?.binWidth || (max > min ? Math.max(2 * iqr * Math.cbrt(1 / n), 0.5) : 1);
  let bins = opts?.bins || Math.max(1, Math.ceil((max - min) / binWidth));
  if (opts?.bins && !opts?.binWidth && max > min) binWidth = (max - min) / bins;

  const start = Math.floor(min / binWidth) * binWidth;
  const end = Math.ceil(max / binWidth) * binWidth;
  const edges: number[] = [];
  for (let x = start; x <= end + 1e-9; x += binWidth) edges.push(Number(x.toFixed(8)));

  const counts = new Array(edges.length - 1).fill(0);
  for (const x of v) {
    let idx = Math.floor((x - start) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= counts.length) idx = counts.length - 1;
    counts[idx]++;
  }
  return counts.map((c, i) => {
    const s = edges[i], e = edges[i + 1];
    return { bin: `${Number(s.toFixed(1))}–${Number(e.toFixed(1))}`, count: c, start: s, end: e };
  });
}
function summaryStats(values: number[]) {
  if (!values.length) return null as null | Record<string, number>;
  const v = values.slice().sort((a, b) => a - b);
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const p05 = v[Math.floor(0.05 * (n - 1))];
  const p25 = v[Math.floor(0.25 * (n - 1))];
  const p75 = v[Math.floor(0.75 * (n - 1))];
  const p95 = v[Math.floor(0.95 * (n - 1))];
  return { n, mean, median, p05, p25, p75, p95 };
}

/** Given hist bars and a numeric value, return the bar label that contains it */
function findBinLabelForValue(hist: { start: number; end: number; bin: string }[], x: number) {
  for (const h of hist) {
    if (x >= h.start && x < h.end) return h.bin;
  }
  // if exactly on the last edge, snap to last bin
  if (hist.length && x === hist[hist.length - 1].end) return hist[hist.length - 1].bin;
  return undefined;
}

/** Label for the current metric using current orientation */
function metricLabel(metric: Metric, g: GameData, teamOrder: 0 | 1) {
  const leftName  = teamOrder === 0 ? g.teamA : g.teamB;
  const rightName = teamOrder === 0 ? g.teamB : g.teamA;
  switch (metric) {
    case "spread":    return `Spread (${rightName} − ${leftName})`;
    case "total":     return `Total (${leftName} + ${rightName})`;
    case "teamLeft":  return `${leftName} Team Total`;
    case "teamRight": return `${rightName} Team Total`;
  }
}

/** Series builder — orientation aware.
 *  - spread: Right − Left  (matches sportsbook convention when viewing "Left vs Right")
 *  - total:  Left + Right
 *  - teamLeft:  Left points
 *  - teamRight: Right points
 */
function metricSeries(g: GameData, metric: Metric, teamOrder: 0 | 1) {
  const A = g.rowsA.map((r) => r.pts);     // A points (alphabetical first)
  const B = g.rowsA.map((r) => r.opp_pts); // B points
  const left  = teamOrder === 0 ? A : B;
  const right = teamOrder === 0 ? B : A;

  if (metric === "teamLeft")  return left;
  if (metric === "teamRight") return right;
  if (metric === "total")     return left.map((x, i) => x + right[i]);
  // spread == Right − Left
  return right.map((x, i) => x - left[i]);
}

/* ---------- Component ---------- */
export default function CFB() {
  // Discover files once; group by week
  const discovered = useMemo(buildFiles, []);
  const { weeks, weekToFiles } = useMemo(() => {
    const map: Record<string, FileInfo[]> = {};
    for (const f of discovered) (map[f.week] ||= []).push(f);
    const names = Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { weeks: names, weekToFiles: map };
  }, [discovered]);

  const [selectedWeek, setSelectedWeek] = useState<string>(weeks[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [games, setGames] = useState<GameMap>({});
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [metric, setMetric] = useState<Metric>("spread");
  const [teamOrder, setTeamOrder] = useState<0 | 1>(0); // 0 = A vs B (left=A, right=B), 1 = B vs A
  const [bins, setBins] = useState<number | "auto">("auto");
  const [line, setLine] = useState<string>("");         // custom line

  const selectedGame = selectedKey ? games[selectedKey] : null;

  const filteredEntries = useMemo(() => {
    const entries = Object.entries(games) as [string, GameData][];
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(([, g]) => g.teamA.toLowerCase().includes(q) || g.teamB.toLowerCase().includes(q));
  }, [games, search]);

  const series = useMemo(() => (selectedGame ? metricSeries(selectedGame, metric, teamOrder) : []), [selectedGame, metric, teamOrder]);

  const hist = useMemo(() => {
    if (!series.length) return [];
    const opts: any = {};
    if (bins !== "auto") opts.bins = Math.max(1, Number(bins));
    return computeHistogram(series, opts);
  }, [series, bins]);

  const stats = useMemo(() => summaryStats(series), [series]);

  const prob = useMemo(() => {
    if (!series.length) return null as null | { under: number; at: number; over: number; line: number };
    const L = Number(line);
    if (!Number.isFinite(L)) return null;
    const n = series.length;
    let under = 0, at = 0, over = 0;
    for (const x of series) {
      if (Math.abs(x - L) < 1e-9) at++;
      else if (x < L) under++;
      else over++;
    }
    return { under: under / n, at: at / n, over: over / n, line: L };
  }, [series, line]);

  /* ---------- Load the selected week ---------- */
  useEffect(() => {
    if (!selectedWeek) { setGames({}); setSelectedKey(null); return; }

    async function loadWeek() {
      setLoading(true);
      try {
        const files = weekToFiles[selectedWeek] ?? [];
        const parsedArrays = await Promise.all(
          files.map(
            (item) =>
              new Promise<SimRow[]>((resolve, reject) => {
                const parseText = (text: string) =>
                  Papa.parse(text, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: (res) => {
                      try {
                        const rows = (res.data as any[])
                          .filter((r) => r && r.team != null && r.opp != null && r.pts != null && r.opp_pts != null)
                          .map((r) => ({
                            team: String(r.team),
                            opp: String(r.opp),
                            pts: Number(r.pts),
                            opp_pts: Number(r.opp_pts),
                          })) as SimRow[];
                        resolve(rows);
                      } catch (e) {
                        reject(e);
                      }
                    },
                    error: reject,
                  });

                if (item.raw) parseText(item.raw);
                else if (item.url) fetch(item.url).then((r) => r.text()).then(parseText).catch(reject);
                else reject(new Error("No raw or url available for " + item.path));
              })
          )
        );

        const nextGames: GameMap = {};
        for (const rows of parsedArrays) {
          // group by unordered pair
          const byPair = new Map<string, SimRow[]>();
          for (const row of rows) {
            const key = sortedKey(row.team, row.opp);
            const existing = byPair.get(key);
            if (existing) existing.push(row); else byPair.set(key, [row]);
          }
          // normalize to A vs B
          for (const [pairKey, allRows] of byPair.entries()) {
            const [A, B] = pairKey.split("__");
            const normalized = allRows.map((r) =>
              r.team === A && r.opp === B
                ? { team: A, opp: B, pts: r.pts, opp_pts: r.opp_pts }
                : r.team === B && r.opp === A
                ? { team: A, opp: B, pts: r.opp_pts, opp_pts: r.pts }
                : null
            ).filter(Boolean) as SimRow[];

            if (!nextGames[pairKey]) nextGames[pairKey] = { teamA: A, teamB: B, rowsA: [] };
            nextGames[pairKey].rowsA.push(...normalized);
          }
        }

        setGames(nextGames);
        setSelectedKey(Object.keys(nextGames)[0] ?? null);
        setTeamOrder(0); // default to A vs B
      } finally {
        setLoading(false);
      }
    }
    loadWeek();
  }, [selectedWeek, weekToFiles]);

  // For placing the vertical line on the matching bar (categorical X)
  const lineBinLabel = useMemo(() => (prob && hist.length ? findBinLabelForValue(hist as any, prob.line) : undefined), [prob, hist]);

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1fr", maxWidth: 1200, margin: "0 auto" }}>
      {/* Week selector */}
      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Week</h2>
        {weeks.length === 0 ? (
          <div style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>
            Put score CSVs under <code>src/data/week#/scores/</code>
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {loading ? "Loading…" : Object.keys(games).length ? `Loaded ${Object.keys(games).length} games` : "No games loaded"}
            </span>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              • discovered {(weekToFiles[selectedWeek]?.length ?? 0)} files
            </span>
          </div>
        )}
      </section>

      {/* Find a game */}
      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Find a game</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search teams (e.g., Hawaii, Stanford)"
          style={{ marginTop: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <div style={{ marginTop: 12, maxHeight: 220, overflow: "auto", display: "grid", gap: 8 }}>
          {filteredEntries.length === 0 ? (
            <div style={{ fontSize: 14, opacity: 0.7 }}>{loading ? "Loading…" : "No games found for this week."}</div>
          ) : (
            filteredEntries.map(([key, g]) => (
              <button
                key={key}
                onClick={() => { setSelectedKey(key); setTeamOrder(0); }}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${selectedKey === key ? "#3b82f6" : "#e2e8f0"}`,
                  background: selectedKey === key ? "#eff6ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600 }}>{g.teamA} vs {g.teamB}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{g.rowsA.length} simulations</div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Metric & options */}
      <MetricOptions
        metric={metric} setMetric={setMetric}
        teamOrder={teamOrder} setTeamOrder={setTeamOrder}
        selectedGame={selectedGame}
        bins={bins} setBins={setBins}
        line={line} setLine={setLine}
      />

      {/* Chart + stats */}
      <section style={{ display: "grid", gap: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, minHeight: 420 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Histogram</div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                {selectedGame ? metricLabel(metric, selectedGame, teamOrder) : "Select a game"}
              </h3>
              {selectedGame && (
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                  {niceGameTitle(selectedGame)} • Orientation: {teamOrder === 0 ? `${selectedGame.teamA} vs ${selectedGame.teamB}` : `${selectedGame.teamB} vs ${selectedGame.teamA}`}
                </div>
              )}
            </div>
          </div>

          {!selectedGame || !hist.length ? (
            <div style={{ height: 340, display: "grid", placeItems: "center", opacity: 0.6 }}>
              Choose a game to see the chart.
            </div>
          ) : (
            <div style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hist} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bin" angle={-30} textAnchor="end" interval={0} height={50} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(v: any) => [v, "Count"]} />
                  <Legend />
                  {prob && lineBinLabel && (
                    <ReferenceLine
                      x={lineBinLabel}
                      ifOverflow="extendDomain"
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{ value: `Line ${prob.line}`, position: "top", fontSize: 12, fill: "#ef4444" }}
                    />
                  )}
                  <Bar dataKey="count" name="Frequency" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Stats + probabilities */}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
          <Card span={3} title="Samples" value={stats?.n ?? "—"} />
          <Card span={3} title="Mean" value={stats ? stats.mean.toFixed(2) : "—"} />
          <Card span={3} title="Median" value={stats ? stats.median.toFixed(2) : "—"} />
          <Card span={3} title="5th %ile" value={stats ? stats.p05.toFixed(2) : "—"} />
          <Card span={3} title="25th %ile" value={stats ? stats.p25.toFixed(2) : "—"} />
          <Card span={3} title="75th %ile" value={stats ? stats.p75.toFixed(2) : "—"} />
          <Card span={3} title="95th %ile" value={stats ? stats.p95.toFixed(2) : "—"} />

          <div style={{ gridColumn: "span 12", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Probability vs Line</div>
            {prob ? (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
                <span><b>Under</b>: {(prob.under * 100).toFixed(1)}%</span>
                <span><b>At</b>: {(prob.at * 100).toFixed(1)}%</span>
                <span><b>Over</b>: {(prob.over * 100).toFixed(1)}%</span>
              </div>
            ) : (
              <div style={{ opacity: 0.7, fontSize: 14 }}>Enter a numeric line above to see probabilities.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- UI helpers ---------- */
function MetricOptions({
  metric, setMetric,
  teamOrder, setTeamOrder,
  selectedGame,
  bins, setBins,
  line, setLine,
}: {
  metric: Metric;
  setMetric: (m: Metric) => void;
  teamOrder: 0 | 1;
  setTeamOrder: Dispatch<SetStateAction<0 | 1>>;
  selectedGame: GameData | null;
  bins: number | "auto";
  setBins: (b: number | "auto") => void;
  line: string;
  setLine: (s: string) => void;
}) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Metric & Options</h2>

      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
        {(["spread", "total", "teamLeft", "teamRight"] as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${metric === m ? "#3b82f6" : "#e2e8f0"}`,
              background: metric === m ? "#eff6ff" : "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {m === "spread" ? "Spread" : m === "total" ? "Total" : m === "teamLeft" ? "Left team total" : "Right team total"}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: 14, marginRight: 8 }}>Orientation:</span>
          <button
            disabled={!selectedGame}
            onClick={() => setTeamOrder((prev: 0 | 1) => (prev === 0 ? 1 : 0))}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: selectedGame ? "pointer" : "not-allowed",
            }}
          >
            {selectedGame
              ? teamOrder === 0
                ? `${selectedGame.teamA} vs ${selectedGame.teamB}`
                : `${selectedGame.teamB} vs ${selectedGame.teamA}`
              : "—"}
          </button>
        </div>

        <div>
          <span style={{ fontSize: 14, marginRight: 8 }}>Bins:</span>
          <select
            value={String(bins)}
            onChange={(e) => setBins(e.target.value === "auto" ? "auto" : Number(e.target.value))}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            <option value="auto">Auto</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="30">30</option>
            <option value="40">40</option>
          </select>
        </div>

        <div>
          <span style={{ fontSize: 14, marginRight: 8 }}>Line:</span>
          <input
            value={line}
            inputMode="decimal"
            placeholder={metric === "spread" ? "e.g., -6.5" : "e.g., 55.5"}
            onChange={(e) => setLine(e.target.value)}
            style={{ width: 140, padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
        Spread is calculated as <b>Right − Left</b> based on the Orientation above.
      </div>
    </section>
  );
}

function Card({ span = 3, title, value }: { span?: number; title: string; value: any }) {
  return (
    <div
      style={{
        gridColumn: `span ${span}`,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontWeight: 700 }}>{String(value)}</div>
    </div>
  );
}
