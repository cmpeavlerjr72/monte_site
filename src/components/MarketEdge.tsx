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
import { rungAt, type KalshiGame } from "../lib/kalshi";
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

type Row = {
  key: string;
  market: string;             // "Total u49.5"
  simP: number | null;
  mktP: number | null;
  approxNote?: string;
};

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Fair American odds, shown under the percentage as the bettor's unit. */
function american(p: number): string {
  if (!(p > 0 && p < 1)) return "—";
  return p >= 0.5 ? String(Math.round((-p / (1 - p)) * 100)) : `+${Math.round(((1 - p) / p) * 100)}`;
}


/** Per-seed counters over compact.json's index-aligned point columns. */
export type SeedCounts = {
  n: number;
  totalUnder: (L: number) => number;
  totalOver: (L: number) => number;
  marginOver: (m: number) => number;
};

export function makeSeedCounts(compact: { A_pts: number[]; B_pts: number[] } | null | undefined): SeedCounts | null {
  if (!compact) return null;
  const n = Math.min(compact.A_pts.length, compact.B_pts.length);
  if (!n) return null;
  return {
    n,
    totalUnder: (L) => { let k = 0; for (let i = 0; i < n; i++) if (compact.A_pts[i] + compact.B_pts[i] < L) k++; return k / n; },
    totalOver: (L) => { let k = 0; for (let i = 0; i < n; i++) if (compact.A_pts[i] + compact.B_pts[i] > L) k++; return k / n; },
    marginOver: (m) => { let k = 0; for (let i = 0; i < n; i++) if (compact.A_pts[i] - compact.B_pts[i] > m) k++; return k / n; },
  };
}

/**
 * Build the market rows. Pure, so the exact numbers the card prints can be
 * verified straight off the seed arrays without rendering anything.
 */
export function buildMarketRows({
  counts, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi,
}: {
  counts: SeedCounts | null;
  teamA: string; teamB: string;
  bookSpread?: number; bookTotal?: number;
  simMargin?: number; simTotal?: number; pHome?: number;
  kalshi?: KalshiGame;
}): Row[] {
  const out: Row[] = [];

    /* ---- WIN: side = whoever the sim favours ---- */
    if (typeof pHome === "number") {
      const homeFav = pHome >= 0.5;
      const team = homeFav ? teamA : teamB;
      const simP = homeFav ? pHome : 1 - pHome;
      const mkt = homeFav ? kalshi?.winner.teamA_price : kalshi?.winner.teamB_price;
      out.push({ key: "win", market: `Win · ${team}`, simP, mktP: mkt ?? null });
    }

    /* ---- SPREAD: anchored to the book's line ---- */
    if (Number.isFinite(bookSpread) && counts && Number.isFinite(simMargin)) {
      const L = bookSpread as number;            // home-perspective
      const needed = -L;                          // home must win by more than this
      const pHomeCover = counts.marginOver(needed);
      // Which side does the sim's median margin land on?
      const simLeansHome = (simMargin as number) > needed;
      const side = simLeansHome
        ? { label: `${teamA} ${signed(L)}`, simP: pHomeCover }
        : { label: `${teamB} ${signed(-L)}`, simP: 1 - pHomeCover };

      const match = rungAt(kalshi?.spread_ladder, L);
      let mktP: number | null = null;
      let approxNote: string | undefined;
      if (match) {
        // Ladder rungs are P(home covers line); mirror for the away side.
        mktP = simLeansHome ? match.rung.yes_price : 1 - match.rung.yes_price;
        if (match.approx) approxNote = `@Kalshi ${signed(match.rung.line)}`;
      }
      out.push({ key: "spread", market: side.label, simP: side.simP, mktP, approxNote });
    }

    /* ---- TOTAL: anchored to the book's line ---- */
    if (Number.isFinite(bookTotal) && counts && Number.isFinite(simTotal)) {
      const L = bookTotal as number;
      const under = (simTotal as number) < L;
      const simP = under ? counts.totalUnder(L) : counts.totalOver(L);

      const match = rungAt(kalshi?.total_ladder, L);
      let mktP: number | null = null;
      let approxNote: string | undefined;
      if (match) {
        // Ladder rungs are P(over line).
        mktP = under ? 1 - match.rung.yes_price : match.rung.yes_price;
        if (match.approx) approxNote = `@Kalshi ${match.rung.line}`;
      }
      out.push({
        key: "total",
        market: `Total ${under ? "u" : "o"}${L}`,
        simP, mktP, approxNote,
      });
    }

  return out;
}

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

  const rows: Row[] = useMemo(
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
          <div style={headCell}>Sim</div>
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
  row: Row;
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
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pct(row.simP)}</div>
            <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{american(row.simP)}</div>
          </>
        )}
      </div>

      <div style={numCell}>
        {row.mktP === null ? (
          <span style={{ color: "var(--muted)" }}>—</span>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pct(row.mktP)}</div>
            <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{american(row.mktP)}</div>
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
