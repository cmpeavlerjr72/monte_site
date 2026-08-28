// src/components/TeamStats.tsx
//
// Team box-stat distributions for one simulated game, drawn as glanceable
// DISTRIBUTION STRIPS with live Kalshi prices overlaid on the rungs.
//
// ---------------------------------------------------------------------------
// What the reader has to do (this picked the form)
// ---------------------------------------------------------------------------
// "Where does the sim live, and where do the market's break points fall inside
// it?" That is an interval-vs-reference-marks read, not a magnitude ranking —
// so each team gets a horizontal strip on a scale SHARED with its opponent
// (teamA above teamB), carrying a q10–q90 band, a median marker, and a hash at
// every Kalshi strike. Percentages ride above the hashes; strikes label the one
// shared axis below both strips. The old chip table said the same thing in
// prose and made the reader do the comparing.
//
// ---------------------------------------------------------------------------
// Color (validated, not eyeballed)
// ---------------------------------------------------------------------------
// School brand hexes FAIL as a mark palette — validate_palette.js on the
// UNC/TCU pair reports contrast 2.29:1 for #7bafd4 on the light surface and
// 1.44:1 for #4d1979 on the dark one (both below 3:1), plus a chroma-floor
// fail. So brand color is used ONLY as a low-opacity band wash over a
// token-colored base and as an identity swatch beside a text label; every
// load-bearing mark — median, hashes, axis, and ALL text — wears theme tokens
// and is AA in both themes. The relief the validator demands for a sub-3:1
// color (visible labels + a table view) is present twice over: every strip is
// directly labeled, and the numeric table is one toggle away.
// Status tokens (--pos/--neg) appear only on the edge marker, always with a
// sign character, never as color alone.
//
// ---------------------------------------------------------------------------
// Division of labour
// ---------------------------------------------------------------------------
// Distributions are precomputed by the sim repo's export_team_stats.py (per
// simulated game FIRST, then aggregated across seeds). Market flags,
// orientation, the YES midpoint and the edge subtraction all come out of
// src/lib/edges.ts. This file formats and lays out; it derives no statistic.
//
// A missing file (FCS namespace, or a week the exporter has not reached) is
// the expected pre-publish state: quiet muted line, never an error banner.
// Missing PRICES are likewise silent — most stat families have no Kalshi
// ladder yet, and a stat with no market simply shows no price row.

import { useEffect, useMemo, useState } from "react";
import {
  getTeamStatsCached, TeamStatsNotPublished,
  getTeamMarketsCached, TeamMarketsNotPublished,
  type TeamStats as TeamStatsDoc, type TeamStatDist, type TeamMarketRow,
} from "../lib/cfbJson";
import {
  indexTeamStatQuotes, teamStatEdge, type TeamStatQuote,
} from "../lib/edges";
import type { Season } from "../lib/cfbData";

type Props = {
  /** Our game slug — the key team_stats.json and team_markets.json share. */
  slug: string;
  /** Dataset namespace of THIS CARD ("2026"), never the page's season. */
  ns: Season;
  weekId: string;
  /** Home / away, used to order the two strips. */
  teamA: string;
  teamB: string;
  colorFor?: (team: string) => string | undefined;
};

/** Display order + labels. Keys must match the exporter's stat keys. */
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

/** A hash gets a % label only inside this band; outside it the bare hash still
 *  marks the strike, but "100%"/"0%" on every rung is noise. */
const PCT_LO = 0.03;
const PCT_HI = 0.97;

/* -------------------------------- geometry ------------------------------- */
// 900 is set by the DENSEST row, not by taste: team points ladder 6.5→48.5 has
// a 3-point gap, which at this width is ~40px — wider than the longest price
// label ("97 −5" ≈ 33px). Narrower and the market row collides; the block
// scrolls horizontally rather than compressing (brief rule: wide content
// scrolls in its own container).
const PLOT_W = 900;      // min drawing width; the block scrolls below this
const GUTTER = 148;      // team label + median/range column
const PAD_R = 18;
const PCT_H = 13;        // % labels above the strip
const STRIP_H = 20;
const MKT_H = 13;        // market price row (only when the stat has quotes)
const ROW_GAP = 5;
const AXIS_H = 15;

const fmt = (v: number | null, dp = 1): string =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(dp);

const dpFor = (key: string): number =>
  key.endsWith("_yards") || key === "points" ? 0 : 1;

const cents = (p: number): string => `${Math.round(p * 100)}c`;

