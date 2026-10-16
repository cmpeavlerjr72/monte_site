// src/components/MarketGrid.tsx (the V2 board's market block; MarketEdge.tsx stays for the classic board)
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
// count over the simulated games, not a normal approximation of the median and
// a spread. P(total < 49.5) is literally `count(A+B < 49.5) / nsims`.
//
// DISPLAY (2026-10-12, sportsbook grammar): the block IS the card's team rows.
// A 4-column grid — team | SPREAD | TOTAL | ML — with the away team on top and
// the home team below, exactly the row-pair every sportsbook prints. Each
// market has ONE filled cell: the sim's side, carrying the line and ONE number
// (the edge in cents). The other side's cell shows only the opposite line, in
// muted ink, so the reader can see what the market is without a second number.
// Totals follow the book convention: Over on the top row, Under below. The
// derivation (sim %, Kalshi price, fair odds, approximate strike) lives in the
// tap popover, written in words. Nothing here changes the math —
// `buildMarketRows` is untouched and every cell is rebuilt from that row's
// STRUCTURED fields (sideTeam / line / side), never by re-parsing its string.
//
// History: 2026-08-28 "bar test" rows (bet in words + signed bar + edge chip)
// were the previous form; the per-card reference sentence and per-row REF tags
// that rode on them were replaced by ONE slate-level line on the page and a
// dotted caption here (owner brief 2026-10-12: words said once, never per card).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getCompactCached, type CompactJson, type JsonWeekRow, type WeekEngine,
} from "../lib/cfbJson";
// The week's MARKET-ELIGIBILITY policy. Reference-only families keep every
// number on this block — the sim price, the fair odds, the edge in cents —
// and lose only the claim that the site is recommending them.
import { displayOnly, decisionReason } from "../lib/edgeRules";
import { type KalshiGame } from "../lib/kalshi";
import {
  buildMarketRows, makeSeedCounts, americanOdds, pctText, signedNum,
  type MarketRow,
} from "../lib/marketEdge";
import type { Season } from "../lib/cfbData";
import { Skeleton } from "./Skeleton";

/** Which of the two team rows a graded pick sits on. "B" = away (top). */
export type GridSlot = "A" | "B";
/** One graded pick, placed on the cell it was graded on. */
export type GridGrade = {
  slot: GridSlot;
  result: "win" | "loss" | "push";
  /** Graded from a live final; verified on re-publish. Dotted glyph. */
  provisional?: boolean;
};

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
  /** The week's engine block, for its `decision` policy alone. Null on every
   *  week published before the policy existed, which draws nothing new. */
  engine?: WeekEngine | null;
  condensed?: boolean;
  /** The team cells, composed by the card (logo, name, score). B = away/top. */
  teamCellB: ReactNode;
  teamCellA: ReactNode;
  /** Final-state grading, one per market at most. */
  grades?: { spread?: GridGrade; total?: GridGrade; ml?: GridGrade };
  /** The game is final: Kalshi no longer quotes it, so the edge chip (a
   *  wall of "—") gives way to the graded outline. Lines stay. */
  settled?: boolean;
  /** Rendered straight under the grid, inside the same positioned box, so the
   *  verdict popover can sit over it (the win-prob bar). */
  children?: ReactNode;
};

type MktKey = "spread" | "total" | "win";
/** Column order, sportsbook convention. */
const COLS: { key: MktKey; cap: string }[] = [
  { key: "spread", cap: "Spread" },
  { key: "total", cap: "Total" },
  { key: "win", cap: "ML" },
];

/** House formatting, same as the Team Stats panel. */
const cents = (p: number): string => `${Math.round(p * 100)}¢`;
const signedCents = (e: number): string =>
  `${e > 0 ? "+" : "−"}${Math.abs(Math.round(e * 100))}¢`;
/** A spread as a book prints it: U+2212 minus, "PK" at zero. */
const spreadText = (n: number): string =>
  n === 0 ? "PK" : n > 0 ? `+${n}` : `−${Math.abs(n)}`;

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

