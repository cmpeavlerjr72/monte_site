// Runtime loader for the small-JSON CFB sim layout.
//
// 2025 originally shipped as per-week CSV bundles — scores_bundle.csv is ~1.5MB
// and carries every seed of every game, parsed in the browser on every week
// change. That is what made the scoreboard slow and crash-prone. The JSON
// layout replaces it with a per-week index plus small per-game files, fetched
// on demand:
//
//   <season>/weeks/weekNN/index.json                   (2026: new index here)
//   <season>/weeks/weekNN/games/index.json             (2025: new index here)
//   <season>/weeks/weekNN/games/<slug>/summary.json    headline numbers + odds
//   <season>/weeks/weekNN/games/<slug>/compact.json    per-seed arrays (~8KB)
//   <season>/weeks/weekNN/games/<slug>/players.json    per-player quantiles
//
// The week index lives at a different path per season because 2025's
// old-schema weeks/weekNN/index.json must keep existing for the pages that
// still read it. Rather than branching on season, getJsonWeekIndex probes both
// and accepts whichever payload carries the new contract's marker field
// (summary_path) — so a season flips to JSON the moment its files land, with
// no code change here.
//
// Conventions fixed by the exporter:
//   teamA = home, teamB = away
//   median_margin = home - away
//   A_win_prob    = P(home wins)
//   odds.spread_* is home-perspective (negative = home favored)

import { dataUrl, type Season } from "./cfbData";

/** One row of the new-contract week index. */
export type JsonWeekRow = {
  game_id?: string;
  slug: string;
  teamA: string;   // home
  teamB: string;   // away
  A_espn_id?: string;
  B_espn_id?: string;
  date?: string;
  time_utc?: string;
  summary_path: string;
  compact_path: string;
  players_path: string;
  /** Per-player simulated distributions (sparse integer PMFs). */
  dist_path: string;
  /** Seed-aligned raw columns, for same-game parlay joints. */
  seeds_path: string;
};

/** games/<slug>/summary.json. */
export type GameSummaryJson = {
  teamA?: string;
  teamB?: string;
  A_win_prob?: number;
  median_margin?: number;
  median_total?: number;
  /** Exact per-team medians. median(A) + median(B) != median(total), so these
   *  are NOT interchangeable with deriving points from margin+total. */
  median_A_pts?: number;
  median_B_pts?: number;
  mean_A_pts?: number;
  mean_B_pts?: number;
  mean_margin?: number;
  mean_total?: number;
  p25_margin?: number;
  p75_margin?: number;
  p25_total?: number;
  p75_total?: number;
  neutral_site?: boolean;
  /** Set on a few 2025 week-0 games where home/away could not be established. */
  orientation_assumed?: boolean;
  nsims?: number;
  updated?: string;
  finalA?: number | null;
  finalB?: number | null;
  odds?: {
    spread_open?: number | null;
    over_under_open?: number | null;
    spread_current?: number | null;
    over_under_current?: number | null;
    provider_count?: number | null;
  } | null;
};

/** An index row joined to its summary. */
export type JsonGame = {
  row: JsonWeekRow;
  summary: GameSummaryJson | null;
};

const num = (v: any): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const stripSlashes = (s: string) => s.replace(/^\/+/, "");

/** Normalize an index row; returns null if it has no usable identity. */
function parseWeekRow(raw: any, weekId: string): JsonWeekRow | null {
  if (!raw) return null;
  const teamA = String(raw.teamA ?? raw.team_a ?? raw.home ?? "").trim();
  const teamB = String(raw.teamB ?? raw.team_b ?? raw.away ?? "").trim();
  const slug = String(raw.slug ?? raw.game_id ?? "").trim();
  if (!slug || !teamA || !teamB) return null;

  // The exporter always writes the *_path fields; these fallbacks only matter
  // if a future export drops them. Game JSON lives under the WEEK directory.
  const summaryPath =
    String(raw.summary_path ?? raw.summaryPath ?? "").trim() ||
    `weeks/${weekId}/games/${slug}/summary.json`;

  return {
    game_id: raw.game_id != null ? String(raw.game_id) : undefined,
    slug,
    teamA,
    teamB,
    A_espn_id: raw.A_espn_id != null ? String(raw.A_espn_id) : undefined,
    B_espn_id: raw.B_espn_id != null ? String(raw.B_espn_id) : undefined,
    date: raw.date ? String(raw.date) : undefined,
    time_utc: raw.time_utc ? String(raw.time_utc) : undefined,
    summary_path: stripSlashes(summaryPath),
    compact_path: stripSlashes(
      String(raw.compact_path ?? raw.compactPath ?? "").trim() ||
        summaryPath.replace(/summary\.json$/i, "compact.json")
    ),
    players_path: stripSlashes(
      String(raw.players_path ?? raw.playersPath ?? "").trim() ||
        summaryPath.replace(/summary\.json$/i, "players.json")
    ),
    dist_path: stripSlashes(
      String(raw.players_dist_path ?? raw.dist_path ?? "").trim() ||
        summaryPath.replace(/summary\.json$/i, "players_dist.json")
    ),
    seeds_path: stripSlashes(
      String(raw.seeds_path ?? raw.seedsPath ?? "").trim() ||
        summaryPath.replace(/summary\.json$/i, "seeds.json")
    ),
  };
}

