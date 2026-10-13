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

  const slug = game?.slug;
  const season = game?.season;
  const weekId = game?.weekId;
  const row = game?.row;
  const teamA = game?.teamA;
  const teamB = game?.teamB;
  useEffect(() => {
    setRes(null);
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
  const shown = useMemo(
    () => sorted.filter((p) => (!inBandOnly || p.inBand) && (!posOnly || evOf(p) > 0)),
    [sorted, inBandOnly, posOnly]
  );

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
          {shown.length} of {sorted.length} priced
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
          {shown.map((p) => (
            <PropRow
              key={`${p.player}:${p.stat}:${p.line}`}
              p={p}
              inGame
              evTitle={evTitle}
              onAddLeg={onAddLeg}
            />
          ))}
        </div>
      )}

      {foot.length > 0 && <div className="dkprops__foot">{foot.join(" · ")}</div>}
    </div>
  );
}