/** The full derivation, in words — everything the resting cell leaves out. */
function verdictText(r: MarketRow, edge: number | null, home: string): string {
  const { long, tag } = betWords(r);
  if (r.simP === null) return `${long} — no simulated price for this line.`;
  const sim = `Sim: ${pctText(r.simP)}${odds(r.simP)}`;
  if (r.mktP === null) return `${long} — ${sim} · Kalshi is not quoting this line.`;
  const mkt = `Kalshi: ${cents(r.mktP)}${odds(r.mktP)}`;
  const parts = [`${long} — ${sim} · ${mkt} · Edge: ${signedCents(edge ?? 0)}.`];
  if (r.approxNote) {
    // The note carries Kalshi's own strike, which on a SPREAD is written
    // home-perspective. Name the home team so the number is unambiguous
    // instead of re-orienting it.
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

const rowEdgeOf = (r: MarketRow): number | null =>
  r.simP !== null && r.mktP !== null ? r.simP - r.mktP : null;

/**
 * The card's team rows + market grid. Exported under the old default name
 * too, so the import site reads the same.
 */
export default function MarketGrid({
  row, season, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi,
  engine = null, condensed = false, teamCellA, teamCellB, grades, settled = false, children,
}: Props) {
  const [compact, setCompact] = useState<CompactJson | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<MktKey | null>(null);
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

  /* Tap anywhere outside the block closes the verdict, like any sportsbook
     bet-slip popover; Escape too. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = hostRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Per-seed counters. Half-point lines mean no seed ever sits on the line. */
  const counts = useMemo(() => makeSeedCounts(compact), [compact]);

  const rows: MarketRow[] = useMemo(
    () => buildMarketRows({ counts, teamA, teamB, bookSpread, bookTotal, simMargin, simTotal, pHome, kalshi }),
    [pHome, teamA, teamB, kalshi, bookSpread, bookTotal, counts, simMargin, simTotal]
  );
  const byKey = useMemo(() => {
    const m = new Map<MktKey, MarketRow>();
    for (const r of rows) m.set(r.key as MktKey, r);
    return m;
  }, [rows]);

  /* THE WEEK'S MARKET-ELIGIBILITY POLICY. Marked ONCE per card, on the column
     caption (dotted) and as a quieter tint on the filled cell; the sentence
     itself is said once for the whole slate, by the page. */
  const refKeys = useMemo(
    () => new Set(COLS.map((c) => c.key).filter((k) => displayOnly(k, engine))),
    [engine]
  );
  const noteReason = decisionReason(engine);

  /* A skeleton only while a fetch is actually running (2026-10-16). Before the
     card scrolls into view nothing is in flight, so its cells print the book
     line plainly instead of a grey bar that a reader (or a full-page capture)
     would take for a stuck load. A failed fetch is the same plain line. */
  const loading = !compact && !failed && inView;
  const openRow = open ? byKey.get(open) ?? null : null;

  const cellW = condensed ? 48 : 56;
  const cellH = condensed ? 34 : 40;

  /** Which row the sim's side of a market is on, or null when absent. */
  const simSlot = (key: MktKey, r: MarketRow | undefined): GridSlot | null => {
    if (!r) return null;
    if (key === "total") return r.side === "under" ? "A" : "B";
    return r.sideTeam === teamA ? "A" : r.sideTeam === teamB ? "B" : null;
  };

  /** The line a given row's cell prints for a market. */
  const lineFor = (key: MktKey, r: MarketRow | undefined, slot: GridSlot): string => {
    if (key === "total") {
      const L = r?.line ?? bookTotal;
      if (typeof L !== "number" || !Number.isFinite(L)) return "";
      return `${slot === "B" ? "O" : "U"} ${L}`;
    }
    if (key === "spread") {
      if (r && typeof r.line === "number") {
        const mine = simSlot(key, r) === slot;
        return spreadText(mine ? r.line : -r.line);
      }
      if (typeof bookSpread === "number" && Number.isFinite(bookSpread)) {
        // Home-perspective book line, before the sim row exists (loading).
        return spreadText(slot === "A" ? bookSpread : -bookSpread);
      }
      return "";
    }
    // ML has no line; once the chip is gone (final) the sim's side still
    // needs a word for its outline to sit around.
    return settled && r && simSlot(key, r) === slot ? "ML" : "";
  };

  const cell = (key: MktKey, slot: GridSlot) => {
    const r = byKey.get(key);
    const mine = simSlot(key, r) === slot;
    const grade = key === "win" ? grades?.ml : key === "spread" ? grades?.spread : grades?.total;
    const g = grade && grade.slot === slot ? grade : null;
    const pending = loading && key !== "win";
    const edge = r && mine ? rowEdgeOf(r) : null;
    return (
      <MarketCell
        key={`${key}${slot}`}
        line={lineFor(key, r, slot)}
        filled={mine && !pending}
        chip={mine && !pending && !settled}
        edge={edge}
        hasRow={Boolean(r)}
        refOnly={refKeys.has(key)}
        grade={g}
        on={open === key && mine}
        pending={pending}
        h={cellH}
        dotted={Boolean(mine && r?.approxNote)}
        onClick={r ? () => setOpen((k) => (k === key ? null : key)) : undefined}
        label={r ? verdictText(r, rowEdgeOf(r), teamA) : undefined}
      />
    );
  };

  const anyMarket = rows.length > 0 || (!compact && !failed);

  return (
    <div ref={hostRef} data-market-block style={{ display: "grid", gap: condensed ? 6 : 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(0,1fr) repeat(3, ${cellW}px)`,
          columnGap: 4, rowGap: condensed ? 4 : 5,
          alignItems: "center", position: "relative",
        }}
      >
        {/* Column captions: the words, said once. A reference-only family's
            caption wears a dotted underline; its cell popover says why. */}
        <div />
        {COLS.map((c) => (
          <div
            key={c.key}
            title={refKeys.has(c.key) && noteReason ? `Reference only this week. ${noteReason}` : undefined}
            style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
              textTransform: "uppercase", color: "var(--muted)", textAlign: "center",
              lineHeight: "12px", visibility: anyMarket ? "visible" : "hidden",
            }}
          >
            <span style={refKeys.has(c.key) ? { textDecoration: "underline dotted", textUnderlineOffset: 2 } : undefined}>
              {c.cap}
            </span>
          </div>
        ))}

        {teamCellB}
        {COLS.map((c) => cell(c.key, "B"))}
        {teamCellA}
        {COLS.map((c) => cell(c.key, "A"))}
        {/* ONE popover surface, under the grid, over whatever sits below it. */}
        {openRow && (
          <div
            role="status"
            data-stop
            style={{
              position: "absolute", left: 0, right: 0, zIndex: 5,
              top: "calc(100% + 4px)",
              background: "var(--card)", border: "1px solid var(--brand)",
              borderRadius: 8, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.5,
              color: "var(--text)", boxShadow: "0 4px 14px var(--shadow)",
            }}
          >
            {verdictText(openRow, rowEdgeOf(openRow), teamA)}
            {refKeys.has(openRow.key as MktKey) && noteReason && (
              <div style={{ marginTop: 5, color: "var(--muted)" }}>
                Shown for reference — not one of this week&apos;s picks.
                {" "}{noteReason}
              </div>
            )}
            <button
              type="button" className="ui-btn" onClick={() => setOpen(null)}
              style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10.5 }}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {children}

    </div>
  );
}

/**
 * One market cell. The sim's side: the line in full ink and, when Kalshi
 * quotes it, a tinted fill with the ONE number (edge in cents) under it. The
 * other side: the line alone, muted. Unquoted cells stay tappable.
 */
function MarketCell({
  line, filled, chip, edge, hasRow, refOnly, grade, on, pending, h, dotted, onClick, label,
}: {
  line: string;
  filled: boolean;
  /** Show the edge chip under the line (the filled side, pre-final). */
  chip: boolean;
  edge: number | null;
  hasRow: boolean;
  refOnly: boolean;
  grade: GridGrade | null;
  on: boolean;
  pending: boolean;
  h: number;
  /** The Kalshi price is off a nearest strike — explained in the popover. */
  dotted: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const whole = edge === null ? null : Math.round(edge * 100);
  // A rounded-to-zero edge is not a direction; it wears the neutral token so a
  // green "+0¢" never reads as a bet.
  const tone = whole === null || whole === 0
    ? "var(--muted)"
    : whole > 0 ? "var(--pos)" : "var(--neg)";
  /* Only a QUOTED edge fills the cell. No Kalshi quote (edge null) — and the
     final view, where quotes are gone — is a plain line: the sim's side is
     told apart by ink weight alone, never by a grey box holding a dash. A
     0¢ edge IS a quote, so it keeps its chip on the neutral --fill tint. */
  const bg = !filled || edge === null
    ? "transparent"
    : whole === 0
    ? "var(--fill)"
    : `color-mix(in oklab, ${tone} ${refOnly ? 7 : 14}%, var(--card))`;
  const gTone = grade
    ? grade.result === "win" ? "var(--pos)" : grade.result === "loss" ? "var(--neg)" : "var(--muted)"
    : null;
  const ring = gTone
    ? `inset 0 0 0 1.5px ${gTone}`
    : on ? "inset 0 0 0 1px var(--brand)" : "none";

  const body = (
    <>
      {pending ? (
        <Skeleton height={10} width="70%" radius={4} />
      ) : (
        <>
          {line && (
            <span style={{
              fontSize: 13, fontWeight: filled ? 700 : 500, lineHeight: "15px",
              color: filled ? "var(--text)" : "var(--muted)",
              textDecoration: dotted ? "underline dotted" : undefined,
              textUnderlineOffset: 3,
            }}>
              {line}
            </span>
          )}
          {chip && edge !== null && (
            <span style={{ fontSize: 12, fontWeight: 800, lineHeight: "14px", color: tone }}>
              {whole === 0 ? "0¢" : signedCents(edge)}
            </span>
          )}
        </>
      )}
      {grade && (
        <span
          title={grade.provisional ? "graded from live final — verified on re-publish" : undefined}
          style={{
            // A corner badge sitting ON the outline, so it never collides
            // with a long line ("O 48.5") inside the cell.
            position: "absolute", top: -5, right: -3,
            padding: "0 2px", borderRadius: 3, background: "var(--card)",
            fontSize: 9.5, fontWeight: 900, lineHeight: "11px", color: gTone ?? undefined,
            textDecoration: grade.provisional ? "underline dotted" : undefined,
            textUnderlineOffset: 1,
          }}
        >
          {grade.result === "win" ? "W" : grade.result === "loss" ? "L" : "P"}
        </span>
      )}
    </>
  );

  const style: React.CSSProperties = {
    position: "relative", height: h, width: "100%", minWidth: 0,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 1, padding: 0, borderRadius: 8, border: "none",
    background: bg, boxShadow: ring, font: "inherit",
    fontVariantNumeric: "tabular-nums", color: "var(--text)",
    cursor: onClick ? "pointer" : "default",
  };

  if (!onClick || !hasRow) {
    return <div style={style}>{body}</div>;
  }
  return (
    <button type="button" onClick={onClick} aria-expanded={on} aria-label={label} style={style}>
      {body}
    </button>
  );
}
