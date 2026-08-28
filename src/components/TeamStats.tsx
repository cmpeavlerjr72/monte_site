// src/components/TeamStats.tsx
//
// Team box-stat distributions for one simulated game, drawn as a MIRRORED
// DENSITY on a single continuous axis, with live Kalshi markets as flags.
//
// ---------------------------------------------------------------------------
// The bar test (this drove the whole design)
// ---------------------------------------------------------------------------
// Acceptance bar, user's words: readable "to someone who has had a beer or two
// at a bar." Three complaints killed the previous version, and one form fixes
// all three:
//
//   "95-5 and 90-10 values, no clue what those are"  -> NO number pairs
//      anywhere at rest. Not bid-ask, not q10-q90. The only number on a flag
//      is the VERDICT: the edge in cents. Everything else is one tap away.
//   "it should be one continuous line"               -> ONE axis per stat,
//      drawn unbroken from 0 to max, with team A's distribution above it and
//      team B's below (split violin / mirrored ridgeline). Which team is
//      further right is preattentive — no reading required.
//   "no clue what the kalshi numbers are and what our numbers are"
//                                                    -> the shape IS ours and
//      the flags ARE Kalshi's, said once in a plain-words legend at the top.
//
// ---------------------------------------------------------------------------
// Where the numbers come from
// ---------------------------------------------------------------------------
// Distributions: the sim repo's export_team_stats.py publishes P(stat > K) at
// every Kalshi strike, computed per simulated game FIRST then aggregated
// across seeds. Fair values are weekly BY DESIGN — that is not staleness.
// The density here is adjacent-rung SUBTRACTION only: P(>K_i) − P(>K_i+1) is
// the mass in that bin, divided by the bin's width. No smoothing model, no
// kernel, no re-derivation.
//
// Prices: LIVE from /api/kalshi/cfb (45s TTL, bulk series paging) via the
// card's kalshi feed — never a published snapshot, because this panel is
// meant to become a trading surface. The server resolves each quote to our
// stat key and to this game's A/B side, so nothing here does a name join.
// Edge = sim − live mid, one subtraction, suppressed by the quality rule in
// src/lib/kalshi.ts (one-sided book, spread > 30c, sim in its own tail).
//
// ---------------------------------------------------------------------------
// Color (validated, not eyeballed)
// ---------------------------------------------------------------------------
// School brand hexes FAIL validate_palette.js as marks (UNC #7bafd4 is 2.29:1
// on the light surface, TCU #4d1979 is 1.44:1 on dark). So brand color fills
// the density silhouette only; every stroke, every label and the axis wear
// theme tokens. Status tokens (--pos/--neg) appear only on the edge chip,
// always with a sign character and a "¢" unit, never as color alone — and
// both are AA as text on both surfaces. The numeric table view remains one
// toggle away as the relief the validator requires for a sub-3:1 fill.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getTeamStatsCached, TeamStatsNotPublished,
  type TeamStats as TeamStatsDoc, type TeamStatDist,
} from "../lib/cfbJson";
import {
  indexStatQuotes, statBookQuality, STAT_EDGE_MIN,
  type KalshiGame, type KalshiStatQuote,
} from "../lib/kalshi";
import type { Season } from "../lib/cfbData";

type Props = {
  slug: string;
  /** Dataset namespace of THIS CARD ("2026"), never the page's season. */
  ns: Season;
  weekId: string;
  /** Home / away: orders the strips AND resolves the live quotes' A/B side. */
  teamA: string;
  teamB: string;
  /** Live Kalshi feed for this game (45s TTL). Prices are never a snapshot. */
  kalshi?: KalshiGame;
  colorFor?: (team: string) => string | undefined;
  logoFor?: (team: string) => string | undefined;
  /**
   * PRE-FOCUS, sent by the Bets panel's "See projection →" button: scroll that
   * team's stat straight into view and flash it, instead of dropping the
   * reader at the top of a 13-stat chart to hunt for the one the bet was on.
   *
   * The keys are `team_stats.json`'s own — both sides read the same document,
   * so a suggestion's stat IS a block key. A target with no rendered block
   * (an unpublished stat, a series we have not mapped) is a quiet no-op, never
   * an error.
   *
   * `strike` is Kalshi's own integer strike ("175+" -> 175) and it is the
   * point of the whole jump: a rec-yards ladder has eleven flags on it and
   * landing on the block still leaves the reader guessing WHICH rung the money
   * is going onto. When it resolves to a rendered flag, that flag is drawn in
   * the brand colour with a full-height stem, keeps its verdict chip at every
   * width, and has its derivation popover already open. A strike that is not
   * on the published grid is a quiet no-op — the block focus still happens.
   */
  focus?: { team: string; stat: string; strike?: number } | null;
};

