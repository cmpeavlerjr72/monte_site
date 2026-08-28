#!/usr/bin/env node
/**
 * Equivalence guard for the GAME-LINE pricer.
 *
 *   node scripts/check_game_pricer.mjs [--origin https://www.mvpeav.com]
 *
 * WHEN TO RUN: after touching `buildGameYesP` (src/lib/teamStatMarkets.ts) or
 * `gameCandidates` (src/lib/suggestedBets.ts). It needs the network — it runs
 * against the REAL published week and the REAL Kalshi feed, because a fixture
 * of my own making could only prove I copied my own assumptions.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PROVES
 * ---------------------------------------------------------------------------
 * The resting-order review and the portal's held positions price a market with
 * `buildPortalYesP`, which falls through to `buildGameYesP` for the three
 * game-line families. The Suggested Bets pipeline prices the SAME markets with
 * `gameCandidates`. Two functions, one number — and if they ever disagree, one
 * surface tells the owner to hold a bet the other calls dead.
 *
 * So this asserts the identity directly, on the SHIPPED source (both modules
 * are bundled with esbuild, never re-typed here):
 *
 *     gameCandidates(...) row with side "yes"  ->  buildGameYesP(ticker) === simP
 *     gameCandidates(...) row with side "no"   ->  buildGameYesP(ticker) === 1 − simP
 *
 * because `buildGameYesP` is denominated in the RAW MARKET's YES and a "no"
 * candidate is that market's complement. Every published rung of every game on
 * the board is checked, in BOTH namespaces (FBS and FCS): the FCS game block is
 * the one that matters most, since FCS publishes no compacts, so seeds never
 * price those tickers and this pricer is the only thing standing between an FCS
 * game total and a "— no sim price" verdict.
 *
 * It also asserts COVERAGE, because an equivalence over an empty set is not a
 * result: every namespace must contribute rungs, and all three families must
 * appear.
 *
 * Exit codes: 0 pass (or a clean SKIP when the network is unavailable),
 * 1 on any mismatch or missing coverage.
 */

import { build } from "esbuild";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ORIGIN = (() => {
  const i = process.argv.indexOf("--origin");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : "https://www.mvpeav.com";
})();

/** Namespaces to check. FCS is not optional — see the header. */
const NAMESPACES = [
  { ns: "2026", repo: "cfb-sims-2026", label: "FBS" },
  { ns: "fcs-2026", repo: "cfb-sims-fcs-2026", label: "FCS" },
];
const WEEK = "week00";

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

/* ------------------------- bundle the shipped source ---------------------- */

async function loadShipped() {
  const dir = await mkdtemp(join(tmpdir(), "cfb-pricer-"));
  const out = join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents:
        'export { buildGameYesP } from "./src/lib/teamStatMarkets";\n' +
        'export { gameCandidates } from "./src/lib/suggestedBets";\n',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/* ------------------------------- the feeds -------------------------------- */

async function getJson(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** The client's own parse of team_stats.json is in cfbJson.ts; the two fields
 *  this check reads are plain numbers, so it maps the raw file directly rather
 *  than dragging the whole loader (and its fetch plumbing) into node. */
const toDocs = (raw, ns) => ({
  [ns]: {
    games: Object.fromEntries(
      Object.entries(raw.games ?? {}).map(([slug, g]) => [slug, {
        teamA: g.teamA, teamB: g.teamB, stats: {},
        game: g.game ? {
          winProbHome: g.game.win_prob_home ?? null,
          winProbAway: g.game.win_prob_away ?? null,
          marginRungs: g.game.margin_rungs ?? null,
          totalRungs: g.game.total_rungs ?? null,
        } : undefined,
      }]),
    ),
  },
});

/* --------------------------------- the run -------------------------------- */

console.log(`Game-line pricer equivalence (${ORIGIN}, ${WEEK})\n`);

let shipped;
try {
  shipped = await loadShipped();
} catch (err) {
  console.log(`  ! could not bundle the source: ${err.message}`);
  process.exit(1);
}
const { buildGameYesP, gameCandidates } = shipped.mod;

let checkedTotal = 0;
const familiesSeen = new Set();

try {
  for (const { ns, repo, label } of NAMESPACES) {
    console.log(`${label} (${ns})`);
    let statsRaw, feed;
    try {
      [statsRaw, feed] = await Promise.all([
        getJson(`${ORIGIN}/api/data/${repo}/${ns}/weeks/${WEEK}/team_stats.json`),
        getJson(`${ORIGIN}/api/kalshi/cfb?season=${encodeURIComponent(ns)}&week=${WEEK}`),
      ]);
    } catch (err) {
      console.log(`\nSKIPPED — published data unreachable (${err.message}).`);
      console.log("This check needs the live week; it is not a code failure.");
      await shipped.cleanup();
      process.exit(0);
    }

    const docs = toDocs(statsRaw, ns);
    // The page keys `kalshiBySlug` by CARD key and FCS cards are prefixed; the
    // pricers only require the two maps to agree, so the same key is used for
    // both here and the prefix is irrelevant to what is being proven.
    const kalshiBySlug = new Map();
    const refs = [];
    for (const g of feed.games ?? []) {
      if (!g?.slug) continue;
      kalshiBySlug.set(g.slug, g);
      const doc = docs[ns].games[g.slug];
      if (!doc) continue;
      refs.push({ key: g.slug, slug: g.slug, ns, teamA: doc.teamA, teamB: doc.teamB });
    }

    const yesP = buildGameYesP(docs, refs, kalshiBySlug);

    let checked = 0, mismatches = 0, mirrored = 0;
    for (const r of refs) {
      const lines = docs[ns].games[r.slug].game;
      if (!lines) continue;
      const cands = gameCandidates(
        kalshiBySlug.get(r.key), r.key, r.teamA, r.teamB, lines, undefined,
      );
      for (const c of cands) {
        const raw = yesP(c.ticker);
        const want = c.side === "no" ? 1 - c.simP : c.simP;
        familiesSeen.add(c.series);
        checked++;
        // Exact to floating-point slop only: both sides read the SAME published
        // number, so anything above 1e-12 means a different rung was read.
        if (raw === null || Math.abs(raw - want) > 1e-12) {
          mismatches++;
          if (mismatches <= 5) {
            console.log(`    ${c.ticker} side=${c.side}: pricer ${raw} vs pipeline ${want}`);
          }
        }
      }
      mirrored += (kalshiBySlug.get(r.key).spread_ladder ?? []).filter((x) => x.mirrored).length;
    }

    checkedTotal += checked;
    if (checked === 0) bad(`${label}: no published rungs to check (coverage gap)`);
    else if (mismatches) bad(`${label}: ${mismatches}/${checked} contracts disagree with the pipeline`);
    else ok(`${label}: ${checked} contracts, every one priced exactly as gameCandidates does`);
    if (mirrored > 0) ok(`${label}: ${mirrored} MIRRORED spread rungs included (the complement path)`);
    else console.log(`    (no mirrored spread rungs listed right now — complement path untested here)`);
  }

  console.log("\nCoverage");
  for (const fam of ["KXNCAAFGAME", "KXNCAAFSPREAD", "KXNCAAFTOTAL"]) {
    if (familiesSeen.has(fam)) ok(`${fam} priced`);
    else bad(`${fam} never appeared — the family is unproven`);
  }
  if (checkedTotal < 50) bad(`only ${checkedTotal} contracts checked — too thin to call a pass`);
  else ok(`${checkedTotal} contracts checked across both namespaces`);
} finally {
  await shipped.cleanup();
}

console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll game-pricer checks passed.");
process.exit(failures ? 1 : 0);
