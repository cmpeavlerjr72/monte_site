// src/pages/TestVisual.tsx
// Hidden sim-test scoreboard — reachable only at /test-visual (no nav link).
// Renders public/data/test-visual.json, regenerated from cfb-props-sim by
// scripts/build_test_visual.py --run <tag>[:"Label"] (repeat for arms).
// Used to eyeball week-1 slate tests during model iteration; the tag +
// generated stamp identify the run.
//
// Multi-arm (2026-08-24): every loaded run is shown AT THE SAME TIME as a
// paired column — one score column per run, plus a Δ column when there are
// exactly two (Δ = first run − second run). The old run toggle is gone; the
// run labels live in the legend where it used to sit. Card ORDER keys off the
// first run, so the layout is stable regardless of what the arms disagree on.
// A single-run payload still renders exactly as it always has (the compare
// layout is guarded behind runs.length >= 2).
//
// Mean|Median (2026-08-24): the scoreboard switches between the seed MEAN
// (hs/as) and the seed MEDIAN (hs_med/as_med, tot_med) of each score. Medians
// read like real football scores (whole or .5) where means read like
// estimators. The switch moves the per-run score columns, the Total row and
// the Δ between them; the market column, the spread/total pills and the
// metric strip stay on the means they were computed from. The choice persists
// in localStorage. A payload without the _med fields hides the control and
// renders exactly as before.
//
// Player props (2026-08-23): each game also carries hprops/aprops — per
// player x stat SEED DISTRIBUTIONS (mean/median/p10..p90) plus P(over) at
// half-point thresholds bracketing the median. The props panel is a second
// expander alongside the box score, never a replacement for it. When a book
// line is present (stat.ln, null until a 2026 prop pull exists) the row also
// shows the market's de-vigged P(over) and the sim's edge at that line.

import { Fragment, useEffect, useMemo, useState } from "react";
import { getTeamColors } from "../utils/teamColors";
import { getEspnTeamsMap, lookupEspnLogo, localizeLogoUrl } from "../utils/espnLogos";

type BoxRow = [string, string, string];
type TeamBox = { pass_yds: number; rush_yds: number; rows: BoxRow[] };
type PropLine = {
  line: number; over_odds: number; under_odds: number | null;
  p_over_mkt: number; p_over_sim: number; edge: number; src: string;
};
type PropStat = {
  mn: number; md: number; p10: number; p25: number; p75: number; p90: number;
  sd: number; ov: [number, number][]; ln: PropLine | null;
};
type PropRow = { p: string; pos: string; vol: number; s: Record<string, PropStat> };
type Game = {
  gid?: number;
  date: string; home: string; away: string;
  hs: number; as: number; hw: number;
  // seed medians (added 2026-08-24; absent in older payloads).
  // tot_med is the median of the per-seed TOTAL, not hs_med + as_med.
  hs_med?: number; as_med?: number; tot_med?: number;
  spread: number | null; ou: number | null; fpi: number | null;
  hbox: TeamBox; abox: TeamBox;
  hprops?: PropRow[]; aprops?: PropRow[];
};
type RunMeta = {
  tag: string; label: string; n_games: number; src?: string;
  slope_fpi: number; slope_mkt: number; mae_mkt: number; gt14: number;
  mean_total: number; tot_vs_ou: number; overs: number; n_ou: number;
  n_props?: number;
};
type PropsMeta = {
  lines: { source: string; n_markets: number } | null;
  stats: Record<string, string>;
  filters: Record<string, number>;
};
type Payload = {
  meta: {
    tag: string; generated: string; season: number; week: number;
    n_games: number; runs?: RunMeta[]; note?: string; props?: PropsMeta;
  };
  runs?: Record<string, Game[]>;
  games: Game[];
};

/** One arm as the page carries it around: short column name + full label. */
type RunInfo = { tag: string; short: string; label: string; meta?: RunMeta };
/** A run's slice of ONE game (undefined when that arm has no such game). */
type RunView = { short: string; label: string; g?: Game };

// Stat display order + grouping, mirroring build_test_visual.py's STAT_DEFS.
const STAT_ORDER = ["pass_yards", "completions", "pass_att", "pass_td", "ints",
  "rush_yards", "rush_att", "rush_td", "rec_yards", "receptions", "rec_td"];
const STAT_GROUP: Record<string, "pass" | "rush" | "rec"> = {
  pass_yards: "pass", completions: "pass", pass_att: "pass",
  pass_td: "pass", ints: "pass",
  rush_yards: "rush", rush_att: "rush", rush_td: "rush",
  rec_yards: "rec", receptions: "rec", rec_td: "rec",
};
const FALLBACK_LABEL: Record<string, string> = {
  pass_yards: "Pass Yds", completions: "Comp", pass_att: "Pass Att",
  pass_td: "Pass TD", ints: "INT", rush_yards: "Rush Yds",
  rush_att: "Rush Att", rush_td: "Rush TD", rec_yards: "Rec Yds",
  receptions: "Rec", rec_td: "Rec TD",
};

const WIN = "color-mix(in oklab, #16a34a 22%, white)";
const LOSS = "color-mix(in oklab, #ef4444 22%, white)";
const NEUTRAL = "color-mix(in oklab, var(--brand) 12%, white)";
// A run-vs-run Δ is not good/bad, so emphasis is ink + the page accent, never
// the win/loss greens and reds used for sim-vs-market.
const HOT_BG = "color-mix(in oklab, var(--accent) 28%, white)";
const HOT_BORDER = "color-mix(in oklab, var(--accent) 55%, white)";
/** |Δ| at or above this (points) is a meaningful score/total disagreement. */
const HOT_SCORE = 3;
/** A prop median moves "a lot" at 15% of the larger of the two medians. */
const HOT_MED_FRAC = 0.15;

