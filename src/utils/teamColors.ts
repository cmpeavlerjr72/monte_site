// src/utils/teamColors.ts
//
// Team identity colours, and the theme-aware resolver every consumer paints
// with.
//
// ---------------------------------------------------------------------------
// WHY A RESOLVER AT ALL
// ---------------------------------------------------------------------------
// School colours were chosen for helmets and white paper, not for a #161b22
// card. A slate full of navy-primary teams (Air Force #004a7b, Ole Miss
// #13294b, Georgetown #110e42) paints chart fills, spread halves and coloured
// team names that are effectively invisible in dark mode — the bar is there,
// the reader cannot see where it ends.
//
// The fix is NOT a blanket "swap to the alternate in dark". That would throw
// away identity for every team whose primary is perfectly readable. It is a
// CONTRAST GATE: keep the primary wherever it clears the floor, and only reach
// for something else when it does not. In light mode that keeps 237 of 262
// schools on their primary; in dark mode the gate genuinely bites, because a
// dark card is a hostile background for the saturated navies and maroons that
// half of college football wears.
//
// ---------------------------------------------------------------------------
// THE POLICY (in `resolveDisplayColor`)
// ---------------------------------------------------------------------------
//   1. primary, if it clears CONTRAST_FLOOR against the theme's card colour.
//   2. else, if the primary is an actual COLOUR (see `isChromatic`), the
//      primary with its LIGHTNESS moved — up in dark, down in light — until it
//      clears. Hue and saturation are untouched, so navy becomes a readable
//      steel-navy and cardinal a readable cardinal.
//   3. else the primary is a neutral (the black-and-gold schools), where a
//      lightness lift could only produce grey. Reach for the school's OTHER
//      colour instead — the CSV's AlternateColor — clearing the floor on its
//      own or lifted the same way.
//   4. else there is nothing chromatic to work with (a black school with no
//      alternate). Lift the primary and accept the grey: that IS the school's
//      colour, and inventing a hue would be worse.
//
// The neutral test is what keeps the page from turning white. 160 schools list
// #ffffff (or a near-white/near-black) as their alternate, and "every navy
// team is now white" is identity loss dressed up as contrast.
//
// ---------------------------------------------------------------------------
// WHY LIFT BEFORE REACHING FOR THE ALTERNATE  (deviates from the brief; 08-28)
// ---------------------------------------------------------------------------
// The instruction was alternate-first, lift only if BOTH fail. Built that way
// first, it broke the board — measured, not guessed, on the real wk0 + FCS
// slates (54 games) with CIE76 ΔE between the two teams of each matchup:
//
//                        matchups with ΔE < 20      teams keeping their own hue
//   alternate-first        7 / 52  in dark               171 / 262
//   lift-first             3 / 52  in dark               260 / 262
//
// and the same 22 neutral schools end up desaturated either way, so the
// "never grey" constraint costs nothing here.
//
// The 4 extra collisions are the tell. College football's ALTERNATES cluster
// hard on gold/orange/white while its primaries are spread across the wheel,
// so sending every illegible team to its alternate pushes both sides of a
// matchup onto the same peg. It shipped USC #ffcc00 against San José State
// #fdba31 — a win-prob bar that reads as one continuous gold with no visible
// split, on a card whose whole job is showing WHERE the split is. Virginia vs
// NC State (orange/red), Alabama State vs Southern (two golds) and Howard vs
// Alabama A&M did the same. Every one of those pairs is perfectly separable in
// LIGHT mode, so the collision was manufactured by the resolver, not by the
// schools. Lift-first's remaining 3 collisions all also collide in light: those
// teams genuinely wear the same colour, and no per-team function can fix that.
//
// Lifting first also keeps a team the SAME HUE in both themes (260/262 vs
// 171/262), so flipping the theme no longer turns Auburn from navy to orange.
//
// This is one ordering swap and it is reversible: move the isChromatic(primary)
// branch below the secondary branch to get the briefed behaviour back.
//
// Pure and deterministic: same (team, isDark) always yields the same hex, with
// no DOM read anywhere in here. `isDark` comes from `useIsDark()`
// (src/lib/usePrefs.ts), which resolves data-theme / prefers-color-scheme once
// and re-renders on a flip.
//
// Guarded by `scripts/check_team_colors.mjs`, which runs this resolver over
// EVERY school in the CSV in BOTH themes and fails if any returned colour
// misses the floor — so a future CSV edit cannot silently re-introduce an
// invisible team.

