// src/lib/recordData.ts
//
// THE 2026 RECORD — the math and the loading behind `/cfb/record`.
//
// 2025's /cfb/results tracked one spread, one moneyline and one total per
// game. 2026 publishes THOUSANDS of priced rungs a week across Kalshi team
// markets and game lines (player props follow), so the record is a filtered
// view over a published ledger rather than a table of everything. Everything
// presentational lives in `src/pages/Record.tsx`; this module is
// presentation-free (same split as `marketEdge.ts` / `MarketEdge.tsx`).
//
// Three contracts are load-bearing and easy to get wrong:
//
//   1. A LADDER IS THE UNIT, NOT A RUNG. Every strike on one game-and-market
//      is a rung of one ladder (`ladder_id`), and the rungs of a ladder are
//      the SAME opinion priced at different places — Rutgers 17+, 21+, 24+ all
//      win or lose together far more often than not. So "Main line" and
//      "Best EV" each select exactly ONE row per ladder and the units are
//      counted once; "All rungs" shows every priced rung and the page has to
//      SAY that n is games, not bets.
//   2. THE PRICE FRAME IS THE PUBLISH PRICE. Every EV, unit and ROI on the
//      page is struck at `price_publish` (the standing rule: bets go in
//      Mon/Tue/Wed, so the number we publish is the number we are graded on).
//      `price_close` is carried per row so a reader can see the move; it is
//      never the frame.
//   3. ROI IS FEE-INCLUSIVE (standing rule 2026-08-28). The exporter's
//      `pnl_per_dollar` is the fee-inclusive settlement of one dollar staked.
//      A settled row WITHOUT one is NOT quietly re-derived fee-blind — it is
//      counted as unscored and the page prints how many, because a fee-blind
//      rate mixed into a fee-inclusive one is exactly the wk0 double-count
//      mistake in reverse.
//
// Data: `2026/record_index.json` + `2026/weeks/<weekNN>/record.json` on the
// HF dataset, fetched through the same `dataUrl()` the rest of the season
// uses (our /api/data proxy first, direct Hub as fallback).

import { dataUrl, type Season } from "./cfbData";

/* ------------------------------------------------------------------ types */

export type RecordFamily = "team" | "game" | "player";
export type RecordResult = "W" | "L" | "P";

/** One priced rung, exactly as the exporter publishes it. */
export type RecordRow = {
  id: string;
  family: RecordFamily;
  /** "team_total" | "team_rec_yds" | … | "spread" | "ml" | "total" | "1h_total" | … */
  market: string;
  series?: string | null;
  game_slug: string;
  home: string;
  away: string;
  kickoff_utc?: string | null;
  /** The team a team-family row is about; null on game lines. */
  subject?: string | null;
  ladder_id: string;
  strike?: number | null;
  rung_label: string;
  is_main: boolean;
  best_on_ladder: boolean;
  side: "yes" | "no";
  /** Our simulated probability. See `pShown` for which side it describes. */
  p_sim: number;
  se?: number | null;
  n_sims?: number | null;
  price_publish: number;
  price_close?: number | null;
  ev_publish?: number | null;
  ev_close?: number | null;
  starred: boolean;
  flags: string[];
  withheld?: boolean;
  result: RecordResult | null;
  pnl_per_dollar?: number | null;
  settled_utc?: string | null;
  price_frame?: string;
  venue?: string;
  /* ---- filled in by the loader, never by the exporter ---- */
  /** Week number this row was published in. */
  week: number;
  /** Probability of the side actually shown, orientation resolved. */
  pShown: number;
};

export type RecordWeek = {
  season: number;
  week: number;
  week_folder: string;
  generated_utc?: string;
  engine_tag?: string;
  publish_utc?: string;
  settled: boolean;
  settled_rows: number;
  unsettled_rows: number;
  families?: { team?: number; game?: number; player?: number };
  rows: RecordRow[];
};

export type RecordIndexEntry = {
  week: number;
  week_folder: string;
  publish_utc?: string;
  settled: boolean;
  rows: number;
  starred_rows?: number;
  generated_utc?: string;
};

