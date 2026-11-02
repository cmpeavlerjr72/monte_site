// src/components/site/ScoreTicker.tsx: the score ticker under the header
// (2026-10-16), the strip cbssports.com and ESPN run across the top of the
// home page and each sport's home. One row of the next games on the CFB
// board (sim projection before kickoff, the score once it's final), arrows to
// page through it, and "Full board" at the right end.
//
// Mounted once in App, under the header and outside <main>, so it can run the
// full width of the window. It shows only on TICKER_PATHS.
//
// /cbb (2026-11-02): the same band for basketball. Football reads the week
// index; basketball reads today's day index (lib/upNextCbb.ts) and joins the
// ESPN scoreboard to it id-first (lib/liveJoin.ts), so live games show their
// score and clock and finals show the result. One view (TickerView) draws both.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { TeamCell } from "../ui/TeamCell";
import { Skeleton } from "../Skeleton";
import { loadUpNext, type UpNext } from "../../lib/upNext";
import { NflTicker } from "./NflTicker";
import { useLiveScoreboard } from "../../lib/useLiveScoreboard";
import { findTickLive, indexTickLive, tickLiveOfEvent } from "../../lib/liveJoin";
import { parseMbbStatus } from "../../lib/mbbLive";
import { bandGame, loadUpNextCbb, selectBandRows, type UpNextCbb } from "../../lib/upNextCbb";
import type { UpNextGame } from "../../lib/upNext";
import type { JsonWeekRow } from "../../lib/cfbJson";
import { getTeamLogo } from "../../utils/teamLogo";
import { espnLogoUrl } from "../../utils/espnLogos";

const TICKER_PATHS = new Set(["/", "/cfb", "/cbb"]);
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
  if (pathname === "/nfl") return <NflTicker />;
  if (pathname === "/cbb") return <ScoreTickerCbb />;
  return TICKER_PATHS.has(pathname) ? <ScoreTicker /> : null;
}

/** One game on the band, either sport. */
type BandItem = {
  key: string; to: string; kick: string; live?: boolean;
  away: string; home: string; awayLogo?: string; homeLogo?: string;
  ptsA: number | null; ptsH: number | null; foot: ReactNode;
};

const espnLogo = espnLogoUrl; // self-hosted when listed in the manifest, else the ESPN CDN

