// src/pages/GameCenter.tsx
import { useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { getTeamColors } from "../utils/teamColors";

/* --------------------------------------------------------------------------
   CSV discovery (URL-imports only → keeps bundles small & avoids iOS memory)
----------------------------------------------------------------------------*/
// Scores (team sims)
const S_URL = Object.assign(
  {},
  import.meta.glob("../data/**/scores/*.csv",     { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.csv.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV",     { as: "url", eager: true }),
  import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "url", eager: true })
) as Record<string, string>;

// Players
const P_URL = Object.assign(
  {},
  import.meta.glob("../data/**/players/*.csv",     { as: "url", eager: true }),
  import.meta.glob("../data/**/players/*.csv.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/players/*.CSV",     { as: "url", eager: true }),
  import.meta.glob("../data/**/players/*.CSV.CSV", { as: "url", eager: true })
) as Record<string, string>;

type FileInfo = { path: string; week: string; file: string; url?: string };

const normSlashes = (p: string) => p.replace(/\\/g, "/");
const weekFromPath = (p: string) =>
  normSlashes(p).match(/\/(week[^/]+)\//i)?.[1].toLowerCase()
  ?? normSlashes(p).match(/\/data\/([^/]+)\//i)?.[1].toLowerCase()
  ?? "root";

function buildFiles(urls: Record<string, string>): FileInfo[] {
  const paths = Object.keys(urls);
  return paths.map(p => ({
    path: p,
    week: weekFromPath(p),
    file: p.split("/").pop() || p,
    url: urls[p],
  })).sort((a,b)=>a.file.localeCompare(b.file));
}
const scoreFilesAll  = buildFiles(S_URL);
const playerFilesAll = buildFiles(P_URL);

/* --------------------------------------------------------------------------
   Safari-safe CSV loader (fetch as TEXT, then parse; no web workers on iOS)
----------------------------------------------------------------------------*/
async function parseCsvFromItemSafe<T = any>(
  item: { url?: string },
  papaOpts?: Papa.ParseConfig<T>,
  abortSignal?: AbortSignal
): Promise<T[]> {
  if (!item?.url) return [];
  let text = "";

  try {
    const abs = new URL(item.url, window.location.href).toString();
    const res = await fetch(abs, { cache: "no-store", signal: abortSignal });
    text = await res.text();
  } catch (e) {
    console.warn("CSV fetch failed:", item?.url, e);
    return [];
  }

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  return new Promise<T[]>((resolve, reject) => {
    Papa.parse<T>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      download: false,      // we already have the text
      worker: !isSafari,    // avoid web workers on Safari/iOS
      ...(papaOpts || {}),
      complete: (res) => resolve(res.data as T[]),
      error: reject,
    } as Papa.ParseConfig<T>);
  });
}

/* Simple concurrency limiter to avoid many simultaneous fetches on iOS */
async function pAllLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/* --------------------------------------------------------------------------
   Types & helpers
----------------------------------------------------------------------------*/
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // normalized to A vs B
type GameMap = Record<string, GameData>;
type Metric = "spread" | "total" | "teamLeft" | "teamRight";

const sortedKey = (a: string, b: string) =>
  [a, b].sort((x, y) => x.localeCompare(y)).join("__");

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
function findBinLabelForValue(hist: HistBin[], x: number) {
  for (const h of hist) if (x>=h.start && x<h.end) return h.bin;
  if (hist.length && x===hist[hist.length-1].end) return hist[hist.length-1].bin;
  return undefined;
}

/* --------------------- Players data model --------------------- */
// team -> player -> role -> stat -> values[]
type Role = "QB" | "Rusher" | "Receiver";
type PlayerMap = Record<string, Record<string, Partial<Record<Role, Record<string, number[]>>>>>;
interface PlayerObs { team: string; player: string; role: Role | null; stat: string; value: number; }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const STAT_SYNONYMS: Record<string, string> = {
  pass_yds: "pass_yds", pass_yards: "pass_yds", passing_yards: "pass_yds", py: "pass_yds", passyards: "pass_yds",
  pass_td: "pass_td", pass_tds: "pass_td", passing_tds: "pass_td", ptd: "pass_td",
  int: "ints", ints: "ints", interception: "ints", interceptions: "ints",
  pass_att: "pass_att", pass_atts: "pass_att", pass_attempts: "pass_att", attempts: "pass_att", att: "pass_att",
  pass_cmp: "pass_cmp", pass_comp: "pass_cmp", completions: "pass_cmp", cmp: "pass_cmp",
  sacks: "sacks", sacked: "sacks", times_sacked: "sacks",
  rush_yds: "rush_yds", rushing_yards: "rush_yds", ry: "rush_yds", rushyards: "rush_yds",
  rush_td: "rush_td", rushing_tds: "rush_td", rtd: "rush_td",
  rush_att: "rush_att", rush_atts: "rush_att", rushing_attempts: "rush_att", rush_attempts: "rush_att", carries: "rush_att",
  rec_yds: "rec_yds", receiving_yards: "rec_yds", ryds: "rec_yds",
  rec_td: "rec_td", receiving_tds: "rec_td",
  receptions: "receptions", rec: "receptions", catches: "receptions",
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
  const r = String(rawRole).toLowerCase().trim().replace(/\s+/g,"_");
  if (["qb","quarterback"].includes(r)) return "QB";
  if (["rb","hb","fb","running_back","runningback","rusher"].includes(r)) return "Rusher";
  if (["wr","te","receiver","wide_receiver","tight_end"].includes(r)) return "Receiver";
  return null;
}
const prettyStat = (s: string) => {
  const key = norm(s);
  const CANON_LABEL: Record<string, string> = {
    pass_yds:"Pass Yds", pass_td:"Pass TD", ints:"INT",
    pass_att:"Pass Att", pass_cmp:"Pass Cmp", sacks:"Sacks",
    rush_yds:"Rush Yds", rush_td:"Rush TD", rush_att:"Rush Att",
    rec_yds:"Rec Yds", rec_td:"Rec TD", receptions:"Receptions",
    carries:"Rush Att", att:"Rush Att",
  };
  return CANON_LABEL[STAT_SYNONYMS[key] ?? key] ?? s;
};

/* --------------------- URL helpers (embed + deep links) --------------------- */
const getSearchParam = (name: string) =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
const URL_WEEK = getSearchParam("week") || "";
const URL_PAIR = getSearchParam("pair") || "";

/* --------------------- Small control --------------------- */
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

/* =============================================================================
   Page
============================================================================= */
export default function GameCenter() {
  /* -------- Weeks and file indices -------- */
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
  useEffect(() => { if (URL_WEEK && weeks.includes(URL_WEEK)) setSelectedWeek(URL_WEEK); }, [weeks]);

  const [loading, setLoading] = useState(false);

  // Games (from scores)
  const [games, setGames] = useState<GameMap>({});
  const [selectedKey, setSelectedKey] = useState<string|null>(null);
  const [search, setSearch] = useState("");

  // Players per role
  const [players, setPlayers] = useState<PlayerMap>({});

  // Team chart controls
  const [metric, setMetric] = useState<Metric>("spread");
  const [teamOrder, setTeamOrder] = useState<0|1>(0);
  const [bins, setBins] = useState<number|"auto">("auto");
  const [teamLine, setTeamLine] = useState<string>("");

  // Player chart controls
  const [pTeam, setPTeam] = useState<string>("");
  const [pRole, setPRole] = useState<Role>("QB");
  const [pPlayer, setPPlayer] = useState<string>("");
  const [pStat, setPStat] = useState<string>("");
  const [playerLine, setPlayerLine] = useState<string>("");

  /* --------- Load both score + player CSVs for the selected week --------- */
  useEffect(() => {
    const ac = new AbortController();
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

        // default selection
        const firstKey = URL_PAIR && gameMap[URL_PAIR] ? URL_PAIR : (Object.keys(gameMap)[0] ?? null);
        setSelectedKey(firstKey);
        setTeamOrder(0);

        // ---- players (per role) ----
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

            // role (explicit or inferred from stat)
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
              const v = Number(raw[k]); if (!Number.isFinite(v)) continue;
              const r = roleFromField ?? canonicalRoleFromValueKey(k); if (!r) continue;
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
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; ac.abort(); };
  }, [selectedWeek, filesByWeekScores, filesByWeekPlayers]);

  /* -------- When selected game changes, seed player controls -------- */
  const selectedGame = selectedKey ? games[selectedKey] : null;
  useEffect(() => {
    if (!selectedGame) return;
    // Default to left team initially
    const t = selectedGame.teamA;
    setPTeam(t);
    setPRole("QB");
    setPPlayer("");
    setPStat("");
    setPlayerLine("");
  }, [selectedGame?.teamA, selectedGame?.teamB, selectedKey]);

  /* -------- Derived for TEAM charts -------- */
  const seriesTeam = useMemo(() => {
    if (!selectedGame) return [] as number[];
    const A = selectedGame.rowsA.map(r=>r.pts);
    const B = selectedGame.rowsA.map(r=>r.opp_pts);
    const left  = teamOrder===0 ? A : B;
    const right = teamOrder===0 ? B : A;

    switch (metric) {
      case "spread":    return left.map((x,i)=> x - right[i]);
      case "total":     return left.map((x,i)=> x + right[i]);
      case "teamLeft":  return left;
      case "teamRight": return right;
    }
  }, [selectedGame, teamOrder, metric]);

  const histTeam = useMemo(() => {
    if (!seriesTeam.length) return [] as HistBin[];
    const binsNum = bins === "auto" ? undefined : Number(bins);
    return computeHistogram(seriesTeam, binsNum ? { bins: binsNum } : undefined);
  }, [seriesTeam, bins]);

  // probability vs line for team series
  const teamProb = useMemo(() => {
    if (!seriesTeam.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(teamLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of seriesTeam) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = seriesTeam.length;
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [seriesTeam, teamLine]);
  const lineBinTeam = useMemo(() => (teamProb && histTeam.length ? findBinLabelForValue(histTeam, teamProb.line) : undefined), [teamProb, histTeam]);

  const teams = selectedGame ? [selectedGame.teamA, selectedGame.teamB] : ["—","—"];
  const leftColor  = getTeamColors(teams[teamOrder===0?0:1])?.primary ?? "var(--brand)";

  /* -------- Derived for PLAYER charts -------- */
  const teamPlayersByRole = (team: string, role: Role) =>
    Object.keys(players[team] || {}).filter(p => !!players[team]?.[p]?.[role]).sort();
  const statsFor = (team: string, player: string, role: Role) =>
    Object.keys(players[team]?.[player]?.[role] || {}).sort();

  // Default player/stat when inputs change
  const defaultPlayer = useMemo(() => teamPlayersByRole(pTeam, pRole)[0] || "", [pTeam, pRole, players]);
  useEffect(()=>{ if (!pPlayer) setPPlayer(defaultPlayer); }, [defaultPlayer]); // only seed if empty

  const defaultStat = useMemo(() => statsFor(pTeam, pPlayer, pRole)[4] || statsFor(pTeam, pPlayer, pRole)[0] || "", [pTeam, pPlayer, pRole, players]);
  useEffect(()=>{ if (!pStat) setPStat(defaultStat); }, [defaultStat]);

  const pValues = players[pTeam]?.[pPlayer]?.[pRole]?.[pStat] || [];
  const histPlayer = useMemo(() => computeHistogram(pValues, { bins: 20 }), [pValues]);

  const pProb = useMemo(() => {
    if (!pValues.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(playerLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of pValues) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = pValues.length; return { under:u/n, at:a/n, over:o/n, line:L };
  }, [pValues, playerLine]);
  const lineBinPlayer = useMemo(() => (pProb && histPlayer.length ? findBinLabelForValue(histPlayer, pProb.line) : undefined), [pProb, histPlayer]);

  /* -------- UI -------- */
  return (
    <div key={selectedWeek} style={{ display: "grid", gap: 16 }}>
      {/* Top controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label>
          Week:&nbsp;
          <select
            value={selectedWeek}
            onChange={(e) => { setSelectedWeek(e.target.value); (e.target as HTMLSelectElement).blur(); }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
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

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
        {/* Left list of games */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 8,
            background: "var(--card)",
            maxHeight: 520,
            overflow: "auto",
            contentVisibility: "auto",
            containIntrinsicSize: "400px",
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
                  background: selectedKey===key ? "color-mix(in oklab, var(--brand) 14%, transparent)" : "transparent",
                }}
              >
                <strong>{g.teamA}</strong> vs <strong>{g.teamB}</strong>
              </div>
            ))}
        </div>

        {/* Right side: TEAM chart + PLAYER chart */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* Team sims card */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--card)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={metric}
                onChange={(e)=>setMetric(e.target.value as Metric)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
              >
                <option value="spread">Spread ({teams[teamOrder===0?0:1]} − {teams[teamOrder===0?1:0]})</option>
                <option value="total">Total ({teams[teamOrder===0?0:1]} + {teams[teamOrder===0?1:0]})</option>
                <option value="teamLeft">{teams[teamOrder===0?0:1]} team total</option>
                <option value="teamRight">{teams[teamOrder===0?1:0]} team total</option>
              </select>
              <button
                type="button"
                onClick={()=>setTeamOrder(teamOrder===0?1:0)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
              >
                Flip Sides
              </button>

              <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                <span>Bins:</span>
                <select
                  value={String(bins)}
                  onChange={(e)=>setBins(e.target.value==="auto"?"auto":Number(e.target.value))}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg)" }}
                >
                  <option value="auto">Auto</option>
                  <option value="20">20</option>
                  <option value="30">30</option>
                  <option value="40">40</option>
                </select>
              </label>

              <label style={{ display:"inline-flex", alignItems:"center", gap:6, marginLeft:"auto" }}>
                <span>Line:</span>
                <NumberSpinner
                  value={teamLine}
                  onChange={setTeamLine}
                  step={0.5}
                  placeholder={metric==="spread" ? "-6.5" : "55.5"}
                />
              </label>
            </div>

            <div style={{ height: 360, marginTop: 8 }}>
              <ResponsiveContainer>
                <BarChart data={histTeam}>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                  <XAxis dataKey="bin" minTickGap={12} />
                  <YAxis allowDecimals={false} width={32} />
                  <Tooltip
                    contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                    labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                    formatter={(v:any)=>[v,"Count"]}
                  />
                  {teamProb && lineBinTeam && (
                    <ReferenceLine
                      x={lineBinTeam}
                      ifOverflow="extendDomain"
                      stroke="var(--accent)"
                      strokeDasharray="4 4"
                      label={{ value:`Line ${teamProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }}
                    />
                  )}
                  <Bar dataKey="count" name="Frequency">
                    {histTeam.map((h, i) => (
                      <Cell key={i} fill={leftColor} />
                    ))}
                  </Bar>
                  <ReferenceLine y={0} stroke="#888" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {teamProb && (
              <div className="card" style={{ marginTop:6, padding:8, fontSize:13 }}>
                <b>Probability vs Line</b>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                  <span><b>Under</b>: {(teamProb.under*100).toFixed(1)}%</span>
                  <span><b>At</b>: {(teamProb.at*100).toFixed(1)}%</span>
                  <span><b>Over</b>: {(teamProb.over*100).toFixed(1)}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Player sims card */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--card)" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:8 }}>
              <select
                value={pTeam}
                onChange={e=>{ setPTeam(e.target.value); setPPlayer(""); setPStat(""); }}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg)" }}
              >
                {selectedGame ? [selectedGame.teamA, selectedGame.teamB] : []}
                {selectedGame && [selectedGame.teamA, selectedGame.teamB].map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              <select
                value={pRole}
                onChange={e=>{ setPRole(e.target.value as Role); setPPlayer(""); setPStat(""); }}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg)" }}
              >
                <option>QB</option><option>Rusher</option><option>Receiver</option>
              </select>

              <select
                value={pPlayer}
                onChange={e=>{ setPPlayer(e.target.value); setPStat(""); }}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg)" }}
              >
                {teamPlayersByRole(pTeam, pRole).map(n => <option key={n} value={n}>{n}</option>)}
              </select>

              <select
                value={pStat}
                onChange={e=>setPStat(e.target.value)}
                style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg)" }}
              >
                {statsFor(pTeam, pPlayer, pRole).map(s => <option key={s} value={s}>{prettyStat(s)}</option>)}
              </select>

              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:12, color:"var(--muted)" }}>Line:</span>
                <NumberSpinner value={playerLine} onChange={setPlayerLine} step={0.5} />
              </div>
            </div>

            {!pValues.length ? (
              <div style={{ height:200, display:"grid", placeItems:"center", opacity:.7, marginTop:6 }}>
                {pPlayer && pStat ? "No simulated values for this selection." : "Select a team/player/stat to view distribution."}
              </div>
            ) : (
              <>
                <div style={{ height: 280, marginTop: 6 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histPlayer} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                      <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                      <XAxis dataKey="bin" minTickGap={12} />
                      <YAxis allowDecimals={false} width={32} />
                      <Tooltip
                        contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                        labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                        formatter={(v:any)=>[v,"Count"]}
                      />
                      {pProb && lineBinPlayer && (
                        <ReferenceLine
                          x={lineBinPlayer}
                          ifOverflow="extendDomain"
                          stroke="var(--accent)"
                          strokeDasharray="4 4"
                          label={{ value:`Line ${pProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }}
                        />
                      )}
                      <Bar dataKey="count" name={`${pPlayer} • ${prettyStat(pStat)}`}>
                        {histPlayer.map((_, i) => (
                          <Cell key={i} fill={getTeamColors(pTeam)?.primary ?? "var(--brand)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {pProb && (
                  <div className="card" style={{ marginTop:6, padding:8, fontSize:13 }}>
                    <b>Probability vs Line</b>
                    <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                      <span><b>Under</b>: {(pProb.under*100).toFixed(1)}%</span>
                      <span><b>At</b>: {(pProb.at*100).toFixed(1)}%</span>
                      <span><b>Over</b>: {(pProb.over*100).toFixed(1)}%</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
