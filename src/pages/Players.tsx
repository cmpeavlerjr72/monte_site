// src/pages/Players.tsx
import { useEffect, useMemo, useState } from "react";
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
import { Cell } from "recharts";
import { getTeamColors } from "../utils/teamColors";


// Shared theming helpers for Recharts + UI
const axisProps = {
    axisLine: { stroke: "var(--border)" },
    tickLine: { stroke: "var(--border)" },
    tick: { fill: "var(--text)", fontSize: 12 },
  };
  
  const tooltipProps = {
    contentStyle: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 12,
    },
    labelStyle: { color: "var(--muted)" },
    itemStyle: { color: "var(--text)" },
  };

  /** Convert win probability (0–1) to American odds */
function toAmericanOdds(p: number): string {
    if (!(p > 0 && p < 1)) return "—";            // 0% or 100% -> no finite price
    const val = p >= 0.5 ? -Math.round((100 * p) / (1 - p))
                         :  Math.round((100 * (1 - p)) / p);
    return (val > 0 ? "+" : "") + val;
  }
  function pct(x: number) { return (x * 100).toFixed(1) + "%"; }
  
  
  const listButtonStyle = (active: boolean) => ({
    textAlign: "left" as const,
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
    background: active
      ? "color-mix(in oklab, var(--brand) 10%, white)"
      : "var(--card)",
    color: "var(--text)",
    cursor: "pointer",
  });
  

/* ------------------------------------------------------------------ */
/* Robust discovery (relative paths + multiple patterns, raw preferred) */
/* ------------------------------------------------------------------ */
// RAW (best) — no network fetch needed
const RAW1 = import.meta.glob("../data/**/players/*.csv",     { as: "raw", eager: true }) as Record<string, string>;
const RAW2 = import.meta.glob("../data/**/players/*.csv.csv", { as: "raw", eager: true }) as Record<string, string>;
const RAW3 = import.meta.glob("../data/**/players/*.CSV",     { as: "raw", eager: true }) as Record<string, string>;
const RAW4 = import.meta.glob("../data/**/players/*.CSV.CSV", { as: "raw", eager: true }) as Record<string, string>;
// URL fallback (only used for paths not in RAW*)
const URL1 = import.meta.glob("../data/**/players/*.csv",     { as: "url", eager: true }) as Record<string, string>;
const URL2 = import.meta.glob("../data/**/players/*.csv.csv", { as: "url", eager: true }) as Record<string, string>;
const URL3 = import.meta.glob("../data/**/players/*.CSV",     { as: "url", eager: true }) as Record<string, string>;
const URL4 = import.meta.glob("../data/**/players/*.CSV.CSV", { as: "url", eager: true }) as Record<string, string>;

type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };

