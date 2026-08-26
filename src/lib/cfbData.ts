// Runtime loader for archived CFB sim data.
//
// The 2025 season used to live in src/data and was pulled into the bundle with
// import.meta.glob, which made the build ~900MB. It now lives in a Hugging Face
// dataset, fetched on demand.
//
// Requests go through our own origin (/api/data/...) because some networks block
// huggingface.co; the direct Hub URL is only a fallback for deployments that
// serve the static build without the Express server.
//
// One dataset repo per season, same layout in each:
//   <season>/season_index.json
//   <season>/weeks/weekNN/{index.json,scores_bundle.csv,games.csv,open.csv,...}
// Season "2025" -> repo cfb-sims-2025, season "2026" -> repo cfb-sims-2026.
//
// Every exported function takes `season` as an OPTIONAL LAST argument that
// defaults to DEFAULT_SEASON, so pages that have not been season-aware'd yet
// keep their existing behavior unchanged.

/**
 * Seasons the UI offers, newest first.
 *
 * FBS ONLY, deliberately. This array feeds the season picker AND
 * resolveLatestSeason(), so adding the FCS namespace here would put
 * "fcs-2026" in the dropdown and let a cold load land the whole page on the
 * FCS dataset. FCS is a DIVISION, not a season — see `namespaceFor` below.
 */
export const SEASONS = ["2026", "2025"] as const;

/**
 * A dataset namespace, not necessarily a year.
 *
 * Every fetch in this file keys off it: repoForSeason("fcs-2026") is
 * cfb-sims-fcs-2026 and the root directory is "fcs-2026", which is exactly
 * how the FCS dataset is laid out. That is why the FCS slate needed zero
 * changes below this point.
 */
export type Season = string;

/** What an un-parameterized getCatalog() call resolves to. */
export const DEFAULT_SEASON: Season = "2025";

/* --------------------------------- division -------------------------------
 * FBS and FCS are published as two separate datasets with an identical
 * layout. The scoreboard can show either or both, so the division travels
 * with each GAME (a merged "Both" slate holds cards from both namespaces),
 * never as a second page-level season.
 * ------------------------------------------------------------------------ */

/** What the scoreboard's division selector can be set to. */
export type DivisionFilter = "fbs" | "fcs" | "both";

/** Which dataset a single game came from. */
export type Division = "fbs" | "fcs";

/** Seasons for which an FCS dataset exists. Kept apart from SEASONS. */
export const FCS_SEASONS: readonly string[] = ["2026"];

/** Dataset namespace for a division + season year. */
export function namespaceFor(division: Division, season: Season): Season {
  return division === "fcs" ? `fcs-${season}` : String(season);
}

/** True when this season has an FCS dataset to offer at all. */
export const fcsAvailableFor = (season: Season): boolean =>
  FCS_SEASONS.includes(String(season));

const repoForSeason = (season: Season) => `cfb-sims-${season}`;
const proxyBase = (season: Season) =>
  `/api/data/${repoForSeason(season)}/${season}`;
const hubBase = (season: Season) =>
  `https://huggingface.co/datasets/mvpeav/${repoForSeason(season)}/resolve/main/${season}`;

export type WeekMeta = {
  /** Directory name in the dataset, e.g. "week05". */
  id: string;
  /** Numeric week, e.g. 5. */
  week: number;
  /** Display label, e.g. "Week 14 (Rivalry Week)". */
  label: string;
  /**
   * The lowercased folder name the old glob-based code produced, e.g.
   * "week14 (rivalry week)". Pages key off this and it appears in ?week=
   * deep links, so it must stay stable.
   */
  legacyKey: string;
  nGames: number;
  hasOpen: boolean;
};

/** Matches the shape the pages' existing CSV parsers accept. */
export type FileItem = { week: string; file: string; url: string };

export type GameMeta = {
  slug: string;
  teamA: string | null;
  teamB: string | null;
  scores: string | null;
  players: string | null;
};

export type CfbCatalog = {
  /** Which season this catalog describes. */
  season: Season;
  weeks: WeekMeta[];
  /** One bundled file per week containing every game's score sims. */
  scoreFiles: FileItem[];
  gamesFiles: FileItem[];
  openFiles: FileItem[];
  /** games.csv + open.csv, for pages that globbed both. */
  gamesAndOpenFiles: FileItem[];
};

/** Per-season memo of which origin answered (proxy preferred, hub fallback). */
const baseBySeason = new Map<Season, string>();
/** Per-season catalog promise. Cleared on failure so a remount can retry. */
const catalogBySeason = new Map<Season, Promise<CfbCatalog>>();
/** Week index promises, keyed "<season>/<weekId>". */
const weekIndexCache = new Map<string, Promise<GameMeta[]>>();

