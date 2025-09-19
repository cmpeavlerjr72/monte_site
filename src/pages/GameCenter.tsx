// src/pages/GameCenter.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { getTeamColors } from "../utils/teamColors";

/* --------------------- CSV discovery (scores + players) --------------------- */
// NOTE: We import URLs (preferred) and allow raws (fallback) to support local dev and static hosting.
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

type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };

function normSlashes(p: string) { return p.replace(/\\/g, "/"); }
function weekFromPath(p: string) {
  const s = normSlashes(p);
  return s.match(/\/(week[^/]+)\//i)?.[1].toLowerCase()
      ?? s.match(/\/data\/([^/]+)\//i)?.[1].toLowerCase()
      ?? "root";
}
function buildFiles(raw: Record<string,string>, url: Record<string,string>): FileInfo[] {
  const paths = Array.from(new Set([...Object.keys(raw), ...Object.keys(url)]));
  return paths.map((p) => ({
    path: p,
    week: weekFromPath(p),
    file: p.split("/").pop() || p,
    raw: raw[p],
    url: url[p],
  })).sort((a,b)=>a.file.localeCompare(b.file));
}
const scoreFilesAll = buildFiles(S_RAW, S_URL);
const playerFilesAll = buildFiles(P_RAW, P_URL);

/* --------------------- iPhone/Safari-safe CSV utilities --------------------- */
// 1) Safe CSV loader: prefer URL → fetch text; fallback to raw. Disable Papa worker on Safari.
async function parseCsvFromItemSafe<T = any>(
  item: { url?: string; raw?: string },
  papaOpts?: Papa.ParseConfig<T>,
  signal?: AbortSignal
): Promise<T[]> {
  let text = "";
  if (signal?.aborted) return [];
  // Prefer URL if present; make absolute (Safari hates worker+relative URLs)
  if (item?.url && item.url.trim()) {
    try {
      const abs = new URL(item.url, window.location.href).toString();
      const res = await fetch(abs, { cache: "no-store", signal });
      text = await res.text();
    } catch (e) {
      if ((e as any)?.name !== "AbortError") console.warn("CSV fetch failed:", item?.url, e);
    }
  }
  // Fallback to raw
  if (!text && item?.raw) text = item.raw;
  if (!text) return [];

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  return new Promise<T[]>((resolve, reject) => {
    Papa.parse<T>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      download: false,       // parsing a STRING
      worker: !isSafari,     // workers off on Safari/iOS
      ...(papaOpts as Papa.ParseConfig<T> | undefined),
      complete: (res) => resolve((res.data as T[]) ?? []),
      error: reject,
    } as Papa.ParseConfig<T>);
  });
}

// 2) Small concurrency limiter (throttle parallel fetch/parse)
async function pAllLimit<I, O>(
  items: I[],
  limit: number,
  worker: (i: I, idx: number) => Promise<O>
): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }).map(async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

/* --------------------- Types & helpers --------------------- */
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // normalized to A vs B
type GameMap = Record<string, GameData>;
type Metric = "spread" | "total" | "teamLeft" | "teamRight";

function sortedKey(a: string, b: string) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join("__");
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
  const edges:number[] = [];
  for (let x=start; x<=end+1e-9; x+=binWidth) edges.push(Number(x.toFixed(8)));

  const counts = new Array(edges.length-1).fill(0);
  for (const x of v) {
    let idx = Math.floor((x-start)/binWidth);
    if (idx<0) idx=0;
    if (idx>=counts.length) idx=counts.length-1;
    counts[idx]++;
  }
  return counts.map((c,i)=>{
    const s = edges[i], e = edges[i+1];
    return { bin: `${Number(s.toFixed(1))}–${Number(e.toFixed(1))}`, count:c, start:s, end:e };
  });
}

function summaryStats(values: number[]) {
  if (!values.length) return null as null | Record<string, number>;
  const v = values.slice().sort((a,b)=>a-b);
  const n = v.length;
  const mean = v.reduce((a,b)=>a+b,0)/n;
  const median = n%2 ? v[(n-1)/2] : (v[n/2-1]+v[n/2])/2;
  const p05 = v[Math.floor(0.05*(n-1))];
  const p25 = v[Math.floor(0.25*(n-1))];
  const p75 = v[Math.floor(0.75*(n-1))];
  const p95 = v[Math.floor(0.95*(n-1))];
  return { n, mean, median, p05, p25, p75, p95 };
}

