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

/* ------------------- the ticker's live join (basketball home) -------------------
 * One compact record per ESPN event, indexed by team-id pair (primary) and name
 * pair (fallback), then looked up per day-index row. Same id-first rule as the
 * board's getCardLive. */
export type TickLive = {
  state: "pre" | "in" | "final";
  /** ESPN's short status ("7:55 - 1st", "Halftime", "Final"). */
  text: string;
  homeId?: string; awayId?: string;
  homeScore?: number; awayScore?: number;
  homeNames: string[]; awayNames: string[];
};

const scoreOf = (v: unknown): number | undefined => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : n;
};

export function tickLiveOfEvent(e: any, status: { state: "pre" | "in" | "final"; halftime: boolean }): TickLive {
  const comp = e?.competitions?.[0];
  const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
  const type = comp?.status?.type ?? e?.status?.type ?? {};
  return {
    state: status.state,
    text: status.halftime ? "Halftime" : String(type.shortDetail || type.detail || (status.state === "final" ? "Final" : "")),
    homeId: home?.team?.id != null ? String(home.team.id) : undefined,
    awayId: away?.team?.id != null ? String(away.team.id) : undefined,
    homeScore: scoreOf(home?.score), awayScore: scoreOf(away?.score),
    homeNames: nameForms(home?.team), awayNames: nameForms(away?.team),
  };
}

export type TickLiveIndex = { byIds: Map<string, TickLive>; byNames: Map<string, TickLive> };

export function indexTickLive(games: TickLive[]): TickLiveIndex {
  const byIds = new Map<string, TickLive>(), byNames = new Map<string, TickLive>();
  for (const g of games) {
    const k = pairIdsKey(g.awayId, g.homeId);
    if (k && !byIds.has(k)) byIds.set(k, g);
    for (const h of g.homeNames) for (const a of g.awayNames) {
      const nk = pairKey(a, h);
      if (!byNames.has(nk)) byNames.set(nk, g);
    }
  }
  return { byIds, byNames };
}

/** Live record for one index row (ESPN ids first, names second) with the scores
 *  turned into the row's A (sim home) / B orientation. */
export function findTickLive(
  idx: TickLiveIndex,
  row: { teamA: string; teamB: string; A_espn_id?: string | number | null; B_espn_id?: string | number | null },
): { live: TickLive; scoreA?: number; scoreB?: number } | undefined {
  const ik = pairIdsKey(row.A_espn_id, row.B_espn_id);
  const live = (ik ? idx.byIds.get(ik) : undefined) ?? idx.byNames.get(pairKey(row.teamA, row.teamB));
  if (!live) return undefined;
  const homeIsA = espnHomeIsAOf({ homeId: live.homeId, homeNames: live.homeNames }, row.teamA, row.A_espn_id);
  return {
    live,
    scoreA: homeIsA ? live.homeScore : live.awayScore,
    scoreB: homeIsA ? live.awayScore : live.homeScore,
  };
}
