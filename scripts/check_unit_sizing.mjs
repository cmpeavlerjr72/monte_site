#!/usr/bin/env node
/**
 * UNIT SIZING MODE guard.
 *
 *   node scripts/check_unit_sizing.mjs
 *
 * WHEN TO RUN: before committing any change to `sizeContracts` /
 * `sizeSuggestion` / `selectLadders` in src/lib/suggestedBets.ts, to the
 * sizing preferences in src/lib/ownerPrefs.ts, or to the declared per-order
 * cap in src/lib/placeOrders.ts. No network, no test runner.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * This is the arithmetic that decides how much real money leaves the account,
 * and it now has three answers instead of one. Three failure modes are both
 * expensive and invisible on a screen:
 *
 * 1. THE DEFAULT MOVING. `risk` is what every row sized by before 2026-09-08
 *    and the owner's whole settled record is measured at that size. Section 1
 *    re-implements the OLD loop character for character and asserts the new
 *    kernel returns the identical count at every price.
 *
 * 2. THE FEE DROPPING OUT OF `to-win`. A unit of profit is
 *    n·(1−P) − fee, not n·(1−P). Forgetting the fee under-sizes every to-win
 *    row by a couple of percent, silently, forever. Section 2 solves each
 *    price by BRUTE FORCE against the same rounded per-order fee the exchange
 *    charges and asserts the closed form agrees.
 *
 * 3. THE CAP NOT BITING. At 95¢ a full unit of profit costs 20 units of risk.
 *    If `maxRiskMultiple` fails to bind, one mis-tap stakes twenty units.
 *    Section 3 asserts the outlay ceiling holds at every price and that the
 *    `capped` flag is set exactly when the row falls short of a full unit.
 *
 * THE PRICE GRID is the owner's: 0.05, 0.30, 0.50, 0.51, 0.70, 0.86, 0.95 —
 * a longshot, a dog, the pickem, the FIRST price on the favourite side (the
 * `book` mode's switch is > 0.50, so 0.50 and 0.51 must disagree), the
 * ordinary favourite, the heavy favourite the guard was written for, and the
 * near-certainty.
 */
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
 * Load the SHIPPED module, bundled with esbuild — never a re-typed
 * copy of the arithmetic under test.
 * ------------------------------------------------------------------ */
