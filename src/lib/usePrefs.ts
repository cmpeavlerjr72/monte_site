// Viewer preferences: colour theme and card density.
//
// Both are per-viewer conveniences, so they live in localStorage — which can
// throw outright (private windows, browsers set to block site data) rather
// than merely returning null. Every access is wrapped; a failure degrades to
// the default instead of taking the page down.

import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type Density = "comfortable" | "condensed";

const THEME_KEY = "cfb.theme";
const DENSITY_KEY = "cfb.density";

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

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const v = typeof window === "undefined" ? null : readStored(THEME_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  });

  useEffect(() => {
    applyTheme(mode);
    writeStored(THEME_KEY, mode);
  }, [mode]);

  /** What the page is actually showing right now, resolving "system". */
  const resolved: "light" | "dark" =
    mode !== "system"
      ? mode
      : typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  // Cycle light -> dark -> system so a viewer can always get back to the OS.
  const cycle = useCallback(() => {
    setMode((m) => (m === "system" ? "dark" : m === "dark" ? "light" : "system"));
  }, []);

  return { mode, resolved, setMode, cycle };
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
