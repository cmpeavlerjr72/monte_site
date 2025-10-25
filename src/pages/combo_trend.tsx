// src/pages/combo_trend.tsx
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

/* ---------- Week games CSVs (need open/close, finals) ---------- */
const G_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/games*.csv",       { as: "raw", eager: true }),
  import.meta.glob("../data/**/week*_open*.csv",  { as: "raw", eager: true })
) as Record<string, string>;

const G_URL = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/games*.csv",       { as: "url", eager: true }),
  import.meta.glob("../data/**/week*_open*.csv",  { as: "url", eager: true })
) as Record<string, string>;

/* ---------- Team & conference dictionary ---------- */
const TEAM_INFO_RAW = import.meta.glob("../assets/team_info.csv", { as: "raw", eager: true }) as Record<string, string>;
const teamInfoCsvText = Object.values(TEAM_INFO_RAW)[0] || "";

/* ---------- Shared helpers ---------- */
type FileInfo = { path: string; week: string; file: string; raw?: string; url?: string };
const normPath = (s: string) => s.replace(/\\/g, "/");
const weekFromPath = (p: string) =>
  normPath(p).match(/\/(week[^/]+)\//i)?.[1].toLowerCase() ??
  normPath(p).match(/\/data\/([^/]+)\//i)?.[1].toLowerCase() ??
  (normPath(p).match(/\/(week[^/.]+)_/i)?.[1].toLowerCase() ?? "root");

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

/* ---------- Sims types & helpers ---------- */
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // normalized alphabetical
type GameMap = Record<string, GameData>;
const sortedKey = (a: string, b: string) => [a, b].sort((x, y) => x.localeCompare(y)).join("__");

function pick<T = any>(row: any, keys: string[]): T | undefined {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k] as T;
  return undefined;
}
function pickNum(row: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === "" || v == null) continue;
    const n = Number(String(v).trim().replace(/[^\d.+-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ---------- Kickoff parser ---------- */
function kickoffMsFrom(row: any) {
  const dtStr   = pick<string>(row, ["Datetime", "DateTime", "datetime", "start_time", "StartTime"]);
  if (dtStr && !Number.isNaN(Date.parse(dtStr))) return Date.parse(dtStr);
  const dateStr = pick<string>(row, ["Date", "date", "Game Date", "game_date"]);
  const timeStr = pick<string>(row, ["Time", "time", "Kick", "kick", "Kickoff", "kickoff"]);
  if (!dateStr) return undefined;
  const d = new Date(`${dateStr}${timeStr ? " " + timeStr : ""}`);
  const t = d.getTime();
  return Number.isNaN(t) ? undefined : t;
}

/* ---------- Cover probability from sims (spread) ---------- */
function coverProbFromSims(rowsA: SimRow[], side: "A" | "B", lineForThatSide: number): number {
  if (!rowsA.length) return 0;
  let covers = 0;
  for (const r of rowsA) {
    const marginA = r.pts - r.opp_pts;        // A − B
    const marginSide = side === "A" ? marginA : -marginA; // if we bet B, we flip
    if (marginSide + lineForThatSide > 0) covers++;
  }
  return covers / rowsA.length;
}

/* ---------- Team -> conference ---------- */
function buildTeamConfMap() {
  if (!teamInfoCsvText) return { teamToConf: {}, confs: [] as string[] };
  const parsed = Papa.parse<Record<string, any>>(teamInfoCsvText, {
    header: true, dynamicTyping: false, skipEmptyLines: true,
  });
  const t2c: Record<string, string> = {};
  const confSet = new Set<string>();
  const teamKeys = ["team", "Team", "school", "School", "name", "Name"];
  const confKeys = ["conference", "Conference", "conf", "Conf"];
  for (const r of parsed.data || []) {
    if (!r) continue;
    const team = pick<string>(r, teamKeys)?.trim();
    const conf = pick<string>(r, confKeys)?.trim();
    if (!team) continue;
    if (conf) {
      confSet.add(conf);
      t2c[team.toLowerCase()] = conf;
      t2c[team.replace(/\s+/g, "").toLowerCase()] = conf;
    }
    const alias = (r["short_name"] ?? r["Short Name"] ?? r["alias"] ?? r["Alias"])?.toString().trim();
    if (alias && conf) {
      t2c[alias.toLowerCase()] = conf;
      t2c[alias.replace(/\s+/g, "").toLowerCase()] = conf;
    }
  }
  return { teamToConf: t2c, confs: Array.from(confSet).sort((a, b) => a.localeCompare(b)) };
}
const { teamToConf, confs: CONF_LIST } = buildTeamConfMap();
const confOf = (team: string | undefined) => {
  if (!team) return undefined;
  const k1 = team.toLowerCase();
  const k2 = team.replace(/\s+/g, "").toLowerCase();
  return teamToConf[k1] ?? teamToConf[k2] ?? undefined;
};

/* ---------- Core row with CLV + Profit (spread picks) ---------- */
type CoreRow = {
  week: string; weekNum: number; kickoffMs?: number;
  teamA: string; teamB: string;
  confA?: string; confB?: string;

  // Opening/closing spreads in TeamA orientation
  openingSpreadA: number;
  closingSpreadA: number;

  // Chosen side at OPEN based on sims
  pickSide: "A" | "B";
  isFavoritePick: boolean;
  confidence: number;     // pBet at open (for banding)

  // CLV based on sims at open vs close
  clvProb: number;        // pBet - pClose

  // Results grading (vs OPENING line and chosen side)
  result?: "W" | "L" | "P";
  units?: number;         // +1 / -1.1 / 0
  stakeRisk?: number;     // 1.1 (standard), or 0 on push
};

function useCoreRows() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoreRow[]>([]);
  const [weeksAvailable, setWeeksAvailable] = useState<number[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    async function loadAll() {
      setLoading(true);
      try {
        // weeks detected from files
        const weekNames = Array.from(new Set([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week)));
        const weekNums = weekNames
          .map((w) => parseInt(String(w).replace(/[^0-9]/g, ""), 10))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        if (alive) setWeeksAvailable(weekNums);

        // sims by week
        const simsByWeek: Record<string, GameMap> = {};
        for (const w of weekNames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
          const sFiles = scoreFilesAll.filter((f) => f.week === w);
          const simArrays = await pAllLimit(sFiles, isSafari ? 2 : 4, async (item) => {
            const data = await parseCsvFromItemSafe<any>(item, ac.signal);
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
          simsByWeek[w] = gm;
        }

        // meta + CLV + grading
        const out: CoreRow[] = [];
        for (const w of Object.keys(simsByWeek)) {
          const gFiles = gamesFilesAll.filter((f) => f.week === w);
          const metaArrays = await pAllLimit(gFiles, isSafari ? 2 : 4, (item) => parseCsvFromItemSafe<any>(item, ac.signal));
          const gm = simsByWeek[w] || {};

          for (const arr of metaArrays) {
            for (const row of arr as any[]) {
              if (!row) continue;

              // prefer Team A/B else Home/Away
              const csvTeamA = pick<string>(row, ["Team A","team_a","teamA","A"]);
              const csvTeamB = pick<string>(row, ["Team B","team_b","teamB","B"]);
              const csvHome  = pick<string>(row, ["HomeTeam","Home","home","home_team"]);
              const csvAway  = pick<string>(row, ["AwayTeam","Away","away","away_team"]);

              let teamA = "";
              let teamB = "";
              let homeTeam = "";
              let awayTeam = "";

              if (csvTeamA && csvTeamB) {
                teamA = String(csvTeamA).trim();
                teamB = String(csvTeamB).trim();
                if (csvHome && String(csvHome).trim().toLowerCase() === teamA.toLowerCase()) {
                  homeTeam = teamA; awayTeam = teamB;
                } else if (csvAway && String(csvAway).trim().toLowerCase() === teamA.toLowerCase()) {
                  homeTeam = String(csvHome ?? ""); awayTeam = teamA;
                } else {
                  homeTeam = String(csvHome ?? "");
                  awayTeam = String(csvAway ?? "");
                }
              } else if (csvHome && csvAway) {
                teamA = String(csvHome).trim();
                teamB = String(csvAway).trim();
                homeTeam = teamA; awayTeam = teamB;
              } else {
                continue;
              }

              const key = sortedKey(teamA, teamB);
              const sim = gm[key];
              if (!sim) continue;

              let confA = pick<string>(row, ["Team A Conf","team_a_conf","confA","ConfA","A Conf","home_conf"]);
              let confB = pick<string>(row, ["Team B Conf","team_b_conf","confB","ConfB","B Conf","away_conf"]);
              if (!confA) confA = confOf(teamA);
              if (!confB) confB = confOf(teamB);

              const openHome = pickNum(row, ["OpeningSpread","opening_spread","Opening Spread","Open","Opener","OpenLine","Open_Line"]);
              const closeHome = pickNum(row, ["Spread","spread","ClosingSpread","Closing Spread","Line","Close","CloseLine","Close_Line"]);
              if (!Number.isFinite(openHome) || !Number.isFinite(closeHome)) continue;

              const rowsAlpha: SimRow[] = (sim.teamA === teamA)
                ? sim.rowsA
                : sim.rowsA.map(r => ({ team: teamA, opp: teamB, pts: r.opp_pts, opp_pts: r.pts }));

              const haveHomeAway = Boolean(csvHome && csvAway);
              let openingSpreadA: number;
              let closingSpreadA: number;
              if (haveHomeAway && homeTeam && awayTeam) {
                const teamAIsHome = teamA && homeTeam && (teamA.toLowerCase() === homeTeam.toLowerCase());
                openingSpreadA = teamAIsHome ? (openHome as number) : -(openHome as number);
                closingSpreadA = teamAIsHome ? (closeHome as number) : -(closeHome as number);
              } else {
                openingSpreadA = openHome as number;
                closingSpreadA = closeHome as number;
              }

              // choose side at OPEN (bet decision)
              const pA_open = coverProbFromSims(rowsAlpha, "A", openingSpreadA);
              const pB_open = coverProbFromSims(rowsAlpha, "B", -openingSpreadA);
              const pickSide: "A" | "B" = pA_open >= pB_open ? "A" : "B";
              const isFavoritePick = (openingSpreadA < 0 && pickSide === "A") || (openingSpreadA > 0 && pickSide === "B");

              // CLV (probability shift between open vs close for our chosen side)
              const betLine          = pickSide === "A" ? openingSpreadA : -openingSpreadA;
              const closeLineForPick = pickSide === "A" ? closingSpreadA : -closingSpreadA;
              const pBet   = coverProbFromSims(rowsAlpha, pickSide, betLine);
              const pClose = coverProbFromSims(rowsAlpha, pickSide, closeLineForPick);
              const clvProb = pBet - pClose;

              // Finals to grade
              const finalA = pickNum(row, [
                "Team A Score Actual","team_a_score_actual","TeamAScoreActual",
                "HomeScore","home_score","FinalHome","home_final","Home Final",
              ]);
              const finalB = pickNum(row, [
                "Team B Score Actual","team_b_score_actual","TeamBScoreActual",
                "AwayScore","away_score","FinalAway","away_final","Away Final",
              ]);

              let result: "W"|"L"|"P"|undefined;
              let units: number|undefined;
              let stakeRisk: number|undefined;
              if (Number.isFinite(finalA) && Number.isFinite(finalB)) {
                const fA = finalA as number, fB = finalB as number;
                // grade vs the opening bet line we chose
                const marginA = fA - fB;
                const marginSide = pickSide === "A" ? marginA : -marginA;
                const coverDiff = marginSide + betLine; // >0 win, ==0 push, <0 lose
                if (Math.abs(coverDiff) < 1e-9) {
                  result = "P"; units = 0; stakeRisk = 0;
                } else if (coverDiff > 0) {
                  result = "W"; units = 1; stakeRisk = 1.1;
                } else {
                  result = "L"; units = -1.1; stakeRisk = 1.1;
                }
              }

              const kickoffMs = kickoffMsFrom(row);

              out.push({
                week: w,
                weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                kickoffMs,
                teamA, teamB, confA, confB,
                openingSpreadA, closingSpreadA,
                pickSide, isFavoritePick,
                confidence: pBet,
                clvProb,
                result, units, stakeRisk,
              });
            }
          }
        }

        if (alive) setRows(out);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadAll();
    return () => { alive = false; ac.abort(); };
  }, []);

  return { loading, rows, weeksAvailable };
}

/* ---------- Trend slicing (spread only) ---------- */
type PickType = "favorite" | "underdog" | "all";
type GameType = "conference" | "nonconference";

type TrendSlice = {
  confBand: [number, number] | "all";     // confidence % band
  gameType: GameType;
  conference: string | "all";
  pickType: PickType;
};

function rowsForSlice(rows: CoreRow[], s: TrendSlice): CoreRow[] {
  return rows.filter((r) => {
    // confidence band
    if (s.confBand !== "all") {
      const pc = r.confidence * 100;
      if (pc < s.confBand[0] || pc >= s.confBand[1]) return false;
    }

    // pick type
    if (s.pickType !== "all") {
      const isFav = r.isFavoritePick;
      if (s.pickType === "favorite" && !isFav) return false;
      if (s.pickType === "underdog" && isFav) return false;
    }

    const a = (r.confA ?? confOf(r.teamA))?.toLowerCase();
    const b = (r.confB ?? confOf(r.teamB))?.toLowerCase();
    if (!a || !b) return false;

    if (s.conference !== "all") {
      const cf = s.conference.toLowerCase();
      const sameConf = a === b;
      if (s.gameType === "conference") {
        return sameConf && a === cf && b === cf;
      } else {
        return !sameConf && (a === cf || b === cf);
      }
    } else {
      const sameConf = a === b;
      return s.gameType === "conference" ? sameConf : !sameConf;
    }
  });
}

function matchesForWeek(rows: CoreRow[], slice: TrendSlice, weekNum: number): CoreRow[] {
  return rowsForSlice(rows, slice).filter(r => r.weekNum === weekNum);
}

/* ---------- Metrics ---------- */
type ClvMetrics = {
  nBets: number;
  nWeeks: number;
  avgClvPct: number;          // mean(clvProb)*100
  medClvPct: number;
  posPct: number;             // % of bets with clvProb > 0
  timeline: { idx: number; cumAvgClvPct: number }[];
};

type ProfitMetrics = {
  graded: number;             // bets with results
  wins: number;
  losses: number;
  pushes: number;
  profitUnits: number;        // sum units
  riskUnits: number;          // sum stakeRisk
  roiPerBetPct: number;       // profit / nBets * 100
  rorPct: number;             // profit / risk * 100
  negClvCount: number;
  negClvWinPct: number;       // among graded neg-CLV
  posClvCount: number;
  posClvWinPct: number;       // among graded pos-CLV
};

type TrendMetrics = ClvMetrics & ProfitMetrics;

function percentileMedian(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function computeClvMetrics(rows: CoreRow[]): ClvMetrics {
  const nBets = rows.length;
  // weeks
  const byWeek = new Map<number, CoreRow[]>();
  for (const r of rows) {
    if (!byWeek.has(r.weekNum)) byWeek.set(r.weekNum, []);
    byWeek.get(r.weekNum)!.push(r);
  }
  const nWeeks = byWeek.size;

  const clv = rows.map(r => r.clvProb * 100);
  const avgClvPct = clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : 0;
  const medClvPct = clv.length ? percentileMedian(clv) : 0;
  const posPct = rows.length ? rows.filter(r => r.clvProb > 0).length / rows.length : 0;

  // timeline cumulative avg CLV%
  const dated = [...rows].sort((a, b) => {
    const ax = a.kickoffMs ?? Number.POSITIVE_INFINITY;
    const bx = b.kickoffMs ?? Number.POSITIVE_INFINITY;
    if (ax !== bx) return ax - bx;
    if (a.weekNum !== b.weekNum) return a.weekNum - b.weekNum;
    return (a.teamA + a.teamB).localeCompare(b.teamA + b.teamB);
  });
  const timeline: { idx: number; cumAvgClvPct: number }[] = [];
  let running = 0;
  for (let i = 0; i < dated.length; i++) {
    running += dated[i].clvProb * 100;
    timeline.push({ idx: i + 1, cumAvgClvPct: running / (i + 1) });
  }

  return { nBets, nWeeks, avgClvPct, medClvPct, posPct, timeline };
}

function computeProfitMetrics(rows: CoreRow[]): ProfitMetrics {
  const graded = rows.filter(r => r.result != null) as Required<Pick<CoreRow,"result"|"units"|"stakeRisk"> & CoreRow>[];
  const wins   = graded.filter(r => r.result === "W").length;
  const losses = graded.filter(r => r.result === "L").length;
  const pushes = graded.filter(r => r.result === "P").length;

  const profitUnits = graded.reduce((s, r) => s + (r.units ?? 0), 0);
  const riskUnits   = graded.reduce((s, r) => s + (r.stakeRisk ?? 0), 0);
  const roiPerBetPct = rows.length ? (profitUnits / rows.length) * 100 : 0;
  const rorPct = riskUnits ? (profitUnits / riskUnits) * 100 : 0;

  const neg = graded.filter(r => r.clvProb < 0);
  const pos = graded.filter(r => r.clvProb >= 0);
  const negClvCount = neg.length;
  const posClvCount = pos.length;
  const negClvWinPct = negClvCount ? (neg.filter(r => r.result === "W").length / negClvCount) : 0;
  const posClvWinPct = posClvCount ? (pos.filter(r => r.result === "W").length / posClvCount) : 0;

  return { graded: graded.length, wins, losses, pushes, profitUnits, riskUnits, roiPerBetPct, rorPct, negClvCount, negClvWinPct, posClvCount, posClvWinPct };
}

function computeTrendMetrics(rows: CoreRow[]): TrendMetrics {
  const c = computeClvMetrics(rows);
  const p = computeProfitMetrics(rows);
  return { ...c, ...p };
}

/* ---------- Candidate slices ---------- */
function buildCandidateSlices(confs: string[]): TrendSlice[] {
  const confBands: Array<[number, number] | "all"> = [
    "all", [53, 60], [60, 65], [65, 70], [70, 75], [75, 80], [80, 90], [90, 101],
  ];
  const gameTypes: GameType[] = ["conference", "nonconference"];
  const pickTypes: PickType[] = ["favorite", "underdog", "all"];
  const conferences: (string | "all")[] = ["all", ...confs];

  const out: TrendSlice[] = [];
  for (const pt of pickTypes) {
    for (const band of confBands) {
      for (const gt of gameTypes) {
        for (const cf of conferences) {
          out.push({ pickType: pt, confBand: band, gameType: gt, conference: cf });
        }
      }
    }
  }
  return out;
}

/* ---------- Guardrails & scoring ---------- */
function passesGuardrails(m: TrendMetrics) {
  const minBets = 10;      // require enough bets in slice
  const minWeeks = 2;      // spread across weeks
  const minGraded = 6;     // require some finals for ROI signals
  return m.nBets >= minBets && m.nWeeks >= minWeeks && m.graded >= minGraded;
}

// Hybrid score: CLV quality + realized ROI + bonus for “market wrong” (neg-CLV wins)
function trueEdgeScore(m: TrendMetrics) {
  // Small-sample shrink
  const k = 60; // similar to your prior scoring
  const sizeMult = Math.sqrt(m.nBets / (m.nBets + k));

  const clvComponent   = m.avgClvPct * 0.5;                 // keep CLV meaningful
  const roiComponent   = m.roiPerBetPct * 1.0;              // ROI per bet (units per bet *100)
  const negEdgeBonus   = (m.negClvWinPct - 0.5) * 80;       // reward slices that win >50% when CLV < 0
  const posSanityCheck = (m.posClvWinPct - 0.5) * 20;       // small reward for also winning when CLV > 0

  const raw = clvComponent + roiComponent + negEdgeBonus + posSanityCheck;
  return raw * sizeMult;
}

function clvOnlyScore(m: TrendMetrics) {
  const k = 60;
  const sizeMult = Math.sqrt(m.nBets / (m.nBets + k));
  const posBoost = (m.posClvWinPct - 0.5) * 20;
  return (m.avgClvPct + posBoost) * sizeMult;
}

function roiScore(m: TrendMetrics) {
  const k = 60;
  const sizeMult = Math.sqrt(m.nBets / (m.nBets + k));
  return m.roiPerBetPct * sizeMult;
}

/* ---------- UI bits ---------- */
const fmt2 = (n: number) => Number(n).toFixed(2);
const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`;

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

/* ---------- Page ---------- */
type TrendScored = {
  id: string;
  label: string;
  slice: TrendSlice;
  metrics: TrendMetrics;
  score: number;
};

type SortMode = "trueEdge" | "clv" | "roi";

function sliceLabel(s: TrendSlice) {
  const confPart =
    s.confBand === "all"
      ? "All confidence ratings"
      : `${s.confBand[0]}–${s.confBand[1]}% conf`;

  const confChip = s.conference === "all" ? "All conferences" : s.conference;

  return [
    "spread",
    s.pickType !== "all" ? s.pickType : "all picks",
    confPart,
    s.gameType === "conference" ? "Conference" : "Non-Conf",
    confChip,
  ].join(" • ");
}

export default function ComboTrend() {
  const { loading, rows, weeksAvailable } = useCoreRows();
  const [confView, setConfView] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("trueEdge");

  const candidateSlices = useMemo(() => buildCandidateSlices(CONF_LIST), []);
  const scored: TrendScored[] = useMemo(() => {
    if (!rows.length) return [];

    const proto = candidateSlices.map((s) => {
      const r = rowsForSlice(rows, s);
      const metrics = computeTrendMetrics(r);
      return { s, metrics };
    });

    const kept = proto.filter((p) => passesGuardrails(p.metrics));

    const withScores = kept.map((k) => {
      let score = 0;
      if (sortMode === "trueEdge") score = trueEdgeScore(k.metrics);
      else if (sortMode === "clv") score = clvOnlyScore(k.metrics);
      else score = roiScore(k.metrics);
      return {
        id: JSON.stringify(k.s),
        label: sliceLabel(k.s),
        slice: k.s,
        metrics: k.metrics,
        score,
      };
    });

    // rank by selected score
    const ranked = withScores.sort((a, b) => b.score - a.score);

    // de-dup similar identifiers
    const seen = new Set<string>();
    const unique: TrendScored[] = [];
    for (const t of ranked) {
      const key = [
        t.slice.pickType,
        t.slice.confBand === "all" ? "all" : t.slice.confBand.join(","),
        t.slice.gameType,
        t.slice.conference,
      ].join("|");
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(t);
      }
      if (unique.length >= 50) break;
    }
    return unique;
  }, [rows, candidateSlices, sortMode]);

  const rankedAll = scored;
  const rankedConferenceAll = rankedAll.filter(t => t.slice.gameType === "conference");
  const rankedNonConfAll    = rankedAll.filter(t => t.slice.gameType === "nonconference");
  const rankedConferenceFocused = confView === "all"
    ? rankedConferenceAll
    : rankedConferenceAll.filter(t => t.slice.conference.toLowerCase() === confView.toLowerCase());

  const topFiveOverall = rankedAll.slice(0, 5);
  const topFiveConference = rankedConferenceFocused.slice(0, 5);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      {/* Header */}
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28 }}>True Edges (CLV + Profit • Spread)</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Sort by:</label>
            <select
              value={sortMode}
              onChange={(e)=>setSortMode(e.target.value as SortMode)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontWeight: 600 }}
            >
              <option value="trueEdge">True Edge Score (CLV + ROI + Neg-CLV Wins)</option>
              <option value="clv">Avg CLV% (market efficiency)</option>
              <option value="roi">ROI per bet % (units / bet)</option>
            </select>
          </div>
        </div>
        {loading && <div style={{ marginTop: 8, opacity: 0.8 }}>Crunching sims, CLV, and results…</div>}
        {!loading && !rows.length && (
          <div style={{ marginTop: 8, padding: 10, background: "var(--mutedBg, #f6f7f9)", borderRadius: 10 }}>
            No data found. Ensure spread columns (<code>OpeningSpread</code>/<code>Spread</code>) and final scores exist in your week CSVs.
          </div>
        )}
      </section>

      {/* Overall Top */}
      <h2 style={{ marginTop: 8, marginBottom: 8, fontWeight: 800, fontSize: 18 }}>Top Trends (by selected score)</h2>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        {topFiveOverall.map((t, i) => (
          <TrendCard
            key={t.id}
            trend={t}
            rank={i + 1}
            allRows={rows}
            allWeeks={weeksAvailable}
          />
        ))}
      </div>

      {/* Conference section */}
      <h2 style={{ marginTop: 18, marginBottom: 8, fontWeight: 800, fontSize: 18 }}>
        Top Conference Trends
      </h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Focus</label>
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
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        {topFiveConference.length ? (
          topFiveConference.map((t, i) => (
            <TrendCard
              key={t.id}
              trend={t}
              rank={i + 1}
              allRows={rows}
              allWeeks={weeksAvailable}
            />
          ))
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            No conference slices passed the guardrails. Try another conference or widen confidence bands.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Card ---------- */
function TrendCard({
  trend, rank, allRows, allWeeks,
}: { trend: TrendScored; rank: number; allRows: CoreRow[]; allWeeks: number[] }) {
  const m = trend.metrics;
  const [open, setOpen] = useState(false);
  const [weekSel, setWeekSel] = useState<number | null>(null);
  const weekMatches = useMemo(
    () => (weekSel == null ? [] : matchesForWeek(allRows, trend.slice, weekSel)),
    [allRows, trend.slice, weekSel]
  );

  const bandChip =
    trend.slice.confBand === "all"
      ? "Any Conf"
      : `${trend.slice.confBand[0]}–${trend.slice.confBand[1]}% conf`;
  const typeChip = trend.slice.gameType === "conference" ? "Conference" : "Non-Conf";
  const confChip = trend.slice.conference;

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
            spread • {trend.slice.pickType !== "all" ? `${trend.slice.pickType} • ` : ""}{trend.slice.conference}
          </div>
          <span style={{ marginLeft: 6, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .12s" }}>▸</span>
        </button>

        <div style={{ textAlign: "right" }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>True Edge Score</div>
          <div style={{ fontWeight: 900, fontSize: 20 }}>{fmt2(trend.score)}</div>
        </div>
      </div>

      {/* Pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <Pill>{bandChip}</Pill>
        <Pill>{typeChip}</Pill>
        <Pill>{confChip}</Pill>
      </div>

      {/* Sparklines */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        {/* CLV cumulative avg */}
        <div style={{ height: 120, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={m.timeline.map((d) => ({ x: d.idx, y: d.cumAvgClvPct }))}
              margin={{ top: 8, right: 12, left: 12, bottom: 8 }}
            >
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.35} />
              <XAxis dataKey="x" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "Cum Avg CLV"]}
                labelFormatter={(l) => `Pick #${l}`}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }}
              />
              <Line type="monotone" dataKey="y" dot={false} stroke="var(--accent)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Profit (cumulative units over graded bets only) */}
        <div style={{ height: 120, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={buildProfitSeriesForSlice(allRows, trend.slice)}
              margin={{ top: 8, right: 12, left: 12, bottom: 8 }}
            >
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.35} />
              <XAxis dataKey="x" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                formatter={(v: any) => [`${Number(v).toFixed(2)}u`, "Cum Units"]}
                labelFormatter={(l) => `Bet #${l}`}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }}
              />
              <Line type="monotone" dataKey="y" dot={false} stroke="var(--accent)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
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
        <Row label="Avg CLV%" value={`${fmt2(m.avgClvPct)}%`} />
        <Row label="Median CLV%" value={`${fmt2(m.medClvPct)}%`} />
        <Row label="% Positive CLV (count)" value={`${pct1(m.posPct)} (${Math.round(m.nBets * m.posPct)})`} />
        <Row label="Graded" value={`${m.graded} (W:${m.wins} L:${m.losses} P:${m.pushes})`} />
        <Row label="Profit (u)" value={`${fmt2(m.profitUnits)}u`} />
        <Row label="ROI / bet" value={`${fmt2(m.roiPerBetPct)}%`} />
        <Row label="RoR" value={`${fmt2(m.rorPct)}%`} />
        <Row label="Neg-CLV Win%" value={`${fmt2(m.negClvWinPct*100)}% (${m.negClvCount})`} />
        <Row label="Pos-CLV Win%" value={`${fmt2(m.posClvWinPct*100)}% (${m.posClvCount})`} />
        <div />
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

          {weekSel != null && (
            weekMatches.length ? (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <div style={{ color: "var(--muted)" }}>
                  Showing {weekMatches.length} bet{weekMatches.length === 1 ? "" : "s"} • Avg CLV% ={" "}
                  {fmt2(weekMatches.reduce((a,b) => a + b.clvProb * 100, 0) / weekMatches.length)}% •
                  Profit = {fmt2(weekMatches.reduce((s,r)=>s+(r.units??0),0))}u
                </div>
                <ul style={{ marginTop: 6, paddingLeft: 16 }}>
                  {weekMatches.map((r, idx)=>(
                    <li key={idx} style={{ lineHeight: 1.4 }}>
                      <strong>{r.teamA}</strong> vs <strong>{r.teamB}</strong>{" "}
                      • Pick: {r.pickSide==="A"?r.teamA:r.teamB} {r.pickSide==="A"?r.openingSpreadA: -r.openingSpreadA > 0 ? `+${-(r.openingSpreadA)}` : `${-(r.openingSpreadA)}`}
                      {" "}• CLVΔ: {fmt2(r.clvProb*100)}%
                      {r.result && <> • Result: {r.result} ({r.units! >=0?"+":""}{fmt2(r.units!)}u)</>}
                    </li>
                  ))}
                </ul>
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

function buildProfitSeriesForSlice(allRows: CoreRow[], slice: TrendSlice) {
  const r = rowsForSlice(allRows, slice)
    .filter(x => x.result && x.result !== "P") // graded only (exclude pushes)
    .sort((a, b) => {
      const ax = a.kickoffMs ?? Number.POSITIVE_INFINITY;
      const bx = b.kickoffMs ?? Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      if (a.weekNum !== b.weekNum) return a.weekNum - b.weekNum;
      return (a.teamA + a.teamB).localeCompare(b.teamA + b.teamB);
    });

  const series: { x: number; y: number }[] = [];
  let running = 0;
  for (let i = 0; i < r.length; i++) {
    running += (r[i].units ?? 0);
    series.push({ x: i + 1, y: Number(running.toFixed(2)) });
  }
  return series;
}
