/**
 * Scoreboard search (owner 2026-10-12: "a search bar in the scoreboard page
 * so that we can look for stuff easily").
 *
 * What a card can be found by:
 *   - both team names, plus the usual shorthand for the words in them
 *     ("ga tech", "bama", "miss st", "n texas") — computed from the name, so
 *     FCS teams that are not in team_info.csv get it too;
 *   - team_info.csv for the team: mascot ("yellow jackets"), ESPN abbreviation
 *     ("GASO"), alternate names, conference ("sec", "sun belt") and the home
 *     venue (stadium, city, state);
 *   - the kickoff label ("sat", "7:30", "fri").
 *
 * Matching: every whitespace token of the query must hit, in any order. A
 * token hits when it is the prefix of some word of the card's text; tokens of
 * three or more characters also hit as a substring of any whole name
 * ("bama" → Alabama, "southern" → Georgia Southern). Prefix-first keeps short
 * tokens honest: "gt" finds Georgia Tech through its initialism, not
 * Washington through the "gt" buried in the middle of it.
 */
export type TeamSearchIndex = Record<string, string>;

const TEAM_KEYS = ["team", "Team", "school", "School", "name", "Name"];
const TEXT_COLS = [
  "Mascot", "Abbreviation", "AlternateNames", "Conference", "conference",
  "Location Name", "Location City", "Location State",
  "short_name", "Short Name", "alias", "Alias",
];

/** Lowercase alphanumerics only; "&" → "and", "St." → "state". Identical to
 *  utils/teamLogo normTeamKey, inlined so this module stays asset-free. */
function squash(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.\b/g, "state")
    .replace(/[^a-z0-9]+/g, "");
}

/** How people shorten the words in a school name. Keys are whole words. */
const WORD_SHORTHAND: Record<string, string[]> = {
  georgia: ["ga"], florida: ["fla", "fl"], alabama: ["ala", "bama"],
  mississippi: ["miss"], tennessee: ["tenn"], carolina: ["car"],
  michigan: ["mich"], washington: ["wash"], oklahoma: ["okla", "ou"],
  arkansas: ["ark"], louisiana: ["la"], virginia: ["va"], kentucky: ["ky"],
  pennsylvania: ["penn", "pa"], texas: ["tex", "tx"], california: ["cal"],
  arizona: ["ariz", "az"], colorado: ["colo"], illinois: ["ill"],
  indiana: ["ind"], wisconsin: ["wis", "wisc"], minnesota: ["minn"],
  missouri: ["mizzou", "mo"], nebraska: ["neb"], oregon: ["ore"],
  nevada: ["nev"], connecticut: ["conn"], massachusetts: ["mass"],
  maryland: ["md"], state: ["st"], north: ["n"], south: ["s"],
  east: ["e"], west: ["w"], northern: ["n"], southern: ["s"],
  eastern: ["e"], western: ["w"], central: ["c"], international: ["intl"],
  university: ["u"], tech: ["t"], college: ["c"], mountain: ["mtn"],
  saint: ["st"], "st.": ["saint", "st"], fort: ["ft"],
};

/** Words a name search can be found by: each word, the squashed whole name,
 *  and the initialism of a multi-word name ("gt", "usc", "ucf"). `shorthand`
 *  adds the WORD_SHORTHAND forms — for TEAM NAMES only. Conference and venue
 *  text never gets it: "Missouri Valley" must not answer to "mizzou". */
function nameWords(name: string, shorthand: boolean): string[] {
  const raw = (name || "").toLowerCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of raw) {
    const sq = squash(w);
    if (sq) out.push(sq);
    // "A&M" → "am" as well as "aandm", so "texas am" finds the Aggies.
    if (w.includes("&")) { const bare = squash(w.replace(/&/g, "")); if (bare) out.push(bare); }
    if (shorthand) for (const alt of WORD_SHORTHAND[w] ?? WORD_SHORTHAND[sq] ?? []) out.push(alt);
  }
  if (raw.length >= 2) {
    out.push(squash(name));
    if (name.includes("&")) out.push(squash(name.replace(/&/g, "")));
    out.push(raw.map((w) => squash(w)[0]).filter(Boolean).join(""));
  }
  return out;
}

export function buildTeamSearchIndex(rows: Array<Record<string, any> | null | undefined>): TeamSearchIndex {
  const out: TeamSearchIndex = {};
  for (const r of rows) {
    if (!r) continue;
    const name = TEAM_KEYS.map((k) => r[k]).find((v) => v != null && String(v).trim() !== "");
    if (!name) continue;
    const teamName = String(name).trim();
    const parts: string[] = [];
    for (const k of TEXT_COLS) {
      const v = r[k];
      if (v != null && String(v).trim() !== "") parts.push(String(v).trim());
    }
    // AlternateNames is a comma list; each entry is a name in its own right.
    const text = parts.join(",");
    out[squash(teamName)] = text;
    out[squash(teamName.replace(/\s+/g, ""))] = text;
  }
  return out;
}

export function teamSearchText(index: TeamSearchIndex, team?: string): string {
  if (!team) return "";
  return index[squash(team)] ?? index[squash(team.replace(/\s+/g, ""))] ?? "";
}

const NOISE = new Set(["vs", "v", "at", "the", "and"]);

/** Query → squashed tokens; "vs", "@", "at" are dropped so "gt vs duke" works. */
export function queryTokens(query: string): string[] {
  return (query || "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => squash(t))
    .filter((t) => t && !NOISE.has(t));
}

/** Everything a card can be found by, built once per card per index. */
export function cardSearchWords(
  index: TeamSearchIndex,
  card: { teamA: string; teamB: string; kickoffLabel?: string; division?: string },
): { words: string[]; names: string[] } {
  const words: string[] = [];
  const names: string[] = [];
  for (const team of [card.teamA, card.teamB]) {
    words.push(...nameWords(team, true));
    names.push(squash(team));
    if (team.includes("&")) names.push(squash(team.replace(/&/g, "")));
    for (const entry of teamSearchText(index, team).split(",")) {
      const e = entry.trim();
      if (!e) continue;
      words.push(...nameWords(e, false));
      names.push(squash(e));
      if (e.includes("&")) names.push(squash(e.replace(/&/g, "")));
    }
  }
  if (card.kickoffLabel) words.push(...nameWords(card.kickoffLabel, false));
  if (card.division) words.push(squash(card.division));
  return { words, names };
}

export function matchesTokens(tokens: string[], w: { words: string[]; names: string[] }): boolean {
  for (const t of tokens) {
    let hit = false;
    for (const word of w.words) if (word.startsWith(t)) { hit = true; break; }
    if (!hit && t.length >= 3) for (const n of w.names) if (n.includes(t)) { hit = true; break; }
    if (!hit) return false;
  }
  return true;
}
