// src/pages/GameCenter.tsx: "Game sims", /cfb/game
//
// Every simulated outcome for ONE game: margin, total, each team's points, and
// each player's stat line, with a line box that prices the series against it.
//
// TWO SEASONS, TWO LAYOUTS (2026-10-16). 2026 publishes per-game JSON
// (weeks/<id>/index.json -> games/<slug>/compact.json for the 10,000 seed
// scores, players_dist.json for each player's PMFs) and NO CSVs, so this page
// used to open on 2025 week 0 forever. Now 2026 is the default and reads that
// JSON through the same cached loaders as the board (cfbJson.ts); 2025 stays
// reachable as an archive tab on its original CSV bundles. Only the LOADERS
// differ: both feed the same GameMap / PlayerMap shapes and the same charts.
//
// Deep link: /cfb/game?week=week07&game=<espn game_id> (or &pair=<slug>);
// ?season=2025 opens the archive.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { displayTeamColor } from "../utils/teamColors";
import { useIsDark } from "../lib/usePrefs";
import {
  getCatalog, playerFileForPair, latestWeek,
  type CfbCatalog, type FileItem,
} from "../lib/cfbData";
import {
  getJsonWeekIndex, getCompactCached, getPlayersDistCached, type JsonWeekRow, type PlayersDistJson,
} from "../lib/cfbJson";
import { PageHeader, Tabs, EmptyState } from "../components/ui";
import { Skeleton } from "../components/Skeleton";
import { useDocumentMeta } from "../lib/useDocumentMeta";
import { PreviewLink } from "../components/blog/PreviewLink";

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
  // Scores and stat lines are INTEGERS. A fractional bin width over integer
  // data alternates 1-value and 2-value bins, which draws a comb of spikes
  // that looks like signal and is not. Snap to a whole-number width.
  const allInt = v.every((x) => Number.isInteger(x));
  if (allInt && !opts?.bins) binWidth = Math.max(1, Math.round(binWidth));
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
    // Integer bins read as the values they hold: "7" or "7 to 9".
    const label = allInt && Number.isInteger(binWidth)
      ? (e - s <= 1 ? `${s}` : `${s} to ${e - 1}`)
      : `${Number(s.toFixed(1))}–${Number(e.toFixed(1))}`;
    return { bin: label, count:c, start:s, end:e };
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

/* --------------------- Player sims -> nested lookup --------------------- */
const PLAYER_META_KEYS = new Set([
  "team","Team","school","School",
  "player","Player","name","Name",
  "opp","Opp",
  "role","Role","position","Position","pos","Pos",
  "stat","Stat","metric","Metric","category","Category","value","Value","amount","Amount","val","Val"
]);

function buildPlayerMap(data: any[]): PlayerMap {
  const out: PlayerObs[] = [];

  for (const raw of data) {
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
      if (PLAYER_META_KEYS.has(k)) continue;
      const v = Number(raw[k]); if (!Number.isFinite(v)) continue;
      const r = roleFromField ?? canonicalRoleFromValueKey(k); if (!r) continue;
      out.push({ team, player, role: r, stat: k, value: v });
    }
  }

  const pmap: PlayerMap = {};
  for (const o of out) {
    if (!o.role) continue;
    ((((pmap[o.team] ||= {})[o.player] ||= {})[o.role] ||= {})[o.stat] ||= []).push(o.value);
  }
  return pmap;
}

/* --------------------- 2026: players_dist.json -> PlayerMap --------------------- */
/** Each stat files under the role that OWNS it (a QB's rushing yards appear
 *  under Rusher), the same rule the CSV path applies when a row has no role.
 *  A PMF is expanded to its seed values so the histogram and the line math
 *  are identical to the CSV path (mass == nsims, so 10,000 values). Stats the
 *  page has no label for (targets, designed runs, sack yards) are skipped. */
