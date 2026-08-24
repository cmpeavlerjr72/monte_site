// src/pages/TestVisual.tsx
// Hidden sim-test scoreboard — reachable only at /test-visual (no nav link).
// Renders public/data/test-visual.json, regenerated from cfb-props-sim by
// scripts/build_test_visual.py --run <tag>[:"Label"] (repeat for arms).
// Used to eyeball week-1 slate tests during model iteration; the tag +
// generated stamp identify the run.
//
// Multi-arm (2026-08-19): when the payload carries several runs, the header
// gets a toggle and every card shows its delta against the comparison arm.
// Card ORDER is held fixed across arms — both in the builder and in the sort
// below, which always keys off the default arm — so flipping between them
// moves the numbers and nothing else.
//
// Player props (2026-08-23): each game also carries hprops/aprops — per
// player x stat SEED DISTRIBUTIONS (mean/median/p10..p90) plus P(over) at
// half-point thresholds bracketing the median. The props panel is a second
// expander alongside the box score, never a replacement for it. When a book
// line is present (stat.ln, null until a 2026 prop pull exists) the row also
// shows the market's de-vigged P(over) and the sim's edge at that line.

import { useEffect, useMemo, useState } from "react";
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

function pillBg(delta: number | null, tight: number, wide: number): string {
  if (delta == null) return NEUTRAL;
  const a = Math.abs(delta);
  if (a <= tight) return WIN;
  if (a >= wide) return LOSS;
  return NEUTRAL;
}

function sgn(x: number): number { return x > 0 ? 1 : x < 0 ? -1 : 0; }
function fmt(x: number, d = 1): string { return `${x >= 0 ? "+" : ""}${x.toFixed(d)}`; }

function TeamRow({ name, proj, mkt, logo, color }: {
  name: string; proj: number; mkt: string; logo?: string; color?: string;
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
      <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1,
                    textAlign: "center", color: color ?? "var(--text)" }}>
        {proj.toFixed(1)}
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
        {mkt}
      </div>
    </>
  );
}

