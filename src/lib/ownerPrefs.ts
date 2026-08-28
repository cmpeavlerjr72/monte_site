// src/lib/ownerPrefs.ts
//
// Per-browser preferences for the owner console (the "My Book" block). All
// storage access is guarded the usePrefs way: a failure degrades to the
// default, never a crash — private windows, cleared site data and
// storage-blocking browsers all just get the default.
//
// These are CONVENIENCES, not state anything depends on. The one that spends
// money — unit size — is re-clamped on every read, so a hand-edited
// localStorage value cannot widen the sizing beyond the bounds below.

const read = (key: string): string => {
  try { return window.localStorage.getItem(key) || ""; } catch { return ""; }
};
const write = (key: string, v: string): void => {
  try { window.localStorage.setItem(key, v); } catch { /* not persisted */ }
};

/* -------------------------------- unit size ------------------------------- */
/** Dollars of risk per ladder. Was a hardcoded 30; now the user's knob.
 *
 *  SEPARATE from the sim repo's maker pipeline, which keeps its own
 *  CLI-configured `--ladder-risk`. Two knobs on purpose: the pipeline sizes an
 *  unattended overnight book, this sizes what a human presses Place on. */
export const UNIT_DEFAULT = 30;
export const UNIT_MIN = 1;
export const UNIT_MAX = 500;
const UNIT_KEY = "cfb.unitSize";

/** Always inside [UNIT_MIN, UNIT_MAX]; NaN and junk fall back to the default. */
export function clampUnit(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return UNIT_DEFAULT;
  return Math.min(UNIT_MAX, Math.max(UNIT_MIN, n));
}
export function readUnit(): number {
  const raw = read(UNIT_KEY);
  return raw ? clampUnit(raw) : UNIT_DEFAULT;
}
export function writeUnit(v: number): void {
  write(UNIT_KEY, String(clampUnit(v)));
}

/* ------------------------- suggested-bets card state ---------------------- */
/** Starts COLLAPSED: a dense list, low on the page, that now carries the
 *  money buttons. */
const OPEN_KEY = "cfb.suggestedBets.open";
export const readCardOpen = (): boolean => read(OPEN_KEY) === "1";
export const writeCardOpen = (v: boolean): void => write(OPEN_KEY, v ? "1" : "0");

/** Execution-mode filter. "all" | "rest" (maker) | "take" (taker). */
export type ModeFilter = "all" | "rest" | "take";
const FILTER_KEY = "cfb.suggestedBets.mode";
export function readModeFilter(): ModeFilter {
  const v = read(FILTER_KEY);
  return v === "rest" || v === "take" ? v : "all";
}
export const writeModeFilter = (v: ModeFilter): void => write(FILTER_KEY, v);

/** Bet-TYPE filter, second filter row. "all" | "game" (lines) | "td" (props)
 *  | "yardage" | "team" (totals + receptions/rush-att/sacks/INTs). */
export type BetTypeFilter = "all" | "game" | "td" | "yardage" | "team";
const TYPE_FILTER_KEY = "cfb.suggestedBets.type";
export function readTypeFilter(): BetTypeFilter {
  const v = read(TYPE_FILTER_KEY);
  return v === "game" || v === "td" || v === "yardage" || v === "team" ? v : "all";
}
export const writeTypeFilter = (v: BetTypeFilter): void => write(TYPE_FILTER_KEY, v);

/** Reveal the TAIL band's held-out markets (see suggestedBets.ts: sim OR ask
 *  outside 20–80¢, where the engine is least trusted and thin books misprice
 *  hardest). DEFAULT OFF — the whole point of the band is that those rows are
 *  not ranked with the rest. On, they render muted and badged. */
const TAILS_KEY = "cfb.suggestedBets.showTails";
export const readShowTails = (): boolean => read(TAILS_KEY) === "1";
export const writeShowTails = (v: boolean): void => write(TAILS_KEY, v ? "1" : "0");

/* -------------------------- the "My games" tray --------------------------- */
/**
 * Whether the tray of games the owner already has money on is expanded.
 *
 * DEFAULT OPEN, unlike the suggestions card above. The tray REMOVES its games
 * from the main grid in both states, so a default-collapsed tray would make
 * cards vanish from the board on first load with no press to explain it. Open
 * by default the tray only regroups them; collapsing is the owner's own choice
 * and this remembers it.
 */
const MYGAMES_KEY = "cfb.myGames.open";
export const readMyGamesOpen = (): boolean => read(MYGAMES_KEY) !== "0";
export const writeMyGamesOpen = (v: boolean): void => write(MYGAMES_KEY, v ? "1" : "0");

/** "edge" = best net edge first; "soon" = earliest kickoff first. */
export type SuggestSort = "edge" | "soon";
const SORT_KEY = "cfb.suggestedBets.sort";
export function readSuggestSort(): SuggestSort {
  return read(SORT_KEY) === "soon" ? "soon" : "edge";
}
export const writeSuggestSort = (v: SuggestSort): void => write(SORT_KEY, v);
