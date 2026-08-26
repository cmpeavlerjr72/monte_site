#!/usr/bin/env node
/**
 * Kalshi team-name join guard (FBS + FCS).
 *
 *   node scripts/check_fcs_names.mjs
 *
 * WHEN TO RUN: before committing any change to server/cfbNames.ts or to
 * src/assets/team_info.csv. No dependencies, no test runner — plain node.
 * Reads the COMPILED server/dist/cfbNames.js, so it also fails loudly if the
 * dist rebuild was skipped (the go-dark trap: Render runs the committed JS).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PROVES
 * ---------------------------------------------------------------------------
 * The server matches Kalshi events to our slate by normalized team-name PAIR.
 * Adding 128 FCS schools to that namespace creates two distinct failure modes,
 * and this checks both:
 *
 *   COLLISION  two different schools normalizing to the same key would join a
 *              Kalshi market to the wrong game and print a real price against
 *              a game it does not belong to. Checked over all 266 schools.
 *
 *   REGRESSION a normalization added for FCS silently changing an FBS key
 *              would drop FBS games out of the join. Checked by running the
 *              PRE-FCS implementation (frozen below as `legacyNameKey`) over
 *              every FBS school and asserting the keys are identical.
 *
 * Plus the thing the FCS slate actually needs: Kalshi writes "Youngstown St.",
 * our data writes "Youngstown State". Asserted for every "... State" school in
 * both divisions.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

/* ==========================================================================
 * The shipped implementation, from the COMPILED server bundle.
 * ======================================================================== */
const distPath = path.join(ROOT, "server/dist/cfbNames.js");
if (!fs.existsSync(distPath)) {
  console.log(
    "server/dist/cfbNames.js is missing — run `npx tsc` in server/ and commit dist."
  );
  process.exit(1);
}
const { cfbNameKey, KALSHI_TEAM_ALIASES } = await import(
  new URL("../server/dist/cfbNames.js", import.meta.url).href
);

/* ==========================================================================
 * FROZEN: the pre-FCS implementation. Do not "fix" this — it is the baseline
 * the FBS join is compared against, and it is supposed to drift out of date.
 * ======================================================================== */
const LEGACY_ALIASES = {
  ncstate: "northcarolinastate",
  nc: "northcarolina",
  southerncal: "usc",
  southerncalifornia: "usc",
  hawaii: "hawaii",
  miamifl: "miami",
  miamiflorida: "miami",
  louisianalafayette: "louisiana",
  texasam: "texasandm",
};
function legacyNameKey(s) {
  const base = String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst\.?\b/g, " state ")
    .replace(/\buniversity\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  return LEGACY_ALIASES[base] ?? base;
}

/* ==========================================================================
 * School lists, straight out of the CSV the app itself parses.
 * ======================================================================== */
/** Minimal quoted-CSV row splitter — team_info.csv quotes its logo lists. */
function splitCsvLine(line) {
  const out = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

function readSchools() {
  const raw = fs.readFileSync(path.join(ROOT, "src/assets/team_info.csv"), "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0].replace(/^﻿/, ""));
  const iSchool = header.indexOf("School");
  const iClass = header.indexOf("Classification");
  if (iSchool < 0) throw new Error("team_info.csv has no School column");
  const fbs = [];
  const fcs = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[iSchool] || "").trim();
    if (!name) continue;
    ((cells[iClass] || "").trim().toLowerCase() === "fcs" ? fcs : fbs).push(name);
  }
  return { fbs, fcs };
}

const { fbs, fcs } = readSchools();
const all = [...fbs, ...fcs];

console.log("Kalshi name-join guard\n");
console.log(`Roster: ${fbs.length} FBS + ${fcs.length} FCS = ${all.length} schools\n`);

