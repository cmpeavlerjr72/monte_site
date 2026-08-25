// src/components/PlayerProps.tsx
//
// Per-player prop explorer: pick a player, a stat and a line, and read the
// simulated distribution behind it.
//
// Data is the game's players_dist.json — a sparse integer PMF per player-stat
// ({"<value>": count}, counts summing to nsims). Because the sims are integer
// counts and the PMF is exact, P(over) at a half-point line is a straight sum
// of the counts strictly above the line: no interpolation, no normal
// approximation, no distributional assumption. That is the whole reason this
// panel reads the PMF instead of the mean/percentile summary.

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import {
  getPlayersDistJson, DistNotPublished, pmfBins, pmfMean, pmfMedian,
  pmfPOver, pmfTotal,
  type JsonWeekRow, type PlayerDist, type PlayersDistJson,
} from "../lib/cfbJson";
import type { Season } from "../lib/cfbData";

type Props = {
  row: JsonWeekRow;
  season: Season;
  teamA: string;
  teamB: string;
  colorFor: (team: string) => string | undefined;
};

/**
 * The prop menu, in betting order. `bin` is the histogram bucket width:
 * yardage spreads over a wide range so it needs ~10-yard buckets, while count
 * stats are small integers and read best one value per bar.
 */
const STAT_OPTIONS: { key: string; label: string; bin: number }[] = [
  { key: "pass_yds",  label: "Pass Yds",  bin: 10 },
  { key: "pass_td",   label: "Pass TD",   bin: 1 },
  { key: "pass_comp", label: "Comp",      bin: 1 },
  { key: "pass_att",  label: "Att",       bin: 1 },
  { key: "int",       label: "INT",       bin: 1 },
  { key: "rush_yds",  label: "Rush Yds",  bin: 10 },
  { key: "rush_att",  label: "Rush Att",  bin: 1 },
  { key: "rush_td",   label: "Rush TD",   bin: 1 },
  { key: "rec",       label: "Rec",       bin: 1 },
  { key: "rec_yds",   label: "Rec Yds",   bin: 10 },
  { key: "rec_td",    label: "Rec TD",    bin: 1 },
  { key: "tgt",       label: "Targets",   bin: 1 },
];

/** A stat is offered only if this player actually has mass above zero in it. */
function statsForPlayer(p: PlayerDist | undefined) {
  if (!p) return [];
  return STAT_OPTIONS.filter((o) => {
    const pmf = p.stats[o.key];
    if (!pmf || !pmf.size) return false;
    for (const [v, c] of pmf) if (v > 0 && c > 0) return true;
    return false;
  });
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
      <button type="button" onClick={() => bump(-1)}
        style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}>−</button>
      <input
        type="number" step={step} min={0} value={value} inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 90, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
      />
      <button type="button" onClick={() => bump(1)}
        style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)" }}>+</button>
    </div>
  );
}