function parseSummary(raw: any): GameSummaryJson | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw.odds ?? null;
  return {
    teamA: raw.teamA != null ? String(raw.teamA) : undefined,
    teamB: raw.teamB != null ? String(raw.teamB) : undefined,
    A_win_prob: num(raw.A_win_prob),
    median_margin: num(raw.median_margin),
    median_total: num(raw.median_total),
    median_A_pts: num(raw.median_A_pts),
    median_B_pts: num(raw.median_B_pts),
    mean_A_pts: num(raw.mean_A_pts),
    mean_B_pts: num(raw.mean_B_pts),
    mean_margin: num(raw.mean_margin),
    mean_total: num(raw.mean_total),
    p25_margin: num(raw.p25_margin),
    p75_margin: num(raw.p75_margin),
    p25_total: num(raw.p25_total),
    p75_total: num(raw.p75_total),
    neutral_site: Boolean(raw.neutral_site),
    orientation_assumed: Boolean(raw.orientation_assumed),
    nsims: num(raw.nsims ?? raw.n_sims),
    updated: raw.updated != null ? String(raw.updated) : undefined,
    finalA: num(raw.finalA) ?? null,
    finalB: num(raw.finalB) ?? null,
    odds: o
      ? {
          spread_open: num(o.spread_open) ?? null,
          over_under_open: num(o.over_under_open) ?? null,
          spread_current: num(o.spread_current) ?? null,
          over_under_current: num(o.over_under_current) ?? null,
          provider_count: num(o.provider_count) ?? null,
        }
      : null,
  };
}

/**
 * The week's index rows, or null if this season/week has no new-contract index
 * yet (the caller then falls back to the CSV loader).
 *
 * Probes weeks/<id>/index.json then weeks/<id>/games/index.json. A payload is
 * only accepted if its rows carry summary_path — 2025's legacy week index has
 * the same games[]/slug/teamA/teamB skeleton and would otherwise be mistaken
 * for the new one.
 */
export async function getJsonWeekIndex(
  weekId: string,
  season: Season,
  signal?: AbortSignal
): Promise<JsonWeekRow[] | null> {
  const candidates = [
    `weeks/${weekId}/index.json`,
    `weeks/${weekId}/games/index.json`,
  ];

  for (const rel of candidates) {
    try {
      const json = await fetchJson(await dataUrl(rel, season), signal);
      const raw = json?.games;
      if (!Array.isArray(raw) || !raw.length) continue;

      const isNewContract = raw.some(
        (r: any) => typeof r?.summary_path === "string" && r.summary_path.trim()
      );
      if (!isNewContract) continue;

      const rows = raw
        .map((r: any) => parseWeekRow(r, weekId))
        .filter((r): r is JsonWeekRow => r !== null);
      if (rows.length) return rows;
    } catch (err) {
      if ((err as any)?.name === "AbortError") throw err;
      // 404 on this candidate — try the next.
    }
  }

  return null;
}

/**
 * Index rows joined to their summary.json, or null if the week has no
 * new-contract index.
 *
 * One small fetch per game, all in parallel. A game whose summary is missing
 * or malformed comes back with summary: null rather than failing the week — a
 * half-exported slate should still render the games it does have.
 */
export async function getJsonWeekGames(
  weekId: string,
  season: Season,
  signal?: AbortSignal
): Promise<JsonGame[] | null> {
  const rows = await getJsonWeekIndex(weekId, season, signal);
  if (!rows) return null;

  return Promise.all(
    rows.map(async (row) => {
      try {
        const summary = parseSummary(
          await fetchJson(await dataUrl(row.summary_path, season), signal)
        );
        return { row, summary };
      } catch (err) {
        if ((err as any)?.name === "AbortError") throw err;
        console.warn(`[cfbJson] summary failed for ${row.slug}:`, err);
        return { row, summary: null };
      }
    })
  );
}