/* -------------------------------------------------------------- normalize */

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Prices and probabilities arrive as DOLLARS (0–1). A value above 1.5 can
 * only be cents, so accept that spelling too rather than drawing a 90-dollar
 * price. Anything outside [0,1] after that is dropped instead of clamped —
 * a price of 1.4 is a broken row, not a 100¢ one.
 */
function unit(v: any): number | null {
  const n = num(v);
  if (n === null) return null;
  const x = n > 1.5 ? n / 100 : n;
  return x >= 0 && x <= 1 ? x : null;
}

/**
 * Which side's probability is `p_sim`?
 *
 * The published team-markets contract says `sim_p` is P(YES) and the reader
 * flips it when the row's side is NO, so that is the default. But this file
 * is written by a different exporter, so the orientation is CHECKED rather
 * than assumed: for a buy at price q, EV per dollar is p/q − 1 − fee/q, so
 * (1 + ev) · q recovers p to within the fee. Whichever candidate — p_sim or
 * 1 − p_sim — sits closer to that on the NO rows wins, and the convention is
 * the fallback when there is not enough evidence to tell.
 *
 * Getting this wrong would mirror the calibration chart about 50%, which is
 * the one defect on this page a reader could not see, hence the check.
 */
function orientationOf(rows: any[]): "flip" | "asis" {
  let flip = 0;
  let asis = 0;
  for (const r of rows) {
    if (String(r?.side) !== "no") continue;
    const p = unit(r?.p_sim);
    const q = unit(r?.price_publish);
    const ev = num(r?.ev_publish);
    if (p === null || q === null || ev === null || q <= 0) continue;
    const implied = (1 + ev) * q;
    if (Math.abs(1 - p - implied) + 1e-9 < Math.abs(p - implied)) flip++;
    else asis++;
  }
  if (flip + asis < 20) return "flip";
  return flip > asis ? "flip" : "asis";
}

function parseRow(raw: any, week: number, orient: "flip" | "asis"): RecordRow | null {
  if (!raw) return null;
  const id = String(raw.id ?? "").trim();
  const family = String(raw.family ?? "").trim() as RecordFamily;
  const market = String(raw.market ?? "").trim();
  const ladder_id = String(raw.ladder_id ?? "").trim();
  const price_publish = unit(raw.price_publish);
  const p_sim = unit(raw.p_sim);
  if (!id || !market || !ladder_id) return null;
  if (price_publish === null || p_sim === null) return null;
  if (family !== "team" && family !== "game" && family !== "player") return null;

  const side = String(raw.side ?? "yes").toLowerCase() === "no" ? "no" : "yes";
  const resultRaw = String(raw.result ?? "").toUpperCase();
  const result: RecordResult | null =
    resultRaw === "W" || resultRaw === "L" || resultRaw === "P" ? resultRaw : null;

  return {
    id,
    family,
    market,
    series: raw.series == null ? null : String(raw.series),
    game_slug: String(raw.game_slug ?? ""),
    home: String(raw.home ?? ""),
    away: String(raw.away ?? ""),
    kickoff_utc: raw.kickoff_utc ?? null,
    subject: raw.subject == null || raw.subject === "" ? null : String(raw.subject),
    ladder_id,
    strike: num(raw.strike),
    rung_label: String(raw.rung_label ?? raw.strike ?? "").trim(),
    is_main: Boolean(raw.is_main),
    best_on_ladder: Boolean(raw.best_on_ladder),
    side,
    p_sim,
    se: num(raw.se),
    n_sims: num(raw.n_sims),
    price_publish,
    price_close: unit(raw.price_close),
    ev_publish: num(raw.ev_publish),
    ev_close: num(raw.ev_close),
    starred: Boolean(raw.starred),
    flags: Array.isArray(raw.flags) ? raw.flags.map((f: any) => String(f)) : [],
    withheld: Boolean(raw.withheld),
    result,
    pnl_per_dollar: num(raw.pnl_per_dollar),
    settled_utc: raw.settled_utc ?? null,
    price_frame: raw.price_frame ? String(raw.price_frame) : "publish",
    venue: raw.venue ? String(raw.venue) : "kalshi",
    week,
    pShown: side === "no" && orient === "flip" ? 1 - p_sim : p_sim,
  };
}

