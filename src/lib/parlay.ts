// Parlay fair-odds engine.
//
// Everything the site published before this was MARGINAL — PMFs, quantiles,
// percentile summaries. A parlay cannot be priced from marginals: two legs of
// the same game are correlated (UNC covering +7.5 and UNC going over its team
// total are not independent events), and multiplying their marginals prices a
// same-game parlay the way a book that ignores correlation would.
//
// seeds.json fixes that by publishing the raw per-seed columns, ALL ALIGNED BY
// INDEX: index i of A_pts, B_pts and every players["<name>|<stat>"] column is
// the same simulated game. So the joint probability of a set of same-game legs
// is just "count the seeds where every predicate holds" — correlation captured
// natively, no modelling.
//
// Cross-game, the sims are independent runs, so per-game joint fractions
// multiply. That assumption is stated in the UI.

import { dataUrl, type Season } from "./cfbData";
import type { JsonWeekRow } from "./cfbJson";

/* --------------------------------- data ---------------------------------- */

export type SeedsJson = {
  nsims: number;
  A_pts: number[];
  B_pts: number[];
  /** "<player>|<stat>" -> per-seed values. All-zero columns are omitted. */
  players: Record<string, number[]>;
  /** Players that appear in at least one column, for absent-vs-zero decisions. */
  playerNames: Set<string>;
};

/** Thrown when a week predates the seeds export, so callers can say so. */
export class SeedsNotPublished extends Error {
  constructor(path: string) {
    super(`seeds.json not published (${path})`);
    this.name = "SeedsNotPublished";
  }
}

const seedsCache = new Map<string, Promise<SeedsJson>>();

/** Where a game's seeds live. The index gained seeds_path; derive if absent. */
export function seedsPathFor(row: JsonWeekRow): string {
  const explicit = (row as any).seeds_path;
  if (typeof explicit === "string" && explicit.trim()) return explicit.replace(/^\/+/, "");
  return row.summary_path.replace(/summary\.json$/i, "seeds.json");
}

export async function getSeeds(
  row: JsonWeekRow,
  season: Season,
  signal?: AbortSignal
): Promise<SeedsJson> {
  const path = seedsPathFor(row);
  const key = `${season}/${path}`;
  const memo = seedsCache.get(key);
  if (memo) return memo;

  const promise = (async () => {
    const url = await dataUrl(path, season);
    const res = await fetch(url, { signal });
    if (res.status === 404) throw new SeedsNotPublished(path);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const raw = await res.json();

    const nums = (v: any): number[] =>
      Array.isArray(v) ? v.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0)) : [];

    const A_pts = nums(raw?.A_pts);
    const B_pts = nums(raw?.B_pts);
    const players: Record<string, number[]> = {};
    const playerNames = new Set<string>();
    const src = raw?.players ?? {};
    for (const k of Object.keys(src)) {
      const col = nums(src[k]);
      if (!col.length) continue;
      players[k] = col;
      const who = k.split("|")[0];
      if (who) playerNames.add(who);
    }

    const nsims = Number(raw?.nsims) || A_pts.length;
    return { nsims, A_pts, B_pts, players, playerNames };
  })().catch((err) => {
    seedsCache.delete(key); // let a retry work
    throw err;
  });

  seedsCache.set(key, promise);
  return promise;
}

/* --------------------------------- legs ---------------------------------- */

export type Side = "over" | "under";
export type TeamRef = "A" | "B";

export type LegSpec =
  /** team covers its own line: that team's margin > -line. */
  | { kind: "spread"; team: TeamRef; line: number }
  | { kind: "total"; side: Side; line: number }
  | { kind: "teamTotal"; team: TeamRef; side: Side; line: number }
  | { kind: "prop"; player: string; stat: string; side: Side; line: number };

export type Leg = {
  id: string;
  season: Season;
  weekId: string;
  /** Game identity — legs survive week/season switches in the slip. */
  slug: string;
  teamA: string;
  teamB: string;
  row: JsonWeekRow;
  spec: LegSpec;
  label: string;
};

export const PROP_STATS: { key: string; label: string }[] = [
  { key: "pass_yds",  label: "Pass Yds" },
  { key: "pass_td",   label: "Pass TD" },
  { key: "pass_comp", label: "Comp" },
  { key: "pass_att",  label: "Pass Att" },
  { key: "int",       label: "INT" },
  { key: "rush_yds",  label: "Rush Yds" },
  { key: "rush_att",  label: "Rush Att" },
  { key: "rush_td",   label: "Rush TD" },
  { key: "rec",       label: "Rec" },
  { key: "rec_yds",   label: "Rec Yds" },
  { key: "rec_td",    label: "Rec TD" },
  { key: "tgt",       label: "Targets" },
];

