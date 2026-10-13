// src/components/GameDkProps.tsx
//
// The Bets tab's "DK props" chip (owner request 2026-10-13): THIS game's
// DraftKings Predictions player props, every priced strike, sorted by
// fee-inclusive EV. The slate-wide "Top prop overs" column stays capped at 10
// across all games; this is the per-game view of the same file.
//
// One pricer, one renderer: rows come from `loadGameProps` -> `propsForGame`
// (the exact function the slate scan uses) and draw through TopEdges'
// `PropRow` in its in-game mode. Nothing here re-derives a number.
//
// Owner 2026-10-13: "we dont need to list every rung of the ladders. we should
// show the one that is at 50/50 and then if they want to hit the ladder button
// then we can see all the rungs and the edges underneath it with separate DK
// buttons for each rung". So: one row per (player, stat) = the rung DK prices
// nearest 50/50 (the market's main line); its Ladder button opens every priced
// rung as a full row (sim / DK / EV / DK link each). Ladders are ordered by
// their best rung's EV so the ones carrying edge sit on top, and the button
// names that best rung so nobody has to open a ladder to learn it is there.

import { useEffect, useMemo, useState } from "react";
import { hoursSince, loadGameProps, type GamePropsResult } from "../lib/edges";
import type { JsonWeekRow } from "../lib/cfbJson";
import type { Season } from "../lib/cfbData";
import type { LegSpec } from "../lib/parlay";
import type { PropEdge } from "../lib/propEdge";
import { PropRow } from "./TopEdges";
import "../styles/dkProps.css";

/** The game this list is for — the card's identity, row and namespace. */
export type DkPropsGame = {
  /** The card key (what props_odds.json and the parlay slip key games by). */
  slug: string;
  teamA: string;
  teamB: string;
  row: JsonWeekRow;
  /** The card's own dataset namespace ("2026", "fcs-2026"). */
  season: Season;
  weekId: string;
};

const evOf = (p: PropEdge) => p.evFee ?? p.edge;

/** Every priced strike of one player's stat, headline first. */
type Ladder = {
  key: string;
  /** The rung DK prices nearest 50/50 -- the main line, what the row shows. */
  main: PropEdge;
  /** All rungs, ascending strike (the main one included). */
  rungs: PropEdge[];
  best: PropEdge;
};

/** Group rows into ladders by (player, stat, side); pick each one's main line. */
function buildLadders(props: PropEdge[]): Ladder[] {
  const by = new Map<string, PropEdge[]>();
  for (const p of props) {
    const k = `${p.player}|${p.stat}|${p.side}`;
    const a = by.get(k);
    if (a) a.push(p); else by.set(k, [p]);
  }
  const out: Ladder[] = [];
  for (const [key, rungs] of by) {
    rungs.sort((a, b) => a.line - b.line);
    // Nearest to DK's 50/50 by the market's own price; ties go to the better EV.
    const main = rungs.slice().sort((a, b) =>
      Math.abs(a.fairP - 0.5) - Math.abs(b.fairP - 0.5) || evOf(b) - evOf(a))[0];
    const best = rungs.slice().sort((a, b) => evOf(b) - evOf(a))[0];
    out.push({ key, main, rungs, best });
  }
  return out;
}

function evWords(feeModel: string | null): string {
  if (feeModel?.startsWith("dk_live")) return "EV per $1 staked at DK's ask, fees inside";
  if (feeModel === "none_published_flat2") return "EV per $1 staked, after a flat 2¢ round trip";
  return "EV per $1 staked, after fees";
}

