#!/usr/bin/env node
/**
 * Guard for LIVE PROGRESS on held per-team stat bets (src/lib/liveProgress.ts).
 *
 *   node scripts/check_live_progress.mjs
 *
 * WHEN TO RUN: whenever liveProgress.ts, teamStatMarkets.ts's STAT_FOR_SERIES,
 * or the ESPN box-score parsing moves. No dependencies, no build step.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * This is the only block in the app that tells the owner, mid-game, whether a
 * bet is winning. Three ways it could lie, each checked below:
 *
 *  1. THE STRIKE, OFF BY ONE. Kalshi's `TCU225` is the market "TCU: 225+
 *     receiving yards" with `floor_strike` 224.5 and `strike_type` "greater"
 *     (verified against the pulled market snapshot, 2026-08-29). So YES clears
 *     at 225 — not 226, and not 224. One step either way calls a won bet a loss
 *     on the last catch of the game.
 *  2. THE WRONG NUMBER. Team receiving yards settles as the SUM OF EVERY
 *     PLAYER'S receiving yards. The team totals ROW is not that number by
 *     definition and has glitched live (Maine read 236 against a true 199), so
 *     the fixture below carries a deliberately WRONG team row and the parser
 *     must ignore it.
 *  3. THE WRONG TEAM. Two hops map a ticker to a box score — the ticker says
 *     which of OUR teams (the event code is away+home), the card says which of
 *     ESPN's (teamA is home for us; ESPN can disagree at a neutral site). Both
 *     are structural, and flipping either must move the reading to the other
 *     team, never silently keep it.
 *
 * A fourth rule is a whitelist: a family ships only with a verified ESPN path
 * behind it. TD / FG / TO / receptions / rush attempts / total yards must
 * produce NO progress line at all rather than a plausible-looking guess.
 */

import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

// The app's .ts modules are written for a bundler: relative, extensionless.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});

const { parseLiveTeamStats, progressBetsOf, progressFor, statTargetOf } =
  await import(new URL(`file:///${ROOT}/src/lib/liveProgress.ts`).href);

/* ==========================================================================
 * A FIXTURE shaped exactly like ESPN's college summary — and lying in its
 * team totals row on purpose (see rule 2 above).
 * ======================================================================== */

const REC_KEYS = ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception"];
const RUSH_KEYS = ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"];

const athlete = (name, yds) => ({ athlete: { displayName: name }, stats: ["3", String(yds), "0", "0", "0"] });

const teamBlock = (id, abbrev, rec, rush) => ({
  team: { id, abbreviation: abbrev },
  statistics: [
    { name: "passing", keys: ["completions/passingAttempts", "passingYards"], athletes: [] },
    { name: "receiving", keys: REC_KEYS, athletes: rec.map(([n, y]) => athlete(n, y)) },
    { name: "rushing", keys: RUSH_KEYS, athletes: rush.map(([n, y]) => athlete(n, y)) },
  ],
});

/** TCU home 3, UNC away 10. TCU rec = 130+95 = 225 exactly (the boundary). */
const summary = (recHome, recAway, state = "in") => ({
  header: {
    competitions: [{
      status: { type: { state, completed: state === "post", detail: "3:12 - 4th Quarter" } },
      competitors: [
        // Deliberately AWAY-FIRST, so a parser that trusted slot order rather
        // than the homeAway flag would swap the two teams' numbers.
        { homeAway: "away", score: "10", team: { id: "153", abbreviation: "UNC" } },
        { homeAway: "home", score: "3", team: { id: "2628", abbreviation: "TCU" } },
      ],
    }],
  },
  boxscore: {
    // The LYING row: nothing may read these.
    teams: [
      { team: { id: "2628" }, statistics: [{ name: "netPassingYards", displayValue: "999" }] },
      { team: { id: "153" }, statistics: [{ name: "netPassingYards", displayValue: "999" }] },
    ],
    players: [
      teamBlock("2628", "TCU", recHome, [["Q Rusher", 55]]),
      teamBlock("153", "UNC", recAway, [["B Hall", 16]]),
    ],
  },
});

const TCU225 = "KXNCAAFTEAMRECYDS-26AUG29UNCTCU-TCU225";
const UNC175 = "KXNCAAFTEAMRECYDS-26AUG29UNCTCU-UNC175";

/* ==========================================================================
 * 1. THE VALUE IS THE PLAYER SUM
 * ======================================================================== */
console.log("\n1. The reading is a player sum, never the team row");

const s = parseLiveTeamStats(summary([["A Rec", 130], ["B Rec", 95]], [["C Rec", 64]]));
check(s !== null, "a live summary parses");
check(s.home.rec_yards?.value === 225, `home rec yards = 130 + 95 = 225 (got ${s.home.rec_yards?.value})`);
check(s.away.rec_yards?.value === 64, `away rec yards = 64 (got ${s.away.rec_yards?.value})`);
check(
  s.home.rec_yards?.value !== 999 && s.away.rec_yards?.value !== 999,
  "the team totals row (999) is never the reading",
);
check(s.home.rush_yards?.value === 55 && s.away.rush_yards?.value === 16, "rush yards are summed the same way");
check(s.home.points?.value === 3 && s.away.points?.value === 10, "points come from the scoreboard, by homeAway flag");
check(
  s.home.rec_yards?.parts?.[0]?.name === "A Rec" && s.home.rec_yards.parts[0].v === 130,
  "the per-player breakdown is kept, biggest first",
);

