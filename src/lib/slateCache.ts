// src/lib/slateCache.ts
//
// THE LAST SLATE THIS BROWSER SAW — slug, matchup words, season and week.
//
// Why it exists: the My Book dashboard (/cfb/mybook) carries the "post a pick"
// form, and a pick needs a GAME (`picks.game_slug` is `not null`). The
// dashboard is not the scoreboard: it loads no week file, and the standing
// rule for this pass is NO new data fetches beyond Supabase and the portal
// payload. So the scoreboard — which already builds exactly this map to name
// its cards — leaves it here on its way past, and the dashboard reads it.
//
// It is a CONVENIENCE, not state anything depends on. Storage is guarded the
// ownerPrefs way: any failure (private window, cleared data, a browser that
// blocks storage) degrades to "no games known", and the form then points at
// the scoreboard instead of pretending to offer a picker. Nothing here is ever
// used to price, size or place a bet.

const KEY = "cfb.lastSlate";
/** A slate older than this is not offered as "the games you can post about" —
 *  a stale week would let someone post a pick on a game that has finished. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type SlateGame = { slug: string; label: string };
export type CachedSlate = { season: number; week: number; at: number; games: SlateGame[] };

/** Cap the write: a full slate is ~60 games and this is a convenience, not a
 *  database. */
const MAX_GAMES = 80;

export function writeSlateGames(season: number, week: number, games: SlateGame[]): void {
  if (!Number.isFinite(season) || !Number.isFinite(week) || !games.length) return;
  const body: CachedSlate = {
    season, week, at: Date.now(), games: games.slice(0, MAX_GAMES),
  };
  try { window.localStorage.setItem(KEY, JSON.stringify(body)); }
  catch { /* the dashboard simply will not offer a picker */ }
}

export function readSlateGames(): CachedSlate | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as CachedSlate;
    if (!b || !Array.isArray(b.games) || !b.games.length) return null;
    if (!Number.isFinite(b.season) || !Number.isFinite(b.week)) return null;
    if (!Number.isFinite(b.at) || Date.now() - b.at > MAX_AGE_MS) return null;
    return b;
  } catch {
    return null;
  }
}
