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

/* ---------- Shared helpers ---------- */
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

/* ---------- Local Safari-safe CSV parse + concurrency limiter ---------- */
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
      download: false,    // parsing a string
      worker: !isSafari,  // avoid iOS worker crashes
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

/* ---------- Robust kickoff parser ---------- */
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

/* ---------- EV helpers ---------- */
const SPREAD_TOTAL_POS_EV_THRESHOLD = 0.525; // 52.5% at -110

function impliedProbFromAmerican(odds: number): number {
  // e.g., -150 => 150/(150+100) = 0.6 ; +140 => 100/(140+100) = 0.4167
  if (odds < 0) { const a = Math.abs(odds); return a / (a + 100); }
  const b = Math.abs(odds);
  return 100 / (b + 100);
}

/* ---------- Page ---------- */
type PickRow = {
  week: string; weekNum: number;
  kickoffMs?: number;
  key: string;
  market: "spread" | "total" | "ml";
  pickText: string;                // "Team A +3.5" / "Over 51.5" / "Team A ML -150"
  result: "W" | "L" | "P";
  units: number;                   // graded units (+/-)
  confidence?: number;             // 0..1 probability of our picked side
  // helpers for filtering + summary
  isOverPick?: boolean;
  isUnderPick?: boolean;
  isFavoritePick?: boolean;        // for spread OR ML
  isUnderdogPick?: boolean;        // for spread OR ML
  isPositiveEV?: boolean;          // computed per bet
  stakeRisk?: number;              // units risked for this graded bet
};

type MarketFilter = "all" | "spread" | "total" | "ml";
type PickFilter = "all" | "over" | "under" | "favorite" | "underdog";
type EVFilter = "all" | "positive";

