// src/lib/edgeRules.ts
//
// THE WEEK-2 DECISION RULES, for the contracts this site prices ITSELF.
//
// ---------------------------------------------------------------------------
// What this is, and what it is emphatically not
// ---------------------------------------------------------------------------
// Nothing here scales, shades, blends or multiplies a sim probability, a price
// or an edge. Every function below either (a) marks a contract NOT TRADEABLE
// with a reason string, or (b) decides whether the ★ TARGET label is earned.
// The owner's standing rule (2026-08-30) holds without exception:
//
//     STARS AND ABSTENTIONS ARE LABELS, NEVER A FILTER THAT HIDES ROWS.
//
// An abstained row still renders, still carries its price and its net edge,
// and still has a working Place button. It renders MUTED with the reason in
// words on tap, because the owner decides.
//
// ---------------------------------------------------------------------------
// Where the rules come from
// ---------------------------------------------------------------------------
// cfb-props-sim `scripts/kalshi_team_edges.py`, the `WEEK-2 DECISION RULES`
// block + `apply_wk2_rules` / `_is_target`. THE PYTHON IS THE SOURCE, exactly
// as it is for the TAIL band and the timing bands: if this module and that
// script ever disagree about a label, the script is right and this file is the
// bug. The evidence is `docs/tests/wk1_kalshi_board_scorecard_2026-09-07.md`
// (headline + sec 4 regime cuts) and `wk1_game_markets_scorecard_2026-09-07.md`
// sec 8, one week of settlement.
//
// The one-line summary of that week: the sim's PROBABILITIES were not what
// failed — Brier beat the market mid on several families. What failed was
// WHICH CONTRACTS WE ACTED ON. The whole tradeable board at the realistic
// early-week entry modelled +24.3% and realized −9.2%; the EV ≥ 0.10 slice,
// week 0's profitable cut, realized −13.8% on a modelled +46.9%. Bigger
// modelled edge did not mean better return. What DID separate was the REGIME:
// by the sportsbook's OPEN spread band the board returned 3–7 +5% (n=320),
// 7–14 +16% (n=279), 14–24 −8% (n=561), 24+ −27% (n=556).
//
// ---------------------------------------------------------------------------
// Why this module exists at all (the site is not covered by that script)
// ---------------------------------------------------------------------------
// `kalshi_team_edges.py` prices the per-team stat families and the half/period
// families and publishes them as team_markets.json. It does NOT price the
// full-game winner / spread / total ladders — those are computed HERE, on the
// client, by `gameCandidates` (src/lib/suggestedBets.ts) against the published
// `game` block. So the rules had to be written a second time for the surfaces
// that do their own pricing: the per-game Bets panel, its rung wheel, the
// browse ladders, and the Top Edges game-lines table.
//
// ---------------------------------------------------------------------------
// The two regime inputs, and where the site gets them
// ---------------------------------------------------------------------------
// OPEN SPREAD — `summary.json` → `odds.spread_open`, HOME PERSPECTIVE
// (negative = home favoured), the consensus across `provider_count` books.
// Already parsed by cfbJson.ts and already on every card, so this costs no
// fetch. It is the same convention and the same number the Python's
// `load_game_regime` reads out of lines_2026_snapshots.parquet — checked on
// the live week-1 slate against that function's own worked example: Ohio State
// −50.5 v Ball State, Rutgers −30.5 v Massachusetts.
//   NOT `spread_current`. The rules were measured on the OPEN, and the site's
//   standing benchmark is the open (bets go in Mon/Tue/Wed). A card elsewhere
//   falls back `spread_open ?? spread_current`; this one must not.
//   (weeks/weekNN/lines.json would be the richer source, but it is published
//   per week AFTER the slate and 404s for a live week — see weekLines.ts.)
//
// GAME CLASS — the conference of each team, out of `FBS_CONFERENCE`
// (src/lib/fbsConferences.ts, generated from team_info.csv, keyed by the
// site's one name normalizer). `gameClassFor` reproduces `gclass` in
// grade_kalshi_board.py exactly.
//
// ---------------------------------------------------------------------------
// FCS: the one deliberate divergence from the Python
// ---------------------------------------------------------------------------
// The FCS namespace has NEITHER input. Its summaries carry
// `provider_count: 0` and a null `spread_open` (no book prices that board),
// and its schools are not in an FBS conference table. Under the Python's rule
// ("unknown regime is not a free pass — no cell, so no star") every FCS row on
// the site would silently lose its star, which is a filter by accident on a
// division the week-1 grade never measured.
//
// So the axis is explicit: `regimeFor` returns `axis: "measured"` where the
// rules were graded and the inputs exist (FBS), and `axis: "unavailable"`
// where the rule set structurally does not reach (FCS). On an unavailable
// axis nothing abstains and the star falls back to R4 alone — the price band
// plus the existing ≥10¢ net-edge bar, i.e. what the site already did.
// On a MEASURED axis a missing input is still not a free pass: an FBS game
// with no published open spread gets no cell and therefore no star, exactly as
// the Python has it. A missing input must never be the reason a bar gets
// EASIER on a board the rules were measured on.

