// src/lib/useLiveScoreboard.ts
//
// Live scoreboard payload, BROWSER-DIRECT from ESPN, with the site's own
// /api/scoreboard as a fallback only.
//
// Why direct-first (flipped 2026-08-27, FCS opening night): ESPN's Akamai
// edge began answering the production server's egress IP with "Access
// Denied", so every server-mediated path — the SSE stream and the REST
// fallback — 502'd while 22 games were live. Browsers fetching the same
// URLs are fine (Access-Control-Allow-Origin: * on site.api.espn.com), and
// a viewer's residential IP is not meaningfully blockable. The server hop
// only added a place to fail.
//
// CFB fetches groups 80 and 81 SEPARATELY and merges: ESPN's multi-group
// query (groups=80,81) returns stub events ({} — no id) whenever one group
// has no games that date, i.e. every FCS-only Thursday/Friday. See
// server/liveScores.ts fetchScoreboardMerged for the same workaround
// server-side.
//
// SLATE DATES, not "today" (2026-08-28): the caller passes the slate's game
// dates (one or many). ESPN serves any past date's scoreboard indefinitely
// (finals included — verified back through 2025), so a finished slate keeps
// its scores, grading, and gamecasts the morning after instead of vanishing
// when the wall-clock date rolls over. Multi-date slates walk EACH DATE
// (one fetch per group per date, merged by event id): ESPN's range syntax
// (dates=MIN-MAX) that this hook used through week 2 began answering
// HTTP 400 {"code":400,"message":"Failed to get events endpoint."} on
// 2026-09-17 (Syracuse@Pitt Wednesday night showed no live data); a
// comma list 400s too, and a repeated dates= param honours only the first.
// A single date still covers its full ET day, late kicks included.
// Polling is adaptive: 20s while any game is in progress, 60s pregame, and
// a single fetch — no polling — once every event is final (finals are
// immutable).

import { useEffect, useState } from "react";
import { dataUrl } from "./cfbData";

type SportKey = "cfb" | "cbb" | "mlb";

const SPORT_CFG: Record<SportKey, { base: string; groups: string[]; limit: number }> = {
  cfb: {
    base: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
    groups: ["80", "81"], // FBS, FCS — fetched separately, merged by event id
    limit: 400,
  },
  cbb: {
    base: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
    groups: ["50"], // Men's D-I
    limit: 400,
  },
  mlb: {
    base: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
    groups: [],
    limit: 100,
  },
};

/** Normalize to sorted unique YYYYMMDD strings. Accepts "2026-08-29" forms. */
function normalizeDates(date: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(date) ? date : date ? [date] : [];
  const out = new Set<string>();
  for (const d of raw) {
    const s = String(d).replace(/-/g, "").trim();
    if (/^\d{8}$/.test(s)) out.add(s);
  }
  return [...out].sort();
}

/** Merge payloads into the first one as scaffold, events deduped by id
 *  (drops ESPN's id-less stub events too) and sorted by kick datetime. */
