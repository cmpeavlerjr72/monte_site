// src/pages/Scoreboard.tsx
import { useEffect, useMemo, useState } from "react";
import * as Papa from "papaparse";
import { getTeamColors } from "../utils/teamColors";

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

/* --------------------- Team logo lookup (same as GameCenter) --------------------- */
const TEAM_INFO_RAW = import.meta.glob("../assets/team_info.csv", { as: "raw", eager: true }) as Record<string, string>;
const teamInfoRaw = Object.values(TEAM_INFO_RAW)[0] ?? "";
const LOGO_MAP: Record<string, string> = {};

function normTeamKey(t: string) {
  return t
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.\b/g, "state")
    .replace(/[^a-z0-9]+/g, "");
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
function getTeamLogo(name: string) {
  return LOGO_MAP[normTeamKey(name)];
}

/* --------------------- types & helpers --------------------- */
interface SimRow { team: string; opp: string; pts: number; opp_pts: number; }
interface GameData { teamA: string; teamB: string; rowsA: SimRow[]; } // normalized to A vs B (alphabetical)
type GameMap = Record<string, GameData>;

type GameMeta = {
  teamA: string;
  teamB: string;
  kickoffLabel?: string;
  kickoffMs?: number;
  kickoffRank?: number;   // YYYYMMDDHHmm numeric key for robust sorting
  spread?: number; // Team A line
  total?: number;
};
type GameMetaMap = Record<string, GameMeta>;

type CardGame = {
  key: string;
  teamA: string;
  teamB: string;
  medA: number;
  medB: number;
  kickoffLabel?: string;
  kickoffMs?: number;
  kickoffRank?: number;
  pickSpread?: string;
  pickTotal?: string;
};

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const sortedKey = (a: string, b: string) =>
  [a, b].sort((x, y) => x.localeCompare(y)).join("__");

function pick<T = any>(row: any, keys: string[]): T | undefined {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k] as T;
  return undefined;
}

/* ---------- date/time formatter: date + time (no weekday) in ET ---------- */
function formatKick(dt: Date) {
  return dt
    .toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(",", " •"); // "Sep 6, 12:00 PM" -> "Sep 6 • 12:00 PM"
}

/* ---------- robust date/time parsing (ignores weekday text) ---------- */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseMonthDay(input: string): { y?: number; m: number; d: number } | null {
    const s = input.trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s*/i, "");
  
    // "Sep 5" or "September 5" (optional year)
    let m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
    if (m) return { y: m[3] ? Number(m[3]) : undefined, m: MONTHS[m[1].toLowerCase()], d: Number(m[2]) };
  
    // **NEW**: "5-Sep" or "5-Sep-2025"
    m = s.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:-(\d{4}))?$/i);
    if (m) return { y: m[3] ? Number(m[3]) : undefined, m: MONTHS[m[2].toLowerCase()], d: Number(m[1]) };
  
    // "9/5" or "09/05" or "09/05/2025"
    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) return { y: m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : undefined, m: Number(m[1]), d: Number(m[2]) };
  
    // ISO "2025-09-05"
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  
    return null;
}
  

function parseTime(input?: string): { h: number; min: number } | null {
    if (!input) return null;
    const s = String(input).trim();
  
    // "7:00:00 PM" / "7:00 PM" / "7 PM"
    let m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AP]M)?$/i);
    if (m) {
      let h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      const ampm = m[3]?.toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return { h, min };
    }
  
    // 24h "19:00" or "19:00:00"
    m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) return { h: Number(m[1]), min: Number(m[2]) };
  
    return null;
}
  