/**
 * Thrown when neither origin can serve a namespace at all — which for a
 * not-yet-published dataset (FCS before its first upload) is the EXPECTED
 * answer, not a fault. Typed so callers can tell "not published yet" apart
 * from a genuine network failure and stay quiet about the former.
 */
export class DatasetUnavailable extends Error {
  readonly season: Season;
  constructor(season: Season) {
    super(`cfb ${season} dataset unreachable (proxy and hub both failed)`);
    this.name = "DatasetUnavailable";
    this.season = season;
  }
}

/** Resolve which origin serves a season's dataset, preferring our own. */
async function resolveBase(season: Season = DEFAULT_SEASON): Promise<string> {
  const memo = baseBySeason.get(season);
  if (memo) return memo;

  for (const candidate of [proxyBase(season), hubBase(season)]) {
    try {
      const res = await fetch(`${candidate}/season_index.json`, { redirect: "follow" });
      if (res.ok) {
        baseBySeason.set(season, candidate);
        return candidate;
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new DatasetUnavailable(season);
}

export async function dataUrl(
  path: string,
  season: Season = DEFAULT_SEASON
): Promise<string> {
  return `${await resolveBase(season)}/${path}`;
}

/** Two-digit dataset directory id for a week number, e.g. 0 -> "week00". */
const weekDirFromNumber = (n: number) =>
  `week${String(Math.max(0, Math.trunc(n))).padStart(2, "0")}`;

/**
 * Read one entry out of season_index.json.
 *
 * Tolerant on purpose: the 2025 archive carries id/dir/legacy_key explicitly,
 * but a freshly uploaded season may only carry `dir` (or just `week`), and a
 * missing id used to produce a literal "undefined" in every file URL.
 */
function parseWeekEntry(w: any): WeekMeta | null {
  if (!w) return null;

  const weekNum = Number(w.week);
  const dirRaw = String(w.dir ?? "").trim();
  const dirLeaf = dirRaw ? dirRaw.split("/").filter(Boolean).pop() ?? "" : "";

  const id =
    String(w.id ?? "").trim() ||
    dirLeaf ||
    (Number.isFinite(weekNum) ? weekDirFromNumber(weekNum) : "");
  if (!id) return null;

  const week = Number.isFinite(weekNum)
    ? weekNum
    : Number(String(id).replace(/[^0-9]/g, ""));

  const label = String(w.label ?? `Week ${Number.isFinite(week) ? week : id}`);
  // legacy_key is what ?week= deep links carry; fall back to the label the old
  // glob produced ("week5"), then to the directory id.
  const legacyKey = String(
    w.legacy_key ??
      w.legacyKey ??
      (Number.isFinite(week) ? `week${week}` : id)
  ).toLowerCase();

  return {
    id,
    week: Number.isFinite(week) ? week : 0,
    label,
    legacyKey,
    nGames: Number(w.n_games ?? w.nGames ?? 0),
    hasOpen: Boolean(w.has_open ?? w.hasOpen),
  };
}

export async function getCatalog(
  season: Season = DEFAULT_SEASON
): Promise<CfbCatalog> {
  const memo = catalogBySeason.get(season);
  if (memo) return memo;

  const promise = (async () => {
    const root = await resolveBase(season);
    const res = await fetch(`${root}/season_index.json`);
    if (!res.ok) throw new Error(`season_index ${season} ${res.status}`);
    const json = await res.json();

    const weeks: WeekMeta[] = ((json?.weeks ?? []) as any[])
      .map(parseWeekEntry)
      .filter((w): w is WeekMeta => w !== null);

    const scoreFiles: FileItem[] = weeks.map((w) => ({
      week: w.legacyKey,
      file: `${w.id}_scores_bundle.csv`,
      url: `${root}/weeks/${w.id}/scores_bundle.csv`,
    }));
    const gamesFiles: FileItem[] = weeks.map((w) => ({
      week: w.legacyKey,
      file: `${w.id}_games.csv`,
      url: `${root}/weeks/${w.id}/games.csv`,
    }));
    const openFiles: FileItem[] = weeks
      .filter((w) => w.hasOpen)
      .map((w) => ({
        week: w.legacyKey,
        file: `${w.id}_open.csv`,
        url: `${root}/weeks/${w.id}/open.csv`,
      }));

    return {
      season,
      weeks,
      scoreFiles,
      gamesFiles,
      openFiles,
      gamesAndOpenFiles: [...gamesFiles, ...openFiles],
    };
  })().catch((err) => {
    catalogBySeason.delete(season); // let a later mount (or Retry) try again
    baseBySeason.delete(season);
    throw err;
  });

  catalogBySeason.set(season, promise);
  return promise;
}

/** Drop memoized state for a season so the next getCatalog() refetches. */
export function invalidateSeason(season: Season = DEFAULT_SEASON): void {
  catalogBySeason.delete(season);
  baseBySeason.delete(season);
  for (const key of [...weekIndexCache.keys()]) {
    if (key.startsWith(`${season}/`)) weekIndexCache.delete(key);
  }
}

/** The newest week in a catalog (highest week number; ties -> last listed). */
export function latestWeek(catalog: CfbCatalog | null | undefined): WeekMeta | null {
  const weeks = catalog?.weeks ?? [];
  if (!weeks.length) return null;
  return weeks.reduce((best, w) => (w.week >= best.week ? w : best), weeks[0]);
}

/**
 * The newest season whose catalog actually loads, newest-first.
 *
 * 2026 is uploaded in-season; until it lands, its season_index.json is a 404
 * (or a 401 while the repo is still private) and we quietly fall back to 2025.
 */
export async function resolveLatestSeason(
  candidates: readonly Season[] = SEASONS
): Promise<{ season: Season; catalog: CfbCatalog }> {
  let lastErr: unknown = null;
  for (const season of candidates) {
    try {
      const catalog = await getCatalog(season);
      if (catalog.weeks.length) return { season, catalog };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("no cfb season catalog could be loaded");
}

/** Map a legacy week key (or dataset id) to the dataset directory name. */
export async function resolveWeekId(
  weekKey: string,
  season: Season = DEFAULT_SEASON
): Promise<string | null> {
  const { weeks } = await getCatalog(season);
  const k = (weekKey || "").trim().toLowerCase();
  return weeks.find((w) => w.legacyKey === k || w.id === k)?.id ?? null;
}

/** Per-week game list (slugs + team names). Cached per season+week. */
export async function getWeekGames(
  weekKey: string,
  season: Season = DEFAULT_SEASON
): Promise<GameMeta[]> {
  const id = await resolveWeekId(weekKey, season);
  if (!id) return [];
  const cacheKey = `${season}/${id}`;
  const cached = weekIndexCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const root = await resolveBase(season);
    const res = await fetch(`${root}/weeks/${id}/index.json`);
    if (!res.ok) throw new Error(`week index ${season}/${id} ${res.status}`);
    const json = await res.json();
    return (json?.games ?? []) as GameMeta[];
  })().catch((err) => {
    weekIndexCache.delete(cacheKey);
    throw err;
  });

  weekIndexCache.set(cacheKey, promise);
  return promise;
}

/** Every player-sims file for a week. Heavy (~50MB) — prefer playerFileForPair. */
export async function getPlayerFiles(
  weekKey: string,
  season: Season = DEFAULT_SEASON
): Promise<FileItem[]> {
  const id = await resolveWeekId(weekKey, season);
  if (!id) return [];
  const root = await resolveBase(season);
  const games = await getWeekGames(weekKey, season);
  return games
    .filter((g) => g.players)
    .map((g) => ({
      week: weekKey,
      file: `players_${g.slug}.csv`,
      url: `${root}/weeks/${id}/players/${g.slug}.csv`,
    }));
}

const nameKey = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Player sims for a single matchup — one ~1MB fetch instead of a whole week.
 * Team names are matched on the display names stored in the week index.
 */
export async function playerFileForPair(
  weekKey: string,
  teamA: string,
  teamB: string,
  season: Season = DEFAULT_SEASON
): Promise<FileItem | null> {
  const id = await resolveWeekId(weekKey, season);
  if (!id) return null;
  const games = await getWeekGames(weekKey, season);
  const want = [nameKey(teamA), nameKey(teamB)].sort().join("__");

  const hit = games.find((g) => {
    if (!g.players) return false;
    if (g.teamA && g.teamB) {
      if ([nameKey(g.teamA), nameKey(g.teamB)].sort().join("__") === want) return true;
    }
    return g.slug.split("_").sort().join("__") === want;
  });
  if (!hit) return null;

  const root = await resolveBase(season);
  return {
    week: weekKey,
    file: `players_${hit.slug}.csv`,
    url: `${root}/weeks/${id}/players/${hit.slug}.csv`,
  };
}

/** Score sims for a single matchup, when the whole-week bundle is overkill. */
export async function scoreFileForPair(
  weekKey: string,
  teamA: string,
  teamB: string,
  season: Season = DEFAULT_SEASON
): Promise<FileItem | null> {
  const id = await resolveWeekId(weekKey, season);
  if (!id) return null;
  const games = await getWeekGames(weekKey, season);
  const want = [nameKey(teamA), nameKey(teamB)].sort().join("__");
  const hit = games.find(
    (g) =>
      (g.teamA && g.teamB &&
        [nameKey(g.teamA), nameKey(g.teamB)].sort().join("__") === want) ||
      g.slug.split("_").sort().join("__") === want
  );
  if (!hit?.scores) return null;

  const root = await resolveBase(season);
  return {
    week: weekKey,
    file: `scores_${hit.slug}.csv`,
    url: `${root}/weeks/${id}/scores/${hit.slug}.csv`,
  };
}