/** Which statistic the scoreboard shows. */
type ScoreStat = "mean" | "med";
const STAT_KEY = "testVisual.scoreStat";
/** localStorage is unavailable in private modes / sandboxed frames — default. */
function loadScoreStat(): ScoreStat {
  try {
    return window.localStorage.getItem(STAT_KEY) === "med" ? "med" : "mean";
  } catch { return "mean"; }
}
function saveScoreStat(s: ScoreStat): void {
  try { window.localStorage.setItem(STAT_KEY, s); } catch { /* non-fatal */ }
}
/** A median of integer scores lands on a whole or half point: print it like a
 *  scoreboard (34, 34.5) rather than like a statistic (34.0). */
function score(x: number): string {
  return Number.isInteger(x) ? x.toFixed(0) : x.toFixed(1);
}

function pillBg(delta: number | null, tight: number, wide: number): string {
  if (delta == null) return NEUTRAL;
  const a = Math.abs(delta);
  if (a <= tight) return WIN;
  if (a >= wide) return LOSS;
  return NEUTRAL;
}

function sgn(x: number): number { return x > 0 ? 1 : x < 0 ? -1 : 0; }
function fmt(x: number, d = 1): string { return `${x >= 0 ? "+" : ""}${x.toFixed(d)}`; }

/** Column name for a run: the label's first word ("SHIP — ladder…" → SHIP),
 *  else the tag's suffix (slate2026_ctrl → CTRL). Full label is the hover. */
function shortOf(label: string, tag: string): string {
  const w = (label || "").trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "");
  if (w && w.length <= 6) return w.toUpperCase();
  const suf = tag.split(/[_\-.]/).filter(Boolean).pop() ?? tag;
  return suf.slice(0, 6).toUpperCase();
}
/** Keep column names distinct even when two labels start the same way. */
function dedupeShorts(infos: RunInfo[]): RunInfo[] {
  const seen = new Map<string, number>();
  return infos.map(r => {
    const n = (seen.get(r.short) ?? 0) + 1;
    seen.set(r.short, n);
    return n === 1 ? r : { ...r, short: `${r.short}${n}` };
  });
}
/** Games are matched across arms by gid; date+teams is the pre-gid fallback. */
function gameKey(g: Game): string {
  return g.gid != null ? `#${g.gid}` : `${g.date}|${g.home}|${g.away}`;
}

/** Signed Δ, tabular figures, muted until it crosses the emphasis threshold.
 *  `asScore` prints it on the median's whole/half grid instead of fixed dp. */
function Delta({ v, hot, d = 1, size = 14, asScore = false }: {
  v: number | null; hot: boolean; d?: number; size?: number; asScore?: boolean;
}) {
  if (v == null) return <span style={{ color: "var(--muted)" }}>–</span>;
  return (
    <span style={{
      display: "inline-block", fontSize: size, whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums",
      fontWeight: hot ? 800 : 600,
      color: hot ? "var(--text)" : "var(--muted)",
      background: hot ? HOT_BG : "transparent",
      border: `1px solid ${hot ? HOT_BORDER : "transparent"}`,
      borderRadius: 6, padding: hot ? "1px 5px" : "1px 0",
    }}>
      {asScore ? `${v >= 0 ? "+" : ""}${score(v)}` : fmt(v, d)}
    </span>
  );
}

/** Short run name as it appears in headers and the legend. */
function RunTag({ short, label }: { short: string; label: string }) {
  return (
    <span title={label} style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4,
                                 padding: "2px 8px", borderRadius: 999,
                                 border: "1px solid var(--border)", background: NEUTRAL }}>
      {short}
    </span>
  );
}

/** Mean|Median switch, sized to sit beside the page's select controls. */
function StatSwitch({ value, onChange }: {
  value: ScoreStat; onChange: (v: ScoreStat) => void;
}) {
  const opts: [ScoreStat, string][] = [["mean", "Mean"], ["med", "Median"]];
  return (
    <div role="group" aria-label="Scoreboard statistic"
         style={{ display: "flex", borderRadius: 8, overflow: "hidden",
                  border: "1px solid #e2e8f0", background: "#fff" }}>
      {opts.map(([v, lab]) => {
        const on = value === v;
        return (
          <button key={v} type="button" onClick={() => onChange(v)}
            aria-pressed={on}
            title={v === "med" ? "Median score across seeds — reads like a real "
                                + "final score (whole or .5)"
                              : "Mean score across seeds"}
            style={{ font: "inherit", fontSize: 13, fontWeight: on ? 800 : 600,
                     padding: "6px 10px", border: "none", cursor: "pointer",
                     background: on ? "var(--brand)" : "transparent",
                     color: on ? "var(--brand-contrast)" : "var(--text)" }}>
            {lab}
          </button>
        );
      })}
    </div>
  );
}

