// src/components/site/ScoreTicker.tsx: the score ticker under the header
// (2026-10-16), the strip cbssports.com and ESPN run across the top of the
// home page and each sport's home. One row of the next games on the CFB
// board (sim projection before kickoff, the score once it's final), arrows to
// page through it, and "Full board" at the right end.
//
// Mounted once in App, under the header and outside <main>, so it can run the
// full width of the window. It shows only on TICKER_PATHS.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { TeamCell } from "../ui/TeamCell";
import { Skeleton } from "../Skeleton";
import { loadUpNext, type UpNext } from "../../lib/upNext";

const TICKER_PATHS = new Set(["/", "/cfb"]);
const N_GAMES = 16;

/** Kickoff in the reader's time. A midnight-ET kick is ESPN's placeholder for
 *  "time not set yet", which the board prints as TBD, so this does too. */
const kick = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const et = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
  const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  if (et === "00:00" || et === "24:00") return `${day} TBD`;
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

export function SiteTicker() {
  const { pathname } = useLocation();
  return TICKER_PATHS.has(pathname) ? <ScoreTicker /> : null;
}

export function ScoreTicker() {
  const [data, setData] = useState<UpNext | null>(null);
  const [failed, setFailed] = useState(false);
  const rail = useRef<HTMLOListElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  useEffect(() => {
    let alive = true;
    loadUpNext(N_GAMES).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
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

  const page = (dir: 1 | -1) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const boardTo = data ? `/cfb/scoreboard?week=${data.weekId}` : "/cfb/scoreboard";

  return (
    <section className="ticker" aria-label="Up next on the board">
      <div className="ticker__inner">
        <div className="ticker__label">
          <span className="ticker__league">CFB</span>
          <span className="ticker__week">{data?.weekLabel ?? "This week"}</span>
        </div>

        {failed ? (
          <p className="ticker__note">The board didn't load just now. <Link className="link" to="/cfb/scoreboard">Open it directly</Link>.</p>
        ) : (
          <ol className="ticker__rail" ref={rail} onScroll={measure}>
            {!data
              ? Array.from({ length: 8 }, (_, i) => <li key={i} className="tk-game"><Skeleton height={62} /></li>)
              : data.games.map((g) => {
                const favHome = g.winHome != null ? g.winHome >= 0.5 : null;
                const fav = favHome == null ? null : favHome ? g.home : g.away;
                const favP = g.winHome == null ? null : favHome ? g.winHome : 1 - g.winHome;
                const ptsA = g.final ? g.finalAway : g.projAway != null ? Math.round(g.projAway) : null;
                const ptsH = g.final ? g.finalHome : g.projHome != null ? Math.round(g.projHome) : null;
                return (
                  <li key={g.slug} className="tk-game">
                    <Link className="tk-game__link" to={`/cfb/scoreboard?week=${data.weekId}${g.gameId ? `&game=${g.gameId}` : ""}`}>
                      <span className="tk-game__kick">{g.final ? "Final" : kick(g.kickoff)}</span>
                      <span className="tk-game__row"><TeamCell team={g.away} size={16} /><span className="tk-game__pts num">{ptsA ?? "—"}</span></span>
                      <span className="tk-game__row"><TeamCell team={g.home} size={16} /><span className="tk-game__pts num">{ptsH ?? "—"}</span></span>
                      <span className="tk-game__foot">
                        {g.final ? (g.projAway != null && g.projHome != null ? <>Sim had it {Math.round(g.projAway)}–{Math.round(g.projHome)}</> : "Final") : fav && favP != null ? <><b className="num">{Math.round(favP * 100)}%</b> {fav}</> : "Sim pending"}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ol>
        )}

        <div className="ticker__end">
          <button type="button" className="ticker__arrow" aria-label="Earlier games" disabled={edge.start} onClick={() => page(-1)}>‹</button>
          <button type="button" className="ticker__arrow" aria-label="More games" disabled={edge.end} onClick={() => page(1)}>›</button>
          <Link className="ticker__board" to={boardTo}>Full board</Link>
        </div>
      </div>
    </section>
  );
}