const ROWS: { key: string; label: string; unit?: string }[] = [
  { key: "points", label: "Points" },
  { key: "rec_yards", label: "Receiving yards", unit: "= gross passing" },
  { key: "rush_yards", label: "Rushing yards" },
  { key: "total_yards", label: "Total yards" },
  { key: "receptions", label: "Receptions" },
  { key: "rush_att", label: "Rush attempts" },
  { key: "rush_td", label: "Rushing TDs" },
  { key: "rec_td", label: "Receiving TDs" },
  { key: "td_offensive", label: "Offensive TDs", unit: "rush + rec only" },
  { key: "def_sacks", label: "Sacks (defense)" },
  { key: "def_ints", label: "Interceptions (defense)" },
  { key: "fg_made", label: "Field goals made" },
  { key: "turnovers_forced", label: "Turnovers forced" },
];

/** Small-integer counts: a smoothed curve over 0,1,2,3 would be a lie about
 *  what the sim produced, so these draw as discrete bars. */
const DISCRETE = new Set(["rush_td", "rec_td", "td_offensive", "def_sacks", "def_ints"]);

/* -------------------------------- geometry ------------------------------- */
/* Layout is measured, not fixed: the panel fits its container the way the
 * site's other charts do, INCLUDING on a phone in the installed PWA. The
 * naive fix — a viewBox that scales — was rejected: at 375px in a 900px
 * design that is a 0.42 scale factor, which turns 9px labels into 3.8px.
 * So the layout is recomputed at the real width and legibility is bought
 * with DENSITY instead: fonts stay fixed and the chips thin out to the
 * markets that actually carry a verdict. */
const DESIGN_W = 900;     // desktop width; also the upper clamp
const MIN_W = 300;
const NARROW_BELOW = 560;
const PAD_R = 26;
/** Everything width-dependent, derived once per measured container width. */
type Layout = {
  plotW: number;
  gutter: number;
  densH: number;
  /** Max chipped flags PER TEAM per stat; Infinity on desktop. */
  maxChips: number;
  narrow: boolean;
};

function layoutFor(width: number): Layout {
  const plotW = Math.max(MIN_W, Math.min(width || DESIGN_W, DESIGN_W));
  const narrow = plotW < NARROW_BELOW;
  return {
    plotW,
    // The desktop gutter is a luxury; on a phone it is a third of the screen.
    gutter: narrow ? 84 : 156,
    densH: narrow ? 27 : 34,
    maxChips: narrow ? 4 : Infinity,
    narrow,
  };
}
const CHIP_H = 24;        // one row of flag labels: strike over edge, 2 lines
const AXIS_LBL = 13;
const BLOCK_PAD = 4;
const CHIP_W = 42;        // reserved width per chip, drives the stagger
const HIT_W = 40;         // tap target (>= 40px per spec)

const fmt = (v: number | null, dp = 1): string =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(dp);

const dpFor = (key: string): number =>
  key.endsWith("_yards") || key === "points" ? 0 : 1;

const cents = (p: number): string => `${Math.round(p * 100)}¢`;
const signed = (e: number): string =>
  `${e > 0 ? "+" : "−"}${Math.abs(Math.round(e * 100))}¢`;

function niceMax(raw: number): number {
  const step = raw > 200 ? 50 : raw > 60 ? 25 : raw > 20 ? 5 : raw > 8 ? 2 : 1;
  return Math.max(step, Math.ceil(raw / step) * step);
}

type Rung = { k: number; label: string; p: number };

function rungList(d: TeamStatDist | undefined): Rung[] {
  if (!d?.rungs) return [];
  return Object.entries(d.rungs)
    .map(([label, p]) => ({ k: Number(label), label, p }))
    .filter((r) => Number.isFinite(r.k))
    .sort((a, b) => a.k - b.k);
}

/* ------------------------------- the density ------------------------------
 * Bin mass from adjacent rungs, divided by bin width. Subtraction only.
 * ------------------------------------------------------------------------ */
type Bin = { lo: number; hi: number; dens: number };

function bins(rungs: Rung[], axisMax: number): Bin[] {
  if (!rungs.length) return [];
  const out: Bin[] = [];
  const push = (lo: number, hi: number, mass: number) => {
    if (hi > lo) out.push({ lo, hi, dens: Math.max(0, mass) / (hi - lo) });
  };
  push(0, rungs[0].k, 1 - rungs[0].p);
  for (let i = 0; i < rungs.length - 1; i++) {
    push(rungs[i].k, rungs[i + 1].k, rungs[i].p - rungs[i + 1].p);
  }
  push(rungs[rungs.length - 1].k, axisMax, rungs[rungs.length - 1].p);
  return out;
}

