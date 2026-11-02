// src/components/site/RecordTile.tsx: the CFB home's record box. It points a
// visitor at where results are and what the model is currently good at, so its
// content is meant to change week to week. Today it rotates (every ~6 s,
// paused on hover or focus, with dots) through two season-to-date scoreboard
// records, computed LIVE from the published lines.json + verified finals by the
// same Value-rule helper the scoreboard's record strip uses (lib/valueRecord.ts,
// loaded by lib/valueSeason.ts): open line, flat -110 on spread and total,
// pushes 0 units.
//
//   1. Value totals     the Value rule, totals only
//   2. Value edge 10+   the Value rule, every bet type, the 10+ point edge bucket
//
// Each links to the board with that view highlighted. Under the tile, one small
// line keeps the starred-picks record (the ledger /cfb/record shows) reachable.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Stat, signedTone } from "../ui";
import { Skeleton } from "../Skeleton";
import { loadValueSeason, type ValueSeasonLoad } from "../../lib/valueSeason";
import { roiOf, tallyN, type Tally } from "../../lib/valueRecord";
import { loadRecordHeadline, type RecordHeadline } from "../../lib/recordHeadline";

const ROTATE_MS = 6000;
const signed = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
const pctSigned = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r * 100).toFixed(1)}%`;
const wlp = (t: Tally) => `${t.win}-${t.loss}${t.push ? `-${t.push}` : ""}`;

type Panel = { key: string; label: string; to: string; tally: Tally };

export function RecordTile() {
  const [season, setSeason] = useState<ValueSeasonLoad | null>(null);
  const [failed, setFailed] = useState(false);
  const [starred, setStarred] = useState<RecordHeadline | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;
    loadValueSeason().then((r) => { if (alive) setSeason(r); }).catch(() => { if (alive) setFailed(true); });
    loadRecordHeadline().then((r) => { if (alive) setStarred(r); }).catch(() => { /* the line just stays out */ });
    return () => { alive = false; };
  }, []);

  const panels: Panel[] = useMemo(() => season ? [
    { key: "totals", label: "Value totals", to: "/cfb/scoreboard?value=1&bet=total", tally: season.totals },
    { key: "edge10", label: "Value edge 10+", to: "/cfb/scoreboard?value=1&edge=10", tally: season.edge10 },
  ].filter((p) => tallyN(p.tally) > 0) : [], [season]);

  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (paused || reduced || panels.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % panels.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, reduced, panels.length]);

  const cur = panels.length ? panels[idx % panels.length] : null;
  const roi = cur ? roiOf(cur.tally) : null;

  return (
    <div className="rt-wrap">
      <Card className="rt" kicker="What the model is good at">
        <div
          className="rt-body"
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
        >
          {failed ? (
            <p className="rt-note">The record didn't load just now. <Link className="link" to="/cfb/record">Open the record page</Link>.</p>
          ) : !season ? (
            <div aria-busy="true" role="status" aria-label="Loading the record">
              <Skeleton height={52} width="60%" />
              <Skeleton height={16} width="85%" />
            </div>
          ) : !cur ? (
            <p className="rt-note">No graded value bets yet this season. <Link className="link" to="/cfb/scoreboard">Open the board</Link>.</p>
          ) : (
            <Link to={cur.to} className="rt-panel" aria-label={`${cur.label}: open the scoreboard with this view`} style={{ color: "inherit", textDecoration: "none", display: "block" }}>
              <Stat size="xl" label={cur.label} value={roi == null ? "—" : `${pctSigned(roi)} ROI`} tone={signedTone(roi)} />
              <p className="rt-line">
                <span className="num"><b>{wlp(cur.tally)}</b></span>
                {" · "}
                <span className={`num tone-${(signedTone(cur.tally.pnl) ?? "muted")}`}><b>{signed(cur.tally.pnl)}u</b></span>
                {" · "}<span className="num">{tallyN(cur.tally)}</span> bets
              </p>
              <p className="rt-note">season to date, open line, -110 · see these games on the board →</p>
            </Link>
          )}
          {panels.length > 1 && (
            <div role="tablist" aria-label="Records" style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {panels.map((p, i) => (
                <button key={p.key} type="button" role="tab" aria-selected={i === idx % panels.length} aria-label={p.label}
                  onClick={() => setIdx(i)}
                  style={{
                    width: 8, height: 8, borderRadius: 999, padding: 0, border: 0, cursor: "pointer",
                    background: i === idx % panels.length ? "var(--brand)" : "var(--border)",
                  }} />
              ))}
            </div>
          )}
        </div>
      </Card>
      {starred && starred.summary.scored > 0 && (
        <p className="rt-note" style={{ margin: "6px 2px 0", fontSize: 11.5 }}>
          <Link className="link" to="/cfb/record">
            All starred picks: {starred.summary.wins}-{starred.summary.losses}{starred.summary.pushes ? `-${starred.summary.pushes}` : ""}, {signed(starred.summary.units, 2)}u
          </Link>
        </p>
      )}
    </div>
  );
}
