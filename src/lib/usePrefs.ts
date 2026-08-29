// Viewer preferences: colour theme, card density, and division filter.
//
// Both are per-viewer conveniences, so they live in localStorage — which can
// throw outright (private windows, browsers set to block site data) rather
// than merely returning null. Every access is wrapped; a failure degrades to
// the default instead of taking the page down.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { DivisionFilter } from "./cfbData";

export type ThemeMode = "system" | "light" | "dark";
export type Density = "comfortable" | "condensed";

const THEME_KEY = "cfb.theme";
const DENSITY_KEY = "cfb.density";
const DIVISION_KEY = "cfb.division";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the choice simply will not persist */
  }
}

/**
 * Applies the theme to <html>. "system" removes the attribute entirely so the
 * prefers-color-scheme media query in theme.css takes over again.
 */
function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

/* ==========================================================================
   The EFFECTIVE theme, as a subscribable store
   --------------------------------------------------------------------------
   Team colours are resolved in JS, not CSS (see src/utils/teamColors.ts), so
   something has to tell a component which theme it is painting into. That
   answer has two independent sources of truth and BOTH can change while the
   page is open:

     - an explicit choice, stamped as data-theme="light|dark" on <html>, which
       wins outright; and
     - the OS setting, which is what "system" (no attribute) follows — and
       which flips on its own at sunset.

   So this is a store, not a one-shot read: `useIsDark()` re-renders on either
   event. Components read it ONCE at the top and pass the boolean down through
   the colour closures; nothing reads the DOM inside a render loop.
   ========================================================================== */

/** The live answer. Explicit attribute wins; otherwise the OS. */
export function resolveIsDark(): boolean {
  if (typeof document === "undefined") return false;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Fires on an OS flip AND on our own data-theme stamp. */
function subscribeTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const cleanups: Array<() => void> = [];

  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // addEventListener is not universal on MediaQueryList (older Safari);
    // fall back rather than throw and take the page down.
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      cleanups.push(() => mq.removeEventListener("change", onChange));
    } else if (typeof (mq as any).addListener === "function") {
      (mq as any).addListener(onChange);
      cleanups.push(() => (mq as any).removeListener(onChange));
    }
  }

  if (typeof MutationObserver === "function" && typeof document !== "undefined") {
    const mo = new MutationObserver(onChange);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    cleanups.push(() => mo.disconnect());
  }

  return () => cleanups.forEach((fn) => fn());
}

/**
 * Is the page dark RIGHT NOW? Feed this to `displayTeamColor(team, isDark)`.
 * getSnapshot returns a boolean, so React's identity check is by value and
 * this cannot loop.
 */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeTheme, resolveIsDark, () => false);
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const v = typeof window === "undefined" ? null : readStored(THEME_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  });

  useEffect(() => {
    applyTheme(mode);
    writeStored(THEME_KEY, mode);
  }, [mode]);

  /** What the page is actually showing right now, resolving "system".
   *  Reads the store so an OS flip under "system" re-renders the consumer
   *  instead of leaving a stale label behind. */
  const isDark = useIsDark();
  const resolved: "light" | "dark" = mode !== "system" ? mode : isDark ? "dark" : "light";

  // Cycle light -> dark -> system so a viewer can always get back to the OS.
  const cycle = useCallback(() => {
    setMode((m) => (m === "system" ? "dark" : m === "dark" ? "light" : "system"));
  }, []);

  return { mode, resolved, setMode, cycle };
}

/**
 * Which division(s) the scoreboard shows. Same storage discipline as the
 * others: a blocked-storage browser silently gets the default.
 *
 * Defaults to "fbs" rather than "both" — a returning viewer who has never
 * touched the control should see the slate they saw last week, and until the
 * FCS dataset publishes "both" would look identical to "fbs" anyway.
 */
export function useDivisionFilter() {
  const [division, setDivision] = useState<DivisionFilter>(() => {
    const v = typeof window === "undefined" ? null : readStored(DIVISION_KEY);
    return v === "fcs" || v === "both" || v === "fbs" ? v : "fbs";
  });

  useEffect(() => { writeStored(DIVISION_KEY, division); }, [division]);

  return { division, setDivision };
}

export function useDensity() {
  const [density, setDensity] = useState<Density>(() => {
    const v = typeof window === "undefined" ? null : readStored(DENSITY_KEY);
    return v === "condensed" ? "condensed" : "comfortable";
  });

  useEffect(() => { writeStored(DENSITY_KEY, density); }, [density]);

  const toggle = useCallback(() => {
    setDensity((d) => (d === "comfortable" ? "condensed" : "comfortable"));
  }, []);

  return { density, setDensity, toggle };
}
