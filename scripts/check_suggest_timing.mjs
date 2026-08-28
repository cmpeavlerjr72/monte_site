#!/usr/bin/env node
/**
 * Suggested-bets TIME guard — the pregame gate and the maker/taker bands.
 *
 *   node scripts/check_suggest_timing.mjs
 *
 * WHEN TO RUN: before committing any change to `src/lib/suggestedBets.ts`
 * (`pregameVerdict`, `timingFor`, `priceOne`) or to the `suggestGames` memo in
 * src/pages/Scoreboard.tsx. No dependencies, no test runner, no network.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * Two rules on this card are functions of the WALL CLOCK, and a wall-clock rule
 * is the kind that looks right in review and is wrong in production, because
 * the thing it depends on is the one thing a screenshot cannot show.
 *
 * 1. PREGAME ONLY. Sim fairs are pregame distributions; an "edge" against a
 *    live book is a wrong number pointed at real money. The rule is
 *    (live state pre or unknown) AND (kick > now + 5 min), with the clock as a
 *    veto that a live `pre` cannot override — see the long note on
 *    `pregameVerdict` for why the delayed-kick case is decided that way.
 *
 *    The bug this half exists to prevent SHIPPED once: `Date.now()` was read
 *    inside a memo keyed on `baseCards`, so the clock only advanced when the
 *    ESPN live poll delivered. On a network that blocks espn.com — or simply
 *    after the poll stops, which it does once every event is final — `now`
 *    froze at page load and a kicked-off game never left the card. The static
 *    half below asserts the page still passes a TICKING clock in.
 *
 * 2. THE TIMING BANDS. The take bar relaxes into kickoff (6c > 24h, 4.5c
 *    3-24h, 3c under 3h) and REST is refused inside the last hour, because the
 *    pre-kickoff chain cancels every unfilled rest at kick-30. A row that can
 *    clear neither bar is dropped, with the reason in words.
 *
 * The behavioural half runs the SHIPPED module (node strips the types), so it
 * fails if the rules move. The static half reads the shipped page source,
 * because a fixture cannot see the page rewiring its own clock away.
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

// The app's .ts modules are written for a bundler: relative, extensionless.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});

const {
  pregameVerdict, timingFor, buildSuggestions,
  TAKE_THRESHOLD, TAKE_THRESHOLD_NEAR, TAKE_THRESHOLD_LATE,
  PREGAME_BUFFER_MS,
} = await import("../src/lib/suggestedBets.ts");

const MIN = 60_000;
const H = 60 * MIN;
const NOW = Date.UTC(2026, 7, 28, 18, 0, 0);   // a fixed instant; nothing reads the real clock

/* ==========================================================================
 * 1. THE PREGAME GATE
 * ======================================================================== */
console.log("\nPregame gate (pregameVerdict)");

const at = (g) => pregameVerdict(g, NOW);

check(at({ liveState: "pre", kickoffMs: NOW + 3 * H }).ok,
  "pre + kick 3h out  -> suggestible (both signals agree)");

// (a) the live feed says the game is under way or over — the clock is irrelevant.
check(!at({ liveState: "in", kickoffMs: NOW + 3 * H }).ok,
  "live 'in' + kick still 3h out -> REFUSED (an early start beats the schedule)");
check(!at({ liveState: "post", kickoffMs: NOW + 3 * H }).ok, "live 'post' -> REFUSED");
check(!at({ liveState: "final", kickoffMs: NOW + 3 * H }).ok, "live 'final' -> REFUSED");
check(!at({ started: true, kickoffMs: NOW + 3 * H }).ok,
  "feed roll-up 'started' (CSV final / in-progress) -> REFUSED");

// (b) THE ESPN GAP: past kick, no live join at all. This is the Lafayette /
//     Georgetown case — no ESPN entry exists for that game on the wk0 board.
check(!at({ kickoffMs: NOW - MIN }).ok,
  "past kick with NO live state (the ESPN gap) -> REFUSED on the clock alone");
check(at({ kickoffMs: NOW + 3 * H }).ok,
  "future kick with no live state -> suggestible (the clock rules alone)");

// (c) THE DELAYED KICK: live state still 'pre' after the scheduled kick time.
//     The clock is a veto. See the reasoning note: a real delay and a lagging
//     feed are indistinguishable, and the costs are wildly asymmetric.
check(!at({ liveState: "pre", kickoffMs: NOW - 10 * MIN }).ok,
  "live 'pre' PAST kick time -> REFUSED (clock vetoes; 'pre' does not win)");

// The buffer itself.
check(!at({ liveState: "pre", kickoffMs: NOW + PREGAME_BUFFER_MS - MIN }).ok,
  "kick in 4 min -> REFUSED (inside the 5-minute buffer)");
check(at({ liveState: "pre", kickoffMs: NOW + PREGAME_BUFFER_MS + MIN }).ok,
  "kick in 6 min -> suggestible (outside the buffer)");
check(at({ kickoffMs: NOW + PREGAME_BUFFER_MS + MIN }).ok,
  "kick in 6 min, no live state -> suggestible");

// Neither signal: no evidence the game has not started.
const blind = at({});
check(!blind.ok && blind.reason === "no kickoff time and no live state",
  "no kickoff AND no live state -> REFUSED, with the reason the card counts");
check(at({ liveState: "pre" }).ok,
  "no kickoff but live 'pre' -> suggestible (positive evidence, and all we have)");

/* ==========================================================================
 * 2. THE BANDS — 30h / 6h / 2h / 45min, the user's own probe points
 * ======================================================================== */
console.log("\nTiming bands (timingFor)");

