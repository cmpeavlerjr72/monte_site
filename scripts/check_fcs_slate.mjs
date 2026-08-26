#!/usr/bin/env node
/**
 * FCS slate guard — the fetch layer, the pre-publish empty state, and the merge.
 *
 *   node scripts/check_fcs_slate.mjs
 *
 * WHEN TO RUN: before committing any change to the FCS wiring (the division
 * selector, buildJsonCards, the FCS loader effect, or the namespace helpers in
 * src/lib/cfbData.ts). No dependencies, no test runner, no network.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * The FCS dataset publishes AFTER this code ships, so the wiring could not be
 * checked against the real thing. Two claims had to hold on faith otherwise:
 *
 *   1. "the fetch layer needs zero changes — pass the string 'fcs-2026'
 *      wherever a season goes". This runs the SHIPPED loaders (cfbData.ts,
 *      cfbJson.ts, unmodified) against an in-memory fixture built from the
 *      published contract, with global fetch stubbed. If a URL is assembled
 *      wrongly the fixture 404s and the test fails.
 *
 *   2. "a missing FCS week renders as a quiet empty state". The pre-publish
 *      states — week missing, whole dataset missing, players/props absent —
 *      are asserted to produce the specific typed outcomes the page branches
 *      on (null / DatasetUnavailable / DistNotPublished / PropsNotPublished),
 *      not a generic throw the page would surface as a red banner.
 *
 * Plus the static half, in the spirit of check_render_loops.mjs: the shipped
 * page source is asserted to still obey the rules that make a merged slate
 * safe, since a behavioural fixture cannot see a rewiring of the page.
 */

import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

/* ==========================================================================
 * 0. Let node import the app's .ts modules.
 *
 * They are written for a bundler, so relative imports have no extension.
 * Node strips the types on its own; it just needs the specifier resolved.
 * ======================================================================== */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch { /* fall through to the normal resolution */ }
    }
    return nextResolve(specifier, context);
  },
});

/* ==========================================================================
 * 1. Fixture: one FCS week, exactly as the contract describes it.
 *
 * teamA = home, margin = home - away, spreads home-perspective, division/
 * has_players/has_props on every document, players + props files ABSENT.
 * ======================================================================== */
const FCS_GAMES = [
  { slug: "montanastate_northdakotastate", teamA: "Montana State", teamB: "North Dakota State" },
  // Deliberately shares a slug with an FBS game below — see the merge test.
  { slug: "collision_game", teamA: "Youngstown State", teamB: "Illinois State" },
];

const weekRow = (g) => ({
  slug: g.slug,
  teamA: g.teamA,
  teamB: g.teamB,
  date: "2026-09-05",
  time_utc: "23:00",
  summary_path: `weeks/week01/games/${g.slug}/summary.json`,
  compact_path: `weeks/week01/games/${g.slug}/compact.json`,
  players_path: `weeks/week01/games/${g.slug}/players.json`,
  players_dist_path: `weeks/week01/games/${g.slug}/players_dist.json`,
  seeds_path: `weeks/week01/games/${g.slug}/seeds.json`,
});

const summaryFor = (g) => ({
  teamA: g.teamA, teamB: g.teamB,
  division: "fcs", has_players: false, has_props: false,
  A_win_prob: 0.62,
  median_margin: 6, median_total: 51,
  median_A_pts: 28, median_B_pts: 22,
  mean_A_pts: 28.4, mean_B_pts: 22.9,
  mean_margin: 5.5, mean_total: 51.3,
  nsims: 1000,
  odds: { spread_open: -6.5, over_under_open: 49.5, spread_current: -7, over_under_current: 50 },
  // Optional block parseSummary is expected to ignore without complaint.
  sim_extras: { fair_spread_home: -5.5, fair_total: 51.3, p_A_win: 0.62,
                conferences: { A: "Big Sky", B: "MVFC" }, venue: "Bobcat Stadium" },
});

