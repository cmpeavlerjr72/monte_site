#!/usr/bin/env node
/**
 * WEEK-2 DECISION RULES guard.
 *
 *   node scripts/check_edge_rules.mjs
 *
 * WHEN TO RUN: before committing any change to `src/lib/edgeRules.ts`,
 * `src/lib/fbsConferences.ts`, `src/assets/team_info.csv`, or the label wiring
 * in `src/lib/useSuggestions.ts` / `src/lib/suggestedBets.ts`. No network, no
 * test runner, no dependencies.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * These rules decide which rows the owner is told NOT to bet, off one week of
 * settled results. That makes two failure modes expensive and invisible:
 *
 * 1. A LABEL ON THE WRONG SIDE. "Backs the dog" is a sign question — the open
 *    spread is home-perspective and negative for a home favourite — and
 *    getting it backwards would mute exactly the rows the week-1 grade says
 *    are the good ones (bodybag favourite +60%, n=35) while starring the ones
 *    that lost 16%. The truth table below is the fixture for that, written
 *    from the REAL week-1 slate: Ohio State −50.5 v Ball State (the Python's
 *    own worked example), LSU −10.5 v Clemson, Georgia Tech −7.0 v Colorado.
 *
 * 2. A NAME THAT DOES NOT JOIN. The conference lookup is what makes a bodybag
 *    a bodybag. A school the map cannot place returns null and the class is
 *    unknown, which SILENTLY weakens R1. So the generated map is re-derived
 *    from team_info.csv and diffed (`--check` on the generator), and every
 *    FBS school is asserted to place.
 *
 * The rules themselves are ported from cfb-props-sim's
 * `scripts/kalshi_team_edges.py` (`WEEK-2 DECISION RULES` / `apply_wk2_rules`
 * / `_is_target`). THE PYTHON IS THE SOURCE. Each case below quotes the
 * behaviour it is pinning so a divergence reads as a diff, not a mystery.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let failures = 0;
const ok = (name) => console.log(`ok    ${name}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`FAIL  ${name}\n      ${detail}`);
};
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(name);
  else fail(name, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

/* ------------------------------------------------------------------ *
 * 0. The generated conference map still matches team_info.csv.
 * ------------------------------------------------------------------ */
try {
  execFileSync(process.execPath,
    [path.join(HERE, "gen_fbs_conferences.mjs"), "--check"],
    { stdio: "pipe" });
  ok("fbsConferences.ts is in sync with team_info.csv");
} catch (err) {
  fail("fbsConferences.ts is in sync with team_info.csv",
    String(err.stdout || "") + String(err.stderr || ""));
}

/* ------------------------------------------------------------------ *
 * Load the SHIPPED module, bundled with esbuild the way
 * check_game_pricer.mjs does — never a re-typed copy of the rules, and
 * never a stub for `server/cfbNames`, whose alias table is load-bearing
 * for the conference lookup below.
 * ------------------------------------------------------------------ */