/* ---------------------------------------------------------------- loading */

/**
 * The record files sit beside every other week file on the season dataset, so
 * they resolve through the SAME `dataUrl()` — our /api/data proxy first, the
 * Hub as fallback. The proxy allowlist is per-REPO and `cfb-sims-2026` is
 * already on it, so these paths needed no server change; an unpublished file
 * comes back as a forwarded upstream 404, which is exactly what
 * `RecordNotPublished` is built on.
 *
 * (There is no fixture path here on purpose. The page was built against a
 * local fixture, and that fixture was deleted rather than shipped: a route
 * that can serve invented W-L numbers under the word "record" is not something
 * to leave in production behind a query parameter.)
 */
const recordUrl = (path: string, season: Season): Promise<string> =>
  dataUrl(path, season);

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Thrown when the record has not been published for this season yet. */
export class RecordNotPublished extends Error {
  constructor(season: Season) {
    super(`no record published for ${season}`);
    this.name = "RecordNotPublished";
  }
}

export async function loadRecordIndex(
  season: Season,
  signal?: AbortSignal,
): Promise<RecordIndexEntry[]> {
  let json: any;
  try {
    json = await fetchJson(await recordUrl("record_index.json", season), signal);
  } catch {
    throw new RecordNotPublished(season);
  }
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.weeks) ? json.weeks : [];
  return list
    .map((w: any): RecordIndexEntry | null => {
      const week = num(w?.week);
      const folder = String(w?.week_folder ?? w?.dir ?? "").trim();
      if (week === null || !folder) return null;
      return {
        week,
        week_folder: folder,
        publish_utc: w?.publish_utc ?? undefined,
        settled: Boolean(w?.settled),
        rows: num(w?.rows) ?? 0,
        starred_rows: num(w?.starred_rows) ?? undefined,
        generated_utc: w?.generated_utc ?? undefined,
      };
    })
    .filter((w): w is RecordIndexEntry => w !== null)
    .sort((a, b) => a.week - b.week);
}

export async function loadRecordWeek(
  season: Season,
  entry: RecordIndexEntry,
  signal?: AbortSignal,
): Promise<RecordWeek> {
  const json = await fetchJson(
    await recordUrl(`weeks/${entry.week_folder}/record.json`, season),
    signal,
  );
  const week = num(json?.week) ?? entry.week;
  const rawRows: any[] = Array.isArray(json?.rows) ? json.rows : [];
  const orient = orientationOf(rawRows);
  const rows = rawRows
    .map((r) => parseRow(r, week, orient))
    .filter((r): r is RecordRow => r !== null);
  return {
    season: (num(json?.season) ?? Number(season)) || 0,
    week,
    week_folder: String(json?.week_folder ?? entry.week_folder),
    generated_utc: json?.generated_utc,
    engine_tag: json?.engine_tag,
    publish_utc: json?.publish_utc ?? entry.publish_utc,
    settled: Boolean(json?.settled ?? entry.settled),
    settled_rows: num(json?.settled_rows) ?? rows.filter((r) => r.result != null).length,
    unsettled_rows: num(json?.unsettled_rows) ?? rows.filter((r) => r.result == null).length,
    families: json?.families,
    rows,
  };
}

/**
 * How many published rows we will hold in memory at once.
 *
 * Every week is loaded so that "all weeks" is the honest season record and the
 * running line has every point. At a few thousand rows a week that is small;
 * if the season ever outgrows this, the newest weeks load and the page SAYS
 * which ones it skipped rather than quietly reporting a partial record.
 */
export const EAGER_ROW_BUDGET = 150_000;

export type RecordLoad = {
  index: RecordIndexEntry[];
  weeks: RecordWeek[];
  /** Weeks in the index that the budget above kept us from loading. */
  skipped: RecordIndexEntry[];
};

