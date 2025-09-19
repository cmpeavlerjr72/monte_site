import { useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { getTeamColors } from "../utils/teamColors";

/* --------------------- CSV discovery (scores + players) --------------------- */
// scores
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

// players
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

/* --------------------- Types & helpers --------------------- */
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // normalized to A vs B
type GameMap = Record<string, GameData>;

type Metric = "spread" | "total" | "teamLeft" | "teamRight";

function sortedKey(a: string, b: string) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join("__");
}

type HistBin_1 = { bin: string; count: number; start: number; end: number };

function computeHistogram(values: number[], opts?: { bins?: number; binWidth?: number }): HistBin_1[] {
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

function NumberSpinner({
  value,
  onChange,
  step = 0.5,
  min,
  max,
  width = 140,
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  step?: number;
  min?: number;
  max?: number;
  width?: number;
  placeholder?: string;
}) {
  const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const clamp = (n: number) =>
    Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));

  const bump = (dir: -1 | 1) => {
    const curr = toNum(value);
    const base = Number.isFinite(curr) ? curr : 0;
    const next = clamp(base + dir * step);
    onChange(next.toFixed(1));
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={() => bump(-1)}
        style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}
      >
        −
      </button>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        style={{
          width,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--card)",
        }}
      />
      <button
        type="button"
        onClick={() => bump(1)}
        style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}
      >
        +
      </button>
    </div>
  );
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
type HistBin_2 = { bin: string; count: number; start: number; end: number };
function findBinLabelForValue(hist: HistBin_2[], x: number) {
  for (const h of hist) if (x>=h.start && x<h.end) return h.bin;
  if (hist.length && x===hist[hist.length-1].end) return hist[hist.length-1].bin;
  return undefined;
}

/* --------------------- Roles & stat canonicalization --------------------- */
type Role = "QB" | "Rusher" | "Receiver";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

// canonical stat keys
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

// pretty labels
const CANON_LABEL: Record<string, string> = {
  pass_yds: "Pass Yds", pass_td: "Pass TD", ints: "INT",
  pass_att: "Pass Att", pass_cmp: "Pass Cmp", sacks: "Sacks",
  rush_yds: "Rush Yds", rush_td: "Rush TD", rush_att: "Rush Att",
  rec_yds: "Rec Yds", rec_td: "Rec TD", receptions: "Receptions",
};

// canonical stat -> canonical role
const ROLE_BY_CANON: Record<string, Role> = {
  pass_yds: "QB", pass_td: "QB", ints: "QB", pass_att: "QB", pass_cmp: "QB", sacks: "QB",
  rush_yds: "Rusher", rush_td: "Rusher", rush_att: "Rusher",
  rec_yds: "Receiver", rec_td: "Receiver", receptions: "Receiver",
};

// columns per role (display order)
const COLUMNS: Record<Role, string[]> = {
  QB: ["pass_yds", "pass_td", "ints", "pass_att", "pass_cmp", "sacks"],
  Rusher: ["rush_yds", "rush_td", "rush_att"],
  Receiver: ["rec_yds", "rec_td", "receptions"],
};

function aggregateCanon(stats: Record<string, number[]>) {
  const agg: Record<string, number[]> = {};
  for (const k of Object.keys(stats)) {
    const c = STAT_SYNONYMS[norm(k)];
    if (!c) continue;
    (agg[c] ||= []).push(...stats[k]);
  }
  return agg;
}

