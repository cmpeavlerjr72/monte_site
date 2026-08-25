// src/components/TopEdges.tsx
//
// The slate's ten biggest edges, across every game and all three markets.
//
// Ranked by SIGNED edge, not absolute: the question this answers is "where
// does the sim like a bet more than Kalshi does", so a large negative edge is
// information for the card, not a headline here.
//
// Each row is a real, placeable bet — the book's line, one side of it, both
// sources' price for that exact bet — because that is the only comparison
// where the difference means anything.

import { useMemo } from "react";
import { rankEdges, pricedRowCount, type GameEdges } from "../lib/edges";
import { americanOdds, pctText } from "../lib/marketEdge";
import { getTeamLogo } from "../utils/teamLogo";
import { Skeleton } from "./Skeleton";

type Props = {
  edges: Map<string, GameEdges> | null;
  loading: boolean;
  onPick: (slug: string) => void;
  onClose: () => void;
};

function Logos({ teams }: { teams: string[] }) {
  const found = teams.map((t) => getTeamLogo(t)).filter(Boolean) as string[];
  if (!found.length) return <span style={{ width: 30, flexShrink: 0 }} aria-hidden />;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, width: 30 }}>
      {found.map((src, i) => (
        <img key={i} src={src} alt="" width={19} height={19} loading="lazy"
          style={{ objectFit: "contain", marginLeft: i ? -8 : 0, zIndex: found.length - i }} />
      ))}
    </span>
  );
}

/** Short game label: away @ home, trimmed so long names do not wrap the row. */
const shortName = (s: string) => (s.length > 15 ? `${s.slice(0, 14)}…` : s);

export default function TopEdges({ edges, loading, onPick, onClose }: Props) {
  const top = useMemo(() => (edges ? rankEdges(edges, 10) : []), [edges]);
  const counts = useMemo(() => (edges ? pricedRowCount(edges) : null), [edges]);

  return (
    <section className="top-edges" role="dialog" aria-label="Top edges on this slate">
      <header className="top-edges__head">
        <span style={{ fontWeight: 800, color: "var(--brand-text)", letterSpacing: 0.2 }}>
          Top edges
        </span>
        <span className="parlay-chip" style={{ fontSize: 11 }}>
          {loading ? "computing…" : `${top.length} shown`}
        </span>
        <button type="button" className="ui-btn" onClick={onClose}
          style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}>
          Close
        </button>
      </header>

      <div className="top-edges__body">
        {loading ? (
          <div style={{ display: "grid", gap: 6 }}>
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={34} radius={8} />)}
          </div>
        ) : !top.length ? (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 2px" }}>
            No edges could be priced — Kalshi is not quoting this slate yet.
          </div>
        ) : (
          <>
            <div className="top-edges__row top-edges__row--head">
              <span />
              <span />
              <span>Game</span>
              <span>Market</span>
              <span style={{ textAlign: "right" }}>Sim</span>
              <span style={{ textAlign: "right" }}>Kalshi</span>
              <span style={{ textAlign: "right" }}>Edge</span>
            </div>

            {top.map((e, i) => (
              <button
                key={`${e.slug}:${e.row.key}`}
                type="button"
                className="top-edges__row top-edges__row--item"
                onClick={() => onPick(e.slug)}
                title={`Go to ${e.teamB} @ ${e.teamA}`}
              >
                <span className="top-edges__rank">{i + 1}</span>
                <Logos teams={[e.teamB, e.teamA]} />
                <span className="top-edges__game">
                  {shortName(e.teamB)} <span style={{ color: "var(--muted)" }}>@</span> {shortName(e.teamA)}
                </span>
                <span className="top-edges__market">{e.row.market}</span>
                <span className="top-edges__num">
                  <b>{pctText(e.row.simP!)}</b>
                  <i>{americanOdds(e.row.simP!)}</i>
                </span>
                <span className="top-edges__num">
                  <b>{pctText(e.row.mktP!)}</b>
                  <i>{americanOdds(e.row.mktP!)}</i>
                </span>
                <span className="top-edges__edge" data-sign={e.edge >= 0 ? "pos" : "neg"}>
                  {e.edge >= 0 ? "+" : ""}{(e.edge * 100).toFixed(1)}
                </span>
              </button>
            ))}

            {counts && counts.priced < counts.total && (
              <div className="top-edges__foot">
                {counts.priced} of {counts.total} markets could be priced — the rest have no
                matching Kalshi line.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