export async function loadRecord(
  season: Season,
  signal?: AbortSignal,
): Promise<RecordLoad> {
  const index = await loadRecordIndex(season, signal);
  const newestFirst = [...index].sort((a, b) => b.week - a.week);
  const take: RecordIndexEntry[] = [];
  const skipped: RecordIndexEntry[] = [];
  let budget = EAGER_ROW_BUDGET;
  for (const w of newestFirst) {
    if (take.length && budget - w.rows < 0) skipped.push(w);
    else {
      take.push(w);
      budget -= w.rows;
    }
  }
  const weeks = await Promise.all(take.map((w) => loadRecordWeek(season, w, signal)));
  weeks.sort((a, b) => a.week - b.week);
  return { index, weeks, skipped: skipped.sort((a, b) => a.week - b.week) };
}

/* ------------------------------------------------------------------ words */

/** Period a game-family market belongs to. "" = the full game. */
export function periodOf(market: string): string {
  const m = /^(1h|2h|1q|2q|3q|4q|ot)_/i.exec(market);
  return m ? m[1].toLowerCase() : "";
}

/** The market with its period prefix removed ("1h_spread" -> "spread"). */
export function baseMarket(market: string): string {
  const p = periodOf(market);
  return p ? market.slice(p.length + 1) : market;
}

export const PERIOD_WORDS: Record<string, string> = {
  "": "Full game",
  "1h": "1st half",
  "2h": "2nd half",
  "1q": "1st quarter",
  "2q": "2nd quarter",
  "3q": "3rd quarter",
  "4q": "4th quarter",
  ot: "Overtime",
};

/**
 * Words for a market key.
 *
 * Deliberately a PRETTIFIER over the key rather than a second copy of the
 * Kalshi series map (`teamStatMarkets.ts` owns that one, and a second copy is
 * exactly the bug that module exists to prevent). An unknown key that the
 * exporter adds next week reads sensibly instead of rendering blank.
 */
const WORD_FOR: Record<string, string> = {
  ml: "moneyline",
  total: "total",
  spread: "spread",
  tt: "team total",
  rec: "receiving",
  rsh: "rushing",
  rush: "rushing",
  yds: "yards",
  td: "TDs",
  tds: "TDs",
  att: "attempts",
  int: "interceptions",
  ints: "interceptions",
  sack: "sacks",
  sacks: "sacks",
  fg: "field goals",
  to: "turnovers",
  pass: "passing",
  def: "defensive",
  team: "team",
  pts: "points",
};

export function marketWords(market: string): string {
  const base = baseMarket(market);
  const words = base
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => WORD_FOR[w.toLowerCase()] ?? w.replace(/^./, (c) => c.toUpperCase()));
  const period = periodOf(market);
  const label = words.join(" ").replace(/^./, (c) => c.toUpperCase());
  return period ? `${PERIOD_WORDS[period] ?? period.toUpperCase()} ${label.toLowerCase()}` : label;
}

/** The bet in words: what the rung label already says, with the side spelled out. */
export function betWords(row: RecordRow): string {
  const label = row.rung_label || marketWords(row.market);
  return row.side === "no" ? `NO ${label}` : label;
}

export const cents = (p: number | null | undefined): string =>
  p == null ? "—" : `${Math.round(p * 100)}¢`;

export const pct = (p: number | null | undefined, digits = 0): string =>
  p == null ? "—" : `${(p * 100).toFixed(digits)}%`;

export const signed = (n: number, digits = 2): string =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

/* ------------------------------------------------------------ the record */

export type RungMode = "main" | "best" | "all";
export type EvMode = "all" | "pos" | "star";

export type RecordSummary = {
  /** Rows in the current selection, settled and not. */
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  /** Settled rows that carried no fee-inclusive P&L, so could not be scored. */
  unscored: number;
  /** Rows that produced a unit number. */
  scored: number;
  /** Net units at 1u per bet, fee-inclusive, struck at the publish price. */
  units: number;
  /** units / scored — the fee-inclusive ROI at the publish price. */
  roi: number | null;
  /** How many distinct ladders the selection touches. */
  ladders: number;
};

/**
 * A ladder is identified by (week, ladder_id), never `ladder_id` alone.
 *
 * Nothing promises the exporter re-keys a ladder between weeks — "TCU team
 * total" is the same string in week 2 and week 3 — so counting or grouping on
 * the bare id silently merges a whole season of a market into one ladder. It
 * showed up the first time this page rendered: 224 rows reported 84 ladders.
 */
