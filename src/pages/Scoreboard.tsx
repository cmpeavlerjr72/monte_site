// src/pages/Scoreboard.tsx
import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as Papa from "papaparse";
import { getTeamColors } from "../utils/teamColors";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from "recharts";

import { useLiveScoreboard } from "../lib/useLiveScoreboard";

import SupportButton from "../components/SupportButton";
import ErrorBoundary from "../components/ErrorBoundary";
import { Skeleton, SkeletonCard, SkeletonChart } from "../components/Skeleton";
import { useThemeMode, useDensity, type Density } from "../lib/usePrefs";
import MarketEdge from "../components/MarketEdge";
import TopEdges from "../components/TopEdges";
import { ensureSlateEdges, type EdgeInput, type GameEdges } from "../lib/edges";
import { localizeLogoUrl } from "../utils/espnLogos";
import {
  getCatalog, playerFileForPair, resolveLatestSeason, latestWeek,
  invalidateSeason, SEASONS,
  type CfbCatalog, type FileItem, type Season,
} from "../lib/cfbData";
import {
  getJsonWeekGames, getCompactJson,
  type JsonGame, type JsonWeekRow,
} from "../lib/cfbJson";
import BoxScore from "../components/BoxScore";
import PlayerProps from "../components/PlayerProps";
import { getKalshiCfb, indexKalshiBySlug, type KalshiGame } from "../lib/kalshi";
import LegPicker from "../components/LegPicker";
import ParlaySlip from "../components/ParlaySlip";
import type { Leg } from "../lib/parlay";

type LiveGame = {
  id: string;
  state: "pre" | "in" | "post" | "final" | "unknown";
  awayTeam?: string;
  homeTeam?: string;
  awayScore?: number;
  homeScore?: number;
  statusText: string;
};

const clean = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.?\b/g, "state")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const pairKey = (a?: string, b?: string) => {
  const aa = clean(a), bb = clean(b);
  return [aa, bb].sort().join("::");
};

function mapEspnToLiveGames(payload: any): LiveGame[] {
  const events = payload?.events ?? [];
  return events.map((e: any) => {
    const type = e?.status?.type ?? e?.competitions?.[0]?.status?.type ?? {};
    const comp = e?.competitions?.[0];
    const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
    const home = comp?.competitors?.find((c: any) => c.homeAway === "home");

    const period = comp?.status?.period ?? e?.status?.period;
    const clock  = comp?.status?.displayClock ?? e?.status?.displayClock;

    // Robust state
    let state = String(type.state || "").toLowerCase();     // 'pre' | 'in' | 'post'
    const name  = String(type.name || "").toUpperCase();    // e.g. 'STATUS_FINAL'
    const done  = Boolean(type.completed);
    if (done || name.includes("FINAL") || state === "post") state = "final";

    // Pill text
    let statusText = type?.shortDetail || type?.detail || type?.description || "";
    if (state === "in") statusText = `Q${period ?? "-"} ${clock ?? ""}`.trim();
    if (state === "final" && !statusText) statusText = "Final";

    return {
      id: String(e?.id ?? Math.random()),
      state: (state as any),
      statusText,
      awayTeam: away?.team?.shortDisplayName ?? away?.team?.displayName,
      homeTeam: home?.team?.shortDisplayName ?? home?.team?.displayName,
      awayScore: away?.score ? Number(away.score) : undefined,
      homeScore: home?.score ? Number(home.score) : undefined,
    };
  });
}


/* ---------- discover score CSVs (sims) ---------- */
// const RAW = Object.assign(
//   {},
//   import.meta.glob("../data/**/scores/*.csv",     { as: "raw", eager: true }),
//   import.meta.glob("../data/**/scores/*.csv.csv", { as: "raw", eager: true }),
//   import.meta.glob("../data/**/scores/*.CSV",     { as: "raw", eager: true }),
//   import.meta.glob("../data/**/scores/*.CSV.CSV", { as: "raw", eager: true })
// ) as Record<string, string>;

/* ---------- file helpers ---------- */

// SAFE CSV loader: fetch text (if url), then Papa.parse(text) — Safari/iOS friendly
async function parseCsvFromItemSafe<T = any>(
  item: { url?: string; raw?: string },
  papaOpts?: Papa.ParseConfig<T>
): Promise<T[]> {
  let text = "";

  // Prefer URL if present; make absolute (Safari workers hate relative URLs)
  if (item?.url && item.url.trim()) {
    try {
      const abs = new URL(item.url, window.location.href).toString();
      const res = await fetch(abs, { cache: "no-store" });
      text = await res.text();
    } catch (e) {
      console.warn("CSV fetch failed:", item?.url, e);
    }
  }

  // Fallback to raw (Vite raw import)
  if (!text && item?.raw) text = item.raw;
  if (!text) return [];

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  return new Promise<T[]>((resolve, reject) => {
    Papa.parse<T>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      // IMPORTANT for TS overloads: we are parsing a STRING, not remote → set download:false
      download: false,
      // Workers are fine for Chrome/Firefox; disable on Safari
      worker: !isSafari,
      ...(papaOpts as Papa.ParseConfig<T> | undefined),
      complete: (res) => resolve(res.data as T[]),
      error: reject,
    } as Papa.ParseConfig<T>);
  });
}

function parseCsvFromItem<T = any>(
  item: { url?: string; raw?: string },
  papaOpts?: Papa.ParseConfig
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    if (item?.url && item.url.trim()) {
      // URL path: use download + worker (fast, off main thread)
      Papa.parse<T>(item.url, {
        download: true,
        worker: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        ...papaOpts,
        complete: (res) => resolve(res.data as T[]),
        error: reject,
      });
    } else if (item?.raw) {
      // Raw string path: NO download flag (it’s text, not a URL)
      Papa.parse<T>(item.raw, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        ...papaOpts,
        complete: (res) => resolve(res.data as T[]),
        error: reject,
      });
    } else {
      // Nothing to parse
      resolve([]);
    }
  });
}

// numeric picker
function pickNum(row: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === "" || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ---- Player sims -> nested lookup (team > player > role > stat > values) ---- */
const PLAYER_META_KEYS = new Set([
  "team","Team","school","School","player","Player","name","Name",
  "opp","Opp","role","Role","position","Position","pos","Pos",
  "stat","Stat","metric","Metric","category","Category",
  "value","Value","amount","Amount","val","Val",
]);

function buildPlayerMap(data: any[]): PlayerMap {
  const out: PlayerObs[] = [];
  for (const raw of data) {
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

/* --------------------- Team logo & conference lookup --------------------- */
import { getTeamLogo, normTeamKey } from "../utils/teamLogo";

const TEAM_INFO_RAW = import.meta.glob("../assets/team_info.csv", { as: "raw", eager: true }) as Record<string, string>;
const teamInfoRaw = Object.values(TEAM_INFO_RAW)[0] ?? "";

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
  mlPickTeam?: string;   // team name we predict to WIN
  mlPickProb?: number;   // 0..1 win probability for that team
  mlFair?: string;       // American odds string from that prob (e.g. -165 / +145)
  mlResult?: "win" | "loss" | "push";
  scoreSource?: "CSV_FINALS" | "LIVE" | "UPCOMING";
  liveInProgress?: boolean;
  liveStatusText?: string;
  liveA?: number;
  liveB?: number;
  /** Small-JSON path only — the index row, for lazy compact/players fetches. */
  jsonRow?: JsonWeekRow;
  /** P(home wins) straight from the sim, for side-by-side with the market. */
  pHome?: number;
  /** Seeds behind this game, surfaced in the toolbar so a re-publish is visible. */
  nsims?: number;
  /** Book numbers (home-perspective spread, game total) for line pre-fill. */
  oddsSpread?: number;
  oddsTotal?: number;
  /** The sim's own margin/total. NOT medA-medB / medA+medB: the median of a
   *  sum is not the sum of the medians (43 vs 41 on TCU/UNC). */
  simMedMargin?: number;
  simMedTotal?: number;
  simMeanMargin?: number;
  simMeanTotal?: number;
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
      <button type="button" className="ui-btn" aria-label="Decrease" onClick={() => bump(-1)} style={{ padding: "3px 8px" }}>−</button>
      <input type="number" step={step} min={min} max={max} value={value} placeholder={placeholder}
        inputMode="decimal" onChange={(e) => onChange(e.target.value)}
        style={{ width }} />
      <button type="button" onClick={() => bump(1)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background:"var(--card)" }}>+</button>
    </div>
  );
}

/* --------------------- histogram ticks ---------------------
 * The axes used to label ONLY q1/median/q3 and return "" for every other tick,
 * so a 30-bar chart showed three floating numbers and read as unlabelled.
 * Now: ~5 evenly spaced real values across the range, PLUS the quartiles,
 * with quartiles drawn in the brand colour and bold so they stay legible as
 * distribution landmarks rather than blending into the scale.
 */
type TickInfo = { text: string; quartile: boolean };

const fmtTick = (v: number) =>
  Number.isInteger(v) ? String(v) : Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0);

function buildTickPlan(
  hist: HistBin[],
  q: { q1: number; med: number; q3: number } | null,
  count = 5
): Map<string, TickInfo> {
  const plan = new Map<string, TickInfo>();
  if (!hist.length) return plan;

  const n = Math.min(count, hist.length);
  for (let i = 0; i < n; i++) {
    const idx = n === 1 ? 0 : Math.round((i * (hist.length - 1)) / (n - 1));
    const b = hist[idx];
    plan.set(b.bin, { text: fmtTick(b.start), quartile: false });
  }
  if (q) {
    for (const v of [q.q1, q.med, q.q3]) {
      const label = findBinLabelForValue(hist, v);
      if (label) plan.set(label, { text: fmtTick(v), quartile: true });
    }
  }
  return plan;
}