import { cfbNameKey } from "../../server/cfbNames";
import { FBS_CONFERENCE, FBS_SCHOOLS } from "./fbsConferences";

/* ------------------------------- constants -------------------------------- */
/** R1 / R3: |open spread| at or above this is a MISMATCH. */
export const MISMATCH_SPREAD = 14.0;
/** R4: the owner's live price filter. Star-only — never a suppression. */
export const STAR_ASK_LO = 0.15;
export const STAR_ASK_HI = 0.90;
/** R3: the `spread:3-14` cell. The +16% (n=279) 7–14 band sits inside it. */
export const SPREAD_CELL_LO = 3.0;
export const SPREAD_CELL_HI = 14.0;
/** R3/R4 secondary condition — the site's existing ≥10¢ net-edge star bar. */
export const TARGET_EDGE = 0.10;

const EPS = 1e-9;

const P4_CONFS = new Set(["ACC", "Big Ten", "Big 12", "SEC"]);
const INDY_CONFS = new Set(["FBS Independents"]);

/** Kalshi series this module knows how to label. */
export const SERIES_GAME = "KXNCAAFGAME";
export const SERIES_SPREAD = "KXNCAAFSPREAD";
export const SERIES_TOTAL = "KXNCAAFTOTAL";
export const SERIES_TEAMTOTAL = "KXNCAAFTEAMTOTAL";

/** Every SPREAD-shaped family R1's dog-side rule applies to. The half
 *  families are here because the rule is about the CONTRACT, not the surface —
 *  this site does not price them today, and the label must still be right the
 *  day it does. */
const SPREAD_SERIES = new Set([SERIES_SPREAD, "KXNCAAF1HSPREAD", "KXNCAAF2HSPREAD"]);

/**
 * Half/period-specific families. The owner does not bet these (decision
 * 2026-09-07), so NO half-market row is ever starred — on this site's own
 * pricing or on a published team_markets.json row.
 */
export const HALF_SERIES = new Set([
  "KXNCAAF1H", "KXNCAAF2H", "KXNCAAF1HFT",
  "KXNCAAF1HSPREAD", "KXNCAAF2HSPREAD",
  "KXNCAAF1HTOTAL", "KXNCAAF2HTOTAL",
]);

/* -------------------------------- the regime ------------------------------ */
export type GameClass =
  | "bodybag (P4 host v non-P4)"
  | "P4 v P4"
  | "G5 v G5"
  | "non-P4 host v P4";

export type GameRegime = {
  /** Home-perspective consensus OPEN spread; negative = home favoured. */
  openSpread: number | null;
  gameClass: GameClass | null;
  /** |open spread| >= 14 OR the class is a bodybag. */
  mismatch: boolean;
  /** Both inputs present — the Python's `known`. Gates every R3 cell. */
  known: boolean;
  /**
   * "measured" = the board the week-1 grade covers and whose inputs exist
   * (FBS). "unavailable" = a division the rule set does not reach (FCS: no
   * book line, no conference table) — see the header.
   */
  axis: "measured" | "unavailable";
};

/** The regime of a game with no inputs at all. */
export const UNKNOWN_REGIME: GameRegime = {
  openSpread: null, gameClass: null, mismatch: false, known: false,
  axis: "unavailable",
};

/** Re-exported so the offline guard can assert every school still places
 *  without re-parsing (or re-typing) the CSV. */
export { FBS_SCHOOLS };

