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

import {
  clampRiskMultiple, MAX_RISK_MULTIPLE_DEFAULT,
  type Sizing, type UnitMode,
} from "./suggestedBets";

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

/* ------------------------------ unit sizing MODE -------------------------- */
/**
 * HOW a unit is spent, beside HOW MUCH (owner ask 2026-09-08). The three
 * definitions and their arithmetic live in ONE place — `sizeContracts` in
 * src/lib/suggestedBets.ts, under "THE UNIT SIZING MODE" — and this file only
 * remembers the choice, next to the unit it modifies.
 *
 *   risk    (DEFAULT) stake a unit, win what the price pays.
 *   to-win  stake enough to NET a unit after the fee.
 *   book    the sportsbook habit: favourites to win a unit, dogs risk a unit.
 *
 * `maxRiskMultiple` is the guard on the two stretch modes: no row may outlay
 * more than this many units, ever. Re-clamped on every read, like the unit
 * itself, so a hand-edited localStorage value cannot widen the sizing.
 */
const UNIT_MODE_KEY = "cfb.unitMode";
export function readUnitMode(): UnitMode {
  const v = read(UNIT_MODE_KEY);
  return v === "to-win" || v === "book" ? v : "risk";
}
export const writeUnitMode = (v: UnitMode): void => write(UNIT_MODE_KEY, v);

const MULTIPLE_KEY = "cfb.unitMaxRiskMultiple";
export function readMaxRiskMultiple(): number {
  const raw = read(MULTIPLE_KEY);
  return raw ? clampRiskMultiple(raw) : MAX_RISK_MULTIPLE_DEFAULT;
}
export const writeMaxRiskMultiple = (v: number): void =>
  write(MULTIPLE_KEY, String(clampRiskMultiple(v)));

/** The whole sizing preference, as the compute wants it. */
export const readSizing = (): Sizing => {
  const mode = readUnitMode();
  return {
    mode,
    // In `risk` mode nothing may stretch, so the guard is 1: that keeps the
    // default path — and the per-order cap it declares below — byte-identical
    // to what shipped before the mode existed.
    maxRiskMultiple: mode === "risk" ? 1 : readMaxRiskMultiple(),
  };
};

/**
 * THE PER-ORDER CAP THIS BROWSER DECLARES, in dollars.
 *
 * The server's rail is `capOrder = clamp(unit_size, 1..500)` per order and
 * 2x that per slip (server/liveScores.ts, ORDERS_CAP_ORDER_MAX). `unit_size`
 * has been the request's DECLARED cap since 2026-08-30 — a preference inside
 * the rail, never a relaxation of it — so a to-win row that legitimately
 * outlays up to maxRiskMultiple units declares that number and anything above
 * it is refused by the server exactly as before. Risk mode declares the bare
 * unit, so its rail is unchanged.
 *
 * TAKES THE LIVE VALUES WHERE THERE ARE ANY. The page holds `unit` and
 * `sizing` in state and the slip sizes its rows off THOSE, so the slip passes
 * them in and the cap it warns about is derived from the same numbers its rows
 * were sized by. Falling back to the stored prefs keeps the callers that have
 * no page state (the Friend Feed's Join, the partial-fill chase, convert)
 * working exactly as before — in the app the two always agree, because
 * Scoreboard writes the prefs in the same setter that moves the state, but
 * "they agree because both read the same key" is a coincidence and this is
 * not.
 */
export const declaredOrderCap = (unit?: number, sizing?: Sizing): number => {
  const s = sizing ?? readSizing();
  const u = typeof unit === "number" && Number.isFinite(unit) ? unit : readUnit();
  return Math.min(UNIT_MAX, Math.max(UNIT_MIN,
    Math.round(clampUnit(u) * clampRiskMultiple(s.maxRiskMultiple))));
};

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

/* --------------------------- week-2 decision rules ------------------------ */
/**
 * The REGIME LABELS on every priced row — R1 mismatch abstentions, the R2
 * moneyline abstention, and the R3/R4 star cells (src/lib/edgeRules.ts).
 *
 * DEFAULT ON (`!== "0"`), because the rules encode a settled week of results
 * and the owner asked for them on this deploy. They are LABELS, never a
 * filter: with them on, an abstained row still renders, still prices and still
 * has a working Place button — it is muted, tagged, and says why on tap.
 *
 * THE KILL SWITCH IS THIS ONE LINE: turn the "Week-2 rules" switch off in the
 * Bets panel (or run `localStorage.setItem("cfb.edgeRules","0")` in the
 * console and reload). Everything reverts to the pre-2026-09-07 star — a
 * non-tail row with net edge ≥ 10¢ — with no abstentions and no cell tags.
 */
const EDGE_RULES_KEY = "cfb.edgeRules";
export const readEdgeRules = (): boolean => read(EDGE_RULES_KEY) !== "0";
export const writeEdgeRules = (v: boolean): void =>
  write(EDGE_RULES_KEY, v ? "1" : "0");

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
