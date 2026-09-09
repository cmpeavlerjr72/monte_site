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

// THE SPORT IS A GLYPH, THE LEAGUE IS THE TOOLTIP (owner 2026-09-09). On a
// feed row the reader is glancing, and "FCS FOOTBALL" spelled out beside a bet
// out-shouts the bet. So the chip is one emoji — the SPORT — and the league is
// the title text a hover or a long-press reveals. Two football leagues share
// one ball and two basketball leagues share one hoop precisely because the
// distinction is a word, not a picture, and words are for the tap.
const LEAGUE_EMOJI: Record<LeagueId, string> = {
  fbs: "\u{1F3C8}",
  fcs: "\u{1F3C8}",
  ncaab: "\u{1F3C0}",
  ncaaw: "\u{1F3C0}",
};

/** The one-glyph chip for a stored id, or null when there is nothing honest to
 *  show. Always render it with `leagueLabel(id)` as the tooltip: the emoji
 *  alone cannot tell FBS from FCS, and it is not meant to. */
export function leagueEmoji(id: string | null | undefined): string | null {
  if (!id) return null;
  return LEAGUE_EMOJI[id as LeagueId] ?? null;
}

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
