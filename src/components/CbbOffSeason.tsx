// src/components/CbbOffSeason.tsx: the CBB board before the season tips
// (2026-10-16). Says when it's back, and shows LAST season's receipts from a
// frozen summary (src/data/cbb_2025_26_summary.json, written by
// scripts/gen_cbb_season_summary.mjs from the published daily results).

import { Link } from "react-router-dom";
import { EmptyState, Stat, signedTone } from "./ui";
import { GATES } from "../lib/seasons";
import last from "../data/cbb_2025_26_summary.json";

const rec = (m: { wins: number; losses: number; pushes: number }) =>
  `${m.wins.toLocaleString()}-${m.losses.toLocaleString()}${m.pushes ? `-${m.pushes}` : ""}`;
const u = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}u`;
const pct = (m: { wins: number; losses: number }) => `${((m.wins / Math.max(1, m.wins + m.losses)) * 100).toFixed(1)}%`;

export default function CbbOffSeason() {
  const { spread, total, ml } = last.markets;
  return (
    <EmptyState
      kicker={`Season tips ${GATES.cbbSeason.label}`}
      title="College basketball is back in November"
      action={<>
        <Link className="btn-link btn-link--primary" to="/cbb/results">Last season, day by day</Link>
        <Link className="btn-link btn-link--quiet" to="/cbb/bracket">The March bracket</Link>
      </>}
    >
      <p>
        Daily sims start the first night of the season. Until then, here's how the {last.season} sims did:
        every graded pick across {last.games.toLocaleString()} games, 1 unit flat, no cherry-picking.
      </p>
      <div className="cbb-off__stats">
        <Stat label="Against the spread" value={rec(spread)} note={`${pct(spread)} · ${u(spread.units)}`} />
        <Stat label="Totals" value={rec(total)} note={<span className={`tone-${signedTone(total.units) ?? "muted"}`}>{pct(total)} · {u(total.units)}</span>} />
        <Stat label="Moneyline" value={rec(ml)} note={<span className={`tone-${signedTone(ml.units) ?? "muted"}`}>{pct(ml)} · {u(ml.units)}</span>} />
      </div>
      <p className="cbb-off__fine">The board below still works: pick any date from last season to see that night's sims.</p>
    </EmptyState>
  );
}