/** Discrete counts: mass at each integer value. */
function counts(rungs: Rung[]): { v: number; mass: number }[] {
  if (!rungs.length) return [];
  const out = [{ v: Math.max(0, Math.floor(rungs[0].k)), mass: 1 - rungs[0].p }];
  for (let i = 0; i < rungs.length - 1; i++) {
    out.push({ v: rungs[i].k + 0.5, mass: rungs[i].p - rungs[i + 1].p });
  }
  const last = rungs[rungs.length - 1];
  out.push({ v: last.k + 0.5, mass: last.p });
  return out.filter((b) => b.mass > 0.0005);
}

/** Smooth polyline through bin centres, rooted at zero on both ends. */
function densityPath(
  bs: Bin[], x: (v: number) => number, y: (d: number) => number, base: number
): string {
  if (!bs.length) return "";
  const pts: [number, number][] = [[x(bs[0].lo), base]];
  for (const b of bs) pts.push([x((b.lo + b.hi) / 2), y(b.dens)]);
  pts.push([x(bs[bs.length - 1].hi), base]);

  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${((cx + nx) / 2).toFixed(1)} ${((cy + ny) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last[0].toFixed(1)} ${last[1].toFixed(1)} Z`;
}

/* --------------------------------- flags ---------------------------------- */
type Flag = {
  key: string;
  x: number;
  strike: string;
  edge: number | null;
  /** False = bare stub: no edge, or crowded out at narrow widths. Still
   *  tappable, and the popover still carries the full verdict. */
  showChip: boolean;
  /** Why the edge is withheld, in words, for the popover. */
  detail: string;
  row: number;
};

/** Stagger chips into rows so two adjacent strikes never overlap. */
function stagger(flags: Omit<Flag, "row">[], rowsMax = 3): Flag[] {
  const lastX: number[] = [];
  return flags.map((f) => {
    // Chip-less flags claim no row: they carry only a small stub, so letting
    // them push a real verdict onto a second row would be backwards.
    if (!f.showChip) return { ...f, row: 0 };
    let row = 0;
    while (row < rowsMax && lastX[row] !== undefined && f.x - lastX[row] < CHIP_W) row++;
    if (row >= rowsMax) row = 0;                    // give up gracefully
    lastX[row] = f.x;
    return { ...f, row };
  });
}

/** Kalshi's own wording for a strike: floor 149.5 is the market "150+", floor
 *  2.5 is "3+". Half-integers are settlement plumbing, not something to read
 *  at a bar. */
const strikeLabel = (k: number): string => `${Math.ceil(k)}+`;

function buildFlags(
  rungs: Rung[], statKey: string, side: "A" | "B" | null, team: string,
  label: string, quotes: Map<string, KalshiStatQuote>, x: (v: number) => number,
  maxChips: number,
  /** The rung a suggestion is priced on, if this block holds it. It keeps its
   *  chip at every width — the whole reason the reader jumped here. */
  focusKey: string | null = null,
): Flag[] {
  if (!side) return [];
  const raw: Omit<Flag, "row">[] = [];
  for (const r of rungs) {
    const q = quotes.get(`${statKey}|${side}|${r.k}`);
    if (!q) continue;                    // no market at this strike -> no ink
    const book = statBookQuality(q, r.p);
    if (!book) continue;
    const e = r.p - book.mid;             // the one subtraction
    const live = book.tradeable && Math.abs(e) >= STAT_EDGE_MIN ? e : null;
    const head = `${team} ${strikeLabel(r.k)} ${label.toLowerCase()}`;
    const detail = !book.tradeable
      ? `${head} — Sim: ${Math.round(r.p * 100)}% · Kalshi book is one-sided or ` +
        `${Math.round(book.spread * 100)}¢ wide, so no edge is shown.`
      : `${head} — Sim: ${Math.round(r.p * 100)}% · Kalshi: ${cents(book.mid)} · ` +
        (live !== null
          ? `Edge: ${signed(live)}`
          : `Edge: under the 3¢ threshold`);
    raw.push({
      key: `${statKey}|${side}|${r.k}`, x: x(r.k), strike: strikeLabel(r.k),
      edge: live, showChip: live !== null, detail,
    });
  }

  // Narrow widths: keep only the biggest verdicts as chips. Ranking by
  // |edge| means the markets that survive are the ones worth acting on, not
  // whichever happened to come first along the ladder. The rest stay as
  // tappable stubs — nothing is removed, only de-emphasised.
  if (Number.isFinite(maxChips)) {
    const chipped = raw.filter((f) => f.showChip)
      .sort((a, b) => Math.abs(b.edge!) - Math.abs(a.edge!))
      .slice(0, maxChips);
    const keep = new Set(chipped.map((f) => f.key));
    for (const f of raw) if (f.showChip && !keep.has(f.key)) f.showChip = false;
  }
  // The focused rung is EXEMPT from the narrow-width thinning. It is the one
  // market the reader came here to look at; letting the phone layout demote it
  // to a bare stub would defeat the jump.
  if (focusKey) for (const f of raw) if (f.key === focusKey) f.showChip = true;
  return stagger(raw);
}

/* ------------------------------ one stat block ---------------------------- */
function StatBlock({
  statKey, label, unit, definition, cols, sideOf, stats, quotes,
  colorFor, logoFor, sel, onSel, L, blockRef, highlight = false,
  focusKey = null,
}: {
  statKey: string;
  label: string;
  unit?: string;
  definition?: string;
  cols: string[];
  sideOf: (team: string) => "A" | "B" | null;
  stats: Record<string, Record<string, TeamStatDist>>;
  quotes: Map<string, KalshiStatQuote>;
  colorFor?: (team: string) => string | undefined;
  logoFor?: (team: string) => string | undefined;
  sel: string | null;
  onSel: (key: string | null) => void;
  L: Layout;
  /** Registers this block so a focus payload can scroll to it. */
  blockRef?: (el: HTMLDivElement | null) => void;
  /** Temporary post-jump highlight — the card-flash convention, ~1.8s. */
  highlight?: boolean;
  /** Flag key of the exact rung a suggestion is priced on, when it is in this
   *  block. Drawn in the brand colour with a full-height stem. */
  focusKey?: string | null;
}) {
  const [tA, tB] = cols;
  const dA = stats[tA]?.[statKey];
  const dB = tB ? stats[tB]?.[statKey] : undefined;

  // Same mark the scoreboard uses when a card is jumped to: an outline that
  // fades, never a colour change — the palette here already means something.
  const focusStyle = highlight
    ? { outline: "2px solid var(--brand)", outlineOffset: 2, borderRadius: 8 }
    : undefined;

  if ((!dA || dA.median === null) && (!dB || dB.median === null)) {
    const reason = dA?.reason ?? dB?.reason;
    return (
      <div ref={blockRef} style={{ padding: "7px 0", borderTop: "1px solid var(--border)", ...focusStyle }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Not simulated{reason ? ` — ${reason}` : ""}.
        </div>
      </div>
    );
  }

  const rA = rungList(dA);
  const rB = rungList(dB);
  const allR = rA.length ? rA : rB;
  const maxRung = allR.length ? allR[allR.length - 1].k : 0;
  const maxQ90 = Math.max(dA?.q90 ?? 0, dB?.q90 ?? 0);
  const discrete = DISCRETE.has(statKey);

  const cntA = discrete ? counts(rA) : [];
  const cntB = discrete ? counts(rB) : [];
  // Counts get a TIGHT axis: a 0-7 axis for a 0-4 distribution wastes half
  // the width on an empty tail. Cut at the last value carrying real mass,
  // but never inside a strike that has a live market. Continuous stats keep
  // the padded q90 rule.
  const quotedMax = Math.max(
    0,
    ...[...quotes.keys()]
      .filter((k) => k.startsWith(`${statKey}|`))
      .map((k) => Number(k.split("|")[2]))
      .filter((v) => Number.isFinite(v))
  );
  const axisMax = discrete
    ? Math.max(
        3, quotedMax + 0.5,
        ...cntA.filter((b) => b.mass >= 0.01).map((b) => b.v),
        ...cntB.filter((b) => b.mass >= 0.01).map((b) => b.v)
      ) + 0.5
    : niceMax(Math.max(maxQ90 * 1.12, maxRung * 1.06, 1));

  // Discrete axes start at -0.5 so the value-0 bar gets a whole slot instead
  // of being sliced in half by the axis origin.
  const axisMin = discrete ? -0.5 : 0;
  const x = (v: number) =>
    L.gutter +
    ((Math.max(axisMin, Math.min(v, axisMax)) - axisMin) / (axisMax - axisMin)) *
      (L.plotW - L.gutter - PAD_R);

  const binsA = discrete ? [] : bins(rA, axisMax);
  const binsB = discrete ? [] : bins(rB, axisMax);
  const peak = Math.max(
    1e-9,
    ...binsA.map((b) => b.dens), ...binsB.map((b) => b.dens),
    ...cntA.map((b) => b.mass), ...cntB.map((b) => b.mass)
  );

  const flagsA = buildFlags(rA, statKey, sideOf(tA), tA, label, quotes, x, L.maxChips, focusKey);
  const flagsB = tB ? buildFlags(rB, statKey, sideOf(tB), tB, label, quotes, x, L.maxChips, focusKey) : [];
  const rowsA = flagsA.some((f) => f.showChip) ? Math.max(...flagsA.map((f) => f.row)) + 1 : 0;
  const rowsB = flagsB.some((f) => f.showChip) ? Math.max(...flagsB.map((f) => f.row)) + 1 : 0;

  const bandA = rowsA * CHIP_H + BLOCK_PAD;
  const bandB = rowsB * CHIP_H + BLOCK_PAD;
  const axisY = bandA + L.densH;
  const height = axisY + L.densH + bandB + AXIS_LBL;

  const yUp = (d: number) => axisY - (d / peak) * L.densH;
  const yDn = (d: number) => axisY + (d / peak) * L.densH;

  const selFlag = [...flagsA, ...flagsB].find((f) => f.key === sel);

  const side = (
    team: string, d: TeamStatDist | undefined, bs: Bin[],
    cs: { v: number; mass: number }[], flags: Flag[], up: boolean
  ) => {
    if (!d || d.median === null) return null;
    const brand = colorFor?.(team) ?? "var(--brand)";
    const logo = logoFor?.(team);
    const yFn = up ? yUp : yDn;
    const labelY = up ? axisY - L.densH / 2 : axisY + L.densH / 2;
    // 0.34 of the unit slot, capped at the 24px bar spec: the leftover is air,
    // and the gap between neighbours is the separator, never a stroke.
    const slot = (L.plotW - L.gutter - PAD_R) / (axisMax - axisMin);
    const barW = Math.min(24, Math.max(3, slot * 0.34));
    return (
      <g>
        {logo && <image href={logo} x={0} y={labelY - 9} width={18} height={18} preserveAspectRatio="xMidYMid meet" />}
        <text x={22} y={labelY - 2} fontSize={11.5} fontWeight={700} fill="var(--text)">
          {team.length > 18 ? `${team.slice(0, 17)}…` : team}
        </text>
        <text x={22} y={labelY + 11} fontSize={10} fill="var(--muted)">
          {`median ${fmt(d.median, dpFor(statKey))}`}
        </text>

        {/* our simulation: brand-filled silhouette, token stroke */}
        {!!bs.length && (
          <path d={densityPath(bs, x, yFn, axisY)} fill={brand} opacity={0.30}
                stroke="var(--muted)" strokeWidth={1} strokeOpacity={0.45}>
            <title>{`${team}: simulated distribution (median ${fmt(d.median, dpFor(statKey))})`}</title>
          </path>
        )}
        {cs.map((b) => {
          const h = (b.mass / peak) * L.densH;
          // Clamp into the plot: the value-0 bar would otherwise hang half
          // its width over the team-label gutter.
          const left = Math.max(x(axisMin), x(b.v) - barW / 2);
          const right = Math.min(x(axisMax), x(b.v) + barW / 2);
          return (
            <rect key={b.v} x={left} y={up ? axisY - h : axisY}
                  width={Math.max(2, right - left)} height={Math.max(1, h)} rx={2}
                  fill={brand} opacity={0.30} stroke="var(--muted)"
                  strokeWidth={1} strokeOpacity={0.45}>
              <title>{`${team}: ${Math.round(b.mass * 100)}% of games at exactly ${b.v}`}</title>
            </rect>
          );
        })}

        {/* live Kalshi markets */}
        {/* A flag is ONE visual unit and it lives entirely OUTSIDE the
            silhouette: the stem crosses the density (showing where the strike
            falls in our distribution) and both labels sit in the chip band,
            so no text is ever set on top of a coloured fill. */}
        {flags.map((f) => {
          // Row 0 is nearest the density; later rows stack outward.
          const outer = up
            ? bandA - f.row * CHIP_H
            : axisY + L.densH + (f.row + 1) * CHIP_H;
          const strikeY = !f.showChip
            ? (up ? axisY - L.densH - 5 : axisY + L.densH + 12)
            : (up ? outer - 2 : outer - 12);
          const edgeY = up ? outer - 12 : outer - 2;
          // A flag with no edge is a market we cannot act on: it keeps a short
          // stub and its strike, never a full-height stem competing with the
          // rungs that DO carry a verdict.
          const stemEnd = !f.showChip
            ? (up ? axisY - L.densH - 2 : axisY + L.densH + 2)
            : (up ? outer + 2 : outer - CHIP_H + 2);
          const on = f.key === sel;
          // THE RUNG THIS BET IS ON. It gets the brand channel — a colour that
          // means "you were sent here" and nothing else on this chart, so it
          // never competes with --pos/--neg, which mean edge sign. Plus a
          // marker dot where the strike crosses the axis, so the eye lands on
          // the value before it reads a single character.
          const isFocus = focusKey !== null && f.key === focusKey;
          const tone = f.edge === null ? "var(--muted)" : f.edge > 0 ? "var(--pos)" : "var(--neg)";
          const big = f.edge !== null && Math.abs(f.edge) >= 0.10;
          const hitTop = Math.min(axisY, stemEnd) - CHIP_H;
          return (
            <g key={f.key} style={{ cursor: "pointer" }}
               onClick={() => onSel(on ? null : f.key)}>
              <line x1={f.x} x2={f.x} y1={axisY} y2={stemEnd}
                    stroke={isFocus ? "var(--brand)" : !f.showChip ? "var(--border)" : "var(--muted)"}
                    strokeWidth={isFocus ? 2.5 : on ? 2 : 1}
                    strokeOpacity={isFocus || !f.showChip ? 1 : 0.8} />
              {isFocus && (
                <circle cx={f.x} cy={axisY} r={3.5} fill="var(--brand)" />
              )}
              {/* On a phone a stub is a BARE tick: 25-yard strikes land ~16px
                  apart there, so printing every "275+" would collide into
                  mush. The strike stays in the tap popover, which is the
                  whole point of keeping stubs tappable. */}
              {(f.showChip || !L.narrow) && (
                <text x={f.x} y={strikeY} fontSize={isFocus ? 10.5 : 9} textAnchor="middle"
                      fontWeight={isFocus ? 800 : 400}
                      fill={isFocus ? "var(--brand-text)" : "var(--muted)"}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {f.strike}
                </text>
              )}
              {f.showChip && f.edge !== null && (
                <text x={f.x} y={edgeY} fontSize={big || isFocus ? 11.5 : 10}
                      fontWeight={big || isFocus ? 800 : 700} textAnchor="middle" fill={tone}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {signed(f.edge)}
                </text>
              )}
              {/* >=40px tap target, invisible */}
              <rect x={f.x - HIT_W / 2} y={hitTop}
                    width={HIT_W} height={Math.abs(axisY - stemEnd) + CHIP_H * 2}
                    fill="transparent">
                <title>{f.detail}</title>
              </rect>
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div ref={blockRef} style={{
      padding: "7px 0", borderTop: "1px solid var(--border)", position: "relative",
      ...focusStyle,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }} title={definition}>
          {label}
        </span>
        {unit && <span style={{ fontSize: 10, color: "var(--muted)" }}>{unit}</span>}
      </div>
      <svg width={L.plotW} height={height} viewBox={`0 0 ${L.plotW} ${height}`}
           role="img" aria-label={`${label}: simulated distributions and live Kalshi markets`}
           style={{ display: "block", maxWidth: "none" }}>
        {side(tA, dA, binsA, cntA, flagsA, true)}
        {tB && side(tB, dB, binsB, cntB, flagsB, false)}

        {/* THE axis: one continuous line, drawn last so it sits on top */}
        <line x1={x(0)} x2={x(axisMax)} y1={axisY} y2={axisY}
              stroke="var(--text)" strokeWidth={1.5} strokeLinecap="round" />
        <text x={x(0)} y={height - 2} fontSize={9} fill="var(--muted)" textAnchor="start">0</text>
        <text x={x(axisMax)} y={height - 2} fontSize={9} fill="var(--muted)" textAnchor="end"
              style={{ fontVariantNumeric: "tabular-nums" }}>
          {axisMax}
        </text>
      </svg>

      {selFlag && (
        <div role="status" style={{
          position: "absolute", left: Math.min(Math.max(8, selFlag.x - 150), Math.max(8, L.plotW - 300)),
          top: 4, zIndex: 2, maxWidth: 300,
          background: "var(--card)", border: "1px solid var(--brand)",
          borderRadius: 8, padding: "7px 9px", fontSize: 11.5, lineHeight: 1.45,
          color: "var(--text)", boxShadow: "0 4px 14px var(--shadow)",
        }}>
          {selFlag.detail}
          <button type="button" className="ui-btn" onClick={() => onSel(null)}
                  style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10.5 }}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------- table view (the twin) ------------------------ */
function TableView({ cols, stats, defs }: {
  cols: string[];
  stats: Record<string, Record<string, TeamStatDist>>;
  defs: Record<string, string>;
}) {
  const shown = ROWS.filter((r) => cols.some((t) => stats[t]?.[r.key]));
  const th: React.CSSProperties = {
    textAlign: "left", padding: "4px 8px", fontSize: 11,
    color: "var(--muted)", borderBottom: "1px solid var(--border)",
  };
  return (
    <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>
          <th style={th}>Stat</th>
          {cols.map((t) => (
            <th key={t} style={{ ...th, fontSize: 11.5, fontWeight: 800, color: "var(--text)" }}>{t}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.key}>
            <th scope="row" title={defs[r.key]} style={{
              textAlign: "left", padding: "5px 8px", fontWeight: 600,
              color: "var(--text)", borderBottom: "1px solid var(--border)",
              verticalAlign: "top",
            }}>
              {r.label}
            </th>
            {cols.map((t) => {
              const d = stats[t]?.[r.key];
              const dp = dpFor(r.key);
              return (
                <td key={t} style={{
                  padding: "5px 8px", borderBottom: "1px solid var(--border)",
                  color: "var(--text)", verticalAlign: "top",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {!d || d.median === null ? (
                    <span style={{ color: "var(--muted)" }}>
                      not simulated{d?.reason ? ` — ${d.reason}` : ""}
                    </span>
                  ) : (
                    <>
                      <strong>{fmt(d.median, dp)}</strong>
                      <span style={{ color: "var(--muted)" }}>
                        {`  10th–90th: ${fmt(d.q10, dp)}–${fmt(d.q90, dp)}`}
                      </span>
                      {d.rungs && (
                        <div style={{ color: "var(--muted)", fontSize: 10.5 }}>
                          {Object.entries(d.rungs)
                            .filter(([, p]) => p >= 0.03 && p <= 0.97)
                            .map(([k, p]) => `${k}+ ${Math.round(p * 100)}%`)
                            .join(" · ")}
                        </div>
                      )}
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ================================ the panel =============================== */
export default function TeamStats({
  slug, ns, weekId, teamA, teamB, kalshi, colorFor, logoFor, focus,
}: Props) {
  const [doc, setDoc] = useState<TeamStatsDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sel, setSel] = useState<string | null>(null);

  // Measured container width -> layout.
  //
  // A CALLBACK REF, not useLayoutEffect+[]: the chart container does not
  // exist on first render (the panel is showing "Loading team stats…"), so
  // an effect that reads a ref once would find null, never re-run, and leave
  // the layout stuck at the 900px desktop default — which is exactly the
  // horizontal scrolling this change exists to remove. The callback fires
  // when the node actually appears.
  //
  // State is a NUMBER and the identity of `attachBox` is stable, so nothing
  // here can feed its own setState back into a dependency (brief rule 4);
  // the epsilon guard also drops no-op resizes.
  const [boxW, setBoxW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const apply = (w: number) => setBoxW((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;   // SSR / old engines
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  const L = useMemo(() => layoutFor(boxW), [boxW]);

  // Lazy: mounts only when the panel is open; the loader is memoized per
  // (namespace, week). Deps are PRIMITIVES only (brief rule 4).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMissing(false);
    setError(null);
    getTeamStatsCached(ns, weekId)
      .then((d) => { if (alive) setDoc(d); })
      .catch((e: any) => {
        if (!alive) return;
        if (e instanceof TeamStatsNotPublished || e?.name === "TeamStatsNotPublished") setMissing(true);
        else setError(String(e?.message ?? e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ns, weekId]);

  const game = doc?.games?.[slug];

  const cols = useMemo(() => {
    if (!game) return [];
    const keys = Object.keys(game.stats);
    const out = [teamA, teamB].filter((t) => keys.includes(t));
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
  }, [game, teamA, teamB]);

  // Live quotes, re-derived whenever the 45s poll hands us a new feed object.
  const quotes = useMemo(() => indexStatQuotes(kalshi), [kalshi]);

  const sideOf = useMemo(() => {
    const map = new Map<string, "A" | "B">([[teamA, "A"], [teamB, "B"]]);
    return (t: string) => map.get(t) ?? null;
  }, [teamA, teamB]);

  /* ------------------------------ pre-focus -------------------------------
   * A suggestion in the Bets panel points here with {team, stat}. Deps are
   * PRIMITIVES (brief rule 4), and `applied` makes it fire ONCE per payload:
   * without it, focus + the `view` dep would keep dragging the reader back to
   * the chart every time they opened the table.
   *
   * Order of the guards matters. Table view has no per-stat blocks, so it
   * switches to chart and lets the `view` dep bring the effect back; a doc
   * that has not loaded yet has no ref either, and the `doc` dep covers that.
   * A stat with no block at all just never resolves — a no-op by design.
   * ---------------------------------------------------------------------- */
  const [flashStat, setFlashStat] = useState<string | null>(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  const appliedFocus = useRef<string>("");
  const focusTeam = focus?.team ?? "";
  const focusStat = focus?.stat ?? "";
  const focusStrike = focus?.strike;

  /**
   * The focused STRIKE, resolved to a flag key.
   *
   * Kalshi words a market as "175+" and our exporter writes the rung at its
   * half-integer floor ("174.5"), so the two are related by `Math.ceil` — the
   * same relation `strikeLabel` prints with. Resolving it against the
   * document's own rung keys (rather than assuming `strike − 0.5`) means an
   * integer-keyed grid resolves too, and a strike that is simply not published
   * resolves to null and changes nothing.
   */
  const focusFlagKey = useMemo(() => {
    if (!focusStat || typeof focusStrike !== "number") return null;
    const side = sideOf(focusTeam);
    if (!side) return null;
    const rungs = doc?.games?.[slug]?.stats?.[focusTeam]?.[focusStat]?.rungs;
    if (!rungs) return null;
    const k = Object.keys(rungs).map(Number)
      .filter((n) => Number.isFinite(n))
      .find((n) => Math.ceil(n) === focusStrike);
    return k === undefined ? null : `${focusStat}|${side}|${k}`;
  }, [focusStat, focusStrike, focusTeam, sideOf, doc, slug]);

  useEffect(() => {
    const key = focusStat ? `${focusTeam}|${focusStat}|${focusStrike ?? ""}` : "";
    if (!key || appliedFocus.current === key) return;
    if (view === "table") { setView("chart"); return; }
    const el = blockRefs.current.get(focusStat);
    if (!el) return;
    appliedFocus.current = key;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashStat(focusStat);
    // The priced rung's derivation, already open: "Sim 67% · Kalshi 58¢ ·
    // Edge +9¢" is the sentence the reader jumped here to check, and making
    // them find and tap the right flag first is the hunt this focus removes.
    if (focusFlagKey) setSel(focusFlagKey);
    const t = window.setTimeout(
      () => setFlashStat((k) => (k === focusStat ? null : k)), 1800);
    return () => window.clearTimeout(t);
  }, [focusTeam, focusStat, focusStrike, focusFlagKey, doc, view]);

  // One STABLE ref callback per stat: a fresh closure every render would make
  // React detach and re-attach every block on every render.
  const refFns = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const attachBlock = useCallback((statKey: string) => {
    let fn = refFns.current.get(statKey);
    if (!fn) {
      fn = (el: HTMLDivElement | null) => {
        if (el) blockRefs.current.set(statKey, el);
        else blockRefs.current.delete(statKey);
      };
      refFns.current.set(statKey, fn);
    }
    return fn;
  }, []);

  if (loading && !doc) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading team stats…</div>;
  }
  if (missing || (doc && !game)) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Team stats not published yet for this week.
      </div>
    );
  }
  if (error) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>Team stats unavailable ({error}).</div>;
  }
  if (!doc || !game) return null;

  const priced = quotes.size > 0;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {/* The legend, in words, once. This is the answer to "no clue what the
          kalshi numbers are and what our numbers are". */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--text)" }}>
          Shaded shape = <strong>our simulation</strong> · flags on the line ={" "}
          <strong>live Kalshi markets</strong> ·{" "}
          <span style={{ color: "var(--pos)", fontWeight: 700 }}>green</span>/
          <span style={{ color: "var(--neg)", fontWeight: 700 }}>red</span> ={" "}
          <strong>our edge in cents</strong>. Tap a flag for the detail.
        </span>
        <button
          type="button" className="ui-btn"
          onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
          style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 11 }}
        >
          {view === "chart" ? "Table view" : "Chart view"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
        Top team is above the line, bottom team below — further right is more.
        {doc.nsims ? ` ${doc.nsims.toLocaleString()} simulated games.` : ""}
        {priced ? " Prices update live; no edge is shown on a one-sided or very wide book." : ""}
        {focusFlagKey ? " The rung your bet is on is the highlighted flag." : ""}
      </div>

      {/* The CHART fits its container at every width, so it never scrolls.
          Only the table view — a real table with a sensible minimum — keeps
          the scroll container. */}
      <div ref={attachBox} style={{ overflowX: view === "chart" ? "hidden" : "auto" }}>
        {view === "chart" ? (
          <div>
            {ROWS.map((r) => (
              <StatBlock
                key={r.key} statKey={r.key} label={r.label} unit={r.unit}
                definition={doc.definitions?.[r.key]}
                cols={cols} sideOf={sideOf} stats={game.stats} quotes={quotes}
                colorFor={colorFor} logoFor={logoFor}
                sel={sel} onSel={setSel} L={L}
                blockRef={attachBlock(r.key)}
                highlight={flashStat === r.key}
                focusKey={r.key === focusStat ? focusFlagKey : null}
              />
            ))}
          </div>
        ) : (
          <TableView cols={cols} stats={game.stats} defs={doc.definitions ?? {}} />
        )}
      </div>

      {doc.caveats?.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10.5, color: "var(--muted)", display: "grid", gap: 2 }}>
          {doc.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}
