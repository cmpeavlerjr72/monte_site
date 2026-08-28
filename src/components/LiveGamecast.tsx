// src/components/LiveGamecast.tsx
//
// Live-game visuals fed by lib/espnGame, styled after ESPN's gamecast:
//   <FieldStrip>    — compact striped field on every live card: ball spot,
//                     possession, first-down line, red-zone tint.
//   <LiveGamePanel> — the break-out panel: broadcast-style field (striped
//                     turf, yard numbers, translucent drive band), the
//                     probability chart (line split home/away color at the
//                     50% axis, quarter labels, team logos on the axis), and
//                     a per-drive accordion play-by-play with result badges.
//
// Field geometry (shared): ESPN yard lines are absolute 0–100 with the HOME
// goal line at 0. Home renders on the RIGHT (TV convention), so
// x = X0 + (100 - yardLine) in a 0–120 viewBox with 10-unit endzones.

import { useMemo, useState } from "react";
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type {
  AttackDir, CurrentDrive, LiveSituation, ProbPoint, GameSummaryLite,
} from "../lib/espnGame";
import { useGameProbabilities, useGameSummary } from "../lib/espnGame";

const X0 = 10; // endzone width in viewBox units
const xOf = (yardLine: number) => X0 + (100 - Math.max(0, Math.min(100, yardLine)));

// Turf palette — deliberate literals like team hex: the field must read as
// grass in both themes, never re-theme.
const TURF_A = "#2f7d46";
const TURF_B = "#2a7040";
const LINE_WHITE = "rgba(255,255,255,0.75)";
const NUMBER_WHITE = "rgba(255,255,255,0.55)";
const FIRST_DOWN_YELLOW = "#ffd60a";

type TeamBits = {
  homeAbbrev?: string;
  awayAbbrev?: string;
  homeColor?: string;
  awayColor?: string;
  homeId?: string;
  awayId?: string;
  homeLogo?: string;
  awayLogo?: string;
};

/** First-down spot in absolute yards, or undefined when not computable. */
function firstDownYL(sit: LiveSituation | undefined, dir: AttackDir | undefined): number | undefined {
  if (!sit || dir === undefined) return undefined;
  if (sit.yardLine === undefined || sit.distance === undefined) return undefined;
  const v = sit.yardLine + dir * sit.distance;
  return v > 0 && v < 100 ? v : undefined; // inside an endzone = goal to go, no line
}

/** Broadcast-style turf: alternating 10-yard stripes, white yard lines, hash
 *  ticks at the fives, optional yard numbers, team-color endzones.
 *  `minimal` drops hashes and endzone text for the card-sized strip. */
function FieldSurface({ h, bits, showNumbers = false, minimal = false, redZoneDir }: {
  h: number;
  bits: TeamBits;
  showNumbers?: boolean;
  minimal?: boolean;
  redZoneDir?: AttackDir;
}) {
  const yPad = 1.5;
  const yH = h - 2 * yPad;
  const stripes = [];
  for (let i = 0; i < 10; i++) {
    stripes.push(
      <rect key={`s${i}`} x={X0 + i * 10} y={yPad} width={10} height={yH}
        fill={i % 2 === 0 ? TURF_A : TURF_B} />
    );
  }
  const lines = [];
  for (let v = 10; v <= 90; v += 10) {
    lines.push(
      <line key={`l${v}`} x1={xOf(v)} x2={xOf(v)} y1={yPad} y2={yPad + yH}
        stroke={LINE_WHITE} strokeWidth={v === 50 ? 0.45 : 0.35} />
    );
  }
  const hashes = [];
  if (!minimal) {
    for (let v = 5; v <= 95; v += 10) {
      for (const [y1, y2] of [[yPad, yPad + yH * 0.16], [yPad + yH * 0.84, yPad + yH]] as const) {
        hashes.push(
          <line key={`h${v}-${y1}`} x1={xOf(v)} x2={xOf(v)} y1={y1} y2={y2}
            stroke={LINE_WHITE} strokeWidth={0.22} opacity={0.7} />
        );
      }
    }
  }
  const numbers = [];
  if (showNumbers) {
    for (let v = 10; v <= 90; v += 10) {
      numbers.push(
        <text key={`n${v}`} x={xOf(v)} y={h - 2.2}
          fill={NUMBER_WHITE} fontSize={2.8} fontWeight={700}
          textAnchor="middle" style={{ letterSpacing: 0.5 }}>
          {v <= 50 ? v : 100 - v}
        </text>
      );
    }
  }
  return (
    <g>
      {stripes}
      {redZoneDir !== undefined && (
        <rect x={redZoneDir === -1 ? xOf(20) : X0} y={yPad} width={20} height={yH}
          fill="#dc2626" opacity={0.16} />
      )}
      {lines}
      {hashes}
      {numbers}
      {/* endzones: away left, home right */}
      <rect x={0} y={yPad} width={X0} height={yH} fill={bits.awayColor ?? "#444"} />
      <rect x={110} y={yPad} width={X0} height={yH} fill={bits.homeColor ?? "#444"} />
      {!minimal && (
        <>
          <text x={5} y={h / 2} fill="#fff" fontSize={2.8}
            fontWeight={800} textAnchor="middle" dominantBaseline="central"
            transform={`rotate(-90 5 ${h / 2})`} style={{ letterSpacing: 0.8 }}>
            {(bits.awayAbbrev ?? "").slice(0, 5)}
          </text>
          <text x={115} y={h / 2} fill="#fff" fontSize={2.8}
            fontWeight={800} textAnchor="middle" dominantBaseline="central"
            transform={`rotate(90 115 ${h / 2})`} style={{ letterSpacing: 0.8 }}>
            {(bits.homeAbbrev ?? "").slice(0, 5)}
          </text>
        </>
      )}
    </g>
  );
}

