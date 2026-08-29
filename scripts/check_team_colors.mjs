#!/usr/bin/env node
/**
 * Legibility guard for TEAM DISPLAY COLOURS.
 *
 *   node scripts/check_team_colors.mjs [--verbose]
 *
 * WHEN TO RUN: after touching `src/utils/teamColors.ts`, after editing
 * `src/assets/team_info.csv`, and after changing `--card` in `src/theme.css`.
 * No network, no fixtures — it drives the SHIPPED resolver.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PROVES
 * ---------------------------------------------------------------------------
 * School colours were picked for helmets, not for a #161b22 card. Half of
 * college football wears navy, and a navy chart fill on a dark card is a bar
 * whose end the reader cannot find. `displayTeamColor(team, isDark)` is the
 * gate that stops that shipping — so this asserts the gate actually holds, for
 * EVERY school in the CSV, in BOTH themes:
 *
 *     contrastRatio(displayTeamColor(team, isDark), CARD_BG[theme]) >= 3
 *
 * 3:1 is WCAG 1.4.11's non-text floor, which is what a bar fill, a spread
 * half, a field strip and a swatch are.
 *
 * The point is the FUTURE edit. team_info.csv is a data drop — a rebrand, a
 * new FCS member, a corrected hex — and nothing about pasting a row makes it
 * obvious that #110e42 is invisible in dark mode. Without this check that lands
 * silently and the reader just sees an empty chart.
 *
 * It also asserts the resolver's OTHER two properties, because a gate that
 * passes by painting everything white would clear the contrast bar and destroy
 * the product:
 *
 *   - PURITY: the same (team, theme) returns the same hex on a second call,
 *     and the two themes are resolved independently.
 *   - IDENTITY: in LIGHT mode the overwhelming majority of schools must keep
 *     their literal primary. Light is the mode where school colours were
 *     designed to work, so a policy that starts rewriting them there has a bug,
 *     not a preference. Dark mode is deliberately NOT held to that bar — the
 *     gate is supposed to bite there — but every colour it returns must still
 *     be traceable to the school: its own primary, its own alternate, or its
 *     primary moved in lightness ONLY (hue and saturation held).
 *
 * Exit codes: 0 pass, 1 on any failure.
 */

import { build } from "esbuild";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VERBOSE = process.argv.includes("--verbose");
const ROOT = process.cwd();

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

/* ------------------------- bundle the shipped source ---------------------- */

/**
 * `teamColors.ts` pulls the CSV in with Vite's `?raw` suffix, which esbuild
 * knows nothing about. This plugin is the whole Vite feature: resolve the
 * suffix off the path, hand back the file as a default-exported string. It
 * means the check reads the SAME CSV the browser bundle does — not a re-parse
 * of my own.
 */
