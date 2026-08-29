// src/pages/Scoreboard.tsx
import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as Papa from "papaparse";
import { displayTeamColor } from "../utils/teamColors";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from "recharts";

import { useLiveScoreboard } from "../lib/useLiveScoreboard";

import SupportButton from "../components/SupportButton";
import ErrorBoundary from "../components/ErrorBoundary";
import { Skeleton, SkeletonCard, SkeletonChart } from "../components/Skeleton";
import { useThemeMode, useDensity, useDivisionFilter, useIsDark, type Density } from "../lib/usePrefs";
import MarketEdge from "../components/MarketEdge";
import TopEdges from "../components/TopEdges";
import { type EdgeInput, type GameEdges } from "../lib/edges";
import { useSlateEdges } from "../lib/useSlateEdges";
import { localizeLogoUrl } from "../utils/espnLogos";
import {
  getCatalog, playerFileForPair, resolveLatestSeason, latestWeek,
  invalidateSeason, SEASONS, namespaceFor, fcsAvailableFor,
  type CfbCatalog, type Division, type DivisionFilter, type FileItem, type Season,
} from "../lib/cfbData";
import {
  getJsonWeekGames, getCompactJson, getCompactCached,
  type JsonGame, type JsonWeekRow,
} from "../lib/cfbJson";
import MyBookStrip from "../components/MyBook";
import BoxScore from "../components/BoxScore";
import PlayerProps from "../components/PlayerProps";
import TeamStats from "../components/TeamStats";
import GameBetsPanel, {
  PlaceStrip, findGroupById,
  type ProjectionTarget, type ScoreMetric,
} from "../components/SuggestedBets";
import SuggestedBetsIndex from "../components/SuggestedBetsIndex";
import MyBookPanel from "../components/MyBookPanel";
import { useSuggestions, type SuggestGame } from "../lib/useSuggestions";
import { useRestingReview } from "../lib/restingReview";
import {
  readModeFilter, readMyGamesOpen, readShowTails, readSuggestSort, readTypeFilter, readUnit,
  writeModeFilter, writeMyGamesOpen, writeShowTails, writeSuggestSort, writeTypeFilter, writeUnit,
  type BetTypeFilter, type ModeFilter, type SuggestSort,
} from "../lib/ownerPrefs";
import { buildGameYesP, buildStatYesP, useTeamStatsDocs } from "../lib/teamStatMarkets";
import type { FeeParams } from "../lib/suggestedBets";
import { getKalshiCfb, indexKalshiBySlug, type KalshiGame } from "../lib/kalshi";
import {
  readPortalToken, writePortalToken, usePortalBook, computePortalBets,
  computeSettlementRecord, buildSlatePairs, parseNcaafTicker, buildCodeToSlug, buildPortalYesP,
  type PortalBet, type PortalTotals, type SeedPair,
} from "../lib/kalshiPortal";
import LegPicker from "../components/LegPicker";
import ParlaySlip from "../components/ParlaySlip";
import { legLabel, type Leg, type LegSpec } from "../lib/parlay";
import { FieldStrip, LiveGamePanel } from "../components/LiveGamecast";
import LiveProgressStrip from "../components/LiveProgress";
import { parseSituation, useGameTeamStats, type LiveSituation } from "../lib/espnGame";
import { progressBetsOf } from "../lib/liveProgress";
import { useLiveGrid } from "../lib/liveGrid";
import {
  useWeekLines, pickAndGradeSpread, pickAndGradeTotal, pickAndGradeML,
  type Frame, type WeekLines,
} from "../lib/weekLines";

type LiveGame = {
  id: string;
  state: "pre" | "in" | "post" | "final" | "unknown";
  awayTeam?: string;
  homeTeam?: string;
  awayScore?: number;
  homeScore?: number;
  statusText: string;
  /** ESPN team ids + abbrevs, for the field strip and gamecast panel. */
  homeId?: string;
  awayId?: string;
  homeAbbrev?: string;
  awayAbbrev?: string;
  /** Every name form ESPN gives (shortDisplayName, location, displayName).
   *  The sim<->live join and all orientation checks run over these — the
   *  short name alone missed 19 of 46 FCS week-0 games (2026-08-27). */
  homeNames?: string[];
  awayNames?: string[];
  /** Canceled/postponed/suspended/forfeit — ESPN reports state "post" with a
   *  0-0 score and completed:false (Lafayette@Georgetown 2026-08-27), which
   *  must NEVER be graded as a real final. Bets on a no-contest push. */
  noContest?: boolean;
  /** Ball spot / down & distance / possession — present only while live. */
  situation?: LiveSituation;
  /** Kickoff-window stadium weather, straight off the SAME scoreboard event
   *  the rest of this join reads (`event.weather`). ESPN populates it inside
   *  roughly 5 days of kick and omits it entirely otherwise → null. No new
   *  fetcher exists for it and none should: because it rides the event, the
   *  published-snapshot tier (blocked-network mode) inherits it verbatim. */
  weather: LiveWeather | null;
  /** `competitions[0].venue.indoor`. A dome still carries an OUTDOOR forecast
   *  in `weather` (Fargodome: "Thunderstorms 80°"), so this flag wins on the
   *  card — the roof is the fact that matters. */
  indoor: boolean;
  /** Broadcast network(s) for this game — "ESPN", "ESPN/Disney+" — or null.
   *  Same event, same payload, same snapshot inheritance as the weather. */
  broadcast: string | null;
  /** Stadium and where it is. Rides `competitions[0].venue`, the same object
   *  `indoor` above is read from. */
  venue: LiveVenue | null;
};

/** Kickoff-window weather for one event, normalized. */
type LiveWeather = {
  /** Fahrenheit, rounded. Null when ESPN ships the block without a reading. */
  temp: number | null;
  /** ESPN's own words ("Mostly cloudy w/ t-storms") — the chip's tooltip. */
  text: string;
  /** AccuWeather condition code 1–44. ESPN sends it as a STRING ("4"), which
   *  is why this is coerced rather than read through. */
  conditionId: number | null;
};

/** Where the game is played, off the event's own venue object. */
type LiveVenue = {
  /** Stadium name ("Kenan Memorial Stadium"), or "" when ESPN omits it. */
  name: string;
  /** City, or "". */
  city: string;
  /** US state code, or "" — international venues carry a country instead. */
  state: string;
  /** "USA", "Ireland", … or "". Kept beside `state` rather than folded into
   *  it because the card prints one or the other and needs to know which:
   *  week 1 2026 opened at Aviva Stadium, whose address has NO state. */
  country: string;
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

/** Does any of a live team's name forms match this sim name? ESPN's
 *  shortDisplayName alone loses ("ETSU", "LIU", "SE Missouri State"), so
 *  every orientation check runs over the full variant list. */
const nameMatches = (
  names: string[] | undefined,
  fallback: string | undefined,
  target?: string
) => {
  const t = clean(target);
  if (!t) return false;
  const pool = names && names.length ? names : [fallback ?? ""];
  return pool.some((n) => clean(n) === t);
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
    // A "final" that never completed is a cancellation-family status, not a
    // result (STATUS_CANCELED arrives as state post, completed false, 0-0).
    const noContest =
      /CANCEL|POSTPON|SUSPEND|FORFEIT/.test(name) ||
      (state === "final" && !done && !name.includes("FINAL"));

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
      homeId: home?.team?.id != null ? String(home.team.id) : undefined,
      awayId: away?.team?.id != null ? String(away.team.id) : undefined,
      homeAbbrev: home?.team?.abbreviation,
      awayAbbrev: away?.team?.abbreviation,
      homeNames: nameForms(home?.team),
      awayNames: nameForms(away?.team),
      noContest: noContest || undefined,
      situation: state === "in" ? parseSituation(comp) : undefined,
      weather: parseEventWeather(e?.weather),
      indoor: comp?.venue?.indoor === true,
      broadcast: parseEventBroadcast(comp),
      venue: parseEventVenue(comp),
    };
  });
}

/** Broadcast networks for one competition → one short string.
 *
 *  ESPN's shape is `broadcasts: [{market, names: ["ESPN", "Disney+"]}]` —
 *  an array of entries, each with an array of names (verified on the wk-1
 *  2026 slate: 98/98 events carried one, 3 of them with two names). Both
 *  levels are flattened, deduped in ESPN's order, and CAPPED AT TWO: this is
 *  a line on a game card, not a distribution list, and the primary network is
 *  the one a reader is looking for. Nothing here → null. */
function parseEventBroadcast(comp: any): string | null {
  const raw = Array.isArray(comp?.broadcasts) ? comp.broadcasts : [];
  const names: string[] = [];
  for (const b of raw) {
    const list = Array.isArray(b?.names) ? b.names : [b?.shortName ?? b?.name];
    for (const n of list) {
      const s = typeof n === "string" ? n.trim() : "";
      if (s && !names.includes(s)) names.push(s);
    }
  }
  return names.length ? names.slice(0, 2).join("/") : null;
}

/** The event's venue → stadium + address, tolerant at every field. A venue
 *  with neither a name nor a city says nothing, so it is null. */
function parseEventVenue(comp: any): LiveVenue | null {
  const v = comp?.venue;
  if (!v || typeof v !== "object") return null;
  const str = (x: any) => (typeof x === "string" ? x.trim() : "");
  const out: LiveVenue = {
    name: str(v.fullName),
    city: str(v.address?.city),
    state: str(v.address?.state),
    country: str(v.address?.country),
  };
  return out.name || out.city ? out : null;
}

/** "Kenan Memorial Stadium · Chapel Hill, NC" — one compact line.
 *  Outside the US there is no state, so the COUNTRY takes that slot
 *  ("Aviva Stadium · Dublin, Ireland"); "USA" is never printed, because on a
 *  college football card it is the assumption, not information. Any missing
 *  piece simply drops out of the join, so the line is always well-formed. */
function venueLine(v: LiveVenue): string {
  const region = v.state || (v.country && v.country !== "USA" ? v.country : "");
  const where = [v.city, region].filter(Boolean).join(", ");
  return [v.name, where].filter(Boolean).join(" · ");
}

/** ESPN's per-event weather block → our shape. Tolerant by construction:
 *  a missing block, a missing field, or a non-numeric one is null/"" and
 *  never a throw — this is an optional garnish on a money screen, and the
 *  block is simply absent for every game more than ~5 days out. */
function parseEventWeather(w: any): LiveWeather | null {
  if (!w || typeof w !== "object") return null;
  const temp = Number(w.temperature ?? w.highTemperature);
  const cond = Number(w.conditionId); // arrives as a string ("4"), verified 20260903
  const text = typeof w.displayValue === "string" ? w.displayValue : "";
  const out: LiveWeather = {
    temp: Number.isFinite(temp) ? Math.round(temp) : null,
    text,
    conditionId: Number.isFinite(cond) ? cond : null,
  };
  return out.temp == null && !out.text ? null : out;
}

/**
 * AccuWeather condition code → one emoji, in COARSE buckets.
 *
 * Source: AccuWeather's public weather-icon table (codes 1–44; 1–32 are the
 * day icons, 33–44 the night ones), which is what ESPN's
 * `event.weather.conditionId` is. Buckets are deliberately coarse — the chip
 * answers "do I need to think about the weather in this game", not which of
 * four flavours of cloud it is. Anything off the table (or a missing id)
 * returns null and the chip renders the temperature alone.
 */
function weatherEmoji(conditionId: number | null): string | null {
  const c = conditionId;
  if (c == null || !Number.isFinite(c)) return null;
  if (c >= 1 && c <= 2) return "☀️";   // sunny / mostly sunny
  if (c >= 3 && c <= 6) return "⛅";   // partly sunny → intermittent clouds
  if (c >= 7 && c <= 10) return "☁️";  // cloudy / overcast / dreary
  if (c === 11) return "🌫️";           // fog
  if (c >= 12 && c <= 14) return "🌧️"; // showers
  if (c >= 15 && c <= 17) return "⛈️"; // thunderstorms
  if (c === 18) return "🌧️";           // rain
  if (c >= 19 && c <= 23) return "🌨️"; // flurries / snow
  if (c >= 24 && c <= 26) return "🧊";  // ice / sleet / freezing rain
  if (c === 29) return "🌨️";           // rain and snow
  if (c === 30) return "🥵";           // hot
  if (c === 31) return "🥶";           // cold
  if (c === 32) return "💨";           // windy
  if (c >= 33 && c <= 34) return "🌙"; // clear / mostly clear (night)
  if (c >= 35 && c <= 38) return "☁️";  // partly → mostly cloudy (night)
  if (c >= 39 && c <= 40) return "🌧️"; // showers (night)
  if (c >= 41 && c <= 42) return "⛈️"; // thunderstorms (night)
  if (c >= 43 && c <= 44) return "🌨️"; // flurries / snow (night)
  return null; // 27/28 and anything future — text only, never a wrong picture
}

/** All the name forms an ESPN team object offers, deduped. */
function nameForms(team: any): string[] {
  const out: string[] = [];
  for (const n of [team?.shortDisplayName, team?.location, team?.displayName]) {
    if (typeof n === "string" && n && !out.includes(n)) out.push(n);
  }
  return out;
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
  /**
   * Page-wide identity: React key, DOM id (`game-<key>`), Kalshi map key and
   * the slate scan's game key all use THIS, not row.slug.
   *
   * FBS keeps the bare slug so every existing join (props_odds.json is keyed
   * by slug) keeps working untouched. FCS cards are prefixed, because the two
   * datasets are indexed independently and nothing guarantees their slug
   * spaces are disjoint. See fcsCardKey().
   */
  key: string;
  /**
   * Dataset namespace this card's files live in ("2026", "fcs-2026"). Every
   * per-card fetch (compact, players, seeds, box score, parlay legs) is keyed
   * by it, which is what lets a merged slate hold cards from both datasets.
   */
  ns: Season;
  division: Division;
  /**
   * From the export's `has_players` flag. FCS publishes game-level sims only,
   * so player panels and prop legs are hidden rather than left to 404.
   */
  hasPlayers: boolean;
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
  /**
   * True only when spread/total/ML results above came from grading a LIVE
   * final (ESPN, `live.state === "final"`) because the dataset had no
   * verified finals yet. Dataset finals (scoreSource CSV_FINALS) are the
   * grading truth (INV-44) — this flag exists so the UI can mark a
   * live-graded badge provisional until the week re-publishes. Absent/false
   * on every other path, including CSV_FINALS.
   */
  resultsProvisional?: boolean;
  /** Canceled/postponed/suspended per the live feed — results above are
   *  pushes (no action), and the record panel must count them as such
   *  rather than pricing the status artifact 0-0. */
  noContest?: boolean;
  scoreSource?: "CSV_FINALS" | "LIVE" | "UPCOMING";
  liveInProgress?: boolean;
  liveStatusText?: string;
  liveA?: number;
  liveB?: number;
  /** The matched ESPN scoreboard event — field strip + gamecast panel key
   *  off it (event id, team ids/abbrevs, live situation). */
  live?: LiveGame;
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
/** Which drill-down a card currently owns. Only one is open page-wide.
 *  "bets" is OWNER-ONLY: its tab and its panel render only while the portal
 *  session is live (see the gate around `ownerBets` below). */
export type PanelKind =
  | "scores" | "players" | "box" | "props" | "picker" | "live" | "teamstats"
  | "bets";

/** Stable empty slate for the suggestions hook: a non-owner must never run
 *  the slate-wide compute, and a fresh `[]` each render would defeat its memo. */
const NO_SUGGEST_GAMES: SuggestGame[] = [];

/** Stable empty card list, for the same memo reason: the "My games" tray is
 *  empty on almost every render and a fresh `[]` would re-render the grid. */
const EMPTY_CARDS: CardGame[] = [];

/**
 * Scroll a card into view and flash it.
 *
 * RE-TRIES ACROSS FRAMES, and that is the whole point of it being a function.
 * Every jump target used to exist already, so one `requestAnimationFrame` was
 * enough to let a panel mount. A target inside a COLLAPSED "My games" tray does
 * not exist yet when the jump starts: the press expands the tray, React commits
 * a whole grid of cards, and only then is there an element with that id. A
 * single frame is usually enough — a few frames always are, and a target that
 * genuinely is not on the board (a filtered-out game) simply gives up silently,
 * exactly as the single-frame version did.
 */
function scrollAndFlash(
  key: string,
  setFlashKey: React.Dispatch<React.SetStateAction<string | null>>,
  tries = 4,
): void {
  requestAnimationFrame(() => {
    const el = document.getElementById(`game-${key}`);
    if (!el) {
      if (tries > 1) scrollAndFlash(key, setFlashKey, tries - 1);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashKey(key);
    window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 1800);
  });
}

/** Must mirror the grid CSS below so the break-out row lands in the right place.
 *  Condensed narrows the track so a 1400px viewport fits 5 columns instead of 4. */
const GRID_MIN: Record<Density, number> = { comfortable: 320, condensed: 250 };
const GRID_MIN_COL = 320;
const GRID_GAP = 16;

/**
 * How many columns a card grid is actually rendering, mirroring
 * `repeat(auto-fit, minmax(320px, 1fr))`. Needed so the break-out panel is
 * inserted after the LAST card of the expanded card's row rather than
 * immediately after the card, which would leave a hole in the row.
 *
 * MEASURED PER GRID, because there are two of them now: the "My games" tray is
 * inset by its own border and padding, so at a handful of window widths it fits
 * one column fewer than the board below it. Sharing the board's count would put
 * the tray's panel one row late at exactly those widths.
 *
 * `active` is the mount signal. The tray's grid is unmounted while the tray is
 * collapsed, so the observer has to be re-attached when it comes back — an
 * effect keyed on `density` alone would never see the new element.
 */
function useGridCols(density: Density, active = true) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCols(gridColumnsFor(el.clientWidth, GRID_MIN[density]));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Density changes the track width, so the column count must be re-measured.
  }, [density, active]);
  return [ref, cols] as const;
}

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