/** Basketball: today's day index plus the live feed. */
function ScoreTickerCbb() {
  const [day, setDay] = useState<UpNextCbb | null>(null);
  const [failed, setFailed] = useState(false);
  const [sims, setSims] = useState<Map<string, UpNextGame>>(new Map());

  useEffect(() => {
    let alive = true;
    loadUpNextCbb().then((d) => { if (alive) setDay(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Polls adaptively (20 s while a game is live, once when all are final) and only while /cbb is mounted.
  const payload = useLiveScoreboard(day ? [day.date] : null, "cbb", day?.ns);
  const idx = useMemo(() => {
    const events: any[] = payload?.events ?? [];
    return indexTickLive(events.filter((e) => e?.id).map((e) => tickLiveOfEvent(e, parseMbbStatus(e))));
  }, [payload]);

  const rows = useMemo(() => {
    if (!day) return [] as JsonWeekRow[];
    return selectBandRows(day.rows, Date.now(), N_GAMES, (r) => {
      const l = findTickLive(idx, r)?.live;
      return l ? l.state === "final" : undefined;
    });
  }, [day, idx]);

  // Sim numbers for just the shown rows (memoised per summary file by the loader).
  useEffect(() => {
    if (!day || !rows.length) return;
    let alive = true;
    Promise.all(rows.map((r) => bandGame(r, day.ns))).then((gs) => {
      if (alive) setSims(new Map(gs.map((g) => [g.slug, g])));
    });
    return () => { alive = false; };
  }, [day, rows]);

  const items: BandItem[] | null = day ? rows.map((r): BandItem => {
    const g = sims.get(r.slug);
    const hit = findTickLive(idx, r);
    const live = hit?.live;
    const inPlay = live?.state === "in";
    const final = Boolean(g?.final) || live?.state === "final";
    // A = sim home = the row's teamA; the band lists the away side first, as football does.
    const ptsH = final ? (g?.finalHome ?? hit?.scoreA ?? null) : inPlay ? hit?.scoreA ?? null : g?.projHome != null ? Math.round(g.projHome) : null;
    const ptsA = final ? (g?.finalAway ?? hit?.scoreB ?? null) : inPlay ? hit?.scoreB ?? null : g?.projAway != null ? Math.round(g.projAway) : null;
    const favHome = g?.winHome != null ? g.winHome >= 0.5 : null;
    const fav = favHome == null ? null : favHome ? r.teamA : r.teamB;
    const favP = g?.winHome == null ? null : favHome ? g.winHome : 1 - g.winHome;
    return {
      key: r.slug, to: `/cbb/scoreboard?date=${day.date}${r.game_id ? `&game=${r.game_id}` : ""}`,
      kick: final ? "Final" : inPlay ? live!.text : kick(r.time_utc), live: inPlay,
      away: r.teamB, home: r.teamA,
      awayLogo: getTeamLogo(r.teamB) || espnLogo(r.B_espn_id), homeLogo: getTeamLogo(r.teamA) || espnLogo(r.A_espn_id),
      ptsA, ptsH,
      foot: final
        ? (g?.projAway != null && g?.projHome != null ? <>Sim had it {Math.round(g.projAway)}–{Math.round(g.projHome)}</> : "Final")
        : fav && favP != null ? <><b className="num">{Math.round(favP * 100)}%</b> {fav}</> : "Sim pending",
    };
  }) : null;

  return (
    <TickerView league="CBB" label={day?.weekLabel ?? "Today"} ariaLabel="Today's games on the board"
      boardTo={day ? `/cbb/scoreboard?date=${day.date}` : "/cbb/scoreboard"} items={items} failed={failed} data={day} />
  );
}

export function ScoreTicker() {
  const [data, setData] = useState<UpNext | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadUpNext(N_GAMES).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const items: BandItem[] | null = data ? data.games.map((g) => {
    const favHome = g.winHome != null ? g.winHome >= 0.5 : null;
    const fav = favHome == null ? null : favHome ? g.home : g.away;
    const favP = g.winHome == null ? null : favHome ? g.winHome : 1 - g.winHome;
    return {
      key: g.slug, to: `/cfb/scoreboard?week=${data.weekId}${g.gameId ? `&game=${g.gameId}` : ""}`,
      kick: g.final ? "Final" : kick(g.kickoff), away: g.away, home: g.home,
      ptsA: g.final ? g.finalAway : g.projAway != null ? Math.round(g.projAway) : null,
      ptsH: g.final ? g.finalHome : g.projHome != null ? Math.round(g.projHome) : null,
      foot: g.final
        ? (g.projAway != null && g.projHome != null ? <>Sim had it {Math.round(g.projAway)}–{Math.round(g.projHome)}</> : "Final")
        : fav && favP != null ? <><b className="num">{Math.round(favP * 100)}%</b> {fav}</> : "Sim pending",
    };
  }) : null;

  return (
    <TickerView league="CFB" label={data?.weekLabel ?? "This week"} ariaLabel="Up next on the board"
      boardTo={data ? `/cfb/scoreboard?week=${data.weekId}` : "/cfb/scoreboard"} items={items} failed={failed} data={data} />
  );
}

/** The band itself: label, the rail of games, arrows, "Full board". Both sports. */
function TickerView({ league, label, ariaLabel, boardTo, items, failed, data }: {
  league: string; label: string; ariaLabel: string; boardTo: string; items: BandItem[] | null; failed: boolean; data: unknown;
}) {
  const rail = useRef<HTMLOListElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, data, items?.length]);

  const page = (dir: 1 | -1) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  const boardPath = boardTo.split("?")[0];

  return (
    <section className="ticker" aria-label={ariaLabel}>
      <div className="ticker__inner">
        <div className="ticker__label">
          <span className="ticker__league">{league}</span>
          <span className="ticker__week">{label}</span>
        </div>

        {failed ? (
          <p className="ticker__note">The board didn't load just now. <Link className="link" to={boardPath}>Open it directly</Link>.</p>
        ) : (
          <ol className="ticker__rail" ref={rail} onScroll={measure}>
            {!items
              ? Array.from({ length: 8 }, (_, i) => <li key={i} className="tk-game"><Skeleton height={62} /></li>)
              : items.length === 0
                ? <li className="tk-game"><span className="tk-game__link">No games on this day's board.</span></li>
                : items.map((g) => (
                  <li key={g.key} className="tk-game">
                    <Link className="tk-game__link" to={g.to}>
                      <span className={g.live ? "tk-game__kick tk-game__kick--live" : "tk-game__kick"}>{g.kick}</span>
                      <span className="tk-game__row"><TeamCell team={g.away} size={16} logo={g.awayLogo} eager /><span className="tk-game__pts num">{g.ptsA ?? "—"}</span></span>
                      <span className="tk-game__row"><TeamCell team={g.home} size={16} logo={g.homeLogo} eager /><span className="tk-game__pts num">{g.ptsH ?? "—"}</span></span>
                      <span className="tk-game__foot">{g.foot}</span>
                    </Link>
                  </li>
                ))}
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
