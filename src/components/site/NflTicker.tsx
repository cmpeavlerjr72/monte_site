// src/components/site/NflTicker.tsx: the score strip on /nfl (2026-10-20).
//
// Same look as the CFB ticker (ScoreTicker), but there are no NFL sims, so it
// is just the week's games straight from ESPN's public scoreboard: kickoff and
// line before the game, the live clock during it, the final after. The
// browser fetches ESPN directly (Access-Control-Allow-Origin: *, the same as
// useEspnScoreboard). Each game opens ESPN's gamecast in a new tab.
// It reads our server's cached copy (/api/nfl/scoreboard) first.

import { useCallback, useEffect, useRef, useState } from "react";
import { TeamCell } from "../ui/TeamCell";
import { Skeleton } from "../Skeleton";

const NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

type Side = { name: string; abbr: string; logo?: string; score?: string; winner?: boolean };
type NflGame = {
  id: string; date: string; state: "pre" | "in" | "post"; detail: string;
  away: Side; home: Side; line?: string; tv?: string; href?: string;
};
type NflWeek = { label: string; games: NflGame[] };

/* eslint-disable @typescript-eslint/no-explicit-any */
function parse(j: any): NflWeek {
  const games: NflGame[] = (j?.events ?? []).map((e: any) => {
    const c = e.competitions?.[0] ?? {};
    const side = (ha: "home" | "away"): Side => {
      const t = (c.competitors ?? []).find((x: any) => x.homeAway === ha) ?? {};
      return { name: t.team?.shortDisplayName ?? t.team?.name ?? "TBD", abbr: t.team?.abbreviation ?? "", logo: t.team?.logo, score: t.score, winner: t.winner };
    };
    const odds = c.odds?.[0];
    return {
      id: String(e.id), date: e.date, state: e.status?.type?.state ?? "pre", detail: e.status?.type?.shortDetail ?? "",
      away: side("away"), home: side("home"),
      line: odds ? [odds.details, odds.overUnder != null ? `O/U ${odds.overUnder}` : ""].filter(Boolean).join(" · ") : undefined,
      tv: c.broadcasts?.[0]?.names?.[0],
      href: e.links?.find((l: any) => (l.rel ?? []).includes("summary"))?.href ?? e.links?.[0]?.href,
    };
  });
  const wk = j?.week?.number;
  const type = j?.season?.type;
  const label = type === 3 ? "Playoffs" : type === 1 ? "Preseason" : wk ? `Week ${wk}` : "This week";
  return { label, games };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const kick = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

export function NflTicker() {
  const [data, setData] = useState<NflWeek | null>(null);
  const [failed, setFailed] = useState(false);
  const rail = useRef<HTMLOListElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  useEffect(() => {
    let alive = true;
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    // Our server's cached copy first; ESPN directly if the server can't answer.
    const load = () => get("/api/nfl/scoreboard").catch(() => get(NFL_SCOREBOARD))
      .then((j) => { if (alive) { setData(parse(j)); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    load();
    // Refresh every minute so live scores move while the page is open.
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, data]);

  // On first load, start the rail at the first game that isn't over yet.
  const started = useRef(false);
  useEffect(() => {
    const el = rail.current;
    if (!data || !el || started.current) return;
    started.current = true;
    const i = data.games.findIndex((g) => g.state !== "post");
    const li = i > 0 ? (el.children[i] as HTMLElement | undefined) : undefined;
    if (li) el.scrollLeft = li.offsetLeft - el.offsetLeft;
    measure();
  }, [data, measure]);

  const page = (dir: 1 | -1) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="ticker" aria-label="NFL scores">
      <div className="ticker__inner">
        <div className="ticker__label">
          <span className="ticker__league">NFL</span>
          <span className="ticker__week">{data?.label ?? "This week"}</span>
        </div>

        {failed && !data ? (
          <p className="ticker__note">Scores didn't load just now. <a className="link" href="https://www.espn.com/nfl/scoreboard" target="_blank" rel="noopener noreferrer">ESPN's scoreboard</a>.</p>
        ) : (
          <ol className="ticker__rail" ref={rail} onScroll={measure}>
            {!data
              ? Array.from({ length: 8 }, (_, i) => <li key={i} className="tk-game"><Skeleton height={62} /></li>)
              : data.games.map((g) => {
                const showPts = g.state !== "pre";
                const lost = (s: Side) => g.state === "post" && s.winner === false && (g.away.winner || g.home.winner);
                return (
                  <li key={g.id} className="tk-game">
                    <a className="tk-game__link" href={g.href ?? "https://www.espn.com/nfl/scoreboard"} target="_blank" rel="noopener noreferrer"
                      aria-label={`${g.away.name} at ${g.home.name}, ${g.state === "pre" ? kick(g.date) : g.detail} (opens ESPN)`}>
                      <span className={`tk-game__kick${g.state === "in" ? " tk-game__kick--live" : ""}`}>{g.state === "pre" ? kick(g.date) : g.detail}</span>
                      {[g.away, g.home].map((s) => (
                        <span key={s.abbr} className={`tk-game__row${lost(s) ? " tk-game__row--lost" : ""}`}>
                          <TeamCell team={s.name} logo={s.logo ?? null} size={16} />
                          <span className="tk-game__pts num">{showPts ? (s.score ?? "—") : ""}</span>
                        </span>
                      ))}
                      <span className="tk-game__foot">{g.state === "pre" ? (g.line ?? g.tv ?? "") : g.state === "in" ? (g.tv ?? "Live") : "Final"}</span>
                    </a>
                  </li>
                );
              })}
          </ol>
        )}

        <div className="ticker__end">
          <button type="button" className="ticker__arrow" aria-label="Earlier games" disabled={edge.start} onClick={() => page(-1)}>‹</button>
          <button type="button" className="ticker__arrow" aria-label="More games" disabled={edge.end} onClick={() => page(1)}>›</button>
          <a className="ticker__board" href="https://www.espn.com/nfl/scoreboard" target="_blank" rel="noopener noreferrer">All scores</a>
        </div>
      </div>
    </section>
  );
}
