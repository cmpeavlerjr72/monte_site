// the CFB home tile and feeds them to the shared Value-rule helper
// (lib/valueRecord.ts). Nothing is hard-coded: every week in the 2026 season
// index that has a lines.json is read, and a game counts once ESPN has it
// final. Finals come from the site's own /api/finals (compact completed games
// per date, reduced server-side from the cached ESPN scoreboard), joined to the
// week index by ESPN event id (the index's game_id) and oriented by team id.
// The week summaries carry no finals until a re-publish, so they are not used.
//
// Finished weeks never change, so their finals are kept in localStorage (per
// week, keyed by the lines file's generated_at); the newest week is re-read.

import { getCatalog } from "./cfbData";
import { getJsonWeekIndex } from "./cfbJson";
import { fetchWeekLines } from "./weekLines";
import { seasonValue, type SeasonValue, type ValueGame } from "./valueRecord";

const SEASON = "2026";
const LS_PREFIX = "valueseason:v2:";

type FinalsMap = Record<string, [number, number] | null>;

const lsGet = (k: string): { gen: string; finals: FinalsMap } | null => {
  try { const s = localStorage.getItem(LS_PREFIX + k); return s ? JSON.parse(s) : null; } catch { return null; }
};
const lsSet = (k: string, v: { gen: string; finals: FinalsMap }) => {
  try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch { /* private mode / quota */ }
};

export type ValueSeasonLoad = SeasonValue & { throughWeek: string | null; weeks: number };

let memo: Promise<ValueSeasonLoad> | null = null;

export function loadValueSeason(): Promise<ValueSeasonLoad> {
  if (!memo) memo = compute().catch((e) => { memo = null; throw e; });
  return memo;
}

type Fin = { homeId: string; hs: number; awayId: string; as: number };

/** Completed games for these ESPN dates: event id -> teams and scores. */
export async function fetchFinals(dates: string[]): Promise<Map<string, Fin>> {
  const out = new Map<string, Fin>();
  if (!dates.length) return out;
  try {
    const res = await fetch(`/api/finals?sport=cfb&dates=${dates.join(",")}`);
    if (!res.ok) return out;
    const json = await res.json();
    for (const rows of Object.values(json?.dates ?? {}) as any[][]) {
      for (const [id, homeId, hs, awayId, as] of rows) out.set(String(id), { homeId: String(homeId), hs, awayId: String(awayId), as });
    }
  } catch { /* the week just has no finals yet */ }
  return out;
}

async function compute(): Promise<ValueSeasonLoad> {
  const catalog = await getCatalog(SEASON);
  const weeks = [...catalog.weeks].sort((a, b) => a.week - b.week);
  const newest = weeks[weeks.length - 1]?.id;
  const all: ValueGame[] = [];
  let through: string | null = null;
  let counted = 0;

  for (const w of weeks) {
    const lines = await fetchWeekLines(SEASON, w.id);
    if (!lines) continue;
    const priced = Object.entries(lines.games).filter(([, g]) => g.sim);
    if (!priced.length) continue;

    let finals: FinalsMap | null = null;
    const cached = w.id !== newest ? lsGet(w.id) : null;
    if (cached && cached.gen === lines.generated_at) finals = cached.finals;
    if (!finals) {
      const rows = (await getJsonWeekIndex(w.id, SEASON)) ?? [];
      const dates = [...new Set(rows.map((r) => String(r.date ?? "").replace(/-/g, "")).filter((d) => /^\d{8}$/.test(d)))];
      const byEvent = await fetchFinals(dates);
      finals = {};
      let complete = true;
      for (const r of rows) {
        if (!lines.games[r.slug]?.sim) continue;
        const f = r.game_id ? byEvent.get(String(r.game_id)) : undefined;
        if (!f) { finals[r.slug] = null; complete = false; continue; }
        const aIsHome = r.A_espn_id ? String(r.A_espn_id) === f.homeId : true;
        finals[r.slug] = aIsHome ? [f.hs, f.as] : [f.as, f.hs];
      }
      if (w.id !== newest && complete) lsSet(w.id, { gen: lines.generated_at, finals });
    }

    let any = false;
    for (const [slug, lg] of priced) {
      const f = finals[slug];
      if (!f) continue; // not final yet: not a graded game
      all.push({ lg, price: lines.spread_total_price, fin: { A: f[0], B: f[1] } });
      any = true;
    }
    if (any) { through = w.id; counted++; }
  }
  return { ...seasonValue(all, "open"), throughWeek: through, weeks: counted };
}
