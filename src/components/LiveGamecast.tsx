// src/components/LiveGamecast.tsx
//
// Live-game visuals fed by lib/espnGame:
//   <FieldStrip>    — compact field on every live card: ball spot, possession,
//                     first-down line, red-zone tint. Data rides the
//                     scoreboard poll the page already runs; zero extra fetch.
//   <LiveGamePanel> — the break-out panel: full field with the current
//                     drive's plays drawn on it, the drive's play-by-play
//                     list, and ESPN's after-every-play probability series
//                     with a WIN% / COVER% / OVER% toggle. The sim's own
//                     pregame P(home) overlays the WIN% chart, so the live
//                     market model is always read against our number.
//
// Field geometry (shared): ESPN yard lines are absolute 0–100 with the HOME
// goal line at 0. The strip renders home on the RIGHT (TV convention), so
// x = X0 + (100 - yardLine) in a 0–120 viewBox with 10-unit endzones.

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type {
  AttackDir, CurrentDrive, LiveSituation, ProbPoint, GameSummaryLite,
} from "../lib/espnGame";
import { useGameProbabilities, useGameSummary } from "../lib/espnGame";

const X0 = 10; // width of each endzone in viewBox units
const xOf = (yardLine: number) => X0 + (100 - Math.max(0, Math.min(100, yardLine)));

const FIELD_GREEN = "rgba(56,140,90,0.16)";
const FIRST_DOWN_YELLOW = "#eab308";

type TeamBits = {
  homeAbbrev?: string;
  awayAbbrev?: string;
  homeColor?: string;
  awayColor?: string;
  homeId?: string;
  awayId?: string;
};

/** First-down spot in absolute yards, or undefined when not computable. */
function firstDownYL(sit: LiveSituation | undefined, dir: AttackDir | undefined): number | undefined {
  if (!sit || dir === undefined) return undefined;
  if (sit.yardLine === undefined || sit.distance === undefined) return undefined;
  const v = sit.yardLine + dir * sit.distance;
  return v > 0 && v < 100 ? v : undefined; // inside an endzone = goal to go, no line
}

/** Field furniture shared by the strip and the drive field. */
function FieldBase({ h, bits, redZoneDir }: {
  h: number;
  bits: TeamBits;
  /** When set, tint the 20 yards in front of the endzone being attacked. */
  redZoneDir?: AttackDir;
}) {
  const yPad = 2;
  const yH = h - 2 * yPad;
  const hashes = [];
  for (let v = 10; v <= 90; v += 10) {
    hashes.push(
      <line
        key={v}
        x1={xOf(v)} x2={xOf(v)} y1={yPad} y2={yPad + yH}
        stroke="var(--border)" strokeWidth={v === 50 ? 0.6 : 0.35}
      />
    );
  }
  return (
    <g>
      {/* playing surface + endzones: away left, home right */}
      <rect x={X0} y={yPad} width={100} height={yH} fill={FIELD_GREEN} rx={1} />
      <rect x={0} y={yPad} width={X0} height={yH} fill={bits.awayColor ?? "var(--accent)"} opacity={0.85} rx={1} />
      <rect x={110} y={yPad} width={X0} height={yH} fill={bits.homeColor ?? "var(--brand)"} opacity={0.85} rx={1} />
      {redZoneDir !== undefined && (
        <rect
          x={redZoneDir === -1 ? xOf(20) : X0}
          y={yPad} width={20} height={yH}
          fill="var(--neg)" opacity={0.12}
        />
      )}
      {hashes}
      <text x={5} y={h / 2} fill="#fff" fontSize={3.4} fontWeight={800}
        textAnchor="middle" dominantBaseline="central" style={{ letterSpacing: 0.4 }}>
        {(bits.awayAbbrev ?? "").slice(0, 4)}
      </text>
      <text x={115} y={h / 2} fill="#fff" fontSize={3.4} fontWeight={800}
        textAnchor="middle" dominantBaseline="central" style={{ letterSpacing: 0.4 }}>
        {(bits.homeAbbrev ?? "").slice(0, 4)}
      </text>
    </g>
  );
}