function extractWeekFromPath(p: string): string {
  // Normalize Windows slashes and find /weekX/ segment
  const s = p.replace(/\\/g, "/");
  const m1 = s.match(/\/(week[^/]+)\//i);
  if (m1) return m1[1].toLowerCase();
  // Fallback: /data/<segment>/
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

/* ------------------------- Types & helpers ------------------------- */
type Row = Record<string, any>;

interface PlayerRow {
  player: string; // or "name"
  team?: string;
  opp?: string;
  [key: string]: any;
}
interface PlayerData {
  key: string;    // player|team|opp
  player: string;
  team?: string;
  opp?: string;
  rows: PlayerRow[];
}
type PlayerMap = Record<string, PlayerData>;

// columns to ignore when scanning numeric columns
const ID_KEYS = new Set([
  "player", "name", "team", "opp", "position", "pos", "sim", "simulation", "game_id",
]);

// candidates to detect "long format" -> (metricNameCol, valueCol)
const CANDIDATE_METRIC_NAME = ["metric", "stat", "stat_name", "category"];
const CANDIDATE_VALUE_NAME  = ["value", "val", "stat_value", "amount"];

// candidates for role/type grouping (pass/rush/etc.)
const CANDIDATE_ROLE_COLS   = ["role", "player_type", "type", "stat_group", "stat_type", "play_type", "category2"];

function computeHistogram(
  values: number[],
  opts?: { bins?: number; binWidth?: number }
) {
  if (!values.length)
    return [] as { bin: string; count: number; start: number; end: number }[];
  const v = values.slice().sort((a, b) => a - b);
  const n = v.length;
  const min = v[0];
  const max = v[n - 1];
  const q1 = v[Math.floor(0.25 * (n - 1))];
  const q3 = v[Math.floor(0.75 * (n - 1))];
  const iqr = Math.max(1e-6, q3 - q1);
  const fdWidth = 2 * iqr * Math.cbrt(1 / n);

  let binWidth = opts?.binWidth || (max > min ? Math.max(fdWidth, 0.5) : 1);
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
    const s = edges[i];
    const e = edges[i + 1];
    const label = `${Number(s.toFixed(1))}–${Number(e.toFixed(1))}`;
    return { bin: label, count: c, start: s, end: e };
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

/* ------------------------------- Page ------------------------------ */
export default function Players() {
  // Discover files once, then group into weeks
  const discovered = useMemo(buildFiles, []);
  const { weeks, weekToFiles } = useMemo(() => {
    const map: Record<string, FileInfo[]> = {};
    for (const f of discovered) (map[f.week] ||= []).push(f);
    const names = Object.keys(map).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return { weeks: names, weekToFiles: map };
  }, [discovered]);

  const [selectedWeek, setSelectedWeek] = useState<string>(weeks[0] ?? "");
  const [loading, setLoading] = useState(false);

  const [players, setPlayers] = useState<PlayerMap>({});

  // shape detection
  const [isLong, setIsLong] = useState(false);
  const [metricNameCol, setMetricNameCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [roleCol, setRoleCol] = useState("");

  // UI state
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [bins, setBins] = useState<number | "auto">("auto");
  const [line, setLine] = useState<string>("");

  // selections
  const [availableMetrics, setAvailableMetrics] = useState<string[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>(""); // "" = All

  /* --------------------------- Load a week --------------------------- */
  useEffect(() => {
    if (!selectedWeek) {
      setPlayers({});
      setSelectedKey(null);
      setAvailableMetrics([]);
      setSelectedMetric("");
      setAvailableRoles([]);
      setSelectedRole("");
      setIsLong(false);
      setMetricNameCol("");
      setValueCol("");
      setRoleCol("");
      return;
    }

    async function loadWeek() {
      setLoading(true);
      try {
        const files = weekToFiles[selectedWeek] ?? [];

        // parse all files to rows[]
        const parsedArrays = await Promise.all(
          files.map(
            (item) =>
              new Promise<Row[]>((resolve, reject) => {
                const parseText = (text: string) =>
                  Papa.parse(text, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: (res) => resolve(res.data as Row[]),
                    error: reject,
                  });

                if (item.raw) {
                  parseText(item.raw);
                } else if (item.url) {
                  fetch(item.url)
                    .then((r) => r.text())
                    .then(parseText)
                    .catch(reject);
                } else {
                  reject(new Error("No raw or url available for " + item.path));
                }
              })
          )
        );

        // flatten & coerce identity
        const allRows: PlayerRow[] = [];
        for (const arr of parsedArrays) {
          for (const r of arr) {
            if (!r) continue;
            const player = String(r.player ?? r.name ?? "").trim();
            if (!player) continue;
            const team = r.team ? String(r.team) : undefined;
            const opp = r.opp ? String(r.opp) : undefined;
            allRows.push({ ...r, player, team, opp });
          }
        }

        // group by player|team|opp
        const nextPlayers: PlayerMap = {};
        for (const r of allRows) {
          const key = `${r.player}|${r.team ?? ""}|${r.opp ?? ""}`;
          if (!nextPlayers[key]) {
            nextPlayers[key] = { key, player: r.player, team: r.team, opp: r.opp, rows: [] };
          }
          nextPlayers[key].rows.push(r);
        }

        // detect long vs wide (metric-name + numeric value)
        let detectedMetricName = "";
        let detectedValueCol = "";
        const sample = allRows.slice(0, 400);
        const presentNames = new Set<string>();
        for (const r of sample) for (const k of Object.keys(r)) presentNames.add(k);

        for (const cand of CANDIDATE_METRIC_NAME) {
          if (presentNames.has(cand)) {
            const distinct = new Set(
              sample
                .map((r) => (typeof r[cand] === "string" ? (r[cand] as string) : null))
                .filter(Boolean) as string[]
            );
            if (distinct.size >= 2) {
              detectedMetricName = cand;
              break;
            }
          }
        }
        for (const cand of CANDIDATE_VALUE_NAME) {
          if (presentNames.has(cand)) {
            const numericCount = sample.reduce(
              (acc, r) => acc + (typeof r[cand] === "number" && Number.isFinite(r[cand]) ? 1 : 0),
              0
            );
            if (numericCount >= Math.min(50, Math.floor(sample.length * 0.2))) {
              detectedValueCol = cand;
              break;
            }
          }
        }
        const long = !!(detectedMetricName && detectedValueCol);

        // detect role/type col (small set of distinct strings)
        let detectedRole = "";
        for (const cand of CANDIDATE_ROLE_COLS) {
          if (cand === detectedMetricName) continue;
          if (presentNames.has(cand)) {
            const distinct = Array.from(
              new Set(
                sample
                  .map((r) => r[cand])
                  .filter((v) => typeof v === "string" && (v as string).trim().length > 0)
              )
            ) as string[];
            if (distinct.length >= 2 && distinct.length <= 12) {
              detectedRole = cand;
              break;
            }
          }
        }

        // build metric options
        let metrics: string[] = [];
        if (long) {
          const distinct = new Set<string>();
          for (const r of sample) {
            const m = r[detectedMetricName];
            if (typeof m === "string" && m.trim()) distinct.add(m);
          }
          metrics = Array.from(distinct).sort();
        } else {
          const numericCols = new Set<string>();
          for (const r of sample) {
            for (const [k, v] of Object.entries(r)) {
              if (ID_KEYS.has(k)) continue;
              if (k === detectedRole) continue;
              if (typeof v === "number" && Number.isFinite(v)) numericCols.add(k);
            }
          }
          metrics = Array.from(numericCols).sort();
        }

        // role options
        let roleOptions: string[] = [];
        if (detectedRole) {
          const distinct = new Set<string>();
          for (const r of allRows) {
            const val = r[detectedRole];
            if (typeof val === "string" && val.trim()) distinct.add(val);
          }
          roleOptions = Array.from(distinct).sort();
        }

        // commit
        setIsLong(long);
        setMetricNameCol(detectedMetricName);
        setValueCol(detectedValueCol);
        setRoleCol(detectedRole);

        setAvailableMetrics(metrics);
        setSelectedMetric(metrics[0] ?? "");

        setAvailableRoles(roleOptions);
        setSelectedRole("");

        setPlayers(nextPlayers);
        setSelectedKey(Object.keys(nextPlayers)[0] ?? null);
      } finally {
        setLoading(false);
      }
    }

    loadWeek();
  }, [selectedWeek, weekToFiles]);

  /* ----------------------- Derived view state ----------------------- */
  const filtered = useMemo(() => {
    const entries = Object.values(players);
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (p) =>
        p.player.toLowerCase().includes(q) ||
        (p.team?.toLowerCase().includes(q) ?? false) ||
        (p.opp?.toLowerCase().includes(q) ?? false)
    );
  }, [players, search]);

  const selected = selectedKey ? players[selectedKey] ?? null : null;
  const playerColor = (selected && getTeamColors(selected.team || ""))?.primary || "var(--brand)";

  const series = useMemo(() => {
    if (!selected || !selectedMetric) return [] as number[];
    const vs: number[] = [];
    if (isLong) {
      const metricCol = metricNameCol;
      const valCol = valueCol;
      for (const r of selected.rows) {
        if (selectedRole && roleCol && r[roleCol] !== selectedRole) continue;
        if (r[metricCol] === selectedMetric) {
          const v = r[valCol];
          if (typeof v === "number" && Number.isFinite(v)) vs.push(v);
        }
      }
    } else {
      for (const r of selected.rows) {
        if (selectedRole && roleCol && r[roleCol] !== selectedRole) continue;
        const v = r[selectedMetric];
        if (typeof v === "number" && Number.isFinite(v)) vs.push(v);
      }
    }
    return vs;
  }, [selected, selectedMetric, isLong, metricNameCol, valueCol, selectedRole, roleCol]);

  const hist = useMemo(() => {
    if (!series.length) return [];
    const opts: any = {};
    if (bins !== "auto") opts.bins = Math.max(1, Number(bins));
    return computeHistogram(series, opts);
  }, [series, bins]);

  const stats = useMemo(() => summaryStats(series), [series]);

  const prob = useMemo(() => {
    if (!series.length) return null as null | { lt: number; eq: number; gt: number; line: number };
    const L = Number(line);
    if (!Number.isFinite(L)) return null;
    const n = series.length;
    let lt = 0, eq = 0, gt = 0;
    for (const x of series) {
      if (Math.abs(x - L) < 1e-9) eq++;
      else if (x < L) lt++;
      else gt++;
    }
    return { lt: lt / n, eq: eq / n, gt: gt / n, line: L };
  }, [series, line]);

  const odds = useMemo(() => {
    if (!prob) return null as null | {
      under: string; over: string; underNoPush: string; overNoPush: string;
      uNP: number; oNP: number;
    };
    // raw (includes push in the denominator)
    const underOdds = toAmericanOdds(prob.lt);
    const overOdds  = toAmericanOdds(prob.gt);
  
    // “win only” (exclude pushes from the denominator)
    const denom = prob.lt + prob.gt;
    const uNP = denom > 0 ? prob.lt / denom : 0;
    const oNP = denom > 0 ? prob.gt / denom : 0;
    const underNoPush = toAmericanOdds(uNP);
    const overNoPush  = toAmericanOdds(oNP);
  
    return { under: underOdds, over: overOdds, underNoPush, overNoPush, uNP, oNP };
  }, [prob]);
  

  /* ------------------------------- UI ------------------------------- */
  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "1fr", maxWidth: 1200, margin: "0 auto" }}>
      {/* Week selector */}
      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Week</h2>
        {weeks.length === 0 ? (
          <div style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>
            Put player CSVs under <code>src/data/week#/players/</code>
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {loading ? "Loading…" : `${Object.keys(players).length} players loaded`}
            </span>
            {/* Tiny debug to confirm discovery */}
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              • discovered {(weekToFiles[selectedWeek]?.length ?? 0)} files
            </span>
          </div>
        )}
      </section>

      {/* Find a player */}
      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Find a player</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search (name, team, opponent)"
          style={{ marginTop: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <div style={{ marginTop: 12, maxHeight: 260, overflow: "auto", display: "grid", gap: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 14, opacity: 0.7 }}>{loading ? "Loading…" : "No matches."}</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.key}
                onClick={() => setSelectedKey(p.key)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${selectedKey === p.key ? "#3b82f6" : "#e2e8f0"}`,
                  background: selectedKey === p.key ? "#eff6ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.player}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {(p.team ?? "—")} vs {(p.opp ?? "—")} — {p.rows.length} sims
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Metric & options */}
      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Metric & Options</h2>

        <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 14, marginRight: 8 }}>Metric:</span>
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
            >
              {availableMetrics.length === 0 ? (
                <option value="">(no metrics detected)</option>
              ) : (
                availableMetrics.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              )}
            </select>
          </div>

          {availableRoles.length > 1 && (
            <div>
              <span style={{ fontSize: 14, marginRight: 8 }}>Role:</span>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
              >
                <option value="">All</option>
                {availableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

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
              placeholder="e.g., 249.5"
              onChange={(e) => setLine(e.target.value)}
              style={{ width: 120, padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </div>
        </div>

        {/* helpful debug about auto-detected shape */}
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
          Shape: {isLong ? "long" : "wide"}
          {isLong && ` (metric: ${metricNameCol || "?"} | value: ${valueCol || "?"})`}
          {availableRoles.length > 1 && ` — role: ${roleCol || "?"}`}
        </div>
      </section>

      {/* Chart + stats */}
      <section style={{ display: "grid", gap: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, minHeight: 420 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Histogram</div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {selected ? `${selected.player} — ${selectedMetric || "Select metric"}` : "Select a player"}
            </h3>
            {selected && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {(selected.team ?? "—")} vs {(selected.opp ?? "—")}
                {selectedRole ? ` — ${selectedRole}` : ""}
              </div>
            )}
          </div>

          {!selected || !selectedMetric || !hist.length ? (
            <div style={{ height: 340, display: "grid", placeItems: "center", opacity: 0.6 }}>
              {loading ? "Loading…" : "Pick a player + metric to see the chart."}
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
                  {prob && (
                    <ReferenceLine
                      x={`${prob.line}`}
                      ifOverflow="extendDomain"
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{ value: `Line ${prob.line}`, position: "top", fontSize: 12, fill: "#ef4444" }}
                    />
                  )}
                  <Bar dataKey="count" name="Frequency">
                    {hist.map((_,i) => (
                        <Cell key={i} fill={playerColor} />
                    ))}
                    </Bar>
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

          <div
            style={{
              gridColumn: "span 12",
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Probability vs Line</div>
            {prob ? (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
                <span>
                  <b>Under</b>: {(prob.lt * 100).toFixed(1)}%
                  {odds ? <> ({odds.under})</> : null}
                </span>
                <span>
                  <b>Push</b>: {(prob.eq * 100).toFixed(1)}%
                </span>
                <span>
                  <b>Over</b>: {(prob.gt * 100).toFixed(1)}%
                  {odds ? <> ({odds.over})</> : null}
                </span>
              </div>
            ) : (
              <div style={{ opacity: 0.7, fontSize: 14 }}>Enter a numeric line to see probabilities.</div>
            )}
          </div>
        </div>
      </section>
    </div>
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