function findBinLabelForValue(hist: HistBin[], x: number) {
  for (const h of hist) if (x>=h.start && x<h.end) return h.bin;
  if (hist.length && x===hist[hist.length-1].end) return hist[hist.length-1].bin;
  return undefined;
}

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

/* --------------------- Players: roles & canonical stats --------------------- */
type Role = "QB" | "Rusher" | "Receiver";
type PlayerMap = Record<string, Record<string, Partial<Record<Role, Record<string, number[]>>>>>;

interface PlayerObs { team: string; player: string; role: Role | null; stat: string; value: number; }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const STAT_SYNONYMS: Record<string, string> = {
  // QB
  pass_yds: "pass_yds", pass_yards: "pass_yds", passing_yards: "pass_yds", py: "pass_yds", passyards: "pass_yds",
  pass_td: "pass_td", pass_tds: "pass_td", passing_tds: "pass_td", ptd: "pass_td",
  int: "ints", ints: "ints", interception: "ints", interceptions: "ints",
  pass_att: "pass_att", pass_atts: "pass_att", pass_attempts: "pass_att", attempts: "pass_att", att: "pass_att",
  pass_cmp: "pass_cmp", pass_comp: "pass_cmp", completions: "pass_cmp", cmp: "pass_cmp",
  sacks: "sacks", sacked: "sacks", times_sacked: "sacks",

  // Rusher
  rush_yds: "rush_yds", rushing_yards: "rush_yds", ry: "rush_yds", rushyards: "rush_yds",
  rush_td: "rush_td", rushing_tds: "rush_td", rtd: "rush_td",
  rush_att: "rush_att", rush_atts: "rush_att", rushing_attempts: "rush_att", rush_attempts: "rush_att", carries: "rush_att",

  // Receiver
  rec_yds: "rec_yds", receiving_yards: "rec_yds", ryds: "rec_yds",
  rec_td: "rec_td", receiving_tds: "rec_td",
  receptions: "receptions", rec: "receptions", catches: "receptions",
};
const CANON_LABEL: Record<string, string> = {
  pass_yds: "Pass Yds", pass_td: "Pass TD", ints: "INT",
  pass_att: "Pass Att", pass_cmp: "Pass Cmp", sacks: "Sacks",
  rush_yds: "Rush Yds", rush_td: "Rush TD", rush_att: "Rush Att",
  rec_yds: "Rec Yds", rec_td: "Rec TD", receptions: "Receptions",
};
const ROLE_BY_CANON: Record<string, Role> = {
  pass_yds: "QB", pass_td: "QB", ints: "QB", pass_att: "QB", pass_cmp: "QB", sacks: "QB",
  rush_yds: "Rusher", rush_td: "Rusher", rush_att: "Rusher",
  rec_yds: "Receiver", rec_td: "Receiver", receptions: "Receiver",
};
function canonicalRoleFromValueKey(statKey: string): Role | null {
  const canon = STAT_SYNONYMS[norm(statKey)];
  return canon ? (ROLE_BY_CANON[canon] ?? null) : null;
}
function normalizeRole(rawRole: any): Role | null {
  if (rawRole == null) return null;
  const r = String(rawRole).toLowerCase().trim().replace(/\s+/g, "_");
  if (["qb","quarterback"].includes(r)) return "QB";
  if (["rb","hb","fb","running_back","runningback","rusher"].includes(r)) return "Rusher";
  if (["wr","te","receiver","wide_receiver","tight_end"].includes(r)) return "Receiver";
  return null;
}