/**
 * compact.json — quantiles, histograms AND the raw per-seed point arrays
 * (A_pts/B_pts) in about 8KB. Card-expansion only: pulling one per game up
 * front would rebuild exactly the megabyte-per-week fetch this layout exists
 * to avoid.
 */
export type CompactJson = {
  n_sims?: number;
  teamA?: string;
  teamB?: string;
  A_pts: number[];
  B_pts: number[];
  quantiles?: Record<string, number[]>;
  hist?: Record<string, { start: number; end: number; count: number }[]>;
};

/** Per-game memo: the market block and the distribution panel both want this
 *  file, and it is the largest thing a card fetches. */
const compactCache = new Map<string, Promise<CompactJson>>();

export function getCompactCached(row: JsonWeekRow, season: Season): Promise<CompactJson> {
  const key = `${season}/${row.compact_path}`;
  const memo = compactCache.get(key);
  if (memo) return memo;
  const promise = getCompactJson(row, season).catch((err) => {
    compactCache.delete(key);
    throw err;
  });
  compactCache.set(key, promise);
  return promise;
}

export async function getCompactJson(
  row: JsonWeekRow,
  season: Season,
  signal?: AbortSignal
): Promise<CompactJson> {
  const raw = await fetchJson(await dataUrl(row.compact_path, season), signal);

  const toNums = (v: any): number[] =>
    Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : [];

  return {
    n_sims: num(raw?.n_sims),
    teamA: raw?.teamA != null ? String(raw.teamA) : undefined,
    teamB: raw?.teamB != null ? String(raw.teamB) : undefined,
    A_pts: toNums(raw?.A_pts),
    B_pts: toNums(raw?.B_pts),
    quantiles: raw?.quantiles ?? undefined,
    hist: raw?.hist ?? undefined,
  };
}

/* ------------------------------- players.json ------------------------------ */

/** Per-stat distribution. The exporter publishes mean + p10/p25/p50/p75/p90. */
export type StatDist = {
  mean?: number;
  p10?: number;
  p25?: number;
  p50?: number;
  p75?: number;
  p90?: number;
};

export type PlayerJson = {
  player: string;
  team: string;
  role?: string;          // QB | RB | WR
  nSims?: number;
  stats: Record<string, StatDist>;
};

export type PlayersJson = {
  teamA?: string;
  teamB?: string;
  nSims?: number;
  statKeys: string[];
  players: PlayerJson[];
};

/** Keys that are stat blocks rather than identity fields. */
const PLAYER_ID_KEYS = new Set(["player", "team", "role", "n_sims", "sims_used"]);

export async function getPlayersJson(
  row: JsonWeekRow,
  season: Season,
  signal?: AbortSignal
): Promise<PlayersJson> {
  const raw = await fetchJson(await dataUrl(row.players_path, season), signal);

  const players: PlayerJson[] = ((raw?.players ?? []) as any[])
    .map((p): PlayerJson | null => {
      const name = String(p?.player ?? "").trim();
      const team = String(p?.team ?? "").trim();
      if (!name || !team) return null;

      const stats: Record<string, StatDist> = {};
      for (const k of Object.keys(p)) {
        if (PLAYER_ID_KEYS.has(k)) continue;
        const v = p[k];
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        stats[k] = {
          mean: num(v.mean),
          p10: num(v.p10),
          p25: num(v.p25),
          p50: num(v.p50),
          p75: num(v.p75),
          p90: num(v.p90),
        };
      }

      return {
        player: name,
        team,
        role: p?.role != null ? String(p.role) : undefined,
        nSims: num(p?.n_sims),
        stats,
      };
    })
    .filter((p): p is PlayerJson => p !== null);

  return {
    teamA: raw?.teamA != null ? String(raw.teamA) : undefined,
    teamB: raw?.teamB != null ? String(raw.teamB) : undefined,
    nSims: num(raw?.n_sims),
    statKeys: Array.isArray(raw?.stat_keys) ? raw.stat_keys.map(String) : [],
    players,
  };
}

