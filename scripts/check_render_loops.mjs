#!/usr/bin/env node
/**
 * Render-loop guard for the scoreboard's slate-edge scan.
 *
 *   node scripts/check_render_loops.mjs
 *
 * WHEN TO RUN: before committing any change to the effects/memos in
 * src/pages/Scoreboard.tsx or src/lib/useSlateEdges.ts. No dependencies, no
 * build step, no test runner — plain node.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * Clicking "Top Edges" (or selecting the Edge sort) froze the browser and
 * killed the tab. The cause was a closed cycle across two memo hops:
 *
 *     cards      = useMemo(sortCards(..., slateEdges), [..., slateEdges])
 *     edgeInputs = useMemo(cards.map(...),             [cards, ...])
 *     useEffect(() => ensureSlateEdges(edgeInputs).then(setSlateEdges),
 *               [edgeInputs, ...])
 *
 * setSlateEdges produced a new Map -> `cards` recomputed to a new array ->
 * `edgeInputs` recomputed to a new array -> the effect's identity-compared
 * dependency "changed" -> the scan re-ran -> setSlateEdges again. Measured at
 * 399 scans per game before the render cap tripped.
 *
 * It is INDIRECT (effect -> state -> memo -> memo -> dep), which is why a
 * plain "does this effect depend on state it sets?" review does not catch it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CHECK DOES
 * ---------------------------------------------------------------------------
 * 1. BEHAVIOURAL — runs both dependency graphs on a miniature React whose hook
 *    dependency comparison is faithful (Object.is per element, which is the
 *    entire mechanism of the bug). The broken graph is kept as a fixture and
 *    MUST be detected as looping; that is what proves the check has teeth.
 * 2. STATIC — asserts the shipped source still obeys the two rules that make
 *    the loop impossible:
 *      a. the scan effect depends on exactly one primitive (`signature`)
 *      b. `edgeInputs` is derived from the UNSORTED card list, never `cards`
 *
 * A behavioural test alone would pass forever even if someone rewired the real
 * page; the static half is what actually guards the shipped files.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));

/* ==========================================================================
 * 1. A miniature React: useState / useRef / useMemo / useEffect.
 *
 * Not a React replacement. It reproduces one thing exactly — dependency lists
 * are compared with Object.is per element, so a recreated array or Map always
 * counts as changed. Renders are pumped until quiescent or a cap trips, which
 * is what lets us ask "does this graph settle?".
 * ======================================================================== */