function buildPlayerMapFromDist(dist: PlayersDistJson): PlayerMap {
  const pmap: PlayerMap = {};
  for (const p of dist.players) {
    for (const [stat, pmf] of Object.entries(p.stats)) {
      const role = canonicalRoleFromValueKey(stat);
      if (!role) continue;
      // Zero-stat PMFs (all mass at 0, e.g. a receiver's passing yards) are
      // not distributions; hard-won rule 5 filters them in the math layer.
      if (pmf.size === 1 && pmf.has(0)) continue;
      const values: number[] = [];
      for (const [v, c] of pmf) for (let i = 0; i < c; i++) values.push(v);
      if (!values.length) continue;
      (((pmap[p.team] ||= {})[p.player] ||= {})[role] ||= {})[stat] = values;
    }
  }
  return pmap;
}

/* --------------------- URL helpers (embed + deep links) --------------------- */
const getSearchParam = (name: string) =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
const URL_WEEK = getSearchParam("week") || "";
const URL_PAIR = getSearchParam("pair") || "";
const URL_GAME = getSearchParam("game") || "";
const URL_SEASON = getSearchParam("season") === "2025" ? "2025" : "2026";

type SeasonId = "2026" | "2025";
type GameEntry = GameData & { row?: JsonWeekRow; kickoff?: string; gameId?: string };

/* --------------------- Small control --------------------- */
function NumberSpinner({
  value, onChange, step = 0.5, min, max, width = 96, placeholder, label,
}: {
  value: string; onChange: (s: string) => void; step?: number; min?: number; max?: number;
  width?: number; placeholder?: string; label: string;
}) {
  const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const clamp = (n: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
  const bump = (dir: -1 | 1) => {
    const curr = toNum(value); const base = Number.isFinite(curr) ? curr : 0;
    const next = clamp(base + dir * step); onChange(next.toFixed(1));
  };
  return (
    <div className="gc-spin">
      <button type="button" className="ui-btn" onClick={() => bump(-1)} aria-label={`Lower ${label}`}>−</button>
      <input type="number" step={step} min={min} max={max} value={value} placeholder={placeholder}
        inputMode="decimal" onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="ui-sel" style={{ width }} />
      <button type="button" className="ui-btn" onClick={() => bump(1)} aria-label={`Raise ${label}`}>+</button>
    </div>
  );
}

function ProbLine({ p }: { p: { under: number; at: number; over: number; line: number } }) {
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    <div className="gc-prob" aria-live="polite">
      <span className="gc-prob__label">vs {p.line}</span>
      <span><b>Under</b> <span className="num">{pc(p.under)}</span></span>
      {p.at > 0 && <span><b>Push</b> <span className="num">{pc(p.at)}</span></span>}
      <span><b>Over</b> <span className="num">{pc(p.over)}</span></span>
    </div>
  );
}