/** CFBD conference for a school, or null when it is not an FBS team. */
export const conferenceFor = (team: string): string | null =>
  FBS_CONFERENCE[cfbNameKey(team)] ?? null;

const isP4 = (conf: string | null): boolean =>
  conf !== null && (P4_CONFS.has(conf) || INDY_CONFS.has(conf));

/**
 * `gclass` from cfb-props-sim's grade_kalshi_board.py, verbatim in behaviour.
 * A team we cannot place returns null — never a guess.
 */
export function gameClassFor(home: string, away: string): GameClass | null {
  const h = conferenceFor(home);
  const a = conferenceFor(away);
  if (h === null || a === null) return null;
  const hp4 = isP4(h);
  const ap4 = isP4(a);
  if (hp4 && !ap4) return "bodybag (P4 host v non-P4)";
  if (hp4 && ap4) return "P4 v P4";
  if (!hp4 && !ap4) return "G5 v G5";
  return "non-P4 host v P4";
}

/**
 * One game's regime.
 *
 * `openSpread` MUST be `summary.odds.spread_open` — the open, home
 * perspective. `division` decides the axis: anything but "fbs" (today, only
 * the FCS namespace) has no measured regime at all.
 */
export function regimeFor(g: {
  openSpread?: number | null;
  homeTeam: string;
  awayTeam: string;
  division?: string;
}): GameRegime {
  if (g.division && g.division !== "fbs") return UNKNOWN_REGIME;
  const openSpread = typeof g.openSpread === "number" && Number.isFinite(g.openSpread)
    ? g.openSpread : null;
  const gameClass = gameClassFor(g.homeTeam, g.awayTeam);
  const big = openSpread !== null && Math.abs(openSpread) >= MISMATCH_SPREAD - EPS;
  const bag = gameClass === "bodybag (P4 host v non-P4)";
  return {
    openSpread,
    gameClass,
    mismatch: big || bag,
    known: openSpread !== null && gameClass !== null,
    axis: "measured",
  };
}

/* ------------------------------ the labels -------------------------------- */
/**
 * Order a PRIMARY reason is picked in when several fire — the Python's
 * `ABSTAIN_ORDER`. A family kill is the broader statement, so it reports
 * first.
 */
const ABSTAIN_ORDER = [
  "family:1hspread", "family:game", "mismatch:dog-side", "mismatch:fav-tt-under",
] as const;
export type AbstainReason = (typeof ABSTAIN_ORDER)[number];

/** The reason, in the words a row's popover prints. Verdict first. */
export const ABSTAIN_WORDS: Record<AbstainReason, string> = {
  "family:game": "Not a target: the moneyline family. On Kalshi in week 1 the "
    + "full-game winner market returned −22%, and where the sim disagreed with "
    + "the market by 10 points or more it was right only 12% of the time — "
    + "every other family sits between 41% and 64%. Priced and placeable; the "
    + "model has not earned this one.",
  "family:1hspread": "Not a target: the 1H spread family, the worst family in "
    + "both graded weeks (−35% at 3–5 days out, −19.5% at the published board) "
    + "and negative in every single frame.",
  "mismatch:dog-side": "Not a target: this bet BACKS THE DOG in a mismatch "
    + "(open spread 14+ or a P4 host against a non-P4 visitor). Week 1 dog-side "
    + "spreads in those games returned −16% (n=260) while the favourite side "
    + "returned +60% (n=35) — the sim was 14 points short of the favourite "
    + "where the book was 6.9.",
  "mismatch:fav-tt-under": "Not a target: the FAVOURITE's team-total UNDER in "
    + "a mismatch. Week 1: −41% (n=120) in those games, against +35% (n=48) on "
    + "the same bet everywhere else.",
};

/** R3 cells, with the measurement each one stands on. */
export type CellName =
  | "teamtotal" | "spread:3-14" | "spread:fav-mismatch" | "total:competitive";

/** The short tag a row prints beside its star. */
export const CELL_TAG: Record<CellName, string> = {
  "teamtotal": "team total",
  "spread:3-14": "spread 3-14",
  "spread:fav-mismatch": "fav in mismatch",
  "total:competitive": "total, competitive",
};