const band = (hours) => timingFor(NOW + hours * H, NOW);
const rows = [
  [30, "far", TAKE_THRESHOLD, true],
  [6, "near", TAKE_THRESHOLD_NEAR, true],
  [2, "soon", TAKE_THRESHOLD_LATE, true],
  [0.75, "imminent", TAKE_THRESHOLD_LATE, false],
];
for (const [hours, name, bar, restOk] of rows) {
  const t = band(hours);
  check(t.band === name && t.takeThreshold === bar && t.restOk === restOk,
    `${hours}h to kick -> ${name}: take ${(bar * 100).toFixed(1)}c, ` +
    `rest ${restOk ? "allowed" : "REFUSED"} (got ${t.band}, ` +
    `${(t.takeThreshold * 100).toFixed(1)}c, rest ${t.restOk})`);
}

// Boundaries are exclusive at the top of each band: exactly 24h is NEAR, not
// FAR. Stated so a future edit cannot silently flip which side an edge lands.
check(timingFor(NOW + 24 * H, NOW).band === "near", "exactly 24h -> near (edge exclusive)");
check(timingFor(NOW + 3 * H, NOW).band === "soon", "exactly 3h -> soon");
check(timingFor(NOW + 1 * H, NOW).band === "imminent", "exactly 1h -> imminent (no rest)");

// An unknown kickoff must never be the reason a bar gets EASIER.
const unknown = timingFor(undefined, NOW);
check(unknown.band === "far" && unknown.takeThreshold === TAKE_THRESHOLD &&
      unknown.restOk && unknown.msToKick === null,
  "unknown kickoff -> far band (strictest take bar), resting still allowed");

/* ==========================================================================
 * 3. THE BANDS, END TO END — same contract, four clocks, four verdicts
 *
 * Three probes, each sized to land BETWEEN two rungs of the ladder, because a
 * probe that clears every bar proves nothing about which bar was applied:
 *   A  5.25c take edge — REST at 30h (under 6c), TAKE from 24h in.
 *   B  3.50c take edge — REST at 30h AND 6h, TAKE only under 3h.
 *   C  no take edge at all — REST while resting is allowed, DROPPED inside 1h.
 * ======================================================================== */
console.log("\nBands end to end (buildSuggestions)");

const fee = { KXNCAAFTEAMTOTAL: { fee_type: "quadratic", fee_multiplier: 1 } };
const cand = (simP, ask, kickH) => ({
  ticker: `T${simP}-${kickH}`, slug: "g", ladder: `g|x|${simP}`,
  label: "probe", team: "T", statText: "points", strike: 10,
  series: "KXNCAAFTEAMTOTAL", simP, bid: ask - 0.02, ask,
  kickoffMs: NOW + kickH * H,
});
const modeOf = (simP, ask, kickH) => {
  const r = buildSuggestions([cand(simP, ask, kickH)], fee, new Set(), 30, NOW);
  return r.rows[0]?.mode ?? `DROPPED(${r.suppressed[0]?.reason ?? "?"})`;
};

// A: sim 0.56 vs a 0.49 ask -> 0.07 - 0.07*0.49*0.51 = 5.25c after taker fee.
for (const [h, want] of [[30, "REST"], [6, "TAKE"], [2, "TAKE"]]) {
  const got = modeOf(0.56, 0.49, h);
  check(got === want, `A (5.25c take edge) at ${h}h -> ${want} (got ${got})`);
}
// B: sim 0.5425 vs the same ask -> 3.50c. Only the under-3h bar lets it cross,
// which is the rung A cannot distinguish.
for (const [h, want] of [[30, "REST"], [6, "REST"], [2, "TAKE"]]) {
  const got = modeOf(0.5425, 0.49, h);
  check(got === want, `B (3.50c take edge) at ${h}h -> ${want} (got ${got})`);
}

// C: a row that clears the REST bar but no take bar at all: fine at 2h,
// DROPPED at 45min because it cannot survive to the kick-30 pull.
const thinAt2h = modeOf(0.50, 0.53, 2);
const thinAt45 = modeOf(0.50, 0.53, 0.75);
check(thinAt2h === "REST", `rest-only row at 2h -> REST (got ${thinAt2h})`);
check(thinAt45.startsWith("DROPPED"),
  `the same row at 45 min -> DROPPED, not rested (got ${thinAt45})`);
check(/no time to fill/.test(thinAt45),
  "…and the suppression says why, in words a reader can act on");

/* ==========================================================================
 * 4. STATIC — the page must keep feeding a MOVING clock
 * ======================================================================== */
console.log("\nStatic wiring (Scoreboard.tsx / SuggestedBets.tsx)");

const board = read("src/pages/Scoreboard.tsx");
const cardSrc = read("src/components/SuggestedBets.tsx");

check(/setInterval\(\(\) => setNowMs\(Date\.now\(\)\)/.test(board),
  "the page ticks nowMs on an interval (not once at mount)");
check(/nowMs=\{nowMs\}/.test(board),
  "…and passes it to SuggestedBets");
check(!/kickoffMs === "number" && c\.kickoffMs <= now/.test(board),
  "the `started` roll-up no longer folds a kick-time test in (the gate owns the clock)");
check(/liveState: c\.live\?\.state/.test(board),
  "…and forwards ESPN's RAW state, so 'no join' is distinguishable from 'pre'");
check(/pregameVerdict\(g, nowMs\)/.test(cardSrc),
  "the card gates every game through pregameVerdict against that clock");
check(/}, \[games, kalshiBySlug, feeParams, portal, docs, unit, nonce, nowMs\]\)/.test(cardSrc),
  "…and nowMs is a DEPENDENCY of the compute, so a kicked game drops off on its own");
check(/buildSuggestions\(candidates, feeParams, held, unit, nowMs\)/.test(cardSrc),
  "one clock drives both the gate and the bands (no second Date.now())");

console.log(failures ? `\nFAILED (${failures})` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