const fmtKick = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/* =============================================================================
   Page
============================================================================= */
export default function GameCenter() {
  /* Which theme the page is painting into, so team colours can be
     contrast-gated before they hit a chart. One read per component. */
  const isDark = useIsDark();
  const [season, setSeason] = useState<SeasonId>(URL_SEASON);

  /* -------- Dataset catalog -------- */
  const [catalog, setCatalog] = useState<CfbCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCatalog(null);
    setCatalogError(null);
    getCatalog(season)
      .then((c) => { if (alive) setCatalog(c); })
      .catch((e) => { if (alive) setCatalogError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [season]);

  /** Week options. 2026 is keyed by dataset id (week07), newest first;
   *  2025 keeps its legacy keys, oldest first, exactly as before. */
  const weekOpts = useMemo(() => {
    const ws = catalog?.weeks ?? [];
    if (season === "2026") {
      return [...ws].sort((a, b) => b.week - a.week).map((w) => ({ key: w.id, label: w.label || `Week ${w.week}` }));
    }
    return ws.map((w) => ({ key: w.legacyKey, label: w.legacyKey }));
  }, [catalog, season]);

  // One bundled score file per week (2025 only), keyed by legacy week name.
  const scoreFileByWeek = useMemo(() => {
    const m: Record<string, FileItem> = {};
    for (const f of catalog?.scoreFiles ?? []) m[f.week] = f;
    return m;
  }, [catalog]);

  const [selectedWeek, setSelectedWeek] = useState("");
  useEffect(() => { setSelectedWeek(""); }, [season]);
  useEffect(() => {
    if (selectedWeek || !weekOpts.length || !catalog) return;
    const keys = weekOpts.map((w) => w.key);
    if (URL_WEEK && keys.includes(URL_WEEK)) { setSelectedWeek(URL_WEEK); return; }
    setSelectedWeek(season === "2026" ? (latestWeek(catalog)?.id ?? keys[0]) : keys[0]);
  }, [weekOpts, selectedWeek, catalog, season]);

  const [loading, setLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  // Games
  const [games, setGames] = useState<Record<string, GameEntry>>({});
  const [selectedKey, setSelectedKey] = useState<string|null>(null);
  const [search, setSearch] = useState("");

  // Players per role
  const [players, setPlayers] = useState<PlayerMap>({});
  const [playersLoading, setPlayersLoading] = useState(false);

  // 2026: the selected game's seed scores (compact.json), loaded on select.
  const [compactRows, setCompactRows] = useState<{ key: string; rows: SimRow[] } | null>(null);

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

  /* --------- Load the selected week's games --------- */
  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    async function load2026() {
      const rows = await getJsonWeekIndex(selectedWeek, "2026", ac.signal);
      if (!alive) return;
      if (!rows) { setGames({}); setSelectedKey(null); setWeekError("This week's sims are not published yet."); return; }
      const sorted = [...rows].sort((a, b) => String(a.time_utc ?? "").localeCompare(String(b.time_utc ?? "")) || a.slug.localeCompare(b.slug));
      const map: Record<string, GameEntry> = {};
      for (const r of sorted) map[r.slug] = { teamA: r.teamA, teamB: r.teamB, rowsA: [], row: r, kickoff: r.time_utc, gameId: r.game_id };
      setGames(map);
      const byGame = URL_GAME ? sorted.find((r) => r.game_id === URL_GAME) : undefined;
      const first = byGame?.slug ?? (URL_PAIR && map[URL_PAIR] ? URL_PAIR : sorted[0]?.slug ?? null);
      setSelectedKey(first);
      setTeamOrder(0);
    }

    async function load2025() {
      const bundle = scoreFileByWeek[selectedWeek];
      if (!bundle) { setGames({}); setSelectedKey(null); return; }
      const data = await parseCsvFromItemSafe<any>(bundle, undefined, ac.signal);
      const rows = (data as any[])
        .filter(r => r && r.team!=null && r.opp!=null && r.pts!=null && r.opp_pts!=null)
        .map(r => ({ team:String(r.team), opp:String(r.opp), pts:Number(r.pts), opp_pts:Number(r.opp_pts) })) as SimRow[];
      const gameMap: Record<string, GameEntry> = {};
      const byPair = new Map<string, SimRow[]>();
      for (const r of rows) {
        const key = sortedKey(r.team, r.opp);
        (byPair.get(key) || (byPair.set(key, []), byPair.get(key)!)).push(r);
      }
      for (const [pair, arr] of byPair.entries()) {
        const [A,B] = pair.split("__");
        const normalized = arr.map(r => r.team===A && r.opp===B
          ? { team:A, opp:B, pts:r.pts, opp_pts:r.opp_pts }
          : { team:A, opp:B, pts:r.opp_pts, opp_pts:r.pts });
        (gameMap[pair] ||= { teamA:A, teamB:B, rowsA:[] }).rowsA.push(...normalized);
      }
      if (!alive) return;
      setGames(gameMap);
      const firstKey = URL_PAIR && gameMap[URL_PAIR] ? URL_PAIR : (Object.keys(gameMap)[0] ?? null);
      setSelectedKey(firstKey);
      setTeamOrder(0);
    }

    if (!selectedWeek) return;
    setLoading(true);
    setWeekError(null);
    setCompactRows(null);
    (season === "2026" ? load2026() : load2025())
      .catch((e) => { if (alive && e?.name !== "AbortError") setWeekError("Couldn't load this week. Try again in a minute."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; ac.abort(); };
  }, [selectedWeek, scoreFileByWeek, season]);

  const selectedGame = selectedKey ? games[selectedKey] : null;
  const selectedRow = selectedGame?.row;

  /* --------- 2026: the selected game's 10,000 seed scores --------- */
  useEffect(() => {
    if (season !== "2026" || !selectedRow || !selectedKey) return;
    let alive = true;
    getCompactCached(selectedRow, "2026")
      .then((c) => {
        if (!alive) return;
        const A = c.A_pts ?? [], B = c.B_pts ?? [];
        const n = Math.min(A.length, B.length);
        const rows: SimRow[] = new Array(n);
        for (let i = 0; i < n; i++) rows[i] = { team: selectedRow.teamA, opp: selectedRow.teamB, pts: A[i], opp_pts: B[i] };
        setCompactRows({ key: selectedKey, rows });
      })
      .catch(() => { if (alive) setCompactRows({ key: selectedKey, rows: [] }); });
    return () => { alive = false; };
  }, [season, selectedRow, selectedKey]);

  /** The seed scores the charts read, whichever season supplied them. */
  const gameRows: SimRow[] = useMemo(() => {
    if (!selectedGame) return [];
    if (season === "2026") return compactRows && compactRows.key === selectedKey ? compactRows.rows : [];
    return selectedGame.rowsA;
  }, [selectedGame, season, compactRows, selectedKey]);

  /* --------- Player sims for the selected game only --------- */
  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    async function loadPlayers() {
      setPlayers({});
      if (!selectedWeek || !selectedGame) return;
      setPlayersLoading(true);
      try {
        if (season === "2026") {
          if (!selectedRow) return;
          const dist = await getPlayersDistCached(selectedRow, "2026");
          if (alive) setPlayers(buildPlayerMapFromDist(dist));
          return;
        }
        const item = await playerFileForPair(selectedWeek, selectedGame.teamA, selectedGame.teamB);
        if (!item || !alive) return;
        const data = await parseCsvFromItemSafe<any>(item, undefined, ac.signal);
        if (!alive) return;
        setPlayers(buildPlayerMap(data as any[]));
      } catch {
        if (alive) setPlayers({});
      } finally {
        if (alive) setPlayersLoading(false);
      }
    }

    loadPlayers();
    return () => { alive = false; ac.abort(); };
  }, [selectedWeek, selectedGame?.teamA, selectedGame?.teamB, season, selectedRow]);

  useEffect(() => {
    if (!selectedGame) return;
    setPTeam(selectedGame.teamA);
    setPRole("QB");
    setPPlayer("");
    setPStat("");
    setPlayerLine("");
  }, [selectedGame?.teamA, selectedGame?.teamB, selectedKey]);

  /* Keep the URL shareable: week + game id (2026) or pair (2025). */
  useEffect(() => {
    if (!selectedWeek || !selectedKey || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("week", selectedWeek);
    if (season === "2025") { params.set("season", "2025"); params.set("pair", selectedKey); params.delete("game"); }
    else { params.delete("season"); params.delete("pair"); if (selectedGame?.gameId) params.set("game", selectedGame.gameId); }
    const next = `${window.location.pathname}?${params.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [selectedWeek, selectedKey, season, selectedGame?.gameId]);

  /* -------- Derived for TEAM charts -------- */
  const seriesTeam = useMemo(() => {
    if (!gameRows.length) return [] as number[];
    const A = gameRows.map(r=>r.pts);
    const B = gameRows.map(r=>r.opp_pts);
    const left  = teamOrder===0 ? A : B;
    const right = teamOrder===0 ? B : A;
    switch (metric) {
      case "spread":    return left.map((x,i)=> x - right[i]);
      case "total":     return left.map((x,i)=> x + right[i]);
      case "teamLeft":  return left;
      case "teamRight": return right;
    }
  }, [gameRows, teamOrder, metric]);

  const histTeam = useMemo(() => {
    if (!seriesTeam.length) return [] as HistBin[];
    const binsNum = bins === "auto" ? undefined : Number(bins);
    return computeHistogram(seriesTeam, binsNum ? { bins: binsNum } : undefined);
  }, [seriesTeam, bins]);

  const teamProb = useMemo(() => {
    if (!seriesTeam.length) return null as null | { under:number; at:number; over:number; line:number };
    // Blank box = no line. Number("") is 0, which used to price the series
    // against a line of 0 and print "Over 100.0%" on an empty input.
    if (teamLine.trim() === "") return null;
    const L = Number(teamLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of seriesTeam) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = seriesTeam.length;
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [seriesTeam, teamLine]);
  const lineBinTeam = useMemo(() => (teamProb && histTeam.length ? findBinLabelForValue(histTeam, teamProb.line) : undefined), [teamProb, histTeam]);

  const teams = selectedGame ? [selectedGame.teamA, selectedGame.teamB] : ["—","—"];
  const leftColor  = displayTeamColor(teams[teamOrder===0?0:1], isDark) ?? "var(--brand)";

  /* -------- Derived for PLAYER charts -------- */
  /** Players with this role's stats, BUSIEST FIRST (mean of the role's
   *  yardage, else its first stat), so the default is the starter, not
   *  whoever sorts first alphabetically. */
  const teamPlayersByRole = (team: string, role: Role) => {
    const roster = players[team] || {};
    const weight = (p: string) => {
      const st = roster[p]?.[role] || {};
      const key = Object.keys(st).find((k) => /yds/.test(k)) ?? Object.keys(st)[0];
      const vals = key ? st[key] : [];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    return Object.keys(roster).filter(p => !!roster[p]?.[role])
      .sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  };
  const statsFor = (team: string, player: string, role: Role) =>
    Object.keys(players[team]?.[player]?.[role] || {}).sort();

  const defaultPlayer = useMemo(() => teamPlayersByRole(pTeam, pRole)[0] || "", [pTeam, pRole, players]);
  useEffect(()=>{ if (!pPlayer) setPPlayer(defaultPlayer); }, [defaultPlayer]); // only seed if empty

  const defaultStat = useMemo(() => {
    const list = statsFor(pTeam, pPlayer, pRole);
    // Prefer the yardage stat for the role, else whatever comes first.
    return list.find((s) => /yds/.test(s)) || list[0] || "";
  }, [pTeam, pPlayer, pRole, players]);
  useEffect(()=>{ if (!pStat) setPStat(defaultStat); }, [defaultStat]);

  const pColor = displayTeamColor(pTeam, isDark) ?? "var(--brand)";
  const pValues = players[pTeam]?.[pPlayer]?.[pRole]?.[pStat] || [];
  const histPlayer = useMemo(() => computeHistogram(pValues, { bins: 20 }), [pValues]);

  const pProb = useMemo(() => {
    if (!pValues.length) return null as null | { under:number; at:number; over:number; line:number };
    if (playerLine.trim() === "") return null; // blank box = no line (see teamProb)
    const L = Number(playerLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of pValues) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = pValues.length; return { under:u/n, at:a/n, over:o/n, line:L };
  }, [pValues, playerLine]);
  const lineBinPlayer = useMemo(() => (pProb && histPlayer.length ? findBinLabelForValue(histPlayer, pProb.line) : undefined), [pProb, histPlayer]);

  const matchup = selectedGame
    ? season === "2026" ? `${selectedGame.teamB} at ${selectedGame.teamA}` : `${selectedGame.teamA} vs ${selectedGame.teamB}`
    : "";
  useDocumentMeta({
    title: matchup ? `${matchup}: game sims` : "Game sims",
    description: "Every simulated outcome for one college football game: margin, total, team points and player stat lines, from 10,000 simulations.",
  });

  const weekLabel = weekOpts.find((w) => w.key === selectedWeek)?.label ?? "";
  const q = search.trim().toLowerCase();
  const listed = Object.entries(games).filter(([key, g]) => !q
    || key.toLowerCase().includes(q) || g.teamA.toLowerCase().includes(q) || g.teamB.toLowerCase().includes(q));

  /* -------- UI -------- */
  return (
    <div className="stack gc">
      <PageHeader
        kicker={season === "2026" ? `College football · 2026${weekLabel ? ` · ${weekLabel}` : ""}` : "College football · 2025 archive"}
        title="Game sims"
        sub="Every simulated outcome for one game, 10,000 runs: the margin, the total, each team's points and each player's stat line. Type a line to see how often the sim clears it."
      />
      <Tabs label="Season" value={season} onChange={(id) => setSeason(id as SeasonId)}
        items={[{ id: "2026", label: "2026" }, { id: "2025", label: "2025 archive" }]} />

      {catalogError && (
        <EmptyState compact title="The game list didn't load">
          <p>The data host didn't answer. Refresh in a minute.</p>
        </EmptyState>
      )}

      <div className="gc-controls">
        <label className="gc-field">
          <span>Week</span>
          <select className="ui-sel" value={selectedWeek}
            onChange={(e) => { setSelectedWeek(e.target.value); (e.target as HTMLSelectElement).blur(); }}>
            {weekOpts.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        </label>
        <span className="gc-count">{loading ? "Loading games…" : `${Object.keys(games).length} games`}</span>
        <label className="gc-field gc-field--search">
          <span className="sr-only">Search team</span>
          <input className="ui-sel" placeholder="Search team…" value={search} onChange={(e)=>setSearch(e.target.value)} />
        </label>
      </div>

      {weekError && <EmptyState compact title="No sims for this week yet"><p>{weekError}</p></EmptyState>}

      <div className="gc-layout">
        {/* Left: the week's games. Real buttons (keyboard + screen reader). */}
        <nav className="gc-list" aria-label="Games this week">
          {loading && !listed.length
            ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={40} />)
            : listed.map(([key, g]) => (
              <button key={key} type="button" className={`gc-game${selectedKey === key ? " is-on" : ""}`}
                aria-current={selectedKey === key ? "true" : undefined}
                onClick={() => { setSelectedKey(key); setTeamOrder(0); setTeamLine(""); }}>
                {season === "2026"
                  ? <><span className="gc-game__teams">{g.teamB} <span className="gc-game__at">at</span> {g.teamA}</span>
                      {g.kickoff && <span className="gc-game__kick">{fmtKick(g.kickoff)}</span>}</>
                  : <span className="gc-game__teams">{g.teamA} <span className="gc-game__at">vs</span> {g.teamB}</span>}
              </button>
            ))}
        </nav>

        <div className="stack" style={{ gap: "var(--sp-4)" }}>
          {selectedGame && (
            <div className="gc-matchup">
              <h2 className="gc-matchup__title">{matchup}</h2>
              <div className="gc-matchup__links">
                {season === "2026" && selectedGame.gameId && <PreviewLink gameId={selectedGame.gameId} />}
                {season === "2026" && (
                  <Link className="link" to={`/cfb/scoreboard?week=${encodeURIComponent(selectedWeek)}${selectedGame.gameId ? `&game=${selectedGame.gameId}` : ""}`}>
                    Live game card →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Team sims */}
          <section className="ui-card" aria-label="Score distribution">
            <div className="gc-toolbar">
              <select className="ui-sel" value={metric} onChange={(e)=>setMetric(e.target.value as Metric)} aria-label="What to chart">
                <option value="spread">Margin ({teams[teamOrder===0?0:1]} − {teams[teamOrder===0?1:0]})</option>
                <option value="total">Total points</option>
                <option value="teamLeft">{teams[teamOrder===0?0:1]} points</option>
                <option value="teamRight">{teams[teamOrder===0?1:0]} points</option>
              </select>
              <button type="button" className="ui-btn" onClick={()=>setTeamOrder(teamOrder===0?1:0)}>Flip sides</button>
              <label className="gc-field gc-field--inline">
                <span>Bins</span>
                <select className="ui-sel" value={String(bins)} onChange={(e)=>setBins(e.target.value==="auto"?"auto":Number(e.target.value))}>
                  <option value="auto">Auto</option><option value="20">20</option><option value="30">30</option><option value="40">40</option>
                </select>
              </label>
              <div className="gc-field gc-field--inline gc-line">
                <span>Line</span>
                <NumberSpinner value={teamLine} onChange={setTeamLine} step={0.5} label="team line"
                  placeholder={metric==="spread" ? "-6.5" : "55.5"} />
              </div>
            </div>

            <div style={{ height: 340, marginTop: 8 }}>
              {!gameRows.length ? (
                <Skeleton height={340} />
              ) : (
                <ResponsiveContainer>
                  <BarChart data={histTeam}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="bin" minTickGap={12} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                    <YAxis allowDecimals={false} width={40} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:6 }}
                      labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                      formatter={(v:any)=>[v,"Sims"]}
                    />
                    {teamProb && lineBinTeam && (
                      <ReferenceLine x={lineBinTeam} ifOverflow="extendDomain" stroke="var(--accent)" strokeWidth={2}
                        strokeDasharray="4 4" label={{ value:`Line ${teamProb.line}`, position:"top", fontSize:11, fill:"var(--accent-ink)" }} />
                    )}
                    <Bar dataKey="count" name="Sims">
                      {histTeam.map((_, i) => <Cell key={i} fill={leftColor} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            {teamProb && <ProbLine p={teamProb} />}
          </section>

          {/* Player sims */}
          <section className="ui-card" aria-label="Player stat distribution">
            <div className="gc-toolbar gc-toolbar--players">
              <select className="ui-sel" aria-label="Team" value={pTeam}
                onChange={e=>{ setPTeam(e.target.value); setPPlayer(""); setPStat(""); }}>
                {selectedGame && [selectedGame.teamA, selectedGame.teamB].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="ui-sel" aria-label="Role" value={pRole}
                onChange={e=>{ setPRole(e.target.value as Role); setPPlayer(""); setPStat(""); }}>
                <option value="QB">Passing</option><option value="Rusher">Rushing</option><option value="Receiver">Receiving</option>
              </select>
              <select className="ui-sel" aria-label="Player" value={pPlayer}
                onChange={e=>{ setPPlayer(e.target.value); setPStat(""); }}>
                {teamPlayersByRole(pTeam, pRole).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <select className="ui-sel" aria-label="Stat" value={pStat} onChange={e=>setPStat(e.target.value)}>
                {statsFor(pTeam, pPlayer, pRole).map(s => <option key={s} value={s}>{prettyStat(s)}</option>)}
              </select>
              <div className="gc-field gc-field--inline gc-line">
                <span>Line</span>
                <NumberSpinner value={playerLine} onChange={setPlayerLine} step={0.5} label="player line" />
              </div>
            </div>

            {!pValues.length ? (
              playersLoading ? <Skeleton height={260} style={{ marginTop: 8 }} /> : (
                <p className="gc-empty">
                  {selectedGame ? (pPlayer && pStat ? "No simulated values for this selection." : "No player sims for this game.") : "Pick a game."}
                </p>
              )
            ) : (
              <>
                <div style={{ height: 260, marginTop: 8 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histPlayer} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="bin" minTickGap={12} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                      <YAxis allowDecimals={false} width={40} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:6 }}
                        labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                        formatter={(v:any)=>[v,"Sims"]}
                      />
                      {pProb && lineBinPlayer && (
                        <ReferenceLine x={lineBinPlayer} ifOverflow="extendDomain" stroke="var(--accent)" strokeWidth={2}
                          strokeDasharray="4 4" label={{ value:`Line ${pProb.line}`, position:"top", fontSize:11, fill:"var(--accent-ink)" }} />
                      )}
                      <Bar dataKey="count" name={`${pPlayer} · ${prettyStat(pStat)}`}>
                        {histPlayer.map((_, i) => <Cell key={i} fill={pColor} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {pProb && <ProbLine p={pProb} />}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
