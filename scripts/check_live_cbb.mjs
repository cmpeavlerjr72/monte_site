#!/usr/bin/env node
/**
 * Unit checks for the basketball live path (no network).
 *
 *   node scripts/check_live_cbb.mjs
 *
 * Bundles the SHIPPED src/lib/{liveGrid,liveRecord,mbbLive}.ts with esbuild and
 * prices a tiny hand-computable fixture:
 *   - remaining margin is uniform on -2..2 in every coarse cell (so P(win) etc.
 *     are fractions of five), remaining total is uniform on c-4..c+4 with
 *     c = 140 - 7*timeBin + 2*(totalBin-2); the late block is uniform on c-2..c+2
 *     with c = 24 - 3*lateBin; the end row's overtime margin is uniform -3..3 and
 *     total uniform 8..12.
 * Covered: first half 12:00 left home +5; halftime (name, and the unknown
 * "period 2, full clock" encoding); second half 2:30 left away +3 (late block);
 * final / end of regulation (exact, no fade); level game and lead in OT; the
 * absence path (no live.json -> null, football files untouched).
 * Exit 0 on pass, 1 on any failure.
 */
import { build } from "esbuild";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures++; console.log(`  FAIL ${m}`); };
const eq = (name, got, want, tol = 0.01) =>
  (typeof want === "number" && typeof got === "number" ? Math.abs(got - want) <= tol : got === want)
    ? ok(`${name} = ${got}`) : bad(`${name}: got ${got}, want ${want}`);