function createHarness(componentFn, { maxRenders = 400 } = {}) {
  let hooks = [];
  let cursor = 0;
  let renders = 0;
  let scheduled = false;
  let stopped = false;
  let overflow = null;
  const effects = [];
  let lastResult;

  const sameDeps = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  };

  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!stopped) render(); });
  };

  const api = {
    useState(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === "function" ? initial() : initial };
      const h = hooks[i];
      return [h.value, (next) => {
        const v = typeof next === "function" ? next(h.value) : next;
        if (Object.is(v, h.value)) return;   // React bails on identical state
        h.value = v;
        schedule();
      }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: { current: initial } };
      return hooks[i].value;
    },
    useMemo(fn, deps) {
      const i = cursor++;
      const prev = hooks[i];
      if (prev && prev.kind === "memo" && sameDeps(prev.deps, deps)) return prev.value;
      const value = fn();
      hooks[i] = { kind: "memo", deps, value };
      return value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const prev = hooks[i];
      if (prev && prev.kind === "effect" && sameDeps(prev.deps, deps)) { hooks[i] = prev; return; }
      const rec = { kind: "effect", deps, cleanup: prev && prev.cleanup };
      hooks[i] = rec;
      effects.push(rec, fn);
    },
  };

  function render() {
    if (stopped) return;
    if (++renders > maxRenders) {
      // Record rather than throw: the overflow happens in a microtask, so a
      // throw would escape the caller and kill the process — which is, fittingly,
      // exactly what the real bug does to the tab.
      stopped = true;
      overflow = `exceeded ${maxRenders} renders`;
      return;
    }
    cursor = 0;
    effects.length = 0;
    lastResult = componentFn(api);
    for (let i = 0; i < effects.length; i += 2) {
      const rec = effects[i];
      if (typeof rec.cleanup === "function") rec.cleanup();
      const c = effects[i + 1]();
      rec.cleanup = typeof c === "function" ? c : undefined;
    }
  }

  return {
    mount() { render(); return lastResult; },
    get renders() { return renders; },
    get error() { return overflow; },
    get result() { return lastResult; },
    stop() { stopped = true; },
    async settle(ticks = 40) {
      for (let i = 0; i < ticks && !stopped; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/* ==========================================================================
 * 2. Behavioural fixtures
 * ======================================================================== */
const SLUGS = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"];
const CARDS = SLUGS.map((s) => ({ key: s, teamA: `${s}H`, teamB: `${s}A`, jsonRow: {} }));

let scanCalls = new Map();
const resetScans = () => { scanCalls = new Map(); };

/** Stands in for ensureSlateEdges: same async shape, same new-Map-per-call result. */
async function scanStub(inputs) {
  const out = new Map();
  await Promise.all(inputs.map(async (g) => {
    scanCalls.set(g.slug, (scanCalls.get(g.slug) ?? 0) + 1);
    await Promise.resolve();
    out.set(g.slug, { slug: g.slug, bestSigned: 0.1 });
  }));
  return out;
}

const inputsFor = (cards) => cards.map((c) => ({ slug: c.key, teamA: c.teamA, teamB: c.teamB }));
const sortCards = (cards, _sortBy, edges) =>
  [...cards].sort((a, b) =>
    (edges?.get(b.key)?.bestSigned ?? -Infinity) - (edges?.get(a.key)?.bestSigned ?? -Infinity));

/** FIXTURE: the pre-fix graph. Must be caught as looping. */
function brokenGraph({ useState, useMemo, useEffect }) {
  const [slateEdges, setSlateEdges] = useState(null);
  const enabled = true;
  const kalshi = useMemo(() => new Map(), []);
  const cards = useMemo(() => sortCards(CARDS, "kickoff", slateEdges), [slateEdges]);
  const edgeInputs = useMemo(() => inputsFor(cards), [cards]);
  useEffect(() => {
    if (!enabled || !edgeInputs.length) return;
    let alive = true;
    scanStub(edgeInputs).then((m) => { if (alive) setSlateEdges(m); });
    return () => { alive = false; };
  }, [enabled, edgeInputs, kalshi]);
  return { slateEdges };
}

/** FIXTURE: the shipped graph — mirrors src/lib/useSlateEdges.ts. Must settle. */
function fixedGraph({ useState, useMemo, useEffect, useRef }) {
  const [state, setState] = useState(null);
  const enabled = true;
  const kalshi = useMemo(() => new Map(), []);
  const baseCards = useMemo(() => CARDS, []);                      // UNSORTED
  const inputs = useMemo(() => inputsFor(baseCards), [baseCards]);

  const signature = useMemo(() => {
    if (!enabled || !inputs.length) return "";
    return ["2026", "week00", "med", "stamp|8", inputs.map((i) => i.slug).join(",")].join("|");
  }, [enabled, inputs]);

  const inputsRef = useRef(inputs); inputsRef.current = inputs;
  const kalshiRef = useRef(kalshi); kalshiRef.current = kalshi;
  const startedRef = useRef("");

  useEffect(() => {
    if (!signature || startedRef.current === signature) return;
    startedRef.current = signature;
    let alive = true;
    scanStub(inputsRef.current).then((map) => { if (alive) setState({ sig: signature, map }); });
    return () => { alive = false; };
  }, [signature]);

  const slateEdges = state && state.sig === signature ? state.map : null;
  const cards = useMemo(() => sortCards(baseCards, "kickoff", slateEdges), [baseCards, slateEdges]);
  return { slateEdges, cards };
}

const RENDER_BOUND = 50;

async function runGraph(fn) {
  resetScans();
  const h = createHarness(fn);
  h.mount();
  await h.settle();
  h.stop();
  const per = [...scanCalls.values()];
  return {
    renders: h.renders,
    overflow: h.error,
    maxPerGame: per.length ? Math.max(...per) : 0,
    totalScans: per.reduce((a, b) => a + b, 0),
  };
}

/* ==========================================================================
 * 3. Static invariants on the shipped source
 * ======================================================================== */
const depTokens = (s) => s.split(",").map((t) => t.trim()).filter(Boolean);

function checkHookSource() {
  const src = read("src/lib/useSlateEdges.ts");

  const effects = [...src.matchAll(/useEffect\(\(\) => \{[\s\S]*?\r?\n[ \t]*\}, \[([^\]]*)\]\);/g)];
  check(effects.length === 1, `useSlateEdges has exactly one effect (found ${effects.length})`);

  if (effects.length) {
    const deps = depTokens(effects[0][1]);
    check(
      deps.length === 1 && deps[0] === "signature",
      `scan effect depends on exactly [signature] (found [${deps.join(", ")}])`
    );
    const body = effects[0][0];
    check(body.includes("inputsRef.current"), "effect reads inputs via a ref, not a dependency");
    check(body.includes("startedRef.current"), "one-shot guard (startedRef) still present");
  }

  const sig = src.match(/const signature = useMemo\(\(\) => \{[\s\S]*?\r?\n[ \t]*\}, \[([^\]]*)\]\);/);
  check(Boolean(sig), "signature is computed in a useMemo");
  if (sig) {
    check(
      /\.join\("\|"\)/.test(sig[0]),
      "signature memo returns a joined STRING (primitive), not an object"
    );
  }
}

function checkPageSource() {
  const src = read("src/pages/Scoreboard.tsx");

  const ei = src.match(/const edgeInputs[\s\S]*?\r?\n[ \t]*\[([^\]]*)\][ \t]*\r?\n[ \t]*\);/);
  check(Boolean(ei), "Scoreboard declares edgeInputs as a useMemo");
  if (ei) {
    const deps = depTokens(ei[1]);
    check(
      !deps.includes("cards"),
      `edgeInputs is NOT derived from the sorted \`cards\` list (deps: [${deps.join(", ")}])`
    );
    check(
      deps.includes("baseCards"),
      "edgeInputs derives from the unsorted baseCards list"
    );
  }

  // No effect on the page may take the scan's inputs or output as a dependency.
  // slateScan is the scan's raw output; slateEdges is derived from it. Neither
  // may ever become an effect dependency, or the Phase-7 cycle returns.
  const banned = ["edgeInputs", "slateEdges", "slateScan"];
  const offenders = [];
  for (const m of src.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[([^\]]*)\]\);/g)) {
    const deps = depTokens(m[1]);
    for (const b of banned) if (deps.includes(b)) offenders.push(`${b} in [${deps.join(", ")}]`);
  }
  check(
    offenders.length === 0,
    offenders.length
      ? `no page effect depends on ${banned.join("/")} — FOUND: ${offenders.join("; ")}`
      : `no page effect depends on ${banned.join("/")}`
  );
}