/* --------------------- Small inputs --------------------- */
function NumberSpinner({
  value, onChange, step = 0.5, min, max, width = 120, placeholder,
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
      <button type="button" onClick={() => bump(-1)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}>−</button>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        style={{ width, padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
      />
      <button type="button" onClick={() => bump(1)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}>+</button>
    </div>
  );
}

/* --------------------- URL helpers for embed mode --------------------- */
function getSearchParam(name: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
const URL_WEEK = getSearchParam("week") || "";
const URL_PAIR = getSearchParam("pair") || "";

/* --------------------- Page --------------------- */
export default function GameCenter() {
  // Build week list from union of scores + players
  const weeks = useMemo(() => {
    const s = new Set<string>(scoreFilesAll.map(f=>f.week));
    for (const f of playerFilesAll) s.add(f.week);
    return Array.from(s).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  }, []);

  const filesByWeekScores = useMemo(() => {
    const m:Record<string,FileInfo[]> = {};
    for (const f of scoreFilesAll) (m[f.week] ||= []).push(f);
    return m;
  }, []);
  const filesByWeekPlayers = useMemo(() => {
    const m:Record<string,FileInfo[]> = {};
    for (const f of playerFilesAll) (m[f.week] ||= []).push(f);
    return m;
  }, []);

  const [selectedWeek, setSelectedWeek] = useState(weeks[0] ?? "");
  useEffect(() => {
    if (URL_WEEK && weeks.includes(URL_WEEK)) setSelectedWeek(URL_WEEK);
  }, [weeks]);

  const [loading, setLoading] = useState(false);

  // Games (from scores)
  const [games, setGames] = useState<GameMap>({});
  const [selectedKey, setSelectedKey] = useState<string|null>(null);
  const [search, setSearch] = useState("");

  // Players per role
  const [players, setPlayers] = useState<PlayerMap>({});

  // Chart controls
  const [metric, setMetric] = useState<Metric>("spread");
  const [teamOrder, setTeamOrder] = useState<0|1>(0);
  const [bins, setBins] = useState<number|"auto">("auto");

  // Lines
  const [teamLine, setTeamLine] = useState<string>("");
  const [playerLine, setPlayerLine] = useState<string>("");

  // Player detail controls
  const [detailTeam, setDetailTeam] = useState<string>("");
  const [detailPlayer, setDetailPlayer] = useState<string>("");
  const [detailRole, setDetailRole] = useState<Role>("QB");
  const [detailStat, setDetailStat] = useState<string>("");

  // Abort support
  const abortRef = useRef<AbortController | null>(null);

  /* --------- Load both score + player CSVs for the selected week --------- */
  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let alive = true;

    async function load() {
      setLoading(true);
      try {
        // ---- scores ----
        const sFiles = filesByWeekScores[selectedWeek] ?? [];
        const scoreArrays = await pAllLimit(sFiles, 3, async (item) => {
          const data = await parseCsvFromItemSafe<any>(item, undefined, ac.signal);
          return (data as any[])
            .filter(r => r && r.team!=null && r.opp!=null && r.pts!=null && r.opp_pts!=null)
            .map(r => ({ team:String(r.team), opp:String(r.opp), pts:Number(r.pts), opp_pts:Number(r.opp_pts) })) as SimRow[];
        });

        const gameMap: GameMap = {};
        for (const rows of scoreArrays) {
          const byPair = new Map<string, SimRow[]>();
          for (const r of rows) {
            const key = sortedKey(r.team, r.opp);
            (byPair.get(key) || (byPair.set(key, []), byPair.get(key)!)).push(r);
          }
          for (const [pair, arr] of byPair.entries()) {
            const [A,B] = pair.split("__");
            const normalized = arr
              .map(r => r.team===A && r.opp===B
                ? { team:A, opp:B, pts:r.pts, opp_pts:r.opp_pts }
                : { team:A, opp:B, pts:r.opp_pts, opp_pts:r.pts })
              .filter(Boolean) as SimRow[];
            (gameMap[pair] ||= { teamA:A, teamB:B, rowsA:[] }).rowsA.push(...normalized);
          }
        }
        if (!alive) return;
        setGames(gameMap);

        // Select default or honor ?pair=
        const defaultKey = URL_PAIR && gameMap[URL_PAIR] ? URL_PAIR : Object.keys(gameMap)[0] ?? null;
        setSelectedKey(defaultKey);
        setTeamOrder(0);

        // ---- players ----
        const pFiles = filesByWeekPlayers[selectedWeek] ?? [];
        const playerArrays = await pAllLimit(pFiles, 3, async (item) => {
          const data = await parseCsvFromItemSafe<any>(item, undefined, ac.signal);
          const out: PlayerObs[] = [];
          const metaKeys = new Set([
            "team","Team","school","School",
            "player","Player","name","Name",
            "opp","Opp",
            "role","Role","position","Position","pos","Pos",
            "stat","Stat","metric","Metric","category","Category","value","Value","amount","Amount","val","Val"
          ]);

          for (const raw of data as any[]) {
            if (!raw) continue;
            const team = String(raw.team ?? raw.Team ?? raw.school ?? raw.School ?? "");
            const player = String(raw.player ?? raw.Player ?? raw.name ?? raw.Name ?? "");
            if (!team || !player) continue;

            const roleFromField = normalizeRole(raw.role ?? raw.Role ?? raw.position ?? raw.Position ?? raw.pos ?? raw.Pos);

            // long format
            const statKey = raw.stat ?? raw.Stat ?? raw.metric ?? raw.Metric ?? raw.category ?? raw.Category;
            const valKey  = raw.value ?? raw.Value ?? raw.amount ?? raw.Amount ?? raw.val ?? raw.Val;
            if (statKey != null && valKey != null && isFinite(Number(valKey))) {
              const r = roleFromField ?? canonicalRoleFromValueKey(String(statKey));
              if (r) out.push({ team, player, role: r, stat: String(statKey), value: Number(valKey) });
              continue;
            }

            // wide format
            for (const k of Object.keys(raw)) {
              if (metaKeys.has(k)) continue;
              const v = Number(raw[k]);
              if (!Number.isFinite(v)) continue;
              const r = roleFromField ?? canonicalRoleFromValueKey(k);
              if (!r) continue;
              out.push({ team, player, role: r, stat: k, value: v });
            }
          }
          return out;
        });

        const pmap: PlayerMap = {};
        for (const arr of playerArrays) {
          for (const o of arr) {
            if (!o.role) continue;
            ((((pmap[o.team] ||= {})[o.player] ||= {})[o.role] ||= {})[o.stat] ||= []).push(o.value);
          }
        }
        if (!alive) return;
        setPlayers(pmap);

        // Initialize Player detail defaults from selected game
        const g = defaultKey ? gameMap[defaultKey] : undefined;
        const defaultTeam = g ? g.teamA : Object.keys(pmap)[0] ?? "";
        setDetailTeam(defaultTeam);
        const playersOnTeam = Object.keys(pmap[defaultTeam] || {}).sort();
        setDetailPlayer(playersOnTeam[0] ?? "");
        setDetailRole("QB");
        setDetailStat("");
        setTeamLine("");
        setPlayerLine("");

      } finally {
        if (alive) setLoading(false);
      }
    }

    if (selectedWeek) load();
    return () => { alive = false; ac.abort(); };
  }, [selectedWeek, filesByWeekScores, filesByWeekPlayers]);

  /* -------- Derived for team charts -------- */
  const selectedGame = selectedKey ? games[selectedKey] : null;

  const series = useMemo(() => {
    if (!selectedGame) return [] as number[];
    const A = selectedGame.rowsA.map(r=>r.pts);
    const B = selectedGame.rowsA.map(r=>r.opp_pts);
    const left  = teamOrder===0 ? A : B;
    const right = teamOrder===0 ? B : A;

    switch (metric) {
      case "spread":    return left.map((x,i)=> x - right[i]); // left minus right
      case "total":     return left.map((x,i)=> x + right[i]);
      case "teamLeft":  return left;
      case "teamRight": return right;
    }
  }, [selectedGame, teamOrder, metric]);

  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin[];
    const binsNum = bins === "auto" ? undefined : Number(bins);
    return computeHistogram(series, binsNum ? { bins: binsNum } : undefined);
  }, [series, bins]);

  const stats = useMemo(() => summaryStats(series), [series]);

  const teams = selectedGame ? [selectedGame.teamA, selectedGame.teamB] : ["—","—"];
  const leftTeam = teams[teamOrder===0?0:1];
  const rightTeam = teams[teamOrder===0?1:0];
  const leftColor  = getTeamColors(leftTeam)?.primary  ?? "var(--brand)";
  const rightColor = getTeamColors(rightTeam)?.primary ?? "var(--accent)";

  // Team line probability vs distribution
  const teamProb = useMemo(() => {
    if (!series.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(teamLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of series) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = series.length;
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [series, teamLine]);
  const teamLineBin = useMemo(() => (teamProb && hist.length ? findBinLabelForValue(hist, teamProb.line) : undefined), [teamProb, hist]);

  // Dynamic bar colors (nice for spread left/right)
  const binColors = useMemo(() => {
    if (!hist.length) return [] as string[];
    if (metric === "spread") {
      return hist.map(h => {
        const mid = (h.start + h.end) / 2;
        if (mid < 0) return rightColor; // right covers (right - left > 0) → for spread we used (left-right), so <0 favors right
        if (mid > 0) return leftColor;
        return "var(--border)";
      });
    }
    if (metric === "total") {
      const med = stats?.median ?? 0;
      return hist.map(h => ((h.start + h.end) / 2) < med ? leftColor : rightColor);
    }
    if (metric === "teamLeft")  return hist.map(() => leftColor);
    if (metric === "teamRight") return hist.map(() => rightColor);
    return hist.map(() => "var(--brand)");
  }, [hist, metric, leftColor, rightColor, stats?.median]);

  /* -------- Derived for player chart -------- */
  const teamPlayersByRole = (team: string, role: Role) =>
    Object.keys(players[team] || {}).filter(p => !!players[team]?.[p]?.[role]).sort();
  const statsFor = (team: string, player: string, role: Role) =>
    Object.keys(players[team]?.[player]?.[role] || {}).sort();

  // Keep dependent selections sane when team/role/player changes
  const defaultPlayer = useMemo(() => teamPlayersByRole(detailTeam, detailRole)[0] || "", [detailTeam, detailRole, players]);
  useEffect(()=>{ setDetailPlayer((p)=> p && players[detailTeam]?.[p]?.[detailRole] ? p : defaultPlayer); }, [defaultPlayer, detailTeam, detailRole, players]);

  const defaultStat = useMemo(() => statsFor(detailTeam, detailPlayer, detailRole)[0] || "", [detailTeam, detailPlayer, detailRole, players]);
  useEffect(()=>{ setDetailStat((s)=> s && players[detailTeam]?.[detailPlayer]?.[detailRole]?.[s] ? s : defaultStat); }, [defaultStat, detailTeam, detailPlayer, detailRole, players]);

  const pValues = players[detailTeam]?.[detailPlayer]?.[detailRole]?.[detailStat] || [];
  const pHist = useMemo(() => computeHistogram(pValues, { bins: 20 }), [pValues]);

  const pProb = useMemo(() => {
    if (!pValues.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(playerLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of pValues) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = pValues.length; return { under:u/n, at:a/n, over:o/n, line:L };
  }, [pValues, playerLine]);
  const pLineBin = useMemo(() => (pProb && pHist.length ? findBinLabelForValue(pHist, pProb.line) : undefined), [pProb, pHist]);

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
    <div key={selectedWeek} style={{ display: "grid", gap: 16 }}>
      {/* Top controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label>
          Week:&nbsp;
          <select
            value={selectedWeek}
            onChange={(e) => { setSelectedWeek(e.target.value); (e.target as HTMLSelectElement).blur(); }}
            style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
          >
            {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <span style={{ opacity: 0.7 }}>{loading ? "Loading…" : `${Object.keys(games).length} games`}</span>
        <input
          placeholder="Search team…"
          value={search}
          onChange={(e)=>setSearch(e.target.value)}
          style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 280px) 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left list */}
        <div
          className="card"
          style={{
            border: "1px solid var(--border)", borderRadius: 12, padding: 8, background: "var(--card)",
            maxHeight: 520, overflow: "auto", contentVisibility:"auto", containIntrinsicSize: "300px",
          }}
        >
          {Object.entries(games)
            .filter(([key,g]) => key.toLowerCase().includes(search.toLowerCase())
              || g.teamA.toLowerCase().includes(search.toLowerCase())
              || g.teamB.toLowerCase().includes(search.toLowerCase()))
            .map(([key,g]) => (
            <div
              key={key}
              onClick={() => { setSelectedKey(key); setTeamOrder(0); }}
              style={{
                padding: 8, borderRadius: 8, cursor: "pointer",
                background: selectedKey===key ? "color-mix(in oklab, var(--brand) 12%, white)" : "transparent",
              }}
            >
              <strong>{g.teamA}</strong> vs <strong>{g.teamB}</strong>
            </div>
          ))}
        </div>

        {/* Right side: charts */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* Team distribution card */}
          <article
            className="card"
            style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--card)" }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={metric}
                onChange={(e)=>setMetric(e.target.value as Metric)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
              >
                <option value="spread">Spread ({leftTeam} − {rightTeam})</option>
                <option value="total">Total</option>
                <option value="teamLeft">{leftTeam} total</option>
                <option value="teamRight">{rightTeam} total</option>
              </select>
              <button
                type="button"
                onClick={()=>setTeamOrder(teamOrder===0?1:0)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
              >
                Flip Sides ({rightTeam} ⇄ {leftTeam})
              </button>
              <label style={{ marginLeft: 4 }}>
                Bins:&nbsp;
                <select
                  value={String(bins)}
                  onChange={(e)=>setBins(e.target.value==="auto"?"auto":Number(e.target.value))}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
                >
                  <option value="auto">Auto</option>
                  <option value="20">20</option>
                  <option value="30">30</option>
                  <option value="40">40</option>
                </select>
              </label>

              {/* Line control (optional) */}
              <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:"auto" }}>
                <span style={{ fontSize:12, color:"var(--muted)" }}>Line:</span>
                <NumberSpinner
                  value={teamLine}
                  onChange={setTeamLine}
                  step={0.5}
                  placeholder={metric==="spread" ? "-6.5" : "55.5"}
                />
              </div>
            </div>

            <div style={{ height: 360, marginTop: 8 }}>
              <ResponsiveContainer>
                <BarChart data={hist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.25} />
                  <XAxis dataKey="bin" minTickGap={12} tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} width={28} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                    labelStyle={{ color:"var(--muted)" }}
                    itemStyle={{ color:"var(--text)" }}
                  />
                  {/* 0 line only helps when the Y axis can be negative; our chart is frequency. Keep a neutral baseline via color. */}
                  {teamProb && teamLineBin && (
                    <ReferenceLine
                      x={teamLineBin}
                      ifOverflow="extendDomain"
                      stroke="var(--accent)"
                      strokeDasharray="4 4"
                      label={{ value:`Line ${teamProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }}
                    />
                  )}
                  <Bar dataKey="count" name="Frequency">
                    {hist.map((_, i) => <Cell key={i} fill={binColors[i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {!!stats && (
              <div style={{ marginTop: 8, opacity: 0.85, fontSize: 13 }}>
                n={stats.n} • mean {stats.mean.toFixed(2)} • med {stats.median.toFixed(2)} • 5–95% {stats.p05.toFixed(1)}–{stats.p95.toFixed(1)}
              </div>
            )}

            {teamProb && (
              <div className="card" style={{ marginTop:8, padding:8, fontSize:13 }}>
                <b>Probability vs Line</b>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                  <span><b>Under</b>: {(teamProb.under*100).toFixed(1)}% ({americanOdds(teamProb.under)})</span>
                  <span><b>At</b>: {(teamProb.at*100).toFixed(1)}%</span>
                  <span><b>Over</b>: {(teamProb.over*100).toFixed(1)}% ({americanOdds(teamProb.over)})</span>
                </div>
              </div>
            )}
          </article>

          {/* Player distribution card */}
          <article
            className="card"
            style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--card)", contentVisibility:"auto", containIntrinsicSize:"360px" }}
          >
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:8 }}>
              <select value={detailTeam} onChange={e=>setDetailTeam(e.target.value)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                {selectedGame ? [selectedGame.teamA, selectedGame.teamB].map(t=> <option key={t} value={t}>{t}</option>) :
                 Object.keys(players).sort().map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={detailRole} onChange={e=>setDetailRole(e.target.value as Role)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                <option>QB</option><option>Rusher</option><option>Receiver</option>
              </select>
              <select value={detailPlayer} onChange={e=>setDetailPlayer(e.target.value)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                {teamPlayersByRole(detailTeam, detailRole).map(n=> <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={detailStat} onChange={e=>setDetailStat(e.target.value)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                {statsFor(detailTeam, detailPlayer, detailRole).map(s=> <option key={s} value={s}>{CANON_LABEL[STAT_SYNONYMS[norm(s)] ?? norm(s)] ?? s}</option>)}
              </select>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:12, color:"var(--muted)" }}>Line:</span>
                <NumberSpinner value={playerLine} onChange={setPlayerLine} step={0.5} />
              </div>
            </div>

            {!pValues.length ? (
              <div style={{ height:180, display:"grid", placeItems:"center", opacity:.7, marginTop:6 }}>No data for selection.</div>
            ) : (
              <>
                <div style={{ height: 280, marginTop: 6 }}>
                  <ResponsiveContainer>
                    <BarChart data={pHist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                      <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                      <XAxis dataKey="bin" minTickGap={12} tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                        labelStyle={{ color:"var(--muted)" }}
                        itemStyle={{ color:"var(--text)" }}
                      />
                      {pProb && pLineBin && (
                        <ReferenceLine
                          x={pLineBin}
                          ifOverflow="extendDomain"
                          stroke="var(--accent)"
                          strokeDasharray="4 4"
                          label={{ value:`Line ${pProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }}
                        />
                      )}
                      <Bar dataKey="count" name={`${detailPlayer} • ${CANON_LABEL[STAT_SYNONYMS[norm(detailStat)] ?? norm(detailStat)] ?? detailStat}`}>
                        {pHist.map((_,i)=><Cell key={i} fill={getTeamColors(detailTeam)?.primary ?? "var(--brand)"} />)}
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
          </article>
        </div>
      </div>
    </div>
  );
}
