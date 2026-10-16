// src/lib/upNext.ts: the homepage's "up next on the board" strip (2026-10-16).
//
// The newest published 2026 week, its games in kickoff order, and the next N
// that have not finished (or the last N if the whole slate is done). Only
// those N summary.json files are fetched (through the board's own memoised
// loader), never the whole slate: the homepage is not the board.

import { getCatalog, latestWeek } from "./cfbData";
import { getGameSummaryCached, getJsonWeekIndex } from "./cfbJson";

export type UpNextGame = {
  slug: string; gameId?: string; home: string; away: string; kickoff?: string;
  projHome: number | null; projAway: number | null; winHome: number | null;
  final: boolean; finalHome: number | null; finalAway: number | null;
};
export type UpNext = { weekId: string; weekLabel: string; games: UpNextGame[] };

const SEASON = "2026";
/** A game is "done" for this strip about 4h after kickoff. */
const DONE_AFTER_MS = 4 * 60 * 60 * 1000;

let memo: Promise<UpNext> | null = null;

export function loadUpNext(n = 6): Promise<UpNext> {
  if (memo) return memo;
  memo = (async () => {
    const catalog = await getCatalog(SEASON);
    const wk = latestWeek(catalog);
    if (!wk) throw new Error("no 2026 week published");
    const rows = (await getJsonWeekIndex(wk.id, SEASON)) ?? [];
    const sorted = [...rows].sort((a, b) => String(a.time_utc ?? "").localeCompare(String(b.time_utc ?? "")));
    const now = Date.now();
    const pending = sorted.filter((r) => !r.time_utc || Date.parse(r.time_utc) + DONE_AFTER_MS > now);
    const pick = (pending.length ? pending.slice(0, n) : sorted.slice(-n));
    const games = await Promise.all(pick.map(async (r): Promise<UpNextGame> => {
      const s = await getGameSummaryCached(r, SEASON).catch(() => null);
      const fh = s?.finalA ?? null, fa = s?.finalB ?? null;
      return {
        slug: r.slug, gameId: r.game_id, home: r.teamA, away: r.teamB, kickoff: r.time_utc,
        projHome: s?.median_A_pts ?? null, projAway: s?.median_B_pts ?? null,
        winHome: s?.A_win_prob ?? null,
        final: fh != null && fa != null, finalHome: fh, finalAway: fa,
      };
    }));
    return { weekId: wk.id, weekLabel: wk.label || `Week ${wk.week}`, games };
  })().catch((e) => { memo = null; throw e; });
  return memo;
}
