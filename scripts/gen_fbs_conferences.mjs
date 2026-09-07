#!/usr/bin/env node
/**
 * Generate `src/lib/fbsConferences.ts` from `src/assets/team_info.csv`.
 *
 *   node scripts/gen_fbs_conferences.mjs          # write the file
 *   node scripts/gen_fbs_conferences.mjs --check  # fail if it has drifted
 *
 * WHY A GENERATED FILE AND NOT THE CSV ITSELF
 * -------------------------------------------
 * The week-2 decision rules (src/lib/edgeRules.ts) need ONE bit per team:
 * is this school P4/independent, or is it not. team_info.csv already carries
 * the answer, but it is 185KB of stadium capacities and hex colours, and the
 * four pages that read it do so with an eager `import.meta.glob` raw import —
 * pulling it into the scoreboard chunk to look up a conference would put all
 * of that in the bundle a phone downloads before it can price a bet.
 *
 * So the CSV stays the SOURCE and this script is the compiler: 138 FBS rows,
 * school -> conference, ~4KB. Nothing is retyped by hand (hard-won rule 1):
 * every key and value below comes out of the CSV, and `--check` fails the
 * gate if the two ever diverge.
 *
 * KEYS ARE `cfbNameKey`, the site's ONE team-name normalizer (server/
 * cfbNames.ts, proven collision-free over all 266 FBS+FCS schools by
 * scripts/check_fcs_names.mjs). That is what makes CFBD's "UMass" and our
 * slate's "Massachusetts" the same lookup, for free, through the alias table
 * that already exists — rather than a second name map that would be exactly
 * the collision bug cfbNames.ts was written to prevent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cfbNameKey } from "../server/dist/cfbNames.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CSV = path.join(ROOT, "src", "assets", "team_info.csv");
const OUT = path.join(ROOT, "src", "lib", "fbsConferences.ts");

/** Minimal RFC-4180 row splitter — team_info.csv quotes its list columns. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function build() {
  const raw = readFileSync(CSV, "utf8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  const head = splitCsvLine(lines[0]);
  const iSchool = head.indexOf("School");
  const iConf = head.indexOf("Conference");
  const iClass = head.indexOf("Classification");
  if (iSchool < 0 || iConf < 0 || iClass < 0) {
    throw new Error("team_info.csv is missing School/Conference/Classification");
  }

  const byKey = new Map();
  const collisions = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    if (f[iClass] !== "fbs") continue;
    const school = (f[iSchool] || "").trim();
    const conf = (f[iConf] || "").trim();
    if (!school || !conf) continue;
    const key = cfbNameKey(school);
    const prev = byKey.get(key);
    if (prev && prev.conf !== conf) collisions.push(`${key}: ${prev.school} / ${school}`);
    byKey.set(key, { school, conf });
  }
  if (collisions.length) {
    throw new Error(`cfbNameKey collision inside FBS: ${collisions.join(", ")}`);
  }

  const rows = [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const body = rows
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v.conf)},`
      + ` // ${v.school}`)
    .join("\n");
  const schools = rows.map(([, v]) => `  ${JSON.stringify(v.school)},`).join("\n");

  return `// GENERATED FILE — do not edit by hand.
//
//   node scripts/gen_fbs_conferences.mjs          # regenerate
//   node scripts/check_edge_rules.mjs             # fails on drift
//
// Source: src/assets/team_info.csv (CFBD's team table, the same file the
// Results / CLV / BestBets pages parse). Only the ${rows.length} FBS rows are kept, and
// only the one column the week-2 decision rules need — the conference, which
// decides whether a school is P4/independent (src/lib/edgeRules.ts).
//
// Keys are \`cfbNameKey\` (server/cfbNames.ts), the site's ONE team-name
// normalizer, so a slate spelling and CFBD's spelling land on the same entry
// without a second alias table ("Massachusetts" / "UMass" is the live case).
// The generator refuses to emit a file where two different FBS schools share
// a key, so a lookup here can never quietly answer for the wrong team.

/** cfbNameKey(school) -> CFBD conference name, FBS only. */
export const FBS_CONFERENCE: Readonly<Record<string, string>> = {
${body}
};

/** CFBD's own spellings, in the same order — the offline fixture
 *  scripts/check_edge_rules.mjs asserts every one of them still places. */
export const FBS_SCHOOLS: readonly string[] = [
${schools}
];
`;
}

const text = build();
const check = process.argv.includes("--check");
if (check) {
  let cur = "";
  try { cur = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (cur.replace(/\r\n/g, "\n") !== text.replace(/\r\n/g, "\n")) {
    console.error("FAIL  src/lib/fbsConferences.ts is stale — run "
      + "`node scripts/gen_fbs_conferences.mjs`");
    process.exit(1);
  }
  console.log("ok    fbsConferences.ts matches team_info.csv");
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