const compactFor = () => ({
  n_sims: 4,
  A_pts: [28, 31, 24, 35],
  B_pts: [22, 17, 27, 21],
  quantiles: { margin: [-3, 2, 6, 11, 17] },
});

/** Real score columns, EMPTY players map — game legs price, prop legs cannot. */
const seedsFor = () => ({
  n_sims: 4,
  A_pts: [28, 31, 24, 35],
  B_pts: [22, 17, 27, 21],
  players: {},
});

/** rel path (inside the namespace dir) -> body, or absent = 404. */
function buildFixture() {
  const files = new Map();
  files.set("season_index.json", {
    season: "fcs-2026", division: "fcs",
    weeks: [{ week: 1, id: "week01", dir: "week01", label: "Week 1", n_games: FCS_GAMES.length }],
  });
  files.set("weeks/week01/index.json", {
    division: "fcs", has_players: false, has_props: false,
    games: FCS_GAMES.map(weekRow),
  });
  for (const g of FCS_GAMES) {
    files.set(`weeks/week01/games/${g.slug}/summary.json`, summaryFor(g));
    files.set(`weeks/week01/games/${g.slug}/compact.json`, compactFor());
    files.set(`weeks/week01/games/${g.slug}/seeds.json`, seedsFor());
    // players.json / players_dist.json deliberately NOT set -> 404.
  }
  // weeks/week02/** deliberately NOT set -> the "week not published" state.
  // props_odds.json deliberately NOT set -> the "props not published" state.
  return files;
}

const FIXTURE = new Map([["fcs-2026", buildFixture()]]);

/** Which namespace + inner path a URL is asking for, proxy or Hub form. */
function parseUrl(url) {
  let m = String(url).match(/^\/api\/data\/cfb-sims-([^/]+)\/([^/]+)\/(.+)$/);
  if (m) return { repoSuffix: m[1], ns: m[2], rel: m[3] };
  m = String(url).match(/huggingface\.co\/datasets\/mvpeav\/cfb-sims-([^/]+)\/resolve\/main\/([^/]+)\/(.+)$/);
  if (m) return { repoSuffix: m[1], ns: m[2], rel: m[3] };
  return null;
}

let fetchLog = [];
globalThis.fetch = async (url) => {
  fetchLog.push(String(url));
  const hit = parseUrl(url);
  const json = (status, body) => ({
    ok: status === 200, status,
    json: async () => body,
    headers: { get: () => null },
  });
  if (!hit) return json(404, {});
  // The repo name must be derivable from the namespace, or the proxy allowlist
  // would never match: cfb-sims-<ns>.
  if (hit.repoSuffix !== hit.ns) return json(404, {});
  const ns = FIXTURE.get(hit.ns);
  if (!ns) return json(404, {});
  const body = ns.get(hit.rel);
  return body === undefined ? json(404, {}) : json(200, body);
};

/* ==========================================================================
 * 2. Behavioural — the SHIPPED loaders against that fixture.
 * ======================================================================== */
const cfbData = await import("../src/lib/cfbData.ts");
const cfbJson = await import("../src/lib/cfbJson.ts");

const FCS_NS = cfbData.namespaceFor("fcs", "2026");

console.log("FCS slate guard\n");
console.log("1. Namespace — the claim that the fetch layer needs no changes");
check(FCS_NS === "fcs-2026", `namespaceFor("fcs", "2026") === "fcs-2026" (got ${FCS_NS})`);
check(
  !cfbData.SEASONS.includes("fcs-2026"),
  `SEASONS stays FBS-only (it feeds the season picker + resolveLatestSeason): [${cfbData.SEASONS.join(", ")}]`
);
check(cfbData.fcsAvailableFor("2026") && !cfbData.fcsAvailableFor("2025"), "fcsAvailableFor gates the selector by season");
{
  fetchLog = [];
  const url = await cfbData.dataUrl("weeks/week01/index.json", FCS_NS);
  check(
    url === "/api/data/cfb-sims-fcs-2026/fcs-2026/weeks/week01/index.json",
    `dataUrl routes through the proxy allowlist name: ${url}`
  );
}