import * as Papa from "papaparse";
// Vite: ?raw imports the file contents at build time
import teamInfoRaw from "../assets/team_info.csv?raw";

export type TeamColor = { primary: string; secondary?: string };

const cache: Record<string, TeamColor> = {};
/** key -> the CSV's own spelling, so the check script can name a failure. */
const names: Record<string, string> = {};
let loaded = false;

function norm(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function toHex(x: any) {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(t)) return undefined;
  return t.startsWith("#") ? t : `#${t}`;
}

function loadOnce() {
  if (loaded) return;
  const { data } = Papa.parse(teamInfoRaw, { header: true, dynamicTyping: false, skipEmptyLines: true });
  for (const row of (data as any[])) {
    if (!row) continue;
    const name =
      row.team ?? row.Team ?? row.school ?? row.School ?? row.name ?? row.Name;
    const p =
      row.primary ?? row.Primary ?? row.primary_color ?? row.color ?? row.Color ?? row.Hex ?? row.hex ?? row.hex_primary;
    // `AlternateColor` is the column the shipped CSV actually uses. It was
    // missing from this list, which is why `secondary` was undefined for every
    // team — harmless while nothing read it, fatal for the resolver's step 2.
    const s =
      row.secondary ?? row.Secondary ?? row.secondary_color ?? row.AlternateColor ?? row.alternateColor ??
      row.alternate_color ?? row.Color2 ?? row.color2 ?? row.hex_secondary ?? row.Hex2;
    if (!name) continue;
    const key = norm(String(name));
    const primary = toHex(p);
    const secondary = toHex(s);
    if (primary) { cache[key] = { primary, secondary }; names[key] = String(name); }
  }
  loaded = true;
}

export function getTeamColors(teamName: string | undefined | null): TeamColor | undefined {
  if (!teamName) return undefined;
  loadOnce();
  return cache[norm(teamName)];
}

/* =========================================================================
   Contrast machinery
   ========================================================================= */

/**
 * The card surface each theme paints team colour ON TOP OF.
 *
 * SOURCE: `--card` in src/theme.css — `:root { --card: #ffffff }` for light,
 * and the dark value shared by `@media (prefers-color-scheme: dark)
 * :root:not([data-theme="light"])` and `:root[data-theme="dark"]`.
 *
 * Hardcoded (rather than read off the computed style) on purpose: the resolver
 * must be pure so the same call gives the same hex in a component, in a memo,
 * and in the node check script, which has no DOM at all. If theme.css ever
 * changes `--card`, change it here in the same commit — the check script
 * compares against these same two values, so it will not catch a drift.
 */
export const CARD_BG = { light: "#ffffff", dark: "#161b22" } as const;

/**
 * WCAG 1.4.11 non-text contrast: 3:1 is the floor for a "graphical object"
 * whose shape carries meaning — which is exactly what a bar fill, a spread
 * half, a field strip and a swatch are. It is also the large-text floor, and
 * every place these colours become type they are bold or big.
 */
export const CONTRAST_FLOOR = 3;

function channels(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

type Hsl = { h: number; s: number; l: number };

function toHsl(hex: string): Hsl {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hp) % 6;
  const rgb: [number, number, number] =
    seg === 0 ? [c, x, 0] :
    seg === 1 ? [x, c, 0] :
    seg === 2 ? [0, c, x] :
    seg === 3 ? [0, x, c] :
    seg === 4 ? [x, 0, c] :
                [c, 0, x];
  const f = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, "0");
  return `#${f(rgb[0])}${f(rgb[1])}${f(rgb[2])}`;
}