function BallMarker({ x, y, color, dir, logo, size = 7 }: {
  x: number; y: number; color: string; dir?: AttackDir;
  /** Possessing team's logo — rendered on a white puck at the ball spot;
   *  falls back to the team-color dot when the logo is missing. */
  logo?: string;
  size?: number;
}) {
  // Attacking the home goal line (dir −1) means moving RIGHT on screen.
  const dx = dir === undefined ? 0 : dir === -1 ? 1 : -1;
  const r = size / 2;
  return (
    <g>
      {dx !== 0 && (
        <polygon
          points={`${x + dx * (r + 0.7)},${y - 1.7} ${x + dx * (r + 3)},${y} ${x + dx * (r + 0.7)},${y + 1.7}`}
          fill="#fff" opacity={0.9}
        />
      )}
      {logo ? (
        <>
          <circle cx={x} cy={y} r={r + 0.6} fill="#fff" opacity={0.94} />
          <image href={logo} x={x - r} y={y - r} width={size} height={size}
            preserveAspectRatio="xMidYMid meet" />
        </>
      ) : (
        <circle cx={x} cy={y} r={2.3} fill={color} stroke="#fff" strokeWidth={0.7} />
      )}
    </g>
  );
}

/* ------------------------------- FieldStrip ------------------------------- */

