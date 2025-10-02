// src/pages/CLV.tsx
import { useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine,
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

/* ---------- Discover week games CSVs (date/time, lines, finals) ---------- */
const G_RAW = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "raw", eager: true }),
  import.meta.glob("../data/**/games*.csv",       { as: "raw", eager: true }),
  import.meta.glob("../data/**/week*_open*.csv",  { as: "raw", eager: true }) // allow *_open.csv like week1_open.csv
) as Record<string, string>;

const G_URL = Object.assign(
  {},
  import.meta.glob("../data/**/week*_games*.csv", { as: "url", eager: true }),
  import.meta.glob("../data/**/games*.csv",       { as: "url", eager: true }),
  import.meta.glob("../data/**/week*_open*.csv",  { as: "url", eager: true })
) as Record<string, string>;

/* ---------- Load team & conference dictionary from assets ---------- */
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
    const n = Number(String(v).trim().replace(/[^\d.+-]/g, "")); // tolerant parse
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ---------- Robust kickoff parser (optional) ---------- */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
function parseMonthDay(input: string): { y?: number; m: number; d: number } | null {
  const s = input.trim();
  const noDow = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s*/i, "");
  let m = noDow.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
  if (m) { const mon = MONTHS[m[1].toLowerCase()]; const day = Number(m[2]); const y = m[3] ? Number(m[3]) : undefined;
    if (mon && day) return { y, m: mon, d: day }; }
  m = noDow.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:-(\d{4}))?$/i);
  if (m) { const day = Number(m[1]); const mon = MONTHS[m[2].toLowerCase()]; const y = m[3] ? Number(m[3]) : undefined;
    if (mon && day) return { y, m: mon, d: day }; }
  m = noDow.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/i);
  if (m) { const mon = Number(m[1]); const day = Number(m[2]); const y = m[3] ? Number(m[3].length === 2 ? ("20" + m[3]) : m[3]) : undefined;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return { y, m: mon, d: day }; }
  m = noDow.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return null;
}
function parseTime(input: string | undefined): { h: number; min: number } | null {
  if (!input) return null;
  const s = String(input).trim();
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) { let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0; const ampm = m[3]?.toUpperCase();
    if (ampm === "PM" && h < 12) h += 12; if (ampm === "AM" && h === 12) h = 0; return { h, min }; }
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
  if (md) { const y = md.y ?? new Date().getFullYear(); const h = tt?.h ?? 0; const min = tt?.min ?? 0;
    return new Date(y, md.m - 1, md.d, h, min).getTime(); }
  return undefined;
}

/* ---------- CLV from sims (spread) ---------- */
function coverProbFromSims(rowsA: SimRow[], side: "A" | "B", lineForThatSide: number): number {
  if (!rowsA.length) return 0;
  let covers = 0;
  for (const r of rowsA) {
    const marginA = r.pts - r.opp_pts;        // A − B
    const marginSide = side === "A" ? marginA : -marginA; // B − A
    if (marginSide + lineForThatSide > 0) covers++;
  }
  return covers / rowsA.length;
}

type CLVRow = {
  week: string; weekNum: number;
  kickoffMs?: number;
  key: string;
  teamA: string; teamB: string;
  confA?: string; confB?: string;

  // Chosen bet at OpeningSpread (book A-oriented line)
  pickTeam: string;
  pickSide: "A" | "B";
  betLine: number;
  closeLineForPick: number;
  ptsDiff: number;

  pBet: number;
  pClose: number;
  clvProb: number;
};