/**
 * Is this an actual team COLOUR, or a neutral standing in for one?
 *
 * White, black, off-white and the various #231f20 "black"s are legitimate CSV
 * entries but useless as identity: a board where every navy school renders
 * white tells the reader nothing. Only a chromatic alternate is allowed to
 * replace a primary; a neutral one sends the resolver to step 3 instead, where
 * the school's real colour is lightened.
 */
function isChromatic(hex: string): boolean {
  const { s, l } = toHsl(hex);
  return s >= 0.18 && l > 0.1 && l < 0.94;
}

/**
 * Move lightness (only) until the colour clears the floor. Up in dark, down in
 * light — the only direction that can help, since against #161b22 the sole way
 * to fail is being too dark and against #ffffff the sole way is being too
 * light. 1% steps, taking the FIRST value that clears, so the colour travels
 * the minimum distance from the school's own hex.
 *
 * Terminates: white clears 17:1 on the dark card, black clears 21:1 on the
 * light one.
 */
function liftToFloor(hex: string, isDark: boolean): string {
  const bg = isDark ? CARD_BG.dark : CARD_BG.light;
  const { h, s, l } = toHsl(hex);
  for (let i = 0; i <= 100; i++) {
    const nl = isDark ? Math.min(1, l + i / 100) : Math.max(0, l - i / 100);
    const c = fromHsl({ h, s, l: nl });
    if (contrastRatio(c, bg) >= CONTRAST_FLOOR) return c;
    if (nl === 0 || nl === 1) break;
  }
  return isDark ? "#ffffff" : "#000000";
}

const displayCache = new Map<string, string>();

/**
 * The colour to actually paint for `team` under the current theme. Pure: same
 * (team, isDark) in, same hex out, no DOM.
 *
 * Returns undefined for an unknown team, so every existing
 * `?? "var(--brand)"` fallback at the call sites still works.
 */
export function displayTeamColor(
  team: string | undefined | null,
  isDark: boolean,
): string | undefined {
  const base = getTeamColors(team);
  if (!base) return undefined;
  const ck = `${norm(String(team))}|${isDark ? "d" : "l"}`;
  const hit = displayCache.get(ck);
  if (hit) return hit;
  const out = resolveDisplayColor(base, isDark);
  displayCache.set(ck, out);
  return out;
}

/** The policy itself, split out so the check script can drive it from raw hexes. */
export function resolveDisplayColor(base: TeamColor, isDark: boolean): string {
  const bg = isDark ? CARD_BG.dark : CARD_BG.light;
  const { primary, secondary } = base;

  // 1. Primary wins whenever it is legible. A readable mid-blue stays that
  //    mid-blue in BOTH themes.
  if (contrastRatio(primary, bg) >= CONTRAST_FLOOR) return primary;

  // 2. Illegible but chromatic: keep the hue, move the lightness. This is the
  //    branch that keeps 260/262 schools on their own hue — see the header for
  //    why it sits ABOVE the alternate rather than below it.
  if (isChromatic(primary)) return liftToFloor(primary, isDark);

  // 3. The primary is a neutral (black, near-black, off-white), where a lift
  //    could only make grey. The school's OTHER colour is the way to stay a
  //    colour at all: its gold, taken as-is if it clears, lifted if it does not.
  if (secondary && isChromatic(secondary)) {
    return contrastRatio(secondary, bg) >= CONTRAST_FLOOR ? secondary : liftToFloor(secondary, isDark);
  }

  // 4. Nothing chromatic anywhere — a black school with no alternate. Lift the
  //    primary and let it be grey; that is the colour they actually wear.
  return liftToFloor(primary, isDark);
}

/** Every school the CSV gives a usable primary. For the check script. */
export function allTeamColorEntries(): Array<{ key: string; name: string; colors: TeamColor }> {
  loadOnce();
  return Object.entries(cache).map(([key, colors]) => ({ key, name: names[key] ?? key, colors }));
}
