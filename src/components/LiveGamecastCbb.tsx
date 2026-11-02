// src/components/LiveGamecastCbb.tsx
//
// The basketball Live / Game Flow drawer. The football drawer (LiveGamecast.tsx)
// is drives, downs and field position; this one is built from what ESPN carries
// for a men's college game: linescore by half and OT, clock, team stats and
// fouls, box score, last plays and ESPN's win probability, plus OUR live odds
// from the game's live.json grid when it is published.
//
// Data cost: ONE ESPN summary call per poll (20 s) while this drawer is open
// and the game is live, one call when final, none when the drawer is closed.
// live.json / live_players.json are fetched by the host only while it is open.
//
// Absent on the ESPN feed and so not drawn: possession (shown only when the
// scoreboard event carries it), timeouts, bonus, per-half team fouls.

import { useMemo } from "react";
import { useMbbSummary, type MbbBoxPlayer, type MbbSummary } from "../lib/espnMbb";
import type { LiveGrid } from "../lib/liveGrid";
import { simStateOf } from "../lib/liveRecord";
import { liveOddsCbb, type LiveOddsCbb } from "../lib/liveOddsCbb";
import { playerKey, remainingFor, type LivePlayers } from "../lib/livePlayers";

export type CbbDrawerBits = {
  homeAbbrev?: string; awayAbbrev?: string; homeId?: string; awayId?: string;
  homeLogo?: string; awayLogo?: string; homeColor?: string; awayColor?: string;
};

type Props = {
  eventId: string;
  isLive: boolean;
  bits: CbbDrawerBits;
  /** Sim names (teamA = sim home) and whether ESPN's home team is teamA. */
  teamA: string; teamB: string; espnHomeIsA: boolean;
  /** Scoreboard-side live state (A/B orientation). */
  scoreA?: number; scoreB?: number; period?: number; clockSec?: number;
  halftime?: boolean; possessionId?: string; statusText?: string;
  /** Stored lines, A's perspective for the spread (negative = A favored). */
  spreadLineA?: number; totalLine?: number;
  /** Final-state grading and sim medians, from the card. */
  results?: { spread?: string; total?: string; ml?: string };
  med?: { A: number; B: number };
  liveGrid: LiveGrid | null;
  livePlayers: LivePlayers | null;
};

const num = (v: number | undefined, d = 0) => (v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d));
const pct = (p: number | undefined) => (p === undefined ? "–" : `${Math.round(p * 100)}%`);
const sgn = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

const sectionTitle = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" as const,
  color: "var(--muted)", marginBottom: 5,
};
const cellR = { textAlign: "right" as const, padding: "3px 6px", fontVariantNumeric: "tabular-nums" as const };

function periodLabel(i: number): string {
  return i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "OT" : `${i - 1}OT`;
}