/* ---------------------------- players_dist.json ---------------------------- */
//
// Sparse integer PMFs per player-stat: { "<int value>": count }, counts summing
// to nsims. Exact for .5 betting lines — P(over L) is just the counts strictly
// above L, no interpolation and no distributional assumption.

/** value -> count. Keys are integers-as-strings in the wire format. */
export type Pmf = Map<number, number>;

export type PlayerDist = {
  player: string;
  team: string;
  role?: string;
  stats: Record<string, Pmf>;
};

export type PlayersDistJson = {
  nsims: number;
  players: PlayerDist[];
};

/** Thrown when the file simply is not published yet, so callers can tell a
 *  missing export apart from a real failure. */
export class DistNotPublished extends Error {
  constructor(path: string) {
    super(`players_dist.json not published (${path})`);
    this.name = "DistNotPublished";
  }
}

function parsePmf(raw: any): Pmf {
  const out: Pmf = new Map();
  const src = raw?.pmf ?? raw;
  if (!src || typeof src !== "object") return out;
  for (const k of Object.keys(src)) {
    const v = Number(k);
    const c = Number(src[k]);
    if (!Number.isFinite(v) || !Number.isFinite(c) || c <= 0) continue;
    out.set(v, (out.get(v) ?? 0) + c);
  }
  return out;
}

export async function getPlayersDistJson(
  row: JsonWeekRow,
  season: Season,
  signal?: AbortSignal
): Promise<PlayersDistJson> {
  const url = await dataUrl(row.dist_path, season);
  const res = await fetch(url, { signal, cache: "no-store" });
  // 404 is the expected answer for a week the exporter has not reached yet.
  if (res.status === 404) throw new DistNotPublished(row.dist_path);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const raw = await res.json();

  const players: PlayerDist[] = ((raw?.players ?? []) as any[])
    .map((p): PlayerDist | null => {
      const name = String(p?.player ?? "").trim();
      const team = String(p?.team ?? "").trim();
      if (!name || !team) return null;
      const stats: Record<string, Pmf> = {};
      const src = p?.stats ?? {};
      for (const k of Object.keys(src)) {
        const pmf = parsePmf(src[k]);
        if (pmf.size) stats[k] = pmf;
      }
      return { player: name, team, role: p?.role != null ? String(p.role) : undefined, stats };
    })
    .filter((p): p is PlayerDist => p !== null);

  return { nsims: num(raw?.nsims) ?? num(raw?.n_sims) ?? 0, players };
}

/* ---- PMF math. Pure and exported so it can be checked against real data. ---- */

/** Total count in a PMF (should equal nsims). */
export function pmfTotal(pmf: Pmf): number {
  let n = 0;
  for (const c of pmf.values()) n += c;
  return n;
}

/** P(value > line). Exact for half-point lines. */
export function pmfPOver(pmf: Pmf, line: number): number {
  const n = pmfTotal(pmf);
  if (!n) return 0;
  let over = 0;
  for (const [v, c] of pmf) if (v > line) over += c;
  return over / n;
}

export function pmfMean(pmf: Pmf): number {
  const n = pmfTotal(pmf);
  if (!n) return 0;
  let s = 0;
  for (const [v, c] of pmf) s += v * c;
  return s / n;
}

/** Lower median: smallest value whose cumulative count reaches half. */
export function pmfMedian(pmf: Pmf): number {
  const n = pmfTotal(pmf);
  if (!n) return 0;
  const vals = [...pmf.keys()].sort((a, b) => a - b);
  const half = n / 2;
  let cum = 0;
  for (const v of vals) {
    cum += pmf.get(v)!;
    if (cum >= half) return v;
  }
  return vals[vals.length - 1];
}

export type DistBin = { start: number; end: number; count: number; mid: number; label: string };

/** Bucket a PMF into fixed-width bins aligned to multiples of `width`. */
export function pmfBins(pmf: Pmf, width: number): DistBin[] {
  if (!pmf.size) return [];
  const vals = [...pmf.keys()];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const start = Math.floor(lo / width) * width;
  const end = Math.floor(hi / width) * width + width;

  const bins: DistBin[] = [];
  for (let s = start; s < end; s += width) {
    bins.push({
      start: s,
      end: s + width,
      count: 0,
      mid: s + width / 2,
      label: width === 1 ? String(s) : `${s}–${s + width}`,
    });
  }
  for (const [v, c] of pmf) {
    let i = Math.floor((v - start) / width);
    if (i < 0) i = 0;
    if (i >= bins.length) i = bins.length - 1;
    bins[i].count += c;
  }
  return bins;
}

