// src/lib/upNextCbb.ts: data for the basketball home page's ticker band, the
// same band football shows (components/site/ScoreTicker.tsx), fed by the day
// index instead of the week index.
//
// Selection rules mirror football's (upNext.ts) and the board's own
// `defaultPeriod` for basketball:
//   - the day is TODAY in US/Eastern when the season index lists it, else the
//     nearest published day (ties go to the future: a preseason viewer wants
//     opening night, not an empty strip);
//   - within the day, games in kickoff order: the next N that are not done
//     (done = about 4 h after tip, or final on the live feed), else the last N.

import { CBB_SEASONS, getCatalog } from "./cfbData";
import { getGameSummaryCached, getJsonWeekIndex, type JsonWeekRow } from "./cfbJson";
import { todayET } from "./seasons";
import type { UpNext, UpNextGame } from "./upNext";

/** A game is "done" for this strip about 4 h after tip. */
export const DONE_AFTER_MS = 4 * 60 * 60 * 1000;

const dayDiff = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;

/** Which published day the band shows. Same rule as the board's default period. */
export function pickCbbDay<T extends { date?: string }>(days: T[], today: string): T | null {
  if (!days.length) return null;
  const exact = days.find((d) => d.date === today);
  if (exact) return exact;
  let best = days[days.length - 1];
  let bestD = Infinity;
  for (const d of days) {
    if (!d.date) continue;
    const diff = Math.abs(dayDiff(d.date, today));
    if (diff < bestD || (diff === bestD && d.date > today)) { best = d; bestD = diff; }
  }
  return best;
}

/** The games the band shows, in kickoff order. `isDone` lets the live feed
 *  retire a final earlier than the 4 h clock and keep a long game in. */
export function selectBandRows<T extends { time_utc?: string }>(
  rows: T[], nowMs: number, n: number, isDone?: (r: T) => boolean | undefined,
): T[] {
  const sorted = [...rows].sort((a, b) => String(a.time_utc ?? "").localeCompare(String(b.time_utc ?? "")));
  const done = (r: T) => {
    const live = isDone?.(r);
    if (live !== undefined) return live;
    return Boolean(r.time_utc) && Date.parse(r.time_utc as string) + DONE_AFTER_MS <= nowMs;
  };
  const pending = sorted.filter((r) => !done(r));
  return pending.length ? pending.slice(0, n) : sorted.slice(-n);
}

export type UpNextCbb = UpNext & { ns: string; date: string; rows: JsonWeekRow[] };

const memo = new Map<number, Promise<UpNextCbb>>();

/** Every row of today's day (the band picks which to show once the live feed is in). */
export function loadUpNextCbb(maxRows = 400): Promise<UpNextCbb> {
  const hit = memo.get(maxRows);
  if (hit) return hit;
  const ns = CBB_SEASONS[0];
  const p = (async () => {
    const catalog = await getCatalog(ns);
    const day = pickCbbDay(catalog.weeks, todayET());
    if (!day) throw new Error("no basketball day published");
    const rows = ((await getJsonWeekIndex(day.id, ns)) ?? []).slice(0, maxRows);
    return { ns, date: day.date ?? day.id, weekId: day.id, weekLabel: day.label, rows, games: [] as UpNextGame[] };
  })().catch((e) => { memo.delete(maxRows); throw e; });
  memo.set(maxRows, p);
  return p;
}

/** One band entry from a row + its summary (sim numbers and verified finals). */
export async function bandGame(r: JsonWeekRow, ns: string): Promise<UpNextGame> {
  const s = await getGameSummaryCached(r, ns).catch(() => null);
  const fh = s?.finalA ?? null, fa = s?.finalB ?? null;
  return {
    slug: r.slug, gameId: r.game_id, home: r.teamA, away: r.teamB, kickoff: r.time_utc,
    projHome: s?.median_A_pts ?? null, projAway: s?.median_B_pts ?? null, winHome: s?.A_win_prob ?? null,
    final: fh != null && fa != null, finalHome: fh, finalAway: fa,
  };
}