function median(arr:number[]) { const s=[...arr].sort((a,b)=>a-b); const n=s.length; return n? (n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0; }

function canonicalRoleFromValueKey(statKey: string): Role | null {
  const canon = STAT_SYNONYMS[norm(statKey)];
  return canon ? (ROLE_BY_CANON[canon] ?? null) : null;
}

function normalizeRole(rawRole: any): Role | null {
  if (rawRole == null) return null;
  const r = String(rawRole).toLowerCase().trim();
  if (["qb","quarterback"].includes(r)) return "QB";
  if (["rb","hb","fb","running back","running_back","runningback","rusher"].includes(r.replace(/\s+/g,"_"))) return "Rusher";
  if (["wr","te","receiver","wide receiver","wide_receiver","tight end","tight_end"].includes(r.replace(/\s+/g,"_"))) return "Receiver";
  return null;
}

/* --------------------- Players data model --------------------- */
// team -> player -> role -> stat -> values[]
type PlayerMap = Record<string, Record<string, Partial<Record<Role, Record<string, number[]>>>>>;
interface PlayerObs { team: string; player: string; role: Role | null; stat: string; value: number; }

/* --------------------- URL helpers for embed mode --------------------- */
function getSearchParam(name: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
const EMBED_FLAG = getSearchParam("embed") === "1";
const URL_WEEK = getSearchParam("week") || "";
const URL_PAIR = getSearchParam("pair") || "";

/* --------------------- Page --------------------- */
export default function GameCenter() {
  // Build week lists from either scores or players (union)
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
  // honor ?week=
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

  // separate lines
  const [teamLine, setTeamLine] = useState<string>("");       // team-level line
  const [playerLine, setPlayerLine] = useState<string>("");   // player-level line

  // Player detail
  const [detailTeam, setDetailTeam] = useState<string>("");
  const [detailPlayer, setDetailPlayer] = useState<string>("");
  const [detailRole, setDetailRole] = useState<Role>("QB");
  const [detailStat, setDetailStat] = useState<string>("");

  /* --------- Load both score + player CSVs for the selected week --------- */
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        /* ---- scores ---- */
        const sFiles = filesByWeekScores[selectedWeek] ?? [];
        const scoreArrays = await Promise.all(
          sFiles.map(
            (item) =>
              new Promise<SimRow[]>((resolve, reject) => {
                const parse = (text: string) =>
                  Papa.parse(text, {
                    header: true, dynamicTyping: true, skipEmptyLines: true,
                    complete: (res) => {
                      try {
                        const rows = (res.data as any[])
                          .filter(r => r && r.team!=null && r.opp!=null && r.pts!=null && r.opp_pts!=null)
                          .map(r => ({ team:String(r.team), opp:String(r.opp), pts:Number(r.pts), opp_pts:Number(r.opp_pts) })) as SimRow[];
                        resolve(rows);
                      } catch (e) { reject(e); }
                    },
                    error: reject,
                  });
                if (item.raw) parse(item.raw);
                else if (item.url) fetch(item.url).then(r=>r.text()).then(parse).catch(reject);
                else reject(new Error("No raw/url for "+item.path));
              })
          )
        );

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
                : r.team===B && r.opp===A
                ? { team:A, opp:B, pts:r.opp_pts, opp_pts:r.pts }
                : null)
              .filter(Boolean) as SimRow[];
            (gameMap[pair] ||= { teamA:A, teamB:B, rowsA:[] }).rowsA.push(...normalized);
          }
        }
        setGames(gameMap);
        setSelectedKey(Object.keys(gameMap)[0] ?? null);
        setTeamOrder(0);

        /* ---- players (per role) ---- */
        const pFiles = filesByWeekPlayers[selectedWeek] ?? [];
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

                          // determine role
                          const roleFromField = normalizeRole(raw.role ?? raw.Role ?? raw.position ?? raw.Position ?? raw.pos ?? raw.Pos);

                          // long format
                          const statKey = raw.stat ?? raw.Stat ?? raw.metric ?? raw.Metric ?? raw.category ?? raw.Category;
                          const valKey  = raw.value ?? raw.Value ?? raw.amount ?? raw.Amount ?? raw.val ?? raw.Val;
                          if (statKey != null && valKey != null && isFinite(Number(valKey))) {
                            const r = roleFromField ?? canonicalRoleFromValueKey(String(statKey));
                            if (r) out.push({ team, player, role: r, stat: String(statKey), value: Number(valKey) });
                            continue;
                          }

                          // wide format; use role column if present; else infer per stat
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
                else reject(new Error("No raw/url for "+item.path));
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
    load();
  }, [selectedWeek, filesByWeekScores, filesByWeekPlayers]);

  // when games loaded, honor ?pair=
  useEffect(() => {
    if (URL_PAIR && games[URL_PAIR]) {
      setSelectedKey(URL_PAIR);
      setTeamOrder(0);
    }
  }, [games]);

  /* -------- Derived for team charts -------- */
  const selectedGame = selectedKey ? games[selectedKey] : null;

  const series = useMemo(
    () => {
      if (!selectedGame) return [] as number[];
      const A = selectedGame.rowsA.map(r=>r.pts);
      const B = selectedGame.rowsA.map(r=>r.opp_pts);
      const left  = teamOrder===0 ? A : B;
      const right = teamOrder===0 ? B : A;

      switch (metric) {
        case "teamLeft": return left;
        case "teamRight": return right;
        case "total": return left.map((x,i)=>x+right[i]);
        case "spread": default: return right.map((x,i)=>x-left[i]);
      }
    },
    [selectedGame, metric, teamOrder]
  );

  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin_1[];
    const opts:any = {}; if (bins!=="auto") opts.bins = Math.max(1, Number(bins));
    return computeHistogram(series, opts);
  }, [series, bins]);
  const stats = useMemo(() => summaryStats(series), [series]);

  // TEAM probability uses teamLine
  const teamProb = useMemo(() => {
    if (!series.length) return null;
    const L = Number(teamLine);
    if (!Number.isFinite(L)) return null;
    let u = 0, a = 0, o = 0;
    for (const x of series) {
      if (Math.abs(x - L) < 1e-9) a++;
      else if (x < L) u++;
      else o++;
    }
    const n = series.length;
    return { under: u / n, at: a / n, over: o / n, line: L };
  }, [series, teamLine]);

  const leftName  = selectedGame ? (teamOrder===0 ? selectedGame.teamA : selectedGame.teamB) : "";
  const rightName = selectedGame ? (teamOrder===0 ? selectedGame.teamB : selectedGame.teamA) : "";
  const leftColor  = getTeamColors(leftName)?.primary  ?? "var(--brand)";
  const rightColor = getTeamColors(rightName)?.primary ?? "var(--accent)";

  const binColors = useMemo(() => {
    if (!hist.length || !selectedGame) return [] as string[];
    if (metric==="spread") {
      return hist.map(h => {
        const mid = (h.start+h.end)/2;
        if (mid<0) return leftColor;
        if (mid>0) return rightColor;
        return "var(--border)";
      });
    }
    if (metric==="total") {
      const med = stats?.median ?? 0;
      return hist.map(h => ((h.start+h.end)/2) < med ? leftColor : rightColor);
    }
    if (metric==="teamLeft")  return hist.map(()=>leftColor);
    if (metric==="teamRight") return hist.map(()=>rightColor);
    return hist.map(()=> "var(--brand)");
  }, [hist, selectedGame, metric, leftColor, rightColor, stats?.median]);

  const lineBinLabel = useMemo(
    () => (teamProb && hist.length ? findBinLabelForValue(hist, teamProb.line) : undefined),
    [teamProb, hist]
  );

  const filteredEntries = useMemo(() => {
    const entries = Object.entries(games) as [string, GameData][];
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(([_,g]) => g.teamA.toLowerCase().includes(q) || g.teamB.toLowerCase().includes(q));
  }, [games, search]);

  /* -------- Helpers for player boxscore -------- */
  const teamPlayersByRole = (team: string, role: Role) =>
    Object.keys(players[team] || {})
      .filter(p => !!players[team]?.[p]?.[role])
      .sort();

  const playerStatsForRole = (team: string, player: string, role: Role) =>
    Object.keys(players[team]?.[player]?.[role] || {}).sort();

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

  // Median team totals (scoreboard style)
  const medLeft  = useMemo(() => {
    if (!selectedGame) return 0;
    const A = selectedGame.rowsA.map(r=>r.pts);
    const B = selectedGame.rowsA.map(r=>r.opp_pts);
    const L = teamOrder===0 ? A : B;
    return median(L);
  }, [selectedGame, teamOrder]);
  const medRight = useMemo(() => {
    if (!selectedGame) return 0;
    const A = selectedGame.rowsA.map(r=>r.pts);
    const B = selectedGame.rowsA.map(r=>r.opp_pts);
    const R = teamOrder===0 ? B : A;
    return median(R);
  }, [selectedGame, teamOrder]);

  /* --------------------- UI --------------------- */
  return (
    <div
      style={{
        display:"grid",
        gap:24,
        gridTemplateColumns:"1fr",
        maxWidth: EMBED_FLAG ? "unset" : 1200,
        margin: EMBED_FLAG ? "0" : "0 auto"
      }}
    >
      {/* Top controls: hide in embed */}
      {!EMBED_FLAG && (
        <section className="card" style={{ padding:16 }}>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:"var(--brand)" }}>Week</h2>
          <div style={{ marginTop:8, display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
            <select
              value={selectedWeek}
              onChange={(e)=>setSelectedWeek(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            >
              {weeks.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <span style={{ fontSize:12, opacity:0.7 }}>{loading ? "Loading…" : "Ready"}</span>
          </div>
        </section>
      )}

      {!EMBED_FLAG && (
        <section className="card" style={{ padding:16 }}>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:"var(--brand)" }}>Find a game</h2>
          <input
            value={search}
            onChange={(e)=>setSearch(e.target.value)}
            placeholder="Search teams…"
            style={{ marginTop:8, width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
          />
          <div style={{ marginTop:12, maxHeight:220, overflow:"auto", display:"grid", gap:8 }}>
            {filteredEntries.map(([key,g]) => (
              <button
                key={key}
                onClick={()=>{ setSelectedKey(key); setTeamOrder(0); }}
                style={{
                  textAlign:"left", padding:"10px 12px", borderRadius:10,
                  border:`1px solid ${selectedKey===key ? "var(--brand)":"var(--border)"}`,
                  background: selectedKey===key ? "color-mix(in oklab, var(--brand) 10%, white)" : "var(--card)",
                  cursor:"pointer"
                }}
              >
                <div style={{ fontWeight:600 }}>{g.teamA} vs {g.teamB}</div>
              </button>
            ))}
            {!filteredEntries.length && <div style={{ opacity:.7 }}>No games.</div>}
          </div>
        </section>
      )}

      {/* Median team totals (scoreboard) */}
      <section className="card" style={{ padding:16 }}>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:"var(--brand)" }}>Median Team Totals</h2>
        {!selectedGame ? (
          <div style={{ marginTop:8, opacity:.7 }}>Select a game.</div>
        ) : (
          <div style={{
            marginTop:12, display:"grid", gridTemplateColumns:"1fr auto 1fr",
            alignItems:"center", gap:16, background:"color-mix(in oklab, var(--brand) 6%, white)",
            borderRadius:12, padding:"12px 16px"
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, color:leftColor }}>
              <i style={{ width:12, height:12, background:leftColor, borderRadius:999 }} />
              <div style={{ fontWeight:800 }}>{leftName}</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", justifyItems:"center", gap:12 }}>
              <div style={{ fontWeight:800, fontSize:40, lineHeight:1, color:leftColor }}>{Math.round(medLeft)}</div>
              <div style={{ fontWeight:700, opacity:.75 }}>vs</div>
              <div style={{ fontWeight:800, fontSize:40, lineHeight:1, color:rightColor }}>{Math.round(medRight)}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, justifyContent:"end", color:rightColor }}>
              <div style={{ fontWeight:800 }}>{rightName}</div>
              <i style={{ width:12, height:12, background:rightColor, borderRadius:999 }} />
            </div>
          </div>
        )}
      </section>

      {/* Metric & options */}
      <section className="card" style={{ padding:16 }}>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:"var(--brand)" }}>Custom Spread / Totals</h2>

        <div style={{ marginTop:8, display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:8 }}>
          {(["spread","total","teamLeft","teamRight"] as Metric[]).map(m => (
            <button
              key={m}
              onClick={()=>setMetric(m)}
              style={{
                padding:"8px 10px", borderRadius:10,
                border:`1px solid ${metric===m ? "var(--brand)" : "var(--border)"}`,
                background: metric===m ? "var(--brand)" : "var(--card)",
                color: metric===m ? "var(--brand-contrast)" : "var(--text)"
              }}
            >
              {m==="spread" ? "Spread" : m==="total" ? "Total" : m==="teamLeft" ? "Left team total" : "Right team total"}
            </button>
          ))}
        </div>

        <div style={{ marginTop:10, display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
          <div>
            <span style={{ marginRight:8 }}>Orientation:</span>
            <button
              disabled={!selectedGame}
              onClick={()=>setTeamOrder(prev=>prev===0?1:0)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            >
              {selectedGame ? (teamOrder===0 ? `${selectedGame.teamA} vs ${selectedGame.teamB}` : `${selectedGame.teamB} vs ${selectedGame.teamA}`) : "—"}
            </button>
          </div>

          <div>
            <span style={{ marginRight:8 }}>Bins:</span>
            <select
              value={String(bins)}
              onChange={(e)=>setBins(e.target.value==="auto" ? "auto" : Number(e.target.value))}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            >
              <option value="auto">Auto</option>
              <option value="10">10</option><option value="20">20</option>
              <option value="30">30</option><option value="40">40</option><option value="50">50</option>
            </select>
          </div>

          <div>
            <span style={{ marginRight:8 }}>Line:</span>
            <NumberSpinner
              value={teamLine}
              onChange={setTeamLine}
              step={0.5}
              placeholder={metric === "spread" ? "e.g., -6.5" : "e.g., 55.5"}
            />
          </div>
        </div>

        <div style={{ marginTop:12 }}>
          {!selectedGame || !hist.length ? (
            <div style={{ height:300, display:"grid", placeItems:"center", opacity:.6 }}>Select a game to see chart.</div>
          ) : (
            <div style={{ height:300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hist} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} />
                  <XAxis dataKey="bin" angle={-30} textAnchor="end" interval={0} height={50} />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                    labelStyle={{ color:"var(--muted)" }}
                    itemStyle={{ color:"var(--text)" }}
                    formatter={(v:any)=>[v,"Count"]}
                  />
                  <Legend />
                  {teamProb && lineBinLabel && (
                    <ReferenceLine
                      x={lineBinLabel}
                      ifOverflow="extendDomain"
                      stroke="var(--accent)"
                      strokeDasharray="4 4"
                      label={{ value:`Line ${teamProb.line}`, position:"top", fontSize:12, fill:"var(--accent)" }}
                    />
                  )}
                  <Bar dataKey="count" name="Frequency">
                    {hist.map((_,i)=><Cell key={i} fill={binColors[i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ marginTop:10, fontSize:12, color:"var(--muted)" }}>
            Spread uses <b>Right − Left</b> under the current Orientation.
          </div>

          <div className="card" style={{ marginTop:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6, color:"var(--brand)" }}>Probability vs Line</div>
            {teamProb ? (
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:14 }}>
                <span><b>Under</b>: {(teamProb.under*100).toFixed(1)}%</span>
                <span><b>At</b>: {(teamProb.at*100).toFixed(1)}%</span>
                <span><b>Over</b>: {(teamProb.over*100).toFixed(1)}%</span>
              </div>
            ) : (
              <div style={{ opacity:.7, fontSize:14 }}>Enter a numeric line to see probabilities.</div>
            )}
          </div>
        </div>
      </section>

      {/* Boxscore: grouped by role with per-stat medians (role-filtered) */}
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>
          Boxscore (Median by Player)
        </h2>

        {!selectedGame ? (
          <div style={{ marginTop: 8, opacity: 0.7 }}>Select a game.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
            {[{ team: leftName, color: leftColor }, { team: rightName, color: rightColor }].map(({ team, color }) => {
              const renderGroup = (role: Role) => {
                const cols = COLUMNS[role];
                const names = teamPlayersByRole(team, role);
                if (!names.length) return null;

                return (
                  <div key={role} className="card" style={{ padding: 12, borderColor: "var(--border)", marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <i style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
                      <div style={{ fontWeight: 800 }}>
                        {team} • {role === "QB" ? "QBs" : role === "Rusher" ? "Rushers" : "Receivers"}
                      </div>
                    </div>

                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Player</th>
                            {cols.map((canon) => (
                              <th key={canon} style={{ textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" }}>
                                {CANON_LABEL[canon]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {names.map((name) => {
                            const rawStats = (players[team]?.[name]?.[role]) || {};
                            const agg = aggregateCanon(rawStats);
                            const val = (canon: string) =>
                              agg[canon] && agg[canon].length ? Math.round(median(agg[canon])) : "—";

                            // default stat for detail panel for this role
                            const defaultCanon = cols[0];
                            const defaultRawKey =
                              Object.keys(rawStats).find((k) => STAT_SYNONYMS[norm(k)] === defaultCanon) ||
                              Object.keys(rawStats)[0] ||
                              "";

                            return (
                              <tr key={name} style={{ borderTop: "1px solid var(--border)" }}>
                                <td style={{ padding: "6px 8px" }}>
                                  <button
                                    onClick={() => {
                                      setDetailTeam(team);
                                      setDetailPlayer(name);
                                      setDetailRole(role);
                                      setDetailStat(defaultRawKey);
                                      setPlayerLine(""); // reset player line when opening a new player/role
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "var(--brand)",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {name}
                                  </button>
                                </td>
                                {cols.map((canon) => (
                                  <td key={canon} style={{ padding: "6px 8px", textAlign: "right" }}>
                                    {val(canon)}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              };

              return (
                <div key={team} className="card" style={{ padding: 12, borderColor: "var(--border)" }}>
                  {renderGroup("QB")}
                  {renderGroup("Rusher")}
                  {renderGroup("Receiver")}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Player detail panel (hist + O/U) */}
      {detailTeam && detailPlayer && (
        <section className="card" style={{ padding:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:"var(--brand)" }}>
              {detailPlayer} — {detailTeam} • {detailRole}
            </h2>
            <button
              onClick={()=>{ setDetailTeam(""); setDetailPlayer(""); setDetailStat(""); }}
              className="btn"
              style={{ background:"transparent", color:"var(--text)", border:"1px solid var(--border)" }}
            >
              Close
            </button>
          </div>

          <div style={{ marginTop:8, display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
            <span>Stat:</span>
            <select
              value={detailStat}
              onChange={(e)=>setDetailStat(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            >
              {playerStatsForRole(detailTeam, detailPlayer, detailRole).map(s => (
                <option key={s} value={s}>{pretty(s)}</option>
              ))}
            </select>
            <span>Line:</span>
            <input
              value={playerLine}
              inputMode="decimal"
              onChange={(e)=>setPlayerLine(e.target.value)}
              style={{ width:120, padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}
            />
          </div>

          <PlayerChart
            team={detailTeam}
            player={detailPlayer}
            role={detailRole}
            stat={detailStat}
            values={(players[detailTeam]?.[detailPlayer]?.[detailRole]?.[detailStat]) || []}
            line={playerLine}
          />
        </section>
      )}
    </div>
  );
}

/* --------------------- Player chart component --------------------- */
function PlayerChart({
  team, player, role, stat, values, line,
}: {
  team:string; player:string; role:Role; stat:string; values:number[]; line:string;
}) {
  const color = getTeamColors(team)?.primary ?? "var(--brand)";
  const hist = useMemo<HistBin_2[]>(() => {
    if (!values.length) return [];
    return computeHistogram(values, { bins: 20 });
  }, [values]);

  const prob = useMemo(() => {
    if (!values.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(line); if (!Number.isFinite(L)) return null;
    const n = values.length; let u=0,a=0,o=0;
    for (const x of values) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [values, line]);

  const lbl = useMemo(()=> (prob && hist.length ? findBinLabelForValue(hist, prob.line) : undefined), [prob, hist]);

  return (
    <div style={{ marginTop:12 }}>
      {!hist.length ? (
        <div style={{ height:260, display:"grid", placeItems:"center", opacity:.7 }}>
          No data for this stat.
        </div>
      ) : (
        <>
          <div style={{ height:260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="bin" angle={-30} textAnchor="end" interval={0} height={50} />
                <YAxis allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                  labelStyle={{ color:"var(--muted)" }}
                  itemStyle={{ color:"var(--text)" }}
                  formatter={(v:any)=>[v,"Count"]}
                />
                {prob && lbl && (
                  <ReferenceLine
                    x={lbl} ifOverflow="extendDomain"
                    stroke="var(--accent)" strokeDasharray="4 4"
                    label={{ value:`Line ${prob.line}`, position:"top", fontSize:12, fill:"var(--accent)" }}
                  />
                )}
                <Bar dataKey="count" name={`${player} • ${role} • ${stat}`}>
                  {hist.map((_,i)=><Cell key={i} fill={color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ marginTop:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6, color:"var(--brand)" }}>Probability vs Line</div>
            {prob ? (
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:14 }}>
                <span><b>Under</b>: {(prob.under*100).toFixed(1)}%</span>
                <span><b>At</b>: {(prob.at*100).toFixed(1)}%</span>
                <span><b>Over</b>: {(prob.over*100).toFixed(1)}%</span>
              </div>
            ) : (
              <div style={{ opacity:.7, fontSize:14 }}>Enter a numeric line above to see probabilities.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
