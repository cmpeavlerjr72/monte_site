// src/lib/espnGame.ts
//
// ESPN gamecast data for a single game, in three tiers:
//   1. `parseSituation` — the scoreboard event's `situation` block (ball spot,
//      down & distance, possession). Free with the scoreboard poll the page
//      already runs; powers the per-card field strip for EVERY live game.
//   2. `useGameSummary` — the per-game summary feed (current drive with its
//      play-by-play, plus the sportsbook line). Fetched only while a game's
//      panel is open.
//   3. `useGameProbabilities` — the core-API probabilities series: ESPN's
//      win% AND spread-cover% AND total-over% after every play. This is the
//      only endpoint that carries cover/over; the summary's `winprobability`
//      array has win% alone.
//
// All three hosts answer with `Access-Control-Allow-Origin: *` (verified
// 2026-08-27), so the browser fetches ESPN directly — same precedent as
// useEspnScoreboard. Yard lines in this feed are ABSOLUTE 0–100 with the HOME
// goal line at 0 (verified against play text: home team's own 35 → 35, away
// team's own 20 → 80).

import { useEffect, useMemo, useState } from "react";
import { dataUrl, SEASONS } from "./cfbData";
import { parseLiveTeamStats, type LiveTeamStats } from "./liveProgress";

const SITE_API =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const CORE_API =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

/** -1 → attacking the home goal line (yardLine 0); +1 → attacking 100. */
export type AttackDir = -1 | 1;

export type LiveSituation = {
  /** Absolute ball spot, 0–100, home goal line = 0. */
  yardLine?: number;
  down?: number;
  distance?: number;
  downDistanceText?: string;
  shortDownDistanceText?: string;
  /** ESPN team id of the offense. */
  possessionId?: string;
  isRedZone?: boolean;
  homeTimeouts?: number;
  awayTimeouts?: number;
  lastPlayText?: string;
  attackDir?: AttackDir;
  /** ESPN's live win model, P(home) in 0–100. */
  homeWinPct?: number;
};

const numOrU = (v: any): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const idOrU = (v: any): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

/**
 * Direction of attack from the last play's movement. The scoreboard situation
 * carries no yards-to-endzone, so this is inferred: positive yardage that
 * moved the absolute spot DOWN means the offense attacks the home goal line.
 * Returns undefined on any ambiguity (no gain, spot unchanged, possession
 * changed on the play) — callers must render without an arrow in that case.
 */
function inferAttackDir(lastPlay: any, possessionId?: string): AttackDir | undefined {
  const s = numOrU(lastPlay?.start?.yardLine);
  const e = numOrU(lastPlay?.end?.yardLine);
  const y = numOrU(lastPlay?.statYardage);
  const playTeam = idOrU(lastPlay?.team?.id);
  if (s === undefined || e === undefined || y === undefined) return undefined;
  if (y === 0 || e === s) return undefined;
  if (possessionId && playTeam && possessionId !== playTeam) return undefined;
  const moved: AttackDir = e < s ? -1 : 1;
  return y > 0 ? moved : moved === -1 ? 1 : -1;
}

/** Parse the `situation` block off a scoreboard event's competition. */
export function parseSituation(comp: any): LiveSituation | undefined {
  const sit = comp?.situation;
  if (!sit || typeof sit !== "object") return undefined;
  const possessionId = idOrU(sit.possession);
  const lastPlay = sit.lastPlay;
  const p = lastPlay?.probability?.homeWinPercentage;
  return {
    yardLine: numOrU(sit.yardLine),
    down: numOrU(sit.down),
    distance: numOrU(sit.distance),
    downDistanceText: sit.downDistanceText || undefined,
    shortDownDistanceText: sit.shortDownDistanceText || undefined,
    possessionId,
    isRedZone: Boolean(sit.isRedZone),
    homeTimeouts: numOrU(sit.homeTimeouts),
    awayTimeouts: numOrU(sit.awayTimeouts),
    lastPlayText: lastPlay?.text || undefined,
    attackDir: inferAttackDir(lastPlay, possessionId),
    homeWinPct: typeof p === "number" ? 100 * p : undefined,
  };
}

/* ------------------------------ game summary ------------------------------ */