export default function GameDkProps({ game, onAddLeg }: {
  game: DkPropsGame | undefined;
  /** Quick-add to the combo slip; omitted = no "+" on the rows. */
  onAddLeg?: (slug: string, spec: LegSpec) => void;
}) {
  const [res, setRes] = useState<GamePropsResult | null>(null);
  const [inBandOnly, setInBandOnly] = useState(true);
  const [posOnly, setPosOnly] = useState(true);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  const slug = game?.slug;
  const season = game?.season;
  const weekId = game?.weekId;
  const row = game?.row;
  const teamA = game?.teamA;
  const teamB = game?.teamB;
  useEffect(() => {
    setRes(null);
    setOpenKeys(new Set());
    if (!slug || season === undefined || !weekId || !row || !teamA || !teamB) return;
    const ctl = new AbortController();
    loadGameProps({ slug, teamA, teamB, row }, season, weekId, ctl.signal)
      .then((r) => { if (!ctl.signal.aborted) setRes(r); })
      .catch((err) => {
        if ((err as any)?.name === "AbortError") return;
        setRes({
          status: "error", listed: 0, props: [], updated: null, venue: null,
          book: null, sideOnly: null, feeModel: null,
        });
      });
    return () => ctl.abort();
  }, [slug, season, weekId, row, teamA, teamB]);

  const sorted = useMemo(
    () => (res?.props ?? []).slice().sort((a, b) => evOf(b) - evOf(a)),
    [res]
  );
  // The filters act on RUNGS: a ladder is listed when any rung passes, and
  // an open ladder shows only the rungs that pass. The main line itself is
  // never filtered away -- it is the row's identity, not a recommendation.
  const passes = (p: PropEdge) => (!inBandOnly || p.inBand) && (!posOnly || evOf(p) > 0);
  const ladders = useMemo(() => buildLadders(sorted), [sorted]);
  const shownLadders = useMemo(
    () => ladders
      .filter((l) => l.rungs.some(passes))
      .sort((a, b) => evOf(b.best) - evOf(a.best)),
    [ladders, inBandOnly, posOnly]   // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shown = useMemo(() => sorted.filter(passes), [sorted, inBandOnly, posOnly]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string) => setOpenKeys((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const chip = { padding: "2px 9px", fontSize: 11, fontWeight: 700 } as const;

  if (!game) {
    return <div className="dkprops__empty">DK lists no props for this game yet.</div>;
  }
  if (!res) {
    return <div className="dkprops__empty">Loading DK props…</div>;
  }
  if (res.listed === 0) {
    return (
      <div className="dkprops__empty">
        {res.status === "error"
          ? "DK props could not be loaded right now."
          : "DK lists no props for this game yet."}
      </div>
    );
  }
  if (res.status === "error" && !res.props.length) {
    return (
      <div className="dkprops__empty">
        DK lists {res.listed} prop{res.listed === 1 ? "" : "s"} here, but this
        game's player distributions could not be loaded to price them.
      </div>
    );
  }

  const when = res.updated
    ? new Date(res.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const age = hoursSince(res.updated);
  const venue = res.venue === "dkex" ? "DK Predictions" : (res.venue ?? res.book);
  const foot: string[] = [];
  if (venue) foot.push(`${venue}${when ? `, as of ${when}` : ""}`);
  else if (when) foot.push(`as of ${when}`);
  if (age !== null && age > 36) foot.push("(stale)");
  if (res.sideOnly === "over") foot.push("overs only — this venue lists no under contract");
  if (res.feeModel?.startsWith("dk_live")) foot.push("price = DK's ask with fees inside");
  if (res.feeModel === "none_published_flat2") {
    foot.push("EV after a flat 2¢ round trip (venue publishes no fee schedule)");
  }
  const evTitle = evWords(res.feeModel);

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div className="dkprops__head" role="group" aria-label="DK props filters">
        <button
          type="button" className="ui-btn" style={chip}
          data-on={inBandOnly ? "true" : "false"} aria-pressed={inBandOnly}
          title="Hide tails: sim P(over) outside the publisher's band"
          onClick={() => setInBandOnly((v) => !v)}
        >
          In band only
        </button>
        <button
          type="button" className="ui-btn" style={chip}
          data-on={posOnly ? "true" : "false"} aria-pressed={posOnly}
          title="Only rows with positive EV after fees"
          onClick={() => setPosOnly((v) => !v)}
        >
          +EV only
        </button>
        <span className="dkprops__count">
          {shownLadders.length} of {ladders.length} ladders · {shown.length} of {sorted.length} rungs
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="dkprops__empty">
          {sorted.length === 0
            ? `DK lists ${res.listed} prop${res.listed === 1 ? "" : "s"} here; none join a sim player distribution.`
            : posOnly && sorted.filter((p) => !inBandOnly || p.inBand).every((p) => evOf(p) <= 0)
              ? "Every priced over is negative EV."
              : `Every ${posOnly ? "+EV " : "priced "}over here is a tail — turn "In band only" off to see them.`}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
          <div className="dkprops__cols" aria-hidden="true">
            <span>player · bet · DK price</span>
            <span>sim</span>
            <span>DK</span>
            <span>EV</span>
            <span />
          </div>
          {shownLadders.map((l) => {
            const open = openKeys.has(l.key);
            const rungs = open ? l.rungs.filter((r) => r === l.main || passes(r)) : [];
            const side = l.main.side === "over" ? "o" : "u";
            return (
              <div key={l.key} className="dkprops__ladder" data-open={open ? "true" : "false"}>
                <PropRow
                  p={l.main}
                  inGame
                  evTitle={evTitle}
                  onAddLeg={onAddLeg}
                  ladder={l.rungs.length > 1 ? {
                    n: l.rungs.length, open, onToggle: () => toggle(l.key),
                    bestEv: evOf(l.best), bestLine: l.best.line,
                  } : undefined}
                />
                {open && (
                  <div className="dkprops__rungs" role="group"
                    aria-label={`${l.main.player} ${l.main.statShort} ladder`}>
                    <div className="dkprops__rungs-note">
                      every priced strike on {l.main.player}&rsquo;s {l.main.statShort} ladder
                      {" · "}<b>{side}{l.main.line}</b> is DK&rsquo;s closest to 50/50
                      {rungs.length < l.rungs.length && ` · ${l.rungs.length - rungs.length} hidden by the filters`}
                    </div>
                    {rungs.map((r) => (
                      <div
                        key={`${r.player}:${r.stat}:${r.line}`}
                        className="dkprops__rung"
                        data-main={r === l.main ? "true" : "false"}
                      >
                        <PropRow p={r} inGame evTitle={evTitle} onAddLeg={onAddLeg} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {foot.length > 0 && <div className="dkprops__foot">{foot.join(" · ")}</div>}
    </div>
  );
}