/**
 * THE KICK-TIME TIER. Finals sink; nothing that might still be playing does.
 *
 * A board sorted on kickoff alone puts Saturday's noon finals above Saturday
 * night's kickoffs for the rest of the day, so by evening the live games are
 * buried under games that are over. Sorting by "is it done" first fixes that,
 * and the ORDER of the tiers is the whole design:
 *
 *   0  IN PROGRESS         the only games where something is happening now.
 *   1  KICKED, NOT JOINED  the clock says it has started but the live feed has
 *                          not joined it. It MAY be in progress — many games
 *                          never get an ESPN entry at all (verified 2026-08-28:
 *                          Lafayette/Georgetown has none on the wk0 board), and
 *                          a blocked-espn network has none for anything. Never
 *                          bury a game on the strength of a feed that is
 *                          allowed to be absent.
 *   2  UPCOMING            genuinely pregame, soonest first — the old default.
 *   3  DONE                post / final / graded.
 *
 * The evidence is the same pair the suggestions gate reads: the LIVE JOIN's
 * state, and the clock. A `post`/`final` state or a graded result is positive
 * evidence of doneness and outranks the clock; absence of a join is not
 * evidence of anything, which is exactly why tier 1 exists between them.
 *
 * The EDGE sort keeps its own logic untouched: it answers "where is the biggest
 * mispricing", and a tier applied to it would silently re-rank the answer.
 */
export function kickTier(c: CardGame, now: number): 0 | 1 | 2 | 3 {
  const state = String(c.live?.state || "").toLowerCase();
  if (c.liveInProgress || state === "in") return 0;
  const graded = Boolean(c.spreadResult || c.totalResult || c.mlResult);
  if (state === "post" || state === "final" || c.scoreSource === "CSV_FINALS" || graded) return 3;
  const k = c.kickoffMs;
  if (typeof k === "number" && Number.isFinite(k) && k <= now) return 1;
  return 2;
}

