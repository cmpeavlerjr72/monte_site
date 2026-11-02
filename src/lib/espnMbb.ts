// src/lib/espnMbb.ts
//
// ESPN men's-college-basketball game summary for the live drawer: linescore
// by half / OT, team stats (FG, 3PT, FT, REB, AST, TO, fouls), box score,
// the last plays, and ESPN's own win-probability series. Fetched ONLY while a
// drawer is open (the hook lives in the drawer component), through the same
// refcounted poller the football drawer uses (espnGame.ts useEspnJson): one
// call per poll, 20 s while the game is live, a single fetch once final.
//
// Not on the feed (checked on a live event 2026-11-02): possession, timeouts,
// bonus status, per-half team fouls. Those are simply not shown.

import { useMemo } from "react";
import { useEspnJson } from "./espnGame";

const MBB_SITE_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

export type MbbTeam = {
  id: string; homeAway: "home" | "away"; abbrev?: string; name?: string; logo?: string;
  score?: number; linescores: number[];
};
export type MbbBoxPlayer = {
  id: string; name: string; short: string; jersey?: string; starter: boolean;
  min?: number; pts?: number; reb?: number; ast?: number; to?: number; pf?: number;
  fg?: string; fg3?: string; ft?: string;
};
export type MbbPlay = { id: string; text: string; period?: number; clock?: string; home?: number; away?: number; scoring: boolean };
export type MbbSummary = {
  state: "pre" | "in" | "post";
  period?: number; clock?: string; detail?: string;
  home?: MbbTeam; away?: MbbTeam;
  /** Team stat display values by ESPN team id: { fg: "13-20", fouls: "9", ... } */
  stats: Record<string, Record<string, string>>;
  box: { teamId: string; players: MbbBoxPlayer[] }[];
  plays: MbbPlay[];
  /** ESPN P(home win), 0..1, oldest first. */
  winProb: number[];
};

const STAT_KEYS: Record<string, string> = {
  "fieldGoalsMade-fieldGoalsAttempted": "fg",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "fg3",
  "freeThrowsMade-freeThrowsAttempted": "ft",
  totalRebounds: "reb", assists: "ast", steals: "stl", blocks: "blk",
  totalTurnovers: "to", fouls: "fouls", pointsInPaint: "paint", fastBreakPoints: "fastBreak",
  turnoverPoints: "offTo", largestLead: "largestLead", leadChanges: "leadChanges",
};

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? undefined : n;
};

function parseTeam(c: any): MbbTeam {
  return {
    id: String(c?.team?.id ?? c?.id ?? ""),
    homeAway: c?.homeAway === "home" ? "home" : "away",
    abbrev: c?.team?.abbreviation, name: c?.team?.shortDisplayName ?? c?.team?.displayName,
    logo: c?.team?.logos?.[0]?.href ?? c?.team?.logo,
    score: num(c?.score),
    linescores: Array.isArray(c?.linescores) ? c.linescores.map((l: any) => num(l?.displayValue ?? l?.value) ?? 0) : [],
  };
}

export function parseMbbSummary(json: any): MbbSummary {
  const comp = json?.header?.competitions?.[0];
  const st = comp?.status;
  const rawState = String(st?.type?.state ?? "").toLowerCase();
  const state = rawState === "post" || st?.type?.completed ? "post" : rawState === "in" ? "in" : "pre";
  const comps: any[] = comp?.competitors ?? [];
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");

  const stats: MbbSummary["stats"] = {};
  for (const t of json?.boxscore?.teams ?? []) {
    const row: Record<string, string> = {};
    for (const s of t?.statistics ?? []) {
      const k = STAT_KEYS[s?.name];
      if (k && s.displayValue !== undefined) row[k] = String(s.displayValue);
    }
    stats[String(t?.team?.id)] = row;
  }

  const box: MbbSummary["box"] = [];
  for (const tp of json?.boxscore?.players ?? []) {
    const grp = tp?.statistics?.[0];
    const keys: string[] = grp?.keys ?? [];
    const at = (a: any, k: string) => { const i = keys.indexOf(k); return i >= 0 ? a?.stats?.[i] : undefined; };
    const players: MbbBoxPlayer[] = [];
    for (const a of grp?.athletes ?? []) {
      if (!a?.stats?.length || a.didNotPlay) continue;
      players.push({
        id: String(a?.athlete?.id ?? ""), name: String(a?.athlete?.displayName ?? ""),
        short: String(a?.athlete?.shortName ?? a?.athlete?.displayName ?? ""),
        jersey: a?.athlete?.jersey, starter: Boolean(a?.starter),
        min: num(at(a, "minutes")), pts: num(at(a, "points")), reb: num(at(a, "rebounds")),
        ast: num(at(a, "assists")), to: num(at(a, "turnovers")), pf: num(at(a, "fouls")),
        fg: at(a, "fieldGoalsMade-fieldGoalsAttempted"),
        fg3: at(a, "threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
        ft: at(a, "freeThrowsMade-freeThrowsAttempted"),
      });
    }
    box.push({ teamId: String(tp?.team?.id), players });
  }

  const plays: MbbPlay[] = (json?.plays ?? []).map((p: any) => ({
    id: String(p?.id ?? ""), text: String(p?.text ?? ""),
    period: num(p?.period?.number), clock: p?.clock?.displayValue,
    home: num(p?.homeScore), away: num(p?.awayScore), scoring: Boolean(p?.scoringPlay),
  }));

  return {
    state, period: num(st?.period), clock: st?.displayClock,
    detail: st?.type?.shortDetail ?? st?.type?.detail,
    home: home ? parseTeam(home) : undefined, away: away ? parseTeam(away) : undefined,
    stats, box, plays,
    winProb: (json?.winprobability ?? []).map((w: any) => num(w?.homeWinPercentage)).filter((x: number | undefined): x is number => x !== undefined),
  };
}

/** Summary for one event. `live` polls every 20 s (shared with any other
 *  subscriber to the same URL); otherwise one fetch. null eventId fetches nothing. */
export function useMbbSummary(eventId?: string, live?: boolean): MbbSummary | null {
  const url = eventId ? `${MBB_SITE_API}/summary?event=${eventId}` : null;
  const raw = useEspnJson(url, live ? 20_000 : null, null);
  return useMemo(() => (raw ? parseMbbSummary(raw) : null), [raw]);
}