export const ladderKey = (r: RecordRow): string => `${r.week}:${r.ladder_id}`;

export function summarize(rows: RecordRow[]): RecordSummary {
  let wins = 0, losses = 0, pushes = 0, pending = 0, unscored = 0, scored = 0, units = 0;
  const ladders = new Set<string>();
  for (const r of rows) {
    ladders.add(ladderKey(r));
    if (r.result == null) { pending++; continue; }
    if (r.result === "W") wins++;
    else if (r.result === "L") losses++;
    else pushes++;
    if (r.pnl_per_dollar == null) { unscored++; continue; }
    scored++;
    units += r.pnl_per_dollar;
  }
  return {
    n: rows.length,
    wins, losses, pushes, pending, unscored, scored,
    units,
    roi: scored > 0 ? units / scored : null,
    ladders: ladders.size,
  };
}

/* -------------------------------------------------------- the calibration */

/** A bucket under this many settled rows is drawn muted and labelled. */
export const UNDERPOWERED = 20;

export type CalibrationBucket = {
  /** 0 = 0–10%, 9 = 90–100%. */
  index: number;
  lo: number;
  hi: number;
  /** Bucket midpoint, in percent — where the dot sits on the x-axis. */
  mid: number;
  /** Mean of our probability across the bucket's rows, in percent. */
  said: number | null;
  /** Realised hit rate, in percent. Pushes count as half a win. */
  hit: number | null;
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  underpowered: boolean;
};

/**
 * Our probability of the SHOWN side, bucketed in tens, against what actually
 * happened. Only SETTLED rows enter — a pending bet has no hit rate — and a
 * push counts as half a win, which is the only treatment that leaves a
 * perfectly-calibrated book on the diagonal.
 */
export function calibration(rows: RecordRow[]): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = Array.from({ length: 10 }, (_, i) => ({
    index: i, lo: i * 10, hi: i * 10 + 10, mid: i * 10 + 5,
    said: null, hit: null, n: 0, wins: 0, losses: 0, pushes: 0, underpowered: true,
  }));
  const sums = new Array(10).fill(0);
  for (const r of rows) {
    if (r.result == null) continue;
    const i = Math.min(9, Math.max(0, Math.floor(r.pShown * 10)));
    const b = buckets[i];
    b.n++;
    sums[i] += r.pShown;
    if (r.result === "W") b.wins++;
    else if (r.result === "L") b.losses++;
    else b.pushes++;
  }
  for (const b of buckets) {
    if (!b.n) continue;
    b.said = (sums[b.index] / b.n) * 100;
    b.hit = ((b.wins + b.pushes / 2) / b.n) * 100;
    b.underpowered = b.n < UNDERPOWERED;
  }
  return buckets;
}

/** Rows in a bucket, weighted mean miss (realised − said) in percentage points. */
export function calibrationMiss(buckets: CalibrationBucket[]): { miss: number; n: number } | null {
  let n = 0, acc = 0;
  for (const b of buckets) {
    if (!b.n || b.said == null || b.hit == null) continue;
    n += b.n;
    acc += (b.hit - b.said) * b.n;
  }
  return n ? { miss: acc / n, n } : null;
}

/* ---------------------------------------------------------------- filters */

export type RecordFilters = {
  family: "all" | RecordFamily;
  market: string;      // "all" or a base market key
  period: string;      // "all" or a period key ("" = full game)
  ev: EvMode;
  rung: RungMode;
  week: "all" | number;
  team: string;        // "all" or a school name
  conference: string;  // "all" or a conference name
  band: string;        // "all" | "0-20" | "20-40" | "40-60" | "60-80" | "80-100"
  q: string;
};

export const PRICE_BANDS: { key: string; label: string; lo: number; hi: number }[] = [
  // The site's standing no-tails rule, and the page's default: tails at a
  // few cents turn a flat 1u stake into 30u swings and drown the record.
  { key: "10-90", label: "10–90¢ (no tails)", lo: 0.10, hi: 0.90 },
  { key: "0-20", label: "under 20¢", lo: 0, hi: 0.2 },
  { key: "20-40", label: "20–40¢", lo: 0.2, hi: 0.4 },
  { key: "40-60", label: "40–60¢", lo: 0.4, hi: 0.6 },
  { key: "60-80", label: "60–80¢", lo: 0.6, hi: 0.8 },
  { key: "80-100", label: "80¢ and up", lo: 0.8, hi: 1.01 },
];