export function FieldStrip({ situation, bits, condensed = false }: {
  situation: LiveSituation;
  bits: TeamBits;
  condensed?: boolean;
}) {
  // Wide, thin strip (120:14): scales by WIDTH (height:auto) so it always
  // fills the card instead of letterboxing inside a fixed-height box.
  const h = 14;
  const sit = situation;
  const possHome = sit.possessionId !== undefined && sit.possessionId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? "var(--text)";
  const possAbbrev = possHome ? bits.homeAbbrev : bits.awayAbbrev;
  const possLogo = possHome ? bits.homeLogo : bits.awayLogo;
  const fd = firstDownYL(sit, sit.attackDir);

  return (
    <div style={{ display: "grid", gap: 2 }} title={sit.lastPlayText}>
      <svg
        viewBox={`0 0 120 ${h}`}
        style={{ width: "100%", height: "auto", maxHeight: condensed ? 34 : 44, display: "block", borderRadius: 4 }}
        role="img"
        aria-label={`${possAbbrev ?? "Offense"} ball, ${sit.downDistanceText ?? ""}`}
      >
        <FieldSurface h={h} bits={bits} minimal redZoneDir={sit.isRedZone ? sit.attackDir : undefined} />
        {fd !== undefined && (
          <line x1={xOf(fd)} x2={xOf(fd)} y1={1} y2={h - 1}
            stroke={FIRST_DOWN_YELLOW} strokeWidth={0.7} />
        )}
        {sit.yardLine !== undefined && (
          <BallMarker x={xOf(sit.yardLine)} y={h / 2} color={possColor} dir={sit.attackDir}
            logo={possLogo} size={7} />
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
  // 4:1 field, scaled by width (height:auto) — a fixed height letterboxes
  // the drawing into the middle third of the panel.
  const h = 30;
  const dir = drive?.attackDir ?? situation?.attackDir;
  const possId = drive?.teamId ?? situation?.possessionId;
  const possHome = possId !== undefined && possId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? "#fff";
  const possLogo = drive?.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);
  const ballYL = situation?.yardLine ?? drive?.ballYL;
  const fd = firstDownYL(situation, dir);

  // The drive band runs from where the possession started to the ball. Use
  // the first scrimmage play (skip the kickoff, whose start is the kicker's
  // spot on the other side of the field).
  const scrim = (drive?.plays ?? []).filter(
    (p) => p.startYL !== undefined && p.typeAbbrev !== "K" && p.typeAbbrev !== "EP"
  );
  const bandFrom = scrim.length ? scrim[0].startYL : undefined;
  const bandTo = ballYL;

  return (
    <svg viewBox={`0 0 120 ${h}`} style={{ width: "100%", height: "auto", display: "block", borderRadius: 6 }}>
      <FieldSurface h={h} bits={bits} showNumbers
        redZoneDir={situation?.isRedZone ? dir : undefined} />
      {bandFrom !== undefined && bandTo !== undefined && bandFrom !== bandTo && (
        <rect
          x={Math.min(xOf(bandFrom), xOf(bandTo))} y={1.5}
          width={Math.abs(xOf(bandFrom) - xOf(bandTo))} height={h - 3}
          fill={possColor} opacity={0.32}
        />
      )}
      {bandFrom !== undefined && (
        <line x1={xOf(bandFrom)} x2={xOf(bandFrom)} y1={1.5} y2={h - 1.5}
          stroke="#fff" strokeWidth={0.4} strokeDasharray="1.6 1.1" opacity={0.75} />
      )}
      {fd !== undefined && (
        <line x1={xOf(fd)} x2={xOf(fd)} y1={1.5} y2={h - 1.5}
          stroke={FIRST_DOWN_YELLOW} strokeWidth={0.85} />
      )}
      {ballYL !== undefined && (
        <BallMarker x={xOf(ballYL)} y={h / 2} color={possColor} dir={dir}
          logo={possLogo} size={8.5} />
      )}
    </svg>
  );
}

/* -------------------------------- ProbChart ------------------------------- */

type ProbMode = "win" | "cover" | "over";

// Chart geometry is fixed so the 50%-split stroke gradient (userSpaceOnUse)
// can be anchored to the exact pixel band the plot occupies.
const CHART_H = 230;
const CHART_MARGIN = { top: 8, right: 10, bottom: 0, left: -12 } as const;
const XAXIS_H = 18;
const PLOT_TOP = CHART_MARGIN.top;
const PLOT_BOTTOM = CHART_H - XAXIS_H;

function ProbChart({ points, summary, bits, simHomeWinPct, eventId }: {
  points: ProbPoint[];
  summary: GameSummaryLite | null;
  bits: TeamBits;
  simHomeWinPct?: number;
  eventId: string;
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

  // Quarter boundaries (3600-second regulation clock) → separator lines and
  // ESPN-style 1st/2nd/3rd/4th labels centered inside each segment.
  const { boundaries, tickIdxs, tickLabel } = useMemo(() => {
    const bounds: number[] = [];
    for (const thresh of [2700, 1800, 900]) {
      const idx = points.findIndex((p) => p.secondsLeft <= thresh);
      if (idx > 0) bounds.push(idx);
    }
    const otIdx = points.findIndex((p) => p.secondsLeft < 0);
    if (otIdx > 0) bounds.push(otIdx);
    const edges = [0, ...bounds, Math.max(points.length - 1, 1)];
    const names = ["1st", "2nd", "3rd", "4th", "OT"];
    const idxs: number[] = [];
    const label: Record<number, string> = {};
    for (let s = 0; s < edges.length - 1 && s < names.length; s++) {
      const mid = Math.round((edges[s] + edges[s + 1]) / 2);
      idxs.push(mid);
      label[mid] = names[s];
    }
    return { boundaries: bounds, tickIdxs: idxs, tickLabel: label };
  }, [points]);

  const last = points[points.length - 1];
  const gid = `wp-split-${eventId}`;
  const splitStroke = `url(#${gid})`;
  const stroke = effMode === "over" ? "var(--brand)" : splitStroke;

  let leaderLogo: string | undefined;
  let readout = "";
  let caption = "WIN PROBABILITY";
  if (last) {
    if (effMode === "win") {
      const homeUp = last.homeWin >= 50;
      leaderLogo = homeUp ? bits.homeLogo : bits.awayLogo;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? ""} ${(homeUp ? last.homeWin : 100 - last.homeWin).toFixed(1)}%`;
    } else if (effMode === "cover" && last.coverHome !== undefined) {
      caption = `COVER PROBABILITY${summary?.pickDetails ? ` · ${summary.pickDetails}` : ""}`;
      const homeUp = last.coverHome >= 50;
      leaderLogo = homeUp ? bits.homeLogo : bits.awayLogo;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? ""} ${(homeUp ? last.coverHome : 100 - last.coverHome).toFixed(1)}%`;
    } else if (effMode === "over" && last.overPct !== undefined) {
      caption = `OVER${summary?.overUnder !== undefined ? ` ${summary.overUnder}` : ""} PROBABILITY`;
      readout = `${last.overPct.toFixed(1)}%`;
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
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: "var(--muted)" }}>
          {caption}
        </span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums",
        }}>
          {leaderLogo && <img src={leaderLogo} alt="" width={16} height={16} style={{ objectFit: "contain" }} />}
          {readout}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          {modeBtn("win", "Win %", true)}
          {modeBtn("cover", "Cover %", hasCover)}
          {modeBtn("over", "Over %", hasOver)}
        </span>
      </div>

      <div style={{ position: "relative", width: "100%", height: CHART_H }}>
        {/* Which half of the chart belongs to whom (100% top = home). */}
        {effMode !== "over" && bits.homeLogo && (
          <img src={bits.homeLogo} alt={bits.homeAbbrev} width={16} height={16}
            style={{ position: "absolute", left: 24, top: PLOT_TOP + 4, zIndex: 1, opacity: 0.95, objectFit: "contain" }} />
        )}
        {effMode !== "over" && bits.awayLogo && (
          <img src={bits.awayLogo} alt={bits.awayAbbrev} width={16} height={16}
            style={{ position: "absolute", left: 24, top: PLOT_BOTTOM - 20, zIndex: 1, opacity: 0.95, objectFit: "contain" }} />
        )}
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ ...CHART_MARGIN }}>
            <defs>
              <linearGradient id={gid} x1="0" y1={PLOT_TOP} x2="0" y2={PLOT_BOTTOM} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={bits.homeColor ?? "var(--brand)"} />
                <stop offset="0.5" stopColor={bits.homeColor ?? "var(--brand)"} />
                <stop offset="0.5" stopColor={bits.awayColor ?? "var(--accent)"} />
                <stop offset="1" stopColor={bits.awayColor ?? "var(--accent)"} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="i" height={XAXIS_H}
              ticks={tickIdxs} tickFormatter={(v: number) => tickLabel[v] ?? ""}
              tick={{ fontSize: 10, fill: "var(--muted)" }}
              tickLine={false} axisLine={{ stroke: "var(--border)" }}
              interval={0} type="number" domain={[0, Math.max(points.length - 1, 1)]}
            />
            <YAxis
              domain={[0, 100]} ticks={[0, 50, 100]}
              tick={{ fontSize: 9, fill: "var(--muted)" }}
              tickFormatter={(v: number) => (v === 50 ? "50%" : "100%")}
              axisLine={false} tickLine={false}
            />
            <ReferenceLine y={50} stroke="var(--border)" />
            {boundaries.map((b) => (
              <ReferenceLine key={b} x={b} stroke="var(--border)" strokeDasharray="2 3" />
            ))}
            {effMode === "win" && simHomeWinPct !== undefined && (
              <ReferenceLine
                y={simHomeWinPct} stroke="var(--brand)" strokeDasharray="6 3"
                label={{ value: "SIM", position: "insideRight", fontSize: 9, fill: "var(--brand)" }}
              />
            )}
            <Tooltip
              content={(props: any) => {
                const row = props?.payload?.[0]?.payload;
                if (!row || row.v === undefined) return null;
                const ref = row.playId ? summary?.playText.get(row.playId) : undefined;
                return (
                  <div style={{
                    background: "var(--card)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "6px 8px", maxWidth: 260, fontSize: 11,
                    boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
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
            <Area
              type="stepAfter" dataKey="v" baseValue={50}
              stroke={stroke} strokeWidth={2.2}
              fill={stroke} fillOpacity={0.16}
              dot={false} isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* -------------------------------- DriveLog -------------------------------- */

function resultTone(result?: string, isScore?: boolean): string {
  const r = (result ?? "").toLowerCase();
  if (isScore || r.includes("touchdown") || r.includes("field goal")) return "var(--pos)";
  if (r.includes("interception") || r.includes("fumble") || r.includes("downs") || r.includes("safety")) return "var(--neg)";
  return "var(--muted)";
}

function DriveLog({ drives, bits, isLive }: {
  drives: CurrentDrive[];
  bits: TeamBits;
  isLive: boolean;
}) {
  const ordered = [...drives].reverse(); // newest first
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      {ordered.map((d, i) => {
        const possHome = d.teamId !== undefined && d.teamId === bits.homeId;
        const logo = d.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);
        const live = isLive && i === 0 && !d.result;
        const label = live ? "LIVE DRIVE" : (d.result ?? "—").toUpperCase();
        return (
          <details key={d.plays[0]?.id ?? i} open={i === 0}>
            <summary style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              padding: "7px 10px", borderTop: i === 0 ? "none" : "1px solid var(--border)",
              background: i === 0 ? "var(--fill)" : "transparent", listStyle: "none",
            }}>
              {logo
                ? <img src={logo} alt="" width={18} height={18} style={{ objectFit: "contain" }} />
                : <span style={{
                    width: 18, height: 18, borderRadius: 5,
                    background: (possHome ? bits.homeColor : bits.awayColor) ?? "var(--fill)",
                  }} />}
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                color: live ? "var(--neg)" : resultTone(d.result, d.isScore),
              }}>
                {live && <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: 999,
                  background: "var(--neg)", marginRight: 4, verticalAlign: "middle",
                }} />}
                {label}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.description ?? ""}</span>
              {d.scoreHome !== undefined && d.scoreAway !== undefined && (
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 700,
                  fontVariantNumeric: "tabular-nums", color: "var(--text)", whiteSpace: "nowrap",
                }}>
                  {bits.awayAbbrev} {d.scoreAway}–{d.scoreHome} {bits.homeAbbrev}
                </span>
              )}
            </summary>
            <div>
              {[...d.plays].reverse().map((p, j) => (
                <div key={p.id || j} style={{
                  padding: "5px 10px 5px 36px", fontSize: 12,
                  borderTop: "1px solid var(--border)",
                  background: p.scoring ? "var(--fill)" : "transparent",
                  borderLeft: p.scoring ? "3px solid var(--pos)" : "3px solid transparent",
                }}>
                  {p.startDD && (
                    <div style={{ fontWeight: 700, fontSize: 11.5 }}>{p.startDD}</div>
                  )}
                  <div style={{ color: "var(--muted)" }}>{p.text}</div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
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
  const drives = summary?.drives ?? [];
  const loading = summary === null && probs === null;
  const nothing = !loading && !drives.length && !(probs && probs.length);
  const possHome = (drive?.teamId ?? situation?.possessionId) === bits.homeId;
  const possLogo = drive?.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {isLive && (drive || situation) && (
        <div style={{ display: "grid", gap: 4 }}>
          <DriveField drive={drive} situation={situation} bits={bits} />
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums",
          }}>
            {possLogo && <img src={possLogo} alt="" width={15} height={15} style={{ objectFit: "contain" }} />}
            <span style={{ fontWeight: 700, color: "var(--text)" }}>
              {drive?.teamAbbrev ? `${drive.teamAbbrev} drive` : ""}
            </span>
            {drive?.description && <span>· {drive.description}</span>}
            <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--text)" }}>
              {situation?.downDistanceText ?? ""}
            </span>
          </div>
        </div>
      )}

      {probs && probs.length > 0 && (
        <ProbChart points={probs} summary={summary} bits={bits}
          simHomeWinPct={simHomeWinPct} eventId={eventId} />
      )}

      {drives.length > 0 && <DriveLog drives={drives} bits={bits} isLive={isLive} />}

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
