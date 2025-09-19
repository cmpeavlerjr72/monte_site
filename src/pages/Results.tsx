// src/pages/Results.tsx
import { useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { parseCsvFromItemSafe, pAllLimit } from "../utils/csv";

/* ---------- Discover sim CSVs (sims under scores/) ---------- */
const S_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV", { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "raw", eager: true })
) as Record<string, string>;
const S_URL = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV", { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "url", eager: true })
) as Record<string, string>;

/* ---------- Discover week games CSVs (date/time, lines, finals) ---------- */
const G_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/games*.csv", { as: "raw", eager: true })
) as Record<string, string>;
const G_URL = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/games*.csv", { as: "url", eager: true })
) as Record<string, string>;

/* ---------- File helpers ---------- */
type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };
const normPath = (s: string) => s.replace(/\\/g, "/");
const weekFromPath = (p: string) =>
  normPath(p).match(/\/(week[^/]+)\//i)?.[1].toLowerCase() ??
  normPath(p).match(/\/data\/([^/]+)\//i)?.[1].toLowerCase() ??
  "root";
function buildFiles(raw: Record<string, string>, urls: Record<string, string>): FileInfo[] {
  const paths = Array.from(new Set([...Object.keys(raw), ...Object.keys(urls)]));
  return paths
    .map((p) => ({
      path: p,
      week: weekFromPath(p),
      file: p.split("/").pop() || p,
      raw: raw[p],
      url: urls[p],
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
const scoreFilesAll = buildFiles(S_RAW, S_URL);
const gamesFilesAll = buildFiles(G_RAW, G_URL);

/* ---------- Sims types & helpers ---------- */
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // normalized alphabetical
type GameMap = Record<string, GameData>;
const sortedKey = (a: string, b: string) => [a, b].sort((x, y) => x.localeCompare(y)).join("__");
const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
function pick<T = any>(row: any, keys: string[]): T | undefined {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k] as T;
  return undefined;
}
function pickNum(row: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === "" || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ---------- kickoff parsing ---------- */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
function parseMonthDay(input: string): { y?: number; m: number; d: number } | null {
  const s = input.trim();
  const noDow = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s*/i, "");
  let m = noDow.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]); const y = m[3] ? Number(m[3]) : undefined;
    if (mon && day) return { y, m: mon, d: day };
  }
  m = noDow.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:-(\d{4}))?$/i);
  if (m) {
    const day = Number(m[1]); const mon = MONTHS[m[2].toLowerCase()]; const y = m[3] ? Number(m[3]) : undefined;
    if (mon && day) return { y, m: mon, d: day };
  }
  m = noDow.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/i);
  if (m) {
    const mon = Number(m[1]); const day = Number(m[2]);
    const y = m[3] ? Number(m[3].length === 2 ? ("20" + m[3]) : m[3]) : undefined;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return { y, m: mon, d: day };
  }
  m = noDow.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return null;
}
function parseTime(input: string | undefined): { h: number; min: number } | null {
  if (!input) return null;
  const s = String(input).trim();
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) {
    let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0; const ampm = m[3]?.toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return { h, min };
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return { h: Number(m[1]), min: Number(m[2]) };
  return null;
}
function kickoffMsFrom(row: any) {
  const dateStr = pick<string>(row, ["Date", "date", "Game Date", "game_date"]);
  const timeStr = pick<string>(row, ["Time", "time", "Kick", "kick", "Kickoff", "kickoff"]);
  const dtStr   = pick<string>(row, ["Datetime", "DateTime", "datetime", "start_time", "StartTime"]);
  if (dtStr && !Number.isNaN(Date.parse(dtStr))) return Date.parse(dtStr);
  const md = dateStr ? parseMonthDay(String(dateStr)) : null;
  const tt = parseTime(timeStr);
  if (md) {
    const y = md.y ?? new Date().getFullYear();
    const h = tt?.h ?? 0; const min = tt?.min ?? 0;
    return new Date(y, md.m - 1, md.d, h, min).getTime();
  }
  return undefined;
}

