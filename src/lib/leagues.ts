// src/lib/leagues.ts
//
// WHICH LEAGUE A BET IS ON — one map, every surface.
//
// The account, the Kalshi book and the friend graph are sport-agnostic: NCAAB
// arrives next season on the same account, and a feed that says "placed 1
// unit on Duke -6.5" without saying which sport is a feed that will confuse
// people the week both seasons overlap. So every placement carries a league
// id, `app_orders.sport` stores it, and this file is the only place that turns
// an id into words.
//
// ADDING A LEAGUE IS ONE LINE. The stored ids are deliberately short and
// stable — they are in a database column, so renaming one is a migration, not
// an edit here.
//
// NULL IS A REAL ANSWER: every row placed before 2026-09-09 has no league, and
// an unlabelled bet gets NO CHIP rather than a guessed one.

export type LeagueId = "fbs" | "fcs" | "ncaab" | "ncaaw";

const LEAGUE_LABEL: Record<LeagueId, string> = {
  fbs: "FBS Football",
  fcs: "FCS Football",
  ncaab: "NCAAB",
  ncaaw: "NCAAW",
};

/** The display string for a stored id, or null when there is nothing honest to
 *  print (absent, empty, or an id this build does not know). */
export function leagueLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return LEAGUE_LABEL[id as LeagueId] ?? null;
}

/** The CFB slate is two divisions in one board; a card knows which dataset it
 *  came from. Anything else is not a college-football card and gets no id. */
export function leagueForDivision(division: string | null | undefined): LeagueId | undefined {
  const d = String(division ?? "").trim().toLowerCase();
  if (d === "fcs") return "fcs";
  if (d === "fbs" || d === "") return "fbs";
  return undefined;
}
