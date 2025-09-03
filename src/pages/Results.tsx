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
  import.meta.glob("../data/**/games*.csv", { as: "raw", eager: true }) // optional fallback
) as Record<string, string>;

const G_URL = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/games*.csv", { as: "url", eager: true })
) as Record<string, string>;

/* ---------- Shared helpers ---------- */
type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };
const normPath = (s: string) => s.replace(/\\/g, "/");
const weekFromPath = (p: string) =>
  normPath(p).match(/\/(week[^/]+)\//i)?.[1].toLowerCase() ??
  normPath(p).match(/\/data\/([^/]+)\//i)?.[1].toLowerCase() ??
  "root";

type BetFilter = "all" | "spread" | "total";

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
// numbers only if actually present; otherwise undefined
function pickNum(row: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === "" || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ---------- Robust kickoff parser (handles 5-Sep, Sep 5, 9/5, etc.) ---------- */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parseMonthDay(input: string): { y?: number; m: number; d: number } | null {
  const s = input.trim();
  // Remove weekday like "Fri," if present
  const noDow = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s*/i, "");

  // "Sep 05" or "September 5"
  let m = noDow.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]); const y = m[3] ? Number(m[3]) : undefined;
    if (mon && day) return { y, m: mon, d: day };
  }

  // "5-Sep" or "05-Sep-2025"
  m = noDow.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:-(\d{4}))?$/i);
  if (m) {
    const day = Number(m[1]); const mon = MONTHS[m[2].toLowerCase()]; const y = m[3] ? Number(m[3]) : undefined;
    if (mon && day) return { y, m: mon, d: day };
  }

  // "9/5" or "09/05/2025"
  m = noDow.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/i);
  if (m) {
    const mon = Number(m[1]); const day = Number(m[2]);
    const y = m[3] ? Number(m[3].length === 2 ? ("20" + m[3]) : m[3]) : undefined;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return { y, m: mon, d: day };
  }

  // ISO
  m = noDow.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };

  return null;
}

function parseTime(input: string | undefined): { h: number; min: number } | null {
  if (!input) return null;
  const s = String(input).trim();
  // "7:30 PM" / "7 PM"
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) {
    let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0; const ampm = m[3]?.toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return { h, min };
  }
  // "19:05"
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return { h: Number(m[1]), min: Number(m[2]) };
  return null;
}

function kickoffMsFrom(row: any) {
  const dateStr = pick<string>(row, ["Date", "date", "Game Date", "game_date"]);
  const timeStr = pick<string>(row, ["Time", "time", "Kick", "kick", "Kickoff", "kickoff"]);
  const dtStr   = pick<string>(row, ["Datetime", "DateTime", "datetime", "start_time", "StartTime"]);

  if (dtStr && !Number.isNaN(Date.parse(dtStr))) {
    return Date.parse(dtStr);
  }
  const md = dateStr ? parseMonthDay(String(dateStr)) : null;
  const tt = parseTime(timeStr);
  if (md) {
    const y = md.y ?? new Date().getFullYear();
    const h = tt?.h ?? 0; const min = tt?.min ?? 0;
    return new Date(y, md.m - 1, md.d, h, min).getTime();
  }
  return undefined;
}

function formatKick(ms?: number) {
  if (!Number.isFinite(ms)) return "TBD";
  const dt = new Date(ms!);
  // No weekday (per your request)
  return dt
    .toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(",", " •");
}

/* ---------- Page ---------- */
type PickRow = {
  week: string; weekNum: number;
  kickoffMs?: number;
  key: string;
  market: "spread" | "total";
  pickText: string;                // what we picked, e.g., "Team A -3.5" / "Over 51.5"
  result: "W" | "L" | "P";
  units: number;                   // +1, -1.1, or 0
};

