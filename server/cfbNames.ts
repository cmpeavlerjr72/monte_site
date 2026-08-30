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
  // Live 2026-08-30, wk1 slate (user caught both as cards with no Kalshi
  // info): Kalshi writes "UMass" where CFBD's slate says "Massachusetts",
  // and "Louisiana-Monroe" where the slate says "UL Monroe". Same two
  // misses existed in the sim repo's kalshi_team_edges TEAM_ALIAS (fixed
  // there the same day, commit f566d2d).
  umass: "massachusetts",
  louisianamonroe: "ulmonroe",
  // Live 2026-08-30, FCS wk1 (user caught two cards without bet buttons):
  // Kalshi's hyphenated "Tennessee-Martin" for our "UT Martin", and
  // mascot-suffixed titles on exactly these events ("Chicago State
  // Cougars", "West Florida Argonauts") — Kalshi appends mascots on SOME
  // FCS titles only. The FCS snapshot puller grew a generic trailing-word
  // fallback the same night; here the observed forms are aliased exactly.
  tennesseemartin: "utmartin",
  chicagostatecougars: "chicagostate",
  westfloridaargonauts: "westflorida",

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
  // Kalshi's full form is "University at Albany" (live 2026-08-28,
  // KXNCAAFGAME-26AUG28UNHALBY): the generic "university" strip leaves the
  // preposition behind, so the key lands on "atalbany" — reachable by
  // neither the bare-"albany" alias above nor the slate's "UAlbany". The
  // user caught it as a card with no Kalshi info at all.
  atalbany: "ualbany",
  // Kalshi writes "Central Connecticut St." but our slate's school (CFBD
  // spelling) is just "Central Connecticut" — no State suffix to expand
  // into. Live 2026-08-28, KXNCAAFGAME-26AUG29CCSUSDAK (user caught the
  // card with no Kalshi info, same symptom as UAlbany above).
  centralconnecticutstate: "centralconnecticut",
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