export const statLabel = (k: string) =>
  PROP_STATS.find((s) => s.key === k)?.label ?? k;

/** Lines are half-points in MVP so no leg can push. */
export const snapHalf = (x: number): number => Math.round(x - 0.5) + 0.5;

export function legLabel(spec: LegSpec, teamA: string, teamB: string): string {
  const t = (r: TeamRef) => (r === "A" ? teamA : teamB);
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  switch (spec.kind) {
    case "spread":
      return `${t(spec.team)} ${signed(spec.line)}`;
    case "total":
      return `Total ${spec.side === "over" ? "Over" : "Under"} ${spec.line}`;
    case "teamTotal":
      return `${t(spec.team)} team total ${spec.side === "over" ? "Over" : "Under"} ${spec.line}`;
    case "prop":
      return `${spec.player} ${statLabel(spec.stat)} ${spec.side === "over" ? "Over" : "Under"} ${spec.line}`;
  }
}

/* ------------------------------ predicates ------------------------------- */

export type MaskResult = { mask: Uint8Array } | { error: string };

/**
 * Per-seed truth of one leg.
 *
 * Sign conventions come from the bundle: teamA is home, margin = A - B.
 * A team covers its line when its own margin beats the negated line, so
 * "UNC +7.5" (B) is (B - A) > -7.5, i.e. A - B < 7.5.
 */
export function legMask(seeds: SeedsJson, spec: LegSpec): MaskResult {
  const n = Math.min(seeds.A_pts.length, seeds.B_pts.length);
  if (!n) return { error: "no seed data" };
  const mask = new Uint8Array(n);

  if (spec.kind === "spread") {
    for (let i = 0; i < n; i++) {
      const own = spec.team === "A" ? seeds.A_pts[i] - seeds.B_pts[i] : seeds.B_pts[i] - seeds.A_pts[i];
      mask[i] = own > -spec.line ? 1 : 0;
    }
    return { mask };
  }

  if (spec.kind === "total") {
    for (let i = 0; i < n; i++) {
      const t = seeds.A_pts[i] + seeds.B_pts[i];
      mask[i] = (spec.side === "over" ? t > spec.line : t < spec.line) ? 1 : 0;
    }
    return { mask };
  }

  if (spec.kind === "teamTotal") {
    const col = spec.team === "A" ? seeds.A_pts : seeds.B_pts;
    for (let i = 0; i < n; i++) {
      mask[i] = (spec.side === "over" ? col[i] > spec.line : col[i] < spec.line) ? 1 : 0;
    }
    return { mask };
  }

  // prop
  const col = seeds.players[`${spec.player}|${spec.stat}`];
  if (!col) {
    // The exporter omits all-zero columns. A player who appears elsewhere in
    // the file simply never recorded this stat, which is a real zero — not
    // missing data. A player absent from the file entirely cannot be priced.
    if (!seeds.playerNames.has(spec.player)) {
      return { error: `${spec.player} not in this game's seed file` };
    }
    const zeroHit = spec.side === "under" ? spec.line > 0 : false;
    return { mask: new Uint8Array(n).fill(zeroHit ? 1 : 0) };
  }
  for (let i = 0; i < n; i++) {
    const v = col[i] ?? 0;
    mask[i] = (spec.side === "over" ? v > spec.line : v < spec.line) ? 1 : 0;
  }
  return { mask };
}

/** Marginal probability of one leg, for live feedback in the picker. */
export function legMarginal(seeds: SeedsJson, spec: LegSpec): number | null {
  const r = legMask(seeds, spec);
  if ("error" in r) return null;
  let hits = 0;
  for (let i = 0; i < r.mask.length; i++) hits += r.mask[i];
  return r.mask.length ? hits / r.mask.length : null;
}

/* -------------------------------- pricing -------------------------------- */

export type LegPricing = { leg: Leg; hits: number; n: number; p: number | null; error?: string };

export type GameBlock = {
  slug: string;
  teamA: string;
  teamB: string;
  n: number;
  legs: LegPricing[];
  /** Seeds where EVERY leg of this game hit — the correlation-aware count. */
  jointHits: number;
  jointP: number;
};

export type Pricing = {
  blocks: GameBlock[];
  /** Product of per-game joint fractions. */
  jointP: number;
  /** Product of every leg's marginal — what you get if you ignore correlation. */
  naiveP: number;
  ciLo: number;
  ciHi: number;
  /** True when more than one game block contributes (delta-method CI). */
  ciApprox: boolean;
  /** Smallest per-block joint hit count; drives the honesty gate. */
  minBlockHits: number;
  thin: boolean;
  errors: string[];
};

