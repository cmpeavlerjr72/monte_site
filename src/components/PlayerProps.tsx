// src/components/PlayerProps.tsx
//
// Per-player prop explorer: narrow down to a player and a stat, then read the
// simulated distribution behind a line.
//
// ---------------------------------------------------------------------------
// Where the numbers come from
// ---------------------------------------------------------------------------
// The game's players_dist.json — a sparse integer PMF per player-stat
// ({"<value>": count}, counts summing to nsims). Because the sims are integer
// counts and the PMF is exact, P(over) at a half-point line is a straight sum
// of the counts strictly above the line: no interpolation, no normal
// approximation, no distributional assumption. That is the whole reason this
// panel reads the PMF instead of the mean/percentile summary.
//
// ---------------------------------------------------------------------------
// The bar test (house grammar — TeamStats.tsx is the reference)
// ---------------------------------------------------------------------------
// This panel used to be a Recharts histogram with a grid, a Y axis of raw seed
// counts, a hover tooltip reading "37 of 1000 sims", and a readout strip
// printing Over / Under / mean / median at once. Four numbers at rest and none
// of them the decision.
//
// Now: ONE shape on ONE axis, ONE number at rest, derivation in a tap popover.
//   FORM FOLLOWS THE STAT. Yardage is continuous, so it draws as a density
//     silhouette (adjacent-bin mass over bin width — subtraction and division,
//     no kernel). Receptions, TDs, completions and the rest are small integer
//     counts, so they draw as DISCRETE bars: a smoothed curve over 0,1,2,3
//     would be a lie about what the sim produced.
//   THE LINE IS A FLAG on a stem crossing the shape, labelled in the book's
//     own wording, carrying the one number that decides the bet ("over 61%").
//     Push mass, the other side and the fair odds are one tap away.
//   PUBLIC PANEL. No prices, no edges, no owner-gated anything — this is a
//     display surface and the restyle did not change that.
//
// ---------------------------------------------------------------------------
// Choosing what to look at: three cascading filters
// ---------------------------------------------------------------------------
// TEAM -> STAT -> PLAYER, each one's options derived from the pick above it,
// so an impossible combination is unreachable rather than rendering an empty
// chart. Everything is DERIVED, not synced: a selection that stops being valid
// (a team with no rushers after switching to Rush TDs) silently falls back to
// the best remaining option instead of clearing to a blank panel. That is why
// there are no reconciliation effects here — there is nothing to reconcile.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPlayersDistJson, DistNotPublished, pmfBins, pmfMean, pmfMedian,
  pmfPOver, pmfTotal,
  type JsonWeekRow, type Pmf, type PlayerDist, type PlayersDistJson,
} from "../lib/cfbJson";
import type { Season } from "../lib/cfbData";
import { SkeletonChart } from "./Skeleton";

type Props = {
  row: JsonWeekRow;
  season: Season;
  teamA: string;
  teamB: string;
  colorFor: (team: string) => string | undefined;
};

/**
 * The prop menu, in betting order.
 *
 * `bin` is the histogram bucket width AND the form switch: 1 means the stat is
 * a small integer count and draws as discrete bars; anything wider means it is
 * continuous enough for a silhouette. Labels are words, not column codes —
 * "Rec yards", never "rec_yds".
 */
const STAT_OPTIONS: { key: string; label: string; bin: number; unit: string }[] = [
  { key: "pass_yds",  label: "Pass yards",  bin: 10, unit: "passing yards" },
  { key: "rush_yds",  label: "Rush yards",  bin: 10, unit: "rushing yards" },
  { key: "rec_yds",   label: "Rec yards",   bin: 10, unit: "receiving yards" },
  { key: "rec",       label: "Receptions",  bin: 1,  unit: "receptions" },
  { key: "tgt",       label: "Targets",     bin: 1,  unit: "targets" },
  { key: "rush_att",  label: "Carries",     bin: 1,  unit: "carries" },
  { key: "pass_td",   label: "Pass TDs",    bin: 1,  unit: "passing TDs" },
  { key: "rush_td",   label: "Rush TDs",    bin: 1,  unit: "rushing TDs" },
  { key: "rec_td",    label: "Rec TDs",     bin: 1,  unit: "receiving TDs" },
  { key: "pass_comp", label: "Completions", bin: 1,  unit: "completions" },
  { key: "pass_att",  label: "Pass att",    bin: 1,  unit: "pass attempts" },
  { key: "int",       label: "INTs",        bin: 1,  unit: "interceptions" },
];

