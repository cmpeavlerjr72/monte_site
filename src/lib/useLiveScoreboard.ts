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

import { useEffect, useState } from "react";

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

/** One direct walk: per-group fetches, events merged (deduped by id) into the
 *  first group's payload as scaffold. Returns null when every fetch failed —
 *  an empty-but-healthy slate returns a payload with events: []. */
async function fetchEspnDirect(dateYYYYMMDD: string, sport: SportKey): Promise<any | null> {
  const cfg = SPORT_CFG[sport];
  const d = String(dateYYYYMMDD).replace(/-/g, "");
  const urls = cfg.groups.length
    ? cfg.groups.map((g) => `${cfg.base}?dates=${d}&groups=${g}&limit=${cfg.limit}`)
    : [`${cfg.base}?dates=${d}&limit=${cfg.limit}`];

  const payloads = await Promise.all(
    urls.map((u) =>
      fetch(u, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );

  const good = payloads.filter((p) => p && Array.isArray(p.events));
  if (!good.length) return null;

  const scaffold = good[0];
  if (good.length > 1) {
    const seen = new Set<string>();
    const events: any[] = [];
    for (const p of good) {
      for (const ev of p.events) {
        const id = String(ev?.id ?? "");
        if (!id || seen.has(id)) continue; // drops ESPN's id-less stub events too
        seen.add(id);
        events.push(ev);
      }
    }
    events.sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")));
    scaffold.events = events;
  }
  return scaffold;
}

/** Server fallback: same payload shape, unwrapped from the REST envelope. */
async function fetchServer(dateYYYYMMDD: string, sport: SportKey): Promise<any | null> {
  try {
    const params = new URLSearchParams();
    params.set("date", String(dateYYYYMMDD));
    params.set("sport", sport);
    const resp = await fetch(`/api/scoreboard?${params.toString()}`, { cache: "no-cache" });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.payload ?? json;
  } catch {
    return null;
  }
}

/**
 * Poll ESPN's public scoreboard (direct from the browser, 20s cadence),
 * falling back to the /api/scoreboard proxy only when the direct fetch
 * fails outright (e.g. a network that blocks espn.com).
 *
 * @param date  e.g. "20251123" or "2025-11-23"
 * @param sport "cfb", "cbb", or "mlb" (defaults to "cfb")
 */
export function useLiveScoreboard(
  date: string | null | undefined,
  sport: SportKey = "cfb"
) {
  const [payload, setPayload] = useState<any | null>(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pull() {
      let p = await fetchEspnDirect(String(date), sport);
      if (!p) p = await fetchServer(String(date), sport);
      if (!cancelled && p) setPayload(p);
      if (!cancelled) timer = setTimeout(pull, 20_000);
    }

    pull();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [date, sport]);

  return payload;
}