export default function Results() {
  const weeks = useMemo(() => {
    const s = new Set<string>([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PickRow[]>([]);

  // Filters
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [pickFilter, setPickFilter] = useState<PickFilter>("all");
  const [evFilter, setEvFilter] = useState<EVFilter>("all");
  const [confMin, setConfMin] = useState<number>(0);    // percent
  const [confMax, setConfMax] = useState<number>(100);  // percent

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    async function loadAll() {
      setLoading(true);
      try {
        // 1) Load all sims into a map by week -> GameMap
        const simsByWeek: Record<string, GameMap> = {};
        for (const w of weeks) {
          const sFiles = scoreFilesAll.filter((f) => f.week === w);
          const simArrays = await pAllLimit(sFiles, isSafari ? 2 : 4, async (item) => {
            const data = await parseCsvFromItemSafe<any>(item, ac.signal);
            return (data as any[])
              .filter((r) => r && r.team != null && r.opp != null && r.pts != null && r.opp_pts != null)
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
              (gm[pair] ||= { teamA: A, teamB: B, rowsA: [] }).rowsA.push(...normalized);
            }
          }
          simsByWeek[w] = gm;
        }

        // 2) Load all game meta (lines + date/time + actual scores + ML) and grade
        const allRows: PickRow[] = [];
        for (const w of weeks) {
          const gFiles = gamesFilesAll.filter((f) => f.week === w);
          const metaArrays = await pAllLimit(gFiles, isSafari ? 2 : 4, (item) =>
            parseCsvFromItemSafe<any>(item, ac.signal)
          );

          const gm = simsByWeek[w] || {};
          for (const arr of metaArrays) {
            for (const row of arr as any[]) {
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
              if (!sim) continue; // no sims -> skip

              // Sims medians in alphabetical orientation (used for spread/total baseline)
              const medA_alpha = median(sim.rowsA.map((r) => r.pts));
              const medB_alpha = median(sim.rowsA.map((r) => r.opp_pts));

              // Align to file's Team A orientation for spread/total
              let simsA = medA_alpha;
              let simsB = medB_alpha;
              const bookAisSimsA = (sim.teamA === teamA_meta);
              if (!bookAisSimsA) { simsA = medB_alpha; simsB = medA_alpha; }

              const spread = pickNum(row, ["Spread", "spread", "Line", "line"]);
              const total  = pickNum(row, ["OU", "O/U", "Total", "total"]);
              const finalA = pickNum(row, ["Team A Score Actual", "team_a_score_actual", "TeamAScoreActual"]);
              const finalB = pickNum(row, ["Team B Score Actual", "team_b_score_actual", "TeamBScoreActual"]);
              const kickoffMs = kickoffMsFrom(row);

              // ML odds
              const mlA = pickNum(row, ["TeamAML","team_a_ml","TeamA_ML","teamAML"]);
              const mlB = pickNum(row, ["TeamBML","team_b_ml","TeamB_ML","teamBML"]);

              const hasFinals = Number.isFinite(finalA) && Number.isFinite(finalB);

              /* ---------- Spread: pick + confidence + EV + grade ---------- */
              if (Number.isFinite(spread)) {
                const s = spread as number;

                // P(Team A covers) in book orientation
                const AvalsBook = bookAisSimsA
                  ? sim.rowsA.map(r => r.pts)
                  : sim.rowsA.map(r => r.opp_pts);
                const BvalsBook = bookAisSimsA
                  ? sim.rowsA.map(r => r.opp_pts)
                  : sim.rowsA.map(r => r.pts);
                let coverA = 0;
                const nPairs = Math.min(AvalsBook.length, BvalsBook.length);
                for (let i = 0; i < nPairs; i++) if ((AvalsBook[i] + s) > BvalsBook[i]) coverA++;
                const pA = nPairs ? coverA / nPairs : undefined;

                const diff = (simsA + s) - simsB;
                const pickSpread = diff > 0
                  ? `${teamA_meta} ${s > 0 ? `+${s}` : `${s}`}`
                  : `${teamB_meta} ${(-s) > 0 ? `+${-s}` : `${-s}`}`;

                const confidence = typeof pA === "number" ? (diff > 0 ? pA : 1 - pA) : undefined;

                // favorite / dog (for filtering)
                const favoriteSide: "A" | "B" | null = s < 0 ? "A" : s > 0 ? "B" : null;
                const pickedSide: "A" | "B" = diff > 0 ? "A" : "B";
                const isFavoritePick = favoriteSide ? (pickedSide === favoriteSide) : false;
                const isUnderdogPick = favoriteSide ? (pickedSide !== favoriteSide) : false;

                // Positive EV at -110 threshold
                const isPositiveEV = typeof confidence === "number" && confidence > SPREAD_TOTAL_POS_EV_THRESHOLD;

                if (hasFinals) {
                  const fA = finalA as number;
                  const fB = finalB as number;
                  const coverDiff = (fA + s) - fB;

                  let result: "W" | "L" | "P";
                  if (Math.abs(coverDiff) < 1e-9) result = "P";
                  else if (coverDiff > 0) result = pickSpread.startsWith(teamA_meta) ? "W" : "L";
                  else result = pickSpread.startsWith(teamB_meta) ? "W" : "L";

                  const units = result === "W" ? 1 : result === "L" ? -1.1 : 0;
                  const stakeRisk = result === "P" ? 0 : 1.1;

                  allRows.push({
                    week: w, weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                    kickoffMs, key: `${key}__spread`,
                    market: "spread",
                    pickText: pickSpread,
                    result, units, stakeRisk,
                    confidence,
                    isFavoritePick,
                    isUnderdogPick,
                    isPositiveEV,
                  });
                }
              }

              /* ---------- Total: pick + confidence + EV + grade ---------- */
              if (Number.isFinite(total)) {
                const t = total as number;
                const predTotal = simsA + simsB;
                const pickTotal = predTotal > t ? `Over ${t}` : `Under ${t}`;

                // confidence via sims totals
                const totals = sim.rowsA.map(r => r.pts + r.opp_pts);
                let overCount = 0;
                for (const x of totals) if (x > t) overCount++;
                const pOver = totals.length ? overCount / totals.length : undefined;
                const confidence = typeof pOver === "number"
                  ? (pickTotal.startsWith("Over") ? pOver : 1 - pOver)
                  : undefined;

                const isOverPick = pickTotal.startsWith("Over");
                const isUnderPick = !isOverPick;

                // Positive EV at -110 threshold
                const isPositiveEV = typeof confidence === "number" && confidence > SPREAD_TOTAL_POS_EV_THRESHOLD;

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
                    week: w, weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                    kickoffMs, key: `${key}__total`,
                    market: "total",
                    pickText: pickTotal,
                    result, units, stakeRisk,
                    confidence,
                    isOverPick,
                    isUnderPick,
                    isPositiveEV,
                  });
                }
              }

              /* ---------- Moneyline: pick by OUTRIGHT WIN PROB ONLY + EV ---------- */
              if (Number.isFinite(mlA) && Number.isFinite(mlB)) {
                // Simulated outright win probabilities, oriented to file A/B
                const AvalsBook = bookAisSimsA
                  ? sim.rowsA.map(r => r.pts)
                  : sim.rowsA.map(r => r.opp_pts);
                const BvalsBook = bookAisSimsA
                  ? sim.rowsA.map(r => r.opp_pts)
                  : sim.rowsA.map(r => r.pts);

                let aWins = 0;
                const nPairs = Math.min(AvalsBook.length, BvalsBook.length);
                for (let i = 0; i < nPairs; i++) if (AvalsBook[i] > BvalsBook[i]) aWins++;
                const pA = nPairs ? aWins / nPairs : 0.5;
                const pB = 1 - pA;

                // Pick the side with HIGHER WIN PROBABILITY
                const pickA = pA >= pB;
                const pickTeam = pickA ? teamA_meta : teamB_meta;
                const pickOdds = pickA ? (mlA as number) : (mlB as number);
                const confidence = pickA ? pA : pB;

                // EV check: simulator P(win) vs implied prob from ML
                const implied = impliedProbFromAmerican(pickOdds);
                const isPositiveEV = confidence > implied;

                // Staking: favorite risk=|odds|/100 to win 1; dog risk=1 to win odds/100
                const isFav = pickOdds < 0;
                const stakeRisk = isFav ? Math.abs(pickOdds) / 100 : 1;
                const winPayout = isFav ? 1 : pickOdds / 100;

                const isFavoritePick = isFav;
                const isUnderdogPick = !isFav;
                const pickText = `${pickTeam} ML ${pickOdds > 0 ? `+${pickOdds}` : `${pickOdds}`}`;

                if (hasFinals) {
                  const fA = finalA as number;
                  const fB = finalB as number;
                  const pickedWon = pickA ? (fA > fB) : (fB > fA);
                  const result: "W" | "L" = pickedWon ? "W" : "L";
                  const units = pickedWon ? winPayout : -stakeRisk;

                  allRows.push({
                    week: w, weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                    kickoffMs, key: `${key}__ml`,
                    market: "ml",
                    pickText,
                    result, units, stakeRisk,
                    confidence,
                    isFavoritePick,
                    isUnderdogPick,
                    isPositiveEV,
                  });
                }
              }
            }
          }
        }

        if (!alive) return;
        setRows(allRows);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadAll();
    return () => { alive = false; ac.abort(); };
  }, [weeks]);

  /* ---------- Apply filters (market + pick type + EV + confidence) ---------- */
  const filteredRows = useMemo(() => {
    const min = Math.max(0, Math.min(100, confMin));
    const max = Math.max(min, Math.min(100, confMax));
    return rows.filter(r => {
      // Market
      if (marketFilter !== "all" && r.market !== marketFilter) return false;

      // Confidence window
      if (typeof r.confidence !== "number") return false;
      const pc = r.confidence * 100;
      if (!(pc >= min && pc <= max)) return false;

      // EV filter
      if (evFilter === "positive" && !r.isPositiveEV) return false;

      // Pick-type filter (contextual)
      switch (pickFilter) {
        case "all":       return true;
        case "over":      return r.market === "total"  && !!r.isOverPick;
        case "under":     return r.market === "total"  && !!r.isUnderPick;
        case "favorite":  return (r.market === "spread" || r.market === "ml") && !!r.isFavoritePick;
        case "underdog":  return (r.market === "spread" || r.market === "ml") && !!r.isUnderdogPick;
      }
    });
  }, [rows, marketFilter, pickFilter, evFilter, confMin, confMax]);

  /* ---------- Build cumulative series + per-week splits (filtered) ---------- */
  const { unitsSeries, overall, byWeek, dividers } = useMemo(() => {
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

      if (p.result === "W") { perWeek[p.week].W += 1; running += p.units; perWeek[p.week].units += p.units; }
      else if (p.result === "L") { perWeek[p.week].L += 1; running += p.units; perWeek[p.week].units += p.units; }
      else { perWeek[p.week].P += 1; }

      series.push({ idx: i + 1, units: Number(running.toFixed(2)) });
    });

    const W = graded.filter((p) => p.result === "W").length;
    const L = graded.filter((p) => p.result === "L").length;
    const P = graded.filter((p) => p.result === "P").length;

    const profit = Number(graded.reduce((sum, r) => sum + r.units, 0).toFixed(2));
    const risk = graded.reduce((sum, r) => sum + (r.stakeRisk ?? 0), 0);
    const ror = risk ? Number(((profit / risk) * 100).toFixed(1)) : 0;

    return {
      unitsSeries: series,
      overall: { W, L, P, profit, win_pct: 0, risk, ror },
      byWeek: perWeek,
      dividers: weekStartIdx,
    };
  }, [filteredRows]);

  // Win% across filtered rows, excluding pushes
  const gradedBets = filteredRows.filter(r => r.result !== "P");
  const wins = gradedBets.filter(r => r.result === "W").length;
  const win_pct = gradedBets.length ? Number(((wins / gradedBets.length) * 100).toFixed(1)) : 0;

  /* ---------- Contextual pick-type options ---------- */
  const pickTypeOptions = useMemo(() => {
    const base = [{ value: "all", label: "All picks" }];
    if (marketFilter === "total") {
      return [
        ...base,
        { value: "over", label: "Over only" },
        { value: "under", label: "Under only" },
      ];
    }
    if (marketFilter === "spread") {
      return [
        ...base,
        { value: "favorite", label: "Favorite only" },
        { value: "underdog", label: "Underdog only" },
      ];
    }
    if (marketFilter === "ml") {
      return [
        ...base,
        { value: "favorite", label: "ML favorites only" },
        { value: "underdog", label: "ML underdogs only" },
      ];
    }
    // market = all
    return base;
  }, [marketFilter]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>Results</h2>
          <span style={{ fontSize: 14, opacity: 0.8 }}>
            {loading ? "Loading…" : `Graded picks: ${filteredRows.length}`}
          </span>
        </div>

        {/* Filters */}
        <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Market:</label>
          <select
            value={marketFilter}
            onChange={(e) => { setMarketFilter(e.target.value as MarketFilter); setPickFilter("all"); }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            <option value="all">All bets</option>
            <option value="spread">Spread</option>
            <option value="total">Total</option>
            <option value="ml">Moneyline</option>
          </select>

          {/* Pick type (contextual) */}
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Pick type:</label>
          <select
            value={pickFilter}
            onChange={(e) => setPickFilter(e.target.value as PickFilter)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            {pickTypeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* EV filter */}
          <label style={{ fontSize: 13, color: "var(--muted)" }}>EV:</label>
          <select
            value={evFilter}
            onChange={(e) => setEvFilter(e.target.value as EVFilter)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            <option value="all">All bets</option>
            <option value="positive">Positive EV only</option>
          </select>

          {/* Confidence range */}
          <label style={{ marginLeft: 8, fontSize: 13, color: "var(--muted)" }}>Confidence %:</label>
          <input
            type="number" min={0} max={100} step={1}
            value={confMin}
            onChange={(e)=>setConfMin(Number(e.target.value))}
            style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          />
          <span style={{ fontSize: 14 }}>to</span>
          <input
            type="number" min={0} max={100} step={1}
            value={confMax}
            onChange={(e)=>setConfMax(Number(e.target.value))}
            style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          />
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><b>Record:</b> {gradedBets.filter(r=>r.result==="W").length}-{gradedBets.filter(r=>r.result==="L").length}-{filteredRows.filter(r=>r.result==="P").length}</span>
          <span><b>Profit:</b> {Number(filteredRows.reduce((s, r) => s + r.units, 0)).toFixed(2)}u</span>
          <span><b>Win%:</b> {win_pct.toFixed(1)}%</span>
          <span><b>RoR:</b> {overall.ror.toFixed(1)}%</span>
        </div>
      </section>

      {/* Cumulative Units Chart (filtered) */}
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

      {/* Week-by-week summary (filtered) */}
      <section className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Week-by-Week</div>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(byWeek)
            .sort((a, b) => {
              const na = parseInt(a[0].replace(/[^0-9]/g, "") || "0", 10);
              const nb = parseInt(b[0].replace(/[^0-9]/g, "") || "0", 10);
              return na - nb;
            })
            .map(([wk, rec], idx) => (
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
          {!Object.keys(byWeek).length && <div style={{ opacity: 0.7 }}>No graded games in this filter.</div>}
        </div>
      </section>
    </div>
  );
}