export function LiveGamecastCbb(p: Props) {
  const summary = useMbbSummary(p.eventId, p.isLive);
  const { bits } = p;
  const homeName = p.espnHomeIsA ? p.teamA : p.teamB;
  const awayName = p.espnHomeIsA ? p.teamB : p.teamA;

  const odds = useMemo(() => (p.isLive && p.liveGrid
    ? liveOddsCbb(p.liveGrid, {
        scoreA: p.scoreA, scoreB: p.scoreB, period: p.period, clockSec: p.clockSec,
        spreadLineA: p.spreadLineA, totalLine: p.totalLine,
      })
    : null), [p.isLive, p.liveGrid, p.scoreA, p.scoreB, p.period, p.clockSec, p.spreadLineA, p.totalLine]);

  const home = summary?.home, away = summary?.away;
  const homeScore = home?.score ?? (p.espnHomeIsA ? p.scoreA : p.scoreB);
  const awayScore = away?.score ?? (p.espnHomeIsA ? p.scoreB : p.scoreA);
  const final = !p.isLive;
  const status = final ? "Final" : p.halftime ? "Halftime" : (summary?.detail || p.statusText || "Live");
  const posTeam = p.possessionId
    ? (p.possessionId === bits.homeId ? bits.homeAbbrev ?? homeName : p.possessionId === bits.awayId ? bits.awayAbbrev ?? awayName : undefined)
    : undefined;

  // Sim projections for the box: only when live_players.json exists and the game is in regulation.
  const projFor = useMemo(() => {
    if (!p.isLive || !p.livePlayers) return null;
    const st = simStateOf(p.scoreA, p.scoreB, p.period, p.clockSec, undefined, p.liveGrid?.clock);
    if (!st || st.ot) return null;
    const lp = p.livePlayers;
    return (bp: MbbBoxPlayer, side: "A" | "B"): number | undefined => {
      const hit = lp.players.find((x) => x.side === side && playerKey(x.player) === playerKey(bp.name));
      const i = hit ? hit.stats.indexOf("pts") : -1;
      if (!hit || i < 0 || bp.pts === undefined) return undefined;
      return bp.pts + remainingFor(lp, hit, st.elapsed, st.scoreA - st.scoreB)[i];
    };
  }, [p.isLive, p.livePlayers, p.liveGrid, p.scoreA, p.scoreB, p.period, p.clockSec]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ---- scoreboard header ---- */}
      <div style={{ display: "grid", gap: 6 }}>
        {[{ n: awayName, l: bits.awayLogo, s: awayScore, c: bits.awayColor, id: bits.awayId },
          { n: homeName, l: bits.homeLogo, s: homeScore, c: bits.homeColor, id: bits.homeId }].map((t, k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {t.l && <img src={t.l} alt="" width={22} height={22} style={{ objectFit: "contain" }} />}
            <span style={{ fontWeight: 700, color: t.c || "var(--text)" }}>{t.n}</span>
            {p.isLive && p.possessionId && p.possessionId === t.id && (
              <span title="Possession" aria-label="Possession" style={{ fontSize: 11 }}>●</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {num(t.s)}
            </span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "var(--text)" }}>{status}</span>
          {posTeam && p.isLive && !p.halftime && <span>· {posTeam} ball</span>}
        </div>
      </div>

      {/* ---- linescore ---- */}
      {summary && home && away && (
        <Linescore away={awayName} home={homeName} a={away.linescores} h={home.linescores} aT={awayScore} hT={homeScore} />
      )}

      {/* ---- live odds (live only; the drawer is never hidden when the grid is missing) ---- */}
      {p.isLive && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={sectionTitle}>Live odds (sim conditional on the game state)</div>
          {!p.liveGrid && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Live odds arrive when the sim grid is published for this game.
            </div>
          )}
          {p.liveGrid && odds?.kind === "ot" && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Overtime: live odds pause here until the overtime model ships.
            </div>
          )}
          {p.liveGrid && odds?.kind === "no-state" && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No live clock or score to price from yet.</div>
          )}
          {odds?.kind === "ok" && <OddsRows o={odds.odds} teamA={p.teamA} teamB={p.teamB} />}
        </div>
      )}

      {/* ---- final: result vs the lines ---- */}
      {final && (p.results?.spread || p.results?.total || p.results?.ml || p.med) && (
        <div>
          <div style={sectionTitle}>Result vs lines</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
            {(["spread", "total", "ml"] as const).map((k) => p.results?.[k] ? (
              <span key={k} style={{
                padding: "2px 8px", borderRadius: 999, fontWeight: 800, border: "1px solid var(--border)",
                color: p.results[k] === "win" ? "var(--pos)" : p.results[k] === "loss" ? "var(--neg)" : "var(--muted)",
              }}>{k === "ml" ? "ML" : k === "spread" ? "ATS" : "Total"} {p.results[k]}</span>
            ) : null)}
            {p.med && <span style={{ color: "var(--muted)" }}>
              Sim median {p.teamB} {Math.round(p.med.B)} – {p.teamA} {Math.round(p.med.A)}
            </span>}
          </div>
        </div>
      )}

      {/* ---- team stats ---- */}
      {summary && home && away && <TeamStats s={summary} awayName={awayName} homeName={homeName} />}

      {/* ---- ESPN win probability ---- */}
      {summary && summary.winProb.length > 2 && (
        <WinSpark pts={summary.winProb} home={homeName} away={awayName} color={bits.homeColor} />
      )}

      {/* ---- box score ---- */}
      {summary && summary.box.some((t) => t.players.length) && (
        <div style={{ display: "grid", gap: 10 }}>
          {[away, home].map((t) => {
            if (!t) return null;
            const tb = summary.box.find((b) => b.teamId === t.id);
            if (!tb || !tb.players.length) return null;
            const isA = (t.homeAway === "home") === p.espnHomeIsA;
            return (
              <BoxTable key={t.id} name={isA ? p.teamA : p.teamB} players={tb.players}
                proj={projFor ? (bp) => projFor(bp, isA ? "A" : "B") : null} />
            );
          })}
        </div>
      )}

      {/* ---- last plays ---- */}
      {p.isLive && summary && summary.plays.length > 0 && (
        <div>
          <div style={sectionTitle}>Recent plays</div>
          <div style={{ display: "grid", gap: 3, fontSize: 12 }}>
            {[...summary.plays].reverse().slice(0, 8).map((pl) => (
              <div key={pl.id} style={{ display: "flex", gap: 8, color: pl.scoring ? "var(--text)" : "var(--muted)" }}>
                <span style={{ flex: "none", width: 52, fontVariantNumeric: "tabular-nums" }}>
                  {pl.period ? `${pl.period > 2 ? "OT" : `H${pl.period}`} ` : ""}{pl.clock}
                </span>
                <span style={{ flex: 1, fontWeight: pl.scoring ? 700 : 400 }}>{pl.text}</span>
                {pl.scoring && <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{pl.away}–{pl.home}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!summary && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading the ESPN feed…</div>}
    </div>
  );
}

function OddsRows({ o, teamA, teamB }: { o: LiveOddsCbb; teamA: string; teamB: string }) {
  const row = (k: string, v: string, sub?: string) => (
    <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ color: "var(--muted)", flex: 1 }}>{k}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v}</span>
      {sub && <span style={{ color: "var(--muted)", minWidth: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{sub}</span>}
    </div>
  );
  return (
    <div>
      {row("Win probability", `${teamA} ${pct(o.pWinA)}`, `${teamB} ${pct(1 - o.pWinA)}`)}
      {row("Projected final", `${teamB} ${num(o.projB, 1)} – ${teamA} ${num(o.projA, 1)}`,
        `margin ${sgn(o.projMargin)} · total ${num(o.projTotal, 1)}`)}
      {o.totalLine !== undefined && row(`Total ${o.totalLine}`, `Over ${pct(o.pOver)}`, `proj ${sgn(o.totalDiff ?? 0)} vs line`)}
      {o.spreadLineA !== undefined && row(`Spread ${teamA} ${sgn(o.spreadLineA)}`, `${teamA} covers ${pct(o.pCoverA)}`,
        `proj ${sgn(o.coverMargin ?? 0)} vs line`)}
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
        A slice of the pregame sim ensemble, not a re-simulation. Lines are the stored pregame lines.
      </div>
    </div>
  );
}

function Linescore({ away, home, a, h, aT, hT }: { away: string; home: string; a: number[]; h: number[]; aT?: number; hT?: number }) {
  const n = Math.max(a.length, h.length, 2);
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
      <thead>
        <tr style={{ color: "var(--muted)", fontSize: 11 }}>
          <th style={{ textAlign: "left", padding: "3px 6px" }} />
          {Array.from({ length: n }, (_, i) => <th key={i} style={cellR}>{periodLabel(i)}</th>)}
          <th style={cellR}>T</th>
        </tr>
      </thead>
      <tbody>
        {([[away, a, aT], [home, h, hT]] as [string, number[], number | undefined][]).map(([nm, ls, t]) => (
          <tr key={nm} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ padding: "3px 6px", fontWeight: 700 }}>{nm}</td>
            {Array.from({ length: n }, (_, i) => <td key={i} style={cellR}>{ls[i] ?? "–"}</td>)}
            <td style={{ ...cellR, fontWeight: 800 }}>{num(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STAT_ROWS: [string, string][] = [
  ["fg", "FG"], ["fg3", "3PT"], ["ft", "FT"], ["reb", "Rebounds"], ["ast", "Assists"],
  ["to", "Turnovers"], ["fouls", "Team fouls"], ["paint", "Points in paint"],
];

function TeamStats({ s, awayName, homeName }: { s: MbbSummary; awayName: string; homeName: string }) {
  const a = s.stats[s.away?.id ?? ""], h = s.stats[s.home?.id ?? ""];
  if (!a || !h) return null;
  return (
    <div>
      <div style={sectionTitle}>Team stats</div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead><tr style={{ color: "var(--muted)", fontSize: 11 }}>
          <th style={{ textAlign: "left", padding: "3px 6px" }} />
          <th style={cellR}>{awayName}</th><th style={cellR}>{homeName}</th>
        </tr></thead>
        <tbody>
          {STAT_ROWS.filter(([k]) => a[k] !== undefined && h[k] !== undefined).map(([k, label]) => (
            <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "3px 6px", color: "var(--muted)" }}>{label}</td>
              <td style={cellR}>{a[k]}</td><td style={cellR}>{h[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WinSpark({ pts, home, away, color }: { pts: number[]; home: string; away: string; color?: string }) {
  const W = 300, H = 56;
  const step = pts.length > 1 ? W / (pts.length - 1) : W;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${((1 - v) * H).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div>
      <div style={sectionTitle}>
        ESPN win probability · {last >= 0.5 ? home : away} {Math.round(100 * (last >= 0.5 ? last : 1 - last))}%
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={`ESPN win probability, ${home} ${Math.round(last * 100)} percent`}>
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeDasharray="3 3" />
        <path d={d} fill="none" stroke={color || "var(--brand)"} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
        <span>{home} (top)</span><span>{away} (bottom)</span>
      </div>
    </div>
  );
}

function BoxTable({ name, players, proj }: {
  name: string; players: MbbBoxPlayer[]; proj: ((p: MbbBoxPlayer) => number | undefined) | null;
}) {
  const rows = [...players].sort((x, y) => (y.min ?? 0) - (x.min ?? 0) || (y.pts ?? 0) - (x.pts ?? 0)).slice(0, 10);
  const showProj = proj !== null && rows.some((r) => proj(r) !== undefined);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={sectionTitle}>{name} box score</div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
        <thead><tr style={{ color: "var(--muted)", fontSize: 10.5 }}>
          <th style={{ textAlign: "left", padding: "3px 6px" }}>Player</th>
          {["MIN", "PTS", "REB", "AST", "FG", "3PT", "FT", "TO", "PF"].map((h) => <th key={h} style={cellR}>{h}</th>)}
          {showProj && <th style={cellR} title="Actual plus the sim mean points still to come">Proj PTS</th>}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "3px 6px", whiteSpace: "nowrap", fontWeight: r.starter ? 700 : 500 }}>{r.short}</td>
              <td style={cellR}>{num(r.min)}</td><td style={{ ...cellR, fontWeight: 700 }}>{num(r.pts)}</td>
              <td style={cellR}>{num(r.reb)}</td><td style={cellR}>{num(r.ast)}</td>
              <td style={cellR}>{r.fg ?? "–"}</td><td style={cellR}>{r.fg3 ?? "–"}</td><td style={cellR}>{r.ft ?? "–"}</td>
              <td style={cellR}>{num(r.to)}</td>
              <td style={{ ...cellR, color: (r.pf ?? 0) >= 4 ? "var(--neg)" : undefined }}>{num(r.pf)}</td>
              {showProj && <td style={{ ...cellR, fontWeight: 700 }}>{num(proj!(r), 1)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