export type DrivePlay = {
  id: string;
  text: string;
  typeAbbrev?: string;
  scoring?: boolean;
  startYL?: number;
  endYL?: number;
  /** "1st & 10 at ME 20" — the pre-snap state of THIS play. */
  startDD?: string;
  yardsToEndzone?: number;
};

export type CurrentDrive = {
  teamAbbrev?: string;
  teamId?: string;
  teamLogo?: string;
  description?: string;
  /** ESPN's drive result, e.g. "Punt", "Touchdown", "Interception". */
  result?: string;
  isScore?: boolean;
  /** Score after the drive's last play. */
  scoreHome?: number;
  scoreAway?: number;
  plays: DrivePlay[];
  attackDir?: AttackDir;
  /** Ball spot after the drive's last play. */
  ballYL?: number;
};

export type PlayRef = {
  text: string;
  home?: number;
  away?: number;
  period?: number;
  clock?: string;
};

export type GameSummaryLite = {
  state?: string; // pre | in | post
  drive?: CurrentDrive;
  /** Every drive in game order (oldest first), for the drive log. */
  drives: CurrentDrive[];
  /** Every play in the game by id — the probabilities series joins on this. */
  playText: Map<string, PlayRef>;
  /** Sportsbook line, e.g. "TOW -2.5" (home-perspective spread). */
  pickDetails?: string;
  spread?: number;
  overUnder?: number;
};

function parseDrive(d: any): CurrentDrive | undefined {
  if (!d) return undefined;
  const plays: DrivePlay[] = (Array.isArray(d.plays) ? d.plays : []).map((pl: any) => ({
    id: String(pl?.id ?? ""),
    text: pl?.text ?? "",
    typeAbbrev: pl?.type?.abbreviation || undefined,
    scoring: Boolean(pl?.scoringPlay),
    startYL: numOrU(pl?.start?.yardLine),
    endYL: numOrU(pl?.end?.yardLine),
    startDD: pl?.start?.downDistanceText || undefined,
    yardsToEndzone: numOrU(pl?.end?.yardsToEndzone),
  }));

  // Attack direction, exactly: yards-to-endzone equal to the absolute spot
  // means the offense attacks the home goal line at 0; equal to its mirror
  // means the away goal line. Midfield (50) is ambiguous — walk back until a
  // play disambiguates.
  let dir: AttackDir | undefined;
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (p.endYL === undefined || p.yardsToEndzone === undefined || p.endYL === 50) continue;
    if (p.yardsToEndzone === p.endYL) { dir = -1; break; }
    if (p.yardsToEndzone === 100 - p.endYL) { dir = 1; break; }
  }

  const last = plays.length ? plays[plays.length - 1] : undefined;
  const lastRaw = Array.isArray(d.plays) && d.plays.length ? d.plays[d.plays.length - 1] : undefined;
  return {
    teamAbbrev: d.team?.abbreviation || undefined,
    teamId: idOrU(d.team?.id),
    teamLogo: d.team?.logos?.[0]?.href || undefined,
    description: d.description || undefined,
    result: d.displayResult || d.shortDisplayResult || undefined,
    isScore: Boolean(d.isScore),
    scoreHome: numOrU(lastRaw?.homeScore),
    scoreAway: numOrU(lastRaw?.awayScore),
    plays,
    attackDir: dir,
    ballYL: last?.endYL,
  };
}

