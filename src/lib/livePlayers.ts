// src/lib/livePlayers.ts
//
// Live player projections: the sim repo's export_live_grid.py publishes,
// next to live.json, a `live_players.json` per game with each player's
// expected REMAINING production from a live game state, conditioned on
// (2-minute time bin x 7 home-minus-away margin bins), built from the sim's
// per-play log. The live tab adds it to the player's ESPN box-score line:
//
//     projected final = actual so far + sim mean still to come | state
//
// Same quiet-null contract as liveGrid.ts: an unpublished file is expected.

import { dataUrl, type Season } from "./cfbData";
import { useEffect, useState } from "react";

export type LivePlayer = {
  player: string;
  team: string;
  /** "A" = sim home (teamA), "B" = sim away. */
  side: "A" | "B";
  stats: string[];
  pregame: number[];
  /** [time bin] -> values aligned to `stats`, over all seeds. */
  rem_time: number[][];
  /** [time bin][margin bin] -> values, or null when the cell is thin. */
  rem: (number[] | null)[][];
};

export type LivePlayers = {
  teamA: string;
  teamB: string;
  time_bin_s: number;
  n_time: number;
  margin_edges: number[];
  players: LivePlayer[];
};

export function parseLivePlayers(raw: any): LivePlayers | null {
  if (!raw || !Array.isArray(raw.players) || !Array.isArray(raw.margin_edges)) return null;
  if (typeof raw.time_bin_s !== "number" || typeof raw.n_time !== "number") return null;
  return {
    teamA: String(raw.teamA ?? ""),
    teamB: String(raw.teamB ?? ""),
    time_bin_s: raw.time_bin_s,
    n_time: raw.n_time,
    margin_edges: raw.margin_edges,
    players: raw.players.filter(
      (p: any) => p && Array.isArray(p.stats) && Array.isArray(p.rem_time) && Array.isArray(p.rem)
    ),
  };
}

export function useLivePlayers(
  ns: Season | null,
  weekId: string | null,
  slug: string | null
): LivePlayers | null {
  const [data, setData] = useState<LivePlayers | null>(null);
  useEffect(() => {
    setData(null);
    if (!ns || !weekId || !slug) return;
    let alive = true;
    const ac = new AbortController();
    (async () => {
      try {
        const url = await dataUrl(`weeks/${weekId}/games/${slug}/live_players.json`, ns);
        const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
        if (!res.ok) return;
        const parsed = parseLivePlayers(await res.json());
        if (alive) setData(parsed);
      } catch {
        /* unpublished / network / malformed -> stay null */
      }
    })();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [ns, weekId, slug]);
  return data;
}

/** Margin bin, same rule as the exporter: searchsorted(edges, m, side=right). */
function marginBin(edges: number[], margin: number): number {
  let i = 0;
  while (i < edges.length && margin >= edges[i]) i++;
  return i;
}

/**
 * Sim mean remaining production for one player at a live state, aligned to
 * `p.stats`. elapsed = regulation seconds elapsed (0..3600); simMargin =
 * sim-home minus sim-away. Linear between adjacent bin midpoints at the same
 * margin bin; a thin cell falls back to the all-seeds row for that bin.
 * Past the last midpoint it fades linearly to 0 at 3600 (OT not modelled
 * here — callers show actuals only in OT).
 */
export function remainingFor(lp: LivePlayers, p: LivePlayer, elapsed: number, simMargin: number): number[] {
  const mb = marginBin(lp.margin_edges, simMargin);
  const row = (tb: number) => p.rem[tb]?.[mb] ?? p.rem_time[tb];
  const w = lp.time_bin_s;
  const pos = (elapsed - w / 2) / w; // fractional index between midpoints
  if (pos <= 0) {
    // kickoff (all of the pregame mean still to come) -> first midpoint
    const f = Math.max(0, Math.min(1, elapsed / (w / 2)));
    return row(0).map((v, i) => p.pregame[i] + f * (v - p.pregame[i]));
  }
  const last = lp.n_time - 1;
  if (pos >= last) {
    const end = lp.n_time * w;
    const lastMid = last * w + w / 2;
    const f = Math.max(0, Math.min(1, (end - elapsed) / (end - lastMid)));
    return row(last).map((v) => v * f);
  }
  const lo = Math.floor(pos);
  const f = pos - lo;
  const a = row(lo);
  const b = row(lo + 1);
  return a.map((v, i) => v + f * ((b[i] ?? v) - v));
}

/** Name key for joining ESPN box names to sim names: lowercase letters
 *  only, generational suffixes dropped ("Winston Watkins Jr." == "Winston Watkins"). */
export function playerKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}