/* ---------- Build ms + label + rank; label uses formatKick (no weekday/seconds) ---------- */
function parseKickoffMs(
  rawDate?: string,
  rawTime?: string,
  rawDateTime?: string
): { ms?: number; label?: string; rank?: number } {
  // Helper: numeric rank YYYYMMDDHHmm
  const makeRank = (y: number, m: number, d: number, h: number, min: number) =>
    y * 100000000 + m * 1000000 + d * 10000 + h * 100 + min;

  if (rawDateTime && !Number.isNaN(Date.parse(rawDateTime))) {
    const ms = Date.parse(rawDateTime);
    // Pull Y/M/D/H/M in America/New_York so rank sorts by ET date, not local.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const y = Number(parts.find(p => p.type === "year")?.value);
    const m = Number(parts.find(p => p.type === "month")?.value);
    const d = Number(parts.find(p => p.type === "day")?.value);
    const h = Number(parts.find(p => p.type === "hour")?.value);
    const min = Number(parts.find(p => p.type === "minute")?.value);
    const rank = makeRank(y, m, d, h, min);
    return { ms, label: formatKick(new Date(ms)), rank };
  }

  const mmdd = rawDate ? parseMonthDay(String(rawDate)) : null;
  const tt = parseTime(rawTime);

  if (mmdd) {
    const y = mmdd.y ?? new Date().getFullYear();
    const h = tt?.h ?? 0;
    const min = tt?.min ?? 0;
    // ms constructed in local tz (only used for rendering label), but rank enforces date-first ordering
    const dt = new Date(y, mmdd.m - 1, mmdd.d, h, min);
    const rank = makeRank(y, mmdd.m, mmdd.d, h, min);
    return { ms: dt.getTime(), label: formatKick(dt), rank };
  }

  // Fallback label only (strip seconds if present)
  let label = [rawDate, rawTime].filter(Boolean).join(" • ") || undefined;
  if (label) label = label.replace(/(\d{1,2}:\d{2}):\d{2}(\s*[AP]M)/i, "$1$2");
  return { ms: undefined, label, rank: undefined };
}