/** Yardage first, then whatever the team actually has most of. */
const STAT_PREFERENCE = ["rush_yds", "rec_yds", "pass_yds"];

type StatOption = (typeof STAT_OPTIONS)[number];

/** A stat counts for a player only if they have real mass above zero in it. */
function hasStat(p: PlayerDist, key: string): boolean {
  const pmf = p.stats[key];
  if (!pmf || !pmf.size) return false;
  for (const [v, c] of pmf) if (v > 0 && c > 0) return true;
  return false;
}

/* -------------------------------- geometry -------------------------------- */
/* Measured, not fixed, for the reason TeamStats documents: a viewBox that
 * scales turns 10px labels into 4px ones on a phone. */
const PAD_L = 8;
const PAD_R = 8;
const BAND = 44;                    // label rows above the shape

type Bin = { lo: number; hi: number; dens: number };

/** Smooth polyline through bin centres, rooted at zero on both ends. Cribbed
 *  from TeamStats.tsx — the one place this shape language is defined. */
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

/** Mass at each integer value, for the count stats. */
function discreteMass(pmf: Pmf): { v: number; mass: number }[] {
  const n = pmfTotal(pmf);
  if (!n) return [];
  return [...pmf]
    .map(([v, c]) => ({ v, mass: c / n }))
    .sort((a, b) => a.v - b.v);
}

const pct0 = (p: number) => `${Math.round(p * 100)}%`;

/** Fair American odds for a probability. */
function americanOdds(p: number): string {
  if (!(p > 0 && p < 1)) return "—";
  return p >= 0.5 ? String(Math.round((-p / (1 - p)) * 100)) : `+${Math.round(((1 - p) / p) * 100)}`;
}

/** Default to the nearest half-point below the median — a plausible book line. */
const defaultLine = (median: number) => Math.max(0, Math.round(median) - 0.5);

function NumberSpinner({
  value, onChange, step = 0.5,
}: {
  value: string; onChange: (s: string) => void; step?: number;
}) {
  const bump = (dir: -1 | 1) => {
    const curr = value.trim() === "" ? NaN : Number(value);
    const base = Number.isFinite(curr) ? curr : 0;
    onChange(Math.max(0, base + dir * step).toFixed(1));
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button type="button" className="ui-btn" aria-label="Decrease line" onClick={() => bump(-1)}
        style={{ padding: "3px 8px" }}>−</button>
      <input
        type="number" step={step} min={0} value={value} inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 78 }}
      />
      <button type="button" className="ui-btn" aria-label="Increase line" onClick={() => bump(1)}
        style={{ padding: "3px 8px" }}>+</button>
    </div>
  );
}

const chipStyle = {
  padding: "3px 9px", fontSize: 11.5, fontWeight: 700,
} as const;