function BoxTable({ name, box }: { name: string; box: TeamBox }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 12, margin: "6px 0 2px" }}>
        {name}
        <span style={{ color: "var(--muted)", fontWeight: 600, marginLeft: 8 }}>
          {box.pass_yds} pass yds · {box.rush_yds} rush yds
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {box.rows.map((r, i) => (
            <tr key={i}>
              <td style={{ textAlign: "left", padding: "2px 0", color: "var(--muted)",
                           fontWeight: 700, width: 44 }}>{r[0]}</td>
              <td style={{ textAlign: "left", padding: "2px 0", fontWeight: 600 }}>{r[1]}</td>
              <td style={{ textAlign: "right", padding: "2px 0" }}>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function StatRow({ stat, d, o, label }: {
  stat: string; d: PropStat; o?: PropStat; label: string;
}) {
  // Chip lines are pinned to the default arm by the builder, so the other
  // run's probability at index i is priced at the same number — but verify
  // the line before showing it rather than trusting position.
  const oProb = (i: number, t: number): number | null => {
    const c = o?.ov?.[i];
    return c && c[0] === t ? c[1] : (o?.ov?.find(x => x[0] === t)?.[1] ?? null);
  };
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td style={{ padding: "3px 6px 3px 0", fontWeight: 700, whiteSpace: "nowrap" }}>
        {label}
      </td>
      <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 700 }}>
        {num(d.mn)}
        {o && (
          <div style={{ fontSize: 11, fontWeight: 700,
                        color: Math.abs(d.mn - o.mn) < 1e-9 ? "var(--muted)"
                               : d.mn > o.mn ? "#166534" : "#991b1b" }}>
            {fmt(d.mn - o.mn, Math.abs(d.mn - o.mn) >= 10 ? 1 : 2)}
          </div>
        )}
      </td>
      <td style={{ padding: "3px 6px", textAlign: "right" }}>{num(d.md)}</td>
      <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--muted)",
                   whiteSpace: "nowrap" }}>
        {rng(d.p25, d.p75)}
      </td>
      <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--muted)",
                   whiteSpace: "nowrap" }}>
        {rng(d.p10, d.p90)}
      </td>
      <td style={{ padding: "3px 0 3px 6px" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {d.ov.map(([t, p], i) => {
            const op = o ? oProb(i, t) : null;
            return (
              <span key={`${stat}-${t}`}
                title={`P(over ${t}) = ${(p * 100).toFixed(1)}%`
                       + (op == null ? "" : ` · other run ${(op * 100).toFixed(1)}%`)}
                style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999,
                         border: "1px solid var(--border)", background: probBg(p),
                         whiteSpace: "nowrap" }}>
                o{t} <b>{(p * 100).toFixed(0)}%</b>
                {op != null && (
                  <span style={{ color: "var(--muted)", marginLeft: 3 }}>
                    ({(op * 100).toFixed(0)})
                  </span>
                )}
              </span>
            );
          })}
          {d.ln && (
            <span title={`book line ${d.ln.line} (${d.ln.src}); market de-vigged `
                         + `P(over) ${(d.ln.p_over_mkt * 100).toFixed(1)}%`}
              style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999,
                       fontWeight: 700, border: "1px solid var(--border)",
                       background: edgeBg(d.ln.edge) }}>
              book {d.ln.line} · mkt {(d.ln.p_over_mkt * 100).toFixed(0)}%
              {" · sim "}{(d.ln.p_over_sim * 100).toFixed(0)}%
              {" · edge "}{fmt(d.ln.edge * 100, 1)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

export function PropsTable({ name, rows, other, otherLabel, labels, group }: {
  name: string; rows: PropRow[]; other?: PropRow[]; otherLabel?: string;
  labels: Record<string, string>;
  group: "all" | "pass" | "rush" | "rec";
}) {
  const otherByPlayer = useMemo(() => {
    const m = new Map<string, PropRow>();
    for (const r of other ?? []) m.set(r.p, r);
    return m;
  }, [other]);
  if (!rows.length) return (
    <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>
      {name}: no prop-volume players
    </div>
  );
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 13, margin: "8px 0 2px" }}>
        {name}
        {other && (
          <span style={{ color: "var(--muted)", fontWeight: 600, marginLeft: 8,
                         fontSize: 11 }}>
            small figures = Δ mean and (P%) vs {otherLabel}
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
                        minWidth: 520 }}>
          <thead>
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
          </thead>
          {rows.map(r => {
            const stats = STAT_ORDER.filter(
              s => r.s[s] && (group === "all" || STAT_GROUP[s] === group));
            if (!stats.length) return null;
            const or = otherByPlayer.get(r.p);
            return (
              <tbody key={r.p}>
                <tr>
                  <td colSpan={6} style={{ padding: "8px 0 1px", fontWeight: 800 }}>
                    <span style={{ color: "var(--muted)", fontWeight: 700,
                                   marginRight: 6 }}>{r.pos}</span>
                    {r.p}
                    {other && !or && (
                      <span style={{ color: "#92400e", fontWeight: 700, fontSize: 11,
                                     marginLeft: 8 }}>
                        not in {otherLabel}
                      </span>
                    )}
                  </td>
                </tr>
                {stats.map(s => (
                  <StatRow key={s} stat={s} d={r.s[s]} o={or?.s[s]}
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

export function GameCard({ g, other, otherLabel, logos, labels, group }: {
  g: Game; other?: Game; otherLabel?: string;
  logos: Map<string, { id: string; logo: string }>;
  labels: Record<string, string>;
  group: "all" | "pass" | "rush" | "rec";
}) {
  const [open, setOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const hasProps = !!(g.hprops?.length || g.aprops?.length);
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

  // ---- comparison against the other arm -------------------------------
  const dMargin = other ? simMargin - (other.hs - other.as) : null;
  const dTotal = other ? simTotal - (other.hs + other.as) : null;
  const sideFlip = other && mktMargin != null
    && sgn(simMargin - mktMargin) !== sgn((other.hs - other.as) - mktMargin);
  const totalFlip = other && g.ou != null
    && sgn(simTotal - g.ou) !== sgn((other.hs + other.as) - g.ou);

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

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 90px",
                    rowGap: 6, columnGap: 8, alignItems: "center" }}>
        <div />
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Projected</div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Market</div>
        <TeamRow name={g.away} proj={g.as} mkt={mktScore("a")} logo={aLogo} color={ac} />
        <TeamRow name={g.home} proj={g.hs} mkt={mktScore("h")} logo={hLogo} color={hc} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)",
                       background: pillBg(spreadDelta, 3, 10) }}>
          {g.spread == null ? "Spread: —"
            : `Spread: ${favName} ${(-Math.abs(g.spread)).toFixed(1)} · sim Δ ${
                spreadDelta! >= 0 ? "+" : ""}${spreadDelta!.toFixed(1)}`}
        </span>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)",
                       background: pillBg(totalDelta, 3, 8) }}>
          {g.ou == null ? "Total: —"
            : `O/U ${g.ou.toFixed(1)} · sim ${simTotal.toFixed(1)} (${
                totalDelta! >= 0 ? "+" : ""}${totalDelta!.toFixed(1)})`}
        </span>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)", background: NEUTRAL }}>
          {g.home} win {(g.hw * 100).toFixed(0)}%
        </span>
      </div>

      {other && (
        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex",
                      gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span>vs {otherLabel}: margin <b style={{ color: "var(--text)" }}>
            {fmt(dMargin!)}</b> · total <b style={{ color: "var(--text)" }}>
            {fmt(dTotal!)}</b></span>
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
          <BoxTable name={g.away} box={g.abox} />
          <BoxTable name={g.home} box={g.hbox} />
        </div>
      )}

      {propsOpen && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
            Seed distribution per player · Mean/Med/percentiles are the sim's
            own spread · o&lt;line&gt; chips are P(stat &gt; line)
          </div>
          <PropsTable name={g.away} rows={g.aprops ?? []} other={other?.aprops}
                      otherLabel={otherLabel} labels={labels} group={group} />
          <PropsTable name={g.home} rows={g.hprops ?? []} other={other?.hprops}
                      otherLabel={otherLabel} labels={labels} group={group} />
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
  const [run, setRun] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);
  const [group, setGroup] = useState<"all" | "pass" | "rush" | "rec">("all");

  useEffect(() => {
    fetch("/data/test-visual.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d: Payload) => { setData(d); setRun(d.meta.tag); })
      .catch(e => setErr(String(e)));
    getEspnTeamsMap().then(setLogos).catch(() => setLogos(new Map()));
  }, []);

  const runsMeta: RunMeta[] = data?.meta.runs ?? [];
  const runMap: Record<string, Game[]> =
    data?.runs ?? (data ? { [data.meta.tag]: data.games } : {});
  const active = (run && runMap[run]) ? run : (data?.meta.tag ?? "");
  const baseTag = data?.meta.tag ?? "";
  // The other arm: whichever run is not active (two-arm case), else none.
  const otherTag = runsMeta.length > 1
    ? (runsMeta.find(r => r.tag !== active)?.tag ?? null) : null;
  const otherLabel = runsMeta.find(r => r.tag === otherTag)?.label ?? otherTag ?? "";

  // Sort keys always come from the DEFAULT arm, so toggling never reshuffles.
  const games = useMemo(() => {
    if (!data) return [];
    const gs = [...(runMap[active] ?? [])];
    const baseline = runMap[baseTag] ?? gs;
    const keyOf = (g: Game) => {
      const b = baseline.find(x => (x.gid ?? -1) === (g.gid ?? -2)) ?? g;
      if (sort === "spread") return -Math.abs(b.spread ?? 0);
      if (sort === "disagree") {
        return b.spread == null ? 1 : -Math.abs((b.hs - b.as) - (-b.spread));
      }
      return 0;
    };
    if (sort !== "kick") gs.sort((a, b) => keyOf(a) - keyOf(b));
    return gs;
  }, [data, sort, active, baseTag]);

  const otherByGid = useMemo(() => {
    const m = new Map<number, Game>();
    if (otherTag && compare) for (const g of runMap[otherTag] ?? []) {
      if (g.gid != null) m.set(g.gid, g);
    }
    return m;
  }, [data, otherTag, compare]);

  if (err) return <div className="card" style={{ padding: 16 }}>
    No test data published yet ({err}).</div>;
  if (!data || !logos) return <div style={{ color: "var(--muted)" }}>Loading…</div>;

  const activeMeta = runsMeta.find(r => r.tag === active);
  const otherMeta = runsMeta.find(r => r.tag === otherTag);
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
            · scores are sim means · Δ = sim minus market
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
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
        {runsMeta.length === 1 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Run <b style={{ color: "var(--text)" }}>{runsMeta[0].label}</b>
            {runsMeta[0].src ? ` · ${runsMeta[0].src}` : ""}
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

        {runsMeta.length > 1 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Run</span>
            {runsMeta.map(r => (
              <button key={r.tag} onClick={() => setRun(r.tag)}
                style={{ font: "inherit", fontSize: 13, fontWeight: 700,
                         padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                         border: "1px solid var(--border)",
                         background: r.tag === active ? "var(--brand)" : "var(--card)",
                         color: r.tag === active ? "var(--brand-contrast)" : "var(--text)" }}>
                {r.label}
              </button>
            ))}
            <label style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8,
                            display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={compare}
                     onChange={e => setCompare(e.target.checked)} />
              show delta vs other run
            </label>
          </div>
        )}

        {activeMeta && (
          <MetricStrip r={activeMeta} base={compare ? otherMeta : undefined} />
        )}
      </section>

      <div style={{ display: "grid", gap: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    alignItems: "start" }}>
        {games.map((g, i) => (
          <GameCard key={g.gid ?? i} g={g} logos={logos}
                    other={g.gid != null ? otherByGid.get(g.gid) : undefined}
                    otherLabel={otherLabel} labels={labels} group={group} />
        ))}
      </div>
    </div>
  );
}