function BallMarker({ x, y, color, dir }: {
  x: number; y: number; color: string; dir?: AttackDir;
}) {
  // Attacking the home goal line (dir −1) means moving RIGHT on screen.
  const dx = dir === undefined ? 0 : dir === -1 ? 1 : -1;
  return (
    <g>
      {dx !== 0 && (
        <polygon
          points={`${x + dx * 3},${y} ${x + dx * 6},${y - 1.6} ${x + dx * 6},${y + 1.6}`}
          fill={color} opacity={0.8}
        />
      )}
      <circle cx={x} cy={y} r={2.2} fill={color} stroke="#fff" strokeWidth={0.6} />
    </g>
  );
}

/* ------------------------------- FieldStrip ------------------------------- */

export function FieldStrip({ situation, bits, condensed = false }: {
  situation: LiveSituation;
  bits: TeamBits;
  condensed?: boolean;
}) {
  const h = 26;
  const sit = situation;
  const possHome = sit.possessionId !== undefined && sit.possessionId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? "var(--text)";
  const possAbbrev = possHome ? bits.homeAbbrev : bits.awayAbbrev;
  const fd = firstDownYL(sit, sit.attackDir);

  return (
    <div style={{ display: "grid", gap: 2 }} title={sit.lastPlayText}>
      <svg
        viewBox={`0 0 120 ${h}`}
        style={{ width: "100%", height: condensed ? 22 : 30, display: "block" }}
        role="img"
        aria-label={`${possAbbrev ?? "Offense"} ball, ${sit.downDistanceText ?? ""}`}
      >
        <FieldBase h={h} bits={bits} redZoneDir={sit.isRedZone ? sit.attackDir : undefined} />
        {fd !== undefined && (
          <line x1={xOf(fd)} x2={xOf(fd)} y1={2} y2={h - 2}
            stroke={FIRST_DOWN_YELLOW} strokeWidth={0.7} />
        )}
        {sit.yardLine !== undefined && (
          <BallMarker x={xOf(sit.yardLine)} y={h / 2} color={possColor} dir={sit.attackDir} />
        )}
      </svg>
      <div style={{
        display: "flex", justifyContent: "space-between", gap: 8,
        fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums",
      }}>
        <span style={{ fontWeight: 700, color: possColor }}>
          {possAbbrev ? `${possAbbrev} ball` : ""}
        </span>
        <span>{sit.downDistanceText ?? ""}</span>
      </div>
    </div>
  );
}

/* ------------------------------- DriveField ------------------------------- */

function DriveField({ drive, situation, bits }: {
  drive?: CurrentDrive;
  situation?: LiveSituation;
  bits: TeamBits;
}) {
  const h = 34;
  const dir = drive?.attackDir ?? situation?.attackDir;
  const possId = drive?.teamId ?? situation?.possessionId;
  const possHome = possId !== undefined && possId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? "var(--text)";
  const ballYL = situation?.yardLine ?? drive?.ballYL;
  const fd = firstDownYL(situation, dir);

  const segs = (drive?.plays ?? []).filter(
    (p) => p.startYL !== undefined && p.endYL !== undefined && p.startYL !== p.endYL
  );

  return (
    <svg viewBox={`0 0 120 ${h}`} style={{ width: "100%", height: 64, display: "block" }}>
      <FieldBase h={h} bits={bits} redZoneDir={situation?.isRedZone ? dir : undefined} />
      {/* drive start marker */}
      {segs.length > 0 && segs[0].startYL !== undefined && (
        <line x1={xOf(segs[0].startYL)} x2={xOf(segs[0].startYL)} y1={3} y2={h - 3}
          stroke="#fff" strokeWidth={0.5} strokeDasharray="1.4 1" opacity={0.7} />
      )}
      {/* one arrow per play, staggered so back-to-back plays stay legible */}
      {segs.map((p, i) => {
        const x1 = xOf(p.startYL as number);
        const x2 = xOf(p.endYL as number);
        const y = h / 2 + (i % 2 === 0 ? -3 : 3);
        const sgn = x2 > x1 ? 1 : -1;
        const color = p.scoring ? FIRST_DOWN_YELLOW : possColor;
        return (
          <g key={p.id || i} opacity={i === segs.length - 1 ? 1 : 0.55}>
            <line x1={x1} x2={x2} y1={y} y2={y} stroke={color} strokeWidth={1.1} />
            <polygon
              points={`${x2},${y} ${x2 - sgn * 2.4},${y - 1.4} ${x2 - sgn * 2.4},${y + 1.4}`}
              fill={color}
            />
          </g>
        );
      })}
      {fd !== undefined && (
        <line x1={xOf(fd)} x2={xOf(fd)} y1={2} y2={h - 2}
          stroke={FIRST_DOWN_YELLOW} strokeWidth={0.7} />
      )}
      {ballYL !== undefined && (
        <BallMarker x={xOf(ballYL)} y={h / 2} color={possColor} dir={dir} />
      )}
    </svg>
  );
}