function mergePayloads(payloads: any[]): any | null {
  const good = payloads.filter((p) => p && Array.isArray(p.events));
  if (!good.length) return null;
  const scaffold = good[0];
  if (good.length > 1) {
    const seen = new Set<string>();
    const events: any[] = [];
    for (const p of good) {
      for (const ev of p.events) {
        const id = String(ev?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        events.push(ev);
      }
    }
    events.sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")));
    scaffold.events = events;
  }
  return scaffold;
}

/** One direct walk: one fetch per group per slate date, merged. A slate is
 *  at most a handful of dates (Thu/Fri/Sat, plus the odd Tue/Wed MACtion
 *  or Wednesday ACC kick) × two groups, so the fan-out stays small; the
 *  9-day clamp guards a malformed row from ballooning it. Returns null when
 *  every fetch failed — an empty-but-healthy slate returns a payload with
 *  events: []. */
const MAX_SLATE_DATES = 9;

async function fetchEspnDirect(dates: string[], sport: SportKey): Promise<any | null> {
  const cfg = SPORT_CFG[sport];
  const groupQs = cfg.groups.length ? cfg.groups.map((g) => `&groups=${g}`) : [""];
  const urls = dates
    .slice(0, MAX_SLATE_DATES)
    .flatMap((d) => groupQs.map((gq) => `${cfg.base}?dates=${d}${gq}&limit=${cfg.limit}`));

  const payloads = await Promise.all(
    urls.map((u) =>
      fetch(u, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );

  return mergePayloads(payloads);
}

/** Server fallback: same payload shape, unwrapped from the REST envelope.
 *  /api/scoreboard takes ONE date, so multi-date slates walk each date. */
async function fetchServer(dates: string[], sport: SportKey): Promise<any | null> {
  const payloads = await Promise.all(
    dates.map(async (d) => {
      try {
        const params = new URLSearchParams();
        params.set("date", d);
        params.set("sport", sport);
        const resp = await fetch(`/api/scoreboard?${params.toString()}`, { cache: "no-cache" });
        if (!resp.ok) return null;
        const json = await resp.json();
        return json?.payload ?? json;
      } catch {
        return null;
      }
    })
  );
  return mergePayloads(payloads);
}

/** Published-snapshot fallback for networks that block espn.com outright
 *  (2026-08-28, "work computer" incident: browser-direct AND the Render proxy
 *  are both dead there, so a blocked viewer saw nothing — not even finals).
 *  publish_espn_snapshots.py (sim repo) mirrors the merged scoreboard per
 *  slate date onto the season dataset, which the site serves SAME-ORIGIN via
 *  /api/data. `ns` is the season namespace whose repo holds the snapshots. */
async function fetchSnapshot(dates: string[], ns: string | undefined): Promise<any | null> {
  if (!ns) return null;
  const payloads = await Promise.all(
    dates.map(async (d) => {
      try {
        const url = await dataUrl(`espn/scoreboard/${d}.json`, ns);
        const resp = await fetch(url, { cache: "no-cache" });
        return resp.ok ? await resp.json() : null;
      } catch {
        return null;
      }
    })
  );
  return mergePayloads(payloads);
}

/** True when a payload carries at least one real (id-bearing) event. */
function hasEvents(p: any | null): boolean {
  return !!p && Array.isArray(p.events) && p.events.some((e: any) => e?.id);
}

/** Next poll delay from the payload's event states; null = stop polling. */
function nextDelayMs(payload: any | null): number | null {
  if (!payload) return 30_000; // every tier failed — keep retrying, gently
  const events: any[] = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return 60_000; // empty/transient — recheck slowly
  let anyIn = false;
  let anyPre = false;
  for (const ev of events) {
    const s = String(ev?.status?.type?.state ?? "");
    if (s === "in") anyIn = true;
    else if (s === "pre") anyPre = true;
  }
  if (anyIn) return 20_000;
  if (anyPre) return 60_000;
  return null; // every event final — the payload can't change, stop polling
}

/**
 * Poll ESPN's public scoreboard (direct from the browser), falling back to
 * the /api/scoreboard proxy only when the direct fetch fails outright (e.g.
 * a network that blocks espn.com).
 *
 * @param date  the SLATE's date(s) — "20260829", "2026-08-29", or an array
 *              spanning a multi-day slate. Past dates are served by ESPN
 *              indefinitely, so finished slates stay populated.
 * @param sport "cfb", "cbb", or "mlb" (defaults to "cfb")
 * @param snapshotNs  season namespace whose dataset carries published ESPN
 *              snapshots (`espn/scoreboard/<date>.json`) — the last-resort
 *              tier for networks that block espn.com. Omit to disable.
 */
export function useLiveScoreboard(
  date: string | string[] | null | undefined,
  sport: SportKey = "cfb",
  snapshotNs?: string
) {
  const [payload, setPayload] = useState<any | null>(null);

  // Primitive dependency key: array identity from the caller must not retrigger
  // the effect when the actual dates are unchanged (AGENT_BRIEF rule 4).
  const datesKey = normalizeDates(date).join(",");

  useEffect(() => {
    if (!datesKey) return;
    const dates = datesKey.split(",");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pull() {
      let p = await fetchEspnDirect(dates, sport);
      let fromSnapshot = false;
      // A tier that answers but carries no REAL events must not mask a later
      // tier that has them (found 2026-08-28: a stale server proxy returned a
      // degraded empty payload and starved the snapshot tier). An
      // empty-but-healthy slate still stands when every tier agrees.
      if (!hasEvents(p)) {
        const s = await fetchServer(dates, sport);
        if (s && (hasEvents(s) || !p)) p = s;
      }
      if (!hasEvents(p)) {
        const snap = await fetchSnapshot(dates, snapshotNs);
        if (snap && (hasEvents(snap) || !p)) {
          p = snap;
          fromSnapshot = true;
        }
      }
      if (cancelled) return;
      if (p) setPayload(p);
      let delay = nextDelayMs(p);
      // A snapshot viewer re-polls our own proxy, and the file only changes
      // when the publisher pushes — live cadence would be pure hammering.
      if (delay != null && fromSnapshot) delay = Math.max(delay, 60_000);
      if (delay != null) timer = setTimeout(pull, delay);
    }

    pull();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [datesKey, sport, snapshotNs]);

  return payload;
}