/* ========================================================================== */
console.log("Render-loop guard: scoreboard slate-edge scan\n");

console.log("1. Behavioural — can this check still detect the loop?");
const broken = await runGraph(brokenGraph);
check(
  Boolean(broken.overflow) || broken.renders >= RENDER_BOUND || broken.maxPerGame > 1,
  `pre-fix fixture is detected as looping ` +
  `(${broken.renders} renders${broken.overflow ? ", " + broken.overflow : ""}, ` +
  `${broken.totalScans} scans, ${broken.maxPerGame}/game)`
);

console.log("\n2. Behavioural — does the shipped graph settle?");
const fixed = await runGraph(fixedGraph);
check(!fixed.overflow, "shipped fixture does not overflow the render cap");
check(fixed.renders < RENDER_BOUND, `shipped fixture settles in < ${RENDER_BOUND} renders (${fixed.renders})`);
check(fixed.maxPerGame <= 1, `each game is scanned at most once (max ${fixed.maxPerGame}/game, ${fixed.totalScans} total)`);

console.log("\n3. Static — src/lib/useSlateEdges.ts");
checkHookSource();

console.log("\n4. Static — src/pages/Scoreboard.tsx");
checkPageSource();

console.log(
  failures === 0
    ? "\nAll render-loop checks passed."
    : `\n${failures} render-loop check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