function sortCards(
  cards: CardGame[],
  sortBy: SortBy,
  edges?: Map<string, GameEdges> | null,
  /** The page's ticking clock. Only the kickoff sort reads it — a game crosses
   *  from "upcoming" to "kicked" on its own, without waiting for a feed. */
  now: number = Date.now(),
): CardGame[] {
  const out = [...cards];
  out.sort((x, y) => {
    if (sortBy === "kickoff") {
      const tx = kickTier(x, now);
      const ty = kickTier(y, now);
      if (tx !== ty) return tx - ty;
      const ax = x.kickoffMs ?? Number.POSITIVE_INFINITY;
      const ay = y.kickoffMs ?? Number.POSITIVE_INFINITY;
      if (ax !== ay) return ax - ay;
      return x.teamA.localeCompare(y.teamA);
    }
    // Edge: best SIGNED edge first, matching the Top Edges panel. A game whose
    // only big edge is negative sorts low, not high. Games Kalshi cannot price
    // have no edge at all and sink below even the negative ones.
    const best = (c: CardGame) => {
      const e = edges?.get(c.key)?.bestSigned;
      return typeof e === "number" ? e : Number.NEGATIVE_INFINITY;
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

/* --------------------- division helpers --------------------- */
/**
 * Card key for an FCS game.
 *
 * FBS cards keep their bare slug so every slug-keyed join in the app
 * (props_odds.json, the edge scan, the DOM ids) is untouched by the existence
 * of a second division. FCS gets a prefix because the two datasets are indexed
 * independently: nothing in either contract promises the slug spaces are
 * disjoint, and a silent React-key collision on a merged slate would render
 * one game and drop the other.
 */
const fcsCardKey = (slug: string) => `fcs:${slug}`;

/**
 * Grade the sim's spread/total/ML picks against a pair of final scores.
 *
 * Pure function factored out of `buildJsonCards` so the SAME math grades
 * verified dataset finals (scoreSource CSV_FINALS) and, absent those, a live
 * ESPN final (resultsProvisional) — one grading path, not two that can drift.
 * `finA`/`finB` and `medA`/`medB` must already be in the same A/B orientation
 * as `spread`/`totalLine` (home-perspective, teamA=home).
 */
function gradeAgainstFinals(
  finA: number,
  finB: number,
  teamA: string,
  teamB: string,
  medA: number,
  medB: number,
  spread: number | undefined,
  totalLine: number | undefined,
  mlPickTeam: string | undefined
): {
  spreadResult?: "win" | "loss" | "push";
  totalResult?: "win" | "loss" | "push";
  mlResult?: "win" | "loss" | "push";
} {
  let spreadResult: "win" | "loss" | "push" | undefined;
  let totalResult: "win" | "loss" | "push" | undefined;
  let mlResult: "win" | "loss" | "push" | undefined;

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

  return { spreadResult, totalResult, mlResult };
}

/**
 * Build cards from one dataset's week index + summaries.
 *
 * Lifted out of the page (it was an inline useMemo) so the FBS and FCS slates
 * are built by the SAME code rather than a copy that can drift. The two
 * contracts are identical — teamA=home, margin=home-away, home-perspective
 * odds — which is the whole reason this needed no per-division branching
 * beyond identity and the player flag.
 *
 * summary.json carries headline numbers, not per-seed rows. It publishes the
 * per-team medians directly — which matters, because median(A) + median(B) is
 * not median(total), so recovering points from margin+total would print a
 * score the sim never produced (TCU/UNC: 24-17 exact vs 25-19 derived).
 *
 * spreadProb/totalProb are deliberately left undefined. The exact cover/over
 * rates need the per-seed arrays in compact.json, and pulling one compact per
 * game just to fill the card list would rebuild the ~MB-per-week fetch this
 * layout exists to avoid. A normal approximation off p25/p75 in their place
 * would be inventing a number the sim never produced.
 */
function buildJsonCards(
  jsonGames: JsonGame[],
  division: Division,
  ns: Season,
  getCardLive: (g: { teamA: string; teamB: string }) => {
    lg?: LiveGame; inProgress: boolean;
    aScore?: number; bScore?: number; statusText?: string;
  }
): CardGame[] {
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
    const noContest = Boolean(lg?.noContest) && !hasFinals;

    if (hasFinals) {
      dispFinalA = fA as number;
      dispFinalB = fB as number;
      scoreSource = "CSV_FINALS";
    } else if (!noContest && Number.isFinite(aScore) && Number.isFinite(bScore)) {
      // A canceled game's 0-0 is a status artifact, not a score — never
      // display it as a final.
      dispFinalA = aScore as number;
      dispFinalB = bScore as number;
      scoreSource = "LIVE";
    }

    let spreadResult: "win" | "loss" | "push" | undefined;
    let totalResult: "win" | "loss" | "push" | undefined;
    let mlResult: "win" | "loss" | "push" | undefined;
    let resultsProvisional: boolean | undefined;

    if (hasFinals) {
      // Verified dataset finals — the grading truth (INV-44: never grade off
      // pbp/live scores when the dataset has its own verified column).
      ({ spreadResult, totalResult, mlResult } = gradeAgainstFinals(
        fA as number, fB as number, teamA, teamB, medA, medB, spread, totalLine, mlPickTeam
      ));
    } else if (noContest) {
      // Canceled / postponed / suspended: every market with a pick is a PUSH
      // (no action, stake returned) — grading the 0-0 would hand a side an
      // ATS win and the under a total win it never earned.
      if (Number.isFinite(spread)) spreadResult = "push";
      if (Number.isFinite(totalLine)) totalResult = "push";
      if (typeof mlPickTeam === "string") mlResult = "push";
      resultsProvisional = true;
    } else if (lg?.state === "final" && Number.isFinite(aScore) && Number.isFinite(bScore)) {
      // No dataset finals yet (published pregame) but ESPN already has this
      // game final. Grade off the live score with the identical math so the
      // card's badges light up same-day instead of sitting blank until the
      // week re-publishes; resultsProvisional marks it as such. A mid-game
      // live score (state "in") is deliberately NOT graded here — only a
      // final is a real outcome to grade against.
      ({ spreadResult, totalResult, mlResult } = gradeAgainstFinals(
        aScore as number, bScore as number, teamA, teamB, medA, medB, spread, totalLine, mlPickTeam
      ));
      resultsProvisional = true;
    }

    out.push({
      key: division === "fcs" ? fcsCardKey(row.slug) : row.slug,
      ns,
      division,
      // Absent flag = a pre-flag FBS export, which does publish players.
      hasPlayers: summary.has_players !== false,
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
      resultsProvisional,
      scoreSource,
      liveInProgress: inProgress,
      liveStatusText: statusText ?? lg?.statusText,
      liveA: aScore,
      liveB: bScore,
      live: lg,
      noContest: noContest || undefined,
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

  // --- LIVE scoreboard block: lives BELOW the week-row loads so the ESPN
  // poll can key on the slate's dates (see "LIVE: slate-date scoreboard"). ---

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

  /* ---- Viewer preferences (item 10 + 13). All persist in localStorage,
   * guarded inside usePrefs so a blocked-storage browser just gets defaults. */
  const { resolved: themeResolved, cycle: cycleTheme, mode: themeMode } = useThemeMode();
  const { density, toggle: toggleDensity } = useDensity();
  const condensed = density === "condensed";
  const { division, setDivision } = useDivisionFilter();

  /* ================================ FCS =====================================
   * FCS ships as a separate dataset with an identical layout, addressed by the
   * namespace "fcs-<year>". Three deliberate choices:
   *
   *  1. It is NOT a season. Putting "fcs-2026" in SEASONS would place it in
   *     the season dropdown and let a cold load resolve the whole page onto
   *     it. Division is its own axis, and it travels with each CARD.
   *  2. It reuses the FBS week list. The two exports publish the same week
   *     numbers, so a second season_index fetch would only add a way to fail;
   *     a week the FCS export has not reached simply comes back empty.
   *  3. A missing FCS dataset is EXPECTED, not an error. Until the first
   *     upload every fetch here 404s, and that has to read as a quiet empty
   *     state — never the red banner, and never a broken "Both" view.
   * ========================================================================= */
  /**
   * Whether this season offers FCS at all. It gates the selector too, so a
   * viewer whose stored preference is "fcs" can land on a season that has no
   * FCS dataset with no control on screen to get back — hence showFbs falls
   * back to true here rather than leaving an empty, unrecoverable slate.
   */
  const fcsOffered = fcsAvailableFor(season);
  const showFcs = fcsOffered && division !== "fbs";
  const showFbs = !fcsOffered || division !== "fcs";
  /** Namespace for this season's FCS dataset ("fcs-2026"). */
  const fcsNs = useMemo(() => namespaceFor("fcs", season), [season]);

  const [fcsGames, setFcsGames] = useState<JsonGame[]>([]);
  /** "published" only once rows actually arrive; anything else renders quietly. */
  const [fcsStatus, setFcsStatus] = useState<"idle" | "loading" | "published" | "unpublished">("idle");

  useEffect(() => {
    if (!showFcs || !season || !selectedWeek) {
      setFcsGames([]);
      setFcsStatus("idle");
      return;
    }

    const id = weekOptions.find((w) => w.legacyKey === selectedWeek)?.id ?? selectedWeek;
    const ac = new AbortController();
    let alive = true;
    setFcsStatus("loading");

    (async () => {
      try {
        const rows = await getJsonWeekGames(id, fcsNs, ac.signal);
        if (!alive) return;
        setFcsGames(rows ?? []);
        setFcsStatus(rows?.length ? "published" : "unpublished");
      } catch (e: any) {
        if (e?.name === "AbortError" || !alive) return;
        // Deliberately swallowed: a 404 (or a whole missing dataset) is the
        // pre-publish state. It must never set weekError — that banner would
        // claim the FBS slate is broken, and in "Both" it would hide a
        // perfectly good FBS week behind an FCS non-event.
        setFcsGames([]);
        setFcsStatus("unpublished");
      }
    })();

    return () => { alive = false; ac.abort(); };
  }, [showFcs, season, fcsNs, selectedWeek, weekOptions]);

  /* ---- LIVE: slate-date scoreboard (browser-direct ESPN) ----
   *
   * The poll asks for the SLATE's kick dates (every loaded row: FBS JSON,
   * FCS JSON, legacy CSV meta), NOT the wall-clock date. ESPN serves any
   * past date's scoreboard indefinitely, so a finished slate keeps its
   * finals, provisional grading, and gamecast panels the morning after —
   * polling "today" made all of it vanish at midnight ET (2026-08-28
   * incident). todayET is only the fallback while no rows have loaded.
   * The hook keys on the joined date STRING, so this memo's array identity
   * churn never re-triggers the poll (AGENT_BRIEF rule 4). */
  const todayET = useMemo(
    () =>
      new Date()
        .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
        .replace(/-/g, ""),
    []
  );

  const slateDates = useMemo(() => {
    const days = new Set<string>();
    const add = (ms?: number) => {
      if (!Number.isFinite(ms)) return;
      days.add(
        new Date(ms as number)
          .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
          .replace(/-/g, "")
      );
    };
    for (const { row } of jsonGames) add(parseKickoffMs(row.date, undefined, row.time_utc).ms);
    for (const { row } of fcsGames) add(parseKickoffMs(row.date, undefined, row.time_utc).ms);
    for (const m of Object.values(meta)) add(m.kickoffMs);
    return days.size ? [...days].sort() : [todayET];
  }, [jsonGames, fcsGames, meta, todayET]);

  // Third argument = which season dataset carries the published ESPN
  // snapshots (the espn.com-blocked-network fallback). FCS games ride along:
  // the snapshot files hold the merged 80+81 scoreboard.
  const livePayload = useLiveScoreboard(slateDates, "cfb", season || SEASONS[0]);

  // normalize and index the live games
  const liveGames: LiveGame[] = useMemo(
    () => (livePayload ? mapEspnToLiveGames(livePayload) : []),
    [livePayload]
  );

  const liveMap = useMemo(() => {
    // One key per cross-combination of each side's name forms: ESPN's short
    // names ("ETSU", "LIU", "SE Missouri State") joined only 27 of 46 FCS
    // week-0 sim games; short+location+displayName joined all 46. First
    // writer wins — school-name forms don't collide across real games.
    const m = new Map<string, LiveGame>();
    for (const g of liveGames) {
      const homes = g.homeNames?.length ? g.homeNames : [g.homeTeam ?? ""];
      const aways = g.awayNames?.length ? g.awayNames : [g.awayTeam ?? ""];
      for (const h of homes) {
        for (const a of aways) {
          const k = pairKey(a, h);
          if (!m.has(k)) m.set(k, g);
        }
      }
    }
    return m;
  }, [liveGames]);

  const getCardLive = useCallback(
    (game: { teamA: string; teamB: string }) => {
      const lg = liveMap.get(pairKey(game.teamA, game.teamB));
      const inProgress = lg?.state === "in";
      let aScore: number | undefined, bScore: number | undefined;
      if (lg) {
        const aMatchesAway = nameMatches(lg.awayNames, lg.awayTeam, game.teamA);
        aScore = aMatchesAway ? lg.awayScore : lg.homeScore;
        bScore = aMatchesAway ? lg.homeScore : lg.awayScore;
      }
      return { lg, inProgress, aScore, bScore, statusText: lg?.statusText };
    },
    [liveMap]
  );

  /* ---- Expanded panel. Lifted out of the card so the panel can render as a
   * separate full-width grid item: a card must never change size because
   * something inside it opened. ---- */
  const [openPanel, setOpenPanel] = useState<{ key: string; kind: PanelKind } | null>(null);

  /**
   * A pre-focus payload for the panel that is about to open, sent by "See
   * projection →" on a suggested bet. It carries THE VALUE BEING PRICED, not
   * just which chart: a team-stat target names its strike (so the Team Stats
   * chart can highlight that one flag out of eleven) and a scores target names
   * its metric and line (so the scores panel opens on the right tab with the
   * marker already on the number). It also carries the originating ladder's
   * id, which is what lets the projection panel offer a place strip for that
   * exact bet.
   *
   * CLEARED on every other panel change, so it can never leak into a panel
   * that was opened for some other reason — and with it goes the place strip.
   */
  const [panelFocus, setPanelFocus] = useState<ProjectionTarget | null>(null);

  const togglePanel = useCallback((key: string, kind: PanelKind) => {
    setPanelFocus(null);
    setOpenPanel((prev) => (prev && prev.key === key && prev.kind === kind ? null : { key, kind }));
  }, []);

  const closePanel = useCallback(() => {
    setPanelFocus(null);
    setOpenPanel(null);
  }, []);

  /** Swap the OPEN card's panel for the chart a suggestion came from. Getting
   *  back is the "Bets" tab still sitting on the card above the panel. */
  const focusPanel = useCallback((
    key: string, kind: PanelKind, focus: ProjectionTarget | null,
  ) => {
    setPanelFocus(focus);
    setOpenPanel({ key, kind });
  }, []);

  const [gridRef, gridCols] = useGridCols(density);

  /* ---- Slate-wide edges (item 3 + 4). Opt-in: the cards load their own
   * compacts lazily, so this only runs when the Edge sort or the Top Edges
   * panel actually needs the whole slate. Everything goes through the same
   * caches, so already-visible games cost nothing.
   * The scan itself lives in useSlateEdges — see that file for why it must
   * not be wired inline here. ---- */
  const [showTopEdges, setShowTopEdges] = useState(false);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  /* ---- Parlay slip. Lives at page level so it survives week/season switches;
   * each leg carries its own game/season identity. ---- */
  const [parlayOpen, setParlayOpen] = useState(false);
  const [slipHeight, setSlipHeight] = useState(0);
  const [legs, setLegs] = useState<Leg[]>([]);
  /** Briefly highlights one slip row — a fresh add, or the existing row a
   *  duplicate quick-add resolved to. See addLegFromTopEdges below. */
  const [flashLegId, setFlashLegId] = useState<string | null>(null);

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

  /**
   * Open/close market lines for the slate tally's betting-record panel, one
   * file per week (weeks/<weekId>/lines.json), one per DIVISION: the FBS
   * namespace carries sportsbook consensus (Bovada/DK/Pinnacle), the FCS
   * namespace carries Kalshi-derived lines (winner mids as ML, at-the-money
   * rungs as spread/total). Either resolving to null is quiet and expected
   * (pre-publish, or the division has no dataset); the tally falls back to
   * the plain record only when BOTH are null.
   */
  const weekLines = useWeekLines(season, weekId);
  const weekLinesFcs = useWeekLines(fcsOffered ? fcsNs : null, weekId);

  /* ---- Kalshi market data for this week (slim side-by-side on each card) ----
   * Server-cached 45s and mapped to our slugs there; the row simply does not
   * render when the feed is unavailable or a game is not listed. */
  const [kalshiBySlug, setKalshiBySlug] = useState<Map<string, KalshiGame>>(new Map());
  /** Primitive that changes with the Kalshi payload, for the scan signature. */
  const [kalshiStamp, setKalshiStamp] = useState("");
  /** Kalshi's own per-series fee params, forwarded by the proxy. */
  const [kalshiFees, setKalshiFees] = useState<Record<string, FeeParams>>({});

  /* ---- My-Kalshi portal: the owner's resting orders + fills ----
   * Token-gated server route; polls only while a token is stored. Games the
   * owner has money on get a book strip on their card and pin to the top of
   * the collection. The poll effect lives in usePortalBook and depends only
   * on the token string (render-loop rule 1). */
  const [portalToken, setPortalToken] = useState<string>(() => readPortalToken());
  const [portalUiOpen, setPortalUiOpen] = useState(false);
  const portal = usePortalBook(portalToken);
  /**
   * THE OWNER GATE, one definition. A live portal session — everything
   * owner-only reads this: the suggestions compute, the resting review, the
   * per-card Bets tab, and the "My games" tray.
   *
   * Declared HERE, up with the token it is derived from, because consumers now
   * appear on both sides of the card memos (the tray's membership is computed
   * with the cards, the panels are composed below them). A `const` read before
   * its declaration in the same function body is a temporal-dead-zone crash,
   * not a hoist.
   */
  const ownerOn = Boolean(portalToken) && portal.status === "ok";
  /** Dollars of risk per ladder. One knob, every sizing site (suggestion
   *  counts, outlay, the Place slip). Clamped on read AND on write. */
  const [unit, setUnit] = useState<number>(() => readUnit());

  /* ---- Suggested-bets view state, PAGE LEVEL ----
   * The ranked index, every card's "Bets" badge and the per-game panel all
   * read ONE compute under ONE set of filters (see lib/useSuggestions.ts). A
   * filter owned by a panel would make the badge above it lie, so the state
   * lives here and the panels only report a press. Persistence (ownerPrefs)
   * happens in these setters — one place writes. */
  const [suggestNonce, setSuggestNonce] = useState(0);
  const [betMode, setBetMode] = useState<ModeFilter>(() => readModeFilter());
  const [betType, setBetType] = useState<BetTypeFilter>(() => readTypeFilter());
  const [betTails, setBetTails] = useState<boolean>(() => readShowTails());
  const [betSort, setBetSort] = useState<SuggestSort>(() => readSuggestSort());
  const onBetMode = useCallback((v: ModeFilter) => { setBetMode(v); writeModeFilter(v); }, []);
  const onBetType = useCallback((v: BetTypeFilter) => { setBetType(v); writeTypeFilter(v); }, []);
  const onBetTails = useCallback((v: boolean) => { setBetTails(v); writeShowTails(v); }, []);
  const onBetSort = useCallback((v: SuggestSort) => { setBetSort(v); writeSuggestSort(v); }, []);
  /** The "My games" tray: expanded or one header line. Persisted per browser. */
  const [myGamesOpen, setMyGamesOpen] = useState<boolean>(() => readMyGamesOpen());
  const onMyGamesOpen = useCallback((v: boolean) => { setMyGamesOpen(v); writeMyGamesOpen(v); }, []);
  const clearBetFilters = useCallback(() => { onBetMode("all"); onBetType("all"); }, [onBetMode, onBetType]);
  /** slug -> compact seed arrays for the games the owner has bets on, so
   *  sim EV can be priced at the bets' own strikes. Filled by an effect
   *  keyed on a primitive signature (render-loop rule 1). */
  const [portalSeeds, setPortalSeeds] = useState<Map<string, SeedPair>>(new Map());

  useEffect(() => {
    if (!season || !selectedWeek) { setKalshiBySlug(new Map()); setKalshiStamp(""); return; }
    const weekId =
      weekOptions.find((w) => w.legacyKey === selectedWeek)?.id ?? selectedWeek;

    const ac = new AbortController();
    let alive = true;
    (async () => {
      try {
        // One request per namespace the slate is showing. The server matches
        // Kalshi events to whichever dataset it is asked about, so the FCS
        // call needs no client-side name handling — see server/cfbNames.ts.
        const [fbsPayload, fcsPayload] = await Promise.all([
          showFbs ? getKalshiCfb(season, weekId, ac.signal) : null,
          showFcs ? getKalshiCfb(fcsNs, weekId, ac.signal) : null,
        ]);
        if (!alive) return;

        // Merged under the CARD keys, which is what every consumer looks up
        // with. FCS entries are re-keyed to match their prefixed cards.
        const merged = new Map<string, KalshiGame>();
        if (fbsPayload) for (const [k, v] of indexKalshiBySlug(fbsPayload)) merged.set(k, v);
        if (fcsPayload) for (const [k, v] of indexKalshiBySlug(fcsPayload)) merged.set(fcsCardKey(k), v);

        setKalshiBySlug(merged);
        // Fee params are exchange-level, identical across namespaces.
        setKalshiFees((fbsPayload?.fee_params ?? fcsPayload?.fee_params ?? {}) as Record<string, FeeParams>);
        // Primitive stamp for the scan signature — must move whenever either
        // feed does, or a refreshed FCS payload would not retrigger the scan.
        setKalshiStamp(
          `${fbsPayload?.updated ?? ""}|${fbsPayload?.games.length ?? 0}` +
          `#${fcsPayload?.updated ?? ""}|${fcsPayload?.games.length ?? 0}`
        );
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (alive) { setKalshiBySlug(new Map()); setKalshiStamp(""); setKalshiFees({}); }
      }
    })();
    return () => { alive = false; ac.abort(); };
  }, [season, selectedWeek, weekOptions, showFbs, showFcs, fcsNs]);

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
        // Legacy CSV seasons are FBS-only and predate the division split; they
        // read from the page's own season namespace.
        ns: season,
        division: "fbs",
        hasPlayers: true,
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
        live: lg,
      });
    }

    return out;
  }, [games, meta, getCardLive, selectedWeek, season]);

  /* ---------- cards, JSON datasets (one summary.json per game) ----------
   *
   * One call per dataset, same builder. FBS and FCS publish an identical
   * contract, so the only thing that differs is which namespace the files
   * come from and the card identity (see buildJsonCards / fcsCardKey).
   */
  const cardsJson: CardGame[] = useMemo(
    () => buildJsonCards(jsonGames, "fbs", season, getCardLive),
    [jsonGames, season, getCardLive]
  );

  const cardsFcs: CardGame[] = useMemo(
    () => buildJsonCards(fcsGames, "fcs", fcsNs, getCardLive),
    [fcsGames, fcsNs, getCardLive]
  );

  /**
   * Unsorted slate. The scan reads THIS; only the display list is sorted.
   *
   * FBS half: whichever path produced rows for this week. Both cannot be
   * populated at once — the loader clears one before filling the other.
   *
   * FCS half is simply concatenated. "Both" is a MERGE, not a second list, so
   * every downstream feature (sort, conference filter, edge scan, Top Edges
   * ranking, parlay slip) treats the two divisions as one slate for free. When
   * FCS is unpublished cardsFcs is empty and "Both" degrades to exactly the
   * FBS view, with no branch anywhere to keep in sync.
   */
  const baseCards = useMemo(() => {
    const fbsCards = showFbs ? (cardsJson.length ? cardsJson : cards2025) : [];
    return showFcs ? [...fbsCards, ...cardsFcs] : fbsCards;
  }, [showFbs, showFcs, cardsJson, cards2025, cardsFcs]);

  /**
   * Quick-add a leg straight from a Top Edges row: build the Leg exactly the
   * way LegPicker would for the same bet (same id shape — slug:JSON(spec) —
   * so a row here and its "equivalent" leg added by hand through LegPicker
   * dedupe to the SAME slip row), push it, open the drawer, and flash it.
   * Never scrolls — that stays on the row body's onPick.
   */
  const addLegFromTopEdges = useCallback((slug: string, spec: LegSpec) => {
    const card = baseCards.find((c) => c.key === slug);
    if (!card?.jsonRow) return;
    const id = `${card.jsonRow.slug}:${JSON.stringify(spec)}`;
    setParlayOpen(true);
    setLegs((prev) => {
      if (prev.some((l) => l.id === id)) return prev; // dedupe: no-op
      const leg: Leg = {
        // The leg's own namespace, not the page's: on a merged slate an FCS
        // leg must keep fetching its seeds from the FCS dataset even after
        // the viewer switches back to FBS-only.
        id, season: card.ns, weekId, slug: card.jsonRow!.slug,
        teamA: card.teamA, teamB: card.teamB, row: card.jsonRow!,
        spec, label: legLabel(spec, card.teamA, card.teamB),
      };
      return [...prev, leg];
    });
    setFlashLegId(id);
    window.setTimeout(() => setFlashLegId((k) => (k === id ? null : k)), 1800);
  }, [baseCards, weekId]);

  /**
   * Inputs for the slate scan.
   *
   * Derived from the UNSORTED card list on purpose. `cards` below is sorted
   * with `slateEdges`, so deriving the scan's inputs from it made the scan
   * depend on its own output — the cycle that froze the tab.
   *
   * On a merged slate this list spans both datasets: each input carries its
   * own namespace so the scan fetches each game's compact from the right
   * repo. Games with no book line and no Kalshi listing produce no priced
   * rows and drop out of the ranking (they are never ranked as NaN).
   */
  const edgeInputs: EdgeInput[] = useMemo(
    () => baseCards.filter((c) => c.jsonRow).map((c) => ({
      slug: c.key, teamA: c.teamA, teamB: c.teamB, row: c.jsonRow!,
      season: c.ns, division: c.division,
      bookSpread: c.oddsSpread, bookTotal: c.oddsTotal,
      simMargin: useMean ? c.simMeanMargin : c.simMedMargin,
      simTotal: useMean ? c.simMeanTotal : c.simMedTotal,
      pHome: c.pHome, kickoffMs: c.kickoffMs,
    })),
    [baseCards, useMean]
  );

  const { scan: slateScan, loading: edgesLoading } = useSlateEdges({
    inputs: edgeInputs,
    kalshiBySlug,
    kalshiStamp,
    // Scan-level namespace, used for the WEEK-level props file only. On an
    // FCS-only slate that file does not exist, which the scan reports as
    // "props not published" rather than an error. Per-game files use each
    // input's own `season`.
    season: showFbs ? season : fcsNs,
    // Must stay the bare week directory — it IS the props_odds.json path.
    // The division does not need folding in here: FCS cards carry prefixed
    // slugs, so a division change already moves the scan's slug signature.
    weekKey: weekId,
    useMean,
    enabled: sortBy === "edge" || showTopEdges,
  });

  /**
   * Card sort key. Game markets ONLY — prop edges are deliberately kept out of
   * the card ordering this phase, so a game does not climb the slate on the
   * strength of a single player line.
   */
  const slateEdges = slateScan?.byGame ?? null;

  /* ---- portal bet metrics (needs baseCards, so it lives here) ---- */
  const portalSeedRows = useMemo(() => {
    if (!portal.payload) return [] as { slug: string; row: JsonWeekRow; ns: Season }[];
    const c2s = buildCodeToSlug(kalshiBySlug);
    const slugs = new Set<string>();
    const add = (tk: string) => {
      const t = parseNcaafTicker(tk);
      const sl = t && c2s.get(t.code);
      if (sl) slugs.add(sl);
    };
    for (const e of [...portal.payload.orders, ...portal.payload.positions]) {
      (e.legs?.length ? e.legs.map((l) => l.market_ticker) : [e.ticker]).forEach(add);
    }
    return baseCards
      .filter((c) => slugs.has(c.key) && c.jsonRow)
      .map((c) => ({ slug: c.key, row: c.jsonRow!, ns: c.ns }));
  }, [portal.payload, kalshiBySlug, baseCards]);
  const portalSeedSig = useMemo(
    () => portalSeedRows.map((r) => r.slug).sort().join("|"),
    [portalSeedRows]
  );
  const portalSeedRowsRef = useRef(portalSeedRows);
  portalSeedRowsRef.current = portalSeedRows;
  useEffect(() => {
    if (!portalSeedSig) { setPortalSeeds(new Map()); return; }
    let alive = true;
    (async () => {
      const m = new Map<string, SeedPair>();
      for (const r of portalSeedRowsRef.current) {
        try {
          const c = await getCompactCached(r.row, r.ns);
          m.set(r.slug, { A: c.A_pts, B: c.B_pts });
        } catch { /* that card prices Kalshi EV only */ }
      }
      if (alive) setPortalSeeds(m);
    })();
    return () => { alive = false; };
  }, [portalSeedSig]);

  /** Published team_stats for every namespace on the board. ONE loader for
   *  the page: the portal prices HELD stat positions off these rungs and the
   *  Suggested bets card prices LIVE quotes off the same documents. Deps are
   *  primitives (render-loop rule 1). */
  const statNamespaces = useMemo(
    () => Array.from(new Set(baseCards.map((c) => String(c.ns)))).sort().join(","),
    [baseCards]
  );
  const teamStatsDocs = useTeamStatsDocs(statNamespaces, weekId);
  /** ticker -> P(YES) for the per-team stat ladders. The seed arrays cannot
   *  price these at all, which is why every held rec-yards position read
   *  "Sim EV —" until 2026-08-28. */
  /** What both published-rung pricers need to know about each game on the
   *  board. One list: the two pricers differ in which block they read, never
   *  in which games they are asked about. */
  const statGameRefs = useMemo(
    () => baseCards.map((c) => ({
      key: c.key, slug: c.jsonRow?.slug ?? c.key, ns: c.ns,
      teamA: c.teamA, teamB: c.teamB,
    })),
    [baseCards]
  );
  const statYesP = useMemo(
    () => buildStatYesP(teamStatsDocs, statGameRefs, kalshiBySlug),
    [teamStatsDocs, statGameRefs, kalshiBySlug]
  );
  /** ticker -> P(YES) for the three GAME-LINE families off the published game
   *  block. Without it a total/spread/winner ticker prices to null wherever the
   *  seed arrays are not loaded — which is most of the board, and ALL of FCS
   *  (no compacts published), so the resting review had no verdict to give on
   *  a book made of game totals. */
  const gameYesP = useMemo(
    () => buildGameYesP(teamStatsDocs, statGameRefs, kalshiBySlug),
    [teamStatsDocs, statGameRefs, kalshiBySlug]
  );

  const portalBook = useMemo(
    () => computePortalBets(portal.payload, kalshiBySlug, portalSeeds, statYesP, gameYesP),
    [portal.payload, kalshiBySlug, portalSeeds, statYesP, gameYesP]
  );
  /** The REALISED record on the games this board is showing — the owner's
   *  settled Kalshi markets. Joined code-first (the live book's
   *  `buildCodeToSlug` map), then by the server-attached event TITLE against
   *  these cards — a settled event leaves the status=open feed, so code-only
   *  classified every finished game off-slate and hid the block (found live
   *  2026-08-28). Settlements from other weeks are still excluded, not
   *  summed. */
  // baseCards, not the sorted/filtered list: the record's scope is the SLATE
  // (matching kalshiBySlug), and baseCards is declared above this memo.
  const slatePairs = useMemo(() => buildSlatePairs(baseCards), [baseCards]);
  const portalRecord = useMemo(
    () => computeSettlementRecord(portal.settlements, kalshiBySlug, slatePairs),
    [portal.settlements, kalshiBySlug, slatePairs]
  );
  /** slug -> the card's real team names — a second view of the same
   *  `baseCards` list `slatePairs` above already reads, just keyed by slug
   *  instead of pairKey. What lets the settled record's expanded rows show
   *  real names and logos instead of the ticker's letter code (2026-08-29
   *  ask): no new data fetching, this is display-only. */
  const slugTeams = useMemo(
    () => new Map(baseCards.map((c) => [c.key, { teamA: c.teamA, teamB: c.teamB }])),
    [baseCards]
  );
  /** ticker -> P(YES) of the RAW market: seeds for the game lines, published
   *  rungs for the per-team stat ladders. Literally the function the held
   *  positions above are priced with (`buildPortalYesP`), handed to the
   *  resting-order review so the two can never disagree about what a market
   *  is worth. */
  const portalYesP = useMemo(
    () => buildPortalYesP(kalshiBySlug, portalSeeds, statYesP, gameYesP),
    [kalshiBySlug, portalSeeds, statYesP, gameYesP]
  );
  const portalNote = useMemo(() => {
    if (!portalToken) return "log in with your portal password";
    switch (portal.status) {
      case "unauthorized": return "wrong password — log in again";
      case "locked": return "too many attempts — wait a minute";
      case "unconfigured": return "server portal not configured";
      case "error": return "portal unreachable — will retry";
      case "loading": return "connecting…";
      default: {
        const g = portalBook.bySlug.size;
        return `${portalBook.totals.n} bets · ${g} game${g === 1 ? "" : "s"} on this board`
          + (portalBook.unmatched ? ` · ${portalBook.unmatched} off-slate` : "");
      }
    }
  }, [portalToken, portal.status, portalBook]);

  /**
   * A TICKING WALL CLOCK — for every rule that is a function of "how long until
   * kickoff": the card ORDER's kick tier, the suggestions' pregame gate, the
   * maker/taker timing bands and the resting-order review.
   *
   * It must MOVE on its own. Before this, `Date.now()` was read inside the
   * `suggestGames` memo, which meant the clock only advanced when `baseCards`
   * changed identity — i.e. when the ESPN live poll delivered. That is a real
   * dependency on a feed that is allowed to fail: `useLiveScoreboard` only calls
   * `setPayload` when a tier ANSWERS, so on a network that blocks espn.com with
   * no published snapshot (or after every event goes final and the poll stops),
   * the memo's `now` freezes at page load and a game never drops off the card no
   * matter how long the tab stays open.
   *
   * 30s is chosen against the 5-minute pregame buffer: worst case a game leaves
   * the card 30s later than its exact instant, still ~4.5 min before kickoff.
   * No cycle to worry about — an interval that sets a NUMBER, with no
   * dependency on anything it sets (the loop the render guard exists to prevent
   * needs an effect whose deps its own setState recreates).
   *
   * Declared HERE, above the card sort, because the sort now reads it: a
   * `const` used before its declaration in the same function body is a
   * temporal-dead-zone crash, not a hoist.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const desiredCards = useMemo(() => {
    // `nowMs`, not Date.now(): the kick tier has to move with the clock, or a
    // game that kicks off while the tab sits open never leaves the pregame
    // block (the same frozen-clock bug the suggestions gate had).
    // No portal partition here any more. This used to pin games with a portal
    // entry to the top; the "My games" tray now LIFTS every one of those cards
    // out of this list entirely (membership is `portalBook.bySlug` minus what
    // the conference filter removed — see `myGames`), so the pin could only
    // ever reorder cards that were about to be moved anyway. Two mechanisms
    // for one intent, and the survivor is the one the reader can see.
    return sortCards(baseCards, sortBy, slateEdges, nowMs);
  }, [baseCards, sortBy, slateEdges, nowMs]);

  /* DEFERRED RE-SORT (CLS, 2026-08-29). The sort above says where cards
   * BELONG; this block decides when the grid is allowed to MOVE them.
   *
   * Cloudflare RUM had 60% of visits scoring CLS "poor", and the largest
   * single contributor is this grid re-ordering itself while someone is
   * reading it: every 30s clock tick or feed refresh that flips one game's
   * kick tier (pregame → live → final) used to jump whole rows of cards under
   * the reader — and, on the owner console, under a finger headed for a money
   * button. Layout-shift scoring EXEMPTS moves within 500ms of user input and
   * cannot see moves made while the tab is hidden, so the rule is:
   *
   *   adopt the new order immediately when (a) the card SET changed — cards
   *   appearing/disappearing is population, there is no stable layout to
   *   preserve; (b) the user changed the sort — that IS input; or (c) the
   *   tab is hidden. Otherwise keep rendering the ORDER we already show
   *   (with every card's live data still updating in place) and adopt the
   *   pending order the moment the tab next goes hidden.
   *
   * Freshness is untouched — scores, badges and edges update in the card
   * where it sits. Only the card's POSITION waits for a moment nobody is
   * watching. Signatures are primitive strings and the effects key on them
   * (rule 4). */
  const desiredOrderSig = useMemo(
    () => desiredCards.map((c) => c.key).join("|"),
    [desiredCards]
  );
  const desiredSetSig = useMemo(
    () => desiredCards.map((c) => c.key).sort().join("|"),
    [desiredCards]
  );
  const [appliedOrder, setAppliedOrder] = useState<string | null>(null);
  const appliedMetaRef = useRef<{ setSig: string; sortBy: SortBy } | null>(null);
  const pendingOrderRef = useRef<string | null>(null);

  useEffect(() => {
    const meta = appliedMetaRef.current;
    const adoptNow =
      appliedOrder === null ||
      meta === null ||
      meta.setSig !== desiredSetSig ||
      meta.sortBy !== sortBy ||
      document.hidden;
    if (adoptNow) {
      appliedMetaRef.current = { setSig: desiredSetSig, sortBy };
      pendingOrderRef.current = null;
      setAppliedOrder((cur) => (cur === desiredOrderSig ? cur : desiredOrderSig));
    } else {
      pendingOrderRef.current = desiredOrderSig === appliedOrder ? null : desiredOrderSig;
    }
  }, [desiredOrderSig, desiredSetSig, sortBy, appliedOrder]);

  useEffect(() => {
    const flush = () => {
      if (!document.hidden || pendingOrderRef.current === null) return;
      const next = pendingOrderRef.current;
      pendingOrderRef.current = null;
      setAppliedOrder(next);
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  const cards = useMemo(() => {
    if (appliedOrder === null) return desiredCards;
    const byKey = new Map(desiredCards.map((c) => [c.key, c]));
    const out: CardGame[] = [];
    for (const k of appliedOrder.split("|")) {
      const c = byKey.get(k);
      if (c) { out.push(c); byKey.delete(k); }
    }
    // Never drop a card the order string has not caught up with: anything
    // unlisted appends in desired order until the set-change adoption above
    // lands (same render, in practice).
    for (const c of desiredCards) if (byKey.has(c.key)) out.push(c);
    return out;
  }, [appliedOrder, desiredCards]);


  // Apply conference filter (game shows if either team is in selected conference)
  const filteredCards = useMemo(() => {
    if (confFilter === "all") return cards;
    return cards.filter(c => (confOf(c.teamA) === confFilter) || (confOf(c.teamB) === confFilter));
  }, [cards, confFilter, teamToConf]);

  /**
   * THE "MY GAMES" MEMBERSHIP — which cards the owner already has skin in.
   *
   * A game qualifies on EXPOSURE, full stop: a HELD position, or ANY resting
   * order on the account. Not just the ones this app placed — the tray answers
   * "which games do I have something live on", and the maker pipeline's rest
   * and a hand-placed order are exactly as live as ours. Tagging is a routing
   * detail (`app` still gates what the resting-order REVIEW offers to act on);
   * it is not a fact about whether money is out there.
   *
   * The ticker -> card join is the one that already exists: `computePortalBets`
   * runs every entry's ticker through `buildCodeToSlug(kalshiBySlug)` (the event
   * code embedded in every NCAAF ticker), so `portalBook.bets[].slugs` is
   * already card keys. Nothing new is fetched and nothing new is parsed.
   *
   * Counted over BETS, not over the by-slug index: a combo appears on every
   * leg's card, and counting the index would report one 3-leg combo as three
   * resting orders. Off-slate entries (and games a conference filter has
   * removed) contribute nothing, so the header's counts always describe exactly
   * the cards inside the tray.
   */
  const myGames = useMemo(() => {
    const keys = new Set<string>();
    let held = 0;
    let resting = 0;
    if (!ownerOn) return { keys, held, resting };
    const onBoard = new Set(filteredCards.map((c) => c.key));
    for (const b of portalBook.bets) {
      const hits = b.slugs.filter((s) => onBoard.has(s));
      if (!hits.length) continue;
      for (const s of hits) keys.add(s);
      if (b.kind === "position") held++;
      else resting++;
    }
    return { keys, held, resting };
  }, [ownerOn, portalBook, filteredCards]);

  /** The two halves of the board. A card is in EXACTLY one of them — the tray
   *  renders its members in both of its own states, so the main grid never
   *  holds a game the owner has money on. Both keep `filteredCards`' order,
   *  which is the kick-tier sort. */
  const trayCards = useMemo(
    () => (myGames.keys.size ? filteredCards.filter((c) => myGames.keys.has(c.key)) : EMPTY_CARDS),
    [filteredCards, myGames]
  );
  const mainCards = useMemo(
    () => (myGames.keys.size ? filteredCards.filter((c) => !myGames.keys.has(c.key)) : filteredCards),
    [filteredCards, myGames]
  );
  /** The tray's own column count — see `useGridCols`. */
  const [trayGridRef, trayCols] = useGridCols(density, myGamesOpen && trayCards.length > 0);

  /**
   * Scroll to a game's card and flash it — from the Top Edges list, and from
   * the suggested-bets index (which also asks for the "bets" panel).
   *
   * ORDER MATTERS: the panel is set FIRST and the scroll waits a frame.
   * Opening a panel inserts a full-width grid item, which reflows the grid;
   * scrolling before that lands on wherever the card used to be. The tray is
   * the same rule one level up: a target inside a COLLAPSED tray has no element
   * to scroll to at all, so the tray is opened first and the scroll waits for
   * the cards to mount (`scrollAndFlash` re-tries across a few frames — a tray
   * expansion mounts a whole grid, not one panel).
   */
  const jumpToGame = useCallback((slug: string, kind?: PanelKind) => {
    setShowTopEdges(false);
    if (kind) {
      setPanelFocus(null);
      setOpenPanel({ key: slug, kind });
    }
    if (myGames.keys.has(slug)) onMyGamesOpen(true);
    scrollAndFlash(slug, setFlashKey);
  }, [myGames, onMyGamesOpen]);

  /** Human week label for the card header (replaces the hardcoded "week"). */
  const weekLabel = useMemo(
    () => weekOptions.find((w) => w.legacyKey === selectedWeek)?.label ?? selectedWeek,
    [weekOptions, selectedWeek]
  );

  /** Index of the expanded card in the filtered list, and the card itself. */
  /* Games offered to the owner-only Suggested Bets card.
   *
   * PREGAME IS A CORRECTNESS RULE: our sim fairs are pregame distributions, so
   * a live or finished game must never produce a suggestion. The rule itself
   * lives in `pregameVerdict` (suggestedBets.ts) so it is stated once, in
   * words, next to the reasoning; this memo's job is only to hand over the two
   * SIGNALS it judges, unmixed:
   *
   *   started   — the FEED's verdict alone. It deliberately no longer ORs in a
   *               kick-time test: the clock is the gate's own second signal,
   *               and folding it in here made "which one fired?" unanswerable
   *               and hid the fact that the clock was not moving.
   *   liveState — ESPN's raw state, or undefined where the feed never joined
   *               this game (common: Lafayette/Georgetown has no ESPN entry at
   *               all on the wk0 board).
   *
   * Kickoff comes along for the ride: it is the "Soonest" sort key, the gate's
   * clock leg, AND the timing band that sets each row's take/rest bar.
   *
   * Derived from baseCards (never the sorted/filtered list) so a UI filter
   * cannot silently shrink the book, and so it stays clear of the memo cycle
   * the render-loop guard exists to prevent.
   */
  const suggestGames: SuggestGame[] = useMemo(() => {
    return baseCards.map((c) => ({
      key: c.key,
      slug: c.jsonRow?.slug ?? c.key,
      ns: c.ns,
      teamA: c.teamA,
      teamB: c.teamB,
      kickoffMs: typeof c.kickoffMs === "number" ? c.kickoffMs : undefined,
      liveState: c.live?.state,
      started:
        Boolean(c.liveInProgress) ||
        c.live?.state === "in" ||
        c.live?.state === "final" ||
        c.live?.state === "post" ||
        c.scoreSource === "CSV_FINALS",
    }));
  }, [baseCards]);

  /**
   * THE ONE SUGGESTIONS COMPUTE.
   *
   * Called once, here, and read by three surfaces: the ranked index in the My
   * Book console, every card's "Bets" tab badge, and the per-game bets panel.
   * Two copies of this memo would be two answers to the same question.
   *
   * OWNER GATE: without a live portal session it is handed an EMPTY, stable
   * game list, so the slate-wide compute never runs for a viewer who has no
   * bets UI to show. Same gate (`ownerOn`, declared with the portal token) as
   * the index, the tray and the panel below.
   */
  const suggestions = useSuggestions({
    games: ownerOn ? suggestGames : NO_SUGGEST_GAMES,
    kalshiBySlug,
    feeParams: kalshiFees,
    portal: portal.payload,
    docs: teamStatsDocs,
    unit,
    nowMs,
    nonce: suggestNonce,
    modeFilter: betMode,
    typeFilter: betType,
    showTails: betTails,
    sort: betSort,
  });

  /**
   * THE RESTING-ORDER REVIEW — the other half of the same clock.
   *
   * `useSuggestions` deliberately excludes every ticker the account already
   * holds or has resting, which is why the app went silent about a market the
   * moment an order rested on it. This is the compute that speaks for those:
   * same games, same 30s clock, same timing bands, same pricing function the
   * portal's held positions use. Owner-gated identically — no portal session,
   * no orders to review.
   */
  const restingReview = useRestingReview({
    portal: ownerOn ? portal.payload : null,
    games: ownerOn ? suggestGames : NO_SUGGEST_GAMES,
    kalshiBySlug,
    feeParams: kalshiFees,
    yesP: portalYesP,
    nowMs,
  });

  const openIdx = useMemo(
    () => (openPanel ? filteredCards.findIndex((c) => c.key === openPanel.key) : -1),
    [openPanel, filteredCards]
  );
  const openCard = openIdx >= 0 ? filteredCards[openIdx] : null;

  // Close the panel if its card leaves the slate (week/season/filter change).
  useEffect(() => {
    if (openPanel && openIdx < 0) { setOpenPanel(null); setPanelFocus(null); }
  }, [openPanel, openIdx]);

  // ...and if the owner session ends while a bets panel is open. The panel
  // body is gated on `ownerOn`, so leaving it open would show a titled empty
  // box; the tab that opened it is already gone.
  useEffect(() => {
    if (!ownerOn && openPanel?.kind === "bets") { setOpenPanel(null); setPanelFocus(null); }
  }, [ownerOn, openPanel]);

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
    return lo === hi ? ` · ${fmt(lo)} sims` : ` · ${fmt(lo)}\u2013${fmt(hi)} sims`;
  }, [filteredCards]);

  /**
   * Slate-wide ATS/Total/ML grading tally for the strip above the cards grid.
   * Recomputed from `filteredCards` -- the exact array the grid below maps
   * over -- so a conference filter narrows the record along with the cards.
   * Counts BOTH verified (CSV_FINALS) and live-graded (resultsProvisional)
   * results; provisionalGames counts distinct graded cards that are live-only
   * so far, for the "(n provisional)" suffix.
   */
  const slateTally = useMemo(() => {
    const mk = () => ({ win: 0, loss: 0, push: 0 });
    const ats = mk(), tot = mk(), ml = mk();
    let provisionalGames = 0;
    let anyGraded = false;
    for (const c of filteredCards) {
      let cardGraded = false;
      if (c.spreadResult) { ats[c.spreadResult]++; cardGraded = true; }
      if (c.totalResult) { tot[c.totalResult]++; cardGraded = true; }
      if (c.mlResult) { ml[c.mlResult]++; cardGraded = true; }
      if (cardGraded) {
        anyGraded = true;
        if (c.resultsProvisional) provisionalGames++;
      }
    }
    return { ats, tot, ml, provisionalGames, anyGraded };
  }, [filteredCards]);

  /**
   * ONE CARD RENDERER, two grids.
   *
   * The "My games" tray and the main grid render the SAME component with the
   * same props — a card must not become a different card for being in the tray
   * (its tab panels, its Bets flows and its book strip all have to keep
   * working). So the mapping lives here and each grid hands it its own list.
   *
   * The break-out panel's row arithmetic is per-LIST: `panelRowEnd` needs the
   * open card's index inside the grid it is actually rendering in. It resolves
   * to -1 in the list that does not hold the open card, so the panel renders
   * exactly once, under the grid that owns it. Each grid passes its OWN
   * measured column count (the tray is inset — see `useGridCols`).
   */
  const renderCards = (list: CardGame[], cols: number) => {
    const idxIn = openPanel ? list.findIndex((c) => c.key === openPanel.key) : -1;
    const rowEnd = panelRowEnd(idxIn, cols, list.length);
    return list.map((c, idx) => {
      const isOpen = openPanel?.key === c.key;
      // OWNER ONLY, and only what the current filters actually leave on
      // this game — the badge reads the same compute the panel renders.
      const sec = suggestions.bySlug.get(c.key);
      const bets = ownerOn
        ? { n: sec?.groups.length ?? 0, nTail: sec?.tailGroups.length ?? 0 }
        : undefined;

      return (
        <Fragment key={c.key}>
          <GameCard
            card={c}
            gdata={games[c.key]}
            useMean={useMean}
            kalshi={c.jsonRow ? kalshiBySlug.get(c.key) : undefined}
            book={portalBook.bySlug.get(c.key)}
            // Owner only, and only for the per-order ✕ on a resting row
            // this app placed. The strip is read-only without it.
            bookToken={ownerOn ? portalToken : ""}
            parlayOpen={parlayOpen}
            openKind={isOpen ? openPanel!.kind : null}
            onToggle={(kind) => togglePanel(c.key, kind)}
            weekLabel={weekLabel}
            condensed={condensed}
            // The CARD's namespace, not the page's: on a merged slate the
            // two halves fetch from different datasets.
            season={c.ns}
            onAddLeg={() => togglePanel(c.key, "picker")}
            flash={flashKey === c.key}
            bets={bets}
          />
          {openPanel && idx === rowEnd && openCard && (
            <div style={{ gridColumn: "1 / -1" }}>
              <CardPanelHost
                card={openCard}
                kind={openPanel.kind}
                gdata={games[openCard.key]}
                week={selectedWeek}
                season={openCard.ns}
                weekId={weekId}
                useMean={useMean}
                kalshi={openCard.jsonRow ? kalshiBySlug.get(openCard.key) : undefined}
                onAddLeg={addLeg}
                onClose={closePanel}
                // Only ever set for the panel it was aimed at, so a stale
                // payload cannot re-scroll a chart opened by hand.
                focus={
                  (openPanel.kind === "teamstats" && panelFocus?.kind === "teamstats") ||
                  (openPanel.kind === "scores" && panelFocus?.kind === "scores")
                    ? panelFocus : null
                }
                /* PLACE FROM THE PROJECTION. Owner-gated exactly like the
                   bets panel, and only when the reader ARRIVED from a bets
                   row (the focus carries a ladder id) — never a general
                   place-from-chart affordance.
                   The ladder is looked up LIVE, on every render, against
                   the compute that re-runs on the 45s feed poll and the
                   30s clock. Nothing is cached: a ladder that has gone
                   (kickoff, a filter, a moved book) resolves to null and
                   the strip says so instead of pricing a ghost. */
                placeStrip={
                  ownerOn && panelFocus?.groupId &&
                  (openPanel.kind === "teamstats" || openPanel.kind === "scores") ? (
                    <PlaceStrip
                      group={findGroupById(
                        suggestions.bySlug.get(openCard.key), panelFocus.groupId)}
                      unit={unit}
                      token={portalToken}
                      feeParams={kalshiFees}
                      quotedAt={suggestions.computedAt}
                      ordersLive={portal.payload?.orders_live === true}
                    />
                  ) : null
                }
                // The bets panel is composed HERE rather than plumbed
                // through the host: it needs page state (filters, unit,
                // token, the compute) that no other panel does.
                betsPanel={openPanel.kind === "bets" && ownerOn ? (
                  <GameBetsPanel
                    section={suggestions.bySlug.get(openCard.key)}
                    verdict={suggestions.pregameBySlug.get(openCard.key)}
                    hiddenByFilter={suggestions.hiddenBySlug.get(openCard.key) ?? 0}
                    tailCount={suggestions.tailCountBySlug.get(openCard.key) ?? 0}
                    unit={unit}
                    token={portalToken}
                    feeParams={kalshiFees}
                    quotedAt={suggestions.computedAt}
                    ordersLive={portal.payload?.orders_live === true}
                    modeFilter={betMode} onModeFilter={onBetMode}
                    typeFilter={betType} onTypeFilter={onBetType}
                    showTails={betTails} onShowTails={onBetTails}
                    onProject={(t: ProjectionTarget) => focusPanel(
                      openCard.key,
                      t.kind === "scores" ? "scores" : "teamstats",
                      // The WHOLE target travels: which chart, which value
                      // on it, and which ladder sent us — the panel needs
                      // all three to open on the bet rather than near it.
                      t,
                    )}
                  />
                ) : null}
              />
            </div>
          )}
        </Fragment>
      );
    });
  };

  // Compact toolbar tokens — the row must fit on one line at desktop widths.
  const CTL = { maxWidth: 190 } as const;
  const LBL = { fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" } as const;
  const HDG = { margin: 0, fontSize: 14, fontWeight: 800, color: "var(--brand-text)", whiteSpace: "nowrap" } as const;

  /** Either half still in flight. Without the FCS term an FCS-only slate
   *  flashed "No games for this selection" before its rows landed. */
  const slateLoading = loading || (showFcs && fcsStatus === "loading");

  const statusText = catalogLoading
    ? "Loading seasons…"
    : catalogError
    ? "Dataset unavailable"
    : slateLoading
    ? "Loading…"
    : `${filteredCards.length} game${filteredCards.length === 1 ? "" : "s"}${simsText}`;

  /**
   * The pre-publish note, and the ONLY thing the viewer sees about a missing
   * FCS week. Never a banner: in "Both" a healthy FBS slate is on screen
   * beneath it, and an error box there would misattribute the failure.
   */
  const fcsNote =
    showFcs && fcsStatus === "unpublished"
      ? division === "fcs"
        ? "FCS week not published yet."
        : "FCS week not published yet — showing FBS only."
      : null;

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

            {/* Division. Its own axis, not a season — see the FCS block above.
                Hidden entirely for seasons with no FCS dataset, so 2025 keeps
                the toolbar it has today. */}
            {fcsAvailableFor(season) && (
              <>
                <h2 style={HDG}>Division</h2>
                <select
                  value={division}
                  onChange={(e) => setDivision(e.target.value as DivisionFilter)}
                  className="ui-sel" style={CTL}
                  aria-label="Division"
                >
                  <option value="fbs">FBS</option>
                  <option value="fcs">FCS</option>
                  <option value="both">Both</option>
                </select>
              </>
            )}

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

            {/* One entry point for every owner feature. The login form, the
                kill switch, unit size and the suggestions all live in the My
                Book console below — this button only opens it. */}
            <button
              type="button"
              className="ui-btn"
              data-on={portalToken || portalUiOpen ? "true" : "false"}
              onClick={() => setPortalUiOpen((v) => !v)}
              style={{ whiteSpace: "nowrap" }}
              title={portalNote}
            >
              {portalToken
                ? portal.status === "ok" ? "My Book ✓" : "My Book…"
                : "My Book"}
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
              title={`Theme: ${themeMode}${themeMode === "system" ? ` (${themeResolved})` : ""} — click to change`}
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

      {/* The owner console. Holds login, unit size, the order kill switch,
          the cumulative book bar and the Suggested bets card — one block, so
          the next owner feature is a row here rather than another button
          scattered across the toolbar. */}
      {(portalToken || portalUiOpen) && (
        <MyBookPanel
          token={portalToken}
          onToken={(t) => {
            writePortalToken(t);
            setPortalToken(t);
            if (!t) setPortalUiOpen(false);
          }}
          note={portalNote}
          connected={portal.status === "ok"}
          ordersLive={portal.payload?.orders_live === true}
          unit={unit}
          onUnit={(v) => { setUnit(v); writeUnit(v); }}
          totals={portalBook.totals}
          unmatched={portalBook.unmatched}
          record={portalRecord}
          slugTeams={slugTeams}
        >
          {/* The RANKED INDEX: which game, not which bet. It recomputes
              whenever the 45s Kalshi poll delivers, so it is live without a
              single extra request; a row opens that game's Bets panel, which
              is where the ladders and the Place button live. */}
          {ownerOn && (
            <SuggestedBetsIndex
              suggestions={suggestions}
              review={restingReview}
              token={portalToken}
              unit={unit}
              sort={betSort}
              onSort={onBetSort}
              onRefresh={() => setSuggestNonce((n) => n + 1)}
              ordersLive={portal.payload?.orders_live === true}
              showTails={betTails}
              onShowTails={onBetTails}
              onClearFilters={clearBetFilters}
              onOpenGame={(slug) => jumpToGame(slug, "bets")}
            />
          )}
        </MyBookPanel>
      )}

      {(slateLoading || catalogLoading) && !filteredCards.length && (
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

      {/* FCS pre-publish. A quiet note, styled like the "no games" line rather
          than the failure cards above — nothing here is broken. */}
      {fcsNote && !catalogError && !weekError && (
        <section className="card" style={{ padding: 12, marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
          {fcsNote}
        </section>
      )}

      {!catalogError && !weekError && !slateLoading && !catalogLoading && !filteredCards.length && !fcsNote && (
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
          flashLegId={flashLegId}
        />
      )}

      {showTopEdges && (
        <TopEdges
          scan={slateScan}
          loading={edgesLoading && !slateScan}
          onPick={jumpToGame}
          onClose={() => setShowTopEdges(false)}
          onAddLeg={addLegFromTopEdges}
        />
      )}

      {/* Slate tally: running ATS/Total/ML betting record for the displayed
          (filtered) slate, with PnL + an Open/Close frame toggle when
          lines.json is published for this week.

          When nothing is graded YET, the bar's slot is still rendered (same
          class, so the box is the same height) with a muted one-liner. On a
          live game day the record joins seconds-to-minutes after the cards,
          and mounting the bar then used to push the whole grid down — the
          top-of-page half of the CLS "poor" bucket (Cloudflare RUM,
          2026-08-29). Reserving the slot turns that into an in-place fill.
          Past weeks grade in the same render as the cards, so the
          placeholder never paints there. */}
      {slateTally.anyGraded ? (
        <SlateTallyBar tally={slateTally} cards={filteredCards} weekLines={weekLines} weekLinesFcs={weekLinesFcs} condensed={condensed} />
      ) : filteredCards.length > 0 ? (
        <div className="slate-tally-bar" style={condensed ? { fontSize: 11, padding: "5px 10px" } : undefined}>
          <b>Slate record</b>
          <span className="slate-tally-bar__dim">appears as games go final</span>
        </div>
      ) : null}

      {/* THE "MY GAMES" TRAY — the games the owner already has money on, taken
          out of the scan below.

          It is not a filter and not a pin: the member cards render HERE and
          nowhere else, in both tray states, so the grid underneath answers one
          question only — "what have I got nothing on yet?".

          Owner-gated, and absent entirely when nothing is held or resting, so a
          public viewer and a flat book both see the board exactly as before. */}
      {ownerOn && trayCards.length > 0 && (
        <section
          style={{
            border: "1px solid var(--border)", borderRadius: 12,
            background: "var(--fill)", padding: 8, marginBottom: 16,
            display: "grid", gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => onMyGamesOpen(!myGamesOpen)}
            aria-expanded={myGamesOpen}
            aria-controls="my-games-grid"
            style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              width: "100%", textAlign: "left", cursor: "pointer",
              padding: "4px 4px", border: "none", background: "none",
              color: "var(--text)", font: "inherit",
            }}
          >
            <span aria-hidden style={{ fontSize: 11, color: "var(--muted)", flex: "none" }}>
              {myGamesOpen ? "▾" : "▸"}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--brand-text)" }}>
              Your games ({trayCards.length})
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              · {myGames.resting} resting · {myGames.held} held
            </span>
          </button>

          {myGamesOpen && (
            <>
              <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.5, padding: "0 4px" }}>
                Money already on the board. They are kept out of the grid below,
                which is everything you have nothing on.
              </div>
              <div
                id="my-games-grid"
                ref={trayGridRef}
                style={{
                  display: "grid",
                  gap: GRID_GAP,
                  gridTemplateColumns: `repeat(auto-fit, minmax(${GRID_MIN[density]}px, 1fr))`,
                  alignItems: "stretch",
                }}
              >
                {renderCards(trayCards, trayCols)}
              </div>
            </>
          )}
        </section>
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
        {renderCards(mainCards, gridCols)}
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

/**
 * The kickoff-weather chip that sits just left of the kick time on a PREGAME
 * card (the caller owns that gate — see the card header). A planning aid, so
 * muted and one glance wide: an emoji and a temperature, with ESPN's own
 * wording in the tooltip. A dome says "Dome" and nothing else, because the
 * outdoor forecast ESPN still ships for it is not a fact about that game.
 *
 * NO colour of its own: it wears --muted ink on the card's own background,
 * exactly like the week label and the kick time it sits next to, so it reads
 * in both themes with no new tinted surface to measure.
 *
 * Renders null whenever there is nothing certain to say — the temperature is
 * the chip's whole content, so a weather block without one is not worth a
 * line on a betting card.
 */
function KickWeatherChip({
  weather, indoor,
}: { weather: LiveWeather | null; indoor: boolean }) {
  if (!indoor && (!weather || weather.temp == null)) return null;

  const emoji = indoor ? "🏟️" : weatherEmoji(weather?.conditionId ?? null);
  const body = indoor ? "Dome" : `${weather?.temp}°`;
  const title = indoor
    ? weather?.text
      ? `Indoor stadium — ${weather.text} outside`
      : "Indoor stadium"
    : weather?.text || undefined;

  return (
    <span
      title={title}
      style={{
        whiteSpace: "nowrap",
        color: "var(--muted)",
        fontWeight: 400,
        fontVariantNumeric: "tabular-nums",
        marginRight: 7,
        // Fits inside the header row's reserved 16px, so the chip arriving
        // with the ESPN join fills a slot rather than growing the card.
        lineHeight: "14px",
      }}
    >
      {emoji ? <span aria-hidden="true">{emoji} </span> : null}
      {body}
    </span>
  );
}

export function GameCard({
  card, gdata, useMean = false, kalshi, book, bookToken = "", parlayOpen,
  openKind, onToggle, weekLabel, condensed = false, onAddLeg, season,
  flash = false, bets,
}: {
  card: CardGame;
  /** Per-seed rows. Undefined on JSON seasons, which publish summaries only. */
  gdata?: GameData;
  useMean?: boolean;
  /** Kalshi market data for this game, when the feed lists it. */
  kalshi?: KalshiGame;
  /** The owner's bets on this game (portal), with money metrics. */
  book?: PortalBet[];
  /** Portal password, owner sessions only. Its ONLY use is the per-order ✕ on
   *  a resting row this app placed; empty means the strip stays read-only. */
  bookToken?: string;
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
  /**
   * OWNER ONLY. How many suggested ladders this game has under the CURRENT
   * filters (`n`), and how many revealed tail ladders (`nTail`). Undefined for
   * everyone else, which is what keeps the Bets tab off a viewer's card.
   */
  bets?: { n: number; nTail: number };
}) {
  const jsonRow = card.jsonRow;
  const csvCard = !jsonRow;
  const hasSeedRows = Boolean(gdata?.rowsA?.length);
  const canShowScores = hasSeedRows || Boolean(jsonRow);

  /* Team colours are theme-resolved: a navy primary that vanishes on the dark
     card is lifted (or traded for the school's other colour) before it paints
     anything. Read once here, passed down — never inside a map. */
  const isDark = useIsDark();
  const aColor = displayTeamColor(card.teamA, isDark);
  const bColor = displayTeamColor(card.teamB, isDark);
  const aLogo = getTeamLogo(card.teamA);
  const bLogo = getTeamLogo(card.teamB);

  const expanded = openKind !== null;

  /* Live gamecast wiring. ESPN's home/away can flip vs the sim contract
     (teamA=home) on neutral-site games, so colors are mapped by NAME match,
     never by slot. */
  const lv = card.live;
  const liveNow = Boolean(card.liveInProgress);
  const espnHomeIsA = lv ? nameMatches(lv.homeNames, lv.homeTeam, card.teamA) : true;
  const liveBits = {
    homeAbbrev: lv?.homeAbbrev,
    awayAbbrev: lv?.awayAbbrev,
    homeId: lv?.homeId,
    awayId: lv?.awayId,
    homeColor: espnHomeIsA ? aColor : bColor,
    awayColor: espnHomeIsA ? bColor : aColor,
    homeLogo: (espnHomeIsA ? aLogo : bLogo) || undefined,
    awayLogo: (espnHomeIsA ? bLogo : aLogo) || undefined,
  };

  /* The PREGAME gate for the three context bits that ride the live join —
     kickoff weather, broadcast, venue. Hoisted here because the weather chip
     and the broadcast tag render on the header line while the venue renders
     on its own line below it, and the two must never disagree about whether
     this game has kicked.

     Both signals veto, the same shape as the suggested-bets pregame gate: a
     live/post/final state beats a kick time still in the future, and the
     CLOCK beats a stale "pre". Once a game is under way the live/score UI
     owns this space — a forecast for a kick that already happened is noise on
     a card whose reader is now watching a result. The Date.now() read is safe
     because the page's 30s `nowMs` tick re-renders every card, so these clear
     themselves at kickoff rather than waiting on the feed.

     BROADCAST is the one exception: it stays up while the game is LIVE,
     because "which channel is this on" is a live question — it only drops at
     final, where it is pure noise. */
  const lvState = lv?.state;
  const cardIsFinal = card.scoreSource === "CSV_FINALS" || lvState === "post" || lvState === "final";
  const pregame =
    !liveNow &&
    !cardIsFinal &&
    card.scoreSource !== "LIVE" &&
    lvState !== "in" &&
    (card.kickoffMs == null || card.kickoffMs > Date.now());
  const showBroadcast = !cardIsFinal;
  /* The venue line is RESERVED, not conditional: `venueSlot` is decided from
     the card alone (no feed), so the empty line is already in the layout when
     the ESPN join lands and the text fills it in place. Deciding on `lv.venue`
     instead would mount a whole new row seconds after first paint and push
     every card below down — the 2026-08-29 CLS lesson, exactly. Condensed
     cards opt out entirely: that mode exists to fit more games on screen, and
     the stadium is the least load-bearing thing on a card. */
  const venueSlot = pregame && !condensed;
  const venueText = venueSlot && lv?.venue ? venueLine(lv.venue) : "";

  /* LIVE PROGRESS on the owner's per-team stat bets (rec yds, rush yds, team
     points). The gate is deliberately narrow and cheap: a game that is UNDER
     WAY (or just finished, where "did it get there" is the whole question)
     AND at least one bet on it whose ticker maps to a verified ESPN box-score
     path. `progressBetsOf` is pure ticker arithmetic — no fetch, no data — so
     the decision is known before any network, which is what lets the strip
     mount at full height and fill in rather than shifting the card.
     `useGameTeamStats` shares the Live panel's own summary poller (same URL,
     same 20s cadence), so a card tracking bets and an open gamecast on that
     game cost ONE fetch between them. */
  const progressBets = useMemo(() => progressBetsOf(book), [book]);
  const trackable = progressBets.length > 0 && (liveNow || lv?.state === "final");
  const liveStats = useGameTeamStats(trackable ? lv?.id : undefined, liveNow);

  const tabBtn = (kind: PanelKind, label: React.ReactNode, accent = false) => (
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
        borderLeft: `3px solid ${expanded ? "var(--brand)" : (aColor ?? "var(--brand)")}`,
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
          /* Header row + venue line share ONE grid cell (gap 2) rather than
             taking two of the card's own 8px-gap slots — the venue is a
             continuation of the header, not a section of its own. */
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          {/* minHeight reserves the row (2026-08-29 CLS work): the ESPN join
             lands seconds after first paint, so the weather chip and broadcast
             tag mounting into this line would otherwise nudge every card below
             it. 16px covers the 11px label text and the 14px chips alike.

             minWidth:0 here and on the wrapper is load-bearing, not tidiness:
             a grid item's automatic minimum size is its MIN-CONTENT, and
             Chrome takes this flex row's min-content to include the week
             label's full width even though that span is `overflow: hidden`.
             Without the override the row refuses to shrink and a long label
             ("Week 14 (Rivalry Week)") plus a network and a weather chip
             pushes the kick time clean outside the card — measured 341px of
             content in a 272px card. With it, the label ellipsizes and the
             kick time stays put, which is the right thing to sacrifice. */}
          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", minHeight: 16, minWidth: 0 }}>
            {/* Sibling of the week label, not a child of it: that span
                truncates with an ellipsis, and a badge inside it would be the
                first thing clipped on a long label ("Week 14 (Rivalry Week)").
                Only non-FBS games are badged, so an FBS-only slate — the
                default — renders exactly the header it did before. */}
            {card.division === "fcs" && (
              <span className="division-badge" data-division="fcs">FCS</span>
            )}
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
              {/* Broadcast + kickoff weather ride INSIDE the status span,
                  immediately left of the kick time they qualify. That
                  placement is the CLS answer: this span's right edge is
                  pinned by its own `marginLeft: auto`, so anything appearing
                  when the ESPN join lands grows the span LEFTWARD into empty
                  space — the kick time itself does not move, and on a card too
                  narrow for the slack the week label (already ellipsized)
                  absorbs it. The row's minHeight covers the vertical half. */}
              {showBroadcast && lv?.broadcast && (
                <span
                  style={{
                    whiteSpace: "nowrap", color: "var(--muted)", fontWeight: 400,
                    marginRight: 7, lineHeight: "14px",
                  }}
                >
                  {lv.broadcast}
                </span>
              )}
              {pregame && (
                <KickWeatherChip
                  weather={lv?.weather ?? null}
                  indoor={lv?.indoor === true}
                />
              )}
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

          {/* WHERE the game is played — stadium and town, one muted line, in
              the same --muted ink as the header above it so both themes come
              free. Pregame only: once the ball is in the air the live UI owns
              the card and the venue stops being a decision input. Truncates
              from the right on a narrow card; the stadium name is the half
              worth keeping. */}
          {venueSlot && (
            <div
              style={{
                fontSize: 11, color: "var(--muted)", lineHeight: "14px",
                minHeight: 14, minWidth: 0, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
              title={venueText || undefined}
            >
              {venueText}
            </div>
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
                <div style={{ width: logoPx, height: logoPx, borderRadius: 6, background: bColor ?? "var(--accent)" }} />
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
                <div style={{ width: logoPx, height: logoPx, borderRadius: 6, background: aColor ?? "var(--brand)" }} />
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

      <WinProbBar card={card} aColor={aColor} bColor={bColor} condensed={condensed} />

      {/* Pick grading. Verified dataset finals (INV-44 truth) and live-graded
          finals (card.resultsProvisional) render the identical pill — a
          dotted underline + tooltip is the only visual difference until the
          week re-publishes with dataset finals. */}
      {(card.spreadResult || card.totalResult || card.mlResult) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {card.spreadResult && card.pickSpread && (
            <ResultPill label="ATS" text={card.pickSpread} result={card.spreadResult} provisional={card.resultsProvisional} />
          )}
          {card.totalResult && card.pickTotal && (
            <ResultPill label="Total" text={card.pickTotal} result={card.totalResult} provisional={card.resultsProvisional} />
          )}
          {card.mlResult && card.mlPickTeam && (
            <ResultPill label="ML" text={card.mlPickTeam} result={card.mlResult} provisional={card.resultsProvisional} />
          )}
        </div>
      )}

      {/* Live ball spot + down & distance, straight off the scoreboard poll. */}
      {liveNow && lv?.situation && (
        <FieldStrip situation={lv.situation} bits={liveBits} condensed={condensed} />
      )}

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

      {/* Where the money already on this game stands, right now — above the
          book strip, because "is it getting there" is the live question and
          "what is it" is the reference. Mounted off the ticker test alone, so
          the first reading landing never moves the card. */}
      {trackable && (
        <LiveProgressStrip bets={progressBets} espnHomeIsA={espnHomeIsA} stats={liveStats} />
      )}

      {book && book.length > 0 && <MyBookStrip bets={book} token={bookToken} />}

      {/* Action buttons.
          Player panels are gated on the export's has_players FLAG rather than
          on the 404 the fetch would take: FCS publishes game-level sims only,
          and offering a button that can only fail is worse than not offering
          it. Everything game-level (scores distribution, market block, win
          prob, parlay legs) works identically on both divisions. */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:4 }}>
        {/* Live while in progress; the same panel doubles as the postgame
            win/cover flow chart while the event is still on today's board. */}
        {lv?.id && (liveNow || lv.state === "final") &&
          tabBtn("live", liveNow ? "Live" : "Game Flow", liveNow)}
        {canShowScores && tabBtn("scores", "Simulated Scores")}
        {csvCard && tabBtn("players", "Player Stats", true)}
        {jsonRow && card.hasPlayers && tabBtn("props", "Player Props")}
        {jsonRow && card.hasPlayers && tabBtn("box", "Box Score", true)}
        {/* Team box-stat distributions. Gated on hasPlayers exactly like the
            player panels: team_stats.json is built from the player sweep, so
            the FCS (game-level-only) namespace has none and gets no button. */}
        {jsonRow && card.hasPlayers && tabBtn("teamstats", "Team Stats")}
        {/* OWNER ONLY, and only when this game actually has something to
            place. `openKind === "bets"` keeps the button alive while its own
            panel is open, so a feed update that drops the last row cannot
            yank the tab out from under an open panel. */}
        {bets && (bets.n + bets.nTail > 0 || openKind === "bets") && tabBtn(
          "bets",
          <>
            Bets
            <span style={{
              marginLeft: 5, padding: "0 5px", borderRadius: 999,
              fontSize: 10, fontWeight: 900, verticalAlign: "middle",
              background: "var(--brand)", color: "var(--brand-contrast)",
            }}>
              {bets.n > 0 ? bets.n : "tail"}
            </span>
          </>,
          true,
        )}
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

/* ============================== Pick result pill =============================
 * Win/loss/push badge for one graded pick (ATS / Total / ML). Same pill for
 * verified dataset finals and live-graded finals — `provisional` only adds a
 * dotted underline + tooltip, it never changes color or text.
 * ========================================================================= */
function ResultPill({ label, text, result, provisional }: {
  label: string; text: string; result: "win" | "loss" | "push"; provisional?: boolean;
}) {
  return (
    <span
      className="result-pill"
      data-result={result}
      data-provisional={provisional ? "true" : undefined}
      title={provisional ? "graded from live final — verified on re-publish" : undefined}
    >
      {label} · {text} · {result.toUpperCase()}
    </span>
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
/* The owner's per-card book block moved to src/components/MyBook.tsx
   (2026-08-28): ONE LINE PER BET -- mark, the bet in words, the stake, and
   the sim's EV as the single verdict -- with count, risk to payout, fees and
   both sources' probability/odds behind a tap. The three-line version that
   lived here (glyph + label + count / risk-win-fees / two EV chips carrying a
   tag, dollars, a probability AND american odds) failed the bar test. */

type SlateResultCount = { win: number; loss: number; push: number };
type MarketAgg = { win: number; loss: number; push: number; pnl: number };
const mkMarketAgg = (): MarketAgg => ({ win: 0, loss: 0, push: 0, pnl: 0 });

/**
 * ATS/Total/ML record + PnL for the currently filtered slate, at one frame
 * (open/close). Pure aggregation over `computeLineRecord`'s own inputs —
 * `cards` are the SAME finals `slateTally` above counts (verified dataset
 * finals or a live-graded final; never an in-progress live score), joined to
 * `weekLines` by `card.jsonRow.slug`. A card/market lines.json doesn't price
 * (missing game entry, or that market's frame line is null) is skipped for
 * THAT market — the record only counts games it could price.
 */
function computeLineRecord(
  cards: CardGame[],
  linesFbs: WeekLines | null,
  linesFcs: WeekLines | null,
  frame: Frame
): { ats: MarketAgg; tot: MarketAgg; ml: MarketAgg; provisionalGames: number } {
  const ats = mkMarketAgg(), tot = mkMarketAgg(), ml = mkMarketAgg();
  let provisionalGames = 0;

  for (const c of cards) {
    const graded = c.scoreSource === "CSV_FINALS" || c.resultsProvisional === true;
    if (!graded) continue;
    // Each division prices off its own lines file — FCS slugs are not in the
    // FBS file and vice versa, so a wrong-division join can never mislead;
    // it just misses.
    const wl = c.division === "fcs" ? linesFcs : linesFbs;
    if (!wl) continue;
    const slug = c.jsonRow?.slug;
    const lg = slug ? wl.games[slug] : undefined;
    if (!lg) continue;

    if (c.noContest) {
      // Canceled/postponed: every market this frame could have priced is a
      // push at 0 PnL (stake returned) — there is no score to grade.
      const spreadLine = frame === "open" ? lg.spread.open : lg.spread.close;
      const totalLine = frame === "open" ? lg.total.open : lg.total.close;
      const mlHome = frame === "open" ? lg.ml.home_open : lg.ml.home_close;
      const mlAway = frame === "open" ? lg.ml.away_open : lg.ml.away_close;
      if (spreadLine !== null) ats.push++;
      if (totalLine !== null) tot.push++;
      if (typeof c.pHome === "number" && mlHome !== null && mlAway !== null) ml.push++;
      if (spreadLine !== null || totalLine !== null) provisionalGames++;
      continue;
    }
    if (typeof c.finalA !== "number" || typeof c.finalB !== "number") continue;

    let contributed = false;
    const add = (agg: MarketAgg, g: { result: "win" | "loss" | "push"; pnl: number } | null) => {
      if (!g) return;
      agg[g.result]++;
      agg.pnl += g.pnl;
      contributed = true;
    };

    const spreadLine = frame === "open" ? lg.spread.open : lg.spread.close;
    add(ats, pickAndGradeSpread(c.medA, c.medB, spreadLine, c.finalA, c.finalB));

    const totalLine = frame === "open" ? lg.total.open : lg.total.close;
    add(tot, pickAndGradeTotal(c.medA, c.medB, totalLine, c.finalA, c.finalB));

    if (typeof c.pHome === "number") {
      const mlHome = frame === "open" ? lg.ml.home_open : lg.ml.home_close;
      const mlAway = frame === "open" ? lg.ml.away_open : lg.ml.away_close;
      add(ml, pickAndGradeML(c.pHome, mlHome, mlAway, c.finalA, c.finalB));
    }

    if (contributed && c.resultsProvisional) provisionalGames++;
  }

  return { ats, tot, ml, provisionalGames };
}

const fmtMarketRecord = (r: SlateResultCount): string | null => {
  const n = r.win + r.loss + r.push;
  if (!n) return null;
  return `${r.win}–${r.loss}${r.push > 0 ? `–${r.push}` : ""}`;
};

/** "+X.XXu" / "−X.XXu", sign always shown; tone by sign (pos/neg/muted). */
function fmtPnl(pnl: number): { text: string; color: string } {
  const text = `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}u`;
  const color = pnl > 1e-9 ? "var(--pos)" : pnl < -1e-9 ? "var(--neg)" : "var(--muted)";
  return { text, color };
}

/**
 * Betting-record strip for the currently filtered slate, above the cards
 * grid. Verified and live-graded results are counted identically — the
 * "(n provisional)" suffix is the only place that distinction shows.
 *
 * Two modes:
 *  - lines.json published for this week -> real record: W-L(-P) + PnL in
 *    units per market, at the selected Open/Close frame (default Open — the
 *    site's standing benchmark, bets go in early in the week).
 *  - lines.json unpublished (weekLines null: pre-publish, or an FCS-only
 *    view where it never publishes) -> EXACTLY the prior simple tally, no
 *    PnL, no toggle, so those weeks keep working unchanged.
 */
function SlateTallyBar({ tally, cards, weekLines, weekLinesFcs = null, condensed }: {
  tally: { ats: SlateResultCount; tot: SlateResultCount; ml: SlateResultCount; provisionalGames: number };
  cards: CardGame[];
  weekLines: WeekLines | null;
  weekLinesFcs?: WeekLines | null;
  condensed?: boolean;
}) {
  const [frame, setFrame] = useState<Frame>("open");

  const anyLines = weekLines !== null || weekLinesFcs !== null;
  const rec = useMemo(
    () => (anyLines ? computeLineRecord(cards, weekLines, weekLinesFcs, frame) : null),
    [cards, weekLines, weekLinesFcs, frame, anyLines]
  );

  // A lines file can resolve while pricing ZERO displayed games (an FCS view
  // before the FCS lines.json publishes joins nothing against the FBS file).
  // That state must fall back to the plain W-L tally, not vanish — graded
  // pills with no record strip reads as a bug.
  const recPriced = rec
    ? rec.ats.win + rec.ats.loss + rec.ats.push +
      rec.tot.win + rec.tot.loss + rec.tot.push +
      rec.ml.win + rec.ml.loss + rec.ml.push > 0
    : false;

  if (!anyLines || !rec || !recPriced) {
    const parts: string[] = [];
    const ats = fmtMarketRecord(tally.ats); if (ats) parts.push(`ATS ${ats}`);
    const tot = fmtMarketRecord(tally.tot); if (tot) parts.push(`Totals ${tot}`);
    const ml = fmtMarketRecord(tally.ml); if (ml) parts.push(`ML ${ml}`);
    if (!parts.length) return null;

    return (
      <div className="slate-tally-bar" style={condensed ? { fontSize: 11, padding: "5px 10px" } : undefined}>
        <b>Slate record</b>
        <span>{parts.join(" · ")}</span>
        {tally.provisionalGames > 0 && (
          <span className="slate-tally-bar__dim">
            ({tally.provisionalGames} provisional)
          </span>
        )}
      </div>
    );
  }

  const rows: { label: string; record: string; pnl: number }[] = [];
  const atsRec = fmtMarketRecord(rec.ats); if (atsRec) rows.push({ label: "ATS", record: atsRec, pnl: rec.ats.pnl });
  const totRec = fmtMarketRecord(rec.tot); if (totRec) rows.push({ label: "Totals", record: totRec, pnl: rec.tot.pnl });
  const mlRec = fmtMarketRecord(rec.ml); if (mlRec) rows.push({ label: "ML", record: mlRec, pnl: rec.ml.pnl });
  if (!rows.length) return null;

  return (
    <div
      className="slate-tally-bar"
      style={{
        ...(condensed ? { fontSize: 11, padding: "5px 10px" } : undefined),
        alignItems: "flex-start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", width: "100%" }}>
        <b>Slate record</b>
        <div style={{ display: "inline-flex", gap: 2 }}>
          <button
            type="button" className="ui-btn" data-on={frame === "open" ? "true" : "false"}
            onClick={() => setFrame("open")} style={{ padding: "2px 8px", fontSize: 11 }}
          >
            Open
          </button>
          <button
            type="button" className="ui-btn" data-on={frame === "close" ? "true" : "false"}
            onClick={() => setFrame("close")} style={{ padding: "2px 8px", fontSize: 11 }}
          >
            Close
          </button>
        </div>
        {rec.provisionalGames > 0 && (
          <span className="slate-tally-bar__dim">({rec.provisionalGames} provisional)</span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 4, width: "100%" }}>
        {rows.map((r, i) => {
          const { text, color } = fmtPnl(r.pnl);
          return (
            <Fragment key={r.label}>
              {i > 0 && <span style={{ color: "var(--muted)" }}>·</span>}
              <span>
                {r.label} {r.record}{" "}
                <span style={{ color, fontWeight: 700 }}>· {text}</span>
              </span>
            </Fragment>
          );
        })}
      </div>

      <div style={{ width: "100%", fontSize: 10, color: "var(--muted)" }}>
        spread/total priced −110 · ML at consensus price · 1u flat
      </div>
    </div>
  );
}

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
      label: `Win · ${card.teamA}`,
      sim: `${(card.pHome * 100).toFixed(0)}%`,
      mkt: `${(winMkt * 100).toFixed(0)}%`,
      delta: `${signed((winMkt - card.pHome) * 100, 0)}%`,
    });
  }
  if (totLine != null) {
    rows.push({
      label: "Total",
      sim: num(simTotal),
      mkt: totOver != null ? `${num(totLine)} · o${(totOver * 100).toFixed(0)}%` : num(totLine),
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
  card, kind, gdata, week, season, weekId, useMean, kalshi, onAddLeg, onClose,
  focus = null, betsPanel = null, placeStrip = null,
}: {
  card: CardGame;
  kind: PanelKind;
  gdata?: GameData;
  week: string;
  season: Season;
  weekId: string;
  useMean: boolean;
  /** Live Kalshi feed for this game (45s TTL) — the Team Stats panel's
   *  price source, so its numbers are never a published snapshot. */
  kalshi?: KalshiGame;
  onAddLeg: (leg: Leg) => void;
  onClose: () => void;
  /** Pre-focus from a suggested bet's "See projection →" — which chart, and
   *  the exact value being priced on it. */
  focus?: ProjectionTarget | null;
  /** The owner's bets panel, composed by the page (it needs page state no
   *  other panel does). Null for every other kind, and for a non-owner. */
  betsPanel?: React.ReactNode;
  /** The one-line place bar for the bet that sent the reader to this chart.
   *  Composed by the page for the same reason `betsPanel` is, and null unless
   *  the arrival came from a bets row on a live owner session. */
  placeStrip?: React.ReactNode;
}) {
  const jsonRow = card.jsonRow;

  /* One theme read for the whole panel host. `colorFor` is the exact shape
     the panels already take, so this is a swap of the resolver in, not a new
     prop path — and it is stable per theme, so a panel does not re-render on
     an unrelated parent update. */
  const isDark = useIsDark();
  const colorFor = useCallback((t: string) => displayTeamColor(t, isDark), [isDark]);

  // Sim-conditional live overlay: one fetch, only while the live panel is
  // actually open (not on every other panel kind) and only when the card
  // has a jsonRow to key the dataset path off (FCS-without-row -> null args
  // -> the hook itself resolves to null, same quiet-empty-state contract as
  // every other per-game fetch here).
  const wantLiveGrid = kind === "live" && Boolean(jsonRow);
  const liveGrid = useLiveGrid(
    wantLiveGrid ? card.ns : null,
    wantLiveGrid ? weekId : null,
    wantLiveGrid ? jsonRow!.slug : null
  );

  const title =
    kind === "scores" ? "Simulated Scores"
    : kind === "players" ? "Simulated Player Stats"
    : kind === "props" ? "Player Props"
    : kind === "box" ? "Projected Box Score"
    : kind === "teamstats" ? "Team Stats (simulated distributions)"
    : kind === "bets" ? "Suggested Bets"
    : kind === "live" ? (card.liveInProgress ? "Live Gamecast" : "Game Flow")
    : "Add Parlay Leg";

  // Same name-keyed home/away mapping as the card (neutral-site flips).
  const lv = card.live;
  const espnHomeIsA = lv ? nameMatches(lv.homeNames, lv.homeTeam, card.teamA) : true;
  const liveBits = {
    homeAbbrev: lv?.homeAbbrev,
    awayAbbrev: lv?.awayAbbrev,
    homeId: lv?.homeId,
    awayId: lv?.awayId,
    homeColor: colorFor(espnHomeIsA ? card.teamA : card.teamB),
    awayColor: colorFor(espnHomeIsA ? card.teamB : card.teamA),
    homeLogo: getTeamLogo(espnHomeIsA ? card.teamA : card.teamB) || undefined,
    awayLogo: getTeamLogo(espnHomeIsA ? card.teamB : card.teamA) || undefined,
  };

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

      {kind === "live" && lv?.id && (
        <LiveGamePanel
          eventId={lv.id}
          isLive={lv.state === "in"}
          situation={lv.situation}
          bits={liveBits}
          simHomeWinPct={
            typeof card.pHome === "number"
              ? 100 * (espnHomeIsA ? card.pHome : 1 - card.pHome)
              : undefined
          }
          liveGrid={liveGrid}
          flipToEspnHome={!espnHomeIsA}
        />
      )}
      {/* The bet that sent the reader here, placeable without navigating back.
          Above the chart, because it is the reason this panel is open. */}
      {(kind === "scores" || kind === "teamstats") && placeStrip}

      {kind === "scores" && (
        <ScoresPanel
          card={card} gdata={gdata} season={season}
          focus={focus?.kind === "scores" ? focus : null}
        />
      )}
      {kind === "players" && <PlayersPanel card={card} week={week} season={season} />}
      {/* card.hasPlayers guards these as well as the buttons: a panel can
          outlive its card's tab (deep link, stale open state). */}
      {kind === "props" && jsonRow && card.hasPlayers && (
        <PlayerProps
          row={jsonRow} season={season}
          teamA={card.teamA} teamB={card.teamB}
          colorFor={colorFor}
        />
      )}
      {kind === "box" && jsonRow && card.hasPlayers && (
        <BoxScore
          row={jsonRow} season={season}
          teamA={card.teamA} teamB={card.teamB}
          ptsA={useMean ? card.meanA : card.medA}
          ptsB={useMean ? card.meanB : card.medB}
          useMean={useMean}
          logoFor={getTeamLogo}
          colorFor={colorFor}
        />
      )}
      {/* Display only: every number comes precomputed out of team_stats.json
          (per-seed first, then aggregated). No prices, no edge math here. */}
      {kind === "teamstats" && jsonRow && card.hasPlayers && (
        <TeamStats
          slug={jsonRow.slug} ns={card.ns} weekId={weekId}
          teamA={card.teamA} teamB={card.teamB}
          kalshi={kalshi}
          colorFor={colorFor}
          logoFor={(t) => getTeamLogo(t) || undefined}
          focus={focus?.kind === "teamstats" ? focus : null}
        />
      )}
      {/* Owner-only, and already gated twice before it gets here: the page
          only builds this node for a live portal session. */}
      {kind === "bets" && betsPanel}
      {kind === "picker" && jsonRow && (
        <LegPicker
          row={jsonRow} season={season} weekId={weekId}
          teamA={card.teamA} teamB={card.teamB}
          marketSpread={card.oddsSpread} marketTotal={card.oddsTotal}
          // FCS seeds.json carries real A_pts/B_pts with an EMPTY players map,
          // so game-line legs price exactly as on FBS and only the player-prop
          // bet type is withheld.
          hasPlayers={card.hasPlayers}
          onAdd={onAddLeg} onClose={onClose}
        />
      )}
    </section>
  );
}

/* ---------------------- Simulated score distribution ----------------------
 * HOUSE GRAMMAR, the same one TeamStats.tsx is the reference for — see the
 * long note at the top of that file for why it looks like this.
 *
 * What this panel used to be: a Recharts histogram with a grid, a Y axis of
 * raw seed counts, a bin-count selector, a hover tooltip that said "Count:
 * 37", and a card underneath printing Under / At / Over with fair odds. Five
 * numbers at rest, none of them the decision, and the one thing a reader
 * actually wants — "does my side cover?" — assembled in their head.
 *
 * What it is now:
 *   ONE SHAPE on one axis. Scores are counts, so the shape is DISCRETE
 *     columns at integer-width bins and stays that way: the mass sitting on
 *     3, 7 and 10 in a spread is real decision information, and a smoothed
 *     curve would erase exactly the part a bettor is paid to see. (Continuous
 *     stats get the density silhouette instead; that lives in TeamStats.)
 *   COLOUR IS SEMANTIC, and only on the spread, where the sign is the
 *     meaning: seeds left of zero are the left team winning, so they wear the
 *     left team's brand. Totals get one fill — there is no side to a total.
 *   LINES ARE FLAGS. The book's line (where we have one) and the reader's own
 *     typed line are stems crossing the shape, labelled in the venue's own
 *     wording. Each flag carries ONE number: our probability at that line, in
 *     words ("covers 58%", "over 61%"). Everything else — the push mass, the
 *     other side, the fair odds — is one tap away in the popover.
 *   NO EDGE NUMBER. When the reader arrived from a bet, the place strip above
 *     is already showing it, and printing it twice invites the two to differ.
 *
 * The axis is measured, not fixed, for the same reason TeamStats' is: a
 * viewBox that scales turns 9px labels into 4px ones on a phone.
 */

/** One integer-width bin: `v` is its CENTRE in axis units. */
type ScoreCol = { v: number; mass: number };

/**
 * Integer-width bins over integer-valued seed scores.
 *
 * WIDTH 1 IS THE POINT, and the window is what buys it. A 10,000-seed margin
 * has a couple of 60-point blowouts at each end; drawn to the raw range that
 * is a 170-wide axis, which forces 2- or 5-point bins and erases the very
 * thing a spread bettor reads — the mass sitting on exactly 3, exactly 7,
 * exactly 10. So the axis is the MIDDLE 99%: the half a percent of seeds at
 * each end is not drawn, and the caption says so. Mass is still a fraction of
 * ALL seeds, so every column means what it says; the missing tail is missing,
 * not redistributed.
 *
 * The wider steps below survive only as a guard against a pathological range;
 * a CFB margin or total does not reach them once the window is applied.
 */
function scoreColumns(series: number[]): {
  cols: ScoreCol[]; step: number; trimmed: number;
} {
  if (!series.length) return { cols: [], step: 1, trimmed: 0 };
  const n = series.length;
  const sorted = [...series].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
  const lo = q(0.005), hi = q(0.995);
  const span = hi - lo + 1;
  const step = span <= 140 ? 1 : span <= 280 ? 2 : 5;
  const base = Math.floor(lo / step) * step;
  const counts = new Map<number, number>();
  let trimmed = 0;
  for (const x of series) {
    if (x < lo || x > hi) { trimmed++; continue; }
    const b = Math.floor((x - base) / step) * step + base;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const cols = [...counts]
    .map(([start, c]) => ({ v: start + (step - 1) / 2, mass: c / n }))
    .sort((a, b) => a.v - b.v);
  return { cols, step, trimmed: trimmed / n };
}

/** P(< L), P(= L), P(> L) over the seeds. Counts, never an approximation. */
function sideProbs(series: number[], L: number) {
  let u = 0, a = 0, o = 0;
  for (const x of series) {
    if (Math.abs(x - L) < 1e-9) a++; else if (x < L) u++; else o++;
  }
  const n = Math.max(1, series.length);
  return { under: u / n, at: a / n, over: o / n };
}

const pct0 = (p: number) => `${Math.round(p * 100)}%`;
/** U+2212 MINUS, not a hyphen: "−7.5" reads as a spread at 11px. */
const spreadWords = (L: number) => `${L > 0 ? "+" : "−"}${Math.abs(L)}`;

/** A line drawn on the shape. At most two: the book's and the reader's. */
type ScoreFlag = {
  key: string;
  x: number;
  /** The line in the venue's own wording — "−7.5", "48.5". */
  label: string;
  /** The ONE number, in words: "covers 58%" / "over 61%". */
  verdict: string;
  /** The full derivation, popover only. */
  detail: string;
  /** The book's line is dashed and muted; the reader's own is solid accent. */
  book: boolean;
  row: 0 | 1;
};

function ScoresPanel({ card, gdata, season, focus = null }: {
  card: CardGame; gdata?: GameData; season: Season;
  /** "See projection →" from a game-line bet: which tab, and the line that bet
   *  is priced at, pre-loaded into the reader's own line box so the marker is
   *  on the chart the moment it opens. */
  focus?: { metric: ScoreMetric; line?: number } | null;
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

  /* Theme-resolved, same as the card: the chart fills and the swatches below
     must both survive a dark background. */
  const isDark = useIsDark();
  const aColor = displayTeamColor(card.teamA, isDark);
  const bColor = displayTeamColor(card.teamB, isDark);

  const [metric, setMetric] = useState<Metric>("spread");
  const [teamOrder, setTeamOrder] = useState<0|1>(0);
  const [teamLine, setTeamLine] = useState<string>("");
  /** Which flag's derivation is open. Tap to open, tap again to close. */
  const [sel, setSel] = useState<string | null>(null);

  /* ---- measured width -> layout. A callback ref, not an effect on [], for
   * the reason TeamStats documents: the plot box does not exist on the first
   * render (the panel is still loading compact.json), so a one-shot read finds
   * null and the layout stays stuck at the desktop default. ---- */
  const [boxW, setBoxW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const apply = (w: number) => setBoxW((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  /* ---- PRE-FOCUS from a game-line suggestion.
   * Applied ONCE per payload, and it forces `teamOrder` back to 0 on purpose:
   * the line travels in the exporter's home-perspective convention, which is
   * the axis's convention only while the home team is on the left. Flipping
   * the sides after the jump is the reader's own choice and re-signs the axis
   * with it; silently dropping a home-perspective number onto a flipped axis
   * would put the marker on the wrong side of zero. ---- */
  const appliedFocus = useRef<string>("");
  const fMetric = focus?.metric;
  const fLine = focus?.line;
  useEffect(() => {
    if (!fMetric) return;
    const key = `${fMetric}|${fLine ?? ""}`;
    if (appliedFocus.current === key) return;
    appliedFocus.current = key;
    setMetric(fMetric);
    setTeamOrder(0);
    if (typeof fLine === "number") setTeamLine(String(fLine));
  }, [fMetric, fLine]);

  const series = useMemo(
    () => (panelData ? metricSeries(panelData, metric, teamOrder) : []),
    [panelData, metric, teamOrder]
  );
  const { cols, step, trimmed } = useMemo(() => scoreColumns(series), [series]);
  const median = useMemo(() => quantiles(series)?.med ?? null, [series]);

  const leftTeam  = teamOrder === 0 ? card.teamA : card.teamB;
  const rightTeam = teamOrder === 0 ? card.teamB : card.teamA;
  const leftColor  = (teamOrder === 0 ? (aColor ?? "var(--brand)") : (bColor ?? "var(--brand)"));
  const rightColor = (teamOrder === 0 ? (bColor ?? "var(--accent)") : (aColor ?? "var(--accent)"));

  /* ---- the two lines, in AXIS units ----
   * The book's spread is published home-perspective; the axis is written from
   * the LEFT team's side, so it negates with the swap. A total has no side and
   * never does. Per-team totals have no published book line at all. */
  const bookLine = useMemo(() => {
    if (metric === "spread" && typeof card.oddsSpread === "number") {
      return teamOrder === 0 ? card.oddsSpread : -card.oddsSpread;
    }
    if (metric === "total" && typeof card.oddsTotal === "number") return card.oddsTotal;
    return undefined;
  }, [metric, teamOrder, card.oddsSpread, card.oddsTotal]);

  const userLine = Number(teamLine);
  const hasUserLine = teamLine.trim() !== "" && Number.isFinite(userLine);

  /** One minus sign across the whole panel — U+2212, never a hyphen. */
  const axisNum = (v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v));

  /* ---- geometry ---- */
  const plotW = Math.max(280, Math.min(boxW || 900, 900));
  const narrow = plotW < 560;
  const densH = narrow ? 96 : 128;
  const BAND = 60;                       // two label rows above the shape
  const axisY = BAND + densH;
  const height = axisY + 16;
  const padL = 8, padR = 8;

  const axisSpan = useMemo(() => {
    if (!cols.length) return { min: 0, max: 1 };
    let min = cols[0].v - step / 2;
    let max = cols[cols.length - 1].v + step / 2;
    // A line outside the simulated range still has to be visible: that IS the
    // finding ("the book is off the end of our distribution"), and clipping it
    // would hide the strongest read on the chart.
    for (const L of [bookLine, hasUserLine ? userLine : undefined]) {
      if (typeof L !== "number") continue;
      min = Math.min(min, L - step);
      max = Math.max(max, L + step);
    }
    if (metric === "spread") { min = Math.min(min, 0); max = Math.max(max, 0); }
    return { min, max };
  }, [cols, step, bookLine, hasUserLine, userLine, metric]);

  const x = (v: number) =>
    padL + ((v - axisSpan.min) / Math.max(1e-9, axisSpan.max - axisSpan.min)) *
      (plotW - padL - padR);
  const peak = Math.max(1e-9, ...cols.map((c) => c.mass));
  const slot = (plotW - padL - padR) / Math.max(1e-9, (axisSpan.max - axisSpan.min) / step);
  const barW = Math.max(1, slot * 0.86);

  const colColor = (v: number) => {
    if (metric === "spread") return v < 0 ? leftColor : v > 0 ? rightColor : "var(--border)";
    if (metric === "teamLeft") return leftColor;
    if (metric === "teamRight") return rightColor;
    return "var(--brand)";
  };

  /* ---- flags ---- */
  const flags = useMemo(() => {
    if (!series.length) return [] as ScoreFlag[];
    const n = series.length;
    const make = (L: number, book: boolean): ScoreFlag => {
      const p = sideProbs(series, L);
      const label = metric === "spread" ? spreadWords(L) : String(L);
      const verdict = metric === "spread"
        ? `covers ${pct0(p.under)}`
        : `over ${pct0(p.over)}`;
      const detail = metric === "spread"
        ? `${leftTeam} ${label} \u2014 ${leftTeam} covers ${pct0(p.under)} ` +
          `(fair ${americanOdds(p.under)}) \u00b7 push ${pct0(p.at)} \u00b7 ` +
          `${rightTeam} ${spreadWords(-L)} covers ${pct0(p.over)} ` +
          `(fair ${americanOdds(p.over)}). ${n} simulated games.`
        : `${metric === "total" ? "Game total" : `${metric === "teamLeft" ? leftTeam : rightTeam} points`} ${label} \u2014 ` +
          `over ${pct0(p.over)} (fair ${americanOdds(p.over)}) \u00b7 exactly ${label} ${pct0(p.at)} \u00b7 ` +
          `under ${pct0(p.under)} (fair ${americanOdds(p.under)}). ${n} simulated games.`;
      return {
        key: book ? "book" : "yours", x: x(L), label,
        verdict, detail, book, row: 0,
      };
    };
    const out: ScoreFlag[] = [];
    if (typeof bookLine === "number") out.push(make(bookLine, true));
    if (hasUserLine) out.push(make(userLine, false));
    // Two labels 40px apart would overprint. The reader's own line keeps the
    // near row; the book's steps up.
    if (out.length === 2 && Math.abs(out[0].x - out[1].x) < 78) out[0].row = 1;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metric, bookLine, hasUserLine, userLine, leftTeam, rightTeam, plotW, axisSpan.min, axisSpan.max]);

  const selFlag = flags.find((f) => f.key === sel) ?? null;

  if (compactLoading) return <SkeletonChart height={220} />;
  if (compactError) {
    return (
      <div style={{ fontSize: 13, color: "var(--muted)", padding: 6 }}>
        Couldn&rsquo;t load the distribution: {compactError}
      </div>
    );
  }
  if (!panelData) {
    return <div style={{ fontSize: 13, color: "var(--muted)", padding: 6 }}>No simulated scores for this game.</div>;
  }

  /** The words legend, said once, so position and colour can carry the rest. */
  const legend = metric === "spread"
    ? <>Shaded columns = <strong>our simulation</strong> &middot; flags = <strong>a betting line</strong> &middot;
        the % under a flag is our chance <strong>{leftTeam}</strong> covers it.</>
    : metric === "total"
      ? <>Shaded columns = <strong>our simulation</strong> &middot; flags = <strong>a betting line</strong> &middot;
          the % under a flag is our chance the game goes <strong>Over</strong> it.</>
      : <>Shaded columns = <strong>our simulation</strong> &middot; flags = <strong>a betting line</strong> &middot;
          the % under a flag is our chance{" "}
          <strong>{metric === "teamLeft" ? leftTeam : rightTeam}</strong> goes over it.</>;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        {(["spread","total","teamLeft","teamRight"] as Metric[]).map(m => (
          <button key={m} className="ui-btn" data-on={metric===m ? "true" : "false"}
                  onClick={()=>{ setMetric(m); setSel(null); }}
                  style={{ fontSize: 12 }}>
            {m==="spread"?"Spread":m==="total"?"Total":m==="teamLeft"?`${leftTeam} total`:`${rightTeam} total`}
          </button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <button className="ui-btn" style={{ fontSize: 12 }}
                  onClick={()=>{ setTeamOrder(t=>t===0?1:0); setSel(null); }}>
            {leftTeam} vs {rightTeam}
          </button>
          {/* Label and spinner are ONE flex item: split, "Your line:" is
              orphaned on the row above the box it names at phone width. */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
            <label style={{ fontSize:12, color:"var(--muted)" }}>Your line</label>
            <NumberSpinner value={teamLine} onChange={(v) => { setTeamLine(v); setSel(null); }}
                           step={0.5} placeholder={metric==="spread" ? "-6.5" : "55.5"} width={84} />
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--text)" }}>{legend}</div>

      {/* The SPREAD's two halves are the only place colour carries identity
          here, so it is named — in words, once — rather than left for the
          reader to infer from the card above. */}
      {metric === "spread" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 10.5, color: "var(--muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden="true" style={{
              width: 9, height: 9, borderRadius: 3, background: leftColor,
              opacity: 0.55, display: "inline-block", flex: "none",
            }} />
            left of 0 = {leftTeam} wins
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden="true" style={{
              width: 9, height: 9, borderRadius: 3, background: rightColor,
              opacity: 0.55, display: "inline-block", flex: "none",
            }} />
            right of 0 = {rightTeam} wins
          </span>
        </div>
      )}

      <div ref={attachBox} style={{ position: "relative", overflowX: "hidden" }}>
        <svg width={plotW} height={height} viewBox={`0 0 ${plotW} ${height}`}
             role="img"
             aria-label={`Simulated ${metric === "spread" ? "margin" : "points"} distribution with betting lines`}
             style={{ display: "block", maxWidth: "none" }}>
          {/* PICK'EM. On a spread the sign is the whole story, so zero gets a
              hairline of its own \u2014 position then reads without a scale. */}
          {metric === "spread" && (
            <line x1={x(0)} x2={x(0)} y1={BAND} y2={axisY}
                  stroke="var(--border)" strokeWidth={1} />
          )}

          {cols.map((c) => {
            const h = (c.mass / peak) * densH;
            const left = Math.max(x(axisSpan.min), x(c.v) - barW / 2);
            const right = Math.min(x(axisSpan.max), x(c.v) + barW / 2);
            return (
              <rect key={c.v} x={left} y={axisY - h}
                    width={Math.max(1, right - left)} height={Math.max(0.6, h)}
                    fill={colColor(c.v)} opacity={0.34}
                    stroke="var(--muted)" strokeWidth={barW > 3 ? 1 : 0} strokeOpacity={0.4}>
                <title>{`${pct0(c.mass)} of games at ${step === 1 ? c.v : `${c.v - (step - 1) / 2}\u2013${c.v + (step - 1) / 2}`}`}</title>
              </rect>
            );
          })}

          {/* THE axis, drawn on top of the shape. */}
          <line x1={x(axisSpan.min)} x2={x(axisSpan.max)} y1={axisY} y2={axisY}
                stroke="var(--text)" strokeWidth={1.5} strokeLinecap="round" />
          {/* Axis numbers wear the SAME minus sign the flags do (U+2212, not a
              hyphen): "-7" and "−7.5" side by side read as two conventions. */}
          <text x={x(axisSpan.min)} y={height - 3} fontSize={9} fill="var(--muted)"
                textAnchor="start" style={{ fontVariantNumeric: "tabular-nums" }}>
            {axisNum(Math.round(axisSpan.min))}
          </text>
          {metric === "spread" && (
            <text x={x(0)} y={height - 3} fontSize={9} fill="var(--muted)" textAnchor="middle">0</text>
          )}
          <text x={x(axisSpan.max)} y={height - 3} fontSize={9} fill="var(--muted)"
                textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
            {axisNum(Math.round(axisSpan.max))}
          </text>
          {median !== null && (() => {
            // The median caption takes whichever top corner has no flag near
            // it: at a low line the two labels collide at phone width.
            const crowdedLeft = flags.some((f) => f.x < plotW / 2);
            return (
              <text x={crowdedLeft ? plotW - padR : padL} y={BAND + 11}
                    fontSize={10} fill="var(--muted)"
                    textAnchor={crowdedLeft ? "end" : "start"}>
                {`median ${axisNum(Math.round(median))}`}
              </text>
            );
          })()}

          {/* FLAGS: one stem crossing the shape, two label rows outside it, so
              no text is ever set on a coloured fill. */}
          {flags.map((f) => {
            const on = f.key === sel;
            const top = f.row === 0 ? BAND : BAND - 26;
            const tone = f.book ? "var(--muted)" : "var(--accent)";
            return (
              <g key={f.key} style={{ cursor: "pointer" }}
                 onClick={() => setSel(on ? null : f.key)}>
                <line x1={f.x} x2={f.x} y1={axisY} y2={top}
                      stroke={tone} strokeWidth={on ? 2.5 : f.book ? 1 : 2}
                      strokeDasharray={f.book ? "4 3" : undefined} />
                <circle cx={f.x} cy={axisY} r={f.book ? 2.5 : 3.5} fill={tone} />
                <text x={f.x} y={top - 15} fontSize={10.5} fontWeight={800}
                      textAnchor="middle" fill={tone}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {f.label}
                </text>
                <text x={f.x} y={top - 3} fontSize={f.book ? 10 : 11.5}
                      fontWeight={f.book ? 700 : 800} textAnchor="middle"
                      fill={f.book ? "var(--muted)" : "var(--text)"}>
                  {f.verdict}
                </text>
                {/* >=40px tap target, invisible */}
                <rect x={f.x - 20} y={top - 28} width={40} height={axisY - top + 28}
                      fill="transparent">
                  <title>{f.detail}</title>
                </rect>
              </g>
            );
          })}
        </svg>

        {selFlag && (
          <div role="status" style={{
            position: "absolute",
            left: Math.min(Math.max(4, selFlag.x - 150), Math.max(4, plotW - 300)),
            top: 2, zIndex: 2, maxWidth: 300,
            background: "var(--card)", border: "1px solid var(--brand)",
            borderRadius: 8, padding: "7px 9px", fontSize: 11.5, lineHeight: 1.45,
            color: "var(--text)", boxShadow: "0 4px 14px var(--shadow)",
          }}>
            {selFlag.detail}
            <button type="button" className="ui-btn" onClick={() => setSel(null)}
                    style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10.5 }}>
              Close
            </button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
        {series.length.toLocaleString()} simulated games, one column per
        {step === 1 ? " point" : ` ${step} points`}
        {trimmed > 0.0001 ? ", middle 99% of the range shown" : ""}.
        {typeof bookLine === "number"
          ? " The dashed flag is the book's line; tap either flag for the full read."
          : " Type a line above to mark it."}
      </div>
    </div>
  );
}

/* ------------- Legacy CSV-season player sims (per-seed CSV path) ----------- */
function PlayersPanel({ card, week, season }: {
  card: CardGame; week: string; season: Season;
}) {
  const isDark = useIsDark();
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

  /* Resolved once per (team, theme) rather than inside the Cell map below —
     the histogram is 20 bars and every one of them wanted the same colour. */
  const pColor = displayTeamColor(pTeam, isDark) ?? "var(--brand)";

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
                  {pHist.map((_,i)=><Cell key={i} fill={pColor} />)}
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
