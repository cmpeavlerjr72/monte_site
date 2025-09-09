// src/pages/Scoreboard.tsx
import { act, useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import { getTeamColors } from "../utils/teamColors";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from "recharts";

/* ---------- discover score CSVs (sims) ---------- */
const RAW = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv",     { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV",     { as: "raw", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "raw", eager: true })
) as Record<string, string>;

const URLS = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv",     { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV",     { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "url", eager: true })
) as Record<string, string>;

/* ---------- discover players CSVs ---------- */
const P_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/players/*.csv",     { as: "raw", eager: true }),
  import.meta.glob("../data/**/players/*.csv.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/players/*.CSV",     { as: "raw", eager: true }),
  import.meta.glob("../data/**/players/*.CSV.CSV", { as: "raw", eager: true })
) as Record<string, string>;

const P_URL = Object.assign(
  {},
  import.meta.glob("../data/**/players/*.csv",     { as: "url", eager: true }),
  import.meta.glob("../data/**/players/*.csv.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/players/*.CSV",     { as: "url", eager: true }),
  import.meta.glob("../data/**/players/*.CSV.CSV", { as: "url", eager: true })
) as Record<string, string>;

/* ---------- discover week games CSVs (date/time, spreads, totals) ---------- */
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

/* ---------- file helpers ---------- */