const tmp = await mkdtemp(path.join(tmpdir(), "cfb-unitsize-"));
const bundle = path.join(tmp, "bundle.mjs");
await build({
  stdin: {
    contents: `export * from "./src/lib/suggestedBets";`,
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true, format: "esm", platform: "node",
  outfile: bundle, logLevel: "silent",
});
const lib = await import(pathToFileURL(bundle).href);
await rm(tmp, { recursive: true, force: true });
const {
  sizeContracts, appliedMode, clampRiskMultiple, orderFee,
  MAX_RISK_MULTIPLE_DEFAULT, MAX_RISK_MULTIPLE_MAX,
} = lib;

/** The owner's grid. */
const PRICES = [0.05, 0.30, 0.50, 0.51, 0.70, 0.86, 0.95];
const UNIT = 30;
const MULT = MAX_RISK_MULTIPLE_DEFAULT;      // 3x, the shipped guard
/** Every case below is a TAKE on a game line: the fee is real and quadratic,
 *  which is the expensive half of the arithmetic. */
const FP = { fee_type: "quadratic_with_maker_fees", fee_multiplier: 1 };
const feeOf = (p, n) => orderFee(p, n, false, FP);
const outlayOf = (p, n) => p * n + feeOf(p, n);
const netWinOf = (p, n) => n * (1 - p) - feeOf(p, n);
const size = (p, mode, unit = UNIT, mult = MULT) => sizeContracts({
  price: p, maker: false, fp: FP, unit,
  sizing: { mode, maxRiskMultiple: mult }, ceiling: unit * mult,
});

/* ------------------------------------------------------------------ *
 * 1. `risk` IS THE OLD ARITHMETIC, character for character.
 *    The pre-2026-09-08 loop, re-typed here from the shipped code it
 *    replaced. Any divergence re-sizes the owner's whole default path.
 * ------------------------------------------------------------------ */
{
  const legacy = (price, share) => {
    let count = Math.max(1, Math.floor(share / Math.max(price, 1e-9)));
    let fee = orderFee(price, count, false, FP);
    while (count > 1 && price * count + fee > share + 1e-9) {
      count -= 1;
      fee = orderFee(price, count, false, FP);
    }
    return count;
  };
  const bad = [];
  // Every price on the grid, and every unit the slider allows, so a rounding
  // difference cannot hide in an untested budget.
  for (const p of PRICES) {
    for (const unit of [1, 2, 5, 15, 30, 50, 100, 250, 500]) {
      const got = size(p, "risk", unit).count;
      const want = legacy(p, unit);
      if (got !== want) bad.push(`P=${p} unit=$${unit}: ${got} vs ${want}`);
    }
  }
  if (bad.length) fail("risk mode is byte-identical to the old sizing", bad.join("; "));
  else ok("risk mode is byte-identical to the old sizing (63 price x unit cases)");

  // ...and it never spends past the unit, which is the WHOLE meaning of the
  // default mode.
  const over = PRICES.filter((p) => size(p, "risk").outlay > UNIT + 1e-9);
  eq("risk mode never outlays more than the unit", over, []);
}

/* ------------------------------------------------------------------ *
 * 2. `to-win` NETS A UNIT — solved by brute force, fee included.
 *    The reference below is deliberately dumb: walk n upward against the
 *    ROUNDED per-order fee and take the first count that clears the unit,
 *    bounded by the ceiling. If the closed form and this disagree, the
 *    closed form is wrong.
 * ------------------------------------------------------------------ */
{
  const reference = (p, unit, mult) => {
    const ceiling = unit * mult;
    let best = 1;
    for (let n = 1; n <= 40000; n++) {
      if (outlayOf(p, n) > ceiling + 1e-9) break;
      best = n;
      if (netWinOf(p, n) >= unit - 1e-9) return n;   // the first full unit
    }
    return best;                                      // ceiling bound first
  };
  const bad = [];
  for (const p of PRICES) {
    const got = size(p, "to-win").count;
    const want = reference(p, UNIT, MULT);
    if (got !== want) bad.push(`P=${p}: ${got} vs ${want}`);
  }
  if (bad.length) fail("to-win matches a brute-force solve with the real fee", bad.join("; "));
  else ok("to-win matches a brute-force solve with the real fee (7 prices)");

  // Where the ceiling is NOT binding, the net win must actually reach a unit —
  // and must not overshoot by more than one contract's worth, which is what
  // "ceil to a whole contract" means.
  const bad2 = [];
  for (const p of PRICES) {
    const s = size(p, "to-win");
    if (s.capped) continue;
    if (s.netWin < UNIT - 1e-9) bad2.push(`P=${p}: nets ${s.netWin} < $${UNIT}`);
    if (netWinOf(p, s.count - 1) >= UNIT - 1e-9) {
      bad2.push(`P=${p}: ${s.count - 1} contracts already net a unit — not minimal`);
    }
  }
  if (bad2.length) fail("an uncapped to-win row is the SMALLEST count that nets a unit", bad2.join("; "));
  else ok("an uncapped to-win row is the smallest count that nets a unit");

  // Whole contracts, always. Kalshi has no fractional contract and the server
  // rejects a non-integer count_fp outright.
  const frac = [];
  for (const p of PRICES) {
    for (const m of ["risk", "to-win", "book"]) {
      const n = size(p, m).count;
      if (!Number.isInteger(n) || n < 1) frac.push(`P=${p} ${m}: ${n}`);
    }
  }
  eq("every mode returns a whole contract count >= 1", frac, []);
}

/* ------------------------------------------------------------------ *
 * 3. THE CAP. No mode may outlay more than maxRiskMultiple units, and
 *    `capped` must be set exactly when the row falls short of a unit of
 *    profit — a silently shrunk bet is the failure this flag prevents.
 * ------------------------------------------------------------------ */
{
  const over = [];
  for (const p of PRICES) {
    for (const m of ["risk", "to-win", "book"]) {
      const s = size(p, m);
      if (s.outlay > UNIT * MULT + 1e-9) over.push(`P=${p} ${m}: $${s.outlay}`);
    }
  }
  eq(`no mode outlays more than ${MULT}x the unit`, over, []);

  const wrong = [];
  for (const p of PRICES) {
    for (const m of ["to-win", "book"]) {
      const s = size(p, m);
      const short = s.applied === "to-win" && s.netWin < UNIT - 0.005;
      if (s.capped !== short) wrong.push(`P=${p} ${m}: capped=${s.capped} short=${short}`);
    }
  }
  eq("`capped` is set exactly when a to-win row falls short of a unit", wrong, []);

  // The guard is what makes 86c and 95c affordable at all. Both must cap at
  // 3x; every price at or under 70c must NOT (a unit of profit is reachable).
  eq("the guard bites on the heavy favourites and nowhere else",
    PRICES.map((p) => size(p, "to-win").capped),
    [false, false, false, false, false, true, true]);

  // A cap of 1x collapses to-win onto the risk budget — the degenerate case a
  // hand-edited localStorage could produce.
  const collapsed = PRICES.filter((p) => size(p, "to-win", UNIT, 1).outlay > UNIT + 1e-9);
  eq("maxRiskMultiple=1 holds to-win inside one unit", collapsed, []);

  eq("clampRiskMultiple bounds the guard",
    [clampRiskMultiple(0), clampRiskMultiple(99), clampRiskMultiple("x"),
     clampRiskMultiple(2.6)],
    [1, MAX_RISK_MULTIPLE_MAX, MAX_RISK_MULTIPLE_DEFAULT, 3]);
}

/* ------------------------------------------------------------------ *
 * 4. `book` IS A CHOICE, NOT A THIRD FORMULA — and the switch is at
 *    exactly 50c, where American odds change sign. 0.50 is a dog
 *    (positive odds, risk a unit); 0.51 is a favourite (negative odds,
 *    win a unit). Getting that edge backwards mis-sizes the pickem
 *    rungs, which are the thickest part of the board.
 * ------------------------------------------------------------------ */
{
  eq("book resolves risk at and under 50c, to-win above it",
    PRICES.map((p) => appliedMode("book", p)),
    ["risk", "risk", "risk", "to-win", "to-win", "to-win", "to-win"]);

  const bad = [];
  for (const p of PRICES) {
    const b = size(p, "book");
    const twin = size(p, p > 0.5 ? "to-win" : "risk");
    if (b.count !== twin.count) bad.push(`P=${p}: book ${b.count} vs ${twin.count}`);
  }
  eq("a book row is byte-identical to the mode it resolves to", bad, []);

  // The owner's own framing: a 60c/40c pair is -150/+150 and the two offset.
  // BANDED, not exact — the fee (7%·P·(1−P) per contract, rounded up per
  // order) and whole contracts both pull the ratio off the textbook 1.5, and
  // pinning an exact figure here would just be re-typing the implementation.
  // What must hold is the SHAPE: the favourite risks about 1.5 units to net
  // one, the dog risks about one to net about 1.4.
  const fav = size(0.6, "book"), dog = size(0.4, "book");
  const band = (v, lo, hi) => v >= lo && v <= hi;
  const shape = [
    band(fav.risk / UNIT, 1.4, 1.7),      // favourite: risks ~1.5 units...
    band(fav.netWin / UNIT, 1.0, 1.1),    // ...to net one
    band(dog.risk / UNIT, 0.9, 1.0),      // dog: risks a unit...
    band(dog.netWin / UNIT, 1.3, 1.5),    // ...to net ~1.4 (the fee, again)
  ];
  eq("a 60c/40c pair offsets the way -150/+150 does (fee-adjusted)",
    shape, [true, true, true, true]);
}

/* ------------------------------------------------------------------ *
 * 5. THE TABLE. Printed, not just asserted, so a reviewer can read the
 *    money the modes actually produce.
 * ------------------------------------------------------------------ */
{
  console.log(`\n  $${UNIT} unit · taker fee 7%·P·(1−P) · cap ${MULT}x`);
  console.log("  price  mode     ct    risk     fee   netwin  capped");
  for (const p of PRICES) {
    for (const m of ["risk", "to-win", "book"]) {
      const s = size(p, m);
      console.log(
        `  ${p.toFixed(2)}   ${m.padEnd(7)} ${String(s.count).padStart(4)} `
        + `${s.risk.toFixed(2).padStart(8)} ${s.fee.toFixed(2).padStart(6)} `
        + `${s.netWin.toFixed(2).padStart(8)}  ${s.capped ? "yes" : ""}`);
    }
  }
  console.log("");
}

/* ------------------------------------------------------------------ *
 * 6. STATIC WIRING — the rails and the single-copy rule.
 *
 *    a) ONE sizing implementation. `sizeContracts` is it; a second
 *       floor(unit / price) anywhere is the drift that split the browse
 *       wheel from the picked rows in 2026-08-30.
 *    b) The DECLARED PER-ORDER CAP. The server's rail is
 *       clamp(unit_size, 1..500) per order and 2x per slip. The client
 *       declares unit x the mode's risk multiple through ONE function
 *       (`declaredOrderCap`), used by BOTH the request and the slip's
 *       pre-press warning, so the warning can never name a different
 *       number from the one the server enforces.
 * ------------------------------------------------------------------ */
{
  const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

  // The Friend Feed's Join button moved out of the console into its own
  // component with the 2026-09-08 dashboard restructure; the rule it is
  // guarded for did not move. ONE kernel sizes it, wherever it lives.
  const mb = read("src", "components", "FriendBooks.tsx");
  if (/Math\.floor\(unit\s*\/\s*price\)/.test(mb)) {
    fail("the Friend Feed Join sizes through sizeContracts",
      "FriendBooks still has its own floor(unit / price)");
  } else if (!/sizeContracts\(/.test(mb)) {
    fail("the Friend Feed Join sizes through sizeContracts",
      "FriendBooks does not call sizeContracts at all");
  } else ok("the Friend Feed Join sizes through sizeContracts");

  const sb = read("src", "lib", "suggestedBets.ts");
  const fn = sb.slice(sb.indexOf("function sizeSuggestion"),
                      sb.indexOf("export function buildSuggestions"));
  if (!/sizeContracts\(/.test(fn)) {
    fail("sizeSuggestion sizes through sizeContracts",
      "the row sizer no longer calls the kernel");
  } else ok("sizeSuggestion sizes through sizeContracts");

  const po = read("src", "lib", "placeOrders.ts");
  if (!/unit_size: declaredOrderCap\(\)/.test(po)) {
    fail("the request declares the cap through declaredOrderCap",
      "placeOrders no longer sends unit_size: declaredOrderCap()");
  } else ok("the request declares the cap through declaredOrderCap");
  // The wire shape is frozen: the deployed server rejects any field it does
  // not know, and server/dist is only rebuilt deliberately.
  const fields = [...po.matchAll(/idempotency_key: idempotencyKey,([^}]*)\}/g)]
    .map((m) => m[1]);
  const strayField = fields.some((f) => /risk_multiple|sizing|unit_mode/.test(f));
  if (strayField) {
    fail("the order request sends no new fields",
      "a new key would be refused as unexpected_field by the deployed server");
  } else ok("the order request sends no new fields (unit_size only)");

  const sug = read("src", "components", "SuggestedBets.tsx");
  // ONE number: the slip derives the cap from its OWN unit + sizing props (the
  // pair its rows were sized by) and hands that same value to placeOrders. Two
  // independent reads of the stored prefs agree in the app but not on every
  // surface — /test-bets, whose mode is a URL param, warned "over the $30
  // per-order cap" under a row it had itself sized to $89.
  if (!/const CAP_ORDER = declaredOrderCap\(unit, sizing\);/.test(sug)) {
    fail("the slip's cap comes from its own unit + sizing",
      "ConfirmSlip no longer derives CAP_ORDER from declaredOrderCap(unit, sizing)");
  } else ok("the slip's cap comes from its own unit + sizing props");
  if (!/placeOrders\(token, idem, orders, CAP_ORDER\)/.test(sug)) {
    fail("the slip DECLARES the cap it warned about",
      "ConfirmSlip no longer passes CAP_ORDER to placeOrders");
  } else ok("the slip declares the cap it warned about (one number, not two reads)");

  const op = read("src", "lib", "ownerPrefs.ts");
  if (!/Math\.min\(UNIT_MAX,\s*Math\.max\(UNIT_MIN/.test(op)) {
    fail("the declared cap stays inside the unit bounds",
      "declaredOrderCap no longer clamps to UNIT_MIN..UNIT_MAX");
  } else ok("the declared cap stays inside the unit bounds (1..500)");
  if (!/mode === "risk" \? 1 :/.test(op)) {
    fail("risk mode declares exactly one unit",
      "readSizing no longer forces maxRiskMultiple=1 in risk mode");
  } else ok("risk mode declares exactly one unit (the rail is unchanged)");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall unit-sizing checks passed");
process.exit(failures ? 1 : 0);