/* ---------- Page ---------- */
type PickRow = {
  week: string; weekNum: number;
  kickoffMs?: number;
  key: string;
  market: "spread" | "total";
  pickText: string;                // "Team A -3.5" / "Over 51.5"
  result: "W" | "L" | "P";
  units: number;                   // +1, -1.1, or 0
  confidence?: number;             // 0..1 probability of our picked side
};

export default function Results() {
  const weeks = useMemo(() => {
    const s = new Set<string>([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);

  const [selectedWeek, setSelectedWeek] = useState(weeks[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PickRow[]>([]);
  const [marketFilter, setMarketFilter] = useState<"all"|"spread"|"total">("all");
  const [confMin, setConfMin] = useState<number>(0);
  const [confMax, setConfMax] = useState<number>(100);

  useEffect(() => {
    if (!selectedWeek) { setRows([]); return; }

    const ac = new AbortController();
    let alive = true;

    async function loadOneWeek() {
      setLoading(true);
      try {
        // sims for selected week
        const sFiles = scoreFilesAll.filter((f) => f.week === selectedWeek);
        const simArrays = await pAllLimit(sFiles, 3, async (item) => {
          const data = await parseCsvFromItemSafe<any>(item, undefined, ac.signal);
          return (data as any[])
            .filter((r) => r && r.team != null && r.opp != null && r.pts != null && r.opp_pts != null)
            .map((r) => ({ team: String(r.team), opp: String(r.opp), pts: Number(r.pts), opp_pts: Number(r.opp_pts) })) as SimRow[];
        });

        const gm: GameMap = {};
        for (const arr of simArrays) {
          const byPair = new Map<string, SimRow[]>();
          for (const r of arr) {
            const key = sortedKey(r.team, r.opp);
            (byPair.get(key) || (byPair.set(key, []), byPair.get(key)!)).push(r);
          }
          for (const [pair, sims] of byPair.entries()) {
            const [A, B] = pair.split("__");
            const normalized = sims.map((r) =>
              r.team === A && r.opp === B
                ? { team: A, opp: B, pts: r.pts, opp_pts: r.opp_pts }
                : { team: A, opp: B, pts: r.opp_pts, opp_pts: r.pts }
            );
            (gm[pair] ||= { teamA: A, teamB: B, rowsA: [] }).rowsA.push(...normalized);
          }
        }

        // meta for selected week
        const gFiles = gamesFilesAll.filter((f) => f.week === selectedWeek);
        const metaArrays = await pAllLimit(gFiles, 3, (item) => parseCsvFromItemSafe<any>(item, undefined, ac.signal));

        const r: PickRow[] = [];
        for (const arr of metaArrays) {
          for (const row of arr) {
            if (!row) continue;

            const teamA_meta = String(pick<string>(row, ["Team A", "team_a", "teamA", "A", "Home", "home"]) ?? "").trim();
            const teamB_meta = String(pick<string>(row, ["Team B", "team_b", "teamB", "B", "Away", "away"]) ?? "").trim();
            if (!teamA_meta || !teamB_meta) continue;

            const key = sortedKey(teamA_meta, teamB_meta);
            const sim = gm[key];
            if (!sim) continue;

            const medA_alpha = median(sim.rowsA.map((r) => r.pts));
            const medB_alpha = median(sim.rowsA.map((r) => r.opp_pts));

            let simsA = medA_alpha;
            let simsB = medB_alpha;
            const bookAisSimsA = (sim.teamA === teamA_meta);
            if (!bookAisSimsA) { simsA = medB_alpha; simsB = medA_alpha; }

            const spread = pickNum(row, ["Spread", "spread", "Line", "line"]);
            const total  = pickNum(row, ["OU", "O/U", "Total", "total"]);
            const finalA = pickNum(row, ["Team A Score Actual", "team_a_score_actual", "TeamAScoreActual"]);
            const finalB = pickNum(row, ["Team B Score Actual", "team_b_score_actual", "TeamBScoreActual"]);
            const kickoffMs = kickoffMsFrom(row);

            // Simple grading (unchanged):
            // If simsA - simsB > spread → pick Team A; else Team B. Totals pick similar.
            if (Number.isFinite(spread)) {
              const diff = (simsA - simsB) - (spread as number); // >0 means sims like Team A -spread
              const pickedA = diff > 0;
              const pickText = pickedA ? `${teamA_meta} ${spread! >= 0 ? "-" : ""}${Math.abs(spread!).toFixed(1)}`
                                       : `${teamB_meta} ${spread! >= 0 ? "+" : ""}${Math.abs(spread!).toFixed(1)}`;
              let result: "W" | "L" | "P" = "P";
              let units = 0;
              if (Number.isFinite(finalA) && Number.isFinite(finalB)) {
                const margin = (finalA as number) - (finalB as number);
                const cover = pickedA ? (margin > spread!) : (-margin > spread!);
                const push  = margin === spread! || -margin === spread!;
                if (push) result = "P";
                else if (cover) { result = "W"; units = 1; }
                else { result = "L"; units = -1.1; }
              }
              r.push({
                week: selectedWeek, weekNum: Number(selectedWeek.replace(/\D+/g,"")) || 0,
                kickoffMs, key, market: "spread", pickText, result, units,
              });
            }

            if (Number.isFinite(total)) {
              const simTotal = simsA + simsB;
              const pickedOver = simTotal > (total as number);
              const pickText = pickedOver ? `Over ${total!.toFixed(1)}` : `Under ${total!.toFixed(1)}`;
              let result: "W" | "L" | "P" = "P";
              let units = 0;
              if (Number.isFinite(finalA) && Number.isFinite(finalB)) {
                const gameTotal = (finalA as number) + (finalB as number);
                const cover = pickedOver ? (gameTotal > total!) : (gameTotal < total!);
                const push  = gameTotal === total!;
                if (push) result = "P";
                else if (cover) { result = "W"; units = 1; }
                else { result = "L"; units = -1.1; }
              }
              r.push({
                week: selectedWeek, weekNum: Number(selectedWeek.replace(/\D+/g,"")) || 0,
                kickoffMs, key, market: "total", pickText, result, units,
              });
            }
          }
        }

        if (!alive) return;
        setRows(r.sort((a,b)=> (a.kickoffMs ?? 9e15) - (b.kickoffMs ?? 9e15)));
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadOneWeek();
    return () => { alive = false; ac.abort(); };
  }, [selectedWeek]);

  const filtered = rows.filter(r => (marketFilter==="all" || r.market===marketFilter));
  const cumSeries = useMemo(() => {
    let cum = 0;
    return filtered
      .slice()
      .sort((a,b)=> (a.kickoffMs ?? 0) - (b.kickoffMs ?? 0))
      .map((r, i) => {
        cum += r.units;
        return { i, cum, label: r.pickText, res: r.result };
      });
  }, [filtered]);

  return (
    <div key={selectedWeek} style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label>
          Week:&nbsp;
          <select
            value={selectedWeek}
            onChange={(e) => { setSelectedWeek(e.target.value); (e.target as HTMLSelectElement).blur(); }}
          >
            {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <label>
          Market:&nbsp;
          <select value={marketFilter} onChange={(e)=>setMarketFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="spread">Spread</option>
            <option value="total">Total</option>
          </select>
        </label>
        <span style={{ opacity: 0.7 }}>{loading ? "Loading…" : `${filtered.length} picks`}</span>
      </div>

      <div style={{ height: 340, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", padding: 12 }}>
        <ResponsiveContainer>
          <LineChart data={cumSeries}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="i" />
            <YAxis />
            <Tooltip />
            <ReferenceLine y={0} stroke="#888" />
            <Line type="monotone" dataKey="cum" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Kickoff</th>
              <th style={{ textAlign: "left", padding: 8 }}>Market</th>
              <th style={{ textAlign: "left", padding: 8 }}>Pick</th>
              <th style={{ textAlign: "right", padding: 8 }}>Units</th>
              <th style={{ textAlign: "center", padding: 8 }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: 8, opacity: 0.8 }}>{r.kickoffMs ? new Date(r.kickoffMs).toLocaleString() : "—"}</td>
                <td style={{ padding: 8, textTransform: "capitalize" }}>{r.market}</td>
                <td style={{ padding: 8 }}>{r.pickText}</td>
                <td style={{ padding: 8, textAlign: "right" }}>{r.units.toFixed(1)}</td>
                <td style={{ padding: 8, textAlign: "center" }}>{r.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
