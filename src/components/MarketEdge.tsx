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
//
// DISPLAY (2026-08-28, the "bar test"): at rest a row is the BET IN WORDS plus
// ONE number — the edge, in cents — with a signed bar on a shared zero line so
// "which of these three is the play" is preattentive. The four-number grid it
// replaced (sim %, sim odds, Kalshi %, Kalshi odds, edge) showed the
// arithmetic and ran together; the same failure the Team Stats panel had
// before its v3 redesign, and the same fix: the derivation moves into a tap
// popover written in words. Nothing here changes the math — `buildMarketRows`
// is untouched and the label is rebuilt from that row's STRUCTURED fields
// (sideTeam / line / side), never by re-parsing its string.

import { useEffect, useMemo, useRef, useState } from "react";
import { getCompactCached, type CompactJson, type JsonWeekRow } from "../lib/cfbJson";
import { type KalshiGame } from "../lib/kalshi";
import {
  buildMarketRows, makeSeedCounts, americanOdds, pctText, signedNum,
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

/* Geometry. Rows are a FIXED height so the popover can be placed by index
   arithmetic instead of a measurement effect (one less thing for the render
   loop guard to police), and so a long school name can never reflow the block. */
const ROW_H = 40;
const HEAD_H = 17;
/** Edge scale: ±20¢ full-width, fixed so bars compare ACROSS cards. */
const EDGE_DOMAIN = 0.20;
const BAR_W = 58;

/** House formatting, same as the Team Stats panel. */
const cents = (p: number): string => `${Math.round(p * 100)}¢`;
const signedCents = (e: number): string =>
  `${e > 0 ? "+" : "−"}${Math.abs(Math.round(e * 100))}¢`;

/** The bet, split so truncation eats the school name and never the number. */
function betWords(r: MarketRow): { name: string; tag: string; long: string } {
  if (r.key === "win") {
    const t = r.sideTeam ?? "";
    return { name: t, tag: "ML", long: `${t} to win` };
  }
  if (r.key === "spread" && typeof r.line === "number") {
    const t = r.sideTeam ?? "";
    const l = signedNum(r.line);
    return { name: t, tag: l, long: `${t} ${l}` };
  }
  if (r.key === "total" && typeof r.line === "number") {
    const w = r.side === "under" ? "Under" : "Over";
    return { name: w, tag: String(r.line), long: `${w} ${r.line} points` };
  }
  return { name: r.market, tag: "", long: r.market };
}

/**
 * Fair American odds in parentheses — but only where they mean anything. At
 * 99½¢ the fair price is "-19900", which is noise, not information.
 */
const odds = (p: number): string => (p > 0.02 && p < 0.98 ? ` (${americanOdds(p)})` : "");

/** The full derivation, in words — everything the resting row leaves out. */
function verdictText(r: MarketRow, edge: number | null, home: string): string {
  const { long, tag } = betWords(r);
  if (r.simP === null) return `${long} — no simulated price for this line.`;
  const sim = `Sim: ${pctText(r.simP)}${odds(r.simP)}`;
  if (r.mktP === null) return `${long} — ${sim} · Kalshi is not quoting this line.`;
  const mkt = `Kalshi: ${cents(r.mktP)}${odds(r.mktP)}`;
  const parts = [`${long} — ${sim} · ${mkt} · Edge: ${signedCents(edge ?? 0)}.`];
  if (r.approxNote) {
    // The note carries Kalshi's own strike, which on a SPREAD is written
    // home-perspective — quoting a bare "-10.5" under a row that reads
    // "Jacksonville State +10" is what made the old block confusing. Name the
    // home team so the number is unambiguous instead of re-orienting it.
    const strike = r.approxNote.replace(/^@Kalshi\s*/, "") || r.approxNote;
    parts.push(
      r.key === "spread"
        ? `Kalshi lists no ${tag} — priced off its nearest strike, ${home} ${strike}.`
        : `Kalshi lists no ${tag} — priced off its nearest strike, ${strike}.`
    );
  }
  parts.push("Edge is before Kalshi's taker fee.");
  return parts.join(" ");
}

export default function MarketEdge({
  row, season, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi,
}: Props) {
  const [compact, setCompact] = useState<CompactJson | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
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

  const openIdx = rows.findIndex((r) => r.key === open);
  const openRow = openIdx >= 0 ? rows[openIdx] : null;

  return (
    <div
      ref={hostRef}
      data-market-block
      style={{ marginTop: 2, paddingTop: 7, borderTop: "1px solid var(--border)", position: "relative" }}
    >
      {!compact && !failed ? (
        <div style={{ display: "grid", gap: 6 }}>
          <Skeleton height={10} width="45%" radius={4} />
          {[0, 1, 2].map((i) => <Skeleton key={i} height={ROW_H - 8} radius={6} />)}
        </div>
      ) : !rows.length ? (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>No market lines for this game.</div>
      ) : (
        <>
          {/* The words legend, said ONCE: what the column of numbers is and
              whose it is. Position carries it from there. */}
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 8, height: HEAD_H, padding: "0 7px", fontSize: 9.5, fontWeight: 800,
            letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)",
          }}>
            <span>Market</span>
            <span style={{ fontWeight: 700 }}>Edge vs Kalshi</span>
          </div>

          {rows.map((r) => (
            <BetRow
              key={r.key}
              row={r}
              home={teamA}
              on={r.key === open}
              onToggle={() => setOpen((k) => (k === r.key ? null : r.key))}
            />
          ))}

          {openRow && (
            <div
              role="status"
              style={{
                position: "absolute", left: 0, right: 0, zIndex: 3,
                // Directly below the tapped row; the LAST row instead pins the
                // popover to the top of the stack, so the verdict never runs
                // off the bottom of the card and never covers the row you just
                // tapped (which would make tap-again-to-close unreachable).
                top: openIdx === rows.length - 1 && rows.length > 1
                  ? HEAD_H + 7
                  : HEAD_H + 7 + (openIdx + 1) * ROW_H,
                background: "var(--card)", border: "1px solid var(--brand)",
                borderRadius: 8, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.5,
                color: "var(--text)", boxShadow: "0 4px 14px var(--shadow)",
              }}
            >
              {verdictText(openRow, rowEdgeOf(openRow), teamA)}
              <button
                type="button" className="ui-btn" onClick={() => setOpen(null)}
                style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10.5 }}
              >
                Close
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const rowEdgeOf = (r: MarketRow): number | null =>
  r.simP !== null && r.mktP !== null ? r.simP - r.mktP : null;

/**
 * One bet, at rest: the words, a signed bar on the shared zero line, and the
 * edge in cents. Three elements, one number.
 */
function BetRow({ row, home, on, onToggle }: {
  row: MarketRow; home: string; on: boolean; onToggle: () => void;
}) {
  const edge = rowEdgeOf(row);
  const { name, tag } = betWords(row);
  const whole = edge === null ? null : Math.round(edge * 100);
  // A rounded-to-zero edge is not a direction; it wears the neutral token so a
  // green "+0¢" never reads as a bet.
  const tone = whole === null || whole === 0
    ? "var(--muted)"
    : whole > 0 ? "var(--pos)" : "var(--neg)";
  const frac = edge === null ? 0 : Math.min(1, Math.abs(edge) / EDGE_DOMAIN);
  const barLen = edge === null || whole === 0 ? 0 : Math.max(2, Math.round(frac * (BAR_W / 2)));
  const pos = (edge ?? 0) > 0;
  const half = BAR_W / 2;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={on}
      aria-label={verdictText(row, edge, home)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", height: ROW_H, padding: "0 6px",
        border: `1px solid ${on ? "var(--brand)" : "transparent"}`,
        borderRadius: 8, background: on ? "color-mix(in oklab, var(--brand) 7%, var(--card))" : "transparent",
        color: "var(--text)", textAlign: "left", font: "inherit", cursor: "pointer",
      }}
    >
      {/* THE BET, in words. The school name is the only part allowed to
          truncate — the line number sits in its own non-shrinking span, which
          is what the old grid got wrong ("North Carolin…" lost the +7.5). */}
      <span style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0, flex: 1 }}>
        <span style={{
          fontSize: 13, fontWeight: 600, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
        </span>
        {tag && (
          <span style={{
            flex: "0 0 auto", fontSize: 13, fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            // An approximate strike keeps its mark and explains itself on tap,
            // the same convention the grading pills use for a provisional call.
            textDecoration: row.approxNote ? "underline dotted" : undefined,
            textUnderlineOffset: 3,
          }}>
            {tag}
          </span>
        )}
      </span>

      {/* The shape: one shared zero line, ±20¢, so magnitude is preattentive
          and comparable across every card on the slate. */}
      <span style={{ position: "relative", flex: "0 0 auto", width: BAR_W, height: 14 }} aria-hidden="true">
        {/* The zero tick runs PAST the bar on both ends so it reads as the axis
            rather than as a cap on the bar butting into it. */}
        <span style={{
          position: "absolute", left: half, top: 0, width: 1, height: 14,
          background: "var(--muted)", opacity: 0.8,
        }} />
        {barLen > 0 && (
          <span style={{
            position: "absolute", top: 4, height: 6,
            left: pos ? half : half - barLen, width: barLen,
            background: tone,
            borderRadius: pos ? "0 3px 3px 0" : "3px 0 0 3px",
          }} />
        )}
      </span>

      {/* THE number — one chip, the decision. */}
      <span style={{
        flex: "0 0 auto", minWidth: 46, textAlign: "center",
        padding: "3px 6px", borderRadius: 6,
        fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
        color: tone,
        background: whole === null || whole === 0
          ? "var(--fill)"
          : `color-mix(in oklab, ${tone} 14%, var(--card))`,
      }}>
        {edge === null ? "—" : whole === 0 ? "0¢" : signedCents(edge)}
      </span>
    </button>
  );
}
