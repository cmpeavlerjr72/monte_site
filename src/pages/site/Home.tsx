// src/pages/site/Home.tsx: the homepage (2026-10-16 refresh).
//
// Data is the hero, not a tagline over icon cards: the live 2026 record (from
// the published ledger, the same numbers as /cfb/record), this week's next
// games off the board with the sim's projected score and win probability, the
// latest blog posts, and the projects. Every number on this page is loaded,
// none is typed in.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ButtonLink, Card, Pill, Stat, signedTone } from "../../components/ui";
import { TeamCell } from "../../components/ui/TeamCell";
import { Skeleton } from "../../components/Skeleton";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { loadRecordHeadline, type RecordHeadline } from "../../lib/recordHeadline";
import { loadUpNext, type UpNext } from "../../lib/upNext";
import { GATES, isOpen } from "../../lib/seasons";
import { LatestPosts } from "../../components/blog/LatestPosts";

const signed = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
const pctSigned = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r * 100).toFixed(1)}%`;

/* ----------------------------------------------------------- record tile -- */
function Sparkline({ points }: { points: { week: number; cum: number }[] }) {
  if (points.length < 2) return null;
  const W = 220, H = 56, P = 4;
  const ys = [0, ...points.map((p) => p.cum)];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg className="rt-spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
      aria-label={`Running units by week, week ${points[0].week} to week ${last.week}, ending at ${signed(last.cum)} units`}>
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth="1" />
      <path d={d} fill="none" stroke="var(--chart-line)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.cum)} r="4" fill="var(--chart-point)" stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}

function RecordTile() {
  const [rec, setRec] = useState<RecordHeadline | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRecordHeadline().then((r) => { if (alive) setRec(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return (
    <Card className="rt" kicker="The 2026 record" action={<Link to="/cfb/record">Every bet →</Link>}>
      {failed ? (
        <p className="rt-note">The record didn't load just now. <Link className="link" to="/cfb/record">Open the record page</Link>.</p>
      ) : !rec ? (
        <div aria-busy="true" role="status" aria-label="Loading the record" className="rt-body">
          <Skeleton height={52} width="60%" />
          <Skeleton height={16} width="85%" />
          <Skeleton height={56} />
        </div>
      ) : (
        <div className="rt-body">
          <Stat size="xl" label="Return per unit risked"
            value={rec.summary.roi == null ? "—" : pctSigned(rec.summary.roi)}
            tone={signedTone(rec.summary.roi)} />
          <p className="rt-line">
            <span className="num"><b>{rec.summary.wins}-{rec.summary.losses}{rec.summary.pushes ? `-${rec.summary.pushes}` : ""}</b></span>
            {" · "}
            <span className={`num tone-${(signedTone(rec.summary.units) ?? "muted")}`}><b>{signed(rec.summary.units)}u</b></span>
            {" on "}<span className="num">{rec.summary.scored}</span> starred picks
          </p>
          <Sparkline points={rec.weeks} />
          <p className="rt-note">
            {rec.throughWeek != null ? `Through week ${rec.throughWeek}. ` : ""}
            Every pick posted before kickoff, graded at the price we posted it, fees in. The bad weeks stay up.
          </p>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- up next -- */
const kick = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

function UpNextStrip() {
  const [data, setData] = useState<UpNext | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadUpNext(6).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const head = (
    <div className="home-sec__head">
      <h2 className="home-sec__title">{data?.weekLabel ? `${data.weekLabel}: up next on the board` : "Up next on the board"}</h2>
      <Link className="link" to="/cfb/scoreboard">Full board →</Link>
    </div>
  );
  if (failed) return <section className="home-sec">{head}<p className="rt-note">The board didn't load. <Link className="link" to="/cfb/scoreboard">Open it directly</Link>.</p></section>;
  return (
    <section className="home-sec" aria-label="Up next on the board">
      {head}
      <ol className="un-strip">
        {!data
          ? Array.from({ length: 6 }, (_, i) => <li key={i} className="un-game"><Skeleton height={96} /></li>)
          : data.games.map((g) => {
            const favHome = g.winHome != null ? g.winHome >= 0.5 : null;
            const fav = favHome == null ? null : favHome ? g.home : g.away;
            const favP = g.winHome == null ? null : favHome ? g.winHome : 1 - g.winHome;
            return (
              <li key={g.slug} className="un-game">
                <Link className="un-game__link" to={`/cfb/scoreboard?week=${data.weekId}${g.gameId ? `&game=${g.gameId}` : ""}`}>
                  <span className="un-game__kick">{g.final ? "Final" : <>{kick(g.kickoff)} <span className="un-game__proj">· proj.</span></>}</span>
                  <span className="un-game__row">
                    <TeamCell team={g.away} size={20} />
                    <span className="un-game__pts num">{g.final ? g.finalAway : g.projAway != null ? Math.round(g.projAway) : "—"}</span>
                  </span>
                  <span className="un-game__row">
                    <TeamCell team={g.home} size={20} />
                    <span className="un-game__pts num">{g.final ? g.finalHome : g.projHome != null ? Math.round(g.projHome) : "—"}</span>
                  </span>
                  <span className="un-game__foot">
                    {fav && favP != null
                      ? <><b className="num">{Math.round(favP * 100)}%</b> <span className="un-game__fav">{fav} to win</span></>
                      : "Sim pending"}
                  </span>
                </Link>
              </li>
            );
          })}
      </ol>
    </section>
  );
}

/* --------------------------------------------------------------- projects -- */
function Projects() {
  const cbbLive = isOpen(GATES.cbbSeason);
  const rows = [
    { name: "College football", to: "/cfb/scoreboard", status: <Pill tone="gold">Live</Pill>,
      body: "Every FBS and FCS game simulated play by play, priced against Kalshi and the books, graded in public." },
    { name: "College basketball", to: "/cbb/scoreboard", status: cbbLive ? <Pill tone="gold">Live</Pill> : <Pill tone="outline">Tips Nov 3</Pill>,
      body: "Daily game sims and a season-long P&L. Last season's March bracket is in the archive." },
    { name: "NHL", to: "/nhl", status: <Pill tone="outline">Coming</Pill>,
      body: "A hockey sim is in the shop. Posts land on the blog first." },
    { name: "Fantasy AI", to: "/fantasy-ai", status: <Pill tone="outline">Experiment</Pill>,
      body: "What happens when an AI runs a real fantasy team. Reports on the blog." },
  ];
  return (
    <section className="home-sec" aria-label="Projects">
      <div className="home-sec__head"><h2 className="home-sec__title">What we sim</h2><Link className="link" to="/labs">Labs →</Link></div>
      <div className="proj-list">
        {rows.map((r) => (
          <Link key={r.name} to={r.to} className="proj-row">
            <span className="proj-row__name">{r.name}</span>
            <span className="proj-row__status">{r.status}</span>
            <span className="proj-row__body">{r.body}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- page -- */
export default function Home() {
  useDocumentMeta({
    title: "MVPEAV | Sports sims that keep receipts",
    bare: true,
    description: "College football and basketball simulations with a public, graded record of every pick, posted before kickoff and graded at the price we posted it.",
  });
  return (
    <div className="home">
      <div className="home-top">
        <div className="home-mast">
          <div className="kicker">College football · 2026</div>
          <h1 className="home-mast__title">Sports sims that keep receipts.</h1>
          <p className="home-mast__dek">
            Every FBS game, simulated play by play 10,000 times. Every pick posted before kickoff and graded
            at the price you could actually have gotten, fees included. The losing weeks stay on the board too.
          </p>
          <div className="home-mast__cta">
            <ButtonLink to="/cfb/scoreboard">This week's board</ButtonLink>
            <ButtonLink to="/about" variant="quiet">How it works</ButtonLink>
          </div>
        </div>
        <RecordTile />
      </div>

      <UpNextStrip />
      <LatestPosts />
      <Projects />

    </div>
  );
}