// put near the top once
function pickNum(row: any, keys: string[]): number | undefined {
    for (const k of keys) {
      const v = row[k];
      if (v === "" || v == null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  }
  

type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };
const normPath = (s: string) => s.replace(/\\/g, "/");
const weekFrom = (p: string) =>
  normPath(p).match(/\/(week[^/]+)\//i)?.[1].toLowerCase()
  ?? normPath(p).match(/\/data\/([^/]+)\//i)?.[1].toLowerCase()
  ?? "root";

function buildFiles(raw: Record<string,string>, urls: Record<string,string>): FileInfo[] {
  const paths = Array.from(new Set([...Object.keys(raw), ...Object.keys(urls)]));
  return paths
    .map((p) => ({
      path: p,
      week: weekFrom(p),
      file: p.split("/").pop() || p,
      raw: raw[p],
      url: urls[p],
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
const scoreFilesAll = buildFiles(RAW, URLS);
const gamesFilesAll = buildFiles(G_RAW, G_URL);
const playerFilesAll = buildFiles(P_RAW, P_URL);

/* --------------------- Team logo lookup --------------------- */
const TEAM_INFO_RAW = import.meta.glob("../assets/team_info.csv", { as: "raw", eager: true }) as Record<string, string>;
const teamInfoRaw = Object.values(TEAM_INFO_RAW)[0] ?? "";
const LOGO_MAP: Record<string, string> = {};

function normTeamKey(t: string) {
  return t.toLowerCase().replace(/&/g, "and").replace(/\bst\.\b/g, "state").replace(/[^a-z0-9]+/g, "");
}
function fixLogoUrl(u?: string) {
  if (!u) return undefined;
  let s = u.trim();
  if (!s) return undefined;
  if (s.startsWith("//")) s = "https:" + s;
  if (s.startsWith("http://")) s = "https://" + s.slice(7);
  return s;
}
function firstLogoFromCell(cell?: string) {
  if (!cell) return undefined;
  const parts = String(cell).split(/[|,;\s]+/).filter(Boolean);
  for (const p of parts) {
    const fixed = fixLogoUrl(p);
    if (fixed?.startsWith("https://")) return fixed;
  }
  return undefined;
}
if (teamInfoRaw) {
  const parsed = Papa.parse(teamInfoRaw, { header: true, skipEmptyLines: true });
  for (const row of (parsed.data as any[])) {
    if (!row) continue;
    const name = row.Team ?? row.team ?? row.School ?? row.school ?? row.Name ?? row.name;
    const key = name ? normTeamKey(String(name)) : "";
    if (!key) continue;
    const logo = firstLogoFromCell(row.Logos ?? row.logo ?? row.Logo ?? row.logos);
    if (logo) LOGO_MAP[key] = logo;
  }
}
function getTeamLogo(name: string) { return LOGO_MAP[normTeamKey(name)]; }

/* --------------------- types & helpers --------------------- */

interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; }
type GameMap = Record<string, GameData>;

type GameMeta = {
  teamA: string;
  teamB: string;
  kickoffLabel?: string;
  kickoffMs?: number;
  spread?: number; // Team A line
  total?: number;
  finalA?: number;
  finalB?: number;
};
type GameMetaMap = Record<string, GameMeta>;

type CardGame = {
  key: string;
  teamA: string;
  teamB: string;
  medA: number;
  medB: number;
  meanA: number;
  meanB: number;
  kickoffLabel?: string;
  kickoffMs?: number;
  pickSpread?: string;
  pickTotal?: string;
  spreadProb?:number;
  totalProb?:number;
  spreadResult?: "win" | "loss" | "push";
  totalResult?: "win" | "loss" | "push";
  finalA?: number;
  finalB?: number;
};

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const mean = (arr: number[]) => (arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0);

const quantiles = (arr: number[]) => {
  if (!arr.length) return null as null | { q1:number; med:number; q3:number };
  const s = [...arr].sort((a,b)=>a-b);
  const n = s.length;
  const at = (p:number)=> s[Math.floor(p*(n-1))];
  return { q1: at(0.25), med: at(0.5), q3: at(0.75) };
};
const sortedKey = (a: string, b: string) => [a, b].sort((x, y) => x.localeCompare(y)).join("__");

/* ---------- kickoff formatting & parsing ---------- */
function formatKick(dt: Date) {
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
const MONTHS: Record<string, number> = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
  jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,
  oct:10,october:10,nov:11,november:11,dec:12,december:12,
};

// Supports: "Sep 6", "6-Sep", "09/06", "2025-09-06"
function parseMonthDay(input: string): { y?: number; m: number; d: number } | null {
  const s = input.trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s*/i, "");

  let m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
  if (m) return { y: m[3] ? Number(m[3]) : undefined, m: MONTHS[m[1].toLowerCase()], d: Number(m[2]) };

  m = s.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i);
  if (m) return { m: MONTHS[m[2].toLowerCase()], d: Number(m[1]) };

  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) return { y: m[3] ? Number(m[3].length===2 ? "20"+m[3] : m[3]) : undefined, m: Number(m[1]), d: Number(m[2]) };

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y:Number(m[1]), m:Number(m[2]), d:Number(m[3]) };

  return null;
}

// Supports: "7 PM", "7:30 PM", "7:30:00 PM", "19:05", "12:00:00 PM"
function parseTime(input?: string): { h:number; min:number } | null {
  if (!input) return null;
  const s = input.trim();

  let m = s.match(/^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*([AP]M)?$/i);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ampm = m[4]?.toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return { h, min };
  }

  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return { h:Number(m[1]), min:Number(m[2]) };

  return null;
}

function parseKickoffMs(rawDate?: string, rawTime?: string, rawDateTime?: string): { ms?: number; label?: string } {
  if (rawDateTime && !Number.isNaN(Date.parse(rawDateTime))) {
    const ms = Date.parse(rawDateTime);
    return { ms, label: formatKick(new Date(ms)) };
  }
  const md = rawDate ? parseMonthDay(String(rawDate)) : null;
  const tt = parseTime(rawTime);
  if (md) {
    const y = md.y ?? new Date().getFullYear();
    const h = tt?.h ?? 0, min = tt?.min ?? 0;
    const dt = new Date(y, md.m - 1, md.d, h, min);
    return { ms: dt.getTime(), label: formatKick(dt) };
  }
  const label = [rawDate, rawTime].filter(Boolean).join(" • ") || undefined;
  return { ms: undefined, label };
}

/* --------------------- odds & histogram helpers --------------------- */
function americanOdds(prob: number): string {
  if (!(prob > 0 && prob < 1)) return "—";
  if (prob === 0.5) return "+100";
  if (prob > 0.5) {
    const val = Math.round((-prob / (1 - prob)) * 100);
    return `${val}`; // already negative
  }
  const val = Math.round(((1 - prob) / prob) * 100);
  return `+${val}`;
}
type HistBin = { bin: string; count: number; start: number; end: number };
function computeHistogram(values: number[], opts?: { bins?: number; binWidth?: number }): HistBin[] {
  if (!values.length) return [];
  const v = values.slice().sort((a,b)=>a-b);
  const n = v.length, min = v[0], max = v[n-1];
  const q1 = v[Math.floor(0.25*(n-1))], q3 = v[Math.floor(0.75*(n-1))];
  const iqr = Math.max(1e-6, q3-q1);
  let binWidth = opts?.binWidth || (max>min ? Math.max(2*iqr*Math.cbrt(1/n), 0.5) : 1);
  let bins = opts?.bins || Math.max(1, Math.ceil((max-min)/binWidth));
  if (opts?.bins && !opts?.binWidth && max>min) binWidth = (max-min)/bins;
  const start = Math.floor(min/binWidth)*binWidth;
  const end   = Math.ceil(max/binWidth)*binWidth;
  const edges:number[] = []; for (let x=start; x<=end+1e-9; x+=binWidth) edges.push(Number(x.toFixed(8)));
  const counts = new Array(edges.length-1).fill(0);
  for (const x of v) {
    let idx = Math.floor((x-start)/binWidth);
    if (idx<0) idx=0; if (idx>=counts.length) idx=counts.length-1;
    counts[idx]++;
  }
  return counts.map((c,i)=>{
    const s = edges[i], e = edges[i+1];
    return { bin: `${Number(s.toFixed(1))}–${Number(e.toFixed(1))}`, count:c, start:s, end:e };
  });
}
function findBinLabelForValue(hist: HistBin[], x: number) {
  for (const h of hist) if (x>=h.start && x<h.end) return h.bin;
  if (hist.length && x===hist[hist.length-1].end) return hist[hist.length-1].bin;
  return undefined;
}

/* --------------------- roles & canonical stats (for players) --------------------- */
type Role = "QB" | "Rusher" | "Receiver";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const STAT_SYNONYMS: Record<string, string> = {
  pass_yds:"pass_yds", pass_yards:"pass_yds", passing_yards:"pass_yds", py:"pass_yds", passyards:"pass_yds",
  pass_td:"pass_td", pass_tds:"pass_td", passing_tds:"pass_td", ptd:"pass_td",
  int:"ints", ints:"ints", interception:"ints", interceptions:"ints",
  pass_att:"pass_att", pass_atts:"pass_att", pass_attempts:"pass_att", attempts:"pass_att", att:"pass_att",
  pass_cmp:"pass_cmp", pass_comp:"pass_cmp", completions:"pass_cmp", cmp:"pass_cmp",
  sacks:"sacks", sacked:"sacks", times_sacked:"sacks",
  rush_yds:"rush_yds", rushing_yards:"rush_yds", ry:"rush_yds", rushyards:"rush_yds",
  rush_td:"rush_td", rushing_tds:"rush_td", rtd:"rush_td",
  rush_att:"rush_att", rush_atts:"rush_att", rushing_attempts:"rush_att", rush_attempts:"rush_att", carries:"rush_att",
  rec_yds:"rec_yds", receiving_yards:"rec_yds", ryds:"rec_yds",
  rec_td:"rec_td", receiving_tds:"rec_td",
  receptions:"receptions", rec:"receptions", catches:"receptions",
};
const CANON_LABEL: Record<string, string> = {
  pass_yds:"Pass Yds", pass_td:"Pass TD", ints:"INT",
  pass_att:"Pass Att", pass_cmp:"Pass Cmp", sacks:"Sacks",
  rush_yds:"Rush Yds", rush_td:"Rush TD", rush_att:"Rush Att",
  rec_yds:"Rec Yds", rec_td:"Rec TD", receptions:"Receptions",
};
const ROLE_BY_CANON: Record<string, Role> = {
  pass_yds:"QB", pass_td:"QB", ints:"QB", pass_att:"QB", pass_cmp:"QB", sacks:"QB",
  rush_yds:"Rusher", rush_td:"Rusher", rush_att:"Rusher",
  rec_yds:"Receiver", rec_td:"Receiver", receptions:"Receiver",
};
function canonicalRoleFromValueKey(statKey: string): Role | null {
  const canon = STAT_SYNONYMS[norm(statKey)];
  return canon ? (ROLE_BY_CANON[canon] ?? null) : null;
}
function normalizeRole(rawRole: any): Role | null {
  if (rawRole == null) return null;
  const r = String(rawRole).toLowerCase().trim().replace(/\s+/g,"_");
  if (["qb","quarterback"].includes(r)) return "QB";
  if (["rb","hb","fb","running_back","runningback","rusher"].includes(r)) return "Rusher";
  if (["wr","te","receiver","wide_receiver","tight_end"].includes(r)) return "Receiver";
  return null;
}
// team -> player -> role -> stat -> values[]
type PlayerMap = Record<string, Record<string, Partial<Record<Role, Record<string, number[]>>>>>;
interface PlayerObs { team: string; player: string; role: Role | null; stat: string; value: number; }

/* --------------------- small controls --------------------- */
function NumberSpinner({
  value, onChange, step = 0.5, min, max, width = 110, placeholder,
}: {
  value: string; onChange: (s: string) => void; step?: number; min?: number; max?: number; width?: number; placeholder?: string;
}) {
  const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const clamp = (n: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
  const bump = (dir: -1 | 1) => {
    const curr = toNum(value); const base = Number.isFinite(curr) ? curr : 0;
    const next = clamp(base + dir * step); onChange(next.toFixed(1));
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button type="button" onClick={() => bump(-1)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}>−</button>
      <input type="number" step={step} min={min} max={max} value={value} placeholder={placeholder}
        inputMode="decimal" onChange={(e) => onChange(e.target.value)}
        style={{ width, padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }} />
      <button type="button" onClick={() => bump(1)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}>+</button>
    </div>
  );
}

/* --------------------- page --------------------- */
export default function Scoreboard() {
  // derive weeks
  const weeks = useMemo(() => {
    const s = new Set<string>([...scoreFilesAll, ...gamesFilesAll, ...playerFilesAll].map((f) => f.week));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);

  const [selectedWeek, setSelectedWeek] = useState(weeks[0] ?? "");
  const [loading, setLoading] = useState(false);

  const [games, setGames] = useState<GameMap>({});
  const [meta, setMeta]   = useState<GameMetaMap>({});
  const [players, setPlayers] = useState<PlayerMap>({});

  type SortBy = "kickoff" | "spread_conf" | "total_conf";
  const [sortBy, setSortBy] = useState<SortBy>("kickoff");

  const [useMean, setUseMean] = useState(false); // false = show medians (current), true = show means


  useEffect(() => {
    if (!selectedWeek) { setGames({}); setMeta({}); setPlayers({}); return; }

    async function loadWeek() {
      setLoading(true);
      try {
        /* ---- sims ---- */
        const sFiles = scoreFilesAll.filter((f) => f.week === selectedWeek);
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
                          .map((r) => ({ team: String(r.team), opp: String(r.opp), pts: Number(r.pts), opp_pts: Number(r.opp_pts) })) as SimRow[];
                        resolve(rows);
                      } catch (e) { reject(e); }
                    },
                    error: reject,
                  });
                if (item.raw) parse(item.raw);
                else if (item.url) fetch(item.url).then((r) => r.text()).then(parse).catch(reject);
                else reject(new Error("No raw/url for " + item.path));
              })
          )
        );

        const map: GameMap = {};
        for (const rows of simArrays) {
          const byPair = new Map<string, SimRow[]>();
          for (const r of rows) {
            const key = sortedKey(r.team, r.opp);
            (byPair.get(key) || (byPair.set(key, []), byPair.get(key)!)).push(r);
          }
          for (const [pair, arr] of byPair.entries()) {
            const [A, B] = pair.split("__");
            const normalized = arr.map((r) =>
              r.team === A && r.opp === B
                ? { team: A, opp: B, pts: r.pts, opp_pts: r.opp_pts }
                : { team: A, opp: B, pts: r.opp_pts, opp_pts: r.pts }
            );
            (map[pair] ||= { teamA: A, teamB: B, rowsA: [] }).rowsA.push(...normalized);
          }
        }
        setGames(map);

        /* ---- week games (date/time + book lines) ---- */
        const gFiles = gamesFilesAll.filter((f) => f.week === selectedWeek);
        const metaArrays = await Promise.all(
          gFiles.map(
            (item) =>
              new Promise<any[]>((resolve, reject) => {
                const parse = (text: string) =>
                  Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true, complete: (res) => resolve(res.data as any[]), error: reject });
                if (item.raw) parse(item.raw);
                else if (item.url) fetch(item.url).then((r) => r.text()).then(parse).catch(reject);
                else resolve([]);
              })
          )
        );

        const m: GameMetaMap = {};
        for (const arr of metaArrays) {
          for (const row of arr) {
            if (!row) continue;
            const a = String(row["Team A"] ?? row.team_a ?? row.teamA ?? row.A ?? row.Home ?? row.home ?? "").trim();
            const b = String(row["Team B"] ?? row.team_b ?? row.teamB ?? row.B ?? row.Away ?? row.away ?? "").trim();
            if (!a || !b) continue;

            // after (numbers)
            const finalA = pickNum(row, ["Team A Score Actual","team_a_score_actual","TeamAScoreActual"]);
            const finalB = pickNum(row, ["Team B Score Actual","team_b_score_actual","TeamBScoreActual"]);


            const dateStr = row.Date ?? row.date ?? row["Game Date"] ?? row.game_date;
            const timeStr = row.Time ?? row.time ?? row.Kick ?? row.kick ?? row.Kickoff ?? row.kickoff;
            const datetimeStr = row.Datetime ?? row.DateTime ?? row.datetime ?? row.start_time ?? row.StartTime;
            const { ms, label } = parseKickoffMs(dateStr, timeStr, datetimeStr);

            const spread = Number(row.Spread ?? row.spread ?? row.Line ?? row.line);
            const total  = Number(row.OU ?? row["O/U"] ?? row.Total ?? row.total);

            const key = sortedKey(a, b);
            m[key] = {
              teamA: a, teamB: b,
              kickoffMs: Number.isFinite(ms) ? ms : undefined,
              kickoffLabel: label,
              spread: Number.isFinite(spread) ? spread : undefined,
              total: Number.isFinite(total) ? total : undefined,
              finalA,
              finalB,
            };
          }
        }
        setMeta(m);

        /* ---- players (per role) ---- */
        const pFiles = playerFilesAll.filter((f) => f.week === selectedWeek);
        const playerArrays = await Promise.all(
          pFiles.map(
            (item) =>
              new Promise<PlayerObs[]>((resolve, reject) => {
                const parse = (text: string) =>
                  Papa.parse(text, {
                    header: true, dynamicTyping: true, skipEmptyLines: true,
                    complete: (res) => {
                      try {
                        const out: PlayerObs[] = [];
                        const metaKeys = new Set([
                          "team","Team","school","School",
                          "player","Player","name","Name",
                          "opp","Opp",
                          "role","Role","position","Position","pos","Pos",
                          "stat","Stat","metric","Metric","category","Category","value","Value","amount","Amount","val","Val"
                        ]);
                        for (const raw of res.data as any[]) {
                          if (!raw) continue;
                          const team = String(raw.team ?? raw.Team ?? raw.school ?? raw.School ?? "");
                          const player = String(raw.player ?? raw.Player ?? raw.name ?? raw.Name ?? "");
                          if (!team || !player) continue;

                          const roleFromField = normalizeRole(raw.role ?? raw.Role ?? raw.position ?? raw.Position ?? raw.pos ?? raw.Pos);

                          const statKey = raw.stat ?? raw.Stat ?? raw.metric ?? raw.Metric ?? raw.category ?? raw.Category;
                          const valKey  = raw.value ?? raw.Value ?? raw.amount ?? raw.Amount ?? raw.val ?? raw.Val;
                          if (statKey != null && valKey != null && isFinite(Number(valKey))) {
                            const r = roleFromField ?? canonicalRoleFromValueKey(String(statKey));
                            if (r) out.push({ team, player, role: r, stat: String(statKey), value: Number(valKey) });
                            continue;
                          }
                          for (const k of Object.keys(raw)) {
                            if (metaKeys.has(k)) continue;
                            const v = Number(raw[k]);
                            if (!Number.isFinite(v)) continue;
                            const r = roleFromField ?? canonicalRoleFromValueKey(k);
                            if (!r) continue;
                            out.push({ team, player, role: r, stat: k, value: v });
                          }
                        }
                        resolve(out);
                      } catch (e) { reject(e); }
                    },
                    error: reject,
                  });
                if (item.raw) parse(item.raw);
                else if (item.url) fetch(item.url).then(r=>r.text()).then(parse).catch(reject);
                else resolve([]);
              })
          )
        );

        const pmap: PlayerMap = {};
        for (const arr of playerArrays) {
          for (const o of arr) {
            if (!o.role) continue;
            ((((pmap[o.team] ||= {})[o.player] ||= {})[o.role] ||= {})[o.stat] ||= []).push(o.value);
          }
        }
        setPlayers(pmap);
      } finally {
        setLoading(false);
      }
    }
    loadWeek();
  }, [selectedWeek]);

  /* ---------- cards (join sims with meta, compute picks, sort by kickoff) ---------- */
  const cards: CardGame[] = useMemo(() => {
    const out: CardGame[] = [];
    for (const [key, g] of Object.entries(games)) {
      const Avals = g.rowsA.map((r) => r.pts);
      const Bvals = g.rowsA.map((r) => r.opp_pts);
      const medA = Math.round(median(Avals));
      const medB = Math.round(median(Bvals));
      const meanA = Math.round(mean(Avals));   // NEW
      const meanB = Math.round(mean(Bvals));   // NEW
      const joined = meta[key];

      let simsA = medA, simsB = medB;
      if (joined && g.teamA !== joined.teamA) { simsA = medB; simsB = medA; }

      let pickSpread: string | undefined;
      if (joined?.spread !== undefined) {
        const s = joined.spread;
        const diff = (simsA + s) - simsB;
        if (Math.abs(diff) < 1e-9) pickSpread = `Push @ ${s>0?`+${s}`:`${s}`}`;
        else if (diff > 0) pickSpread = `${joined.teamA} ${s>0?`+${s}`:`${s}`}`;
        else pickSpread = `${joined.teamB} ${(-s)>0?`+${-s}`:`${-s}`}`;
      }
      let pickTotal: string | undefined;
      if (joined?.total !== undefined) {
        const predTotal = simsA + simsB;
        pickTotal = predTotal > joined.total ? `Over ${joined.total}` : `Under ${joined.total}`;
      }

      let totalProb: number | undefined;
      if (joined?.total !== undefined) {
      const t = joined.total;
      const totals = g.rowsA.map(r => r.pts + r.opp_pts);
      const n = totals.length;
      if (n > 0) {
          const over = totals.filter(x => x > t).length / n;
          const under = totals.filter(x => x < t).length / n;
          const pickedOver = (simsA + simsB) > t; // your pick logic for total
          totalProb = pickedOver ? over : under;
      }
      }




      // --- Spread probability at the BOOK line (Team A line) ---
      let spreadProb: number | undefined;
      if (joined?.spread !== undefined) {
      const s = joined.spread; // Team A line

    // Orientation: Avals/Bvals must match book's Team A/B
      const Avals = g.teamA === joined.teamA
          ? g.rowsA.map(r => r.pts)
          : g.rowsA.map(r => r.opp_pts);
      const Bvals = g.teamA === joined.teamA
          ? g.rowsA.map(r => r.opp_pts)
          : g.rowsA.map(r => r.pts);

    // P(Team A covers) = P(A + s > B)
      let coverA = 0;
      const n = Math.min(Avals.length, Bvals.length);
      for (let i = 0; i < n; i++) {
          if ((Avals[i] + s) > Bvals[i]) coverA++;
      }
      const pA = n ? coverA / n : undefined;

    // Which side did we pick? (same logic you used to set pickSpread)
      const diff = (simsA + s) - simsB; // >0 means Team A covers
      if (typeof pA === "number") {
          spreadProb = diff > 0
          ? pA                // picked Team A side
          : 1 - pA;           // picked Team B side
        }
      }

      let spreadResult: "win" | "loss" | "push" | undefined;
    let totalResult:  "win" | "loss" | "push" | undefined;  // ← keep only this one
    let dispFinalA: number | undefined;                     // ← hoist to outer scope
    let dispFinalB: number | undefined;                     // ← hoist to outer scope

    if (joined && Number.isFinite(joined.finalA) && Number.isFinite(joined.finalB)) {
    const fA = joined.finalA as number;
    const fB = joined.finalB as number;

    // --- Spread grading (as you had) ---
    if (Number.isFinite(joined.spread)) {
        const s = joined.spread as number;
        const diff = (simsA + s) - simsB;
        const coverA = (fA + s) > fB ? 1 : (fA + s) < fB ? -1 : 0;
        const pickedA = diff > 0;
        if (coverA === 0) {
        spreadResult = "push";
        } else {
        const pickedWins = (coverA > 0 && pickedA) || (coverA < 0 && !pickedA);
        spreadResult = pickedWins ? "win" : "loss";
        }
    }

    // --- Finals aligned to the card’s alphabetical display orientation ---
    if (joined && g.teamA !== joined.teamA) {
        // book Team A == our teamB → flip for display
        dispFinalA = joined.finalB as number;
        dispFinalB = joined.finalA as number;
    } else {
        dispFinalA = joined.finalA as number;
        dispFinalB = joined.finalB as number;
    }

    // --- Total grading (use the *outer* totalResult) ---
    if (Number.isFinite(joined.total)) {
        const lineT     = joined.total as number;
        const gameTotal = (joined.finalA as number) + (joined.finalB as number);
        const predTotal = simsA + simsB;

        const actualSide    = gameTotal > lineT ? "Over"  : gameTotal < lineT ? "Under" : "Push";
        const predictedSide = predTotal > lineT ? "Over"  : predTotal < lineT ? "Under" : "Push";

        totalResult = (actualSide === "Push" || predictedSide === "Push")
        ? "push"
        : (actualSide === predictedSide ? "win" : "loss");
    }
    }

    // ...then your out.push, now these names are in scope:
    out.push({
    key,
    teamA: g.teamA,
    teamB: g.teamB,
    medA, medB,
    meanA, meanB,
    kickoffLabel: joined?.kickoffLabel,
    kickoffMs: joined?.kickoffMs,
    pickSpread, pickTotal,
    spreadProb, totalProb,
    spreadResult, totalResult,
    finalA: dispFinalA,
    finalB: dispFinalB,
    });
      
    }
    // Strict numeric sort by kickoff timestamp (date then time). Unknown -> bottom.
// Strict numeric sort depending on selected mode
    out.sort((x, y) => {
        if (sortBy === "kickoff") {
        const ax = x.kickoffMs ?? Number.POSITIVE_INFINITY;
        const ay = y.kickoffMs ?? Number.POSITIVE_INFINITY;
        if (ax !== ay) return ax - ay;
        return x.teamA.localeCompare(y.teamA);
        }
        if (sortBy === "spread_conf") {
        const ax = (typeof x.spreadProb === "number") ? x.spreadProb : -1;
        const ay = (typeof y.spreadProb === "number") ? y.spreadProb : -1;
        if (ay !== ax) return ay - ax; // DESC
        // tie-breaker: kickoff
        const kx = x.kickoffMs ?? Number.POSITIVE_INFINITY;
        const ky = y.kickoffMs ?? Number.POSITIVE_INFINITY;
        if (kx !== ky) return kx - ky;
        return x.teamA.localeCompare(y.teamA);
        }
        // total_conf
        const ax = (typeof x.totalProb === "number") ? x.totalProb : -1;
        const ay = (typeof y.totalProb === "number") ? y.totalProb : -1;
        if (ay !== ax) return ay - ax;   // DESC
        const kx = x.kickoffMs ?? Number.POSITIVE_INFINITY;
        const ky = y.kickoffMs ?? Number.POSITIVE_INFINITY;
        if (kx !== ky) return kx - ky;
        return x.teamA.localeCompare(y.teamA);
    });
  
    return out;
  }, [games, meta,sortBy]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      {/* Week selector */}
      <section className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>Week</h2>
            <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            >
                {weeks.map((w) => (<option key={w} value={w}>{w}</option>))}
            </select>

            
            <span style={{ fontSize: 12, opacity: 0.7 }}>
                {loading ? "Loading…" : `Showing ${cards.length} game${cards.length === 1 ? "" : "s"}`}
            </span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Sort by:</label>
            <select
                value={sortBy}
                onChange={(e)=>setSortBy(e.target.value as any)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            >
                <option value="kickoff">Kickoff time</option>
                <option value="spread_conf">Spread confidence</option>
                <option value="total_conf">Total confidence</option>
            </select>

            <label style={{ fontSize: 12, color: "var(--muted)" }}>Score number:</label>
            <select
                value={useMean ? "mean" : "median"}
                onChange={(e)=>setUseMean(e.target.value === "mean")}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            >
                <option value="median">Median</option>
                <option value="mean">Mean</option>
            </select>
            </div>
        </div>
        </section>


      {/* Cards grid */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "stretch",
        }}
      >
        {cards.map((c) => (
          <GameCard
            key={c.key}
            card={c}
            gdata={games[c.key]}
            players={players}
            useMean={useMean}
          />
        ))}
      </div>
    </div>
  );
}