export default function PlayerProps({ row, season, teamA, teamB, colorFor }: Props) {
  const [data, setData] = useState<PlayersDistJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notPublished, setNotPublished] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);
    setNotPublished(false);

    (async () => {
      try {
        const json = await getPlayersDistJson(row, season, ac.signal);
        if (alive) setData(json);
      } catch (e: any) {
        if (e?.name === "AbortError" || !alive) return;
        if (e instanceof DistNotPublished || e?.name === "DistNotPublished") {
          setNotPublished(true);
        } else {
          console.warn("[PlayerProps] players_dist.json failed:", e);
          setError(String(e?.message ?? e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; ac.abort(); };
  }, [row, season]);

  /* ---- measured width. Callback ref, not an effect on [], because the plot
   * box does not exist while the panel is still loading. ---- */
  const [boxW, setBoxW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const apply = (w: number) => setBoxW((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  /* ======================= the three cascading filters ====================== */
  /* Every level is DERIVED from the level above plus a preference, so a stale
   * selection cannot survive into an empty chart: it simply loses to the
   * fallback. Nothing here is stored except the three preferences themselves.
   * Home is offered first, matching the reading order of the rest of the card. */
  const [teamPref, setTeamPref] = useState("");
  const [statPref, setStatPref] = useState("");
  const [playerPref, setPlayerPref] = useState("");

  const all = data?.players ?? [];

  const teams = useMemo(() => {
    const has = (t: string) => all.some((p) => p.team === t && STAT_OPTIONS.some((o) => hasStat(p, o.key)));
    const out = [teamA, teamB].filter(has);
    // A roster whose team string does not match the card's (a rename, a
    // neutral-site alias) still has to be reachable.
    for (const p of all) if (!out.includes(p.team) && STAT_OPTIONS.some((o) => hasStat(p, o.key))) out.push(p.team);
    return out;
  }, [all, teamA, teamB]);

  const team = teams.includes(teamPref) ? teamPref : teams[0] ?? "";

  const roster = useMemo(
    () => all.filter((p) => p.team === team), [all, team]);

  /** Stat families this TEAM actually has someone for. */
  const statOptions = useMemo(
    () => STAT_OPTIONS.filter((o) => roster.some((p) => hasStat(p, o.key))),
    [roster]
  );

  /**
   * Default stat: the first yardage family this team has, else the family the
   * most players are in. Yardage first because it is the deepest prop market
   * and the widest distribution — the most interesting chart to land on.
   */
  const defaultStat: StatOption | undefined = useMemo(() => {
    if (!statOptions.length) return undefined;
    for (const k of STAT_PREFERENCE) {
      const hit = statOptions.find((o) => o.key === k);
      if (hit) return hit;
    }
    return statOptions.reduce((best, o) => {
      const n = roster.filter((p) => hasStat(p, o.key)).length;
      const bn = roster.filter((p) => hasStat(p, best.key)).length;
      return n > bn ? o : best;
    }, statOptions[0]);
  }, [statOptions, roster]);

  const stat = statOptions.find((o) => o.key === statPref) ?? defaultStat;

  /** Players on this team with this stat, BIGGEST FIRST — the default is the
   *  one worth looking at, not whoever sorts first alphabetically. */
  const candidates = useMemo(() => {
    if (!stat) return [] as PlayerDist[];
    return roster
      .filter((p) => hasStat(p, stat.key))
      .map((p) => ({ p, m: pmfMean(p.stats[stat.key]!) }))
      .sort((a, b) => b.m - a.m || a.p.player.localeCompare(b.p.player))
      .map((e) => e.p);
  }, [roster, stat]);

  const player = candidates.find((p) => p.player === playerPref) ?? candidates[0];

  /* ------------------------------ the line -------------------------------- */
  const [line, setLine] = useState("");
  // Null until the user edits the line, so moving the cascade re-seeds it.
  const [lineTouched, setLineTouched] = useState(false);
  /** Which flag's derivation is open. */
  const [sel, setSel] = useState(false);

  const pmf = player && stat ? player.stats[stat.key] : undefined;

  const summary = useMemo(() => {
    if (!pmf) return null;
    return { n: pmfTotal(pmf), mean: pmfMean(pmf), median: pmfMedian(pmf) };
  }, [pmf]);

  useEffect(() => {
    if (!summary || lineTouched) return;
    setLine(defaultLine(summary.median).toFixed(1));
  }, [summary, lineTouched]);

  const lineNum = Number(line);
  const hasLine = line.trim() !== "" && Number.isFinite(lineNum);
  const pOver = pmf && hasLine ? pmfPOver(pmf, lineNum) : null;
  const pAt = useMemo(() => {
    if (!pmf || !hasLine) return 0;
    const n = pmfTotal(pmf);
    if (!n) return 0;
    let at = 0;
    for (const [v, c] of pmf) if (Math.abs(v - lineNum) < 1e-9) at += c;
    return at / n;
  }, [pmf, hasLine, lineNum]);

  /** Reset the cascade below whatever the reader just changed. */
  const pickTeam = (t: string) => {
    setTeamPref(t); setStatPref(""); setPlayerPref(""); setLineTouched(false); setSel(false);
  };
  const pickStat = (k: string) => {
    setStatPref(k); setPlayerPref(""); setLineTouched(false); setSel(false);
  };
  const pickPlayer = (n: string) => {
    setPlayerPref(n); setLineTouched(false); setSel(false);
  };

  /* --------------------------------- states -------------------------------- */
  if (loading) return <SkeletonChart height={190} />;
  if (notPublished) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        Distributions not published for this week.
      </div>
    );
  }
  if (error) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        Couldn’t load player distributions: {error}
      </div>
    );
  }
  if (!teams.length || !player || !stat || !pmf || !summary) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        No player distributions available for this game.
      </div>
    );
  }

  /* --------------------------------- shape --------------------------------- */
  const brand = colorFor(player.team) ?? "var(--brand)";
  const discrete = stat.bin === 1;

  const plotW = Math.max(280, Math.min(boxW || 900, 900));
  const narrow = plotW < 560;
  const densH = narrow ? 92 : 122;
  const axisY = BAND + densH;
  const height = axisY + 16;

  /* THE WINDOW. A 10,000-seed rushing distribution has a −14 and a +173 in it;
   * drawn to the raw range, the shape everyone came to read gets squeezed into
   * the middle third of the panel while 90% of the width shows a flat line.
   * So both forms trim from the ENDS only, until half a percent of the mass is
   * behind them on each side. Trimming is from the ends inward, never from the
   * middle, so the shape can never grow a hole; the missing tail is simply
   * missing, and the caption says so. */
  const trimEnds = <T,>(items: T[], massOf: (t: T) => number): T[] => {
    let i = 0, j = items.length - 1, acc = 0;
    while (i < j && acc + massOf(items[i]) < 0.005) { acc += massOf(items[i]); i++; }
    acc = 0;
    while (j > i && acc + massOf(items[j]) < 0.005) { acc += massOf(items[j]); j--; }
    return items.slice(i, j + 1);
  };

  const shown = discrete
    ? trimEnds(discreteMass(pmf), (m) => m.mass)
    : [];
  const dBins = discrete ? [] : trimEnds(
    pmfBins(pmf, stat.bin).map((b) => ({
      lo: b.start, hi: b.end,
      m: b.count / summary.n,
      dens: (b.count / summary.n) / (b.end - b.start),
    })),
    (b) => b.m,
  );
  const clipped = 1 -
    (discrete ? shown.reduce((s, m) => s + m.mass, 0) : dBins.reduce((s, b) => s + b.m, 0));

  // Discrete axes sit half a unit outside the first and last VALUE, so the
  // end bars get a whole slot instead of being sliced by the axis origin.
  const firstV = discrete ? (shown.length ? shown[0].v : 0) : 0;
  const lastV = discrete ? (shown.length ? shown[shown.length - 1].v : 3) : 0;
  let axisMin = discrete
    ? firstV - 0.5
    : (dBins.length ? dBins[0].lo : 0);
  let axisMax = discrete
    ? lastV + 0.5
    : (dBins.length ? dBins[dBins.length - 1].hi : 1);
  if (hasLine) {
    // The line always renders, even off the end of our distribution — a line
    // our sim never reaches IS the read, and clipping it would hide it.
    axisMin = Math.min(axisMin, lineNum - (discrete ? 0.5 : stat.bin));
    axisMax = Math.max(axisMax, lineNum + (discrete ? 0.5 : stat.bin));
  }
  const span = Math.max(1e-9, axisMax - axisMin);
  const x = (v: number) =>
    PAD_L + ((Math.max(axisMin, Math.min(v, axisMax)) - axisMin) / span) * (plotW - PAD_L - PAD_R);
  const peak = Math.max(1e-9, ...shown.map((m) => m.mass), ...dBins.map((b) => b.dens));
  const y = (d: number) => axisY - (d / peak) * densH;

  const slot = discrete ? (plotW - PAD_L - PAD_R) / span : 0;
  const barW = Math.min(26, Math.max(3, slot * 0.62));

  const flagX = hasLine ? x(lineNum) : 0;
  const detail = pOver === null ? "" :
    `${player.player} ${line} ${stat.unit} — over ${pct0(pOver)} ` +
    `(fair ${americanOdds(pOver)}) · exactly ${line} ${pct0(pAt)} · ` +
    `under ${pct0(1 - pOver - pAt)} (fair ${americanOdds(1 - pOver - pAt)}). ` +
    `${summary.n.toLocaleString()} simulated games.`;

  return (
    <div className="card" style={{ padding: 10, marginTop: 6, display: "grid", gap: 7 }}>
      {/* ------------------------- 1. team ------------------------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
           role="group" aria-label="Team">
        <span style={{ fontSize: 10.5, color: "var(--muted)", minWidth: 34 }}>Team</span>
        {teams.map((t) => (
          <button key={t} type="button" className="ui-btn" style={chipStyle}
                  data-on={t === team ? "true" : "false"} onClick={() => pickTeam(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* --------------------- 2. stat (this team's) --------------------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
           role="group" aria-label="Stat">
        <span style={{ fontSize: 10.5, color: "var(--muted)", minWidth: 34 }}>Stat</span>
        {statOptions.map((o) => (
          <button key={o.key} type="button" className="ui-btn" style={chipStyle}
                  data-on={o.key === stat.key ? "true" : "false"} onClick={() => pickStat(o.key)}>
            {o.label}
          </button>
        ))}
      </div>

      {/* ------- 3. player (this team, this stat) + the line -------
          A select, not chips: rosters run to a dozen names and a name is as
          long as it is — "Jaydn Ott" and "Bhayshul Tuten" do not fit a chip
          row on a phone. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: "var(--muted)", minWidth: 34 }}>Player</span>
        <select
          value={player.player}
          onChange={(e) => pickPlayer(e.target.value)}
          className="ui-sel"
          aria-label="Player"
          style={{ minWidth: 0, flex: "1 1 180px", maxWidth: 320 }}
        >
          {candidates.map((p) => (
            <option key={`${p.team}__${p.player}`} value={p.player}>
              {p.player}{p.role ? ` · ${p.role}` : ""}
            </option>
          ))}
        </select>
        {/* Label and spinner are ONE flex item: split, the word "Line" is
            orphaned at the end of the select's row on a phone. */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Line</span>
          <NumberSpinner value={line} onChange={(v) => { setLine(v); setLineTouched(true); setSel(false); }}
                         step={0.5} />
        </span>
      </div>

      {/* The words legend, once. */}
      <div style={{ fontSize: 11.5, color: "var(--text)" }}>
        Shaded shape = <strong>our simulation</strong> · the flag is{" "}
        <strong>your line</strong> · the number under it is our chance{" "}
        <strong>{player.player}</strong> goes over it.
      </div>

      {/* --------------------------- the shape --------------------------- */}
      <div ref={attachBox} style={{ position: "relative", overflowX: "hidden" }}>
        <svg width={plotW} height={height} viewBox={`0 0 ${plotW} ${height}`}
             role="img"
             aria-label={`${player.player} simulated ${stat.unit} distribution`}
             style={{ display: "block", maxWidth: "none" }}>
          {/* our simulation */}
          {!discrete && dBins.length > 0 && (
            <path d={densityPath(dBins, x, y, axisY)} fill={brand} opacity={0.30}
                  stroke="var(--muted)" strokeWidth={1} strokeOpacity={0.45}>
              <title>{`${player.player}: simulated ${stat.unit} (median ${summary.median})`}</title>
            </path>
          )}
          {shown.map((m) => {
            const h = (m.mass / peak) * densH;
            const left = Math.max(x(axisMin), x(m.v) - barW / 2);
            const right = Math.min(x(axisMax), x(m.v) + barW / 2);
            return (
              <rect key={m.v} x={left} y={axisY - h}
                    width={Math.max(2, right - left)} height={Math.max(1, h)} rx={2}
                    fill={brand} opacity={0.30} stroke="var(--muted)"
                    strokeWidth={1} strokeOpacity={0.45}>
                <title>{`${pct0(m.mass)} of games at exactly ${m.v}`}</title>
              </rect>
            );
          })}

          {/* THE axis, one continuous line, on top */}
          <line x1={x(axisMin)} x2={x(axisMax)} y1={axisY} y2={axisY}
                stroke="var(--text)" strokeWidth={1.5} strokeLinecap="round" />
          {/* End labels are the first and last VALUE on a count axis, not the
              half-unit padding around them: "0.5 receptions" is not a thing. */}
          <text x={x(axisMin)} y={height - 3} fontSize={9} fill="var(--muted)"
                textAnchor="start" style={{ fontVariantNumeric: "tabular-nums" }}>
            {discrete ? firstV : Math.round(axisMin)}
          </text>
          <text x={x(axisMax)} y={height - 3} fontSize={9} fill="var(--muted)"
                textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
            {discrete ? lastV : Math.round(axisMax)}
          </text>
          {/* The median caption sits in whichever top corner the flag is NOT
              near: at a low line the two labels collide at phone width. */}
          <text x={hasLine && flagX < plotW / 2 ? plotW - PAD_R : PAD_L}
                y={BAND + 11} fontSize={10} fill="var(--muted)"
                textAnchor={hasLine && flagX < plotW / 2 ? "end" : "start"}>
            {`median ${summary.median}`}
          </text>

          {/* THE LINE, as a flag. Two label rows outside the shape, so no text
              is ever set on a coloured fill. */}
          {hasLine && pOver !== null && (
            <g style={{ cursor: "pointer" }} onClick={() => setSel((s) => !s)}>
              <line x1={flagX} x2={flagX} y1={axisY} y2={BAND}
                    stroke="var(--accent)" strokeWidth={sel ? 2.5 : 2} />
              <circle cx={flagX} cy={axisY} r={3.5} fill="var(--accent)" />
              <text x={flagX} y={BAND - 16} fontSize={10.5} fontWeight={800}
                    textAnchor="middle" fill="var(--accent)"
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                {line}
              </text>
              <text x={flagX} y={BAND - 4} fontSize={11.5} fontWeight={800}
                    textAnchor="middle" fill="var(--text)">
                {`over ${pct0(pOver)}`}
              </text>
              {/* >=40px tap target, invisible */}
              <rect x={flagX - 20} y={BAND - 28} width={40} height={axisY - BAND + 28}
                    fill="transparent">
                <title>{detail}</title>
              </rect>
            </g>
          )}
        </svg>

        {sel && detail && (
          <div role="status" style={{
            position: "absolute",
            left: Math.min(Math.max(4, flagX - 150), Math.max(4, plotW - 300)),
            top: 2, zIndex: 2, maxWidth: 300,
            background: "var(--card)", border: "1px solid var(--brand)",
            borderRadius: 8, padding: "7px 9px", fontSize: 11.5, lineHeight: 1.45,
            color: "var(--text)", boxShadow: "0 4px 14px var(--shadow)",
          }}>
            {detail}
            <button type="button" className="ui-btn" onClick={() => setSel(false)}
                    style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10.5 }}>
              Close
            </button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
        {summary.n.toLocaleString()} simulated games ·{" "}
        {discrete
          ? "one bar per whole number — counts are not smoothed"
          : `one shape, ${stat.bin}-${stat.unit.includes("yard") ? "yard" : "unit"} bins`}
        {clipped > 0.0001 ? ", middle 99% of the range shown" : ""}
        . No book line is published with these distributions, so the flag is
        your own number. Tap it for the full read.
      </div>
    </div>
  );
}