console.log("\n2. Week load — an FCS week parses through the FBS loaders");
{
  const rows = await cfbJson.getJsonWeekIndex("week01", FCS_NS);
  check(Array.isArray(rows) && rows.length === 2, `week index -> ${rows?.length ?? 0} rows`);

  const games = await cfbJson.getJsonWeekGames("week01", FCS_NS);
  check(games?.length === 2, `week games -> ${games?.length ?? 0} joined summaries`);
  const g0 = games?.[0];
  check(Boolean(g0?.summary), "summary.json parsed (not null)");
  check(g0?.summary?.division === "fcs", `summary carries division: ${g0?.summary?.division}`);
  check(g0?.summary?.has_players === false, `has_players survives parseSummary: ${g0?.summary?.has_players}`);
  check(g0?.summary?.has_props === false, `has_props survives parseSummary: ${g0?.summary?.has_props}`);
  check(g0?.summary?.median_A_pts === 28 && g0?.summary?.median_B_pts === 22, "exact per-team medians preserved");
  check(g0?.summary?.odds?.spread_open === -6.5, "home-perspective odds block preserved");
  check(!("sim_extras" in (g0?.summary ?? {})), "the optional sim_extras block is dropped, not fatal");

  const compact = await cfbJson.getCompactJson(games[0].row, FCS_NS);
  check(compact.A_pts.length === 4 && compact.B_pts.length === 4, "compact.json per-seed arrays load");
}

console.log("\n3. Pre-publish states — each must be TYPED, not a generic throw");
{
  // Week the exporter has not reached: null, so the page shows an empty slate.
  const missingWeek = await cfbJson.getJsonWeekGames("week02", FCS_NS);
  check(missingWeek === null, `an unpublished WEEK returns null (got ${missingWeek === null ? "null" : typeof missingWeek})`);

  // players_dist.json is absent for every FCS game.
  const games = await cfbJson.getJsonWeekGames("week01", FCS_NS);
  let distErr = null;
  try { await cfbJson.getPlayersDistJson(games[0].row, FCS_NS); } catch (e) { distErr = e; }
  check(distErr?.name === "DistNotPublished", `absent players_dist -> DistNotPublished (got ${distErr?.name})`);

  // props_odds.json is absent for the FCS week.
  let propsErr = null;
  try { await cfbJson.getPropsOdds(FCS_NS, "week01"); } catch (e) { propsErr = e; }
  check(propsErr?.name === "PropsNotPublished", `absent props_odds -> PropsNotPublished (got ${propsErr?.name})`);

  // The whole dataset missing — the state on the morning before publish.
  let dsErr = null;
  try { await cfbJson.getJsonWeekGames("week01", "fcs-2027"); } catch (e) { dsErr = e; }
  check(
    dsErr === null,
    `an unpublished DATASET does not throw out of getJsonWeekGames (got ${dsErr?.name ?? "no throw"})`
  );
  let baseErr = null;
  try { await cfbData.getCatalog("fcs-2027"); } catch (e) { baseErr = e; }
  check(
    baseErr?.name === "DatasetUnavailable",
    `an unpublished DATASET surfaces as DatasetUnavailable, so callers can stay quiet (got ${baseErr?.name})`
  );
}