/** Recharts tick renderer honouring a plan; unplanned ticks render nothing. */
function planTick(plan: Map<string, TickInfo>) {
  return (props: any) => {
    const { x, y, payload } = props;
    const hit = plan.get(payload?.value);
    if (!hit) return <g />;
    return (
      <text
        x={x} y={y + 10} textAnchor="middle" fontSize={11}
        fill={hit.quartile ? "var(--brand-text)" : "var(--muted)"}
        fontWeight={hit.quartile ? 700 : 400}
      >
        {hit.text}
      </text>
    );
  };
}

/* --------------------- expandable panels --------------------- */
/** Which drill-down a card currently owns. Only one is open page-wide. */
export type PanelKind = "scores" | "players" | "box" | "props" | "picker";

/** Must mirror the grid CSS below so the break-out row lands in the right place.
 *  Condensed narrows the track so a 1400px viewport fits 5 columns instead of 4. */
const GRID_MIN: Record<Density, number> = { comfortable: 320, condensed: 250 };
const GRID_MIN_COL = 320;
const GRID_GAP = 16;

/** Columns `repeat(auto-fit, minmax(MIN, 1fr))` actually produces at width w. */
export function gridColumnsFor(width: number, min = GRID_MIN_COL, gap = GRID_GAP): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/**
 * Index of the last card in the row containing `openIdx`.
 *
 * The break-out panel is inserted after THIS card, not after the expanded one:
 * placing it immediately after the expanded card would push it to the next row
 * anyway (it cannot fit beside its siblings) and leave a hole in the remainder
 * of the current row. Returns -1 when nothing is open.
 */
export function panelRowEnd(openIdx: number, cols: number, total: number): number {
  if (openIdx < 0 || total <= 0) return -1;
  const c = Math.max(1, cols);
  return Math.min(total - 1, (Math.floor(openIdx / c) + 1) * c - 1);
}

/* --------------------- card sorting (shared by both season formats) --------------------- */
/** "edge" ranks by the biggest absolute market edge the game can show. */
type SortBy = "kickoff" | "edge";

function sortCards(
  cards: CardGame[],
  sortBy: SortBy,
  edges?: Map<string, GameEdges> | null
): CardGame[] {
  const out = [...cards];
  out.sort((x, y) => {
    if (sortBy === "kickoff") {
      const ax = x.kickoffMs ?? Number.POSITIVE_INFINITY;
      const ay = y.kickoffMs ?? Number.POSITIVE_INFINITY;
      if (ax !== ay) return ax - ay;
      return x.teamA.localeCompare(y.teamA);
    }
    // Edge: biggest |edge| first. Games Kalshi cannot price have no edge at
    // all, so they sink to the bottom rather than being dropped.
    const best = (c: CardGame) => {
      const e = edges?.get(c.key)?.bestAbs;
      return typeof e === "number" ? e : -1;
    };
    const ax = best(x);
    const ay = best(y);
    if (ay !== ax) return ay - ax;
    const kx = x.kickoffMs ?? Number.POSITIVE_INFINITY;
    const ky = y.kickoffMs ?? Number.POSITIVE_INFINITY;
    if (kx !== ky) return kx - ky;
    return x.teamA.localeCompare(y.teamA);
  });
  return out;
}

/* --------------------- URL deep links (?season= / ?week=) --------------------- */
// Read once at module load, same pattern GameCenter.tsx uses. An explicit deep
// link beats the "latest season / latest week" default, but only on first
// resolve — switching the dropdowns afterwards must not snap back to the URL.
const getSearchParam = (name: string) =>
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get(name);
const URL_SEASON = (getSearchParam("season") || "").trim();
const URL_WEEK = (getSearchParam("week") || "").trim().toLowerCase();