const tmp = await mkdtemp(path.join(tmpdir(), "cfb-edgerules-"));
const bundle = path.join(tmp, "bundle.mjs");
await build({
  stdin: {
    contents: `export * from "./src/lib/edgeRules";`,
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true, format: "esm", platform: "node",
  outfile: bundle, logLevel: "silent",
});
const rules = await import(pathToFileURL(bundle).href);
await rm(tmp, { recursive: true, force: true });
const {
  regimeFor, gameClassFor, labelFor, starFor, conferenceFor,
  STAR_ASK_LO, STAR_ASK_HI, TARGET_EDGE,
} = rules;

/* ------------------------------------------------------------------ *
 * 1. Every FBS school on the live week-1 slate places.
 *    A miss here is the silent R1 weakening described above.
 * ------------------------------------------------------------------ */
{
  // The school list is DATA, emitted by the generator out of team_info.csv —
  // never a roster typed here (hard-won rule 1). Section 0 already pinned it
  // to the CSV, so this is the lookup half of the same guarantee.
  const { FBS_SCHOOLS } = rules;
  const missed = FBS_SCHOOLS.filter((s) => conferenceFor(s) === null);
  const n = FBS_SCHOOLS.length;
  if (n < 130) fail("the conference map covers the FBS", `only ${n} schools`);
  else if (missed.length) fail(`all ${n} FBS schools place`, `missed: ${missed.join(", ")}`);
  else ok(`all ${n} FBS schools place in the conference map`);
  // The one alias the live slate depends on: CFBD says "UMass", our slate
  // says "Massachusetts" (2026-08-30 incident, aliased in server/cfbNames.ts).
  eq("UMass / Massachusetts are the same lookup",
    conferenceFor("Massachusetts"), conferenceFor("UMass"));
}

/* ------------------------------------------------------------------ *
 * 2. gclass, against grade_kalshi_board.py's four buckets.
 * ------------------------------------------------------------------ */
eq("gclass: Ohio State (Big Ten) v Ball State (MAC) = bodybag",
  gameClassFor("Ohio State", "Ball State"), "bodybag (P4 host v non-P4)");
eq("gclass: LSU v Clemson = P4 v P4",
  gameClassFor("LSU", "Clemson"), "P4 v P4");
eq("gclass: Toledo v Ohio = G5 v G5",
  gameClassFor("Toledo", "Ohio"), "G5 v G5");
eq("gclass: Boise State v Oregon = non-P4 host v P4",
  gameClassFor("Boise State", "Oregon"), "non-P4 host v P4");
eq("gclass: Notre Dame counts as P4 (FBS Independents)",
  gameClassFor("Notre Dame", "Ball State"), "bodybag (P4 host v non-P4)");
eq("gclass: an unplaceable team is null, never a guess",
  gameClassFor("Ohio State", "Lindenwood"), null);

/* ------------------------------------------------------------------ *
 * 3. The regime, on the real week-1 numbers.
 *    `spread_open` values are the PUBLISHED summary.json odds for
 *    2026 week 1 — the same numbers load_game_regime reads out of
 *    lines_2026_snapshots.parquet.
 * ------------------------------------------------------------------ */
const OSU = regimeFor({ openSpread: -50.5, homeTeam: "Ohio State", awayTeam: "Ball State", division: "fbs" });
const LSU = regimeFor({ openSpread: -10.5, homeTeam: "LSU", awayTeam: "Clemson", division: "fbs" });
const GT = regimeFor({ openSpread: -7.0, homeTeam: "Georgia Tech", awayTeam: "Colorado", division: "fbs" });
const FCS = regimeFor({ openSpread: undefined, homeTeam: "Stony Brook", awayTeam: "Lindenwood", division: "fcs" });
const NOLINE = regimeFor({ openSpread: undefined, homeTeam: "Ohio State", awayTeam: "Ball State", division: "fbs" });

eq("regime: OSU/Ball State is a mismatch (both legs)", [OSU.mismatch, OSU.known], [true, true]);
eq("regime: LSU/Clemson is not a mismatch", [LSU.mismatch, LSU.known], [false, true]);
eq("regime: a 14.0 open is a mismatch (>= is inclusive)",
  regimeFor({ openSpread: 14, homeTeam: "Toledo", awayTeam: "Ohio", division: "fbs" }).mismatch, true);
eq("regime: a 13.5 open is not",
  regimeFor({ openSpread: -13.5, homeTeam: "Toledo", awayTeam: "Ohio", division: "fbs" }).mismatch, false);
eq("regime: the FCS board has no measured axis", FCS.axis, "unavailable");
eq("regime: an FBS game with no open spread is 'measured' but unknown",
  [NOLINE.axis, NOLINE.known], ["measured", false]);

/* ------------------------------------------------------------------ *
 * 4. R1 / R2 abstentions.
 * ------------------------------------------------------------------ */
const L = (c, r) => labelFor(c, r);
const SPREAD = "KXNCAAFSPREAD", GAME = "KXNCAAFGAME";
const TOTAL = "KXNCAAFTOTAL", TT = "KXNCAAFTEAMTOTAL";

eq("R1: Ball State (the dog) spread in a bodybag abstains",
  L({ series: SPREAD, backsTeam: "Ball State", homeTeam: "Ohio State" }, OSU).abstain,
  "mismatch:dog-side");
eq("R1: Ohio State (the favourite) spread does NOT abstain",
  L({ series: SPREAD, backsTeam: "Ohio State", homeTeam: "Ohio State" }, OSU).abstain,
  null);
eq("R1: the same dog side in a COMPETITIVE game does not abstain",
  L({ series: SPREAD, backsTeam: "Clemson", homeTeam: "LSU" }, LSU).abstain, null);
eq("R1: the favourite's team-total UNDER in a mismatch abstains",
  L({ series: TT, side: "no", backsTeam: "Ohio State", homeTeam: "Ohio State" }, OSU).abstain,
  "mismatch:fav-tt-under");
eq("R1: the favourite's team-total OVER does not",
  L({ series: TT, side: "yes", backsTeam: "Ohio State", homeTeam: "Ohio State" }, OSU).abstain,
  null);
eq("R1: the DOG's team-total under does not",
  L({ series: TT, side: "no", backsTeam: "Ball State", homeTeam: "Ohio State" }, OSU).abstain,
  null);
eq("R2: every moneyline row abstains, mismatch or not",
  [L({ series: GAME, backsTeam: "LSU", homeTeam: "LSU" }, LSU).abstain,
   L({ series: GAME, backsTeam: "Ohio State", homeTeam: "Ohio State" }, OSU).abstain],
  ["family:game", "family:game"]);
eq("R2: 1H spread abstains by family, and the family kill reports first",
  L({ series: "KXNCAAF1HSPREAD", backsTeam: "Ball State", homeTeam: "Ohio State" }, OSU),
  { abstain: "family:1hspread",
    abstainReasons: ["family:1hspread", "mismatch:dog-side"], cell: null });
eq("R1/R2 never fire on a board the rules do not reach (FCS)",
  L({ series: GAME, backsTeam: "Stony Brook", homeTeam: "Stony Brook" }, FCS).abstain, null);

/* ------------------------------------------------------------------ *
 * 5. R3 cells.
 * ------------------------------------------------------------------ */
eq("R3: LSU −10.5 spread stands in spread:3-14 (either side)",
  [L({ series: SPREAD, backsTeam: "LSU", homeTeam: "LSU" }, LSU).cell,
   L({ series: SPREAD, backsTeam: "Clemson", homeTeam: "LSU" }, LSU).cell],
  ["spread:3-14", "spread:3-14"]);
eq("R3: the favourite side of a mismatch stands in spread:fav-mismatch",
  L({ series: SPREAD, backsTeam: "Ohio State", homeTeam: "Ohio State" }, OSU).cell,
  "spread:fav-mismatch");
eq("R3: a total is a cell only when the game is competitive",
  [L({ series: TOTAL, homeTeam: "LSU" }, LSU).cell,
   L({ series: TOTAL, homeTeam: "Ohio State" }, OSU).cell],
  ["total:competitive", null]);
eq("R3: a team total is a cell wherever R1 did not catch it",
  [L({ series: TT, side: "yes", backsTeam: "Colorado", homeTeam: "Georgia Tech" }, GT).cell,
   L({ series: TT, side: "no", backsTeam: "Ohio State", homeTeam: "Ohio State" }, OSU).cell],
  ["teamtotal", null]);
eq("R3: an abstained row never carries a cell",
  L({ series: SPREAD, backsTeam: "Ball State", homeTeam: "Ohio State" }, OSU).cell, null);
eq("R3: unknown regime is not a free pass — no open spread, no cell",
  L({ series: SPREAD, backsTeam: "Ohio State", homeTeam: "Ohio State" }, NOLINE).cell, null);
eq("R3: a 2.5 open spread is BELOW the 3-14 cell",
  L({ series: SPREAD, backsTeam: "LSU", homeTeam: "LSU" },
    regimeFor({ openSpread: -2.5, homeTeam: "LSU", awayTeam: "Clemson", division: "fbs" })).cell,
  null);

/* ------------------------------------------------------------------ *
 * 6. R4 + the star.
 * ------------------------------------------------------------------ */
const star = (o, mode) => starFor(o, mode);
eq("R4: a cell + 15-90c + >=10c edge earns the star",
  star({ cell: "spread:3-14", price: 0.45, edge: 0.12 }, "measured"), true);
eq("R4: the same row at a 12c ask does not (owner's live price filter)",
  star({ cell: "spread:3-14", price: 0.12, edge: 0.12 }, "measured"), false);
eq("R4: nor at a 95c ask",
  star({ cell: "spread:3-14", price: 0.95, edge: 0.12 }, "measured"), false);
eq("R4: 15c and 90c are INSIDE the band",
  [star({ cell: "teamtotal", price: STAR_ASK_LO, edge: 0.12 }, "measured"),
   star({ cell: "teamtotal", price: STAR_ASK_HI, edge: 0.12 }, "measured")],
  [true, true]);
eq("R3: a big edge with NO cell is not a star — the week-1 lesson",
  star({ cell: null, price: 0.45, edge: 0.47 }, "measured"), false);
eq("an abstained row is never starred, however big the edge",
  star({ cell: null, abstain: "mismatch:dog-side", price: 0.45, edge: 0.9 }, "measured"), false);
eq("a tail row is never starred, in any mode",
  [star({ cell: "teamtotal", tail: true, price: 0.45, edge: 0.5 }, "measured"),
   star({ tail: true, price: 0.45, edge: 0.5 }, "off")],
  [false, false]);
eq("no half-market row is ever starred (owner does not bet 1H/2H)",
  [star({ cell: "teamtotal", price: 0.45, edge: 0.2, series: "KXNCAAF2HSPREAD" }, "measured"),
   star({ cell: "teamtotal", price: 0.45, edge: 0.2, series: "KXNCAAF1HTOTAL" }, "measured"),
   star({ cell: "teamtotal", price: 0.45, edge: 0.2, series: "KXNCAAF1H" }, "measured")],
  [false, false, false]);
eq("the edge bar is still the LAST condition, not the claim",
  star({ cell: "teamtotal", price: 0.45, edge: TARGET_EDGE - 0.001 }, "measured"), false);
eq("unavailable axis (FCS): R4 + the edge, no cell needed",
  [star({ cell: null, price: 0.45, edge: 0.12 }, "unavailable"),
   star({ cell: null, price: 0.10, edge: 0.12 }, "unavailable")],
  [true, false]);
eq("KILL SWITCH: mode 'off' restores the pre-2026-09-07 star exactly",
  [star({ cell: null, abstain: "family:game", price: 0.05, edge: 0.12 }, "off"),
   star({ cell: null, price: 0.99, edge: 0.09 }, "off")],
  [true, false]);

/* ------------------------------------------------------------------ *
 * 7. Static wiring: the rules must stay LABELS.
 *    Owner rule 2026-08-30 — a star or an abstention may never remove a
 *    row from a list. The two places that could quietly turn one into a
 *    filter are the site's tradeable filter in edges.ts and the ladder
 *    selection in suggestedBets.ts.
 * ------------------------------------------------------------------ */
{
  const edges = readFileSync(path.join(ROOT, "src", "lib", "edges.ts"), "utf8");
  const isTradeable = edges.slice(edges.indexOf("export function isTradeableTeamMarket"),
    edges.indexOf("export function isTradeableTeamMarket") + 600);
  if (/abstain|\bcell\b|star/i.test(isTradeable)) {
    fail("isTradeableTeamMarket does not filter on the rules",
      "the flag filter now mentions abstain/cell/star — that would HIDE rows");
  } else ok("isTradeableTeamMarket does not filter on the rules");

  const sb = readFileSync(path.join(ROOT, "src", "lib", "suggestedBets.ts"), "utf8");
  const sel = sb.slice(sb.indexOf("function selectLadders"), sb.indexOf("function sizeSuggestion"));
  if (/abstain|\.cell|\.star/.test(sel)) {
    fail("selectLadders does not rank or drop on the rules",
      "selection now reads a rule label — labels must not change which rows exist");
  } else ok("selectLadders does not rank or drop on the rules");

  const us = readFileSync(path.join(ROOT, "src", "lib", "useSuggestions.ts"), "utf8");
  if (!/openSpread: g\.openSpread/.test(us)) {
    fail("the regime reads the OPEN spread",
      "useSuggestions no longer passes g.openSpread into regimeFor");
  } else ok("the regime reads the OPEN spread");
  const page = readFileSync(path.join(ROOT, "src", "pages", "Scoreboard.tsx"), "utf8");
  if (!/openSpread: typeof o\?\.spread_open === "number"/.test(page)) {
    fail("the card's openSpread is spread_open ALONE",
      "Scoreboard's openSpread no longer comes from summary.odds.spread_open only "
      + "- a spread_current fallback would condition the rules on the wrong line");
  } else ok("the card's openSpread is spread_open alone (never spread_current)");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall edge-rule checks passed");
process.exit(failures ? 1 : 0);
