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
  description?: string;
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
  return {
    teamAbbrev: d.team?.abbreviation || undefined,
    teamId: idOrU(d.team?.id),
    description: d.description || undefined,
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
  return {
    state: json?.header?.competitions?.[0]?.status?.type?.state,
    drive: parseDrive(curRaw),
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

/** Poll a JSON URL while mounted; pollMs=null fetches exactly once. */
function useEspnJson(url: string | null, pollMs: number | null) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function pull() {
      try {
        const r = await fetch(url as string, { cache: "no-cache" });
        if (r.ok) {
          const j = await r.json();
          if (!cancelled) setData(j);
        }
      } catch {
        /* transient network error — keep the last good payload */
      }
      if (!cancelled && pollMs) timer = setTimeout(pull, pollMs);
    }
    pull();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, pollMs]);
  return data;
}

export function useGameSummary(eventId?: string, live?: boolean): GameSummaryLite | null {
  const url = eventId ? `${SITE_API}/summary?event=${eventId}` : null;
  const raw = useEspnJson(url, live ? 20_000 : null);
  return useMemo(() => (raw ? parseSummaryLite(raw) : null), [raw]);
}

export function useGameProbabilities(eventId?: string, live?: boolean): ProbPoint[] | null {
  const url = eventId
    ? `${CORE_API}/events/${eventId}/competitions/${eventId}/probabilities?limit=1000`
    : null;
  const raw = useEspnJson(url, live ? 30_000 : null);
  return useMemo(() => (raw ? parseProbabilities(raw) : null), [raw]);
}