/* ============================ props_odds.json ==============================
 * Consensus prop lines for a whole week, published by the props pipeline.
 *
 *   { updated, source, season, week,
 *     games: { "<slug>": { props: [ { player, stat, line, fair_over,
 *                                     n_books, best_over:{price,book},
 *                                     best_under:{...}, vol_tercile } ] } } }
 *
 * `player` is the CANONICAL sim name, so it joins players_dist.json keys
 * verbatim — no normalization anywhere in this path.
 * ========================================================================= */

export type PropPrice = { price: number; book: string };

export type PropOddsRow = {
  player: string;
  stat: string;
  line: number;
  /** Consensus de-vigged P(over). */
  fair_over: number;
  n_books?: number;
  best_over?: PropPrice;
  best_under?: PropPrice;
  /** Usage volatility bucket; T3 overs carry a known over-projection caveat. */
  vol_tercile?: "T1" | "T2" | "T3";
};

export type PropsOdds = {
  updated: string | null;
  source: string | null;
  /** Single-book exports name the book once at the top level. */
  book: string | null;
  byGame: Map<string, PropOddsRow[]>;
};

/** Thrown when the week predates the props export, so callers can say so. */
export class PropsNotPublished extends Error {
  constructor(path: string) {
    super(`props_odds.json not published (${path})`);
    this.name = "PropsNotPublished";
  }
}

function parsePropPrice(raw: any): PropPrice | undefined {
  const price = num(raw?.price);
  const book = raw?.book != null ? String(raw.book) : "";
  return price === undefined ? undefined : { price, book };
}

const propsCache = new Map<string, Promise<PropsOdds>>();

export function getPropsOddsCached(season: Season, weekId: string): Promise<PropsOdds> {
  const key = `${season}/${weekId}`;
  const memo = propsCache.get(key);
  if (memo) return memo;
  const promise = getPropsOdds(season, weekId).catch((err) => {
    propsCache.delete(key);
    throw err;
  });
  propsCache.set(key, promise);
  return promise;
}

export async function getPropsOdds(
  season: Season,
  weekId: string,
  signal?: AbortSignal
): Promise<PropsOdds> {
  const rel = `weeks/${weekId}/props_odds.json`;
  const url = await dataUrl(rel, season);
  const res = await fetch(url, { signal });
  if (res.status === 404) throw new PropsNotPublished(rel);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const raw = await res.json();

  const byGame = new Map<string, PropOddsRow[]>();
  const games = raw?.games ?? {};
  for (const slug of Object.keys(games)) {
    const rows: PropOddsRow[] = [];
    // The export is moving to single-book (one row per player+stat). While both
    // shapes are in flight, keep the FIRST row per (player, stat) as listed.
    // Picking the most extreme instead would be selection bias — we would be
    // choosing the line that flatters the sim.
    const seen = new Set<string>();
    for (const p of games[slug]?.props ?? []) {
      const player = String(p?.player ?? "").trim();
      const stat = String(p?.stat ?? "").trim();
      const line = num(p?.line);
      const fair = num(p?.fair_over);
      if (!player || !stat || line === undefined || fair === undefined) continue;
      const dedupeKey = `${player}|${stat}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        player, stat, line,
        fair_over: fair,
        n_books: num(p?.n_books),
        best_over: parsePropPrice(p?.best_over),
        best_under: parsePropPrice(p?.best_under),
        vol_tercile: p?.vol_tercile === "T1" || p?.vol_tercile === "T2" || p?.vol_tercile === "T3"
          ? p.vol_tercile
          : undefined,
      });
    }
    if (rows.length) byGame.set(slug, rows);
  }

  return {
    updated: raw?.updated != null ? String(raw.updated) : null,
    source: raw?.source != null ? String(raw.source) : null,
    book: raw?.book != null ? String(raw.book) : null,
    byGame,
  };
}

/** Memoized players_dist, shared by the props panel and the slate edge scan. */
const distCache = new Map<string, Promise<PlayersDistJson>>();

export function getPlayersDistCached(row: JsonWeekRow, season: Season): Promise<PlayersDistJson> {
  const key = `${season}/${row.dist_path}`;
  const memo = distCache.get(key);
  if (memo) return memo;
  const promise = getPlayersDistJson(row, season).catch((err) => {
    distCache.delete(key);
    throw err;
  });
  distCache.set(key, promise);
  return promise;
}