/* -------------------------------- ProbChart ------------------------------- */

type ProbMode = "win" | "cover" | "over";

function ProbChart({ points, summary, bits, simHomeWinPct }: {
  points: ProbPoint[];
  summary: GameSummaryLite | null;
  bits: TeamBits;
  simHomeWinPct?: number;
}) {
  const [mode, setMode] = useState<ProbMode>("win");
  const hasCover = points.some((p) => p.coverHome !== undefined);
  const hasOver = points.some((p) => p.overPct !== undefined);
  const effMode: ProbMode = mode === "cover" && !hasCover ? "win" : mode === "over" && !hasOver ? "win" : mode;

  const data = useMemo(
    () =>
      points.map((p, i) => ({
        i,
        v: effMode === "win" ? p.homeWin : effMode === "cover" ? p.coverHome : p.overPct,
        playId: p.playId,
        secondsLeft: p.secondsLeft,
      })),
    [points, effMode]
  );

  // Quarter boundaries: first play at or under each threshold of game seconds
  // remaining (3600-second regulation clock in this feed).
  const quarterMarks = useMemo(() => {
    const marks: { i: number; label: string }[] = [];
    for (const [thresh, label] of [[2700, "Q2"], [1800, "Q3"], [900, "Q4"], [0, "OT"]] as const) {
      const idx = points.findIndex((p) => p.secondsLeft <= thresh);
      if (idx > 0 && (label !== "OT" || points[idx].secondsLeft < 0)) marks.push({ i: idx, label });
    }
    return marks;
  }, [points]);

  const last = points[points.length - 1];
  const lineColor = effMode === "over" ? "var(--brand)" : bits.homeColor ?? "var(--brand)";

  let readout = "";
  if (last) {
    if (effMode === "win") {
      const homeUp = last.homeWin >= 50;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? (homeUp ? "Home" : "Away")} ${(homeUp ? last.homeWin : 100 - last.homeWin).toFixed(0)}%`;
    } else if (effMode === "cover" && last.coverHome !== undefined) {
      readout = `${summary?.pickDetails ?? `${bits.homeAbbrev ?? "Home"} cover`}: ${last.coverHome.toFixed(0)}%`;
    } else if (effMode === "over" && last.overPct !== undefined) {
      readout = `Over${summary?.overUnder !== undefined ? ` ${summary.overUnder}` : ""}: ${last.overPct.toFixed(0)}%`;
    }
  }

  const modeBtn = (m: ProbMode, label: string, enabled: boolean) =>
    enabled ? (
      <button
        key={m}
        type="button"
        className="ui-btn"
        data-on={effMode === m ? "true" : "false"}
        onClick={() => setMode(m)}
        style={{ padding: "3px 10px", fontSize: 12 }}
      >
        {label}
      </button>
    ) : null;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {modeBtn("win", "Win %", true)}
        {modeBtn("cover", "Cover %", hasCover)}
        {modeBtn("over", "Over %", hasOver)}
        <span style={{
          marginLeft: "auto", fontSize: 13, fontWeight: 800,
          fontVariantNumeric: "tabular-nums", color: "var(--text)",
        }}>
          {readout}
        </span>
      </div>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 2, left: -18 }}>
            <XAxis dataKey="i" tick={false} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis
              domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 10, fill: "var(--muted)" }}
              tickFormatter={(v: number) => `${v}%`}
              axisLine={false} tickLine={false}
            />
            <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="4 3" />
            {effMode === "win" && simHomeWinPct !== undefined && (
              <ReferenceLine
                y={simHomeWinPct} stroke="var(--brand)" strokeDasharray="6 3"
                label={{ value: "SIM", position: "insideRight", fontSize: 9, fill: "var(--brand)" }}
              />
            )}
            {quarterMarks.map((q) => (
              <ReferenceLine
                key={q.label} x={q.i} stroke="var(--border)"
                label={{ value: q.label, position: "insideTopLeft", fontSize: 9, fill: "var(--muted)" }}
              />
            ))}
            <Tooltip
              content={(props: any) => {
                const row = props?.payload?.[0]?.payload;
                if (!row || row.v === undefined) return null;
                const ref = row.playId ? summary?.playText.get(row.playId) : undefined;
                return (
                  <div style={{
                    background: "var(--card)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "6px 8px", maxWidth: 260, fontSize: 11,
                  }}>
                    <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {Number(row.v).toFixed(1)}%
                      {ref?.home !== undefined && ref?.away !== undefined && (
                        <span style={{ color: "var(--muted)", fontWeight: 600 }}>
                          {"  "}{bits.awayAbbrev} {ref.away}–{ref.home} {bits.homeAbbrev}
                          {ref.period ? `  Q${ref.period} ${ref.clock ?? ""}` : ""}
                        </span>
                      )}
                    </div>
                    {ref?.text && (
                      <div style={{ color: "var(--muted)", marginTop: 2 }}>
                        {ref.text.length > 120 ? `${ref.text.slice(0, 120)}…` : ref.text}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Line
              type="stepAfter" dataKey="v" stroke={lineColor} strokeWidth={2}
              dot={false} isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------ LiveGamePanel ----------------------------- */

export function LiveGamePanel({ eventId, isLive, situation, bits, simHomeWinPct }: {
  eventId: string;
  isLive: boolean;
  situation?: LiveSituation;
  bits: TeamBits;
  simHomeWinPct?: number;
}) {
  const summary = useGameSummary(eventId, isLive);
  const probs = useGameProbabilities(eventId, isLive);

  const drive = summary?.drive;
  const plays = drive?.plays ?? [];
  const loading = summary === null && probs === null;
  const nothing = !loading && !plays.length && !(probs && probs.length);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {isLive && (drive || situation) && (
        <div style={{ display: "grid", gap: 4 }}>
          <DriveField drive={drive} situation={situation} bits={bits} />
          <div style={{
            display: "flex", justifyContent: "space-between", gap: 8,
            fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums",
          }}>
            <span style={{ fontWeight: 700 }}>
              {drive?.teamAbbrev ? `${drive.teamAbbrev} drive` : ""}
              {drive?.description ? ` · ${drive.description}` : ""}
            </span>
            <span>{situation?.downDistanceText ?? ""}</span>
          </div>
        </div>
      )}

      {isLive && plays.length > 0 && (
        <div style={{
          maxHeight: 190, overflowY: "auto",
          border: "1px solid var(--border)", borderRadius: 8,
        }}>
          {[...plays].reverse().map((p, i) => (
            <div
              key={p.id || i}
              style={{
                display: "flex", gap: 8, alignItems: "baseline",
                padding: "5px 8px", fontSize: 12,
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                background: i === 0 ? "var(--fill)" : "transparent",
              }}
            >
              <span style={{
                minWidth: 34, textAlign: "center", fontSize: 10, fontWeight: 800,
                color: p.scoring ? FIRST_DOWN_YELLOW : "var(--muted)",
                background: "var(--fill)", borderRadius: 6, padding: "1px 4px",
              }}>
                {p.scoring ? "SCORE" : p.typeAbbrev ?? "—"}
              </span>
              <span style={{ color: "var(--text)" }}>
                {p.startDD && <b style={{ marginRight: 6, fontWeight: 700 }}>{p.startDD}</b>}
                <span style={{ color: "var(--muted)" }}>{p.text}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {probs && probs.length > 0 && (
        <ProbChart points={probs} summary={summary} bits={bits} simHomeWinPct={simHomeWinPct} />
      )}

      {loading && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading live feed…</div>}
      {nothing && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          ESPN provides score-only coverage for this game (no play-by-play or
          probability feed).
        </div>
      )}
    </div>
  );
}