/** `CELL_EVIDENCE` from the Python, word for word where it is a number. */
export const CELL_EVIDENCE: Record<CellName, string> = {
  "teamtotal": "Team totals were the only family AHEAD of the Kalshi market at "
    + "3–5 days out (+3%, n=329), and +51% / +28% in G5-v-G5 and P4-v-P4. The "
    + "bodybag favourite-under leg that carried its losses (−41%, n=120) is "
    + "the one this rule set abstains on.",
  "spread:3-14": "Open-spread band 3–7 returned +5% (n=320) and 7–14 returned "
    + "+16% (n=279) across the whole tradeable board at 3–5 days out — the only "
    + "strongly positive regime of the week.",
  "spread:fav-mismatch": "Backing the FAVOURITE on a spread in a bodybag "
    + "returned +60% (n=35) at 3–5 days out and +66% (n=252) pooled over frames.",
  "total:competitive": "Totals by open-spread band at 3–5 days out: 3–7 +27% "
    + "(n=84), 7–14 +45% (n=55), against 14–24 −15% and 24+ −29%.",
};

/** What one contract earns from the rules. Pure labels. */
export type RuleLabel = {
  /** Primary reason, or null. */
  abstain: AbstainReason | null;
  /** Every reason that fired, in ABSTAIN_ORDER. */
  abstainReasons: AbstainReason[];
  /** The named cell a star needs, or null. */
  cell: CellName | null;
};

export const NO_LABEL: RuleLabel = { abstain: null, abstainReasons: [], cell: null };

/**
 * One contract, described the way the rules read it.
 *
 * `backsTeam` is the team this CONTRACT BETS ON, already resolved by the
 * caller — that is the site's own convention (`gameCandidates` emits one
 * candidate per side and names the team it backs), and it is strictly better
 * than the Python's route, which has to recover the same fact by parsing the
 * raw market's subtitle. A total has no side and passes undefined.
 *
 * `side` is the ORDER side ("yes"/"no"), needed only for the team-total under.
 */
export type Contract = {
  series: string;
  side?: "yes" | "no";
  /** The team this bet backs (spread) or is about (team total). */
  backsTeam?: string;
  /** Home team of the game, so "backs the home side" is decidable. */
  homeTeam: string;
};

/** True when `backsTeam` is the FAVOURITE by the open line; null if undecidable. */
function namesFav(c: Contract, r: GameRegime): boolean | null {
  if (!c.backsTeam || r.openSpread === null) return null;
  const isHome = cfbNameKey(c.backsTeam) === cfbNameKey(c.homeTeam);
  // Mirrors the Python's `names_fav = (team_is_home == (open_spread < 0))`,
  // including its treatment of an exact pick'em (0 is not < 0, so the AWAY
  // side is nominally "the favourite" there). A pick'em can only be a mismatch
  // via the bodybag leg, and no cell keys off `names_fav` at |spread| < 3.
  return isHome === (r.openSpread < 0);
}

/**
 * R1 + R2: which abstentions this contract trips, and R3: which cell it stands
 * in. Pure; nothing about price or edge enters here (that is R4, in `starFor`).
 */
export function labelFor(c: Contract, r: GameRegime): RuleLabel {
  if (r.axis === "unavailable") return NO_LABEL;

  const reasons: AbstainReason[] = [];

  // ---- R2 family abstention (unconditional) ------------------------------
  if (c.series === SERIES_GAME) reasons.push("family:game");
  if (c.series === "KXNCAAF1HSPREAD") reasons.push("family:1hspread");

  // ---- R1 mismatch abstention --------------------------------------------
  const fav = namesFav(c, r);
  let backsDog: boolean | null = null;
  if (SPREAD_SERIES.has(c.series) && fav !== null) {
    backsDog = !fav;
    if (r.mismatch && backsDog) reasons.push("mismatch:dog-side");
  }
  if (c.series === SERIES_TEAMTOTAL && fav !== null) {
    // The UNDER is the NO of "TEAM scores over K points".
    if (r.mismatch && fav && c.side === "no") reasons.push("mismatch:fav-tt-under");
  }

  reasons.sort((a, b) => ABSTAIN_ORDER.indexOf(a) - ABSTAIN_ORDER.indexOf(b));
  const abstain = reasons[0] ?? null;

  // ---- R3 cell assignment (survivors only) -------------------------------
  let cell: CellName | null = null;
  if (!reasons.length && r.known) {
    const sp = Math.abs(r.openSpread as number);
    if (c.series === SERIES_TEAMTOTAL) {
      cell = "teamtotal";
    } else if (c.series === SERIES_SPREAD) {
      if (sp >= SPREAD_CELL_LO - EPS && sp < SPREAD_CELL_HI - EPS) cell = "spread:3-14";
      else if (r.mismatch && backsDog === false) cell = "spread:fav-mismatch";
    } else if (c.series === SERIES_TOTAL) {
      if (sp < MISMATCH_SPREAD - EPS) cell = "total:competitive";
    }
    // No 1H/2H cell exists. The owner does not bet half-specific markets, and
    // the 2H cell re-graded −75.8% on n=9 in-sample.
  }

  return { abstain, abstainReasons: reasons, cell };
}