/**
 * Apply every filter EXCEPT the rung mode, which selects one row per ladder
 * and therefore has to run last (a ladder whose best rung was filtered out by
 * price band must not silently promote a different rung into "best").
 */
export function applyFilters(rows: RecordRow[], f: RecordFilters, confOf: (team: string) => string): RecordRow[] {
  const band = PRICE_BANDS.find((b) => b.key === f.band);
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.family !== "all" && r.family !== f.family) return false;
    if (f.market !== "all" && baseMarket(r.market) !== f.market) return false;
    if (f.period !== "all" && periodOf(r.market) !== f.period) return false;
    if (f.week !== "all" && r.week !== f.week) return false;
    if (f.ev === "pos" && !((r.ev_publish ?? -1) > 0)) return false;
    if (f.ev === "star" && !r.starred) return false;
    if (band && !(r.price_publish >= band.lo && r.price_publish < band.hi)) return false;
    if (f.team !== "all" && r.home !== f.team && r.away !== f.team && r.subject !== f.team) return false;
    if (f.conference !== "all") {
      const teams = r.subject ? [r.subject] : [r.home, r.away];
      if (!teams.some((t) => confOf(t) === f.conference)) return false;
    }
    if (q) {
      const hay = `${r.rung_label} ${r.home} ${r.away} ${r.subject ?? ""} ${marketWords(r.market)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** One row per ladder in "main"/"best" mode; every rung in "all". */
export function applyRung(rows: RecordRow[], mode: RungMode): RecordRow[] {
  if (mode === "all") return rows;
  const flagged = rows.filter((r) => (mode === "main" ? r.is_main : r.best_on_ladder));
  // A ladder whose flagged rung was filtered away still deserves a row, so
  // fall back to the closest thing this selection has: nearest 50c for "main",
  // best published EV for "best". Without this, a price-band filter would make
  // whole ladders vanish from the record instead of narrowing them.
  const have = new Set(flagged.map(ladderKey));
  const byLadder = new Map<string, RecordRow>();
  for (const r of rows) {
    const key = ladderKey(r);
    if (have.has(key)) continue;
    const cur = byLadder.get(key);
    if (!cur) { byLadder.set(key, r); continue; }
    const better = mode === "main"
      ? Math.abs(r.price_publish - 0.5) < Math.abs(cur.price_publish - 0.5)
      : (r.ev_publish ?? -99) > (cur.ev_publish ?? -99);
    if (better) byLadder.set(key, r);
  }
  return [...flagged, ...byLadder.values()];
}

/**
 * Every rung of one ladder, dearest first — what an expanded row shows.
 *
 * Reads the WHOLE published week, never the filtered selection: the point of
 * opening a row is to see the entire ladder the shown rung came from, and a
 * price-band filter must not amputate it. Scoped by week as well as ladder id
 * because nothing promises the exporter's ids are unique across weeks.
 */
export function ladderOf(rows: RecordRow[], ladderId: string, week?: number): RecordRow[] {
  return rows
    .filter((r) => r.ladder_id === ladderId && (week === undefined || r.week === week))
    .sort((a, b) => (b.price_publish - a.price_publish) || a.rung_label.localeCompare(b.rung_label));
}

/** Per-week units + the running total, for the line across weeks. */
export type WeekPoint = { week: number; units: number; cum: number; scored: number; pending: number };

export function weekLine(rows: RecordRow[]): WeekPoint[] {
  const by = new Map<number, { units: number; scored: number; pending: number }>();
  for (const r of rows) {
    const cell = by.get(r.week) ?? { units: 0, scored: 0, pending: 0 };
    if (r.result == null) cell.pending++;
    else if (r.pnl_per_dollar != null) { cell.units += r.pnl_per_dollar; cell.scored++; }
    by.set(r.week, cell);
  }
  let cum = 0;
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, c]) => {
      cum += c.units;
      return { week, units: c.units, cum, scored: c.scored, pending: c.pending };
    });
}
