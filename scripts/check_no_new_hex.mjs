#!/usr/bin/env node
// scripts/check_no_new_hex.mjs: NO NEW HEX COLOURS IN TS/TSX (2026-10-16).
//
// Colour lives in tokens (src/theme.css, docs/DESIGN.md). This gate fails when
//   - a file NOT listed below gains a hex colour literal, or
//   - a BASELINE file has more than its recorded count (they only go down).
// A line that carries the marker `identity-color` is exempt: identity colours
// (team colours, court surfaces, car manufacturers) are the one allowed
// literal, exactly as hard-won rule 7 in docs/AGENT_BRIEF.md says.
//
//   node scripts/check_no_new_hex.mjs
//
// When you REMOVE hexes from a baseline file, lower its number here in the
// same commit (the gate prints the new count). Never raise one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/** Whole files that ARE identity data. */
const IDENTITY_FILES = {
  "src/utils/teamColors.ts": "school colours (the resolver and its table)",
  "src/utils/nascarData.ts": "car-number paint schemes",
  "src/lib/useNascarLive.ts": "race flag colours (the flag IS the colour)",
  "src/components/LiveGamecast.tsx": "the football-field diagram (turf, first-down yellow, field markings)",
};

/** Legacy files: allowed up to this many, and only ever fewer. */
const BASELINE = {
  "src/pages/TestVisual.tsx": 17,       // dev-only research harness
  "src/pages/Trends_CLV.tsx": 3,        // dev-only (hidden until rebuilt on 2026)
  "src/pages/combo_trend.tsx": 3,       // dev-only
  "src/pages/CBB_Bracket.tsx": 4,       // the PNG-export stylesheet (rendered off-page, always light)
  "src/components/TeamStats.tsx": 6,    // team-colour examples in comments
};

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(f) && !/\.d\.m?ts$/.test(f)) out.push(p);
  }
  return out;
}

let failed = 0;
const lowered = [];
for (const abs of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (IDENTITY_FILES[rel]) continue;
  let n = 0;
  const hits = [];
  fs.readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("identity-color")) return;
    const m = line.match(HEX);
    if (m) { n += m.length; hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`); }
  });
  const allowed = BASELINE[rel] ?? 0;
  if (n > allowed) {
    failed++;
    console.error(`✗ ${rel}: ${n} hex colour literal(s), allowed ${allowed}. Use a token (docs/DESIGN.md) or mark an identity colour with // identity-color.`);
    for (const h of hits.slice(0, 8)) console.error(`    ${h}`);
  } else if (n < allowed) {
    lowered.push(`${rel}: ${n} (baseline says ${allowed}; lower it)`);
  }
}
for (const l of lowered) console.log(`  note: ${l}`);
if (failed) {
  console.error(`\n${failed} file(s) added hex colours.`);
  process.exit(1);
}
console.log("✓ no new hex colours in src (tokens only; identity colours marked)");