export default function Results() {
  const weeks = useMemo(() => {
    const s = new Set<string>([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PickRow[]>([]);
  const [betFilter, setBetFilter] = useState<BetFilter>("all");
  const filteredRows = useMemo(
    () => rows.filter(r => (betFilter === "all" ? true : r.market === betFilter)),
    [rows, betFilter]
  );
  

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        // 1) Load all sims into a map by week -> GameMap
        const simsByWeek: Record<string, GameMap> = {};
        for (const w of weeks) {
          const sFiles = scoreFilesAll.filter((f) => f.week === w);
          const simArrays = await Promise.all(
            sFiles.map(
              (item) =>
                new Promise<SimRow[]>((resolve, reject) => {
                  const parse = (text: string) =>
                    Papa.parse(text, {
                      header: true, dynamicTyping: true, skipEmptyLines: true,
                      complete: (res) => {
                        try {
                          const rows = (res.data as any[])
                            .filter((r) => r && r.team != null && r.opp != null && r.pts != null && r.opp_pts != null)
                            .map((r) => ({
                              team: String(r.team), opp: String(r.opp),
                              pts: Number(r.pts), opp_pts: Number(r.opp_pts),
                            })) as SimRow[];
                          resolve(rows);
                        } catch (e) { reject(e); }
                      },
                      error: reject,
                    });
                  if (item.raw) parse(item.raw);
                  else if (item.url) fetch(item.url).then((r) => r.text()).then(parse).catch(reject);
                  else resolve([]);
                })
            )
          );

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
          simsByWeek[w] = gm;
        }

        // 2) Load all game meta (lines + date/time + actual scores)
        const allRows: PickRow[] = [];
        for (const w of weeks) {
          const gFiles = gamesFilesAll.filter((f) => f.week === w);
          const metaArrays = await Promise.all(
            gFiles.map(
              (item) =>
                new Promise<any[]>((resolve, reject) => {
                  const parse = (text: string) =>
                    Papa.parse(text, {
                      header: true, dynamicTyping: true, skipEmptyLines: true,
                      complete: (res) => resolve(res.data as any[]),
                      error: reject,
                    });
                  if (item.raw) parse(item.raw);
                  else if (item.url) fetch(item.url).then((r) => r.text()).then(parse).catch(reject);
                  else resolve([]);
                })
            )
          );

          const gm = simsByWeek[w] || {};
          for (const arr of metaArrays) {
            for (const row of arr) {
              if (!row) continue;

              const teamA_meta = String(
                pick<string>(row, ["Team A", "team_a", "teamA", "A", "Home", "home"]) ?? ""
              ).trim();
              const teamB_meta = String(
                pick<string>(row, ["Team B", "team_b", "teamB", "B", "Away", "away"]) ?? ""
              ).trim();
              if (!teamA_meta || !teamB_meta) continue;

              const key = sortedKey(teamA_meta, teamB_meta);
              const sim = gm[key];
              if (!sim) continue; // no sims -> we can't form a pick

              // Sims medians in alphabetical orientation
              const medA_alpha = median(sim.rowsA.map((r) => r.pts));
              const medB_alpha = median(sim.rowsA.map((r) => r.opp_pts));

              // If file's Team A equals sim.teamA -> keep; else flip
              let simsA = medA_alpha;
              let simsB = medB_alpha;
              if (sim.teamA !== teamA_meta) {
                simsA = medB_alpha;
                simsB = medA_alpha;
              }

              const spread = pickNum(row, ["Spread", "spread", "Line", "line"]);
              const total  = pickNum(row, ["OU", "O/U", "Total", "total"]);
              const finalA = pickNum(row, ["Team A Score Actual", "team_a_score_actual", "TeamAScoreActual"]);
              const finalB = pickNum(row, ["Team B Score Actual", "team_b_score_actual", "TeamBScoreActual"]);
              const kickoffMs = kickoffMsFrom(row);

              const hasFinals = Number.isFinite(finalA) && Number.isFinite(finalB);

              // --- Spread pick & grade ---
              if (Number.isFinite(spread)) {
                const s = spread as number; // Team A line
                // Our pick: Team A if simsA + s > simsB else Team B with opposite number
                const diff = (simsA + s) - simsB;
                const pickSpread = diff > 0
                  ? `${teamA_meta} ${s > 0 ? `+${s}` : `${s}`}`
                  : `${teamB_meta} ${(-s) > 0 ? `+${-s}` : `${-s}`}`;

                if (hasFinals) {
                  // Who covered in reality?
                  const coverDiff = (finalA! + s) - finalB!;
                  let result: "W" | "L" | "P";
                  if (Math.abs(coverDiff) < 1e-9) result = "P";
                  else if (coverDiff > 0) {
                    // Team A covered
                    result = pickSpread.startsWith(teamA_meta) ? "W" : "L";
                  } else {
                    // Team B covered
                    result = pickSpread.startsWith(teamB_meta) ? "W" : "L";
                  }
                  const units = result === "W" ? 1 : result === "L" ? -1.1 : 0;
                  allRows.push({
                    week: w, weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                    kickoffMs, key: `${key}__spread`,
                    market: "spread",
                    pickText: pickSpread,
                    result, units,
                  });
                }
              }

              // --- Total pick & grade ---
              if (Number.isFinite(total)) {
                const t = total as number;
                const predTotal = simsA + simsB;
                const pickTotal = predTotal > t ? `Over ${t}` : `Under ${t}`;

                if (hasFinals) {
                  const gameTotal = finalA! + finalB!;
                  let result: "W" | "L" | "P";
                  if (Math.abs(gameTotal - t) < 1e-9) result = "P";
                  else if (gameTotal > t) result = pickTotal.startsWith("Over") ? "W" : "L";
                  else result = pickTotal.startsWith("Under") ? "W" : "L";

                  const units = result === "W" ? 1 : result === "L" ? -1.1 : 0;
                  allRows.push({
                    week: w, weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                    kickoffMs, key: `${key}__total`,
                    market: "total",
                    pickText: pickTotal,
                    result, units,
                  });
                }
              }
            }
          }
        }

        setRows(allRows);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, [weeks]);

  /* ---------- Build cumulative series + per-week splits ---------- */
  const { unitsSeries, overall, byWeek, dividers } = useMemo(() => {
    // Sort graded picks by (weekNum asc, then kickoffMs asc, then key)
    const graded = [...filteredRows].sort((a, b) => {
      if (a.weekNum !== b.weekNum) return a.weekNum - b.weekNum;
      const ax = a.kickoffMs ?? Number.POSITIVE_INFINITY;
      const bx = b.kickoffMs ?? Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      return a.key.localeCompare(b.key);
    });
  
    const perWeek: Record<string, { W: number; L: number; P: number; units: number }> = {};
    let running = 0;
    const series: { idx: number; units: number }[] = [];
    const weekStartIdx: { idx: number; label: string }[] = [];
  
    let lastWeek = "";
    graded.forEach((p, i) => {
      if (p.week !== lastWeek) {
        weekStartIdx.push({ idx: i, label: p.week });
        lastWeek = p.week;
      }
      if (!perWeek[p.week]) perWeek[p.week] = { W: 0, L: 0, P: 0, units: 0 };
  
      if (p.result === "W") { perWeek[p.week].W += 1; running += 1; perWeek[p.week].units += 1; }
      else if (p.result === "L") { perWeek[p.week].L += 1; running -= 1.1; perWeek[p.week].units -= 1.1; }
      else { perWeek[p.week].P += 1; }
  
      series.push({ idx: i + 1, units: Number(running.toFixed(2)) });
    });
  
    const W = graded.filter(p => p.result === "W").length;
    const L = graded.filter(p => p.result === "L").length;
    const P = graded.filter(p => p.result === "P").length;
    const profit = Number((W * 1 - L * 1.1).toFixed(2));
  
    return {
      unitsSeries: series,
      overall: { W, L, P, profit },
      byWeek: perWeek,
      dividers: weekStartIdx,
    };
  }, [filteredRows]);
  

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>Results</h2>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
            {loading ? "Loading…" : `Graded picks: ${filteredRows.length}`}
            </span>

            {/* bet-type filter */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12, opacity: 0.7 }}>Show:</label>
            <select
                value={betFilter}
                onChange={(e) => setBetFilter(e.target.value as BetFilter)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            >
                <option value="all">All bets</option>
                <option value="spread">Spread</option>
                <option value="total">Total</option>
            </select>
            </div>
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><b>Record:</b> {overall.W}-{overall.L}-{overall.P}</span>
            <span><b>Profit:</b> {overall.profit.toFixed(2)}u</span>
        </div>
        </section>


      {/* Cumulative Units Chart */}
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Cumulative Units (by pick order)</div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={unitsSeries} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.35} />
              <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={["dataMin - 1", "dataMax + 1"]} />
              <Tooltip
                formatter={(v: any) => [`${v}u`, "Units"]}
                labelFormatter={(l) => `Pick #${l}`}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }}
              />
              {/* Week dividers */}
              {dividers.map((d, i) => (
                <ReferenceLine
                  key={i}
                  x={d.idx + 0.5}
                  stroke="var(--muted)"
                  strokeDasharray="3 3"
                  label={{ value: d.label, position: "top", fontSize: 11, fill: "var(--muted)" }}
                />
              ))}
              <Line type="monotone" dataKey="units" dot={false} stroke="var(--accent)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Week-by-week summary */}
      <section className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Week-by-Week</div>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(byWeek)
            .sort((a, b) => {
              const na = parseInt(a[0].replace(/[^0-9]/g, "") || "0", 10);
              const nb = parseInt(b[0].replace(/[^0-9]/g, "") || "0", 10);
              return na - nb;
            })
            .map(([wk, rec], idx, arr) => (
              <div key={wk} style={{ padding: "8px 0", borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{wk}</div>
                  <div>
                    <span style={{ marginRight: 12 }}>
                      <b>Record:</b> {rec.W}-{rec.L}-{rec.P}
                    </span>
                    <span>
                      <b>Units:</b> {rec.units.toFixed(2)}u
                    </span>
                  </div>
                </div>
              </div>
            ))}
          {!Object.keys(byWeek).length && <div style={{ opacity: 0.7 }}>No graded games yet.</div>}
        </div>
      </section>
    </div>
  );
}