/* ================== Card component (scores + players compact panels) ================== */

type Metric = "spread" | "total" | "teamLeft" | "teamRight";
function metricSeries(g: GameData, metric: Metric, teamOrder: 0|1) {
  const A = g.rowsA.map(r=>r.pts);
  const B = g.rowsA.map(r=>r.opp_pts);
  const left  = teamOrder===0 ? A : B;
  const right = teamOrder===0 ? B : A;
  if (metric==="teamLeft")  return left;
  if (metric==="teamRight") return right;
  if (metric==="total")     return left.map((x,i)=>x+right[i]);
  return right.map((x,i)=>x-left[i]);
}

function GameCard({ card, gdata, players ,useMean = false}: { card: CardGame; gdata: GameData; players: PlayerMap; useMean?: boolean }) {
  const aColors = getTeamColors(card.teamA);
  const bColors = getTeamColors(card.teamB);
  const aLogo = getTeamLogo(card.teamA);
  const bLogo = getTeamLogo(card.teamB);

  const [showScores, setShowScores] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);

  /* ----- SCORE PANEL STATE ----- */
  const [metric, setMetric] = useState<Metric>("spread");
  const [teamOrder, setTeamOrder] = useState<0|1>(0);
  const [bins, setBins] = useState<number|"auto">("auto");
  const [teamLine, setTeamLine] = useState<string>("");

  const pillBg = (result?: "win" | "loss" | "push") => {
    if (result == "win") return "color-mix(in oklab, #16a34a 22%, white)";
    if (result == "loss") return "color-mix(in oklab, #ef4444 22%, white)";
    return "color-mix(in oklab, var(--brand) 12%, white)"
  };

  const series = useMemo(() => metricSeries(gdata, metric, teamOrder), [gdata, metric, teamOrder]);
  const qScore = useMemo(()=> quantiles(series), [series]);
  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin[];
    const opts:any = {}; if (bins!=="auto") opts.bins = Math.max(1, Number(bins));
    return computeHistogram(series, opts);
  }, [series, bins]);
  const scoreTickLabels = useMemo(()=>{
    if (!hist.length || !qScore) return {q1Label:undefined, medLabel:undefined, q3Label:undefined};
    return {
      q1Label: findBinLabelForValue(hist, qScore.q1),
      medLabel: findBinLabelForValue(hist, qScore.med),
      q3Label: findBinLabelForValue(hist, qScore.q3),
    };
  }, [hist, qScore]);
  const teamProb = useMemo(() => {
    if (!series.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(teamLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of series) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = series.length;
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [series, teamLine]);
  const lineBinLabel = useMemo(() => (teamProb && hist.length ? findBinLabelForValue(hist, teamProb.line) : undefined), [teamProb, hist]);

  /* ----- PLAYER PANEL STATE ----- */
  const [pTeam, setPTeam] = useState<string>(card.teamA);
  const [pRole, setPRole] = useState<Role>("QB");
  const teamPlayersByRole = (team: string, role: Role) =>
    Object.keys(players[team] || {}).filter(p => !!players[team]?.[p]?.[role]).sort();
  const statsFor = (team: string, player: string, role: Role) =>
    Object.keys(players[team]?.[player]?.[role] || {}).sort();

  const defaultPlayer = useMemo(() => teamPlayersByRole(pTeam, pRole)[0] || "", [pTeam, pRole, players]);
  const [pPlayer, setPPlayer] = useState<string>("");
  useEffect(()=>{ setPPlayer(defaultPlayer); }, [defaultPlayer]);

  const defaultStat = useMemo(() => statsFor(pTeam, pPlayer, pRole)[4] || "", [pTeam, pPlayer, pRole, players]);
  const [pStat, setPStat] = useState<string>("");
  useEffect(()=>{ setPStat(defaultStat); }, [defaultStat]);

  const pValues = players[pTeam]?.[pPlayer]?.[pRole]?.[pStat] || [];
  const qPlayer = useMemo(()=> quantiles(pValues), [pValues]);
  const pHist = useMemo(() => computeHistogram(pValues, { bins: 20 }), [pValues]);
  const pTickLabels = useMemo(()=>{
    if (!pHist.length || !qPlayer) return {q1Label:undefined, medLabel:undefined, q3Label:undefined};
    return {
      q1Label: findBinLabelForValue(pHist, qPlayer.q1),
      medLabel: findBinLabelForValue(pHist, qPlayer.med),
      q3Label: findBinLabelForValue(pHist, qPlayer.q3),
    };
  }, [pHist, qPlayer]);

  const [playerLine, setPlayerLine] = useState<string>("");
  const pProb = useMemo(() => {
    if (!pValues.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(playerLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of pValues) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = pValues.length; return { under:u/n, at:a/n, over:o/n, line:L };
  }, [pValues, playerLine]);
  const pLbl = useMemo(()=> (pProb && pHist.length ? findBinLabelForValue(pHist, pProb.line) : undefined), [pProb, pHist]);

  const pretty = (s: string) => {
    const key = norm(s);
    const back: Record<string,string> = {
      pass_yds:"Pass Yds", pass_td:"Pass TD", ints:"INT", pass_att:"Pass Att", pass_cmp:"Pass Cmp", sacks:"Sacks",
      rush_yds:"Rush Yds", rush_td:"Rush TD", rush_att:"Rush Att",
      rec_yds:"Rec Yds", rec_td:"Rec TD", receptions:"Receptions",
      carries:"Rush Att", att:"Rush Att",
    };
    return back[STAT_SYNONYMS[key] ?? key] ?? s;
  };

  return (
    <article
      className="card"
      style={{
        padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)",
        display: "grid", gridTemplateRows: "auto auto auto", gap: 8,
      }}
    >
      {/* header */}
      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
        <span>week</span>
        <span>{card.kickoffLabel ?? "TBD"}</span>
      </div>

      {/* teams + scores */}
        {/* teams + scores (stacked with Projected / Actual) */}
        {(() => {
        const projA = useMean ? card.meanA : card.medA;
        const projB = useMean ? card.meanB : card.medB;

        const hasFinalA = Number.isFinite(card.finalA);
        const hasFinalB = Number.isFinite(card.finalB);

        return (
            <div
            style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 90px 90px",
                rowGap: 6,
                columnGap: 8,
                alignItems: "center",
            }}
            >
            {/* header */}
            <div />
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Projected</div>
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Actual</div>

            {/* Team B (top) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {bLogo ? (
                <img src={bLogo} alt={`${card.teamB} logo`} width={24} height={24} style={{ objectFit: "contain" }} loading="lazy" />
                ) : (
                <div style={{ width: 24, height: 24, borderRadius: 6, background: bColors?.primary ?? "var(--accent)" }} />
                )}
                <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {card.teamB}
                </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center", color: bColors?.primary ?? "var(--text)" }}>
                {projB}
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
                {hasFinalB ? card.finalB : "–"}
            </div>

            {/* Team A (bottom) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {aLogo ? (
                <img src={aLogo} alt={`${card.teamA} logo`} width={24} height={24} style={{ objectFit: "contain" }} loading="lazy" />
                ) : (
                <div style={{ width: 24, height: 24, borderRadius: 6, background: aColors?.primary ?? "var(--brand)" }} />
                )}
                <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {card.teamA}
                </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center", color: aColors?.primary ?? "var(--text)" }}>
                {projA}
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
                {hasFinalA ? card.finalA : "–"}
            </div>
            </div>
        );
        })()}


      {/* picks row */}
      {(card.pickSpread || card.pickTotal) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {card.pickSpread && (
            <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, background: pillBg(card.spreadResult), border: "1px solid var(--border)" }}>
              Spread: Pick • {card.pickSpread}
              {typeof card.spreadProb === "number" ? ` (${(card.spreadProb * 100).toFixed(1)}%)` : ""}
            </span>
          )}
          {card.pickTotal && (
            <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, background: pillBg(card.totalResult), border: "1px solid var(--border)" }}>
              Total: Pick • {card.pickTotal}
              {typeof card.totalProb === "number" ? ` (${(card.totalProb * 100).toFixed(1)}%)` : ""}
              
            </span>
          )}
        </div>
      )}

      {/* action buttons */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:4 }}>
        <button
          onClick={()=>{ setShowScores(s=>!s); setShowPlayers(false); }}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background: showScores ? "var(--brand)" : "var(--card)", color: showScores ? "var(--brand-contrast)" : "var(--text)" }}
        >
          {showScores ? "Hide Scores" : "Detailed Simulated Scores"}
        </button>
        <button
          onClick={()=>{ setShowPlayers(p=>!p); setShowScores(false); }}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background: showPlayers ? "var(--accent)" : "var(--card)", color: showPlayers ? "var(--brand-contrast)" : "var(--text)" }}
        >
          {showPlayers ? "Hide Player Stats" : "Detailed Simulated Player Stats"}
        </button>
      </div>

      {/* SCORES PANEL */}
      {showScores && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            {(["spread","total","teamLeft","teamRight"] as Metric[]).map(m => (
              <button key={m} onClick={()=>setMetric(m)}
                style={{ padding:"6px 10px", borderRadius:8, border:`1px solid ${metric===m?"var(--brand)":"var(--border)"}`, background: metric===m?"var(--brand)":"var(--card)", color: metric===m?"var(--brand-contrast)":"var(--text)" }}>
                {m==="spread"?"Spread":m==="total"?"Total":m==="teamLeft"?`${gdata.teamA} total`:`${gdata.teamB} total`}
              </button>
            ))}
            <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <button
                onClick={()=>setTeamOrder(t=>t===0?1:0)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
              >
                {teamOrder===0 ? `${gdata.teamA} vs ${gdata.teamB}` : `${gdata.teamB} vs ${gdata.teamA}`}
              </button>
              <label style={{ fontSize:12, color:"var(--muted)" }}>Bins:</label>
              <select value={String(bins)} onChange={(e)=>setBins(e.target.value==="auto" ? "auto" : Number(e.target.value))}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                <option value="auto">Auto</option><option value="20">20</option><option value="30">30</option><option value="40">40</option>
              </select>
              <label style={{ fontSize:12, color:"var(--muted)" }}>Line:</label>
              <NumberSpinner value={teamLine} onChange={setTeamLine} step={0.5} placeholder={metric==="spread" ? "-6.5" : "55.5"} />
            </div>
          </div>

          <div style={{ height: 180, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                <XAxis
                  dataKey="bin"
                  interval={0}
                  height={20}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(label: string) => {
                    if (!qScore) return "";
                    const { q1Label, medLabel, q3Label } = scoreTickLabels;
                    if (label === q1Label) return qScore.q1.toFixed(1);
                    if (label === medLabel) return qScore.med.toFixed(1);
                    if (label === q3Label) return qScore.q3.toFixed(1);
                    return "";
                  }}
                />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                  labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                  formatter={(v:any)=>[v,"Count"]}
                />
                {teamProb && lineBinLabel && (
                  <ReferenceLine x={lineBinLabel} ifOverflow="extendDomain" stroke="var(--accent)" strokeDasharray="4 4"
                    label={{ value:`Line ${teamProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }} />
                )}
                <Bar dataKey="count" name="Frequency">
                  {hist.map((_,i)=><Cell key={i} fill={i < hist.length/2 ? (aColors?.primary ?? "var(--brand)") : (bColors?.primary ?? "var(--accent)")} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {teamProb && (
            <div className="card" style={{ marginTop:6, padding:8, fontSize:13 }}>
              <b>Probability vs Line</b>
              <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                <span><b>Under (Cover)</b>: {(teamProb.under*100).toFixed(1)}% ({americanOdds(teamProb.under)})</span>
                <span><b>At</b>: {(teamProb.at*100).toFixed(1)}%</span>
                <span><b>Over (Not Cover)</b>: {(teamProb.over*100).toFixed(1)}% ({americanOdds(teamProb.over)})</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PLAYERS PANEL */}
      {showPlayers && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:8 }}>
            <select value={pTeam} onChange={e=>setPTeam(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
              {[card.teamA, card.teamB].map(t=> <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={pRole} onChange={e=>setPRole(e.target.value as Role)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
              <option>QB</option><option>Rusher</option><option>Receiver</option>
            </select>
            <select value={pPlayer} onChange={e=>setPPlayer(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
              {teamPlayersByRole(pTeam, pRole).map(n=> <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={pStat} onChange={e=>setPStat(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
              {statsFor(pTeam, pPlayer, pRole).map(s=> <option key={s} value={s}>{pretty(s)}</option>)}
            </select>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:12, color:"var(--muted)" }}>Line:</span>
              <NumberSpinner value={playerLine} onChange={setPlayerLine} step={0.5} />
            </div>
          </div>

          {!pValues.length ? (
            <div style={{ height:160, display:"grid", placeItems:"center", opacity:.7, marginTop:6 }}>No data for selection.</div>
          ) : (
            <>
              <div style={{ height: 180, marginTop: 6 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pHist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                    <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                    <XAxis
                      dataKey="bin"
                      interval={0}
                      height={20}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(label: string) => {
                        if (!qPlayer) return "";
                        const { q1Label, medLabel, q3Label } = pTickLabels;
                        if (label === q1Label) return qPlayer.q1.toFixed(1);
                        if (label === medLabel) return qPlayer.med.toFixed(1);
                        if (label === q3Label) return qPlayer.q3.toFixed(1);
                        return "";
                      }}
                    />
                    <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                      labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                      formatter={(v:any)=>[v,"Count"]}
                    />
                    {pProb && pLbl && (
                      <ReferenceLine x={pLbl} ifOverflow="extendDomain" stroke="var(--accent)" strokeDasharray="4 4"
                        label={{ value:`Line ${pProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }} />
                    )}
                    <Bar dataKey="count" name={`${pPlayer} • ${pretty(pStat)}`}>
                      {pHist.map((_,i)=><Cell key={i} fill={getTeamColors(pTeam)?.primary ?? "var(--brand)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {pProb && (
                <div className="card" style={{ marginTop:6, padding:8, fontSize:13 }}>
                  <b>Probability vs Line</b>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                    <span><b>Under</b>: {(pProb.under*100).toFixed(1)}% ({americanOdds(pProb.under)})</span>
                    <span><b>At</b>: {(pProb.at*100).toFixed(1)}%</span>
                    <span><b>Over</b>: {(pProb.over*100).toFixed(1)}% ({americanOdds(pProb.over)})</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