// A group present with nobody in it is a REAL zero; an absent box score is not.
const kickoff = parseLiveTeamStats(summary([], []));
check(kickoff.home.rec_yards?.value === 0, "an empty receiving group reads 0, not missing");
check(parseLiveTeamStats({ header: summary([], []).header }) === null, "no box score at all parses to null");

/* ==========================================================================
 * 2. THE STRIKE CLEARS AT THE TICKER'S OWN NUMBER
 * ======================================================================== */
console.log("\n2. TCU225 = floor_strike 224.5, 'greater' — so 225 clears");

const chipAt = (v, side) =>
  progressFor(TCU225, side, true, parseLiveTeamStats(summary([["A Rec", v]], [])))?.chip;

check(chipAt(224, "yes") === "1 to go", `224 is one short for a YES (got "${chipAt(224, "yes")}")`);
check(chipAt(225, "yes") === "CLEARED", `225 clears a YES (got "${chipAt(225, "yes")}")`);
check(chipAt(226, "yes") === "CLEARED", "226 stays cleared");
check(chipAt(224, "no") === "1 spare", `224 still has room for a NO (got "${chipAt(224, "no")}")`);
check(chipAt(225, "no") === "BUSTED", `225 busts a NO (got "${chipAt(225, "no")}")`);

const finalChip = (v, side) =>
  progressFor(TCU225, side, true, parseLiveTeamStats(summary([["A Rec", v]], [], "post")))?.chip;
check(finalChip(225, "yes") === "HIT" && finalChip(224, "yes") === "MISSED", "a final YES grades HIT / MISSED");
check(finalChip(224, "no") === "HIT" && finalChip(225, "no") === "MISSED", "a final NO grades the other way");

/* ==========================================================================
 * 3. THE TEAM MAPPING IS STRUCTURAL AT BOTH HOPS
 * ======================================================================== */
console.log("\n3. Ticker -> our side -> ESPN's side, twice structural");

const t = statTargetOf(TCU225);
check(t?.strikeIsHome === true, "TCU is home in the event code 26AUG29UNCTCU (away+home)");
check(statTargetOf(UNC175)?.strikeIsHome === false, "UNC is away in the same code");

check(progressFor(TCU225, "yes", true, s)?.value === 225, "TCU's bet reads TCU's box score");
check(progressFor(UNC175, "yes", true, s)?.value === 64, "UNC's bet reads UNC's box score");
check(
  progressFor(TCU225, "yes", false, s)?.value === 64,
  "espnHomeIsA=false (neutral-site flip) moves the reading to the other team",
);

/* ==========================================================================
 * 4. ONLY VERIFIED FAMILIES GET A LINE
 * ======================================================================== */
console.log("\n4. An unverified family has no progress line at all");

const MAPPED = ["KXNCAAFTEAMRECYDS", "KXNCAAFTEAMRSHYDS", "KXNCAAFTEAMTOTAL"];
const UNMAPPED = [
  "KXNCAAFTEAMTD", "KXNCAAFTEAMFG", "KXNCAAFTEAMTO", "KXNCAAFTEAMREC",
  "KXNCAAFTEAMRSHATT", "KXNCAAFTEAMYDS", "KXNCAAFTEAMSACK", "KXNCAAFTEAMINT",
  "KXNCAAFTEAMRSHTD", "KXNCAAFTEAMRECTD", "KXNCAAFSPREAD", "KXNCAAFTOTAL", "KXNCAAFGAME",
];
for (const fam of MAPPED) {
  check(statTargetOf(`${fam}-26AUG29UNCTCU-TCU20`) !== null, `${fam} is tracked`);
}
const leaks = UNMAPPED.filter((f) => statTargetOf(`${f}-26AUG29UNCTCU-TCU3`) !== null);
check(leaks.length === 0, `no unverified family is tracked${leaks.length ? ` (leaked: ${leaks.join(", ")})` : ""}`);
check(statTargetOf("KXNCAAFTEAMRECYDS-26AUG29UNCTCU-TCU") === null, "a strike-less ticker is not tracked");
check(statTargetOf("nonsense") === null, "a malformed ticker is not tracked");

/* ==========================================================================
 * 5. THE SURFACE GATE — cheap, fetch-free, de-duplicated
 * ======================================================================== */
console.log("\n5. progressBetsOf: the gate on both the block and the poll");

const picked = progressBetsOf([
  { ticker: TCU225, side: "yes" },
  { ticker: TCU225, side: "yes" },                             // held + resting, one market
  { ticker: TCU225, side: "no" },                              // the other side IS a second bet
  { ticker: "KXNCAAFTEAMTD-26AUG29UNCTCU-TCU3", side: "yes" }, // unverified family
  { side: "yes" },                                             // a combo carries no ticker
]);
check(picked.length === 2, `one row per (market, side) — got ${picked.length}`);
check(picked.every((b) => b.ticker === TCU225), "only the tracked market survives");
check(progressBetsOf(undefined).length === 0, "no book at all is simply no rows");

console.log(
  failures ? `\n${failures} check(s) FAILED\n` : "\nAll live-progress checks passed\n",
);
process.exit(failures ? 1 : 0);