/** Round the axis top to a clean step so the ticks read as real numbers. */
function niceMax(raw: number): number {
  const step = raw > 200 ? 50 : raw > 60 ? 25 : raw > 20 ? 5 : raw > 8 ? 2 : 1;
  return Math.max(step, Math.ceil(raw / step) * step);
}

type Rung = { k: number; label: string };

const rungList = (d: TeamStatDist | undefined): Rung[] =>
  d?.rungs
    ? Object.keys(d.rungs)
        .map((k) => ({ k: Number(k), label: k }))
        .filter((r) => Number.isFinite(r.k))
        .sort((a, b) => a.k - b.k)
    : [];

/* ------------------------------- one strip -------------------------------- */
function Strip({
  team, d, quotes, statKey, axisMax, y, showMarket, brand,
}: {
  team: string;
  d: TeamStatDist;
  quotes: Map<string, TeamStatQuote>;
  statKey: string;
  axisMax: number;
  y: number;
  showMarket: boolean;
  brand: string;
}) {
  const x = (v: number) => GUTTER + (Math.max(0, Math.min(v, axisMax)) / axisMax) * (PLOT_W - GUTTER - PAD_R);
  const stripY = y + PCT_H;
  const mid = stripY + STRIP_H / 2;
  const dp = dpFor(statKey);

  const q10 = d.q10 ?? 0;
  const q90 = d.q90 ?? 0;
  const med = d.median ?? 0;
  const bandX = x(q10);
  const bandW = Math.max(2, x(q90) - bandX);

  return (
    <g>
      {/* ---- gutter: identity swatch + name + the direct-labelled median ---- */}
      <rect x={0} y={mid - 5} width={9} height={9} rx={2} fill={brand} />
      <text
        x={14} y={mid - 1} fontSize={11} fontWeight={700}
        fill="var(--text)" dominantBaseline="middle"
      >
        {team.length > 20 ? `${team.slice(0, 19)}…` : team}
      </text>
      <text x={14} y={mid + 11} fontSize={10} fill="var(--muted)">
        {fmt(med, dp)}
        <tspan fill="var(--muted)">{`  ${fmt(q10, dp)}–${fmt(q90, dp)}`}</tspan>
      </text>

      {/* ---- track: hairline, one step off the surface, solid ---- */}
      <line
        x1={x(0)} x2={x(axisMax)} y1={mid} y2={mid}
        stroke="var(--border)" strokeWidth={1}
      />

      {/* ---- band q10..q90: token base so it is visible on any surface,
              then the school wash on top for identity ---- */}
      <rect x={bandX} y={stripY} width={bandW} height={STRIP_H} rx={3} fill="var(--fill)" />
      <rect x={bandX} y={stripY} width={bandW} height={STRIP_H} rx={3} fill={brand} opacity={0.22}>
        <title>{`${team}: 80% of simulated games fall between ${fmt(q10, dp)} and ${fmt(q90, dp)}`}</title>
      </rect>

      {/* ---- median: the one loud mark ---- */}
      <line
        x1={x(med)} x2={x(med)} y1={stripY - 3} y2={stripY + STRIP_H + 3}
        stroke="var(--text)" strokeWidth={2} strokeLinecap="round"
      >
        <title>{`${team} median ${fmt(med, dp)}`}</title>
      </line>

      {/* ---- Kalshi break points ---- */}
      {rungList(d).map((r) => {
        const p = d.rungs?.[r.label];
        if (p === undefined || r.k > axisMax) return null;
        const hx = x(r.k);
        const q = quotes.get(`${statKey}|${team}|${r.k}`);
        const edge = q ? teamStatEdge(q, p) : null;
        const labelPct = p >= PCT_LO && p <= PCT_HI;
        return (
          <g key={r.label}>
            <line
              x1={hx} x2={hx} y1={stripY} y2={stripY + STRIP_H}
              stroke="var(--muted)" strokeWidth={1} opacity={0.7}
            >
              <title>
                {`${team} P(over ${r.label}) = ${(p * 100).toFixed(1)}%`}
                {q ? ` · market ${cents(q.yesBid)}–${cents(q.yesAsk)}` : ""}
              </title>
            </line>
            {labelPct && (
              <text
                x={hx} y={y + PCT_H - 3} fontSize={10} fontWeight={600}
                textAnchor="middle" fill="var(--text)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Math.round(p * 100)}%
              </text>
            )}
            {showMarket && q && (
              <text
                x={hx} y={stripY + STRIP_H + MKT_H - 3} fontSize={9.5}
                textAnchor="middle"
                fill={edge === null ? "var(--muted)" : edge > 0 ? "var(--pos)" : "var(--neg)"}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {/* bare cents: the caption names the unit, and the "c" costs
                    the width this row does not have. Full bid/ask in the
                    hover layer below. */}
                {q.tradeable
                  ? Math.round(q.mid * 100)
                  : `${Math.round(q.yesBid * 100)}–${Math.round(q.yesAsk * 100)}`}
                {edge !== null
                  ? ` ${edge > 0 ? "+" : "−"}${Math.abs(Math.round(edge * 100))}`
                  : ""}
                <title>
                  {`market ${cents(q.yesBid)} bid / ${cents(q.yesAsk)} ask`}
                  {q.tradeable
                    ? edge !== null
                      ? ` · edge ${edge > 0 ? "+" : "−"}${Math.abs(Math.round(edge * 100))}c vs sim`
                      : " · no edge at the 3c threshold"
                    : ` · ${q.flags.join("/")} book — price shown, edge withheld`}
                </title>
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------ one stat block ---------------------------- */
function StatBlock({
  statKey, label, unit, definition, cols, stats, quotes, colorFor,
}: {
  statKey: string;
  label: string;
  unit?: string;
  definition?: string;
  cols: string[];
  stats: Record<string, Record<string, TeamStatDist>>;
  quotes: Map<string, TeamStatQuote>;
  colorFor?: (team: string) => string | undefined;
}) {
  const dists = cols.map((t) => stats[t]?.[statKey]);
  const nulls = dists.every((d) => !d || d.median === null);

  if (nulls) {
    const reason = dists.find((d) => d?.reason)?.reason;
    return (
      <div style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
          n/a (not simulated){reason ? ` — ${reason}` : ""}
        </div>
      </div>
    );
  }

  // Shared scale: one axis for both teams so the strips compare directly.
  const rungs = rungList(dists.find((d) => d?.rungs) ?? undefined);
  const maxRung = rungs.length ? rungs[rungs.length - 1].k : 0;
  const maxQ90 = Math.max(...dists.map((d) => d?.q90 ?? 0));
  const axisMax = niceMax(Math.max(maxQ90 * 1.12, maxRung * 1.06, 1));

  const showMarket = cols.some((t) =>
    rungs.some((r) => quotes.has(`${statKey}|${t}|${r.k}`))
  );
  const rowH = PCT_H + STRIP_H + (showMarket ? MKT_H : 0) + ROW_GAP;
  const height = rowH * cols.length + AXIS_H;
  const x = (v: number) => GUTTER + (v / axisMax) * (PLOT_W - GUTTER - PAD_R);

  // Drop every other strike label when the ticks would collide.
  const span = (PLOT_W - GUTTER - PAD_R) / Math.max(1, axisMax);
  const tickStep = rungs.length > 1 && (rungs[1].k - rungs[0].k) * span < 34 ? 2 : 1;

  return (
    <div style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }} title={definition}>
          {label}
        </span>
        {unit && <span style={{ fontSize: 10, color: "var(--muted)" }}>{unit}</span>}
      </div>
      <svg
        width={PLOT_W} height={height} viewBox={`0 0 ${PLOT_W} ${height}`}
        role="img" aria-label={`${label} simulated distribution by team`}
        style={{ display: "block", maxWidth: "none" }}
      >
        {cols.map((t, i) => {
          const d = stats[t]?.[statKey];
          if (!d || d.median === null) return null;
          return (
            <Strip
              key={t} team={t} d={d} quotes={quotes} statKey={statKey}
              axisMax={axisMax} y={i * rowH} showMarket={showMarket}
              brand={colorFor?.(t) ?? "var(--brand)"}
            />
          );
        })}
        {/* shared axis: the strike labels for the hashes above */}
        <line
          x1={x(0)} x2={x(axisMax)} y1={rowH * cols.length - 2}
          y2={rowH * cols.length - 2} stroke="var(--border)" strokeWidth={1}
        />
        <text x={x(0)} y={rowH * cols.length + 9} fontSize={9} fill="var(--muted)" textAnchor="middle">0</text>
        {rungs.filter((_, i) => i % tickStep === 0).map((r) =>
          r.k > axisMax ? null : (
            <text
              key={r.label} x={x(r.k)} y={rowH * cols.length + 9} fontSize={9}
              fill="var(--muted)" textAnchor="middle"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {r.label}
            </text>
          )
        )}
      </svg>
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
  return (
    <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Stat</th>
          {cols.map((t) => (
            <th key={t} style={{ textAlign: "left", padding: "4px 8px", fontSize: 11.5, fontWeight: 800, color: "var(--text)", borderBottom: "1px solid var(--border)" }}>
              {t}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.key}>
            <th scope="row" title={defs[r.key]} style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600, color: "var(--text)", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
              {r.label}
            </th>
            {cols.map((t) => {
              const d = stats[t]?.[r.key];
              const dp = dpFor(r.key);
              return (
                <td key={t} style={{ padding: "5px 8px", borderBottom: "1px solid var(--border)", color: "var(--text)", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }}>
                  {!d || d.median === null ? (
                    <span style={{ color: "var(--muted)" }}>
                      n/a (not simulated){d?.reason ? ` — ${d.reason}` : ""}
                    </span>
                  ) : (
                    <>
                      <strong>{fmt(d.median, dp)}</strong>
                      <span style={{ color: "var(--muted)" }}>{`  ${fmt(d.q10, dp)}–${fmt(d.q90, dp)}`}</span>
                      {d.rungs && (
                        <div style={{ color: "var(--muted)", fontSize: 10.5 }}>
                          {Object.entries(d.rungs)
                            .filter(([, p]) => p >= PCT_LO && p <= PCT_HI)
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
  slug, ns, weekId, teamA, teamB, colorFor,
}: Props) {
  const [doc, setDoc] = useState<TeamStatsDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mkt, setMkt] = useState<{ rows: TeamMarketRow[]; updated: string | null } | null>(null);
  const [view, setView] = useState<"strips" | "table">("strips");

  // Lazy: mounts only when the panel is open; both loaders are memoized per
  // (namespace, week) in module state. Deps are PRIMITIVES only (brief rule 4).
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

  // Prices are a supplement: any failure (including the FCS 404) leaves the
  // strips fully readable, so nothing here ever reaches the error state.
  useEffect(() => {
    let alive = true;
    getTeamMarketsCached(ns, weekId)
      .then((m) => { if (alive) setMkt({ rows: m.rows, updated: m.updated }); })
      .catch((e: any) => {
        if (!alive) return;
        if (!(e instanceof TeamMarketsNotPublished || e?.name === "TeamMarketsNotPublished")) {
          console.warn("[TeamStats] team_markets load failed:", e);
        }
        setMkt({ rows: [], updated: null });
      });
    return () => { alive = false; };
  }, [ns, weekId]);

  const game = doc?.games?.[slug];

  // Column order follows the card (home first); the KEYS come from the
  // published file verbatim, never retyped (brief rule 1).
  const cols = useMemo(() => {
    if (!game) return [];
    const keys = Object.keys(game.stats);
    const out = [teamA, teamB].filter((t) => keys.includes(t));
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
  }, [game, teamA, teamB]);

  const quotes = useMemo(
    () => (mkt && cols.length ? indexTeamStatQuotes(mkt.rows, slug, cols) : new Map<string, TeamStatQuote>()),
    [mkt, slug, cols]
  );

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
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Shaded band = middle 80% of simulated games (10th–90th percentile);
          the upright mark is the median. Hashes are Kalshi break points —
          percentage above is the sim's P(over); the number below is the
          market price in cents, with our edge beside it.
          {doc.nsims ? ` ${doc.nsims.toLocaleString()} sims.` : ""}
        </span>
        <button
          type="button" className="ui-btn"
          onClick={() => setView((v) => (v === "strips" ? "table" : "strips"))}
          style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 11 }}
        >
          {view === "strips" ? "Table view" : "Strip view"}
        </button>
      </div>
      {priced && mkt?.updated && (
        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Prices as of {new Date(mkt.updated).toLocaleString()} · midpoint of the
          Kalshi book; a THIN/TAIL/NOISE quote shows its bid–ask and never an edge.
        </div>
      )}

      {/* Wide content scrolls inside its own container; the page never does. */}
      <div style={{ overflowX: "auto" }}>
        {view === "strips" ? (
          <div style={{ minWidth: PLOT_W }}>
            {ROWS.map((r) => (
              <StatBlock
                key={r.key} statKey={r.key} label={r.label} unit={r.unit}
                definition={doc.definitions?.[r.key]}
                cols={cols} stats={game.stats} quotes={quotes} colorFor={colorFor}
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