export const THIN_SEED_THRESHOLD = 20;

/** Group legs by game, count joint hits per game, then multiply across games. */
export function priceParlay(
  legs: Leg[],
  seedsBySlug: Map<string, SeedsJson>
): Pricing | null {
  if (!legs.length) return null;

  const bySlug = new Map<string, Leg[]>();
  for (const l of legs) {
    const arr = bySlug.get(l.slug);
    if (arr) arr.push(l);
    else bySlug.set(l.slug, [l]);
  }

  const blocks: GameBlock[] = [];
  const errors: string[] = [];

  for (const [slug, groupLegs] of bySlug) {
    const seeds = seedsBySlug.get(slug);
    if (!seeds) {
      errors.push(`seeds not loaded for ${slug}`);
      continue;
    }
    const n = Math.min(seeds.A_pts.length, seeds.B_pts.length);

    let joint: Uint8Array | null = null;
    const legPricings: LegPricing[] = [];

    for (const leg of groupLegs) {
      const r = legMask(seeds, leg.spec);
      if ("error" in r) {
        legPricings.push({ leg, hits: 0, n, p: null, error: r.error });
        errors.push(`${leg.label}: ${r.error}`);
        continue;
      }
      let hits = 0;
      for (let i = 0; i < r.mask.length; i++) hits += r.mask[i];
      legPricings.push({ leg, hits, n, p: n ? hits / n : null });

      if (!joint) joint = Uint8Array.from(r.mask);
      else for (let i = 0; i < joint.length; i++) joint[i] = joint[i] & r.mask[i];
    }

    let jointHits = 0;
    if (joint) for (let i = 0; i < joint.length; i++) jointHits += joint[i];

    blocks.push({
      slug,
      teamA: groupLegs[0].teamA,
      teamB: groupLegs[0].teamB,
      n,
      legs: legPricings,
      jointHits,
      jointP: n ? jointHits / n : 0,
    });
  }

  if (!blocks.length) return null;

  let jointP = 1;
  let naiveP = 1;
  let minBlockHits = Infinity;
  for (const b of blocks) {
    jointP *= b.jointP;
    minBlockHits = Math.min(minBlockHits, b.jointHits);
    for (const lp of b.legs) naiveP *= lp.p ?? 0;
  }

  const single = blocks.length === 1;
  let ciLo = 0;
  let ciHi = 1;
  if (single) {
    [ciLo, ciHi] = wilson(blocks[0].jointHits, blocks[0].n);
  } else {
    // Delta method on log p: Var(log p_i) ~= (1-p_i)/(n_i p_i), summed over
    // independent game blocks. Approximate, and labeled as such in the UI.
    let varLog = 0;
    let ok = true;
    for (const b of blocks) {
      if (!b.n || b.jointP <= 0) { ok = false; break; }
      varLog += (1 - b.jointP) / (b.n * b.jointP);
    }
    if (ok && jointP > 0) {
      const sd = Math.sqrt(varLog);
      ciLo = Math.max(0, jointP * Math.exp(-1.96 * sd));
      ciHi = Math.min(1, jointP * Math.exp(1.96 * sd));
    } else {
      ciLo = 0;
      ciHi = 1;
    }
  }

  return {
    blocks,
    jointP,
    naiveP,
    ciLo,
    ciHi,
    ciApprox: !single,
    minBlockHits: Number.isFinite(minBlockHits) ? minBlockHits : 0,
    thin: minBlockHits < THIN_SEED_THRESHOLD,
    errors,
  };
}

/** Wilson score interval — behaves at the extremes where normal-approx does not. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

/* ---------------------------------- odds --------------------------------- */

/** Fair (no-vig) American odds for a probability. */
export function americanFromProb(p: number): string {
  if (!(p > 0 && p < 1)) return "—";
  if (p >= 0.5) return String(Math.round((-p / (1 - p)) * 100));
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

export function probFromAmerican(a: number): number | null {
  if (!Number.isFinite(a) || a === 0) return null;
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}

/** Profit per $1 staked at an American price. */
export function profitPerDollar(a: number): number | null {
  if (!Number.isFinite(a) || a === 0) return null;
  return a < 0 ? 100 / -a : a / 100;
}

export type BookCompare = {
  bookProb: number;
  edge: number;       // fair probability minus the book's implied probability
  evPerDollar: number;
};

export function compareToBook(fairP: number, american: number): BookCompare | null {
  const bookProb = probFromAmerican(american);
  const profit = profitPerDollar(american);
  if (bookProb === null || profit === null) return null;
  return {
    bookProb,
    edge: fairP - bookProb,
    evPerDollar: fairP * profit - (1 - fairP),
  };
}
