// Runtime loader for archived CFB sim data.
//
// The 2025 season used to live in src/data and was pulled into the bundle with
// import.meta.glob, which made the build ~900MB. It now lives in a Hugging Face
// dataset, fetched on demand.
//
// Requests go through our own origin (/api/data/...) because some networks block
// huggingface.co; the direct Hub URL is only a fallback for deployments that
// serve the static build without the Express server.

const REPO = "cfb-sims-2025";
const SEASON = "2025";

const PROXY_BASE = `/api/data/${REPO}/${SEASON}`;
const HUB_BASE = `https://huggingface.co/datasets/mvpeav/${REPO}/resolve/main/${SEASON}`;

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
  weeks: WeekMeta[];
  /** One bundled file per week containing every game's score sims. */
  scoreFiles: FileItem[];
  gamesFiles: FileItem[];
  openFiles: FileItem[];
  /** games.csv + open.csv, for pages that globbed both. */
  gamesAndOpenFiles: FileItem[];
};

let base: string | null = null;
let catalogPromise: Promise<CfbCatalog> | null = null;
const weekIndexCache = new Map<string, Promise<GameMeta[]>>();

/** Resolve which origin serves the dataset, preferring our own. */
async function resolveBase(): Promise<string> {
  if (base) return base;
  for (const candidate of [PROXY_BASE, HUB_BASE]) {
    try {
      const res = await fetch(`${candidate}/season_index.json`, { redirect: "follow" });
      if (res.ok) {
        base = candidate;
        return base;
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("cfb dataset unreachable (proxy and hub both failed)");
}

export async function dataUrl(path: string): Promise<string> {
  return `${await resolveBase()}/${path}`;
}

export async function getCatalog(): Promise<CfbCatalog> {
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const root = await resolveBase();
    const res = await fetch(`${root}/season_index.json`);
    if (!res.ok) throw new Error(`season_index ${res.status}`);
    const json = await res.json();

    const weeks: WeekMeta[] = (json?.weeks ?? []).map((w: any) => ({
      id: String(w.id),
      week: Number(w.week),
      label: String(w.label),
      legacyKey: String(w.legacy_key ?? w.id),
      nGames: Number(w.n_games ?? 0),
      hasOpen: Boolean(w.has_open),
    }));

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
      weeks,
      scoreFiles,
      gamesFiles,
      openFiles,
      gamesAndOpenFiles: [...gamesFiles, ...openFiles],
    };
  })().catch((err) => {
    catalogPromise = null; // let a later mount retry
    throw err;
  });

  return catalogPromise;
}

/** Map a legacy week key (or dataset id) to the dataset directory name. */
export async function resolveWeekId(weekKey: string): Promise<string | null> {
  const { weeks } = await getCatalog();
  const k = (weekKey || "").trim().toLowerCase();
  return weeks.find((w) => w.legacyKey === k || w.id === k)?.id ?? null;
}

/** Per-week game list (slugs + team names). Cached per week. */
export async function getWeekGames(weekKey: string): Promise<GameMeta[]> {
  const id = await resolveWeekId(weekKey);
  if (!id) return [];
  const cached = weekIndexCache.get(id);
  if (cached) return cached;

  const promise = (async () => {
    const root = await resolveBase();
    const res = await fetch(`${root}/weeks/${id}/index.json`);
    if (!res.ok) throw new Error(`week index ${id} ${res.status}`);
    const json = await res.json();
    return (json?.games ?? []) as GameMeta[];
  })().catch((err) => {
    weekIndexCache.delete(id);
    throw err;
  });

  weekIndexCache.set(id, promise);
  return promise;
}

/** Every player-sims file for a week. Heavy (~50MB) — prefer playerFileForPair. */
export async function getPlayerFiles(weekKey: string): Promise<FileItem[]> {
  const id = await resolveWeekId(weekKey);
  if (!id) return [];
  const root = await resolveBase();
  const games = await getWeekGames(weekKey);
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
  teamB: string
): Promise<FileItem | null> {
  const id = await resolveWeekId(weekKey);
  if (!id) return null;
  const games = await getWeekGames(weekKey);
  const want = [nameKey(teamA), nameKey(teamB)].sort().join("__");

  const hit = games.find((g) => {
    if (!g.players) return false;
    if (g.teamA && g.teamB) {
      if ([nameKey(g.teamA), nameKey(g.teamB)].sort().join("__") === want) return true;
    }
    return g.slug.split("_").sort().join("__") === want;
  });
  if (!hit) return null;

  const root = await resolveBase();
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
  teamB: string
): Promise<FileItem | null> {
  const id = await resolveWeekId(weekKey);
  if (!id) return null;
  const games = await getWeekGames(weekKey);
  const want = [nameKey(teamA), nameKey(teamB)].sort().join("__");
  const hit = games.find(
    (g) =>
      (g.teamA && g.teamB &&
        [nameKey(g.teamA), nameKey(g.teamB)].sort().join("__") === want) ||
      g.slug.split("_").sort().join("__") === want
  );
  if (!hit?.scores) return null;

  const root = await resolveBase();
  return {
    week: weekKey,
    file: `scores_${hit.slug}.csv`,
    url: `${root}/weeks/${id}/scores/${hit.slug}.csv`,
  };
}
