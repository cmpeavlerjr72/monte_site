// src/lib/liveJoin.ts
//
// Joining ESPN scoreboard events to our cards: ESPN team ids first (our
// basketball A_espn_id / B_espn_id ARE ESPN ids; the classic page's
// pairIdsKey), name forms as the fallback. Pure functions, unit-tested in
// scripts/check_live_cbb.mjs.

export const clean = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.?\b/g, "state")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Order-free ESPN team-id pair ("2511::2737"), "" when either id is missing. */
export const pairIdsKey = (a?: string | number | null, b?: string | number | null) =>
  !a || !b ? "" : [String(a), String(b)].sort().join("::");

export const pairKey = (a?: string, b?: string) => {
  const aa = clean(a), bb = clean(b);
  return [aa, bb].sort().join("::");
};

/** Does any of a live team's name forms match this sim name? ESPN's
 *  shortDisplayName alone loses ("ETSU", "LIU", "SE Missouri State"), so
 *  every orientation check runs over the full variant list. */
export const nameMatches = (
  names: string[] | undefined,
  fallback: string | undefined,
  target?: string
) => {
  const t = clean(target);
  if (!t) return false;
  const pool = names && names.length ? names : [fallback ?? ""];
  return pool.some((n) => clean(n) === t);
};

/** Is ESPN's HOME team our teamA? By ESPN team id when we have it (neutral-site
 *  swaps included), else by name forms. */
export const espnHomeIsAOf = (
  lv: { homeId?: string; homeNames?: string[]; homeTeam?: string },
  teamA: string,
  aEspnId?: number | string | null,
): boolean =>
  aEspnId && lv.homeId ? String(aEspnId) === lv.homeId : nameMatches(lv.homeNames, lv.homeTeam, teamA);


export function nameForms(team: any): string[] {
  const out: string[] = [];
  for (const n of [team?.shortDisplayName, team?.location, team?.displayName]) {
    if (typeof n === "string" && n && !out.includes(n)) out.push(n);
  }
  return out;
}