/* --------------------- page --------------------- */
export default function Scoreboard() {
  const weeks = useMemo(() => {
    const s = new Set<string>([...scoreFilesAll, ...gamesFilesAll].map((f) => f.week));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, []);

  const [selectedWeek, setSelectedWeek] = useState(weeks[0] ?? "");
  const [loading, setLoading] = useState(false);

  const [games, setGames] = useState<GameMap>({});
  const [meta, setMeta]   = useState<GameMetaMap>({});

  useEffect(() => {
    if (!selectedWeek) { setGames({}); setMeta({}); return; }

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
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: (res) => {
                      try {
                        const rows = (res.data as any[])
                          .filter((r) => r && r.team != null && r.opp != null && r.pts != null && r.opp_pts != null)
                          .map((r) => ({
                            team: String(r.team),
                            opp: String(r.opp),
                            pts: Number(r.pts),
                            opp_pts: Number(r.opp_pts),
                          })) as SimRow[];
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
                  Papa.parse(text, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: (res) => resolve(res.data as any[]),
                    error: reject,
                  });
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
            const a = String(
              pick<string>(row, ["Team A", "team_a", "teamA", "A", "Home", "home"]) ?? ""
            ).trim();
            const b = String(
              pick<string>(row, ["Team B", "team_b", "teamB", "B", "Away", "away"]) ?? ""
            ).trim();
            if (!a || !b) continue;

            const dateStr = pick<string>(row, ["Date", "date", "Game Date", "game_date"]);
            const timeStr = pick<string>(row, ["Time", "time", "Kick", "kick", "Kickoff", "kickoff"]);
            const datetimeStr = pick<string>(row, ["Datetime", "DateTime", "datetime", "start_time", "StartTime"]);
            const { ms, label, rank } = parseKickoffMs(dateStr, timeStr, datetimeStr);

            const spread = Number(
              pick<string | number>(row, ["Spread", "spread", "Line", "line"])
            );
            const total = Number(
              pick<string | number>(row, ["Total", "total", "O/U", "OU"])
            );

            const key = sortedKey(a, b);
            m[key] = {
              teamA: a,
              teamB: b,
              kickoffMs: Number.isFinite(ms!) ? ms : undefined,
              kickoffLabel: label,
              kickoffRank: Number.isFinite(rank!) ? rank : undefined,
              spread: Number.isFinite(spread) ? spread : undefined,
              total: Number.isFinite(total) ? total : undefined,
            };
          }
        }
        setMeta(m);
      } finally {
        setLoading(false);
      }
    }
    loadWeek();
  }, [selectedWeek]);

  /* ---------- cards (join sims with meta, compute picks, sort by date then time) ---------- */
  const cards: CardGame[] = useMemo(() => {
    const out: CardGame[] = [];
    for (const [key, g] of Object.entries(games)) {
      const Avals = g.rowsA.map((r) => r.pts);
      const Bvals = g.rowsA.map((r) => r.opp_pts);
      const medA = Math.round(median(Avals));
      const medB = Math.round(median(Bvals));

      const joined = meta[key];

      // align sims with book's Team A/B when computing picks
      let simsA = medA;
      let simsB = medB;
      if (joined && g.teamA !== joined.teamA) {
        simsA = medB;
        simsB = medA;
      }

      // spread pick (Team A line)
      let pickSpread: string | undefined;
      if (joined?.spread !== undefined) {
        const s = joined.spread;
        const diff = (simsA + s) - simsB; // Team A covers if > 0
        if (Math.abs(diff) < 1e-9) {
          pickSpread = `Push @ ${s > 0 ? `+${s}` : `${s}`}`;
        } else if (diff > 0) {
          pickSpread = `${joined.teamA} ${s > 0 ? `+${s}` : `${s}`}`;
        } else {
          pickSpread = `${joined.teamB} ${(-s) > 0 ? `+${-s}` : `${-s}`}`;
        }
      }

      // total pick
      let pickTotal: string | undefined;
      if (joined?.total !== undefined) {
        const predTotal = simsA + simsB;
        pickTotal = predTotal > joined.total ? `Over ${joined.total}` : `Under ${joined.total}`;
      }

      out.push({
        key,
        teamA: g.teamA,
        teamB: g.teamB,
        medA,
        medB,
        kickoffLabel: joined?.kickoffLabel,
        kickoffMs: joined?.kickoffMs,
        kickoffRank: joined?.kickoffRank,
        pickSpread,
        pickTotal,
      });
    }

    // Primary: kickoffRank (YYYYMMDDHHmm in ET). Secondary: team name.
    out.sort((x, y) => {
      const rx = x.kickoffRank ?? Number.MAX_SAFE_INTEGER;
      const ry = y.kickoffRank ?? Number.MAX_SAFE_INTEGER;
      if (rx !== ry) return rx - ry;
      return x.teamA.localeCompare(y.teamA);
    });
    return out;
  }, [games, meta]);

  /* ---------- UI ---------- */
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      {/* Week selector */}
      <section className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>Week</h2>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            {loading ? "Loading…" : `Showing ${cards.length} game${cards.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </section>

      {/* Cards grid */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          alignItems: "stretch",
        }}
      >
        {cards.map((g) => {
          const aColors = getTeamColors(g.teamA);
          const bColors = getTeamColors(g.teamB);
          const aLogo = getTeamLogo(g.teamA);
          const bLogo = getTeamLogo(g.teamB);

          // always show ET date + time without seconds
          const kickLabel =
            g.kickoffMs != null
              ? formatKick(new Date(g.kickoffMs))
              : (g.kickoffLabel ? g.kickoffLabel.replace(/(\d{1,2}:\d{2}):\d{2}(\s*[AP]M)/i, "$1$2") : "TBD");

          return (
            <article
              key={g.key}
              className="card"
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--card)",
                display: "grid",
                gridTemplateRows: "auto auto auto",
                gap: 8,
              }}
            >
              {/* header row: date/time */}
              <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                <span>{selectedWeek}</span>
                <span>{kickLabel}</span>
              </div>

              {/* teams + scores */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {aLogo ? (
                    <img src={aLogo} alt={`${g.teamA} logo`} width={28} height={28} style={{ objectFit: "contain" }} loading="lazy" />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: aColors?.primary ?? "var(--brand)" }} />
                  )}
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ fontWeight: 800, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                      {g.teamA}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: 28, lineHeight: 1, color: aColors?.primary ?? "var(--text)" }}>
                    {g.medA}
                  </div>
                  <div style={{ fontWeight: 700, color: "var(--muted)" }}>vs</div>
                  <div style={{ fontWeight: 800, fontSize: 28, lineHeight: 1, color: bColors?.primary ?? "var(--text)" }}>
                    {g.medB}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "end", minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textAlign: "right" }}>
                    <div style={{ fontWeight: 800, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                      {g.teamB}
                    </div>
                  </div>
                  {bLogo ? (
                    <img src={bLogo} alt={`${g.teamB} logo`} width={28} height={28} style={{ objectFit: "contain" }} loading="lazy" />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: bColors?.primary ?? "var(--accent)" }} />
                  )}
                </div>
              </div>

              {/* picks row */}
              {(g.pickSpread || g.pickTotal) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {g.pickSpread && (
                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: "color-mix(in oklab, var(--brand) 10%, white)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Spread: Pick • {g.pickSpread}
                    </span>
                  )}
                  {g.pickTotal && (
                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: "color-mix(in oklab, var(--accent) 10%, white)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Total: Pick • {g.pickTotal}
                    </span>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