function TeamRow({ name, scores, delta, showDelta, hot, mkt, logo, color, size,
                   med }: {
  name: string; scores: (number | null)[];
  delta: number | null; showDelta: boolean; hot: boolean;
  mkt: string; logo?: string; color?: string; size: number; med: boolean;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {logo ? (
          <img src={logo} alt={`${name} logo`} width={24} height={24}
               style={{ objectFit: "contain" }} loading="lazy" />
        ) : (
          <div style={{ width: 24, height: 24, borderRadius: 6, flex: "none",
                        background: color ?? "var(--accent)" }} />
        )}
        <div style={{ fontWeight: 800, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      </div>
      {scores.map((s, i) => (
        <div key={i} style={{ fontWeight: 800, fontSize: size, lineHeight: 1,
                              textAlign: "center", fontVariantNumeric: "tabular-nums",
                              color: color ?? "var(--text)" }}>
          {s == null ? "–" : med ? score(s) : s.toFixed(1)}
        </div>
      ))}
      {showDelta && (
        <div style={{ textAlign: "center" }}>
          <Delta v={delta} hot={hot} asScore={med} />
        </div>
      )}
      <div style={{ fontWeight: 800, fontSize: size, lineHeight: 1, textAlign: "center",
                    fontVariantNumeric: "tabular-nums" }}>
        {mkt}
      </div>
    </>
  );
}

function BoxTable({ name, runs }: {
  name: string; runs: { short: string; label: string; box?: TeamBox }[];
}) {
  const multi = runs.length > 1;
  // Union of (category, player) rows: first run's order, later-run extras appended.
  const { keys, cells } = useMemo(() => {
    const ks: string[] = [];
    const cs = new Map<string, (BoxRow | undefined)[]>();
    runs.forEach((r, i) => {
      for (const row of r.box?.rows ?? []) {
        const k = `${row[0]}|${row[1]}`;
        if (!cs.has(k)) { ks.push(k); cs.set(k, runs.map(() => undefined)); }
        cs.get(k)![i] = row;
      }
    });
    return { keys: ks, cells: cs };
  }, [runs]);

  const table = (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
                    minWidth: multi ? 300 + runs.length * 210 : undefined }}>
      {multi && (
        <thead>
          <tr style={{ color: "var(--muted)", fontSize: 11 }}>
            <th style={{ textAlign: "left", padding: "0 0 2px", width: 44 }} />
            <th style={{ textAlign: "left", padding: "0 6px 2px" }}>Player</th>
            {runs.map(r => (
              <th key={r.short} title={r.label}
                  style={{ textAlign: "left", padding: "0 6px 2px", fontWeight: 800 }}>
                {r.short}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {keys.map(k => {
          const row = cells.get(k)!;
          const first = row.find(Boolean)!;
          return (
            <tr key={k} style={multi ? { borderTop: "1px solid var(--border)" } : undefined}>
              <td style={{ textAlign: "left", padding: "2px 0", color: "var(--muted)",
                           fontWeight: 700, width: 44 }}>{first[0]}</td>
              <td style={{ textAlign: "left", padding: multi ? "2px 6px" : "2px 0",
                           fontWeight: 600, whiteSpace: multi ? "nowrap" : undefined }}>
                {first[1]}
              </td>
              {row.map((c, i) => (
                <td key={i} style={{ textAlign: multi ? "left" : "right",
                                     padding: multi ? "2px 6px" : "2px 0",
                                     color: c ? undefined : "var(--muted)",
                                     whiteSpace: multi ? "nowrap" : undefined }}>
                  {c ? c[2] : "—"}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 12, margin: "6px 0 2px" }}>
        {name}
        <span style={{ color: "var(--muted)", fontWeight: 600, marginLeft: 8 }}>
          {runs.map(r => (multi ? `${r.short} ` : "")
            + `${r.box?.pass_yds ?? "–"} pass yds · ${r.box?.rush_yds ?? "–"} rush yds`
          ).join("  |  ")}
        </span>
      </div>
      {multi ? <div style={{ overflowX: "auto" }}>{table}</div> : table}
    </div>
  );
}

// ---- player props ----------------------------------------------------

/** Density ramp on |p − 0.5|: a coin-flip is pale, a near-lock is saturated. */
function probBg(p: number): string {
  const w = Math.round(6 + Math.abs(p - 0.5) * 2 * 30);
  return `color-mix(in oklab, var(--brand) ${w}%, white)`;
}
function num(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}
/** Percentile range; negatives get spaces so "-15.3–-8.7" stays readable. */
function rng(a: number, b: number): string {
  return a < 0 || b < 0 ? `${num(a)} – ${num(b)}` : `${num(a)}–${num(b)}`;
}
/** Sim edge vs the de-vigged book price: green = sim likes the over. */
function edgeBg(e: number): string {
  return e > 0.03 ? WIN : e < -0.03 ? LOSS : NEUTRAL;
}
/** A median gap worth looking at: 15% of the larger of the two medians. */
function hotMedian(a: number, b: number): boolean {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m > 0 && Math.abs(a - b) >= HOT_MED_FRAC * m;
}

function StatRow({ stat, label, cells, shorts, showDelta }: {
  stat: string; label: string; cells: (PropStat | undefined)[];
  shorts: string[]; showDelta: boolean;
}) {
  const multi = cells.length > 1;
  const d0 = cells[0];
  // Chip lines are pinned to the default arm by the builder, so another run's
  // probability at index i is priced at the same number — but verify the line
  // before showing it rather than trusting position.
  const probAt = (s: PropStat | undefined, i: number, t: number): number | null => {
    if (!s) return null;
    const c = s.ov?.[i];
    return c && c[0] === t ? c[1] : (s.ov?.find(x => x[0] === t)?.[1] ?? null);
  };
  const lineStat = cells.find(c => c?.ln)?.ln ?? null;
  const chipLines = cells.find(c => c?.ov?.length)?.ov ?? [];
  const dMed = showDelta && cells[0] && cells[1] ? cells[0]!.md - cells[1]!.md : null;
  const dHot = !!(showDelta && cells[0] && cells[1] && hotMedian(cells[0]!.md, cells[1]!.md));
  // Δ precision follows the stat's own scale (yards get .0, TD/INT get .00).
  const dDigits = cells[0] && cells[1]
    && Math.max(Math.abs(cells[0]!.md), Math.abs(cells[1]!.md)) >= 10 ? 1 : 2;
  const money = (v: number | undefined | null) =>
    v == null ? <span style={{ color: "var(--muted)" }}>—</span> : num(v);

  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td style={{ padding: "3px 6px 3px 0", fontWeight: 700, whiteSpace: "nowrap" }}>
        {label}
      </td>
      {multi ? cells.map((c, i) => (
        <Fragment key={shorts[i]}>
          <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 700,
                       fontVariantNumeric: "tabular-nums" }}>{money(c?.mn)}</td>
          <td style={{ padding: "3px 6px", textAlign: "right",
                       fontVariantNumeric: "tabular-nums" }}>{money(c?.md)}</td>
          <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--muted)",
                       whiteSpace: "nowrap", borderRight: i < cells.length - 1
                         ? "1px solid var(--border)" : undefined }}>
            {c ? rng(c.p10, c.p90) : "—"}
          </td>
        </Fragment>
      )) : (
        <>
          <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 700 }}>
            {money(d0?.mn)}
          </td>
          <td style={{ padding: "3px 6px", textAlign: "right" }}>{money(d0?.md)}</td>
          <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--muted)",
                       whiteSpace: "nowrap" }}>
            {d0 ? rng(d0.p25, d0.p75) : "—"}
          </td>
          <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--muted)",
                       whiteSpace: "nowrap" }}>
            {d0 ? rng(d0.p10, d0.p90) : "—"}
          </td>
        </>
      )}
      {showDelta && (
        <td style={{ padding: "3px 6px", textAlign: "right" }}>
          <Delta v={dMed} hot={dHot} d={dDigits} size={12} />
        </td>
      )}
      <td style={{ padding: "3px 0 3px 6px" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {chipLines.map(([t], i) => {
            const ps = cells.map(c => probAt(c, i, t));
            const lead = ps[0];
            if (lead == null && ps.every(p => p == null)) return null;
            const title = ps.map((p, k) => `${multi ? `${shorts[k]}: ` : ""}`
              + `P(over ${t}) = ${p == null ? "—" : `${(p * 100).toFixed(1)}%`}`).join(" · ");
            return (
              <span key={`${stat}-${t}`} title={title}
                style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999,
                         border: "1px solid var(--border)",
                         background: probBg(lead ?? 0.5), whiteSpace: "nowrap" }}>
                o{t} <b>{lead == null ? "—" : `${(lead * 100).toFixed(0)}%`}</b>
                {ps.slice(1).map((p, k) => (
                  <span key={k} style={{ color: "var(--muted)", marginLeft: 3 }}>
                    ({p == null ? "—" : (p * 100).toFixed(0)})
                  </span>
                ))}
              </span>
            );
          })}
          {lineStat && (
            <span title={`book line ${lineStat.line} (${lineStat.src}); market de-vigged `
                         + `P(over) ${(lineStat.p_over_mkt * 100).toFixed(1)}%`}
              style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999,
                       fontWeight: 700, border: "1px solid var(--border)",
                       background: edgeBg(lineStat.edge) }}>
              book {lineStat.line} · mkt {(lineStat.p_over_mkt * 100).toFixed(0)}%
              {" · sim "}{(lineStat.p_over_sim * 100).toFixed(0)}%
              {" · edge "}{fmt(lineStat.edge * 100, 1)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

export function PropsTable({ name, runs, showDelta, labels, group }: {
  name: string;
  runs: { short: string; label: string; rows: PropRow[] }[];
  showDelta: boolean;
  labels: Record<string, string>;
  group: "all" | "pass" | "rush" | "rec";
}) {
  const multi = runs.length > 1;
  const shorts = runs.map(r => r.short);
  // Player union: first run's order, then anyone only a later run projects.
  const players = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, (PropRow | undefined)[]>();
    runs.forEach((r, i) => {
      for (const row of r.rows) {
        if (!by.has(row.p)) { order.push(row.p); by.set(row.p, runs.map(() => undefined)); }
        by.get(row.p)![i] = row;
      }
    });
    return order.map(p => ({ p, cells: by.get(p)! }));
  }, [runs]);

  if (!players.length) return (
    <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>
      {name}: no prop-volume players
    </div>
  );
  const nCols = (multi ? 1 + 3 * runs.length : 5) + (showDelta ? 1 : 0) + 1;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 13, margin: "8px 0 2px" }}>
        {name}
        {multi && (
          <span style={{ color: "var(--muted)", fontWeight: 600, marginLeft: 8,
                         fontSize: 11 }}>
            one column block per run · chips show {shorts[0]} bold,
            {" "}{shorts.slice(1).join("/")} in parentheses
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
                        minWidth: multi ? 300 + runs.length * 200 : 520 }}>
          <thead>
            {multi ? (
              <>
                <tr style={{ color: "var(--muted)", fontSize: 11 }}>
                  <th rowSpan={2} style={{ textAlign: "left", padding: "0 6px 2px 0" }}>
                    Stat
                  </th>
                  {runs.map(r => (
                    <th key={r.short} colSpan={3} title={r.label}
                        style={{ textAlign: "center", padding: "0 6px 2px",
                                 fontWeight: 800, color: "var(--text)",
                                 borderBottom: "1px solid var(--border)" }}>
                      {r.short}
                    </th>
                  ))}
                  {showDelta && (
                    <th rowSpan={2} style={{ textAlign: "right", padding: "0 6px 2px" }}>
                      Δ Med
                    </th>
                  )}
                  <th rowSpan={2} style={{ textAlign: "left", padding: "0 0 2px 6px" }}>
                    P(over) by line
                  </th>
                </tr>
                <tr style={{ color: "var(--muted)", fontSize: 11, textAlign: "right" }}>
                  {runs.map(r => (
                    <Fragment key={r.short}>
                      <th style={{ padding: "0 6px 2px" }}>Mean</th>
                      <th style={{ padding: "0 6px 2px" }}>Med</th>
                      <th style={{ padding: "0 6px 2px" }}>p10–90</th>
                    </Fragment>
                  ))}
                </tr>
              </>
            ) : (
              <tr style={{ color: "var(--muted)", fontSize: 11, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "0 6px 2px 0" }}>Stat</th>
                <th style={{ padding: "0 6px 2px" }}>Mean</th>
                <th style={{ padding: "0 6px 2px" }}>Med</th>
                <th style={{ padding: "0 6px 2px" }}>p25–75</th>
                <th style={{ padding: "0 6px 2px" }}>p10–90</th>
                <th style={{ textAlign: "left", padding: "0 0 2px 6px" }}>
                  P(over) by line
                </th>
              </tr>
            )}
          </thead>
          {players.map(({ p, cells }) => {
            const first = cells.find(Boolean)!;
            const stats = STAT_ORDER.filter(s =>
              cells.some(c => c?.s[s]) && (group === "all" || STAT_GROUP[s] === group));
            if (!stats.length) return null;
            const missing = runs.filter((_, i) => !cells[i]).map(r => r.short);
            return (
              <tbody key={p}>
                <tr>
                  <td colSpan={nCols} style={{ padding: "8px 0 1px", fontWeight: 800 }}>
                    <span style={{ color: "var(--muted)", fontWeight: 700,
                                   marginRight: 6 }}>{first.pos}</span>
                    {p}
                    {missing.length > 0 && (
                      <span style={{ color: "#92400e", fontWeight: 700, fontSize: 11,
                                     marginLeft: 8 }}>
                        not in {missing.join(", ")}
                      </span>
                    )}
                  </td>
                </tr>
                {stats.map(s => (
                  <StatRow key={s} stat={s} cells={cells.map(c => c?.s[s])}
                           shorts={shorts} showDelta={showDelta}
                           label={labels[s] ?? FALLBACK_LABEL[s] ?? s} />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

export function GameCard({ g, views, showDelta, logos, labels, group,
                           med = false }: {
  g: Game; views: RunView[]; showDelta: boolean;
  logos: Map<string, { id: string; logo: string }>;
  labels: Record<string, string>;
  group: "all" | "pass" | "rush" | "rec";
  /** Show seed medians instead of seed means on the scoreboard. */
  med?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const multi = views.length > 1;
  const hasProps = views.some(v => v.g?.hprops?.length || v.g?.aprops?.length);
  const hc = getTeamColors(g.home)?.primary;
  const ac = getTeamColors(g.away)?.primary;
  const hLogo = localizeLogoUrl(lookupEspnLogo(logos as any, g.home)?.logo);
  const aLogo = localizeLogoUrl(lookupEspnLogo(logos as any, g.away)?.logo);

  const simMargin = g.hs - g.as;
  const mktMargin = g.spread == null ? null : -g.spread;
  const spreadDelta = mktMargin == null ? null : simMargin - mktMargin;
  const simTotal = g.hs + g.as;
  const totalDelta = g.ou == null ? null : simTotal - g.ou;
  const mktScore = (side: "h" | "a"): string => {
    if (mktMargin == null || g.ou == null) return "–";
    const v = side === "h" ? (g.ou + mktMargin) / 2 : (g.ou - mktMargin) / 2;
    return v.toFixed(1);
  };
  const favName = mktMargin == null ? "" : (mktMargin >= 0 ? g.home : g.away);

  // ---- paired columns --------------------------------------------------
  // Mean or median per the page switch. The median TOTAL is its own field —
  // median(home + away) per seed, which is not hs_med + as_med.
  const home = views.map(v => (v.g ? (med ? v.g.hs_med ?? null : v.g.hs) : null));
  const away = views.map(v => (v.g ? (med ? v.g.as_med ?? null : v.g.as) : null));
  const total = views.map(v =>
    v.g ? (med ? v.g.tot_med ?? null : v.g.hs + v.g.as) : null);
  const gap = (xs: (number | null)[]): number | null =>
    showDelta && xs[0] != null && xs[1] != null ? xs[0]! - xs[1]! : null;
  const dHome = gap(home), dAway = gap(away), dTotal = gap(total);
  const hot = (d: number | null) => d != null && Math.abs(d) >= HOT_SCORE;

  // Pick-flip flags compare the first two arms only (the Δ pair).
  const other = showDelta ? views[1].g : undefined;
  const dMargin = other ? simMargin - (other.hs - other.as) : null;
  const sideFlip = !!other && mktMargin != null
    && sgn(simMargin - mktMargin) !== sgn((other.hs - other.as) - mktMargin);
  const totalFlip = !!other && g.ou != null
    && sgn(simTotal - g.ou) !== sgn((other.hs + other.as) - g.ou);

  const scoreSize = multi ? 18 : 22;
  const runCol = multi ? 62 : 90;
  const mktCol = multi ? 68 : 90;
  const cols = `${multi ? "minmax(86px,1fr)" : "minmax(0,1fr)"} `
    + `repeat(${views.length}, ${runCol}px)${showDelta ? " 64px" : ""} ${mktCol}px`;
  const minW = 86 + views.length * runCol + (showDelta ? 64 : 0) + mktCol
    + 8 * (views.length + (showDelta ? 1 : 0) + 1);
  const hdr = { fontSize: 12, color: "var(--muted)", textAlign: "center" } as const;

  const grid = (
    <div style={{ display: "grid", gridTemplateColumns: cols, rowGap: 6, columnGap: 8,
                  alignItems: "center", minWidth: multi ? minW : undefined }}>
      <div />
      {views.map(v => (
        <div key={v.short} title={v.label}
             style={{ ...hdr, fontWeight: multi ? 800 : 400,
                      color: multi ? "var(--text)" : "var(--muted)" }}>
          {multi ? v.short : "Projected"}
        </div>
      ))}
      {showDelta && <div style={hdr}>Δ</div>}
      <div style={hdr}>Market</div>
      <TeamRow name={g.away} scores={away} delta={dAway} showDelta={showDelta}
               hot={hot(dAway)} mkt={mktScore("a")} logo={aLogo} color={ac}
               size={scoreSize} med={med} />
      <TeamRow name={g.home} scores={home} delta={dHome} showDelta={showDelta}
               hot={hot(dHome)} mkt={mktScore("h")} logo={hLogo} color={hc}
               size={scoreSize} med={med} />
      {multi && (
        <>
          <div style={{ fontWeight: 800, fontSize: 13, color: "var(--muted)",
                        paddingLeft: 32 }}>Total</div>
          {total.map((t, i) => (
            <div key={i} style={{ fontWeight: 800, fontSize: scoreSize, lineHeight: 1,
                                  textAlign: "center",
                                  fontVariantNumeric: "tabular-nums" }}>
              {t == null ? "–" : med ? score(t) : t.toFixed(1)}
            </div>
          ))}
          {showDelta && (
            <div style={{ textAlign: "center" }}>
              <Delta v={dTotal} hot={hot(dTotal)} asScore={med} />
            </div>
          )}
          <div style={{ fontWeight: 800, fontSize: scoreSize, lineHeight: 1,
                        textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
            {g.ou == null ? "–" : g.ou.toFixed(1)}
          </div>
        </>
      )}
    </div>
  );

  return (
    <article className="card" style={{ padding: 12, borderRadius: 12,
        border: sideFlip ? "1px solid #f59e0b" : "1px solid var(--border)",
        background: "var(--card)",
        display: "grid", gridTemplateRows: "auto auto auto", gap: 8,
        // props tables need room: an opened card takes the full grid width
        gridColumn: propsOpen ? "1 / -1" : undefined,
        contentVisibility: propsOpen ? "visible" : "auto",
        containIntrinsicSize: "300px" } as any}>
      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex",
                    justifyContent: "space-between" }}>
        <span>{g.date}</span>
        <span>{g.fpi == null ? "" : `FPI ${g.fpi > 0 ? "+" : ""}${g.fpi}`}</span>
      </div>

      {multi ? <div style={{ overflowX: "auto" }}>{grid}</div> : grid}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)",
                       background: pillBg(spreadDelta, 3, 10) }}>
          {g.spread == null ? "Spread: —"
            : `Spread: ${favName} ${(-Math.abs(g.spread)).toFixed(1)} · ${
                multi ? `${views[0].short} ` : "sim "}Δ ${
                spreadDelta! >= 0 ? "+" : ""}${spreadDelta!.toFixed(1)}`}
        </span>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)",
                       background: pillBg(totalDelta, 3, 8) }}>
          {g.ou == null ? "Total: —"
            : `O/U ${g.ou.toFixed(1)} · ${multi ? views[0].short : "sim"} ${
                simTotal.toFixed(1)} (${
                totalDelta! >= 0 ? "+" : ""}${totalDelta!.toFixed(1)})`}
        </span>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)", background: NEUTRAL }}
              title={multi ? views.map(v => `${v.label}: ${
                v.g == null ? "—" : `${(v.g.hw * 100).toFixed(0)}%`}`).join(" · ")
                : undefined}>
          {g.home} win {views.map(v =>
            v.g == null ? "–" : `${(v.g.hw * 100).toFixed(0)}%`).join(" · ")}
        </span>
      </div>

      {showDelta && (
        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex",
                      gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span>Δ margin{" "}
            <Delta v={dMargin} hot={hot(dMargin)} size={12} />{" "}
            ({views[0].short} − {views[1].short})</span>
          {sideFlip && (
            <span style={{ padding: "2px 8px", borderRadius: 999, fontWeight: 700,
                           background: "color-mix(in oklab, #f59e0b 25%, white)",
                           color: "#7c2d12" }}>spread pick flips</span>
          )}
          {totalFlip && (
            <span style={{ padding: "2px 8px", borderRadius: 999, fontWeight: 700,
                           background: "color-mix(in oklab, #6366f1 22%, white)",
                           color: "#312e81" }}>total pick flips</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ font: "inherit", fontSize: 13, padding: "6px 10px", borderRadius: 8,
                   border: "1px solid var(--border)", cursor: "pointer",
                   background: open ? "var(--brand)" : "var(--card)",
                   color: open ? "var(--brand-contrast)" : "var(--text)" }}>
          {open ? "Hide Box Score" : "Box Score"}
        </button>
        {hasProps && (
          <button onClick={() => setPropsOpen(o => !o)}
            style={{ font: "inherit", fontSize: 13, padding: "6px 10px", borderRadius: 8,
                     border: "1px solid var(--border)", cursor: "pointer",
                     background: propsOpen ? "var(--brand)" : "var(--card)",
                     color: propsOpen ? "var(--brand-contrast)" : "var(--text)" }}>
            {propsOpen ? "Hide Player Props" : "Player Props"}
          </button>
        )}
      </div>

      {open && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <BoxTable name={g.away}
                    runs={views.map(v => ({ short: v.short, label: v.label,
                                            box: v.g?.abox }))} />
          <BoxTable name={g.home}
                    runs={views.map(v => ({ short: v.short, label: v.label,
                                            box: v.g?.hbox }))} />
        </div>
      )}

      {propsOpen && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
            Seed distribution per player · Mean/Med/percentiles are the sim's
            own spread · o&lt;line&gt; chips are P(stat &gt; line)
            {showDelta && ` · Δ Med = ${views[0].short} − ${views[1].short}, `
              + "emphasized at 15% of the larger median"}
          </div>
          <PropsTable name={g.away} showDelta={showDelta} labels={labels} group={group}
                      runs={views.map(v => ({ short: v.short, label: v.label,
                                              rows: v.g?.aprops ?? [] }))} />
          <PropsTable name={g.home} showDelta={showDelta} labels={labels} group={group}
                      runs={views.map(v => ({ short: v.short, label: v.label,
                                              rows: v.g?.hprops ?? [] }))} />
        </div>
      )}
    </article>
  );
}

function MetricStrip({ r, base }: { r: RunMeta; base?: RunMeta }) {
  const cells: [string, string, string | null][] = [
    ["slope vs FPI", r.slope_fpi.toFixed(3), base ? fmt(r.slope_fpi - base.slope_fpi, 3) : null],
    ["slope vs mkt", r.slope_mkt.toFixed(3), base ? fmt(r.slope_mkt - base.slope_mkt, 3) : null],
    ["MAE vs mkt", r.mae_mkt.toFixed(2), base ? fmt(r.mae_mkt - base.mae_mkt, 2) : null],
    [">14 off mkt", `${(r.gt14 * 100).toFixed(1)}%`,
      base ? fmt((r.gt14 - base.gt14) * 100, 1) : null],
    ["mean total", r.mean_total.toFixed(1), base ? fmt(r.mean_total - base.mean_total) : null],
    ["total − o/u", r.tot_vs_ou.toFixed(2), base ? fmt(r.tot_vs_ou - base.tot_vs_ou, 2) : null],
    ["OVER picks", `${r.overs}/${r.n_ou}`, null],
  ];
  if (r.n_props) cells.push(["prop players", String(r.n_props), null]);
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
      {cells.map(([lab, v, d]) => (
        <div key={lab}>
          <div style={{ color: "var(--muted)" }}>{lab}</div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {v}
            {d && <span style={{ color: "var(--muted)", fontWeight: 600,
                                 marginLeft: 5 }}>{d}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TestVisual() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logos, setLogos] = useState<Map<string, any> | null>(null);
  const [sort, setSort] = useState<"kick" | "spread" | "disagree">("kick");
  const [group, setGroup] = useState<"all" | "pass" | "rush" | "rec">("all");
  const [scoreStat, setScoreStat] = useState<ScoreStat>(loadScoreStat);
  const pickStat = (s: ScoreStat) => { setScoreStat(s); saveScoreStat(s); };

  useEffect(() => {
    fetch("/data/test-visual.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d: Payload) => setData(d))
      .catch(e => setErr(String(e)));
    getEspnTeamsMap().then(setLogos).catch(() => setLogos(new Map()));
  }, []);

  const runMap: Record<string, Game[]> =
    data?.runs ?? (data ? { [data.meta.tag]: data.games } : {});

  // Column order = meta.runs order (first run is the Δ minuend and the sort key).
  const runInfos: RunInfo[] = useMemo(() => {
    if (!data) return [];
    const metas = data.meta.runs ?? [];
    const tags = metas.length ? metas.map(m => m.tag) : Object.keys(runMap);
    const infos = tags.filter(t => runMap[t]?.length).map(t => {
      const m = metas.find(x => x.tag === t);
      return { tag: t, meta: m, label: m?.label ?? t, short: shortOf(m?.label ?? "", t) };
    });
    return dedupeShorts(infos);
  }, [data]);
  const multi = runInfos.length > 1;
  // Δ is defined only for a clean pair; 3+ arms show columns without a Δ.
  const showDelta = runInfos.length === 2;
  const baseTag = runInfos[0]?.tag ?? "";

  // Cards come from the first run; the others are joined on gid. Sorting keys
  // off that same run, so the order is identical no matter what an arm says.
  const games = useMemo(() => {
    const gs = [...(runMap[baseTag] ?? [])];
    const keyOf = (g: Game) => {
      if (sort === "spread") return -Math.abs(g.spread ?? 0);
      if (sort === "disagree") {
        return g.spread == null ? 1 : -Math.abs((g.hs - g.as) - (-g.spread));
      }
      return 0;
    };
    if (sort !== "kick") gs.sort((a, b) => keyOf(a) - keyOf(b));
    return gs;
  }, [data, sort, baseTag]);

  // The switch appears only when EVERY game of EVERY arm carries the medians;
  // an older payload (or a half-built one) renders exactly as it did before.
  const hasMed = useMemo(() => {
    const all = Object.values(runMap).flat();
    return all.length > 0 && all.every(
      x => x.hs_med != null && x.as_med != null && x.tot_med != null);
  }, [data]);
  const med = hasMed && scoreStat === "med";

  const byRun = useMemo(() => runInfos.map(r => {
    const m = new Map<string, Game>();
    for (const g of runMap[r.tag] ?? []) m.set(gameKey(g), g);
    return m;
  }), [data, runInfos]);

  if (err) return <div className="card" style={{ padding: 16 }}>
    No test data published yet ({err}).</div>;
  if (!data || !logos) return <div style={{ color: "var(--muted)" }}>Loading…</div>;

  const propsMeta = data.meta.props;
  const labels = propsMeta?.stats ?? FALLBACK_LABEL;
  const anyProps = games.some(g => g.hprops?.length || g.aprops?.length);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 16,
          display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>
            Sim Test — {data.meta.season} Week {data.meta.week}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {data.meta.generated} · {data.meta.n_games} games
            · scores are sim {med ? "medians" : "means"} · Δ = sim minus market
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            {hasMed && (
              <>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Scores</label>
                <StatSwitch value={scoreStat} onChange={pickStat} />
              </>
            )}
            {anyProps && (
              <>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Props</label>
                <select value={group} onChange={e => setGroup(e.target.value as any)}
                  style={{ padding: "6px 10px", borderRadius: 8,
                           border: "1px solid #e2e8f0", background: "#fff" }}>
                  <option value="all">All stats</option>
                  <option value="pass">Passing</option>
                  <option value="rush">Rushing</option>
                  <option value="rec">Receiving</option>
                </select>
              </>
            )}
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Sort by</label>
            <select value={sort} onChange={e => setSort(e.target.value as any)}
              style={{ padding: "6px 10px", borderRadius: 8,
                       border: "1px solid #e2e8f0", background: "#fff" }}>
              <option value="kick">Kickoff</option>
              <option value="spread">Biggest spread</option>
              <option value="disagree">Sim vs market disagreement</option>
            </select>
          </div>
        </div>

        {/* What this run IS — the guard against reading stale data as new. */}
        {data.meta.note && (
          <div style={{ fontSize: 13, fontWeight: 700, padding: "8px 10px",
                        borderRadius: 8, border: "1px solid #f59e0b",
                        background: "color-mix(in oklab, #f59e0b 16%, white)",
                        color: "#7c2d12" }}>
            {data.meta.note}
          </div>
        )}
        {!multi && runInfos[0] && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Run <b style={{ color: "var(--text)" }}>{runInfos[0].label}</b>
            {runInfos[0].meta?.src ? ` · ${runInfos[0].meta.src}` : ""}
          </div>
        )}
        {anyProps && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Player props: {propsMeta?.lines
              ? `book lines from ${propsMeta.lines.source} `
                + `(${propsMeta.lines.n_markets.toLocaleString()} markets) — `
                + "chips show market P(over) and the sim's edge"
              : "no 2026 book lines available — distribution-only view "
                + "(P(over) at sim-chosen half-point lines)"}
          </div>
        )}

        {/* Legend: every run is on screen at once, so this is the key, not a toggle. */}
        {multi && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              All runs shown side by side
              {showDelta
                ? ` · Δ = ${runInfos[0].short} − ${runInfos[1].short}, emphasized at `
                  + "|Δ| ≥ 3 pts on scores and 15% of the larger median on props"
                : " · Δ column shows only when exactly two runs are loaded"}
            </div>
            {runInfos.map((r, i) => (
              <div key={r.tag} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center",
                              flexWrap: "wrap" }}>
                  <RunTag short={r.short} label={r.label} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{r.label}</span>
                  {r.meta?.src && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {r.meta.src}
                    </span>
                  )}
                </div>
                {r.meta && (
                  <MetricStrip r={r.meta} base={i > 0 ? runInfos[0].meta : undefined} />
                )}
              </div>
            ))}
          </div>
        )}

        {!multi && runInfos[0]?.meta && <MetricStrip r={runInfos[0].meta} />}
      </section>

      {/* min() keeps the track from overflowing a phone: it drops to 1 column. */}
      <div style={{ display: "grid", gap: 16,
                    gridTemplateColumns: `repeat(auto-fit, minmax(min(${
                      multi ? 380 : 320}px, 100%), 1fr))`,
                    alignItems: "start" }}>
        {games.map((g, i) => {
          const k = gameKey(g);
          const views: RunView[] = runInfos.map((r, j) => ({
            short: r.short, label: r.label, g: byRun[j]?.get(k),
          }));
          return (
            <GameCard key={g.gid ?? i} g={g} views={views} showDelta={showDelta}
                      logos={logos} labels={labels} group={group} med={med} />
          );
        })}
      </div>
    </div>
  );
}
