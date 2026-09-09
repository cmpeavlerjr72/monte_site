// src/lib/betWords.ts
//
// THE BET IN AS FEW CHARACTERS AS ARE STILL TRUE.
//
// Owner, 2026-09-09: "on the scoreboard page, and anywhere else where we show
// the my book bets, mimic the way we use the logos to replace the team
// abbreviation and we don't need the word points or total."
//
// So there is ONE re-speller for every surface that shows a bet — the network
// feed, the scoreboard's book strip, the per-game Bets panel, the resting
// review, the dashboard — instead of the four near-identical ones that grew up
// beside each other. `src/components/BetLabel.tsx` is its display half (the
// team's LOGO in place of the team's NAME); this file is the words half.
//
// IT IS A RE-SPELLING, NEVER AN EDIT. No fact is added, dropped or rounded:
// "points" and the bare word "total" go because a number on a bet slip is
// already points and the market family is already known from where the row is
// standing. Everything the reader could not reconstruct — the team, the line,
// the side, the stat, the period — stays, and the untouched sentence is one
// hover away in every caller (BetLabel puts it in the `title`).
//
// WHAT MUST SURVIVE, and is regression-tested by reading these lines:
//   "Rutgers over 23.5 points"      -> "Rutgers o23.5"
//   "Under 55.5 points"             -> "u55.5"
//   "Total o51.5"       (cheerLabel) -> "o51.5"
//   "Auburn 425+ total yds"          -> "Auburn 425+ total yds"   <- NOT "yds"
//   "UNLV under 4 TDs"               -> "UNLV u4 TDs"
//   "Memphis to win"                 -> "Memphis ML"
//   "Nicholls -21.5"                 -> "Nicholls −21.5"          <- true minus
//   "Over 51.5 · Nicholls @ Texas"   -> "o51.5"  (given those two names)
//   "Bo Nix over 274.5 passing yards"-> "Bo Nix o274.5 pass yds"  <- a name is
//                                        words, always: only TEAMS become logos

/** A regex-safe copy of a team name (school names carry dots and parentheses:
 *  "Ohio St.", "Miami (OH)"). */
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Drop the matchup a total's label carries as its identity.
 *
 * `cheerLabelWithGame` spells a game total "Over 51.5 · Nicholls @ Texas"
 * because a total's ticker names no team at all and a settled row needed to
 * say WHICH game it was. On a surface that draws the two schools as logos that
 * suffix is the same fact twice, so it comes off — and ONLY when both names
 * were handed in and both actually appear, so a label this does not recognise
 * is never truncated on a guess.
 */
function stripMatchup(s: string, home?: string | null, away?: string | null): string {
  const h = String(home ?? "").trim();
  const a = String(away ?? "").trim();
  if (!h || !a) return s;
  const re = new RegExp(`\\s*[·|@-]?\\s*${esc(a)}\\s*(?:@|at|vs\\.?)\\s*${esc(h)}\\s*$`, "i");
  const cut = s.replace(re, "").trim();
  return cut || s;
}

/**
 * THE BET AS A GLYPH STRING.
 *
 * `home`/`away` are optional and are used for ONE thing: recognising (and
 * removing) a trailing matchup that the display is about to draw as logos.
 * Nothing else here knows about teams — the team prefix is left exactly as it
 * was written so `BetLabel` can match it and swap in the logo.
 *
 * Idempotent: running it over its own output changes nothing, which is what
 * lets a caller hand it a label some other layer already compacted.
 */
export function compactBetWords(
  title: string | null | undefined,
  home?: string | null,
  away?: string | null,
): string {
  const raw = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return stripMatchup(raw, home, away)
    // Side words become the glyphs a bettor reads them as.
    .replace(/\bover\s+/gi, "o")
    .replace(/\bunder\s+/gi, "u")
    // "wins by o6.5" is what "wins by over 6.5 points" has become by now: that
    // is a spread, and a spread is written as a line.
    .replace(/\bwins by o/gi, "−")
    .replace(/\bmoneyline\b/gi, "ML")
    .replace(/\bto win\b/gi, "ML")
    .replace(/\bwins\b\s*$/i, "ML")
    // THE TWO WORDS THE OWNER ASKED FOR. "points" is what every number on a
    // football bet slip is; the bare "total" is the market family, which the
    // surface itself already says. "total yds" is a STAT NAME, not the family,
    // so the lookahead keeps it — dropping it would turn "Auburn 425+ total
    // yds" into a rushing/receiving/total ambiguity.
    .replace(/\s*\bpoints?\b/gi, "")
    .replace(/\btotals?\b(?!\s*(?:yds|yards))\s*/gi, "")
    // Periods stay, short. A half or a quarter is a different bet from the
    // game and the tag is the only thing that says so.
    .replace(/\b(?:1st|first)\s+half\b/gi, "1H")
    .replace(/\b(?:2nd|second)\s+half\b/gi, "2H")
    .replace(/\b(?:1st|first)\s+quarter\b/gi, "Q1")
    .replace(/\b(?:2nd|second)\s+quarter\b/gi, "Q2")
    .replace(/\b(?:3rd|third)\s+quarter\b/gi, "Q3")
    .replace(/\b(?:4th|fourth)\s+quarter\b/gi, "Q4")
    // Stat words in the same vocabulary `cheerLabel` already writes them in
    // (kalshiPortal's STAT_WORDS), so a prop and a team market read alike.
    .replace(/\bpassing yards\b/gi, "pass yds")
    .replace(/\brushing yards\b/gi, "rush yds")
    .replace(/\breceiving yards\b/gi, "rec yds")
    .replace(/\byards\b/gi, "yds")
    .replace(/\btouchdowns?\b/gi, "TDs")
    // A minus in front of a number is a MINUS SIGN, not a hyphen.
    .replace(/(^|\s)-(?=\d)/g, "$1−")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Does `words` open with `team`? Returns what follows it, or null.
 *
 * Prefix-only on purpose: "Rutgers 24+" is Rutgers' bet, "Memphis under 4 TDs
 * against Rutgers" is not Rutgers'. A label that merely MENTIONS a school
 * keeps its words rather than being handed the wrong logo.
 */
export function teamPrefixRest(words: string, team: string | null | undefined): string | null {
  const t = String(team ?? "").trim();
  if (!t || t.length < 3) return null;
  if (!words.toLowerCase().startsWith(t.toLowerCase())) return null;
  return words.slice(t.length).trim();
}
