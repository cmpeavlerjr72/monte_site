// Team-name normalization for the Kalshi <-> slate join.
//
// Lives in its own module (rather than inside liveScores.ts) for one reason:
// it is pure, so it can be checked against the real school lists without
// starting a server. `node scripts/check_fcs_names.mjs` imports the COMPILED
// dist/cfbNames.js and asserts, over all 138 FBS + 128 FCS schools:
//
//   1. no two different schools normalize to the same key (a collision would
//      silently price the wrong game),
//   2. every "X State" school still matches Kalshi's "X St." spelling,
//   3. every FBS key is byte-identical to the pre-FCS implementation.
//
// Rule of the file: BOTH sides of the join are normalized by this one
// function, so a normalization only has to be CONSISTENT, not linguistically
// correct ("St. Thomas" -> "statethomas" is fine, because Kalshi's spelling of
// the same school lands on the same string). What it must never do is collapse
// two DIFFERENT schools onto one key — which is why parentheticals are NOT
// stripped generically: "Miami (OH)" and "Miami" are different teams.

/**
 * Key shared with the client's nameKey, plus the normalizations Kalshi's
 * naming forces:
 *   - accent folding                 "San José State" -> sanjosestate
 *   - the "St."/"St" abbreviation    "Florida St."    -> floridastate
 *     (\b keeps "Stanford", "Stetson", "Stephen F. Austin" untouched)
 *   - the "Saint" spelling           "Saint Thomas"   -> statethomas
 *   - a dropped "University"         "Long Island University" -> longisland
 *
 * The St. rule is what makes the whole FCS slate join for free: every one of
 * the 25 FCS "... State" schools matches Kalshi's "... St." with no alias.
 */
export function cfbNameKey(s: string): string {
  const base = String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // José -> Jose
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst\.?\b/g, " state ")  // trailing "St."; \b keeps Stanford safe
    .replace(/\bsaint\b/g, " state ")  // "Saint Thomas" == "St. Thomas"
    .replace(/\buniversity\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  return KALSHI_TEAM_ALIASES[base] ?? base;
}

/**
 * Canonical forms where Kalshi and the sim disagree on the school's name.
 *
 * Only for cases the generic rules above cannot reach. Each entry maps an
 * alternate key onto the key our own slate produces; both sides run through
 * cfbNameKey, so listing either spelling is enough. The FCS block was added
 * with the 2026 FCS slate — every one of them is proven collision-free
 * against all 266 FBS+FCS schools by scripts/check_fcs_names.mjs.
 */
export const KALSHI_TEAM_ALIASES: Record<string, string> = {
  // --- FBS (unchanged) ---
  ncstate: "northcarolinastate",
  nc: "northcarolina",
  southerncal: "usc",
  southerncalifornia: "usc",
  hawaii: "hawaii",
  miamifl: "miami",
  miamiflorida: "miami",
  louisianalafayette: "louisiana",
  // "&" expands to " and ", so "Texas A&M" keys as texasAandm (two a's). The
  // original target here was "texasandm", which no school produces — the alias
  // was dead. Corrected, so Kalshi's un-ampersanded "Texas AM" now matches.
  texasam: "texasaandm",

  // --- FCS 2026: our slate's spelling is on the RIGHT ---
  // "St. Thomas (MN)" carries a state qualifier Kalshi drops. Stripping
  // parentheticals generically is not an option (it would merge Miami (OH)
  // into Miami), so this one school gets an alias.
  statethomasmn: "statethomas",
  // Initialisms Kalshi prefers over the full school name.
  liu: "longisland",
  utrgv: "utriograndevalley",
  uapb: "arkansaspinebluff",
  uiw: "incarnateword",
  // Same "&" -> " and " expansion: "North Carolina A&T" keys as ...aandt.
  ncat: "northcarolinaaandt",                // "NCAT" / "NC AT"
  ncaandt: "northcarolinaaandt",             // "NC A&T"
  // Longer/shorter spellings of the same school.
  albany: "ualbany",
  citadel: "thecitadel",
  penn: "pennsylvania",
  southeasternlouisiana: "selouisiana",
  tennesseemartin: "utmartin",
  gramblingstate: "grambling",
  prairieview: "prairieviewaandm",           // Kalshi drops the "A&M"
  prairieviewam: "prairieviewaandm",         // ... or writes it without the "&"
};

/** Unordered team-pair key for matching a Kalshi event to one of our games. */
export const pairKeyOf = (a: string, b: string) =>
  [cfbNameKey(a), cfbNameKey(b)].sort().join("__");