export default function CLVPage() {
  const weeks = useMemo(() => {
    const s = new Set<string>([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CLVRow[]>([]);

  // team-info dictionaries
  const [teamToConf, setTeamToConf] = useState<Record<string, string>>({});
  const [allTeams, setAllTeams] = useState<string[]>([]);
  const [allConfs, setAllConfs] = useState<string[]>([]);

  // Filters
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [confFilter, setConfFilter] = useState<string>("all");
  type GameTypeFilter = "all" | "conference" | "nonconference";
  const [gameType, setGameType] = useState<GameTypeFilter>("all");
  const [minAbsCLV, setMinAbsCLV] = useState<number>(0); // filter by |CLV| %

  /* ---------- team_info.csv ---------- */
  useEffect(() => {
    if (!teamInfoCsvText) return;
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
    setTeamToConf(t2c);
    setAllTeams(Array.from(teamSet).sort((a, b) => a.localeCompare(b)));
    setAllConfs(Array.from(confSet).sort((a, b) => a.localeCompare(b)));
  }, []);

  const confOf = (team: string | undefined) => {
    if (!team) return undefined;
    const k1 = team.toLowerCase();
    const k2 = team.replace(/\s+/g, "").toLowerCase();
    return teamToConf[k1] ?? teamToConf[k2] ?? undefined;
  };

  /* ---------- load sims + compute CLV rows ---------- */
  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    async function loadAll() {
      setLoading(true);
      try {
        // sims by week
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

        // compute CLV using OpeningSpread (bet) vs Spread (close)
        const out: CLVRow[] = [];
        for (const w of weeks) {
          const gFiles = gamesFilesAll.filter((f) => f.week === w);
          const metaArrays = await pAllLimit(gFiles, isSafari ? 2 : 4, (item) =>
            parseCsvFromItemSafe<any>(item, ac.signal)
          );

          const gm = simsByWeek[w] || {};

          for (const arr of metaArrays) {
            for (const row of arr as any[]) {
              if (!row) continue;

              // Prefer explicit Team A/B if present; otherwise fall back to Home/Away.
              const csvTeamA = pick<string>(row, ["Team A","team_a","teamA","A"]);
              const csvTeamB = pick<string>(row, ["Team B","team_b","teamB","B"]);
              const csvHome  = pick<string>(row, ["HomeTeam","Home","home","home_team"]);
              const csvAway  = pick<string>(row, ["AwayTeam","Away","away","away_team"]);

              // Determine book "Team A" / "Team B" fields.
              // If Team A/B present, use them and remember which is home.
              // Else, use Home=Team A, Away=Team B (home-oriented lines).
              let teamA = "";
              let teamB = "";
              let homeTeam = "";
              let awayTeam = "";

              if (csvTeamA && csvTeamB) {
                teamA = String(csvTeamA).trim();
                teamB = String(csvTeamB).trim();
                // home/away for sign flip: try to match provided home/away to teamA/B if available
                if (csvHome && String(csvHome).trim().toLowerCase() === teamA.toLowerCase()) {
                  homeTeam = teamA; awayTeam = teamB;
                } else if (csvAway && String(csvAway).trim().toLowerCase() === teamA.toLowerCase()) {
                  homeTeam = String(csvHome ?? ""); awayTeam = teamA; // teamA is away
                } else {
                  // unknown: leave blank; we will treat spreads as TeamA-oriented if Home/Away missing
                  homeTeam = String(csvHome ?? "");
                  awayTeam = String(csvAway ?? "");
                }
              } else if (csvHome && csvAway) {
                teamA = String(csvHome).trim(); // Home is Team A
                teamB = String(csvAway).trim();
                homeTeam = teamA; awayTeam = teamB;
              } else {
                continue; // no teams available
              }

              if (!teamA || !teamB) continue;

              // Conferences (from CSV or fallback to team_info)
              let confA = pick<string>(row, ["Team A Conf","team_a_conf","confA","ConfA","A Conf","home_conf"]);
              let confB = pick<string>(row, ["Team B Conf","team_b_conf","confB","ConfB","B Conf","away_conf"]);
              if (!confA) confA = confOf(teamA);
              if (!confB) confB = confOf(teamB);

              const key = sortedKey(teamA, teamB);
              const sim = gm[key];
              if (!sim) continue;

              // Book lines (we assume book spreads are HOME oriented when HomeTeam/AwayTeam exist,
              // otherwise TEAM A oriented if only Team A/B are present without Home/Away context).
              const openHome = pickNum(row, ["OpeningSpread","opening_spread","Opening Spread","Open","Opener","OpenLine","Open_Line"]);
              const closeHome = pickNum(row, ["Spread","spread","ClosingSpread","Closing Spread","Line","Close","CloseLine","Close_Line"]);
              if (!Number.isFinite(openHome) || !Number.isFinite(closeHome)) continue;

              const kickoffMs = kickoffMsFrom(row);

              // Orient sims so that rowsAlpha margins are Team A - Team B for THIS row
              const rowsAlpha: SimRow[] = (sim.teamA === teamA)
                ? sim.rowsA
                : sim.rowsA.map(r => ({ team: teamA, opp: teamB, pts: r.opp_pts, opp_pts: r.pts }));

              // Determine if book lines are HOME-oriented or TEAM A-oriented:
              const bookHomeAwayKnown = Boolean(csvHome && csvAway);
              // Convert the opening/closing numbers into Team-A-oriented lines:
              // If we know home/away:
              //   - If Team A is home: teamA_open = openHome ; teamA_close = closeHome
              //   - If Team A is away: teamA_open = -openHome ; teamA_close = -closeHome
              // If we don't know, assume book is TeamA-oriented already.
              let openingSpreadA: number;
              let closingSpreadA: number;
              if (bookHomeAwayKnown && homeTeam && awayTeam) {
                const teamAIsHome = teamA && homeTeam && (teamA.toLowerCase() === homeTeam.toLowerCase());
                openingSpreadA = teamAIsHome ? (openHome as number) : -(openHome as number);
                closingSpreadA = teamAIsHome ? (closeHome as number) : -(closeHome as number);
              } else {
                // No Home/Away given → treat as already Team A oriented
                openingSpreadA = openHome as number;
                closingSpreadA = closeHome as number;
              }

              // 1) Choose side at OPEN using sims
              const pA_open = coverProbFromSims(rowsAlpha, "A", openingSpreadA);
              const pB_open = coverProbFromSims(rowsAlpha, "B", -openingSpreadA);
              const pickSide: "A" | "B" = pA_open >= pB_open ? "A" : "B";
              const pickTeam = pickSide === "A" ? teamA : teamB;

              // 2) Bet line & closing line for that same side (Team A oriented)
              const betLine = pickSide === "A" ? openingSpreadA : -openingSpreadA;
              const closeLineForPick = pickSide === "A" ? closingSpreadA : -closingSpreadA;

              // 3) Probabilities from sims
              const pBet   = coverProbFromSims(rowsAlpha, pickSide, betLine);
              const pClose = coverProbFromSims(rowsAlpha, pickSide, closeLineForPick);

              const clvProb = pBet - pClose;
              const ptsDiff = betLine - closeLineForPick;

              out.push({
                week: w,
                weekNum: parseInt(w.replace(/[^0-9]/g, "") || "0", 10),
                kickoffMs,
                key: `${key}__${teamA}__${teamB}__clv`,
                teamA, teamB, confA, confB,
                pickTeam, pickSide,
                betLine, closeLineForPick,
                ptsDiff,
                pBet, pClose, clvProb,
              });
            }
          }
        }

        setRows(out);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadAll();
    return () => { alive = false; ac.abort(); };
  }, [weeks, teamToConf]);

  /* ---------- Filters ---------- */
  const filteredRows = useMemo(() => {
    const teamMatch = (r: CLVRow) =>
      teamFilter === "all" ||
      r.teamA.toLowerCase() === teamFilter.toLowerCase() ||
      r.teamB.toLowerCase() === teamFilter.toLowerCase();

    const confMatch = (r: CLVRow) =>
      confFilter === "all" ||
      (r.confA && r.confA.toLowerCase() === confFilter.toLowerCase()) ||
      (r.confB && r.confB.toLowerCase() === confFilter.toLowerCase());

    const gameTypeMatch = (r: CLVRow) => {
      if (gameType === "all") return true;
      const a = (r.confA ?? "").toLowerCase();
      const b = (r.confB ?? "").toLowerCase();
      if (!a || !b) return false;
      return gameType === "conference" ? a === b : a !== b;
    };

    return rows.filter(r =>
      teamMatch(r) &&
      confMatch(r) &&
      gameTypeMatch(r) &&
      (Math.abs(r.clvProb) * 100 >= Math.max(0, minAbsCLV))
    );
  }, [rows, teamFilter, confFilter, gameType, minAbsCLV]);

  /* ---------- Build cumulative CLV% series + per-week splits ---------- */
  const { cumSeries, byWeek, dividers, overall } = useMemo(() => {
    const graded = [...filteredRows].sort((a, b) => {
      if (a.weekNum !== b.weekNum) return a.weekNum - b.weekNum;
      const ax = a.kickoffMs ?? Number.POSITIVE_INFINITY;
      const bx = b.kickoffMs ?? Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      return a.key.localeCompare(b.key);
    });
  
    // cumulative average CLV% (in probability points) by pick order
    const series: { idx: number; clvPct: number }[] = [];
    let running = 0;
    let posCount = 0; // <— count positive CLV bets
    const perWeek: Record<string, { n: number; avgClvPct: number; sumClv: number }> = {};
    const weekStartIdx: { idx: number; label: string }[] = [];
  
    let lastWeek = "";
    graded.forEach((r, i) => {
      if (r.week !== lastWeek) {
        weekStartIdx.push({ idx: i, label: r.week });
        lastWeek = r.week;
      }
      running += r.clvProb;      // probability points
      if (r.clvProb > 0) posCount += 1; // <— increment
  
      const avg = (running / (i + 1)) * 100; // to %
      series.push({ idx: i + 1, clvPct: Number(avg.toFixed(3)) });
  
      if (!perWeek[r.week]) perWeek[r.week] = { n: 0, sumClv: 0, avgClvPct: 0 };
      perWeek[r.week].n += 1;
      perWeek[r.week].sumClv += r.clvProb;
    });
  
    for (const w of Object.keys(perWeek)) {
      const x = perWeek[w];
      x.avgClvPct = x.n ? Number(((x.sumClv / x.n) * 100).toFixed(2)) : 0;
    }
  
    const n = graded.length;
    const overallAvgPct = n ? Number(((running / n) * 100).toFixed(2)) : 0;
    const overallPosPct = n ? Number(((posCount / n) * 100).toFixed(1)) : 0; // <—
  
    return {
      cumSeries: series,
      byWeek: perWeek,
      dividers: weekStartIdx,
      overall: { n, avgClvPct: overallAvgPct, posPct: overallPosPct, posCount }, // <—
    };
  }, [filteredRows]);
  

  const teamOptions = allTeams;
  const confOptions = allConfs;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>Closing Line Value (Spread)</h2>
          <span style={{ fontSize: 14, opacity: 0.8 }}>
            {loading
              ? "Loading…"
              : filteredRows.length
                  ? `Bets evaluated: ${filteredRows.length} (overall avg CLV: ${overall.avgClvPct.toFixed(2)}%)`
                  : "No bets found — confirm OpeningSpread/Spread + team columns in week CSVs."}
          </span>
        </div>

        {/* Filters */}
        <div style={{ marginTop: 10, display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "center" }}>
          {/* Team */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Team:</label>
            <select
              value={teamFilter}
              onChange={(e)=>setTeamFilter(e.target.value)}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            >
              <option value="all">All teams</option>
              {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Conference */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Conference:</label>
            <select
              value={confFilter}
              onChange={(e)=>setConfFilter(e.target.value)}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            >
              <option value="all">All conferences</option>
              {confOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Game type */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Game type:</label>
            <select
              value={gameType}
              onChange={(e)=>setGameType(e.target.value as any)}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            >
              <option value="all">All games</option>
              <option value="conference">Conference games</option>
              <option value="nonconference">Non-conference games</option>
            </select>
          </div>

          {/* Min |CLV| filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>|CLV| ≥</label>
            <input
              type="number" min={0} max={100} step={0.1}
              value={minAbsCLV}
              onChange={(e)=>setMinAbsCLV(Number(e.target.value))}
              style={{ width: 100, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>%</span>
          </div>
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><b>Avg CLV:</b> {overall.avgClvPct.toFixed(2)}%</span>
          <span><b>Bets:</b> {overall.n}</span>
          <span>
            <b>% Positive CLV:</b> {overall.posPct?.toFixed?.(1)?? "0.0"}%
            {typeof overall.posCount === "number" && (
                <>({overall.posCount}/{overall.n})</>
            )}
          </span>
        </div>
      </section>

      {/* Cumulative CLV% Chart (filtered) */}
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Cumulative Average CLV% (by pick order)</div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumSeries} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.35} />
              <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={["dataMin - 1", "dataMax + 1"]} unit="%" />
              <Tooltip
                formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "Avg CLV"]}
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
              <Line type="monotone" dataKey="clvPct" dot={false} stroke="var(--accent)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Week-by-week CLV summary (filtered) */}
      <section className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Week-by-Week (Average CLV%)</div>
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
                      <b>Avg CLV:</b> {rec.avgClvPct.toFixed(2)}%
                    </span>
                    <span>
                      <b>Bets:</b> {rec.n}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          {!Object.keys(byWeek).length && <div style={{ opacity: 0.7 }}>No games match these filters.</div>}
        </div>
      </section>
    </div>
  );
}
