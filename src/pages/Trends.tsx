// src/pages/Trends.tsx
import { useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  Tooltip,
  YAxis,
  CartesianGrid,
} from "recharts";

/* ---------- Discover sim CSVs (sims under scores/) ---------- */
const S_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv",     { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV",     { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "raw", eager: true })
) as Record<string, string>;

const S_URL = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv",     { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV",     { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "url", eager: true })
) as Record<string, string>;

/* ---------- Discover week games CSVs (date/time, lines, finals, ML) ---------- */
const G_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/games*.csv",       { as: "raw", eager: true }) // optional fallback
) as Record<string, string>;

const G_URL = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/games*.csv",       { as: "url", eager: true })
) as Record<string, string>;

/* ---------- Load team & conference dictionary from assets ---------- */
const TEAM_INFO_RAW = import.meta.glob("../assets/team_info.csv", { as: "raw", eager: true }) as Record<string, string>;
const teamInfoCsvText = Object.values(TEAM_INFO_RAW)[0] || "";

/* ---------- Format helpers ---------- */
const fmt1 = (n: number) => Number(n).toFixed(1);
const fmt2 = (n: number) => Number(n).toFixed(2);
const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`;

// function prettyScope(cf: TrendSlice["confFilter"]) {
//     if (cf === "all") return "All Games";
//     if (cf === "non-conference") return "Non-Conf";
//     return cf.toUpperCase(); // or return as-is if you prefer exact names
// }

function InfoPanel() {
    const card: React.CSSProperties = {
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: 14,
      background: "var(--card, #fff)",
      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    };
    const h: React.CSSProperties = { margin: 0, fontWeight: 800, fontSize: 16 };
    const sub: React.CSSProperties = { color: "var(--muted)", fontSize: 13, marginTop: 6, lineHeight: 1.45 };
    const dlGrid: React.CSSProperties = {
      display: "grid",
      gap: 10,
      gridTemplateColumns: "minmax(180px, 1fr) 2fr",
      alignItems: "start",
      marginTop: 12,
    };
    const dt: React.CSSProperties = { color: "var(--muted)", fontSize: 12 };
    const dd: React.CSSProperties = { fontSize: 13, lineHeight: 1.45 };
  
    return (
      <details style={card}>
        <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center",
              background: "var(--accent, #0b63f6)", color: "#fff", fontSize: 12, fontWeight: 800,
            }}
          >
            i
          </span>
          <span style={{ fontWeight: 800 }}>What am I looking at?</span>
        </summary>
  
        <div style={{ marginTop: 12 }}>
          <h3 style={h}>Tiles & pills</h3>
          <p style={sub}>
            Each card is a <b>trend slice</b> (a filtered basket of your graded bets) built from:
            Market (spread/total/ml) • Pick type (favorite/underdog/over/under) •
            Confidence band • <b>Game Type</b> (Conference or Non-Conf) • <b>Conference</b> (SEC, Big Ten, …).
            We only evaluate <b>Positive-EV</b> bets and confidence bands in 10% steps (53–60, 60–70, …, 90–101).
          </p>
  
          <div style={dlGrid}>
            <div style={dt}>Band pill</div>
            <div style={dd}>Shows the confidence band (e.g., <em>60–70% conf</em>).</div>
  
            <div style={dt}>Game Type pill</div>
            <div style={dd}>
              <em>Conference</em> = both teams same conference. <em>Non-Conf</em> = teams from different conferences.
            </div>
  
            <div style={dt}>Conference pill</div>
            <div style={dd}>
              The conference you’re filtering by: in <em>Conference</em> mode both teams are in it; in <em>Non-Conf</em> mode
              at least one team is in it.
            </div>
  
            <div style={dt}>Sparkline</div>
            <div style={dd}>Cumulative units over time for that slice (wins up, losses down).</div>
          </div>
  
          <h3 style={{ ...h, marginTop: 14 }}>Stats</h3>
            <div style={dlGrid}>
            <div style={dt}>Bets / Weeks</div>
            <div style={dd}>
                <b>What:</b> How many graded picks and how many distinct weeks are in this slice.<br />
                <b>Why:</b> Larger samples are more reliable; tiny slices may look good by chance.<br />
                <b>Ideal:</b> Higher is better (more bets and more weeks).
            </div>

            <div style={dt}>Profit (u)</div>
            <div style={dd}>
                <b>What:</b> Net units won in this slice.<br />
                <b>Why:</b> The most direct measure of profitability.<br />
                <b>Ideal:</b> Higher is better (positive profit).
            </div>

            <div style={dt}>RoR (Return on Risk)</div>
            <div style={dd}>
                <b>What:</b> Profit ÷ total units risked.<br />
                <b>Why:</b> Shows efficiency of risk use (like ROI).<br />
                <b>Ideal:</b> Higher is better; positive means profitable, negative means losing.
            </div>

            <div style={dt}>Win%</div>
            <div style={dd}>
                <b>What:</b> Wins ÷ (Wins + Losses). Pushes ignored.<br />
                <b>Why:</b> Intuitive performance measure, but doesn’t account for odds.<br />
                <b>Ideal:</b> Higher is better. For spread/total bets at -110, you need &gt;52.38% to profit.
            </div>

            <div style={dt}>Consistency</div>
            <div style={dd}>
                <b>What:</b> % of weeks with ≥ 0 units profit.<br />
                <b>Why:</b> Indicates steadiness over time; reduces risk of “one hot week.”<br />
                <b>Ideal:</b> Higher is better. 100% means the slice was profitable every week.
            </div>

            <div style={dt}>Sharpe-ish</div>
            <div style={dd}>
                <b>What:</b> Mean units per bet ÷ stdev(units) × √N.<br />
                <b>Why:</b> Risk-adjusted return proxy. Rewards higher average profit but penalizes volatility.<br />
                <b>Ideal:</b> Higher is better. Values &gt;1 are considered strong, &gt;2 excellent.
            </div>

            <div style={dt}>Max DD (u)</div>
            <div style={dd}>
                <b>What:</b> Maximum drawdown — worst peak-to-trough downswing in cumulative units.<br />
                <b>Why:</b> Captures the “pain” of the worst losing streak. Important for bankroll management.<br />
                <b>Ideal:</b> Lower is better. A large drawdown means higher risk even if profit is positive.
            </div>

            <div style={dt}>CI Edge vs 52.38%</div>
            <div style={dd}>
                <b>What:</b> For spreads/totals only: Wilson lower-bound win% minus the -110 break-even (52.38%).<br />
                <b>Why:</b> Adds statistical confidence: asks “if this slice repeated forever, what’s the safe lower bound of win%?”<br />
                <b>Ideal:</b> Higher is better. Positive values mean the slice is statistically likely to beat break-even, not just lucky.
            </div>
            </div>

  
          <h3 style={{ ...h, marginTop: 14 }}>TrendScore</h3>
          <p style={sub}>
            Composite rank balancing <b>Overall</b> profit/bet, <b>Recent</b> momentum (EWMA of weekly profit), and <b>Stability</b> (Sharpe-ish),
            plus a bonus for CI Edge and Consistency, minus a penalty for Max Drawdown. Small samples are shrunk by
            <code> √(N / (N + k))</code>.
          </p>
  
          <pre
            style={{
              background: "var(--mutedBg, #f6f7f9)", padding: 10, borderRadius: 10, overflowX: "auto",
              border: "1px solid var(--border)", fontSize: 12, marginTop: 8,
            }}
          >{`TrendScore = (
    0.45*z(overall) + 0.35*z(recent) + 0.20*z(stability)
    + 2.0*CI_Edge
  ) * sizeMult  +  consistencyBoost  -  0.1*MaxDD`}</pre>
  
          {/* <div style={{ ...sub, marginTop: 10 }}>
            Guardrails: slices must have a minimal sample (currently <em>≥12 bets and ≥3 weeks</em>), and the size multiplier
            down-weights tiny samples. You can tune both later.
          </div> */}
        </div>
      </details>
    );
}
  

/* ---------- Shared helpers (mirrors Results.tsx minimal set) ---------- */
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

const isSafari =
  typeof navigator !== "undefined" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

async function parseCsvFromItemSafe<T = any>(
  item: { url?: string; raw?: string },
  signal?: AbortSignal
): Promise<T[]> {
  let text = "";
  if (item?.url) {
    const abs = new URL(item.url, window.location.href).toString();
    const res = await fetch(abs, { signal });
    text = await res.text();
  } else if (item?.raw) {
    text = item.raw;
  } else {
    return [];
  }

  return new Promise<T[]>((resolve, reject) => {
    Papa.parse<T>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      download: false,
      worker: !isSafari,
      complete: (res) => resolve(res.data as T[]),
      error: reject,
    } as Papa.ParseConfig<T>);
  });
}

async function pAllLimit<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let i = 0;
  const runners = Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        results[idx] = await fn(items[idx], idx);
      }
    });
  await Promise.all(runners);
  return results;
}

interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; }
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

/* ---------- Robust kickoff parser (same as Results) ---------- */
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

const SPREAD_TOTAL_POS_EV_THRESHOLD = 0.525;
function impliedProbFromAmerican(odds: number): number {
  if (odds < 0) { const a = Math.abs(odds); return a / (a + 100); }
  const b = Math.abs(odds);
  return 100 / (b + 100);
}

/* ---------- Types (same shape as Results' PickRow) ---------- */
type PickRow = {
  week: string; weekNum: number;
  kickoffMs?: number;
  key: string;
  market: "spread" | "total" | "ml";
  pickText: string;
  result?: "W" | "L" | "P";
  units: number;
  confidence?: number;
  isOverPick?: boolean;
  isUnderPick?: boolean;
  isFavoritePick?: boolean;
  isUnderdogPick?: boolean;
  isPositiveEV?: boolean;
  stakeRisk?: number;
  teamA: string; teamB: string;
  confA?: string; confB?: string;
};

/* ---------- Build team -> conf map from team_info.csv ---------- */
function buildTeamConfMap() {
  if (!teamInfoCsvText) return { teamToConf: {}, teams: [] as string[], confs: [] as string[] };
  const parsed = Papa.parse<Record<string, any>>(teamInfoCsvText, {
    header: true, dynamicTyping: false, skipEmptyLines: true,
  });
  const t2c: Record<string, string> = {};
  const teamSet = new Set<string>();
  const confSet = new Set<string>();
  const teamKeys = ["team", "Team", "school", "School", "name", "Name"];
  const confKeys = ["conference", "Conference", "conf", "Conf"];
  for (const r of parsed.data || []) {
    if (!r) continue;
    const team = pick<string>(r, teamKeys)?.trim();
    const conf = pick<string>(r, confKeys)?.trim();
    if (!team) continue;
    teamSet.add(team);
    if (conf) {
      confSet.add(conf);
      t2c[team.toLowerCase()] = conf;
      t2c[team.replace(/\s+/g, "").toLowerCase()] = conf;
    }
    const alias = (r["short_name"] ?? r["Short Name"] ?? r["alias"] ?? r["Alias"])?.toString().trim();
    if (alias && conf) {
      teamSet.add(alias);
      t2c[alias.toLowerCase()] = conf;
      t2c[alias.replace(/\s+/g, "").toLowerCase()] = conf;
    }
  }
  return { teamToConf: t2c, teams: Array.from(teamSet), confs: Array.from(confSet) };
}
const { teamToConf, confs: CONF_LIST } = buildTeamConfMap();
const confOf = (team: string | undefined) => {
  if (!team) return undefined;
  const k1 = team.toLowerCase();
  const k2 = team.replace(/\s+/g, "").toLowerCase();
  return teamToConf[k1] ?? teamToConf[k2] ?? undefined;
};

/* ---------- Load & grade (mirrors Results.tsx, unfiltered) ---------- */
function useGradedRows(): {
    loading: boolean;
    rows: PickRow[];
    pending: PickRow[];
    weeksAvailable: number[];
  } {
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<PickRow[]>([]);
    const [pending, setPending] = useState<PickRow[]>([]);
    const [weeksAvailable, setWeeksAvailable] = useState<number[]>([]);
  
    useEffect(() => {
      const ac = new AbortController();
      let alive = true;
  
      async function loadAll() {
        setLoading(true);
        try {
          // ---- Weeks present from files (not from graded rows) ----
          const weekNames = Array.from(
            new Set([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week))
          );
          const weekNums = weekNames
            .map((w) => parseInt(String(w).replace(/[^0-9]/g, ""), 10))
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b);
          if (alive) setWeeksAvailable(weekNums);
  
          // ---- Sims by week ----
          const simsByWeek: Record<string, GameMap> = {};
          for (const w of weekNames.sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
          )) {
            const sFiles = scoreFilesAll.filter((f) => f.week === w);
            const simArrays = await pAllLimit(sFiles, isSafari ? 2 : 4, async (item) => {
              const data = await parseCsvFromItemSafe<any>(item, ac.signal);
              return (data as any[])
                .filter(
                  (r) =>
                    r &&
                    r.team != null &&
                    r.opp != null &&
                    r.pts != null &&
                    r.opp_pts != null
                )
                .map((r) => ({
                  team: String(r.team),
                  opp: String(r.opp),
                  pts: Number(r.pts),
                  opp_pts: Number(r.opp_pts),
                })) as SimRow[];
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
                (gm[pair] ||= { teamA: A, teamB: B, rowsA: [] }).rowsA.push(
                  ...normalized
                );
              }
            }
            simsByWeek[w] = gm;
          }
  
          // ---- Meta + grading ----
          const allRows: PickRow[] = [];
          const pendingRows: PickRow[] = []; // NEW: collect upcoming candidates
  
          for (const w of Object.keys(simsByWeek)) {
            const gFiles = gamesFilesAll.filter((f) => f.week === w);
            const metaArrays = await pAllLimit(
              gFiles,
              isSafari ? 2 : 4,
              (item) => parseCsvFromItemSafe<any>(item, ac.signal)
            );
  
            const gm = simsByWeek[w] || {};
            for (const arr of metaArrays) {
              for (const row of arr as any[]) {
                if (!row) continue;
  
                const teamA_meta = String(
                  pick<string>(row, ["Team A", "team_a", "teamA", "A", "Home", "home"]) ??
                    ""
                ).trim();
                const teamB_meta = String(
                  pick<string>(row, ["Team B", "team_b", "teamB", "B", "Away", "away"]) ??
                    ""
                ).trim();
                if (!teamA_meta || !teamB_meta) continue;
  
                let confA =
                  (String(
                    pick<string>(row, [
                      "Team A Conf",
                      "team_a_conf",
                      "confA",
                      "ConfA",
                      "A Conf",
                      "home_conf",
                      "Home Conf",
                      "HomeConf",
                      "Team A Conference",
                      "team_a_conference",
                    ]) ?? ""
                  ).trim() as string) || undefined;
                let confB =
                  (String(
                    pick<string>(row, [
                      "Team B Conf",
                      "team_b_conf",
                      "confB",
                      "ConfB",
                      "B Conf",
                      "away_conf",
                      "Away Conf",
                      "AwayConf",
                      "Team B Conference",
                      "team_b_conference",
                    ]) ?? ""
                  ).trim() as string) || undefined;
  
                if (!confA) confA = confOf(teamA_meta);
                if (!confB) confB = confOf(teamB_meta);
  
                const key = sortedKey(teamA_meta, teamB_meta);
                const sim = gm[key];
                if (!sim) continue;
  
                const medA_alpha = median(sim.rowsA.map((r) => r.pts));
                const medB_alpha = median(sim.rowsA.map((r) => r.opp_pts));
                let simsA = medA_alpha,
                  simsB = medB_alpha;
                const bookAisSimsA = sim.teamA === teamA_meta;
                if (!bookAisSimsA) {
                  simsA = medB_alpha;
                  simsB = medA_alpha;
                }
  
                const spread = pickNum(row, ["Spread", "spread", "Line", "line"]);
                const total = pickNum(row, ["OU", "O/U", "Total", "total"]);
                const finalA = pickNum(row, [
                  "Team A Score Actual",
                  "team_a_score_actual",
                  "TeamAScoreActual",
                ]);
                const finalB = pickNum(row, [
                  "Team B Score Actual",
                  "team_b_score_actual",
                  "TeamBScoreActual",
                ]);
                const kickoffMs = kickoffMsFrom(row);
                const mlA = pickNum(row, [
                  "TeamAML",
                  "team_a_ml",
                  "TeamA_ML",
                  "teamAML",
                ]);
                const mlB = pickNum(row, [
                  "TeamBML",
                  "team_b_ml",
                  "TeamB_ML",
                  "teamBML",
                ]);
                const hasFinals = Number.isFinite(finalA) && Number.isFinite(finalB);
  
                // ---- Spread ----
                if (Number.isFinite(spread)) {
                  const s = spread as number;
                  const AvalsBook = bookAisSimsA
                    ? sim.rowsA.map((r) => r.pts)
                    : sim.rowsA.map((r) => r.opp_pts);
                  const BvalsBook = bookAisSimsA
                    ? sim.rowsA.map((r) => r.opp_pts)
                    : sim.rowsA.map((r) => r.pts);
                  let coverA = 0;
                  const nPairs = Math.min(AvalsBook.length, BvalsBook.length);
                  for (let i = 0; i < nPairs; i++)
                    if (AvalsBook[i] + s > BvalsBook[i]) coverA++;
                  const pA = nPairs ? coverA / nPairs : undefined;
                  const diff = simsA + s - simsB;
                  const pickSpread =
                    diff > 0
                      ? `${teamA_meta} ${s > 0 ? `+${s}` : `${s}`}`
                      : `${teamB_meta} ${-s > 0 ? `+${-s}` : `${-s}`}`;
                  const confidence =
                    typeof pA === "number" ? (diff > 0 ? pA : 1 - pA) : undefined;
                  const favoriteSide: "A" | "B" | null = s < 0 ? "A" : s > 0 ? "B" : null;
                  const pickedSide: "A" | "B" = diff > 0 ? "A" : "B";
                  const isFavoritePick = !!favoriteSide && pickedSide === favoriteSide;
                  const isUnderdogPick = !!favoriteSide && pickedSide !== favoriteSide;
                  const isPositiveEV =
                    typeof confidence === "number" &&
                    confidence > SPREAD_TOTAL_POS_EV_THRESHOLD;
  
                  if (hasFinals) {
                    const fA = finalA as number;
                    const fB = finalB as number;
                    const coverDiff = fA + s - fB;
                    let result: "W" | "L" | "P";
                    if (Math.abs(coverDiff) < 1e-9) result = "P";
                    else if (coverDiff > 0)
                      result = pickSpread.startsWith(teamA_meta) ? "W" : "L";
                    else result = pickSpread.startsWith(teamB_meta) ? "W" : "L";
                    const units = result === "W" ? 1 : result === "L" ? -1.1 : 0;
                    const stakeRisk = result === "P" ? 0 : 1.1;
  
                    allRows.push({
                      week: w,
                      weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                      kickoffMs,
                      key: `${key}__spread`,
                      market: "spread",
                      pickText: pickSpread,
                      result,
                      units,
                      stakeRisk,
                      confidence,
                      isFavoritePick,
                      isUnderdogPick,
                      isPositiveEV,
                      teamA: teamA_meta,
                      teamB: teamB_meta,
                      confA,
                      confB,
                    });
                  } else {
                    const stakeRisk = 1.1; // -110 assumption
                    pendingRows.push({
                      week: w,
                      weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                      kickoffMs,
                      key: `${key}__spread`,
                      market: "spread",
                      pickText: pickSpread,
                      // result omitted for upcoming
                      units: 0,
                      stakeRisk,
                      confidence,
                      isFavoritePick,
                      isUnderdogPick,
                      isPositiveEV,
                      teamA: teamA_meta,
                      teamB: teamB_meta,
                      confA,
                      confB,
                    });
                  }
                }
  
                // ---- Total ----
                if (Number.isFinite(total)) {
                  const t = total as number;
                  const predTotal = simsA + simsB;
                  const pickTotal = predTotal > t ? `Over ${t}` : `Under ${t}`;
                  const totals = sim.rowsA.map((r) => r.pts + r.opp_pts);
                  let overCount = 0;
                  for (const x of totals) if (x > t) overCount++;
                  const pOver = totals.length ? overCount / totals.length : undefined;
                  const confidence =
                    typeof pOver === "number"
                      ? pickTotal.startsWith("Over")
                        ? pOver
                        : 1 - pOver
                      : undefined;
                  const isOverPick = pickTotal.startsWith("Over");
                  const isUnderPick = !isOverPick;
                  const isPositiveEV =
                    typeof confidence === "number" &&
                    confidence > SPREAD_TOTAL_POS_EV_THRESHOLD;
  
                  if (hasFinals) {
                    const fA = finalA as number;
                    const fB = finalB as number;
                    let result: "W" | "L" | "P";
                    if (Math.abs(fA + fB - t) < 1e-9) result = "P";
                    else if (fA + fB > t) result = isOverPick ? "W" : "L";
                    else result = isUnderPick ? "W" : "L";
                    const units = result === "W" ? 1 : result === "L" ? -1.1 : 0;
                    const stakeRisk = result === "P" ? 0 : 1.1;
  
                    allRows.push({
                      week: w,
                      weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                      kickoffMs,
                      key: `${key}__total`,
                      market: "total",
                      pickText: pickTotal,
                      result,
                      units,
                      stakeRisk,
                      confidence,
                      isOverPick,
                      isUnderPick,
                      isPositiveEV,
                      teamA: teamA_meta,
                      teamB: teamB_meta,
                      confA,
                      confB,
                    });
                  } else {
                    const stakeRisk = 1.1; // -110 assumption
                    pendingRows.push({
                      week: w,
                      weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                      kickoffMs,
                      key: `${key}__total`,
                      market: "total",
                      pickText: pickTotal,
                      units: 0,
                      stakeRisk,
                      confidence,
                      isOverPick,
                      isUnderPick,
                      isPositiveEV,
                      teamA: teamA_meta,
                      teamB: teamB_meta,
                      confA,
                      confB,
                    });
                  }
                }
  
                // ---- Moneyline ----
                if (Number.isFinite(mlA) && Number.isFinite(mlB)) {
                  const AvalsBook = bookAisSimsA
                    ? sim.rowsA.map((r) => r.pts)
                    : sim.rowsA.map((r) => r.opp_pts);
                  const BvalsBook = bookAisSimsA
                    ? sim.rowsA.map((r) => r.opp_pts)
                    : sim.rowsA.map((r) => r.pts);
                  let aWins = 0;
                  const nPairs = Math.min(AvalsBook.length, BvalsBook.length);
                  for (let i = 0; i < nPairs; i++)
                    if (AvalsBook[i] > BvalsBook[i]) aWins++;
                  const pA = nPairs ? aWins / nPairs : 0.5;
                  const pB = 1 - pA;
                  const pickA = pA >= pB;
                  const pickTeam = pickA ? teamA_meta : teamB_meta;
                  const pickOdds = pickA ? (mlA as number) : (mlB as number);
                  const confidence = pickA ? pA : pB;
                  const implied = impliedProbFromAmerican(pickOdds);
                  const isPositiveEV = confidence > implied;
                  const isFav = pickOdds < 0;
                  const stakeRisk = isFav ? Math.abs(pickOdds) / 100 : 1;
                  const winPayout = isFav ? 1 : pickOdds / 100;
                  const isFavoritePick = isFav;
                  const isUnderdogPick = !isFav;
                  const pickText = `${pickTeam} ML ${
                    pickOdds > 0 ? `+${pickOdds}` : `${pickOdds}`
                  }`;
  
                  if (hasFinals) {
                    const fA = finalA as number;
                    const fB = finalB as number;
                    const pickedWon = pickA ? fA > fB : fB > fA;
                    const result: "W" | "L" = pickedWon ? "W" : "L";
                    const units = pickedWon ? winPayout : -stakeRisk;
  
                    allRows.push({
                      week: w,
                      weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                      kickoffMs,
                      key: `${key}__ml`,
                      market: "ml",
                      pickText,
                      result,
                      units,
                      stakeRisk,
                      confidence,
                      isFavoritePick,
                      isUnderdogPick,
                      isPositiveEV,
                      teamA: teamA_meta,
                      teamB: teamB_meta,
                      confA,
                      confB,
                    });
                  } else {
                    // Pending ML candidate
                    pendingRows.push({
                      week: w,
                      weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                      kickoffMs,
                      key: `${key}__ml`,
                      market: "ml",
                      pickText,
                      units: 0,
                      stakeRisk,
                      confidence,
                      isFavoritePick,
                      isUnderdogPick,
                      isPositiveEV,
                      teamA: teamA_meta,
                      teamB: teamB_meta,
                      confA,
                      confB,
                    });
                  }
                }
              }
            }
          }
  
          if (!alive) return;
          setRows(allRows);
          setPending(pendingRows);
        } finally {
          if (alive) setLoading(false);
        }
      }
  
      loadAll();
      return () => {
        alive = false;
        ac.abort();
      };
    }, []);
  
    return { loading, rows, pending, weeksAvailable };
  }
  

/* ---------- Trend mining (works directly on PickRow[]) ---------- */
type Market = "spread" | "total" | "ml";
type PickType = "favorite" | "underdog" | "over" | "under" | "all";
type GameClass = "all" | "conference" | "non-conference";

// REPLACE your TrendSlice with this
type TrendSlice = {
    market: "spread" | "total" | "ml" | "all";
    pickType: "favorite" | "underdog" | "over" | "under" | "all";
    confBand: [number, number];                 // % inclusive lower, exclusive upper (except last)
    gameType: "conference" | "nonconference";   // no "all" any more
    conference: string;                 // "all" or a specific conf name
};
  
  
  
  

type TrendMetrics = {
  nBets: number;
  nWeeks: number;
  profitUnits: number;
  riskSum: number;
  ror: number;
  winPct: number;
  consistency: number;
  maxDrawdown: number;
  ewmaProfit: number;
  sharpeish: number;
  wilsonLowerVsBreakeven: number; // spread/total only
  timeline: { idx: number; cumUnits: number }[];
};

type TrendScored = {
  id: string;
  label: string;
  slice: TrendSlice;
  metrics: TrendMetrics;
  score: number;
};

const BREAK_EVEN_SPREAD_TOTAL = 0.5238095238; // -110
const HALF_LIFE_WEEKS = 2;

function zscores(values: number[]): number[] {
  const arr = values.filter((v) => Number.isFinite(v));
  const mean = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  const sd = Math.sqrt(
    arr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, arr.length - 1)
  );
  return values.map((v) => (sd > 0 ? (v - mean) / sd : 0));
}
function wilsonLowerBound(successes: number, trials: number, z = 1.96) {
  if (trials === 0) return 0;
  const phat = successes / trials;
  const denom = 1 + (z * z) / trials;
  const centre = phat + (z * z) / (2 * trials);
  const margin =
    (z * Math.sqrt((phat * (1 - phat)) / trials + (z * z) / (4 * trials ** 2))) /
    denom;
  return centre / denom - margin;
}
function ewmaWeeklyProfit(points: { weekIdx: number; profit: number }[]) {
  if (points.length === 0) return 0;
  const lambda = Math.pow(0.5, 1 / HALF_LIFE_WEEKS);
  const sorted = [...points].sort((a, b) => a.weekIdx - b.weekIdx);
  let ewma = 0;
  for (const p of sorted) ewma = lambda * ewma + (1 - lambda) * p.profit;
  return ewma;
}
function maxDrawdown(series: number[]) {
  let peak = -Infinity;
  let mdd = 0;
  for (const x of series) {
    if (x > peak) peak = x;
    const dd = peak - x;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}
function isConferenceGame(r: PickRow): boolean {
  const a = (r.confA ?? confOf(r.teamA))?.toLowerCase();
  const b = (r.confB ?? confOf(r.teamB))?.toLowerCase();
  return !!a && !!b && a === b;
}

function gameConference(r: PickRow): string | null {
    const a = (r.confA ?? confOf(r.teamA))?.toLowerCase();
    const b = (r.confB ?? confOf(r.teamB))?.toLowerCase();
    if (!a || !b) return null;
    return a === b ? a : null; // same-conf game -> that conference, else null
}
  
// REPLACE rowsForSlice with:
function rowsForSlice(rows: PickRow[], s: TrendSlice): PickRow[] {
    return rows.filter((r) => {
      if (!r.isPositiveEV) return false;
      if (s.market !== "all" && r.market !== s.market) return false;
  
      if (typeof r.confidence !== "number") return false;
      const pc = r.confidence * 100;
      if (pc < s.confBand[0] || pc >= s.confBand[1]) return false;
  
      switch (s.pickType) {
        case "all": break;
        case "over":      if (!(r.market === "total" && r.isOverPick)) return false; break;
        case "under":     if (!(r.market === "total" && r.isUnderPick)) return false; break;
        case "favorite":  if (!((r.market === "spread" || r.market === "ml") && r.isFavoritePick)) return false; break;
        case "underdog":  if (!((r.market === "spread" || r.market === "ml") && r.isUnderdogPick)) return false; break;
      }
  
      const a = (r.confA ?? confOf(r.teamA))?.toLowerCase();
      const b = (r.confB ?? confOf(r.teamB))?.toLowerCase();
      if (!a || !b) return false;
  
      const cf = s.conference.toLowerCase();
      const sameConf = a === b;
  
      if (s.gameType === "conference") {
        // conference game AND both teams in the selected conference
        return sameConf && a === cf && b === cf;
      } else {
        // non-conference game AND at least one team in the selected conference
        return !sameConf && (a === cf || b === cf);
      }
    });
}
  
function matchesForWeek(rows: PickRow[], slice: TrendSlice, weekNum: number): PickRow[] {
    // Reuse rowsForSlice, then filter to selected week
    return rowsForSlice(rows, slice).filter(r => r.weekNum === weekNum);
}
  
  

function computeTrendMetrics(rows: PickRow[]): TrendMetrics {
  const nBets = rows.length;
  const profitUnits = rows.reduce((a, r) => a + (r.units ?? 0), 0);
  const riskSum = rows.reduce((a, r) => a + Math.max(0, r.stakeRisk ?? 0), 0);
  const ror = riskSum > 0 ? profitUnits / riskSum : 0;

  let wins = 0, losses = 0;
  for (const r of rows) {
    if (r.result === "W") wins++;
    else if (r.result === "L") losses++;
  }
  const winPct = wins + losses > 0 ? wins / (wins + losses) : 0.5;

  const byWeek = new Map<string, PickRow[]>();
  for (const r of rows) {
    const key = `${r.weekNum}`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(r);
  }
  const weekKeys = [...byWeek.keys()].sort((a, b) => Number(a) - Number(b));
  const weeklyPnL = weekKeys.map((k, i) => {
    const sum = byWeek.get(k)!.reduce((a, r) => a + r.units, 0);
    return { weekIdx: i, profit: sum };
  });
  const consistency = weeklyPnL.length ? weeklyPnL.filter((w) => w.profit >= 0).length / weeklyPnL.length : 0.5;
  const ewmaProfit = ewmaWeeklyProfit(weeklyPnL);
  

  const u = rows.map((r) => r.units);
  const mean = u.reduce((a, b) => a + b, 0) / Math.max(1, u.length);
  const sd = Math.sqrt(u.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, u.length - 1));
  const sharpeish = sd > 0 ? (mean / sd) * Math.sqrt(Math.max(1, u.length)) : 0;

  // Timeline (by kickoff order)
  const dated = [...rows].sort((a, b) => {
    const ax = a.kickoffMs ?? Number.POSITIVE_INFINITY;
    const bx = b.kickoffMs ?? Number.POSITIVE_INFINITY;
    if (ax !== bx) return ax - bx;
    if (a.weekNum !== b.weekNum) return a.weekNum - b.weekNum;
    return a.key.localeCompare(b.key);
  });
  let cum = 0;
  const timeline = dated.map((r, i) => ({ idx: i + 1, cumUnits: (cum += r.units) }));
  const mdd = maxDrawdown(timeline.map((t) => t.cumUnits));

  // Wilson lower bound vs break-even (spreads/totals only)
  const stRows = rows.filter((r) => r.market === "spread" || r.market === "total");
  let wilsonLowerVsBreakeven = 0;
  if (stRows.length) {
    let w = 0, l = 0;
    for (const r of stRows) {
      if (r.result === "W") w++;
      else if (r.result === "L") l++;
    }
    const trials = w + l;
    if (trials > 0) {
      const wl = wilsonLowerBound(w, trials);
      wilsonLowerVsBreakeven = wl - BREAK_EVEN_SPREAD_TOTAL;
    }
  }

  return {
    nBets,
    nWeeks: weekKeys.length,
    profitUnits,
    riskSum,
    ror,
    winPct,
    consistency,
    maxDrawdown: mdd,
    ewmaProfit,
    sharpeish,
    wilsonLowerVsBreakeven,
    timeline,
  };
}

function sliceLabel(s: TrendSlice) {
    const parts: string[] = [];
    parts.push(s.market === "all" ? "All Markets" : s.market);
    if (s.pickType !== "all") parts.push(s.pickType);
    parts.push(`${s.confBand[0]}–${s.confBand[1]}% conf`);
    parts.push(s.gameType === "conference" ? "Conference" : "Non-Conf");
    parts.push(s.conference); // always present now
    return parts.join(" • ");
  }
  
  
// REPLACE buildCandidateSlices with:
function buildCandidateSlices(confs: string[]): TrendSlice[] {
    const markets: TrendSlice["market"][] = ["spread", "total", "ml"];
    const pickTypesByMarket: Record<TrendSlice["market"], TrendSlice["pickType"][]> = {
      spread: ["favorite", "underdog"],
      total: ["over", "under"],
      ml: ["favorite", "underdog"],
      all: ["all"],
    };
  
    const confBands: Array<[number, number]> = [
      [53, 60], [60, 70], [70, 80], [80, 90], [90, 101],
    ];
  
    const gameTypes: TrendSlice["gameType"][] = ["conference", "nonconference"];
    const conferences: string[] = confs; // <-- no "all"
  
    const out: TrendSlice[] = [];
    for (const m of markets) {
      for (const pt of pickTypesByMarket[m]) {
        for (const band of confBands) {
          for (const gt of gameTypes) {
            for (const cf of conferences) {
              out.push({ market: m, pickType: pt, confBand: band, gameType: gt, conference: cf });
            }
          }
        }
      }
    }
    return out;
}

function passesGuardrails(m: TrendMetrics) {
  const minBets = 5;
  const minRecentWeeks = 2;
  return m.nBets >= minBets && m.nWeeks >= minRecentWeeks;
}

export default function Trends() {
    const { loading, rows, pending, weeksAvailable } = useGradedRows();
    const [marketView, setMarketView] = useState<Market | "all">("all");
  
    // Build conference list once (from team_info.csv)
    const { confs: CONF_LIST } = buildTeamConfMap();
  
    // Candidate grid across markets/pick types/bands + (conference vs non-conference) × specific conference
    const candidateSlices = useMemo(() => buildCandidateSlices(CONF_LIST), [CONF_LIST]);
  
    // Optional focus dropdown for the Conference section
    const [confView, setConfView] = useState<string>("all"); // "all" or specific conf
  
    // ---- Score and rank trends (graded history only) ----
    const scored: TrendScored[] = useMemo(() => {
      if (!rows.length) return [];
  
      const proto = candidateSlices.map((s) => {
        const r = rowsForSlice(rows, s);                // graded rows only for scoring
        const metrics = computeTrendMetrics(r);
  
        // raw components
        const overall = metrics.nBets ? metrics.profitUnits / metrics.nBets : 0;
        const recent  = metrics.ewmaProfit;
        const stab    = metrics.sharpeish;
        const ciEdge  = s.market === "ml" ? 0 : Math.max(0, metrics.wilsonLowerVsBreakeven);
  
        // sample-size shrink + small bonuses/penalties
        const k = 60; // slightly stronger shrink for small samples
        const sizeMult        = Math.sqrt(metrics.nBets / (metrics.nBets + k));
        const consistBoost    = 0.5 * (metrics.consistency - 0.5);
        const drawdownPenalty = 0.1 * metrics.maxDrawdown;
  
        return { s, metrics, overall, recent, stab, ciEdge, sizeMult, consistBoost, drawdownPenalty };
      });
  
      const kept = proto.filter((p) => passesGuardrails(p.metrics));
  
      const zOverall = zscores(kept.map((k) => k.overall));
      const zRecent  = zscores(kept.map((k) => k.recent));
      const zStab    = zscores(kept.map((k) => k.stab));
  
      const out: TrendScored[] = kept.map((k, i) => {
        const score =
          (0.45 * zOverall[i] + 0.35 * zRecent[i] + 0.20 * zStab[i] + 2.0 * k.ciEdge) *
            k.sizeMult +
          k.consistBoost -
          k.drawdownPenalty;
  
        return {
          id: JSON.stringify(k.s),
          label: sliceLabel(k.s),
          slice: k.s,
          metrics: k.metrics,
          score,
        };
      });
  
      // Market filter and ranking
      const filtered = marketView === "all" ? out : out.filter((t) => t.slice.market === marketView);
      const ranked = filtered.sort((a, b) => b.score - a.score);
  
      // De-duplicate by the identifying axes (limit to a reasonable count)
      const seen = new Set<string>();
      const unique: TrendScored[] = [];
      for (const t of ranked) {
        const key = [
          t.slice.market,
          t.slice.pickType,
          t.slice.confBand.join(","),
          t.slice.gameType,
          t.slice.conference, // specific conf
        ].join("|");
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(t);
        }
        if (unique.length >= 50) break; // generous pool; sections will slice their own tops
      }
      return unique;
    }, [rows, candidateSlices, marketView]);
  
    // ---- Derive sections ----
    const rankedAll = scored; // already sorted by score desc
  
    const rankedConferenceAll = rankedAll.filter(t => t.slice.gameType === "conference");
    const rankedNonConfAll    = rankedAll.filter(t => t.slice.gameType === "nonconference");
  
    // Optional focus filter for conference section
    const rankedConferenceFocused = confView === "all"
      ? rankedConferenceAll
      : rankedConferenceAll.filter(t => t.slice.conference.toLowerCase() === confView.toLowerCase());
  
    // Overall top (cross game types)
    const topFiveOverall = rankedAll.slice(0, 5);
    // Always surface conference trends too (even if not top overall)
    const topFiveConference = rankedConferenceFocused.slice(0, 5);
  
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {/* Header */}
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28 }}>Best Current Trends</h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["all", "spread", "total", "ml"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMarketView(m)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: marketView === m ? "var(--accent)" : "var(--card)",
                    color: marketView === m ? "white" : "inherit",
                    fontWeight: 600,
                  }}
                >
                  {m === "all" ? "All Markets" : m}
                </button>
              ))}
            </div>
          </div>
  
          {/* <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Conference focus</label>
            <select
              value={confView}
              onChange={(e) => setConfView(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontWeight: 600 }}
            >
              <option value="all">All conferences</option>
              {CONF_LIST.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div> */}
  
          {loading && <div style={{ marginTop: 8, opacity: 0.8 }}>Crunching the latest results…</div>}
          {!loading && !rows.length && (
            <div style={{ marginTop: 8, padding: 10, background: "var(--mutedBg, #f6f7f9)", borderRadius: 10 }}>
              No graded data found. Ensure <code>data/**/scores/*.csv</code> and <code>data/**/week*_games*.csv</code> exist.
            </div>
          )}
          {!loading && rows.length > 0 && rankedAll.length === 0 && (
            <div style={{ marginTop: 8, padding: 10, background: "var(--mutedBg, #f0f7ff)", borderRadius: 10 }}>
              No trends passed the guardrails. Consider lowering min sample thresholds.
            </div>
          )}
        </section>
  
        {/* Info / glossary */}
        <section style={{ marginTop: 8, marginBottom: 12 }}>
          <InfoPanel />
        </section>
  
        {/* Section: Overall Best */}
        <h2 style={{ marginTop: 8, marginBottom: 8, fontWeight: 800, fontSize: 18 }}>Best Current Trends</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {topFiveOverall.map((t, i) => (
            <TrendCard
              key={t.id}
              trend={t}
              rank={i + 1}
              allRows={[...rows, ...pending]}      // include upcoming for drill-down
              allWeeks={weeksAvailable}            // weeks from files (incl. future)
            />
          ))}
        </div>
  
        {/* Section: Conference Trends (focused) */}
        <h2 style={{ marginTop: 18, marginBottom: 8, fontWeight: 800, fontSize: 18 }}>
          Top Conference Trends{confView !== "all" ? ` — ${confView}` : ""}
        </h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {topFiveConference.length ? (
            topFiveConference.map((t, i) => (
              <TrendCard
                key={t.id}
                trend={t}
                rank={i + 1}
                allRows={[...rows, ...pending]}
                allWeeks={weeksAvailable}
              />
            ))
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              No conference slices passed the guardrails for this focus. Try another conference or widen confidence bands.
            </div>
          )}
        </div>
      </div>
    );
  }
  

/* ---------- Presentational ---------- */
function Pill({ children }: { children: React.ReactNode }) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "3px 8px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--card)",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {children}
      </span>
    );
  }
  
  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{label}</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{value}</span>
      </div>
    );
  }
  
  function TrendCard({
    trend, rank, allRows, allWeeks,
  }: { trend: TrendScored; rank: number; allRows: PickRow[]; allWeeks: number[] }) {
    const m = trend.metrics;
  
    const [open, setOpen] = useState(false);
    const [weekSel, setWeekSel] = useState<number | null>(null);
    const weekMatches = useMemo(
      () => (weekSel == null ? [] : matchesForWeek(allRows, trend.slice, weekSel)),
      [allRows, trend.slice, weekSel]
    );
  
    const bandChip = `${trend.slice.confBand[0]}–${trend.slice.confBand[1]}% conf`;
    const typeChip = trend.slice.gameType === "conference" ? "Conference" : "Non-Conf";
    const confChip = trend.slice.conference; // always specific
  
    return (
      <section
        style={{
          border: "1px solid var(--border)", borderRadius: 14, padding: 14,
          background: "var(--card, #fff)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button
            onClick={() => setOpen(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 8, background: "transparent",
              border: "none", padding: 0, cursor: "pointer", textAlign: "left",
            }}
            aria-expanded={open}
            title="Click to explore this trend by week"
          >
            <div
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: "var(--accent, #0b63f6)", color: "white",
                display: "grid", placeItems: "center", fontWeight: 800,
              }}
            >
              {rank}
            </div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {trend.slice.market}{trend.slice.pickType !== "all" ? ` • ${trend.slice.pickType}` : ""}
              {` • ${trend.slice.conference}`}
            </div>
            <span style={{ marginLeft: 6, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .12s" }}>▸</span>
          </button>
  
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>TrendScore</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{Number(trend.score).toFixed(2)}</div>
          </div>
        </div>
  
        {/* Pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Pill>{bandChip}</Pill>
          <Pill>{typeChip}</Pill>
          <Pill>{confChip}</Pill>
        </div>
  
        {/* Sparkline */}
        <div style={{ height: 120, marginTop: 10, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trend.metrics.timeline.map((d) => ({ x: d.idx, cum: d.cumUnits }))}
              margin={{ top: 8, right: 12, left: 12, bottom: 8 }}
            >
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.35} />
              <XAxis dataKey="x" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                formatter={(v: any) => [`${Number(v).toFixed(2)}u`, "Cumulative Units"]}
                labelFormatter={(l) => `Pick #${l}`}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }}
              />
              <Line type="monotone" dataKey="cum" dot={false} stroke="var(--accent)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
  
        {/* Stats grid */}
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0,1fr))",
            gap: 10,
          }}
        >
          <Row label="Bets" value={`${m.nBets}`} />
          <Row label="Weeks" value={`${m.nWeeks}`} />
          <Row label="Profit (u)" value={`${fmt2(m.profitUnits)}`} />
          <Row label="RoR" value={`${fmt2(m.ror)}`} />
          <Row label="Win%" value={pct1(m.winPct)} />
          <Row label="Consistency" value={pct1(m.consistency)} />
          <Row label="Sharpe-ish" value={`${fmt2(m.sharpeish)}`} />
          <Row label="Max DD (u)" value={`${fmt2(m.maxDrawdown)}`} />
          {trend.slice.market !== "ml" ? (
            <Row label="CI Edge vs 52.38%" value={`${(m.wilsonLowerVsBreakeven * 100).toFixed(1)}%`} />
          ) : (
            <div />
          )}
        </div>
  
        {/* Drill-down: Week finder */}
        {open && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Week</label>
              <select
                value={weekSel ?? ""}
                onChange={(e) => setWeekSel(e.target.value ? Number(e.target.value) : null)}
                style={{
                  padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--card)", fontWeight: 600,
                }}
              >
                <option value="">Select week…</option>
                {allWeeks.map((w) => (
                  <option key={w} value={w}>Week {w}</option>
                ))}
              </select>
              {weekSel != null && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {weekMatches.length} match{weekMatches.length === 1 ? "" : "es"}
                </span>
              )}
            </div>
  
            {/* Results list */}
            {weekSel != null && (
              weekMatches.length ? (
                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  {weekMatches.map((r, i) => (
                    <div
                      key={`${r.key}-${i}`}
                      style={{
                        border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--mutedBg, #f7f8fa)",
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 13, lineHeight: 1.3 }}>
                        <div style={{ fontWeight: 700 }}>{r.pickText}</div>
                        <div style={{ color: "var(--muted)" }}>
                          {r.market.toUpperCase()} • {r.teamA} vs {r.teamB}
                          {typeof r.confidence === "number" ? ` • Conf ${Math.round(r.confidence * 100)}%` : ""}
                          {r.kickoffMs ? ` • ${new Date(r.kickoffMs).toLocaleString()}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Status</div>
                        <div style={{ fontWeight: 800 }}>
                          {r.result === "W" ? "✅ W"
                            : r.result === "L" ? "❌ L"
                            : r.result === "P" ? "Push"
                            : "Upcoming"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
                  No games matched this trend in Week {weekSel}.
                </div>
              )
            )}
          </div>
        )}
      </section>
    );
  }
  
  

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