/* -------------------------------- the star -------------------------------- */
/**
 * How hard the rules bite on one row.
 *
 *   "measured"    — the FBS board the week-1 grade covers: full R1–R4.
 *   "unavailable" — a board the rules do not reach (FCS): R4 + the edge bar.
 *   "off"         — THE KILL SWITCH. The pre-2026-09-07 star, unchanged:
 *                   a non-tail row with net edge ≥ 10¢. See ownerPrefs
 *                   `readEdgeRules`.
 */
export type RuleMode = "measured" | "unavailable" | "off";

/**
 * R3 + R4. The star used to mean "net edge ≥ 10¢ after fees". Week 1 killed
 * the EV half of that as a standalone claim, so the bar is now:
 *
 *   not a tail · not abstained · price inside 15–90¢ · standing in a named
 *   cell the week-1 grade measured as positive · AND the old ≥10¢ edge.
 *
 * EV is the LAST condition, not the claim.
 *
 * `price` is what this row would actually PAY OR POST — the ask on a TAKE row
 * and the quote on a REST row. The Python's R4 reads the ask, because the
 * pipeline's own rows are all takes at grade time; a rest quote sits BELOW the
 * ask, so this is the stricter reading of the same filter, never the looser.
 */
export function starFor(row: {
  cell?: CellName | null;
  abstain?: AbstainReason | string | null;
  tail?: boolean;
  price: number;
  edge: number;
  series?: string;
}, mode: RuleMode = "measured"): boolean {
  if (row.tail) return false;
  if (mode === "off") return row.edge >= TARGET_EDGE;
  if (row.abstain) return false;
  if (row.series && HALF_SERIES.has(row.series)) return false;
  if (!(row.price >= STAR_ASK_LO - EPS && row.price <= STAR_ASK_HI + EPS)) return false;
  if (mode === "measured" && !row.cell) return false;
  return row.edge >= TARGET_EDGE;
}

/** The star's own tooltip / popover sentence, for a row that HAS one. */
export function starWords(cell: CellName | null | undefined): string {
  if (!cell) {
    return "TARGET: net edge ≥ 10¢ after fees at a price inside 15–90¢. "
      + "No regime cell on this board — the week-1 cuts were measured on the "
      + "FBS Kalshi board only.";
  }
  return `TARGET · ${CELL_TAG[cell]} — ${CELL_EVIDENCE[cell]}`;
}

/** The muted row's one-line reason, for a rest-state tag. */
export const abstainTag = (a: AbstainReason | null | undefined): string =>
  a === "family:game" ? "moneyline"
    : a === "family:1hspread" ? "1H spread"
      : a === "mismatch:dog-side" ? "dog in mismatch"
        : a === "mismatch:fav-tt-under" ? "fav TT under"
          : "";

/** How the regime reads in words, for a panel header. */
export function regimeWords(r: GameRegime): string {
  if (r.axis === "unavailable") {
    return "No open line or conference class on this board, so the week-2 "
      + "regime rules do not apply here — only the price band.";
  }
  if (r.openSpread === null && r.gameClass === null) {
    return "No consensus open spread and no conference class for this game, so "
      + "no row can earn a regime star. Rows are still priced.";
  }
  const parts: string[] = [];
  if (r.openSpread !== null) {
    const s = r.openSpread;
    parts.push(`open ${s > 0 ? "+" : "−"}${Math.abs(s)} (home)`);
  } else parts.push("no consensus open spread");
  if (r.gameClass) parts.push(r.gameClass);
  return parts.join(" · ") + (r.mismatch ? " · MISMATCH" : "");
}
