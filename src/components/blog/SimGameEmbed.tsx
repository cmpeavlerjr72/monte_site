// src/components/blog/SimGameEmbed.tsx: `::sim-game{season week game}` in a
// post. A READ-ONLY game card: projected score, win probability, the market
// line from the sim file, and links to the live board card and Game sims.
// Never an order, Tail or price button.
//
// Numbers: by default the CURRENT published sim for that game (the same
// summary.json the board reads), labelled "as of" its export time, because a
// re-sim during the week changes them. `frozen="/blog/<slug>/x.json"` pins the
// numbers at publish instead (shape below) for a post that must not drift.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TeamCell } from "../ui/TeamCell";
import { getJsonWeekIndex, getGameSummaryCached } from "../../lib/cfbJson";
import { displayTeamColor } from "../../utils/teamColors";
import { useIsDark } from "../../lib/usePrefs";

type Snap = {
  home: string; away: string;
  projHome: number | null; projAway: number | null;
  winHome: number | null;
  spreadHome: number | null; total: number | null;
  finalHome: number | null; finalAway: number | null;
  asOf: string | null; frozen: boolean;
};

async function loadLive(season: number, week: number, gameId: string): Promise<Snap | null> {
  const weekId = `week${String(week).padStart(2, "0")}`;
  const rows = await getJsonWeekIndex(weekId, String(season));
  const row = rows?.find((r) => String(r.game_id) === gameId);
  if (!row) return null;
  const s = await getGameSummaryCached(row, String(season));
  return {
    home: row.teamA, away: row.teamB,
    projHome: s?.median_A_pts ?? null, projAway: s?.median_B_pts ?? null,
    winHome: s?.A_win_prob ?? null,
    spreadHome: s?.odds?.spread_current ?? s?.odds?.spread_open ?? null,
    total: s?.odds?.over_under_current ?? s?.odds?.over_under_open ?? null,
    finalHome: s?.finalA ?? null, finalAway: s?.finalB ?? null,
    asOf: s?.updated ?? null, frozen: false,
  };
}

/** Frozen file: { home, away, proj_home, proj_away, win_home, spread_home,
 *  total, final_home?, final_away?, as_of } */
async function loadFrozen(url: string): Promise<Snap | null> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  return {
    home: j.home, away: j.away, projHome: j.proj_home ?? null, projAway: j.proj_away ?? null,
    winHome: j.win_home ?? null, spreadHome: j.spread_home ?? null, total: j.total ?? null,
    finalHome: j.final_home ?? null, finalAway: j.final_away ?? null, asOf: j.as_of ?? null, frozen: true,
  };
}

const fmtAsOf = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const spreadWords = (team: string, line: number) => `${team} ${line > 0 ? "+" : line < 0 ? "−" : ""}${Math.abs(line)}`;

export function SimGameEmbed({ season, week, gameId, frozen }: { season: number; week: number; gameId: string; frozen?: string }) {
  const isDark = useIsDark();
  const [snap, setSnap] = useState<Snap | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  useEffect(() => {
    let alive = true;
    (frozen ? loadFrozen(frozen) : loadLive(season, week, gameId))
      .then((s) => { if (!alive) return; setSnap(s); setState(s ? "ok" : "missing"); })
      .catch(() => { if (alive) setState("missing"); });
    return () => { alive = false; };
  }, [season, week, gameId, frozen]);

  const weekId = `week${String(week).padStart(2, "0")}`;
  const boardHref = `/cfb/scoreboard?week=${weekId}&game=${gameId}`;

  if (state !== "ok" || !snap) {
    return (
      <aside className="simcard simcard--empty" aria-busy={state === "loading"}>
        <div className="kicker">The sim · 10,000 runs</div>
        <p>{state === "loading" ? "Loading the sim…" : "This game's sim isn't published."}</p>
        <Link className="simcard__link" to={boardHref}>See the live game card →</Link>
      </aside>
    );
  }
  const final = snap.finalHome != null && snap.finalAway != null;
  const wh = snap.winHome;
  const awayColor = displayTeamColor(snap.away, isDark) ?? "var(--muted)";
  const homeColor = displayTeamColor(snap.home, isDark) ?? "var(--brand)";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <aside className="simcard" aria-label={`Sim card: ${snap.away} at ${snap.home}`}>
      <div className="simcard__head">
        <span className="kicker">The sim · 10,000 runs</span>
        <span className="simcard__asof">{snap.frozen ? "Frozen at publish" : "Live sim"}{snap.asOf ? ` · as of ${fmtAsOf(snap.asOf)}` : ""}</span>
      </div>
      <div className="simcard__rows">
        {[{ t: snap.away, p: snap.projAway, f: snap.finalAway, w: wh == null ? null : 1 - wh },
          { t: snap.home, p: snap.projHome, f: snap.finalHome, w: wh }].map((r) => (
          <div key={r.t} className="simcard__row">
            <TeamCell team={r.t} size={26} />
            <span className="simcard__win num">{r.w == null ? "—" : pct(r.w)}</span>
            <span className="simcard__pts num">{r.p == null ? "—" : Math.round(r.p)}</span>
          </div>
        ))}
      </div>
      {wh != null && (
        <div className="simcard__bar" role="img" aria-label={`${snap.away} wins ${pct(1 - wh)} of sims, ${snap.home} ${pct(wh)}`}>
          <span style={{ width: `${(1 - wh) * 100}%`, background: awayColor }} />
          <span style={{ width: `${wh * 100}%`, background: homeColor }} />
        </div>
      )}
      <div className="simcard__meta">
        <span>Win % and median score across 10,000 sims</span>
        {snap.spreadHome != null && <span>Line: {spreadWords(snap.home, snap.spreadHome)}{snap.total != null ? ` · O/U ${snap.total}` : ""}</span>}
      </div>
      {final && (
        <div className="simcard__final">Final: {snap.away} {snap.finalAway}, {snap.home} {snap.finalHome}</div>
      )}
      <div className="simcard__links">
        <Link className="simcard__link" to={boardHref}>See the live game card →</Link>
      </div>
    </aside>
  );
}

/** The sim summary's final score for a post's game, for the graded pick line.
 *  Null until final. Shares the board's memoised loaders. */
export async function loadFinal(season: number, week: number, gameId: string): Promise<{ home: number; away: number } | null> {
  const s = await loadLive(season, week, gameId).catch(() => null);
  return s && s.finalHome != null && s.finalAway != null ? { home: s.finalHome, away: s.finalAway } : null;
}