export function parseSummaryLite(json: any): GameSummaryLite {
  const drives = json?.drives;
  // Between possessions `current` can be missing or empty; the last completed
  // drive is the honest thing to show in that window.
  const prev: any[] = Array.isArray(drives?.previous) ? drives.previous : [];
  const curRaw =
    drives?.current?.plays?.length ? drives.current : prev.length ? prev[prev.length - 1] : undefined;

  const playText = new Map<string, PlayRef>();
  for (const d of [...prev, drives?.current]) {
    for (const pl of d?.plays ?? []) {
      if (pl?.id === undefined) continue;
      playText.set(String(pl.id), {
        text: pl.text ?? "",
        home: numOrU(pl.homeScore),
        away: numOrU(pl.awayScore),
        period: numOrU(pl.period?.number),
        clock: pl.clock?.displayValue || undefined,
      });
    }
  }

  const pc = Array.isArray(json?.pickcenter) ? json.pickcenter[0] : undefined;

  const allDrives: CurrentDrive[] = [];
  for (const d of prev) {
    const pd = parseDrive(d);
    if (pd) allDrives.push(pd);
  }
  if (drives?.current?.plays?.length) {
    const cd = parseDrive(drives.current);
    // `current` can also be the just-finished drive still sitting in
    // `previous` — dedupe on the drive's first play id.
    const firstId = cd?.plays[0]?.id;
    if (cd && !(firstId && allDrives.some((d) => d.plays[0]?.id === firstId))) {
      allDrives.push(cd);
    }
  }

  return {
    state: json?.header?.competitions?.[0]?.status?.type?.state,
    drive: parseDrive(curRaw),
    drives: allDrives,
    playText,
    pickDetails: pc?.details || undefined,
    spread: numOrU(pc?.spread),
    overUnder: numOrU(pc?.overUnder),
  };
}

/* ----------------------------- probabilities ------------------------------ */

export type ProbPoint = {
  seq: number;
  playId?: string;
  secondsLeft: number;
  /** All in 0–100. */
  homeWin: number;
  coverHome?: number;
  overPct?: number;
};

export function parseProbabilities(json: any): ProbPoint[] {
  const items: any[] = Array.isArray(json?.items) ? json.items : [];
  const pts: ProbPoint[] = [];
  for (const it of items) {
    const hw = it?.homeWinPercentage;
    if (typeof hw !== "number") continue;
    const ref = String(it?.$ref ?? "");
    const playId = ref.split("/probabilities/")[1]?.split("?")[0] || undefined;
    pts.push({
      seq: Number(it?.sequenceNumber ?? 0),
      playId,
      secondsLeft: numOrU(it?.secondsLeft) ?? 0,
      homeWin: 100 * hw,
      coverHome:
        typeof it?.spreadCoverProbHome === "number" ? 100 * it.spreadCoverProbHome : undefined,
      overPct: typeof it?.totalOverProb === "number" ? 100 * it.totalOverProb : undefined,
    });
  }
  pts.sort((a, b) => a.seq - b.seq);
  return pts;
}

/* --------------------------------- hooks ---------------------------------- */

/* Published-snapshot fallback for networks that block espn.com (2026-08-28
 * "work computer" incident). publish_espn_snapshots.py (sim repo) writes
 * `espn/gamecast/<eventId>.json` = {summary, probabilities} for every FINAL
 * game onto the current season's dataset, served SAME-ORIGIN via /api/data.
 * One fetch per event, shared by both hooks (each file is ~0.5MB); a null
 * result is not cached so a game that finals later can be retried. */
const SNAPSHOT_NS = SEASONS[0];
const gamecastSnapCache = new Map<string, Promise<any | null>>();

/** Exported for the /test-gamecast harness, whose bootstrap fetch needs the
 *  same blocked-network fallback the hooks have. */
