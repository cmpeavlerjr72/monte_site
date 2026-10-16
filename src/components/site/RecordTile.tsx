// src/components/site/RecordTile.tsx: the CFB sims' 2026 record in one card
// (live from the published ledger, the same numbers as /cfb/record). It used
// to headline the homepage; since 2026-10-16 it lives on the CFB home, where
// the site's CFB-specific numbers belong.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Stat, signedTone } from "../ui";
import { Skeleton } from "../Skeleton";
import { loadRecordHeadline, type RecordHeadline } from "../../lib/recordHeadline";

const signed = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
const pctSigned = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r * 100).toFixed(1)}%`;

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

export function RecordTile() {
  const [rec, setRec] = useState<RecordHeadline | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRecordHeadline().then((r) => { if (alive) setRec(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return (
    <Card className="rt" kicker="The 2026 record" action={<Link to="/cfb/record">Every pick →</Link>}>
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