/* --------------------- page --------------------- */
function ScoreboardPage() {

  // --- LIVE: inside Scoreboard() component, just above the cards useMemo ---
  const todayET = useMemo(
    () =>
      new Date()
        .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
        .replace(/-/g, ""),
    []
  );

  // call the hook safely INSIDE a component
  const livePayload = useLiveScoreboard(todayET, "cfb");

  // normalize and index the live games
  const liveGames: LiveGame[] = useMemo(
    () => (livePayload ? mapEspnToLiveGames(livePayload) : []),
    [livePayload]
  );

  const liveMap = useMemo(() => {
    const m = new Map<string, LiveGame>();
    for (const g of liveGames) m.set(pairKey(g.awayTeam, g.homeTeam), g);
    return m;
  }, [liveGames]);

  const getCardLive = useCallback(
    (game: { teamA: string; teamB: string }) => {
      const lg = liveMap.get(pairKey(game.teamA, game.teamB));
      const inProgress = lg?.state === "in";
      let aScore: number | undefined, bScore: number | undefined;
      if (lg) {
        const aMatchesAway = clean(game.teamA) === clean(lg.awayTeam);
        aScore = aMatchesAway ? lg.awayScore : lg.homeScore;
        bScore = aMatchesAway ? lg.homeScore : lg.awayScore;
      }
      return { lg, inProgress, aScore, bScore, statusText: lg?.statusText };
    },
    [liveMap]
  );

  /* ---- Season + dataset catalog (weeks, fetched at runtime) ----
   *
   * Season "" means "not resolved yet": on a cold load with no ?season= we ask
   * for the newest season whose catalog actually answers, so the page lands on
   * 2026 once that dataset is published and quietly stays on 2025 until then.
   */
  const [season, setSeason] = useState<Season>(
    (SEASONS as readonly string[]).includes(URL_SEASON) ? URL_SEASON : ""
  );
  const [catalog, setCatalog] = useState<CfbCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalog(null);

    (async () => {
      try {
        if (season) {
          const c = await getCatalog(season);
          if (alive) setCatalog(c);
        } else {
          const { season: resolved, catalog: c } = await resolveLatestSeason();
          if (!alive) return;
          setSeason(resolved);
          setCatalog(c);
        }
      } catch (e: any) {
        if (alive) setCatalogError(String(e?.message ?? e));
      } finally {
        if (alive) setCatalogLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [season, reloadTick]);

  const retryCatalog = useCallback(() => {
    if (season) invalidateSeason(season);
    for (const s of SEASONS) invalidateSeason(s);
    setReloadTick((t) => t + 1);
  }, [season]);

  /** Week dropdown options, straight from this season's season_index.json. */
  const weekOptions = useMemo(() => catalog?.weeks ?? [], [catalog]);

  const scoreFileByWeek = useMemo(() => {
    const m: Record<string, FileItem> = {};
    for (const f of catalog?.scoreFiles ?? []) m[f.week] = f;
    return m;
  }, [catalog]);

  const gamesFileByWeek = useMemo(() => {
    const m: Record<string, FileItem> = {};
    for (const f of catalog?.gamesFiles ?? []) m[f.week] = f;
    return m;
  }, [catalog]);

  const [selectedWeek, setSelectedWeek] = useState("");
  // ?week= applies to the first resolved season only; after that the dropdown
  // owns the selection and switching seasons must not snap back to the URL.
  const deepWeekUsed = useRef(false);

  useEffect(() => {
    if (!weekOptions.length) { setSelectedWeek(""); return; }

    setSelectedWeek((prev) => {
      if (prev && weekOptions.some((w) => w.legacyKey === prev)) return prev;

      if (!deepWeekUsed.current && URL_WEEK) {
        const hit = weekOptions.find(
          (w) => w.legacyKey === URL_WEEK || w.id === URL_WEEK
        );
        deepWeekUsed.current = true;
        if (hit) return hit.legacyKey;
      }
      deepWeekUsed.current = true;

      // Default = latest available week of this season. (The old code took
      // weeks[0], which in an ascending season_index is the OLDEST week —
      // 2025 opened on Week 0's four games.)
      const last = latestWeek(catalog);
      return last?.legacyKey ?? weekOptions[weekOptions.length - 1].legacyKey;
    });
  }, [weekOptions, catalog]);

  /** Keep the address bar shareable without touching the router. */
  useEffect(() => {
    if (typeof window === "undefined" || !season || !selectedWeek) return;
    const params = new URLSearchParams(window.location.search);
    params.set("season", season);
    params.set("week", selectedWeek);
    const next = `${window.location.pathname}?${params.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [season, selectedWeek]);

  const [loading, setLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  const [games, setGames] = useState<GameMap>({});        // per-seed rows (CSV seasons)
  const [meta, setMeta]   = useState<GameMetaMap>({});    // games.csv (CSV seasons)
  const [jsonGames, setJsonGames] = useState<JsonGame[]>([]);  // small-JSON path

  const [sortBy, setSortBy] = useState<SortBy>("kickoff");

  const [useMean, setUseMean] = useState(false); // false = show medians (current), true = show means

  // ---- Conference dictionary + filter (from team_info.csv) ----
  const [teamToConf, setTeamToConf] = useState<Record<string, string>>({});
  const [confOptions, setConfOptions] = useState<string[]>([]);
  const [confFilter, setConfFilter] = useState<string>("all");

  useEffect(() => {
    if (!teamInfoRaw) return;
    const parsed = Papa.parse<Record<string, any>>(teamInfoRaw, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });
    const t2c: Record<string, string> = {};
    const confSet = new Set<string>();

    const teamKeys = ["team","Team","school","School","name","Name"];
    const confKeys = ["conference","Conference","conf","Conf"];

    for (const r of parsed.data || []) {
      if (!r) continue;
      const name = teamKeys.map(k=>r[k]).find(v => v != null && String(v).trim()!=="");
      const conf = confKeys.map(k=>r[k]).find(v => v != null && String(v).trim()!=="");
      if (!name) continue;
      const teamName = String(name).trim();
      const c = conf ? String(conf).trim() : "";
      if (c) {
        confSet.add(c);
        t2c[normTeamKey(teamName)] = c;
        t2c[normTeamKey(teamName.replace(/\s+/g,""))] = c;
      }
      const alias = r["short_name"] ?? r["Short Name"] ?? r["alias"] ?? r["Alias"];
      if (alias && c) {
        const a = String(alias).trim();
        t2c[normTeamKey(a)] = c;
        t2c[normTeamKey(a.replace(/\s+/g,""))] = c;
      }
    }
    setTeamToConf(t2c);
    setConfOptions(Array.from(confSet).sort((a,b)=>a.localeCompare(b)));
  }, []);

  const confOf = (team?: string) => (team ? teamToConf[normTeamKey(team)] ?? teamToConf[normTeamKey(team.replace(/\s+/g,""))] : undefined);

  /* ---- Week data: small JSON first, per-week CSV bundle only as a fallback ----
   *
   * Both seasons are migrating to the JSON contract. getJsonWeekGames returns
   * null when a week has no new-contract index yet, and only then do we pull
   * the ~1.5MB scores_bundle.csv. Once the 2025 export lands, this page stops
   * touching CSV entirely with no code change.
   */
  useEffect(() => {
    if (!season || !selectedWeek) {
      setGames({}); setMeta({}); setJsonGames([]);
      return;
    }

    const weekId =
      weekOptions.find((w) => w.legacyKey === selectedWeek)?.id ?? selectedWeek;

    const ac = new AbortController();
    let alive = true;
    setLoading(true);
    setWeekError(null);

    async function loadCsvWeek() {
        /* ---- sims (one bundled file per week) ---- */
        const bundle = scoreFileByWeek[selectedWeek];
        const simArrays = await Promise.all(
          (bundle ? [bundle] : []).map(async (item) => {
            const rows = await parseCsvFromItemSafe<any>(item);
            return rows
              .filter((r: any) => r && r.team != null && r.opp != null && r.pts != null && r.opp_pts != null)
              .map((r: any) => ({
                team: String(r.team),
                opp: String(r.opp),
                pts: Number(r.pts),
                opp_pts: Number(r.opp_pts),
              })) as SimRow[];
          })
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
        const gamesFile = gamesFileByWeek[selectedWeek];
        const metaArrays = await Promise.all(
          (gamesFile ? [gamesFile] : []).map((item) => parseCsvFromItemSafe<any>(item))
        );

        const m: GameMetaMap = {};
        for (const arr of metaArrays) {
          for (const row of arr) {
            if (!row) continue;
            const a = String(row["Team A"] ?? row.team_a ?? row.teamA ?? row.A ?? row.Home ?? row.home ?? "").trim();
            const b = String(row["Team B"] ?? row.team_b ?? row.teamB ?? row.B ?? row.Away ?? row.away ?? "").trim();
            if (!a || !b) continue;

            // finals (numbers)
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
        // Player sims are no longer loaded per week (~50MB). Each card fetches
        // its own matchup on demand when its player panel is opened.
    }

    (async () => {
      try {
        const rows = await getJsonWeekGames(weekId, season, ac.signal);
        if (!alive) return;

        if (rows) {
          setJsonGames(rows);
          setGames({});
          setMeta({});
          return;
        }

        // No new-contract index for this week yet — legacy CSV path.
        setJsonGames([]);
        await loadCsvWeek();
      } catch (e: any) {
        if (e?.name === "AbortError" || !alive) return;
        // A failed load used to leave the page stuck on "Loading…" forever.
        console.error("[Scoreboard] week load failed:", e);
        setGames({});
        setMeta({});
        setJsonGames([]);
        setWeekError(String(e?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; ac.abort(); };
  }, [season, selectedWeek, weekOptions, scoreFileByWeek, gamesFileByWeek]);

  /* ---- Viewer preferences (item 10 + 13). Both persist in localStorage,
   * guarded inside usePrefs so a blocked-storage browser just gets defaults. */
  const { resolved: themeResolved, cycle: cycleTheme, mode: themeMode } = useThemeMode();
  const { density, toggle: toggleDensity } = useDensity();
  const condensed = density === "condensed";

  /* ---- Expanded panel. Lifted out of the card so the panel can render as a
   * separate full-width grid item: a card must never change size because
   * something inside it opened. ---- */
  const [openPanel, setOpenPanel] = useState<{ key: string; kind: PanelKind } | null>(null);

  const togglePanel = useCallback((key: string, kind: PanelKind) => {
    setOpenPanel((prev) => (prev && prev.key === key && prev.kind === kind ? null : { key, kind }));
  }, []);

  /**
   * How many columns the card grid is actually rendering, mirroring
   * `repeat(auto-fit, minmax(320px, 1fr))`. Needed so the break-out panel is
   * inserted after the LAST card of the expanded card's row rather than
   * immediately after the card, which would leave a hole in the row.
   */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridCols, setGridCols] = useState(1);

  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.clientWidth;
      setGridCols(gridColumnsFor(w, GRID_MIN[density]));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Density changes the track width, so the column count must be re-measured.
  }, [density]);

  /* ---- Slate-wide edges (item 3 + 4). Opt-in: the cards load their own
   * compacts lazily, so this only runs when the Edge sort or the Top Edges
   * panel actually needs the whole slate. Everything goes through the same
   * caches, so already-visible games cost nothing. ---- */
  const [slateEdges, setSlateEdges] = useState<Map<string, GameEdges> | null>(null);
  const [edgesLoading, setEdgesLoading] = useState(false);
  const [showTopEdges, setShowTopEdges] = useState(false);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  /* ---- Parlay slip. Lives at page level so it survives week/season switches;
   * each leg carries its own game/season identity. ---- */
  const [parlayOpen, setParlayOpen] = useState(false);
  const [slipHeight, setSlipHeight] = useState(0);
  const [legs, setLegs] = useState<Leg[]>([]);

  const addLeg = useCallback((leg: Leg) => {
    setLegs((prev) => (prev.some((l) => l.id === leg.id) ? prev : [...prev, leg]));
  }, []);
  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }, []);

  /** Dataset directory for the selected week (e.g. "week00"). */
  const weekId = useMemo(
    () => weekOptions.find((w) => w.legacyKey === selectedWeek)?.id ?? selectedWeek,
    [weekOptions, selectedWeek]
  );

  /* ---- Kalshi market data for this week (slim side-by-side on each card) ----
   * Server-cached 45s and mapped to our slugs there; the row simply does not
   * render when the feed is unavailable or a game is not listed. */
  const [kalshiBySlug, setKalshiBySlug] = useState<Map<string, KalshiGame>>(new Map());

  useEffect(() => {
    if (!season || !selectedWeek) { setKalshiBySlug(new Map()); return; }
    const weekId =
      weekOptions.find((w) => w.legacyKey === selectedWeek)?.id ?? selectedWeek;

    const ac = new AbortController();
    let alive = true;
    (async () => {
      try {
        const payload = await getKalshiCfb(season, weekId, ac.signal);
        if (alive) setKalshiBySlug(indexKalshiBySlug(payload));
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (alive) setKalshiBySlug(new Map());
      }
    })();
    return () => { alive = false; ac.abort(); };
  }, [season, selectedWeek, weekOptions]);

  /* ---------- cards, CSV seasons (join per-seed sims with meta, compute picks) ---------- */
  const cards2025: CardGame[] = useMemo(() => {
    const out: CardGame[] = [];
    for (const [key, g] of Object.entries(games)) {
      const Avals = g.rowsA.map((r) => r.pts);
      const Bvals = g.rowsA.map((r) => r.opp_pts);
      const medA = Math.round(median(Avals));
      const medB = Math.round(median(Bvals));
      const meanA = Math.round(mean(Avals));
      const meanB = Math.round(mean(Bvals));
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
          const pickedOver = (simsA + simsB) > t;
          totalProb = pickedOver ? over : under;
        }
      }

      // Spread probability at the book line (Team A line)
      let spreadProb: number | undefined;
      if (joined?.spread !== undefined) {
        const s = joined.spread; // Team A line
        const Avals_oriented = g.teamA === joined.teamA
          ? g.rowsA.map(r => r.pts)
          : g.rowsA.map(r => r.opp_pts);
        const Bvals_oriented = g.teamA === joined.teamA
          ? g.rowsA.map(r => r.opp_pts)
          : g.rowsA.map(r => r.pts);

        let coverA = 0;
        const n = Math.min(Avals_oriented.length, Bvals_oriented.length);
        for (let i = 0; i < n; i++) {
          if ((Avals_oriented[i] + s) > Bvals_oriented[i]) coverA++;
        }
        const pA = n ? coverA / n : undefined;

        const diff = (simsA + s) - simsB; // >0 means Team A covers
        if (typeof pA === "number") {
          spreadProb = diff > 0 ? pA : 1 - pA;
        }
      }

      let aWins = 0, bWins = 0, ties = 0;
      for (const r of g.rowsA) {
        if (r.pts > r.opp_pts) aWins++;
        else if (r.pts < r.opp_pts) bWins++;
        else ties++;
      }
      const nPairs = g.rowsA.length;
      const pA = nPairs ? (aWins + 0.5 * ties) / nPairs : undefined; // P(teamA wins)
      const pB = typeof pA === "number" ? 1 - pA : undefined;

      let mlPickTeam: string | undefined;
      let mlPickProb: number | undefined;
      let mlFair: string | undefined;

      if (typeof pA === "number" && typeof pB === "number") {
        const pickA = pA >= pB;
        mlPickTeam = pickA ? g.teamA : g.teamB;
        mlPickProb = pickA ? pA : pB;
        mlFair = americanOdds(mlPickProb); // uses your helper below
      }

      let mlResult: "win" | "loss" | "push" | undefined;

      if (joined && Number.isFinite(joined.finalA) && Number.isFinite(joined.finalB)) {
        const fA = joined.finalA as number;
        const fB = joined.finalB as number;

        // ...existing spread/total grading...

        // --- ML grading (compare predicted winner vs actual winner) ---
        if (typeof mlPickTeam === "string") {
          if (fA === fB) {
            mlResult = "push"; // tie/void
          } else {
            const actualWinner = fA > fB ? joined.teamA : joined.teamB;
            mlResult = (actualWinner === mlPickTeam) ? "win" : "loss";
          }
        }
      }


      // let spreadResult: "win" | "loss" | "push" | undefined;
      // let totalResult:  "win" | "loss" | "push" | undefined;
      // let dispFinalA: number | undefined;
      // let dispFinalB: number | undefined;

      // if (joined && Number.isFinite(joined.finalA) && Number.isFinite(joined.finalB)) {
      //   const fA = joined.finalA as number;
      //   const fB = joined.finalB as number;

      //   // spread grading vs our pick
      //   if (Number.isFinite(joined.spread)) {
      //     const s = joined.spread as number;
      //     const diff = (simsA + s) - simsB;
      //     const coverA = (fA + s) > fB ? 1 : (fA + s) < fB ? -1 : 0;
      //     const pickedA = diff > 0;
      //     if (coverA === 0) {
      //       spreadResult = "push";
      //     } else {
      //       const pickedWins = (coverA > 0 && pickedA) || (coverA < 0 && !pickedA);
      //       spreadResult = pickedWins ? "win" : "loss";
      //     }
      //   }

      //   // Finals aligned to the card’s display orientation
      //   // if (joined && g.teamA !== joined.teamA) {
      //   //   dispFinalA = joined.finalB as number;
      //   //   dispFinalB = joined.finalA as number;
      //   // } else {
      //   //   dispFinalA = joined.finalA as number;
      //   //   dispFinalB = joined.finalB as number;
      //   // }

        

      //   // total grading vs our pick
      //   if (Number.isFinite(joined.total)) {
      //     const lineT     = joined.total as number;
      //     const gameTotal = (joined.finalA as number) + (joined.finalB as number);
      //     const predTotal = simsA + simsB;

      //     const actualSide    = gameTotal > lineT ? "Over"  : gameTotal < lineT ? "Under" : "Push";
      //     const predictedSide = predTotal > lineT ? "Over"  : predTotal < lineT ? "Under" : "Push";

      //     totalResult = (actualSide === "Push" || predictedSide === "Push")
      //       ? "push"
      //       : (actualSide === predictedSide ? "win" : "loss");
      //   }
      // }
      // pull live for this card
      const { lg, inProgress, aScore, bScore, statusText } = getCardLive(g);

      // CSV finals present?
      const csvHasFinals = joined && Number.isFinite(joined.finalA) && Number.isFinite(joined.finalB);

      // sims orientation (book vs display)
      // let simsA = medA, simsB = medB;
      const flipped = Boolean(joined && g.teamA !== joined.teamA);
      if (flipped) { simsA = medB; simsB = medA; }

      // --- picks (your existing code above for pickSpread/pickTotal/spreadProb/ml etc.) stays as-is ---

      let dispFinalA: number | undefined;
      let dispFinalB: number | undefined;
      let scoreSource: "CSV_FINALS" | "LIVE" | "UPCOMING" = "UPCOMING";

      // 1) CSV finals (use & grade)
      if (csvHasFinals) {
        dispFinalA = flipped ? (joined!.finalB as number) : (joined!.finalA as number);
        dispFinalB = flipped ? (joined!.finalA as number) : (joined!.finalB as number);
        scoreSource = "CSV_FINALS";
      } else {
        // 2) otherwise: live if present (show only; no grading)
        const liveHasScores = Number.isFinite(aScore) && Number.isFinite(bScore);
        if (liveHasScores) {
          dispFinalA = aScore as number;
          dispFinalB = bScore as number;
          scoreSource = "LIVE";
        } else {
          // 3) upcoming: no scores
          dispFinalA = undefined;
          dispFinalB = undefined;
          scoreSource = "UPCOMING";
        }
      }

      // --- grading: ONLY when csv finals exist ---
      let spreadResult: "win" | "loss" | "push" | undefined;
      let totalResult:  "win" | "loss" | "push" | undefined;
      // let mlResult:     "win" | "loss" | "push" | undefined;

      if (csvHasFinals) {
        const fA_book = joined!.finalA as number;
        const fB_book = joined!.finalB as number;

        if (Number.isFinite(joined?.spread)) {
          const s = joined!.spread as number;
          const coverA = (fA_book + s) > fB_book ? 1 : (fA_book + s) < fB_book ? -1 : 0;
          const pickedA = ((simsA + s) - simsB) > 0; // sims already aligned via `flipped`
          spreadResult = coverA === 0 ? "push" : ((coverA > 0 && pickedA) || (coverA < 0 && !pickedA)) ? "win" : "loss";
        }

        if (Number.isFinite(joined?.total)) {
          const lineT     = joined!.total as number;
          const gameTotal = fA_book + fB_book;
          const predTotal = simsA + simsB;
          const actualSide    = gameTotal > lineT ? "Over"  : gameTotal < lineT ? "Under" : "Push";
          const predictedSide = predTotal > lineT ? "Over"  : predTotal < lineT ? "Under" : "Push";
          totalResult = (actualSide === "Push" || predictedSide === "Push")
            ? "push"
            : (actualSide === predictedSide ? "win" : "loss");
        }

        if (typeof mlPickTeam === "string") {
          if (fA_book === fB_book) mlResult = "push";
          else {
            const actualWinnerInBook = fA_book > fB_book ? joined!.teamA : joined!.teamB;
            mlResult = (actualWinnerInBook === mlPickTeam) ? "win" : "loss";
          }
        }
      }

      // --- DEBUG: one compact line per card ---
      console.debug("SCORE DECISION", {
        week: selectedWeek,
        teams: `${g.teamA} vs ${g.teamB}`,
        source: scoreSource,
        csv: joined ? { A: joined.finalA, B: joined.finalB } : null,
        live: { state: lg?.state, a: aScore, b: bScore, status: statusText },
        flipped
      });

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
        mlPickTeam,
        mlPickProb,
        mlFair,
        mlResult,
        scoreSource,
        liveInProgress: inProgress,
        liveStatusText: statusText,
        liveA: aScore,
        liveB: bScore,
      });
    }

    return out;
  }, [games, meta, getCardLive, selectedWeek]);

  /* ---------- cards, JSON seasons (one summary.json per game) ----------
   *
   * summary.json carries headline numbers, not per-seed rows. It publishes the
   * per-team medians directly — which matters, because median(A) + median(B)
   * is not median(total), so recovering points from margin+total would print
   * a score the sim never produced (TCU/UNC: 24-17 exact vs 25-19 derived).
   *
   * spreadProb/totalProb are deliberately left undefined. The exact cover/over
   * rates need the per-seed arrays in compact.json, and pulling one compact per
   * game just to fill the card list would rebuild the ~MB-per-week fetch this
   * layout exists to avoid. A normal approximation off p25/p75 in their place
   * would be inventing a number the sim never produced.
   */
  const cardsJson: CardGame[] = useMemo(() => {
    const out: CardGame[] = [];

    for (const { row, summary } of jsonGames) {
      if (!summary) continue;

      const teamA = summary.teamA || row.teamA;   // home
      const teamB = summary.teamB || row.teamB;   // away

      const margin = summary.median_margin;       // home - away
      const total = summary.median_total;

      // Exact medians when present; fall back to the margin/total pair only if
      // an older export lacks them.
      let medA = summary.median_A_pts;
      let medB = summary.median_B_pts;
      if (!Number.isFinite(medA) || !Number.isFinite(medB)) {
        if (!Number.isFinite(margin) || !Number.isFinite(total)) continue;
        medA = ((total as number) + (margin as number)) / 2;
        medB = ((total as number) - (margin as number)) / 2;
      }
      medA = Math.round(medA as number);
      medB = Math.round(medB as number);

      const meanA = Number.isFinite(summary.mean_A_pts)
        ? Math.round(summary.mean_A_pts as number)
        : medA;
      const meanB = Number.isFinite(summary.mean_B_pts)
        ? Math.round(summary.mean_B_pts as number)
        : medB;

      const { lg, inProgress, aScore, bScore, statusText } = getCardLive({ teamA, teamB });

      const { ms, label } = parseKickoffMs(row.date, undefined, row.time_utc);

      // Prefer the OPEN line: bets go in early in the week, so the open is the
      // number the pick is judged against.
      const o = summary.odds ?? null;
      const spread = o?.spread_open ?? o?.spread_current ?? undefined;   // home perspective
      const totalLine = o?.over_under_open ?? o?.over_under_current ?? undefined;

      let pickSpread: string | undefined;
      if (Number.isFinite(spread)) {
        const s = spread as number;
        const diff = (medA + s) - medB;
        if (Math.abs(diff) < 1e-9) pickSpread = `Push @ ${s > 0 ? `+${s}` : `${s}`}`;
        else if (diff > 0) pickSpread = `${teamA} ${s > 0 ? `+${s}` : `${s}`}`;
        else pickSpread = `${teamB} ${(-s) > 0 ? `+${-s}` : `${-s}`}`;
      }

      let pickTotal: string | undefined;
      if (Number.isFinite(totalLine)) {
        pickTotal = (medA + medB) > (totalLine as number)
          ? `Over ${totalLine}`
          : `Under ${totalLine}`;
      }

      // A_win_prob is P(home) and comes straight from the sim — exact, unlike
      // the derived spread/total probabilities above.
      let mlPickTeam: string | undefined;
      let mlPickProb: number | undefined;
      let mlFair: string | undefined;
      const pA = summary.A_win_prob;
      if (typeof pA === "number" && pA >= 0 && pA <= 1) {
        const pickA = pA >= 0.5;
        mlPickTeam = pickA ? teamA : teamB;
        mlPickProb = pickA ? pA : 1 - pA;
        mlFair = americanOdds(mlPickProb);
      }

      const fA = summary.finalA;
      const fB = summary.finalB;
      const hasFinals = Number.isFinite(fA) && Number.isFinite(fB);

      let dispFinalA: number | undefined;
      let dispFinalB: number | undefined;
      let scoreSource: "CSV_FINALS" | "LIVE" | "UPCOMING" = "UPCOMING";
      if (hasFinals) {
        dispFinalA = fA as number;
        dispFinalB = fB as number;
        scoreSource = "CSV_FINALS";
      } else if (Number.isFinite(aScore) && Number.isFinite(bScore)) {
        dispFinalA = aScore as number;
        dispFinalB = bScore as number;
        scoreSource = "LIVE";
      }

      let spreadResult: "win" | "loss" | "push" | undefined;
      let totalResult: "win" | "loss" | "push" | undefined;
      let mlResult: "win" | "loss" | "push" | undefined;

      if (hasFinals) {
        const finA = fA as number;
        const finB = fB as number;

        if (Number.isFinite(spread)) {
          const s = spread as number;
          const coverA = (finA + s) > finB ? 1 : (finA + s) < finB ? -1 : 0;
          const pickedA = ((medA + s) - medB) > 0;
          spreadResult = coverA === 0
            ? "push"
            : ((coverA > 0 && pickedA) || (coverA < 0 && !pickedA)) ? "win" : "loss";
        }

        if (Number.isFinite(totalLine)) {
          const lineT = totalLine as number;
          const gameTotal = finA + finB;
          const predTotal = medA + medB;
          const actualSide = gameTotal > lineT ? "Over" : gameTotal < lineT ? "Under" : "Push";
          const predictedSide = predTotal > lineT ? "Over" : predTotal < lineT ? "Under" : "Push";
          totalResult = (actualSide === "Push" || predictedSide === "Push")
            ? "push"
            : (actualSide === predictedSide ? "win" : "loss");
        }

        if (typeof mlPickTeam === "string") {
          if (finA === finB) mlResult = "push";
          else mlResult = ((finA > finB ? teamA : teamB) === mlPickTeam) ? "win" : "loss";
        }
      }

      out.push({
        key: row.slug,
        teamA, teamB,
        medA, medB,
        meanA, meanB,
        kickoffLabel: label,
        kickoffMs: Number.isFinite(ms) ? ms : undefined,
        pickSpread, pickTotal,
        spreadProb: undefined, totalProb: undefined,
        spreadResult, totalResult,
        finalA: dispFinalA,
        finalB: dispFinalB,
        mlPickTeam, mlPickProb, mlFair, mlResult,
        scoreSource,
        liveInProgress: inProgress,
        liveStatusText: statusText ?? lg?.statusText,
        liveA: aScore,
        liveB: bScore,
        jsonRow: row,
        pHome: typeof pA === "number" ? pA : undefined,
        nsims: summary.nsims,
        oddsSpread: Number.isFinite(spread) ? (spread as number) : undefined,
        oddsTotal: Number.isFinite(totalLine) ? (totalLine as number) : undefined,
        simMedMargin: Number.isFinite(margin) ? (margin as number) : undefined,
        simMedTotal: Number.isFinite(total) ? (total as number) : undefined,
        simMeanMargin: summary.mean_margin,
        simMeanTotal: summary.mean_total,
      });
    }

    return out;
  }, [jsonGames, getCardLive]);

  // Whichever path produced rows for this week. Both cannot be populated at
  // once: the loader clears one before filling the other.
  const cards = useMemo(
    () => sortCards(cardsJson.length ? cardsJson : cards2025, sortBy, slateEdges),
    [cardsJson, cards2025, sortBy, slateEdges]
  );

  /** Inputs for the slate scan: only JSON-season cards can be priced. */
  const edgeInputs: EdgeInput[] = useMemo(
    () => cards.filter((c) => c.jsonRow).map((c) => ({
      slug: c.key, teamA: c.teamA, teamB: c.teamB, row: c.jsonRow!,
      bookSpread: c.oddsSpread, bookTotal: c.oddsTotal,
      simMargin: useMean ? c.simMeanMargin : c.simMedMargin,
      simTotal: useMean ? c.simMeanTotal : c.simMedTotal,
      pHome: c.pHome, kickoffMs: c.kickoffMs,
    })),
    [cards, useMean]
  );

  const wantEdges = sortBy === "edge" || showTopEdges;

  useEffect(() => {
    if (!wantEdges || !edgeInputs.length || !season) return;
    const ac = new AbortController();
    let alive = true;
    setEdgesLoading(true);
    ensureSlateEdges(edgeInputs, kalshiBySlug, season, ac.signal)
      .then((m) => { if (alive) setSlateEdges(m); })
      .catch((e) => { if (e?.name !== "AbortError") console.warn("[edges] scan failed:", e); })
      .finally(() => { if (alive) setEdgesLoading(false); });
    return () => { alive = false; ac.abort(); };
  }, [wantEdges, edgeInputs, kalshiBySlug, season]);

  // A new week invalidates the previous slate's edges.
  useEffect(() => { setSlateEdges(null); }, [season, selectedWeek]);

  // Apply conference filter (game shows if either team is in selected conference)
  const filteredCards = useMemo(() => {
    if (confFilter === "all") return cards;
    return cards.filter(c => (confOf(c.teamA) === confFilter) || (confOf(c.teamB) === confFilter));
  }, [cards, confFilter, teamToConf]);

  /** Scroll to a game's card and flash it, from the Top Edges list. */
  const jumpToGame = useCallback((slug: string) => {
    setShowTopEdges(false);
    // Let the panel unmount first so the card lands at a stable offset.
    requestAnimationFrame(() => {
      const el = document.getElementById(`game-${slug}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashKey(slug);
      window.setTimeout(() => setFlashKey((k) => (k === slug ? null : k)), 1800);
    });
  }, []);

  /** Human week label for the card header (replaces the hardcoded "week"). */
  const weekLabel = useMemo(
    () => weekOptions.find((w) => w.legacyKey === selectedWeek)?.label ?? selectedWeek,
    [weekOptions, selectedWeek]
  );

  /** Index of the expanded card in the filtered list, and the card itself. */
  const openIdx = useMemo(
    () => (openPanel ? filteredCards.findIndex((c) => c.key === openPanel.key) : -1),
    [openPanel, filteredCards]
  );
  const openCard = openIdx >= 0 ? filteredCards[openIdx] : null;

  // Close the panel if its card leaves the slate (week/season/filter change).
  useEffect(() => {
    if (openPanel && openIdx < 0) setOpenPanel(null);
  }, [openPanel, openIdx]);

  /**
   * Sim counts across the slate: one number when uniform, a min-max range when
   * mixed. Makes a re-publish (200 -> 1,000 -> 10,000 seeds) visible at a
   * glance without opening a card.
   */
  const simsText = useMemo(() => {
    const ns = filteredCards.map((c) => c.nsims).filter((n): n is number => Number.isFinite(n) && (n as number) > 0);
    if (!ns.length) return "";
    const lo = Math.min(...ns);
    const hi = Math.max(...ns);
    const fmt = (n: number) => n.toLocaleString("en-US");
    return lo === hi ? ` \u00b7 ${fmt(lo)} sims` : ` \u00b7 ${fmt(lo)}\u2013${fmt(hi)} sims`;
  }, [filteredCards]);

  // Compact toolbar tokens — the row must fit on one line at desktop widths.
  const CTL = { maxWidth: 190 } as const;
  const LBL = { fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" } as const;
  const HDG = { margin: 0, fontSize: 14, fontWeight: 800, color: "var(--brand-text)", whiteSpace: "nowrap" } as const;

  const statusText = catalogLoading
    ? "Loading seasons…"
    : catalogError
    ? "Dataset unavailable"
    : loading
    ? "Loading…"
    : `${filteredCards.length} game${filteredCards.length === 1 ? "" : "s"}${simsText}`;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      {/* Season + Week selector. Sticky so week/sort stay reachable on a
          60-game slate; the opaque background stops cards showing through. */}
      <section
        className="card"
        style={{
          padding: 10, marginBottom: 16,
          position: "sticky", top: 0, zIndex: 30,
          background: "var(--card)",
          boxShadow: "0 2px 10px var(--shadow)",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
            <h2 style={HDG}>Season</h2>
            <select
              value={season}
              onChange={(e) => { deepWeekUsed.current = true; setSelectedWeek(""); setSeason(e.target.value); }}
              disabled={catalogLoading && !season}
              className="ui-sel" style={CTL}
            >
              {!season && <option value="">…</option>}
              {SEASONS.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>

            <h2 style={HDG}>Week</h2>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              disabled={!weekOptions.length}
              className="ui-sel" style={CTL}
            >
              {!weekOptions.length && <option value="">—</option>}
              {weekOptions.map((w) => (
                <option key={w.id} value={w.legacyKey}>{w.label}</option>
              ))}
            </select>

            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{statusText}</span>

          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
            {/* NEW: Conference filter */}
            <button
              type="button"
              onClick={() => setParlayOpen((v) => !v)}
              className="ui-btn"
              data-on={parlayOpen ? "true" : "false"}
              style={{ fontWeight: 700, whiteSpace: "nowrap" }}
            >
              {parlayOpen ? "Close Parlay Builder" : "Parlay Builder"}
              {legs.length > 0 && ` (${legs.length})`}
            </button>

            <button
              type="button"
              className="ui-btn"
              data-on={showTopEdges ? "true" : "false"}
              onClick={() => setShowTopEdges((v) => !v)}
              style={{ fontWeight: 700, whiteSpace: "nowrap" }}
            >
              Top Edges
            </button>

            <button
              type="button"
              className="ui-btn icon"
              onClick={toggleDensity}
              title={`Density: ${density} (click to switch)`}
              aria-label={`Card density: ${density}`}
            >
              {condensed ? "\u25A4" : "\u25A6"}
            </button>

            <button
              type="button"
              className="ui-btn icon"
              onClick={cycleTheme}
              title={`Theme: ${themeMode}${themeMode === "system" ? ` (${themeResolved})` : ""} \u2014 click to change`}
              aria-label={`Theme: ${themeMode}`}
            >
              {themeMode === "system" ? "\u25D1" : themeResolved === "dark" ? "\u263E" : "\u2600"}
            </button>

            <label style={LBL}>Conf:</label>
            <select
              value={confFilter}
              onChange={(e)=>setConfFilter(e.target.value)}
              className="ui-sel" style={CTL}
            >
              <option value="all">All conferences</option>
              {confOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <label style={LBL}>Sort:</label>
            <select
              value={sortBy}
              onChange={(e)=>setSortBy(e.target.value as any)}
              className="ui-sel" style={CTL}
            >
              <option value="kickoff">Kickoff time</option>
              <option value="edge">Edge</option>
            </select>
            {sortBy === "edge" && edgesLoading && (
              <span
                style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}
                role="status"
              >
                computing…
              </span>
            )}

            <label style={LBL}>Score:</label>
            <select
              value={useMean ? "mean" : "median"}
              onChange={(e)=>setUseMean(e.target.value === "mean")}
              className="ui-sel" style={CTL}
            >
              <option value="median">Median</option>
              <option value="mean">Mean</option>
            </select>
          </div>
        </div>
      </section>

      {/* Failure states — a dead catalog or a dead week must LOOK dead, with a
          way out. Silently rendering an empty grid is how this page used to
          read as "broken site". */}
      {catalogError && (
        <section
          className="card"
          style={{ padding: 16, marginBottom: 16, border: "1px solid var(--border)", background: "var(--card)" }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Couldn’t load the sim dataset</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            {catalogError}
          </div>
          <button
            type="button"
            onClick={retryCatalog}
            className="ui-btn" data-on="true"
            style={{ padding: "8px 14px", fontWeight: 700 }}
          >
            Retry
          </button>
        </section>
      )}

      {!catalogError && weekError && (
        <section
          className="card"
          style={{ padding: 16, marginBottom: 16, border: "1px solid var(--border)", background: "var(--card)" }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            Couldn’t load {season} {selectedWeek}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{weekError}</div>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="ui-btn" data-on="true"
            style={{ padding: "8px 14px", fontWeight: 700 }}
          >
            Retry
          </button>
        </section>
      )}

      {(loading || catalogLoading) && !filteredCards.length && (
        <div
          style={{
            display: "grid", gap: GRID_GAP,
            gridTemplateColumns: `repeat(auto-fit, minmax(${GRID_MIN[density]}px, 1fr))`,
            marginBottom: 16,
          }}
        >
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!catalogError && !weekError && !loading && !catalogLoading && !filteredCards.length && (
        <section className="card" style={{ padding: 16, marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
          No games for this selection.
        </section>
      )}

      {/* Reserve room for the fixed slip so it can never sit on top of the
          last cards (it is a full-width bottom sheet under 720px). */}
      {parlayOpen && slipHeight > 0 && <div aria-hidden style={{ height: slipHeight + 16 }} />}

      {parlayOpen && (
        <ParlaySlip
          legs={legs}
          onRemove={removeLeg}
          onClear={() => setLegs([])}
          onClose={() => setParlayOpen(false)}
          onHeight={setSlipHeight}
        />
      )}

      {showTopEdges && (
        <TopEdges
          edges={slateEdges}
          loading={edgesLoading && !slateEdges}
          onPick={jumpToGame}
          onClose={() => setShowTopEdges(false)}
        />
      )}

      {/* Cards grid.
          Cards are fixed-size grid items; an expanded panel is a SEPARATE
          full-width item (grid-column 1/-1) placed after the last card of the
          expanded card's row, so opening a panel can never resize a card or
          stretch its neighbours. */}
      <div
        ref={gridRef}
        style={{
          display: "grid",
          gap: GRID_GAP,
          gridTemplateColumns: `repeat(auto-fit, minmax(${GRID_MIN[density]}px, 1fr))`,
          alignItems: "stretch",
        }}
      >
        {filteredCards.map((c, idx) => {
          const isOpen = openPanel?.key === c.key;
          // End of the row that contains the expanded card.
          const rowEnd = panelRowEnd(openIdx, gridCols, filteredCards.length);

          return (
            <Fragment key={c.key}>
              <GameCard
                card={c}
                gdata={games[c.key]}
                useMean={useMean}
                kalshi={c.jsonRow ? kalshiBySlug.get(c.key) : undefined}
                parlayOpen={parlayOpen}
                openKind={isOpen ? openPanel!.kind : null}
                onToggle={(kind) => togglePanel(c.key, kind)}
                weekLabel={weekLabel}
                condensed={condensed}
                season={season}
                onAddLeg={() => togglePanel(c.key, "picker")}
                flash={flashKey === c.key}
              />
              {openPanel && idx === rowEnd && openCard && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <CardPanelHost
                    card={openCard}
                    kind={openPanel.kind}
                    gdata={games[openCard.key]}
                    week={selectedWeek}
                    season={season}
                    weekId={weekId}
                    useMean={useMean}
                    onAddLeg={addLeg}
                    onClose={() => setOpenPanel(null)}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* The page can still throw on unexpected data (a malformed CSV row, a summary
   with a shape we did not anticipate). Without a boundary that unmounts the
   whole app and shows a white screen. */
export default function Scoreboard() {
  return (
    <ErrorBoundary label="Scoreboard">
      <ScoreboardPage />
    </ErrorBoundary>
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

// inside component, below state/hooks
// const todayET = new Date()
//   .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
//   .replace(/-/g, "");
// const livePayload = useLiveScoreboard(todayET);
// const liveGames: LiveGame[] = livePayload ? mapEspnToLiveGames(livePayload) : [];
// const liveMap = new Map<string, LiveGame>();
// for (const g of liveGames) liveMap.set(pairKey(g.awayTeam, g.homeTeam), g);

// function getCardLive(game: { teamA: string; teamB: string }) {
//   const lg = liveMap.get(pairKey(game.teamA, game.teamB));
//   const inProgress = lg?.state === "in";
//   let aScore: number | undefined, bScore: number | undefined;
//   if (lg) {
//     const aMatchesAway = clean(game.teamA) === clean(lg.awayTeam);
//     aScore = aMatchesAway ? lg.awayScore : lg.homeScore;
//     bScore = aMatchesAway ? lg.homeScore : lg.awayScore;
//   }
//   return { lg, inProgress, aScore, bScore, statusText: lg?.statusText };
// }


export function GameCard({
  card, gdata, useMean = false, kalshi, parlayOpen, openKind, onToggle,
  weekLabel, condensed = false, onAddLeg, season, flash = false,
}: {
  card: CardGame;
  /** Per-seed rows. Undefined on JSON seasons, which publish summaries only. */
  gdata?: GameData;
  useMean?: boolean;
  /** Kalshi market data for this game, when the feed lists it. */
  kalshi?: KalshiGame;
  parlayOpen: boolean;
  /** Which panel this card currently owns, or null. Panels render OUTSIDE the
   *  card (full grid width) so expanding one never resizes the card itself. */
  openKind: PanelKind | null;
  onToggle: (kind: PanelKind) => void;
  /** Real week label, replacing the hardcoded "week" placeholder. */
  weekLabel: string;
  condensed?: boolean;
  /** Parlay leg picker trigger, now hosted on the header line. */
  onAddLeg?: () => void;
  season: Season;
  /** Pulse after being jumped to from the Top Edges list. */
  flash?: boolean;
}) {
  const jsonRow = card.jsonRow;
  const csvCard = !jsonRow;
  const hasSeedRows = Boolean(gdata?.rowsA?.length);
  const canShowScores = hasSeedRows || Boolean(jsonRow);

  const aColors = getTeamColors(card.teamA);
  const bColors = getTeamColors(card.teamB);
  const aLogo = getTeamLogo(card.teamA);
  const bLogo = getTeamLogo(card.teamB);

  const expanded = openKind !== null;

  const tabBtn = (kind: PanelKind, label: string, accent = false) => (
    <button
      className="ui-btn"
      data-on={openKind === kind ? "true" : "false"}
      data-tone={accent ? "accent" : undefined}
      onClick={() => onToggle(kind)}
      style={condensed ? { padding: "4px 8px", fontSize: 12 } : undefined}
    >
      {label}
    </button>
  );

  return (
    <article
      id={`game-${card.key}`}
      className={flash ? "card card-flash" : "card"}
      style={{
        padding: condensed ? 8 : 12,
        borderRadius: 12,
        // The open card keeps a highlighted border so it stays visually tied
        // to its panel, which now sits on its own full-width row below.
        border: `1px solid ${expanded ? "var(--brand)" : "var(--border)"}`,
        // Home team's primary as a left accent turns a uniform grid into
        // something scannable; falls back to the brand when unknown.
        borderLeft: `3px solid ${expanded ? "var(--brand)" : (aColors?.primary ?? "var(--brand)")}`,
        boxShadow: expanded ? "0 0 0 1px var(--brand)" : "none",
        background: "var(--card)",
        display: "grid", gap: condensed ? 6 : 8,
        alignContent: "start",
      }}
    >
      {/* Header: real week label + a genuine status.
          Was a hardcoded lowercase "week" and a bare "TBD". */}
      {(() => {
        const isFinal = card.scoreSource === "CSV_FINALS";
        const isLive = Boolean(card.liveInProgress);
        const status = isFinal
          ? "Final"
          : isLive
          ? (card.liveStatusText || "In progress")
          : card.scoreSource === "LIVE" && card.liveStatusText
          ? card.liveStatusText
          : card.kickoffLabel ?? "Scheduled";

        return (
          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span style={{ letterSpacing: 0.3, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {weekLabel}
            </span>
            <span
              style={{
                whiteSpace: "nowrap", fontWeight: isLive || isFinal ? 800 : 400,
                marginLeft: "auto",
                color: isLive ? "var(--neg)" : isFinal ? "var(--text)" : "var(--muted)",
              }}
            >
              {isLive && (
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: 999,
                  background: "var(--neg)", marginRight: 5, verticalAlign: "middle",
                }} />
              )}
              {status}
            </span>

            {/* Add-leg sits on the status line, brand-filled so it reads as the
                one primary action on the card while the builder is open. */}
            {parlayOpen && jsonRow && onAddLeg && (
              <button
                type="button"
                onClick={onAddLeg}
                className="ui-btn primary"
                data-on={openKind === "picker" ? "true" : "false"}
                style={{ padding: "3px 11px", fontSize: 11.5, whiteSpace: "nowrap", letterSpacing: 0.2, borderRadius: 999 }}
              >
                {openKind === "picker" ? "Cancel" : "+ Add leg"}
              </button>
            )}
          </div>
        );
      })()}

      {/* teams + scores (stacked with Projected / Actual) */}
      {(() => {
        const projA = useMean ? card.meanA : card.medA;
        const projB = useMean ? card.meanB : card.medB;
        const hasFinalA = Number.isFinite(card.finalA);
        const hasFinalB = Number.isFinite(card.finalB);
        // Typography hierarchy: the projected score is the headline, team names
        // step back to 600, captions shrink and mute.
        const scoreSize = condensed ? 17 : 24;
        const nameSize = condensed ? 13 : 14;
        const logoPx = condensed ? 18 : 24;
        const colW = condensed ? 56 : 74;
        const capStyle = {
          fontSize: 10, color: "var(--muted)", textAlign: "center",
          letterSpacing: 0.4, textTransform: "uppercase",
        } as const;

        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0,1fr) ${colW}px ${colW}px`,
              rowGap: condensed ? 3 : 6, columnGap: 8, alignItems: "center",
            }}
          >
            <div />
            <div style={capStyle}>Proj</div>
            <div style={capStyle}>
              {card.scoreSource === "LIVE" ? "Now" : "Final"}
            </div>

            {/* Team B (top) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {bLogo ? (
                <img src={bLogo} alt="" width={logoPx} height={logoPx} style={{ objectFit: "contain" }} loading="lazy" />
              ) : (
                <div style={{ width: logoPx, height: logoPx, borderRadius: 6, background: bColors?.primary ?? "var(--accent)" }} />
              )}
              <div style={{ fontWeight: 600, fontSize: nameSize, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {card.teamB}
              </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: scoreSize, lineHeight: 1, textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
              {projB}
            </div>
            <div style={{ fontWeight: 700, fontSize: scoreSize, lineHeight: 1, textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
              {hasFinalB ? card.finalB : "\u2013"}
            </div>

            {/* Team A (bottom) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {aLogo ? (
                <img src={aLogo} alt="" width={logoPx} height={logoPx} style={{ objectFit: "contain" }} loading="lazy" />
              ) : (
                <div style={{ width: logoPx, height: logoPx, borderRadius: 6, background: aColors?.primary ?? "var(--brand)" }} />
              )}
              <div style={{ fontWeight: 600, fontSize: nameSize, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {card.teamA}
              </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: scoreSize, lineHeight: 1, textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
              {projA}
            </div>
            <div style={{ fontWeight: 700, fontSize: scoreSize, lineHeight: 1, textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
              {hasFinalA ? card.finalA : "\u2013"}
            </div>
          </div>
        );
      })()}

      <WinProbBar card={card} aColor={aColors?.primary} bColor={bColors?.primary} condensed={condensed} />


      {jsonRow ? (
        <MarketEdge
          row={jsonRow}
          season={season}
          teamA={card.teamA}
          teamB={card.teamB}
          bookSpread={card.oddsSpread}
          bookTotal={card.oddsTotal}
          simMargin={useMean ? card.simMeanMargin : card.simMedMargin}
          simTotal={useMean ? card.simMeanTotal : card.simMedTotal}
          pHome={card.pHome}
          kalshi={kalshi}
        />
      ) : (
        <SimVsKalshi card={card} kalshi={kalshi} useMean={useMean} />
      )}

      {/* action buttons */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:4 }}>
        {canShowScores && tabBtn("scores", "Simulated Scores")}
        {csvCard && tabBtn("players", "Player Stats", true)}
        {jsonRow && tabBtn("props", "Player Props")}
        {jsonRow && tabBtn("box", "Box Score", true)}
      </div>
    </article>
  );
}

/* ============================== Win prob bar ================================
 * The headline number of a simulation was buried in a pill among three others.
 * A single split bar in team colours reads at a glance, and it replaces the ML
 * pill entirely (the fair price still shows in the Sim/Kalshi block).
 * ========================================================================= */
export function WinProbBar({ card, aColor, bColor, condensed = false }: {
  card: CardGame; aColor?: string; bColor?: string; condensed?: boolean;
}) {
  // pHome is the sim's own P(home). Fall back to the ML pick when a CSV-season
  // card has no pHome but does carry a moneyline probability.
  let pA = card.pHome;
  if (typeof pA !== "number" && typeof card.mlPickProb === "number" && card.mlPickTeam) {
    pA = card.mlPickTeam === card.teamA ? card.mlPickProb : 1 - card.mlPickProb;
  }
  if (typeof pA !== "number" || !(pA >= 0 && pA <= 1)) return null;

  const pctA = Math.round(pA * 100);
  const home = aColor ?? "var(--brand)";
  const away = bColor ?? "var(--accent)";
  const h = condensed ? 6 : 8;

  return (
    <div style={{ display: "grid", gap: 3 }}>
      <div
        style={{ display: "flex", height: h, borderRadius: 999, overflow: "hidden", background: "var(--fill)" }}
        role="img"
        aria-label={`${card.teamA} ${pctA}% to win, ${card.teamB} ${100 - pctA}%`}
      >
        <div style={{ width: `${100 - pctA}%`, background: away }} />
        <div style={{ width: `${pctA}%`, background: home }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        <span>{100 - pctA}%</span>
        <span style={{ letterSpacing: 0.3 }}>WIN PROB</span>
        <span>{pctA}%</span>
      </div>
    </div>
  );
}

/* ============================ Sim vs Kalshi block ===========================
 * An aligned two-source comparison instead of a run-on sentence: one label
 * column, one column per source, one delta. Naming the sources once in a
 * header is what lets the numbers sit in real columns, which is the only way
 * two values are comparable at a glance.
 *
 * Delta is KALSHI MINUS SIM (how far the market sits from our number).
 * Deliberately neutral coloring — which direction counts as "good" is a
 * betting decision the product has not made yet.
 * ========================================================================= */
export function SimVsKalshi({ card, kalshi, useMean }: {
  card: CardGame; kalshi?: KalshiGame; useMean: boolean;
}) {
  if (!kalshi) return null;

  const winMkt = kalshi.winner.teamA_price;
  const totLine = kalshi.total.line;
  const totOver = kalshi.total.yes_price;
  const sprLine = kalshi.spread.line;
  if (winMkt == null && totLine == null && sprLine == null) return null;

  // Use the sim's OWN total/margin. Summing the per-team medians would print
  // 41 where the sim's median total is 43 (median of a sum != sum of medians),
  // which would then feed a wrong delta against the market line.
  const simA = useMean ? card.meanA : card.medA;
  const simB = useMean ? card.meanB : card.medB;
  const rawTotal = useMean ? card.simMeanTotal : card.simMedTotal;
  const rawMargin = useMean ? card.simMeanMargin : card.simMedMargin;
  const simTotal = Number.isFinite(rawTotal) ? (rawTotal as number) : simA + simB;
  // Market spreads are home-perspective (negative = home favored), so the
  // sim's equivalent spread is the negated projected margin.
  const simSpread = -(Number.isFinite(rawMargin) ? (rawMargin as number) : simA - simB);

  const num = (v: number, d = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(d));
  const signed = (v: number, d = 1) => `${v > 0 ? "+" : ""}${num(v, d)}`;

  const rows: { label: string; sim: string; mkt: string; delta: string | null }[] = [];

  if (winMkt != null && typeof card.pHome === "number") {
    rows.push({
      label: `Win \u00b7 ${card.teamA}`,
      sim: `${(card.pHome * 100).toFixed(0)}%`,
      mkt: `${(winMkt * 100).toFixed(0)}%`,
      delta: `${signed((winMkt - card.pHome) * 100, 0)}%`,
    });
  }
  if (totLine != null) {
    rows.push({
      label: "Total",
      sim: num(simTotal),
      mkt: totOver != null ? `${num(totLine)} \u00b7 o${(totOver * 100).toFixed(0)}%` : num(totLine),
      delta: signed(totLine - simTotal),
    });
  }
  if (sprLine != null) {
    rows.push({
      label: "Spread",
      sim: signed(simSpread),
      mkt: signed(sprLine),
      delta: signed(sprLine - simSpread),
    });
  }
  if (!rows.length) return null;

  const cols = "minmax(0,1fr) 44px 82px 46px";
  const cell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
  const headCell = { ...cell, fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 } as const;

  return (
    <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: "3px 6px", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: "var(--muted)", textTransform: "uppercase" }}>
          Market
        </div>
        <div style={headCell}>Sim</div>
        <div style={headCell}>Kalshi</div>
        <div style={{ ...cell, fontSize: 10, color: "var(--muted)" }} title="Kalshi minus Sim">&Delta;</div>

        {rows.map((r) => (
          <Fragment key={r.label}>
            <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.label}
            </div>
            <div style={{ ...cell, fontSize: 13, fontWeight: 700 }}>{r.sim}</div>
            <div style={{ ...cell, fontSize: 13, fontWeight: 700 }}>{r.mkt}</div>
            <div style={cell}>
              {r.delta && (
                <span
                  style={{
                    display: "inline-block", padding: "1px 5px", borderRadius: 6,
                    fontSize: 11, fontVariantNumeric: "tabular-nums",
                    background: "var(--fill)",
                    color: "var(--muted)",
                  }}
                >
                  {r.delta}
                </span>
              )}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ========================= Break-out panel host =============================
 * Panels used to render inside their card, which inflated that card and
 * stretched every neighbor in its grid row. They now render here, as a
 * separate full-width grid item placed after the expanded card's ROW, so card
 * geometry is completely independent of what is open.
 * ========================================================================= */
function CardPanelHost({
  card, kind, gdata, week, season, weekId, useMean, onAddLeg, onClose,
}: {
  card: CardGame;
  kind: PanelKind;
  gdata?: GameData;
  week: string;
  season: Season;
  weekId: string;
  useMean: boolean;
  onAddLeg: (leg: Leg) => void;
  onClose: () => void;
}) {
  const jsonRow = card.jsonRow;
  const title =
    kind === "scores" ? "Simulated Scores"
    : kind === "players" ? "Simulated Player Stats"
    : kind === "props" ? "Player Props"
    : kind === "box" ? "Projected Box Score"
    : "Add Parlay Leg";

  return (
    <section
      style={{
        border: "1px solid var(--brand)", borderRadius: 12,
        background: "var(--card)", padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--brand-text)" }}>
          {card.teamB} @ {card.teamA}
        </span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{title}</span>
        <button
          type="button" onClick={onClose} className="ui-btn"
          style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 12 }}
        >
          Close
        </button>
      </div>

      {kind === "scores" && <ScoresPanel card={card} gdata={gdata} season={season} />}
      {kind === "players" && <PlayersPanel card={card} week={week} season={season} />}
      {kind === "props" && jsonRow && (
        <PlayerProps
          row={jsonRow} season={season}
          teamA={card.teamA} teamB={card.teamB}
          colorFor={(t) => getTeamColors(t)?.primary}
        />
      )}
      {kind === "box" && jsonRow && (
        <BoxScore
          row={jsonRow} season={season}
          teamA={card.teamA} teamB={card.teamB}
          ptsA={useMean ? card.meanA : card.medA}
          ptsB={useMean ? card.meanB : card.medB}
          useMean={useMean}
          logoFor={getTeamLogo}
          colorFor={(t) => getTeamColors(t)?.primary}
        />
      )}
      {kind === "picker" && jsonRow && (
        <LegPicker
          row={jsonRow} season={season} weekId={weekId}
          teamA={card.teamA} teamB={card.teamB}
          marketSpread={card.oddsSpread} marketTotal={card.oddsTotal}
          onAdd={onAddLeg} onClose={onClose}
        />
      )}
    </section>
  );
}

/* ---------------------- Simulated score distribution ---------------------- */
function ScoresPanel({ card, gdata, season }: {
  card: CardGame; gdata?: GameData; season: Season;
}) {
  const jsonRow = card.jsonRow;
  const hasSeedRows = Boolean(gdata?.rowsA?.length);

  /* Per-seed points for JSON seasons, lazily via compact.json (~8KB). */
  const [compactData, setCompactData] = useState<GameData | null>(null);
  const [compactLoading, setCompactLoading] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);

  useEffect(() => {
    if (hasSeedRows || !jsonRow) return;
    if (compactData || compactLoading || compactError) return;

    const ac = new AbortController();
    let alive = true;
    setCompactLoading(true);
    (async () => {
      try {
        const c = await getCompactJson(jsonRow, season, ac.signal);
        const n = Math.min(c.A_pts.length, c.B_pts.length);
        if (!n) throw new Error("no per-seed points in compact.json");
        const rowsA: SimRow[] = [];
        for (let i = 0; i < n; i++) {
          rowsA.push({ team: card.teamA, opp: card.teamB, pts: c.A_pts[i], opp_pts: c.B_pts[i] });
        }
        if (alive) setCompactData({ teamA: card.teamA, teamB: card.teamB, rowsA });
      } catch (e: any) {
        if (e?.name === "AbortError" || !alive) return;
        console.warn("[Scoreboard] compact load failed:", e);
        setCompactError(String(e?.message ?? e));
      } finally {
        if (alive) setCompactLoading(false);
      }
    })();

    return () => { alive = false; ac.abort(); };
  }, [hasSeedRows, jsonRow, season, card.teamA, card.teamB]);

  const panelData = gdata ?? compactData ?? undefined;

  const aColors = getTeamColors(card.teamA);
  const bColors = getTeamColors(card.teamB);

  const [metric, setMetric] = useState<Metric>("spread");
  const [teamOrder, setTeamOrder] = useState<0|1>(0);
  const [bins, setBins] = useState<number|"auto">("auto");
  const [teamLine, setTeamLine] = useState<string>("");

  const series = useMemo(
    () => (panelData ? metricSeries(panelData, metric, teamOrder) : []),
    [panelData, metric, teamOrder]
  );
  const qScore = useMemo(()=> quantiles(series), [series]);
  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin[];
    const opts:any = {}; if (bins!=="auto") opts.bins = Math.max(1, Number(bins));
    return computeHistogram(series, opts);
  }, [series, bins]);
  const teamProb = useMemo(() => {
    if (!series.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(teamLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of series) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = series.length;
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [series, teamLine]);
  const lineBinLabel = useMemo(
    () => (teamProb && hist.length ? findBinLabelForValue(hist, teamProb.line) : undefined),
    [teamProb, hist]
  );
  const tickPlan = useMemo(() => buildTickPlan(hist, qScore), [hist, qScore]);

  const leftColor  = (teamOrder === 0 ? (aColors?.primary ?? "var(--brand)") : (bColors?.primary ?? "var(--brand)"));
  const rightColor = (teamOrder === 0 ? (bColors?.primary ?? "var(--accent)") : (aColors?.primary ?? "var(--accent)"));

  const binColors = useMemo(() => {
    if (!hist.length) return [] as string[];
    if (metric === "spread") {
      return hist.map(h => {
        const mid = (h.start + h.end) / 2;
        if (mid < 0) return leftColor;
        if (mid > 0) return rightColor;
        return "var(--border)";
      });
    }
    if (metric === "total") {
      const med = qScore?.med ?? 0;
      return hist.map(h => ((h.start + h.end) / 2) < med ? leftColor : rightColor);
    }
    if (metric === "teamLeft")  return hist.map(() => leftColor);
    if (metric === "teamRight") return hist.map(() => rightColor);
    return hist.map(() => "var(--brand)");
  }, [hist, metric, leftColor, rightColor, qScore?.med]);

  if (compactLoading) return <SkeletonChart height={220} />;
  if (compactError) {
    return (
      <div style={{ fontSize: 13, color: "var(--muted)", padding: 6 }}>
        Couldn\u2019t load the distribution: {compactError}
      </div>
    );
  }
  if (!panelData) {
    return <div style={{ fontSize: 13, color: "var(--muted)", padding: 6 }}>No simulated scores for this game.</div>;
  }

  return (
    <div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        {(["spread","total","teamLeft","teamRight"] as Metric[]).map(m => (
          <button key={m} className="ui-btn" data-on={metric===m ? "true" : "false"} onClick={()=>setMetric(m)}>
            {m==="spread"?"Spread":m==="total"?"Total":m==="teamLeft"?`${panelData.teamA} total`:`${panelData.teamB} total`}
          </button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <button className="ui-btn" onClick={()=>setTeamOrder(t=>t===0?1:0)}>
            {teamOrder===0 ? `${panelData.teamA} vs ${panelData.teamB}` : `${panelData.teamB} vs ${panelData.teamA}`}
          </button>
          <label style={{ fontSize:12, color:"var(--muted)" }}>Bins:</label>
          <select className="ui-sel" value={String(bins)} onChange={(e)=>setBins(e.target.value==="auto" ? "auto" : Number(e.target.value))}>
            <option value="auto">Auto</option><option value="20">20</option><option value="30">30</option><option value="40">40</option>
          </select>
          <label style={{ fontSize:12, color:"var(--muted)" }}>Line:</label>
          <NumberSpinner value={teamLine} onChange={setTeamLine} step={0.5} placeholder={metric==="spread" ? "-6.5" : "55.5"} />
        </div>
      </div>

      <div style={{ height: 220, marginTop: 6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
            <XAxis
              dataKey="bin" interval={0} height={22} tickLine={false} axisLine={false}
              tick={planTick(tickPlan)}
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
              {hist.map((_, i) => (<Cell key={i} fill={binColors[i]} />))}
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
  );
}

/* ------------- Legacy CSV-season player sims (per-seed CSV path) ----------- */
function PlayersPanel({ card, week, season }: {
  card: CardGame; week: string; season: Season;
}) {
  const [players, setPlayers] = useState<PlayerMap>({});
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState(false);

  useEffect(() => {
    if (!week) return;
    if (playersLoading || playersError || Object.keys(players).length) return;

    let alive = true;
    setPlayersLoading(true);
    (async () => {
      try {
        const item = await playerFileForPair(week, card.teamA, card.teamB, season);
        if (!item) { if (alive) setPlayersError(true); return; }
        const data = await parseCsvFromItemSafe<any>(item);
        if (alive) setPlayers(buildPlayerMap(data));
      } catch {
        if (alive) setPlayersError(true);
      } finally {
        if (alive) setPlayersLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [week, season, card.teamA, card.teamB]);

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

  const [playerLine, setPlayerLine] = useState<string>("");
  const pProb = useMemo(() => {
    if (!pValues.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(playerLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of pValues) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = pValues.length; return { under:u/n, at:a/n, over:o/n, line:L };
  }, [pValues, playerLine]);
  const pLbl = useMemo(()=> (pProb && pHist.length ? findBinLabelForValue(pHist, pProb.line) : undefined), [pProb, pHist]);
  const pTickPlan = useMemo(() => buildTickPlan(pHist, qPlayer), [pHist, qPlayer]);

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

  if (playersLoading) return <SkeletonChart height={220} />;
  if (playersError) {
    return <div style={{ fontSize: 13, color: "var(--muted)", padding: 6 }}>No player sims for this matchup.</div>;
  }

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:8 }}>
        <select value={pTeam} onChange={e=>setPTeam(e.target.value)}
          className="ui-sel">
          {[card.teamA, card.teamB].map(t=> <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={pRole} onChange={e=>setPRole(e.target.value as Role)}
          className="ui-sel">
          <option>QB</option><option>Rusher</option><option>Receiver</option>
        </select>
        <select value={pPlayer} onChange={e=>setPPlayer(e.target.value)}
          className="ui-sel">
          {teamPlayersByRole(pTeam, pRole).map(n=> <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={pStat} onChange={e=>setPStat(e.target.value)}
          className="ui-sel">
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
          <div style={{ height: 220, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pHist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                <XAxis
                  dataKey="bin" interval={0} height={22} tickLine={false} axisLine={false}
                  tick={planTick(pTickPlan)}
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
                <Bar dataKey="count" name={`${pPlayer} \u2022 ${pretty(pStat)}`}>
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
  );
}