const selectStyle = {
  padding: "6px 10px", borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--card)",
  minWidth: 0,
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

  // Home players first, then away — matches the card's reading order.
  const players = useMemo(() => {
    const all = data?.players ?? [];
    const rank = (t: string) => (t === teamA ? 0 : t === teamB ? 1 : 2);
    return [...all]
      .filter((p) => statsForPlayer(p).length > 0)
      .sort((a, b) => rank(a.team) - rank(b.team) || a.player.localeCompare(b.player));
  }, [data, teamA, teamB]);

  const [playerName, setPlayerName] = useState("");
  const [statKey, setStatKey] = useState("");
  const [line, setLine] = useState("");
  // Null until the user edits the line, so switching player/stat re-seeds it.
  const [lineTouched, setLineTouched] = useState(false);

  const player = useMemo(
    () => players.find((p) => p.player === playerName) ?? players[0],
    [players, playerName]
  );
  const options = useMemo(() => statsForPlayer(player), [player]);
  const stat = useMemo(
    () => options.find((o) => o.key === statKey) ?? options[0],
    [options, statKey]
  );

  // Keep the selections valid as the lists change.
  useEffect(() => {
    if (player && player.player !== playerName) setPlayerName(player.player);
  }, [player, playerName]);
  useEffect(() => {
    if (stat && stat.key !== statKey) { setStatKey(stat.key); setLineTouched(false); }
  }, [stat, statKey]);

  const pmf = player && stat ? player.stats[stat.key] : undefined;

  const summary = useMemo(() => {
    if (!pmf) return null;
    return { n: pmfTotal(pmf), mean: pmfMean(pmf), median: pmfMedian(pmf) };
  }, [pmf]);

  // Re-seed the line whenever the distribution changes and the user has not
  // typed one for it.
  useEffect(() => {
    if (!summary || lineTouched) return;
    setLine(defaultLine(summary.median).toFixed(1));
  }, [summary, lineTouched]);

  const lineNum = Number(line);
  const hasLine = line.trim() !== "" && Number.isFinite(lineNum);
  const pOver = pmf && hasLine ? pmfPOver(pmf, lineNum) : null;
  const overPct = pOver === null ? 0 : Math.round(pOver * 100);

  const bins = useMemo(
    () => (pmf && stat ? pmfBins(pmf, stat.bin) : []),
    [pmf, stat]
  );

  if (loading) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        Loading simulated player distributions…
      </div>
    );
  }
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
  if (!players.length || !player || !stat || !pmf || !summary) {
    return (
      <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
        No player distributions available for this game.
      </div>
    );
  }

  const teamColor = colorFor(player.team) ?? "var(--brand)";
  const underColor = "color-mix(in oklab, var(--border) 75%, transparent)";
  // A bin counts as "over" when every value in it clears the line. Bins are
  // integer-aligned and lines are half-points, so this never splits a bin.
  const isOver = (b: { start: number }) => hasLine && b.start > lineNum;

  return (
    <div className="card" style={{ padding: 10, marginTop: 6 }}>
      {/* controls */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "center" }}>
        <select
          value={player.player}
          onChange={(e) => { setPlayerName(e.target.value); setStatKey(""); setLineTouched(false); }}
          style={selectStyle}
        >
          {players.map((p) => (
            <option key={`${p.team}__${p.player}`} value={p.player}>
              {p.player} · {p.role ?? "—"} · {p.team}
            </option>
          ))}
        </select>

        <select
          value={stat.key}
          onChange={(e) => { setStatKey(e.target.value); setLineTouched(false); }}
          style={selectStyle}
        >
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Line:</span>
          <NumberSpinner value={line} onChange={(v) => { setLine(v); setLineTouched(true); }} />
        </div>
      </div>

      {/* histogram */}
      <div style={{ height: 190, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              height={20}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis allowDecimals={false} width={30} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
              labelStyle={{ color: "var(--muted)" }}
              itemStyle={{ color: "var(--text)" }}
              formatter={(v: any) => [`${v} of ${summary.n} sims`, stat.label]}
            />
            {hasLine && (
              <ReferenceLine
                x={bins.find((b) => b.start > lineNum)?.label}
                ifOverflow="extendDomain"
                stroke="var(--accent)"
                strokeDasharray="4 4"
                label={{ value: `Line ${lineNum}`, position: "top", fontSize: 11, fill: "var(--accent)" }}
              />
            )}
            <Bar dataKey="count" name={stat.label}>
              {bins.map((b, i) => (
                <Cell key={i} fill={isOver(b) ? teamColor : underColor} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* readouts */}
      <div
        className="card"
        style={{ marginTop: 6, padding: 8, fontSize: 13, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}
      >
        {pOver !== null ? (
          <>
            <span>
              <b>Over {lineNum}</b>:{" "}
              <span style={{ color: teamColor, fontWeight: 800 }}>{overPct}%</span>
            </span>
            <span style={{ opacity: 0.5 }}>|</span>
            {/* Derived from the same rounded number so the pair always reads
                100%. Rounding each side independently printed 52% / 49%. */}
            <span><b>Under</b>: {100 - overPct}%</span>
            <span style={{ opacity: 0.5 }}>|</span>
          </>
        ) : null}
        <span style={{ color: "var(--muted)" }}>
          mean <b style={{ color: "var(--text)" }}>{summary.mean.toFixed(1)}</b>
        </span>
        <span style={{ color: "var(--muted)" }}>
          median <b style={{ color: "var(--text)" }}>{summary.median}</b>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {summary.n} sims
        </span>
      </div>
    </div>
  );
}