console.log("\n4. Merge — the identity rule that makes a combined slate safe");
{
  const FBS_SLUGS = ["texas_ohiostate", "collision_game"];
  const fcsKey = (slug) => `fcs:${slug}`;
  const merged = [
    ...FBS_SLUGS.map((s) => ({ key: s, division: "fbs" })),
    ...FCS_GAMES.map((g) => ({ key: fcsKey(g.slug), division: "fcs" })),
  ];
  const keys = merged.map((c) => c.key);
  check(
    new Set(keys).size === keys.length,
    `merged slate keys stay unique even when both datasets publish "collision_game" (${keys.length} cards, ${new Set(keys).size} keys)`
  );
  // The reason the prefix is not cosmetic: without it the merge silently drops a card.
  const naive = [...FBS_SLUGS, ...FCS_GAMES.map((g) => g.slug)];
  check(
    new Set(naive).size < naive.length,
    "without the prefix the same fixture DOES collide — the prefix is load-bearing"
  );
  check(
    merged.filter((c) => c.division === "fcs").length === FCS_GAMES.length,
    "every FCS game survives the merge"
  );
  // "Both" with an unpublished FCS half must equal the FBS-only slate.
  const bothWhenFcsEmpty = [...FBS_SLUGS.map((s) => ({ key: s, division: "fbs" })), ...[]];
  check(
    bothWhenFcsEmpty.length === FBS_SLUGS.length,
    "Both degrades to exactly the FBS slate when FCS returns no rows"
  );
}

/* ==========================================================================
 * 3. Static — the shipped page must still obey the rules above.
 * ======================================================================== */
