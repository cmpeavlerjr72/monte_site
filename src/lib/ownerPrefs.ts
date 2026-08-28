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

/** "edge" = best net edge first; "soon" = earliest kickoff first. */
export type SuggestSort = "edge" | "soon";
const SORT_KEY = "cfb.suggestedBets.sort";
export function readSuggestSort(): SuggestSort {
  return read(SORT_KEY) === "soon" ? "soon" : "edge";
}
export const writeSuggestSort = (v: SuggestSort): void => write(SORT_KEY, v);
