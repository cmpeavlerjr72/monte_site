// src/components/MarketEdge.tsx
//
// The card's market block, reframed around THE BOOK LINE.
//
// The old block compared two different things — the sim's median total against
// Kalshi's own chosen strike — which is not a bet anyone can place. Every row
// here is anchored to the number the book is actually offering, states the
// side the sim leans, and then quotes BOTH sources' price for that exact bet.
// Only then is the difference an edge.
//
// Sim probabilities come from compact.json's per-seed arrays — a straight
// count over 200 simulated games, not a normal approximation of the median and
// a spread. P(total < 49.5) is literally `count(A+B < 49.5) / nsims`.

import { useEffect, useMemo, useRef, useState } from "react";
import { getCompactCached, type CompactJson, type JsonWeekRow } from "../lib/cfbJson";
import { type KalshiGame } from "../lib/kalshi";
import {
  buildMarketRows, makeSeedCounts, rowEdge, americanOdds, pctText,
  type MarketRow,
} from "../lib/marketEdge";
import type { Season } from "../lib/cfbData";
import { Skeleton } from "./Skeleton";

type Props = {
  row: JsonWeekRow;
  season: Season;
  teamA: string;              // home
  teamB: string;              // away
  /** Book lines from summary.json (current medians). */
  bookSpread?: number;        // home-perspective, negative = home favored
  bookTotal?: number;
  /** Sim medians, for choosing which side of the line the sim leans. */
  simMargin?: number;         // home - away
  simTotal?: number;
  pHome?: number;             // sim P(home wins), exact from summary
  kalshi?: KalshiGame;
};

export default function MarketEdge({
  row, season, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi,
}: Props) {
  const [compact, setCompact] = useState<CompactJson | null>(null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  // The block is visible by default on every card, so an eager fetch would
  // pull one compact per game on load. Gate on visibility: a 60-game slate
  // then costs only what is actually on screen.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || compact || failed) return;
    let alive = true;
    getCompactCached(row, season)
      .then((c) => { if (alive) setCompact(c); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [inView, row, season, compact, failed]);

  /** Per-seed counters. Half-point lines mean no seed ever sits on the line. */
  const counts = useMemo(() => makeSeedCounts(compact), [compact]);

  const rows: MarketRow[] = useMemo(
    () => buildMarketRows({ counts, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi }),
    [pHome, teamA, teamB, kalshi, bookSpread, bookTotal, counts, simMargin, simTotal]
  );

  const cols = "minmax(0,1fr) 62px 62px 58px";
  const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
  const headCell = { ...numCell, fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 } as const;

  return (
    <div ref={hostRef} style={{ marginTop: 2, paddingTop: 7, borderTop: "1px solid var(--border)" }}>
      {!compact && !failed ? (
        <div style={{ display: "grid", gap: 5 }}>
          <Skeleton height={11} width="45%" radius={4} />
          {[0, 1, 2].map((i) => <Skeleton key={i} height={16} radius={4} />)}
        </div>
      ) : !rows.length ? (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>No market lines for this game.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: "4px 8px", alignItems: "center" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: "var(--muted)", textTransform: "uppercase" }}>
            Market
          </div>
          <div style={headCell} title={counts ? `${counts.n.toLocaleString("en-US")} simulated games` : undefined}>Sim</div>
          <div style={headCell}>Kalshi</div>
          <div style={headCell} title="Sim probability minus Kalshi implied">Edge</div>

          {rows.map((r) => {
            const edge = r.simP !== null && r.mktP !== null ? r.simP - r.mktP : null;
            return (
              <MarketRow key={r.key} row={r} edge={edge} numCell={numCell} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MarketRow({ row, edge, numCell }: {
  row: MarketRow;
  edge: number | null;
  numCell: React.CSSProperties;
}) {
  return (
    <>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.market}
        </div>
        {row.approxNote && (
          <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{row.approxNote}</div>
        )}
      </div>

      <div style={numCell}>
        {row.simP === null ? (
          <span style={{ color: "var(--muted)" }}>—</span>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pctText(row.simP)}</div>
            <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{americanOdds(row.simP)}</div>
          </>
        )}
      </div>

      <div style={numCell}>
        {row.mktP === null ? (
          <span style={{ color: "var(--muted)" }}>—</span>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pctText(row.mktP)}</div>
            <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{americanOdds(row.mktP)}</div>
          </>
        )}
      </div>

      <div style={numCell}>
        {edge === null ? (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
        ) : (
          <span
            style={{
              display: "inline-block", padding: "2px 6px", borderRadius: 6,
              fontSize: 11.5, fontWeight: 800, fontVariantNumeric: "tabular-nums",
              color: edge >= 0 ? "var(--pos)" : "var(--neg)",
              background: edge >= 0
                ? "color-mix(in oklab, var(--pos) 14%, var(--card))"
                : "color-mix(in oklab, var(--neg) 14%, var(--card))",
            }}
          >
            {edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1)}
          </span>
        )}
      </div>
    </>
  );
}