console.log("1. FBS regression — no FCS normalization may move an existing key");
{
  const moved = [];
  for (const n of fbs) {
    // The plain name AND the "St." spelling Kalshi uses for it.
    for (const v of [n, n.replace(/\bState\b/g, "St.")]) {
      if (cfbNameKey(v) !== legacyNameKey(v)) {
        moved.push(`${v}: ${legacyNameKey(v)} -> ${cfbNameKey(v)}`);
      }
    }
  }
  check(
    moved.length === 0,
    moved.length
      ? `every FBS key is unchanged — MOVED: ${moved.join("; ")}`
      : `all ${fbs.length} FBS schools (and their "St." spellings) key exactly as before`
  );
}

console.log("\n2. Collisions — two schools must never share a key");
{
  const byKey = new Map();
  const clashes = [];
  for (const n of all) {
    const k = cfbNameKey(n);
    if (byKey.has(k) && byKey.get(k) !== n) clashes.push(`${k}: ${byKey.get(k)} / ${n}`);
    else byKey.set(k, n);
  }
  check(
    clashes.length === 0,
    clashes.length
      ? `no two schools collide — FOUND: ${clashes.join("; ")}`
      : `all ${all.length} schools produce distinct keys`
  );
}

console.log("\n3. Aliases — every alias must land on a key a real school produces");
{
  const real = new Set(all.map((n) => cfbNameKey(n)));
  const orphans = Object.entries(KALSHI_TEAM_ALIASES)
    .filter(([, target]) => !real.has(target))
    .map(([from, to]) => `${from} -> ${to}`);
  // An alias whose target no school produces is dead weight at best and a
  // typo at worst; it can never make a match.
  check(
    orphans.length === 0,
    orphans.length ? `no orphaned aliases — FOUND: ${orphans.join("; ")}` : `all ${Object.keys(KALSHI_TEAM_ALIASES).length} aliases resolve to a real school`
  );
}

console.log('\n4. "St." <-> "State" — the abbreviation Kalshi actually uses');
{
  const bad = [];
  let checked = 0;
  for (const n of all) {
    const abbrev = n.replace(/\bState\b/g, "St.");
    if (abbrev === n) continue;
    checked++;
    if (cfbNameKey(abbrev) !== cfbNameKey(n)) {
      bad.push(`${n} (${cfbNameKey(n)}) != ${abbrev} (${cfbNameKey(abbrev)})`);
    }
  }
  check(
    bad.length === 0,
    bad.length
      ? `"St." matches "State" — MISMATCH: ${bad.join("; ")}`
      : `all ${checked} "... State" schools match their "... St." spelling`
  );
}

console.log("\n5. Spot checks — the cases that motivated each rule");
{
  const cases = [
    // [our slate's name, Kalshi's spelling, why]
    ["Youngstown State", "Youngstown St.", "FCS State abbreviation"],
    ["South Dakota State", "South Dakota St.", "FCS State abbreviation"],
    ["St. Thomas (MN)", "St. Thomas", "our name carries a state qualifier"],
    ["St. Thomas (MN)", "Saint Thomas", "spelled-out Saint"],
    ["Long Island University", "LIU", "initialism"],
    ["UT Rio Grande Valley", "UTRGV", "initialism"],
    ["The Citadel", "Citadel", "leading article"],
    ["San Diego State", "San Diego St.", "FBS — must not become San Diego"],
    ["North Carolina State", "NC State", "FBS alias still works"],
  ];
  for (const [ours, theirs, why] of cases) {
    check(cfbNameKey(ours) === cfbNameKey(theirs), `${ours} == ${theirs} (${why}) -> ${cfbNameKey(ours)}`);
  }

  // And the pairs that must STAY apart.
  // This is why parentheticals are NOT stripped generically.
  const apart = [
    ["Miami", "Miami (OH)", "different schools"],
    ["San Diego State", "San Diego", "St. rule must not eat the qualifier"],
    ["Stanford", "Stony Brook", "\\b keeps St-initial names intact"],
  ];
  for (const [a, b, why] of apart) {
    check(cfbNameKey(a) !== cfbNameKey(b), `${a} != ${b} (${why})`);
  }
}

console.log(
  failures === 0
    ? "\nAll name-join checks passed."
    : `\n${failures} name-join check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