const rawPlugin = {
  name: "vite-raw",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
      namespace: "vite-raw",
    }));
    b.onLoad({ filter: /.*/, namespace: "vite-raw" }, async (args) => ({
      contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))};`,
      loader: "js",
    }));
  },
};

async function loadShipped() {
  const dir = await mkdtemp(join(tmpdir(), "cfb-teamcolors-"));
  const out = join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents:
        'export { displayTeamColor, allTeamColorEntries, contrastRatio,\n' +
        '         CARD_BG, CONTRAST_FLOOR } from "./src/utils/teamColors";\n',
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
    plugins: [rawPlugin],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/* ------------------------------ colour maths ------------------------------ */
/* Local copies, on purpose: asserting the resolver's output with the
   resolver's own helper would only prove it is self-consistent. HSL here is
   the independent witness that hue and saturation survived a lightness lift. */

const chans = (hex) => {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const lum = (hex) => {
  const [r, g, b] = chans(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function hsl(hex) {
  const [r, g, b] = chans(hex).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
/** Same hue and saturation, to within the rounding an 8-bit round trip costs. */
function sameHueSat(a, b) {
  const A = hsl(a), B = hsl(b);
  if (A.s < 0.02 && B.s < 0.02) return true;         // both neutral
  const dh = Math.min(Math.abs(A.h - B.h), 360 - Math.abs(A.h - B.h));
  return dh <= 4 && Math.abs(A.s - B.s) <= 0.06;
}

/* --------------------------------- the run -------------------------------- */

console.log("Team display colours: contrast, purity, identity\n");

let shipped;
try {
  shipped = await loadShipped();
} catch (err) {
  console.log(`  ! could not bundle the source: ${err.message}`);
  process.exit(1);
}
const { displayTeamColor, allTeamColorEntries, contrastRatio, CARD_BG, CONTRAST_FLOOR } =
  shipped.mod;

try {
  const teams = allTeamColorEntries();

  /* Coverage first — every assertion below is vacuous over an empty list, and
     a CSV whose School column got renamed would parse to exactly that. */
  if (teams.length < 200) bad(`only ${teams.length} schools parsed from team_info.csv (expected 200+)`);
  else ok(`${teams.length} schools parsed from team_info.csv`);

  const floor = CONTRAST_FLOOR;
  const counts = {};

  for (const theme of ["light", "dark"]) {
    const isDark = theme === "dark";
    const bg = CARD_BG[theme];
    const changed = [];
    const offenders = [];
    const untraceable = [];
    let worst = { ratio: Infinity, name: null, hex: null };

    for (const { name, colors } of teams) {
      const got = displayTeamColor(name, isDark);

      if (!got) { offenders.push(`${name}: resolver returned nothing`); continue; }
      if (!/^#[0-9a-fA-F]{6}$/.test(got)) { offenders.push(`${name}: "${got}" is not a hex`); continue; }

      // 1. THE FLOOR.
      const r = ratio(got, bg);
      if (r < floor - 1e-9) offenders.push(`${name}: ${got} on ${bg} = ${r.toFixed(2)}:1`);
      if (r < worst.ratio) worst = { ratio: r, name, hex: got };

      // 2. PURITY — same input, same output; and the themes are independent.
      if (displayTeamColor(name, isDark) !== got) offenders.push(`${name}: not deterministic`);

      // 3. IDENTITY — the school's own primary, its own alternate, or its
      //    primary/alternate moved in lightness only.
      const p = colors.primary.toLowerCase();
      const s = (colors.secondary ?? "").toLowerCase();
      const g = got.toLowerCase();
      if (g === p) continue;                       // kept the primary
      changed.push({ name, from: colors.primary, to: got });
      if (g === s) continue;                       // took the school's alternate
      if (!sameHueSat(got, colors.primary) && !(s && sameHueSat(got, s))) {
        untraceable.push(`${name}: ${colors.primary}${s ? "/" + s : ""} -> ${got} (hue/sat drift)`);
      }
    }

    counts[theme] = { changed: changed.length, total: teams.length };

    console.log(`\n${theme} (card ${bg})`);
    if (offenders.length) {
      bad(`${offenders.length} school(s) miss the ${floor}:1 floor or the purity check`);
      offenders.slice(0, 12).forEach((o) => console.log(`      ${o}`));
      if (offenders.length > 12) console.log(`      ... and ${offenders.length - 12} more`);
    } else {
      ok(`all ${teams.length} clear ${floor}:1 (worst ${worst.ratio.toFixed(2)}:1 — ${worst.name} ${worst.hex})`);
    }

    if (untraceable.length) {
      bad(`${untraceable.length} colour(s) are neither a school colour nor a lightness lift of one`);
      untraceable.slice(0, 12).forEach((o) => console.log(`      ${o}`));
    } else {
      ok("every returned colour is the school's own, or its own moved in lightness");
    }

    const pct = (100 * changed.length) / teams.length;
    console.log(`      ${changed.length}/${teams.length} schools changed (${pct.toFixed(1)}%)`);
    if (VERBOSE) changed.forEach((c) => console.log(`        ${c.name}: ${c.from} -> ${c.to}`));
  }

  /* IDENTITY, the hard bar. Light mode is where school colours were designed
     to work; if the gate is rewriting them THERE, the policy is wrong, not the
     palette. Dark carries no such bound by design. */
  const lightChanged = counts.light.changed;
  const lightPct = (100 * lightChanged) / counts.light.total;
  console.log("");
  if (lightPct > 15) {
    bad(`light mode rewrote ${lightChanged} schools (${lightPct.toFixed(1)}%) — the resolver is not primary-first`);
  } else {
    ok(`light mode keeps ${counts.light.total - lightChanged}/${counts.light.total} primaries (${(100 - lightPct).toFixed(1)}%)`);
  }
} finally {
  await shipped.cleanup();
}

console.log(failures ? `\nFAIL (${failures})` : "\nPASS");
process.exit(failures ? 1 : 0);