export function gamecastSnapshot(eventId: string): Promise<any | null> {
  let p = gamecastSnapCache.get(eventId);
  if (!p) {
    p = (async () => {
      try {
        const url = await dataUrl(`espn/gamecast/${eventId}.json`, SNAPSHOT_NS);
        const r = await fetch(url, { cache: "no-cache" });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    })().then((j) => {
      if (j == null) gamecastSnapCache.delete(eventId);
      return j;
    });
    gamecastSnapCache.set(eventId, p);
  }
  return p;
}

/* ------------------- ONE fetch loop per (url, cadence) --------------------
 *
 * The per-event summary is ~130KB and more than one surface now wants it: the
 * Live panel's drive log, and (2026-08-29) every card tracking a held stat
 * position's progress. A hook-local loop each would mean two identical polls
 * of the same document on the same game, so the loop is REFCOUNTED here and
 * the hooks are subscribers. A late subscriber is handed the cached payload
 * immediately, so opening a panel over a card that is already polling paints
 * with no fetch at all.
 *
 * The entry is dropped when its last subscriber leaves — the cache is a
 * live-poll detail, not a store. Nothing here is keyed on an object identity
 * (rule 4): the key is `url|pollMs|snapKey`, all primitives. */
type JsonPoller = {
  subs: Set<(d: any) => void>;
  data: any | null;
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  snapshotApplied: boolean;
};
const jsonPollers = new Map<string, JsonPoller>();

function subscribeEspnJson(
  url: string,
  pollMs: number | null,
  snapKey: string | null,
  cb: (d: any) => void,
): () => void {
  const key = `${url}|${pollMs ?? 0}|${snapKey ?? ""}`;
  const existing = jsonPollers.get(key);
  const entry: JsonPoller =
    existing ?? { subs: new Set(), data: null, stopped: false, snapshotApplied: false };
  if (!existing) jsonPollers.set(key, entry);
  entry.subs.add(cb);
  if (entry.data !== null) cb(entry.data);

  if (!existing) {
    const emit = (d: any) => {
      if (entry.stopped) return;
      entry.data = d;
      for (const s of entry.subs) s(d);
    };
    const trySnapshot = async () => {
      if (!snapKey || entry.snapshotApplied) return;
      const [eid, field] = snapKey.split(":");
      const part = (await gamecastSnapshot(eid))?.[field];
      if (part && !entry.stopped) {
        entry.snapshotApplied = true;
        emit(part);
      }
    };
    const pull = async () => {
      try {
        const r = await fetch(url, { cache: "no-cache" });
        if (r.ok) emit(await r.json());
        else await trySnapshot();
      } catch {
        await trySnapshot();
        /* transient network error — keep the last good payload */
      }
      if (!entry.stopped && pollMs) entry.timer = setTimeout(pull, pollMs);
    };
    pull();
  }

  return () => {
    entry.subs.delete(cb);
    if (entry.subs.size === 0) {
      entry.stopped = true;
      if (entry.timer) clearTimeout(entry.timer);
      jsonPollers.delete(key);
    }
  };
}

/** Poll a JSON URL while mounted; pollMs=null fetches exactly once.
 *  `snapKey` ("<eventId>:summary" | "<eventId>:probabilities") names the
 *  branch of the published gamecast snapshot to fall back to when ESPN is
 *  unreachable — a primitive, so it is rule-4 safe as an effect dependency. */
function useEspnJson(url: string | null, pollMs: number | null, snapKey?: string | null) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    return subscribeEspnJson(url, pollMs ?? null, snapKey ?? null, setData);
  }, [url, pollMs, snapKey]);
  return data;
}

export function useGameSummary(eventId?: string, live?: boolean): GameSummaryLite | null {
  const url = eventId ? `${SITE_API}/summary?event=${eventId}` : null;
  const raw = useEspnJson(url, live ? 20_000 : null, eventId ? `${eventId}:summary` : null);
  return useMemo(() => (raw ? parseSummaryLite(raw) : null), [raw]);
}

/**
 * LIVE TEAM STAT READINGS off the same per-event summary — the numbers a held
 * per-team stat market settles on (see lib/liveProgress.ts for the settlement
 * rules and why the value is a player sum).
 *
 * It shares `useGameSummary`'s poller exactly: same URL, same cadence, same
 * snapshot fallback, so a card tracking a bet and an open Live panel on that
 * game cost ONE fetch between them. Pass `eventId` undefined to fetch nothing
 * — that is how a caller gates the poll on "the owner actually holds something
 * trackable on a game that is under way".
 */
export function useGameTeamStats(eventId?: string, live?: boolean): LiveTeamStats | null {
  const url = eventId ? `${SITE_API}/summary?event=${eventId}` : null;
  const raw = useEspnJson(url, live ? 20_000 : null, eventId ? `${eventId}:summary` : null);
  return useMemo(() => (raw ? parseLiveTeamStats(raw) : null), [raw]);
}

export function useGameProbabilities(eventId?: string, live?: boolean): ProbPoint[] | null {
  const url = eventId
    ? `${CORE_API}/events/${eventId}/competitions/${eventId}/probabilities?limit=1000`
    : null;
  const raw = useEspnJson(url, live ? 30_000 : null, eventId ? `${eventId}:probabilities` : null);
  return useMemo(() => (raw ? parseProbabilities(raw) : null), [raw]);
}
