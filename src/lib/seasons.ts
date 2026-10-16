// src/lib/seasons.ts: WHEN seasonal pages are live (2026-10-16).
//
// Stale pages hide until they are in season, so a first-time visitor never
// lands on last year's bracket presented as current. One table, read by the
// header (nav entries) and by the routes (an off-season page says when it is
// back instead of rendering an old bracket). Dates are America/New_York
// calendar days; update them once a year.
//
// `?season=open` on any URL forces every gate open, so the owner can check a
// gated page before its date.

export type SeasonGate = { opens: string; label: string };

export const GATES = {
  /** CFP selection day: the bracket page is useful from the reveal on. */
  cfbBracket: { opens: "2026-12-06", label: "Selection Sunday, Dec 6" },
  /** NCAA tournament Selection Sunday 2027. */
  cbbBracket: { opens: "2027-03-14", label: "Selection Sunday, March 14" },
  /** First day of the 2026-27 college basketball season. */
  cbbSeason: { opens: "2026-11-03", label: "Nov 3" },
} as const satisfies Record<string, SeasonGate>;

/** Today's calendar date in America/New_York, as YYYY-MM-DD. */
export function todayET(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
  } catch {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }
}

function forcedOpen(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("season") === "open";
  } catch {
    return false;
  }
}

export function isOpen(gate: SeasonGate, now: Date = new Date()): boolean {
  return forcedOpen() || todayET(now) >= gate.opens;
}