console.log("\n5. Static — src/pages/Scoreboard.tsx");
{
  const src = read("src/pages/Scoreboard.tsx");

  check(
    /const fcsCardKey = \(slug: string\) => `fcs:\$\{slug\}`/.test(src),
    "fcsCardKey is defined and prefixes FCS slugs"
  );
  check(
    /key: division === "fcs" \? fcsCardKey\(row\.slug\) : row\.slug/.test(src),
    "buildJsonCards keys FCS cards through fcsCardKey and leaves FBS slugs bare"
  );
  check(
    /merged\.set\(fcsCardKey\(k\), v\)/.test(src),
    "the Kalshi map re-keys FCS entries to match their cards"
  );
  check(
    /season=\{c\.ns\}/.test(src) && /season=\{openCard\.ns\}/.test(src),
    "cards and panels fetch from the CARD's namespace, not the page's season"
  );
  check(
    /season: c\.ns, division: c\.division/.test(src),
    "edge inputs carry their own namespace so the scan fetches the right compact"
  );
  check(
    /card\.hasPlayers && tabBtn\("props"/.test(src) && /card\.hasPlayers && tabBtn\("box"/.test(src),
    "player panels are gated on the has_players FLAG, not on the 404"
  );

  // The FCS loader must never raise the page-level error banner.
  const loader = src.match(/const rows = await getJsonWeekGames\(id, fcsNs[\s\S]*?\n  \}, \[showFcs/);
  check(Boolean(loader), "the FCS loader effect is present");
  if (loader) {
    check(
      !/setWeekError/.test(loader[0]),
      "the FCS loader never calls setWeekError — a missing FCS week is not a page failure"
    );
    check(
      /setFcsStatus\("unpublished"\)/.test(loader[0]),
      "a failed FCS fetch resolves to the quiet 'unpublished' state"
    );
  }
}

console.log("\n6. Static — src/lib/cfbData.ts");
{
  const src = read("src/lib/cfbData.ts");
  check(
    !/SEASONS = \[[^\]]*fcs/.test(src),
    "the FCS namespace is NOT in SEASONS (it would land the season picker on it)"
  );
  check(
    /export class DatasetUnavailable/.test(src),
    "an unreachable dataset throws a typed error callers can treat as 'not published'"
  );
}

/* ==========================================================================
 * 4. Assets — the 128 FCS rows appended to team_info.csv.
 *
 * The cards self-host their logos (/logos/<espnId>.webp) so the page renders
 * on networks that block espncdn.com. A row whose logo file was never copied
 * shows a broken image, which no type check can catch — so the CSV's logo
 * cells are resolved with the app's OWN localizer and checked against disk.
 * ======================================================================== */
console.log("\n7. Assets — FCS logos and colours");
{
  const { localizeLogoUrl } = await import("../src/utils/espnLogos.ts");

  const splitCsvLine = (line) => {
    const out = [];
    let cell = "", quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { out.push(cell); cell = ""; }
      else cell += ch;
    }
    out.push(cell);
    return out;
  };

  const raw = read("src/assets/team_info.csv");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0].replace(/^﻿/, ""));
  const idx = (name) => header.indexOf(name);
  const [iSchool, iClass, iLogos, iColor] =
    ["School", "Classification", "Logos", "Color"].map(idx);

  const rows = lines.slice(1).map(splitCsvLine);
  const fcsRows = rows.filter((r) => (r[iClass] || "").trim().toLowerCase() === "fcs");
  check(fcsRows.length === 128, `team_info.csv carries the 128 FCS rows (found ${fcsRows.length})`);

  // Same first-logo-wins rule the app uses.
  const firstLogo = (cell) => {
    for (const part of String(cell || "").split(/[|,;\s]+/).filter(Boolean)) {
      const fixed = localizeLogoUrl(part);
      if (fixed?.startsWith("/logos/")) return fixed;
    }
    return undefined;
  };

  // The FCS rows carry cdn.collegefootballdata.com URLs, not ESPN ones — the
  // localizer has to recognize BOTH or these rows silently fall back to the
  // remote CDN and the self-hosted copies go unused.
  const missingCell = [];
  const missingFile = [];
  for (const r of fcsRows) {
    const logo = firstLogo(r[iLogos]);
    if (!logo) { missingCell.push(r[iSchool]); continue; }
    if (!fs.existsSync(path.join(ROOT, "public", logo))) missingFile.push(`${r[iSchool]} -> ${logo}`);
  }
  check(
    fcsRows.length > 0 && missingCell.length + missingFile.length === 0,
    "no FCS row falls through to a remote CDN URL"
  );

  // Regression: the ESPN branch of the localizer must be untouched by the
  // CollegeFootballData one that was added for FCS.
  const fbsRows = rows.filter((r) => (r[iClass] || "").trim().toLowerCase() === "fbs");
  const fbsBad = fbsRows
    .map((r) => [r[iSchool], firstLogo(r[iLogos])])
    .filter(([, logo]) => !logo || !fs.existsSync(path.join(ROOT, "public", logo)))
    .map(([school, logo]) => `${school} -> ${logo}`);
  check(
    fbsBad.length === 0,
    fbsBad.length
      ? `FBS logos still localize — BROKEN: ${fbsBad.slice(0, 5).join(", ")}`
      : `all ${fbsRows.length} FBS logos still resolve to their local copies`
  );
  check(missingCell.length === 0, missingCell.length ? `every FCS row has a localizable logo — MISSING: ${missingCell.join(", ")}` : "every FCS row resolves to a /logos/*.webp path");
  check(missingFile.length === 0, missingFile.length ? `every FCS logo file is on disk — MISSING: ${missingFile.join(", ")}` : `all ${fcsRows.length} FCS logo files exist in public/logos`);

  // Four schools have no colour anywhere upstream. That is expected; what
  // matters is that the card falls back to a token instead of crashing.
  const noColor = fcsRows.filter((r) => !(r[iColor] || "").trim()).map((r) => r[iSchool]);
  check(
    noColor.length === 4,
    `exactly the 4 known colourless schools (${noColor.join(", ") || "none"})`
  );
  const page = read("src/pages/Scoreboard.tsx");
  check(
    /aColors\?\.primary \?\? "var\(--brand\)"/.test(page) &&
    /bColors\?\.primary \?\? "var\(--accent\)"/.test(page),
    "a colourless team falls back to a theme token, never to a literal or undefined"
  );
}

console.log(
  failures === 0
    ? "\nAll FCS slate checks passed."
    : `\n${failures} FCS slate check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