async function load() {
  const dir = await mkdtemp(join(tmpdir(), "cbb-live-"));
  const entry = join(dir, "entry.ts");
  const src = (f) => resolve("src/lib", f).replace(/\\/g, "/");
  await writeFile(entry, [
    `export * from ${JSON.stringify(src("liveGrid"))};`,
    `export * from ${JSON.stringify(src("liveRecord"))};`,
    `export * from ${JSON.stringify(src("mbbLive"))};`,
    `export * from ${JSON.stringify(src("liveJoin"))};`,
    `export { parseMbbSummary } from ${JSON.stringify(src("espnMbb"))};`,
    `export * from ${JSON.stringify(src("liveOddsCbb"))};`,
    `export { pickCbbDay, selectBandRows } from ${JSON.stringify(src("upNextCbb"))};`,
  ].join("\n"));
  const out = join(dir, "out.mjs");
  await build({
    entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node",
    logLevel: "silent", define: { "import.meta.env": "{}" },
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/* ------------------------------ fixture ---------------------------------- */
// Raw (per-mille) curve for X uniform on lo..hi.
function uni(lo, hi) {
  const n = hi - lo + 1;
  return { k0: lo, v: Array.from({ length: n }, (_, j) => Math.round(1000 * (1 - j / n))) };
}
const MARGIN_EDGES = [-11, -6, -2, 3, 7, 12];
const LATE_EDGES = [-6, -3, -1, 1, 3, 6];
const TOTAL_EDGES = [20, 30, 40, 50]; // same every time bin; total-so-far 35 -> bin 2, 55 -> bin 4

function fixtureRaw({ thinLate = false } = {}) {
  const nT = 20;
  const grid = (f) => Array.from({ length: nT }, (_, t) => Array.from({ length: 7 }, (_, b) => f(t, b)));
  return {
    game_id: 1, slug: "a_b", teamA: "A", teamB: "B", n_sims: 2500,
    clock: { regulation_s: 2400, period_s: 1200, n_periods: 2, ot_period_s: 300 },
    grid: {
      time_bin_s: 120, n_time: nT, margin_bin: 2, margin_min: -28, margin_max: 28, n_margin: 29, min_n: 100,
      p_home_win: [[0.5]], mean_total: [[140]], mean_margin: [[0]], n: [[500]],
    },
    uncond: { p_home_win: 0.5, mean_total: 140, mean_margin: 0 },
    remaining: {
      time_bin_s: 120, n_time: nT, margin_edges: MARGIN_EDGES,
      margin_sf: grid(() => uni(-2, 2)),
      // total-keyed: 7 columns published, only the first 5 are total bins
      total_sf: grid((t, b) => uni(140 - 7 * t + 2 * (b - 2) - 4, 140 - 7 * t + 2 * (b - 2) + 4)),
      time_margin_sf: Array.from({ length: nT }, () => uni(-2, 2)),
      time_total_sf: Array.from({ length: nT }, (_, t) => uni(140 - 7 * t - 4, 140 - 7 * t + 4)),
      total_edges: Array.from({ length: nT }, () => TOTAL_EDGES),
      late: {
        start_s: 2160, time_bin_s: 30, n_time: 8, margin_edges: LATE_EDGES,
        margin_sf: Array.from({ length: 8 }, () => Array.from({ length: 7 }, () => uni(-1, 1))),
        total_sf: Array.from({ length: 8 }, (_, j) =>
          Array.from({ length: 7 }, () => uni(24 - 3 * j - 2, 24 - 3 * j + 2))),
      },
      end: { tied_margin_sf: uni(-3, 3), tied_total_sf: uni(8, 12) },
    },
  };
}

function footballRaw() {
  const nT = 30;
  const cell = () => ({ k0: 0, v: [1000, 500] }); // remaining ~ 0 or 1 w.p. 1/2
  return {
    game_id: 2, slug: "f_g", teamA: "F", teamB: "G", n_sims: 10000,
    grid: { time_bin_s: 120, n_time: nT, margin_bin: 2, margin_min: -28, margin_max: 28, n_margin: 29, min_n: 100,
      p_home_win: [[0.5]], mean_total: [[50]], mean_margin: [[0]], n: [[500]] },
    uncond: { p_home_win: 0.5, mean_total: 50, mean_margin: 0 },
    remaining: {
      time_bin_s: 120, n_time: nT, margin_edges: [-14, -7, 0, 1, 8, 15],
      margin_sf: Array.from({ length: nT }, () => Array.from({ length: 7 }, cell)),
      total_sf: Array.from({ length: nT }, () => Array.from({ length: 7 }, cell)),
      time_margin_sf: Array.from({ length: nT }, cell), time_total_sf: Array.from({ length: nT }, cell),
    },
  };
}

const mbbEvent = (name, state, period, clock, extra = {}) => ({
  id: "1",
  status: { clock, period, type: { name, state, completed: state === "post", shortDetail: extra.detail ?? "" } },
  competitions: [{ status: { clock, period, type: { name, state, completed: state === "post", shortDetail: extra.detail ?? "" } },
    situation: extra.possession ? { possession: extra.possession } : undefined }],
});

/* ------------------------------- checks ---------------------------------- */
const { mod, cleanup } = await load();
try {
  const { parseLiveGrid, simStateOf, expectedRemaining, projectedFinal, pWinA, pCoverA, pOver, parseMbbStatus, fetchLiveGrid } = mod;
  const g = parseLiveGrid(fixtureRaw());
  if (!g || !g.remaining || !g.clock) { bad("fixture did not parse"); throw new Error("fixture"); }
  ok("cbb live.json parses (clock, total_edges, late, end)");

  console.log("first half, 12:00 left (period 1, clock 720), home +5, A 20 B 15");
  let st = simStateOf(20, 15, 1, 720, undefined, g.clock);
  eq("elapsed", st.elapsed, 480); eq("ot", st.ot, false);
  // bins 3,4 at pos 3.5: remaining total c = 119 and 112 (+0 offset, total-so-far 35 -> bin 2)
  eq("projected total", projectedFinal(g, st).A + projectedFinal(g, st).B, 35 + 115.5);
  eq("P(home win), margin +5", pWinA(g, st), 1);
  eq("P(home covers -6.5) = P(X>=2)", pCoverA(g, st, -6.5), 0.2);
  eq("P(over 150.5) = (8/9+1/9)/2", pOver(g, st, 150.5), 0.5);
  st = simStateOf(30, 25, 1, 720, undefined, g.clock); // total so far 55 -> total bin 4 (+4)
  eq("hot game (total 55) projected total", (({ A, B }) => A + B)(projectedFinal(g, st)), 55 + 115.5 + 4);

  console.log("halftime");
  const ht = parseMbbStatus(mbbEvent("STATUS_HALFTIME", "in", 2, 0));
  eq("halftime flag", ht.halftime, true); eq("normalised period", ht.period, 1); eq("normalised clock", ht.clockSec, 0);
  const ht2 = parseMbbStatus(mbbEvent("STATUS_IN_PROGRESS", "in", 2, 1200));
  eq("unknown encoding (p2, full clock) -> halftime", ht2.halftime, true);
  eq("unknown encoding flagged", ht2.flags.includes("halftime_p2_full_clock"), true);
  st = simStateOf(40, 38, ht.period, ht.clockSec, undefined, g.clock);
  eq("halftime elapsed", st.elapsed, 1200);
  // pos (1200-60)/120 = 9.5 -> bins 9, 10: c = 77, 70 -> 73.5
  eq("halftime projected total (total 78 -> total bin 4, +4)", (({ A, B }) => A + B)(projectedFinal(g, st)), 78 + 73.5 + 4);
  eq("P(home win) at +2: P(X>=-1) + P(X=-2)/2", pWinA(g, st), 0.9);
} catch (e) { if (e.message !== "fixture") { bad(String(e.stack || e)); } }
finally { /* keep going below with a fresh scope */ }

try {
  const { parseLiveGrid, simStateOf, expectedRemaining, projectedFinal, pWinA, pCoverA, pOver, parseMbbStatus, fetchLiveGrid } = mod;
  const g = parseLiveGrid(fixtureRaw());

  console.log("second half, 2:30 left (period 2, clock 150), away +3, A 63 B 66 (total 129)");
  let st = simStateOf(63, 66, 2, 150, undefined, g.clock);
  eq("elapsed", st.elapsed, 2250);
  // late block, lpos 2.5 -> bins 2,3: c = 18, 15 -> 16.5 (coarse would give 12.25)
  eq("late-block projected total", (({ A, B }) => A + B)(projectedFinal(g, st)), 129 + 16.5);
  eq("remaining margin mean", expectedRemaining(g, st).margin, 0);
  // margin -3: late bin [-3,-1); remaining margin uniform -1..1; A wins needs X>3: never
  eq("P(home win)", pWinA(g, st), 0);
  eq("P(home covers +3.5) = P(X >= 0)", pCoverA(g, st, 3.5), 2 / 3);
  // thin late cell -> coarse fallback at the same clock
  const thin = fixtureRaw();
  thin.remaining.late.margin_sf[2][2] = null;
  const gt = parseLiveGrid(thin);
  const thinTot = (({ A, B }) => A + B)(projectedFinal(gt, st));
  // bin 2 falls back to the coarse block at 2235 s (18.125 pos: c 18 -> 11 incl. +4 total bin), bin 3 stays late (15)
  eq("thin late cell falls back to the coarse block", thinTot, 129 + (17.125 + 15) / 2);

  console.log("end of regulation / final: exact, no fade");
  st = simStateOf(70, 67, 2, 0, undefined, g.clock);
  eq("elapsed", st.elapsed, 2400);
  eq("decided game P(home win) exactly 1", pWinA(g, st), 1, 1e-12);
  eq("decided game remaining total exactly 0", expectedRemaining(g, st).total, 0, 1e-12);
  st = simStateOf(67, 70, 2, 0, undefined, g.clock);
  eq("decided away P(home win) exactly 0", pWinA(g, st), 0, 1e-12);
  st = simStateOf(68, 68, 2, 0, undefined, g.clock);
  eq("level at the horn P(home win) = 0.5", pWinA(g, st), 0.5);
  eq("level at the horn remaining total = OT mean", expectedRemaining(g, st).total, 10);
  st = simStateOf(68, 68, 2, 8, undefined, g.clock);
  const interp = expectedRemaining(g, st).total; // between last late mid (c=3, 2385) and end row (10)
  eq("8 s left level: between late and end rows", interp > 3 && interp < 10, true);
  st = simStateOf(60, 60, 3, 200, undefined, g.clock);
  eq("OT flag (period 3)", st.ot, true);
  eq("level in OT priced off the OT distribution", pWinA(g, st), 0.5);
  st = simStateOf(70, 66, 3, 200, undefined, g.clock);
  eq("OT with a lead: not priced (B9)", pWinA(g, st), null);
  const fin = parseMbbStatus(mbbEvent("STATUS_FINAL", "post", 2, 0));
  eq("final parses", fin.state, "final");
  const live = parseMbbStatus(mbbEvent("STATUS_IN_PROGRESS", "in", 2, 150, { possession: "99" }));
  eq("possession when present", live.possessionId, "99");
  eq("live period/clock", `${live.period}/${live.clockSec}`, "2/150");
  eq("OT parse", parseMbbStatus(mbbEvent("STATUS_IN_PROGRESS", "in", 3, 240)).ot, true);

  console.log("absence: no live.json -> board unchanged");
  eq("parseLiveGrid(null)", parseLiveGrid(null), null);
  eq("parseLiveGrid({}) (no grid)", parseLiveGrid({}), null);
  const noGrid = fixtureRaw(); delete noGrid.grid;
  eq("cbb file missing grid is rejected", parseLiveGrid(noGrid), null);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    eq("fetchLiveGrid 404 -> null", await fetchLiveGrid("cbb-2027", "2026-11-02", "a_b"), null);
    globalThis.fetch = async () => { throw new Error("network"); };
    eq("fetchLiveGrid network error -> null", await fetchLiveGrid("cbb-2027", "2026-11-02", "a_b"), null);
  } finally { globalThis.fetch = realFetch; }
  const noRem = fixtureRaw(); delete noRem.remaining;
  const gn = parseLiveGrid(noRem);
  eq("grid without remaining prices nothing", pWinA(gn, simStateOf(1, 0, 1, 600, undefined, gn.clock)), null);

  console.log("football regression (no clock block)");
  const fg = parseLiveGrid(footballRaw());
  eq("football file has no cbb clock", fg.clock, undefined);
  eq("football elapsed (Q2, 300 left)", simStateOf(7, 3, 2, 300).elapsed, 1500);
  eq("football OT (period 5) elapsed", simStateOf(7, 7, 5, 100).elapsed, 3599);
  eq("football OT flag", simStateOf(7, 7, 5, 100).ot, true);
  eq("football prices (mean remaining total = 0.5)", expectedRemaining(fg, simStateOf(7, 3, 2, 300)).total, 0.5);
  // fade-to-zero is still football's: at 3599 with a lead the remaining mean is faded to ~0
  const late = expectedRemaining(fg, simStateOf(14, 3, 4, 1)).total;
  eq("football fade near the gun", late < 0.1, true);
} catch (e) { bad(String(e.stack || e)); }
finally { await cleanup(); }

/* ---- join of a CAPTURED in-progress ESPN MBB event (2026-11-02, Queens v Winthrop) ---- */
try {
  const { parseMbbStatus, nameForms, pairKey, pairIdsKey, espnHomeIsAOf } = mod;
  const ev = JSON.parse(await readFile("scripts/fixtures/espn_mbb_in_progress_event.json", "utf8"));
  console.log("captured in-progress event " + ev.id);
  const live = parseMbbStatus(ev);
  eq("state in", live.state, "in"); eq("period 1", live.period, 1);
  eq("clock is seconds left in the half", live.clockSec > 0 && live.clockSec <= 1200, true);
  eq("not halftime", live.halftime, false);
  const comp = ev.competitions[0].competitors;
  const home = comp.find((c) => c.homeAway === "home").team, away = comp.find((c) => c.homeAway === "away").team;
  const homeNames = nameForms(home), awayNames = nameForms(away);
  // our day-index row: teamA "Queens University", teamB "Winthrop", ids 2511 / 2737
  const byName = new Set(homeNames.flatMap((h) => awayNames.map((a) => pairKey(a, h))));
  eq("name join hits", byName.has(pairKey("Queens University", "Winthrop")), true);
  eq("id join key", pairIdsKey(away.id, home.id), pairIdsKey(2511, 2737));
  eq("id join, ids as numbers vs strings", pairIdsKey(2737, "2511"), pairIdsKey(away.id, home.id));
  eq("no ids -> no id key", pairIdsKey(undefined, 2737), "");
  // drift: our name matches no ESPN form, the id join still hits and orients
  eq("name join MISSES on a drifted name", byName.has(pairKey("Queens (NC)", "Winthrop")), false);
  const lv = { homeId: String(home.id), homeNames, homeTeam: home.shortDisplayName };
  eq("orientation by id: A=2511 is ESPN home", espnHomeIsAOf(lv, "Queens (NC)", 2511), true);
  eq("orientation by id (neutral swap): A=2737 is ESPN away", espnHomeIsAOf(lv, "Winthrop", 2737), false);
  eq("orientation falls back to names without ids", espnHomeIsAOf(lv, "Queens University", null), true);
} catch (e) { bad(String(e.stack || e)); }


/* ---- the basketball drawer: ESPN summary parse (captured live + final events) and live odds ---- */
try {
  const { parseMbbSummary, liveOddsCbb, parseLiveGrid } = mod;
  const live = parseMbbSummary(JSON.parse(await readFile("scripts/fixtures/espn_mbb_summary_in_progress.json", "utf8")));
  console.log("drawer: captured in-progress summary (Queens v Winthrop)");
  eq("state in", live.state, "in"); eq("period 1", live.period, 1);
  eq("home is Queens 2511, score 31", `${live.home.id}/${live.home.score}`, "2511/31");
  eq("away is Winthrop 2737, score 21", `${live.away.id}/${live.away.score}`, "2737/21");
  eq("first-half linescore so far", live.home.linescores.join(","), "31");
  eq("team fouls present", live.stats["2511"].fouls !== undefined && live.stats["2737"].fouls !== undefined, true);
  eq("FG line", live.stats["2511"].fg, "13-20");
  const box = live.box.find((b) => b.teamId === "2511");
  eq("box players parsed", box.players.length > 5, true);
  eq("box points add to the score (no team row double count)", box.players.reduce((s, p) => s + (p.pts ?? 0), 0), 31);
  eq("ESPN win prob series", live.winProb.length > 2 && live.winProb.every((x) => x >= 0 && x <= 1), true);
  eq("recent plays carry period+clock", live.plays.every((p) => p.period === 1 && typeof p.clock === "string"), true);

  const fin = parseMbbSummary(JSON.parse(await readFile("scripts/fixtures/espn_mbb_summary_final.json", "utf8")));
  console.log("drawer: captured final summary (Grambling v NIU)");
  eq("state post", fin.state, "post");
  eq("final score home/away", `${fin.home.score}-${fin.away.score}`, "89-87");
  eq("final linescore home", fin.home.linescores.join(","), "43,46");
  eq("final linescore sums to the score", fin.away.linescores.reduce((a, b) => a + b, 0), 87);
  eq("final box points add to the score", fin.box.find((b) => b.teamId === fin.home.id).players.reduce((s, p) => s + (p.pts ?? 0), 0), 89);

  // live odds on the fixture grid: Queens (A) 31, Winthrop (B) 21, 7:55 left in the 1st = 725 s elapsed
  const g = parseLiveGrid(fixtureRaw());
  const r = liveOddsCbb(g, { scoreA: 31, scoreB: 21, period: 1, clockSec: 475, spreadLineA: -3.5, totalLine: 168.5 });
  eq("odds priced", r.kind, "ok");
  eq("projected margin = +10 (remaining margin mean 0)", r.odds.projMargin, 10, 0.02);
  // pos 5.5417 between bins 5,6: c = 109, 102 (total so far 52 -> total bin 4, +4) -> 105.208
  eq("projected total", r.odds.projTotal, 52 + 105.2083, 0.02);
  eq("P(A wins) = 1 (leads by 10, remaining margin within +-2)", r.odds.pWinA, 1);
  eq("P(A covers -3.5) = 1", r.odds.pCoverA, 1);
  eq("P(over 168.5) = 0 (max remaining total 113)", r.odds.pOver, 0, 1e-9);
  eq("total diff vs line", r.odds.totalDiff, 52 + 105.2083 - 168.5, 0.02);
  eq("OT with a lead -> ot placeholder kind", liveOddsCbb(g, { scoreA: 70, scoreB: 66, period: 3, clockSec: 200 }).kind, "ot");
  eq("no score -> no-state", liveOddsCbb(g, { period: 1, clockSec: 475 }).kind, "no-state");
} catch (e) { bad(String(e.stack || e)); }


/* ---- the CBB home band: which day, which games, live/final from the id-first join ---- */
try {
  const { pickCbbDay, selectBandRows, findTickLive, indexTickLive, tickLiveOfEvent, parseMbbStatus } = mod;
  console.log("band: day selection");
  const days = [{ id: "2026-11-02", date: "2026-11-02" }, { id: "2026-11-05", date: "2026-11-05" }, { id: "2026-11-09", date: "2026-11-09" }];
  eq("today listed -> today", pickCbbDay(days, "2026-11-05").id, "2026-11-05");
  eq("today has no games -> nearest day, ties to the future (11-03 is 1 day from 11-02 and 2 from 11-05)", pickCbbDay(days, "2026-11-03").id, "2026-11-02");
  eq("equidistant -> the future day", pickCbbDay([{ id: "a", date: "2026-11-02" }, { id: "b", date: "2026-11-04" }], "2026-11-03").id, "b");
  eq("preseason viewer -> opening night", pickCbbDay(days, "2026-10-20").id, "2026-11-02");
  eq("season over -> last day", pickCbbDay(days, "2027-04-20").id, "2026-11-09");
  eq("no days -> null", pickCbbDay([], "2026-11-02"), null);

  console.log("band: game selection");
  const at = (h) => `2026-11-02T${String(h).padStart(2, "0")}:00:00Z`;
  const rows = [8, 11, 14, 16, 19, 22].map((h) => ({ slug: `g${h}`, time_utc: at(h) }));
  const ms = (h, m = 0) => Date.parse(at(h)) + m * 60000;
  eq("mid-day: games older than 4 h after tip drop, the rest lead", selectBandRows(rows, ms(15), 3).map((r) => r.slug).join(), "g14,g16,g19");
  eq("games are in kickoff order even if the index is not", selectBandRows([...rows].reverse(), ms(7), 2).map((r) => r.slug).join(), "g8,g11");
  eq("a day with finals only -> the last N, as football", selectBandRows(rows, ms(23) + 6 * 3600000, 2).map((r) => r.slug).join(), "g19,g22");
  eq("the live feed retires an early final and keeps a long game in", selectBandRows(rows, ms(14, 30), 3,
    (r) => (r.slug === "g8" ? false : r.slug === "g11" ? true : undefined)).map((r) => r.slug).join(), "g8,g14,g16");
  eq("empty day -> empty band", selectBandRows([], ms(12), 5).length, 0);

  console.log("band: live join (captured in-progress event)");
  const ev = JSON.parse(await readFile("scripts/fixtures/espn_mbb_in_progress_event.json", "utf8"));
  const idx = indexTickLive([tickLiveOfEvent(ev, parseMbbStatus(ev))]);
  const row = { teamA: "Queens University", teamB: "Winthrop", A_espn_id: "2511", B_espn_id: "2737" };
  const hit = findTickLive(idx, row);
  eq("joined by ids", hit?.live.state, "in");
  eq("status text is ESPN's short detail", /1st/.test(hit.live.text), true);
  eq("scores oriented to A (sim home = Queens)", `${hit.scoreA}-${hit.scoreB}`, "22-14");
  const drift = findTickLive(idx, { ...row, teamA: "Queens (NC)" });
  eq("id join survives a drifted name", drift?.live.state, "in");
  eq("name fallback when the row has no ids", findTickLive(idx, { teamA: "Queens University", teamB: "Winthrop" })?.live.state, "in");
  eq("neutral swap: A is ESPN away -> scores flip", `${findTickLive(idx, { teamA: "Winthrop", teamB: "Queens University", A_espn_id: "2737", B_espn_id: "2511" }).scoreA}`, "14");
  eq("no match -> undefined", findTickLive(idx, { teamA: "X", teamB: "Y", A_espn_id: "1", B_espn_id: "2" }), undefined);
  const fin = JSON.parse(JSON.stringify(ev)); fin.status.type = { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" };
  fin.competitions[0].status = { ...fin.competitions[0].status, type: fin.status.type };
  eq("a final event reads as final", findTickLive(indexTickLive([tickLiveOfEvent(fin, parseMbbStatus(fin))]), row).live.state, "final");
} catch (e) { bad(String(e.stack || e)); }


await cleanup();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
