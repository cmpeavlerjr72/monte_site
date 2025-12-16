import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getTeamColors } from "../utils/teamColors";

type TeamKey =
  | "James Madison"
  | "Oregon"
  | "Alabama"
  | "Oklahoma"
  | "Tulane"
  | "Ole Miss"
  | "Miami"
  | "Texas A&M"
  | "Texas Tech"
  | "Indiana"
  | "Georgia"
  | "Ohio State";

type TeamInfo = {
  name: TeamKey;
  seed: number;
  espnId: number; // used for logo
};

type MatchId = "FR-1" | "FR-2" | "FR-3" | "FR-4" | "QF-1" | "QF-2" | "QF-3" | "QF-4" | "SF-1" | "SF-2" | "NC";

type MatchInfo = {
  id: MatchId;
  round: "First Round" | "Quarterfinals" | "Semifinals" | "Championship";
  away?: TeamInfo | { placeholder: string };
  home?: TeamInfo | { placeholder: string };
  meta: string;
};

type CompactPayload = {
  version: number;
  teams: { A: string; B: string };
  nsims: number;
  scores: {
    A_pts: number[];
    B_pts: number[];
    totals?: number[];
    margin_A_minus_B?: number[];
    spreads_B_minus_A?: number[];
    A_plays?: number[];
    B_plays?: number[];
  };
  players: any;
};

const TEAM: Record<TeamKey, TeamInfo> = {
  "James Madison": { name: "James Madison", seed: 12, espnId: 256 },
  Oregon: { name: "Oregon", seed: 5, espnId: 2483 },
  Alabama: { name: "Alabama", seed: 9, espnId: 333 },
  Oklahoma: { name: "Oklahoma", seed: 8, espnId: 201 },
  Tulane: { name: "Tulane", seed: 11, espnId: 2655 },
  "Ole Miss": { name: "Ole Miss", seed: 6, espnId: 145 },
  Miami: { name: "Miami", seed: 10, espnId: 2390 },
  "Texas A&M": { name: "Texas A&M", seed: 7, espnId: 245 },
  "Texas Tech": { name: "Texas Tech", seed: 4, espnId: 2641 },
  Indiana: { name: "Indiana", seed: 1, espnId: 84 },
  Georgia: { name: "Georgia", seed: 3, espnId: 61 },
  "Ohio State": { name: "Ohio State", seed: 2, espnId: 194 },
};

function logoUrl(espnId: number) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
}

// Match your build_playoff_compact.py slug logic :contentReference[oaicite:2]{index=2}
function slugTeam(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function pairKey(a: string, b: string) {
  const aa = slugTeam(a);
  const bb = slugTeam(b);
  return aa < bb ? `${aa}__${bb}` : `${bb}__${aa}`;
}

function americanOdds(p: number) {
  if (!isFinite(p) || p <= 0) return "∞";
  if (p >= 1) return "-∞";
  const x = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  const rounded = Math.round(x);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function median(vals: number[]) {
  if (!vals?.length) return NaN;
  const a = [...vals].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function mean(vals: number[]) {
  if (!vals?.length) return NaN;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

function histBins(vals: number[], bins = 18) {
  if (!vals.length) return [] as { x0: number; x1: number; n: number }[];
  let lo = Infinity,
    hi = -Infinity;
  for (const v of vals) {
    if (!isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) {
    return [{ x0: lo, x1: hi, n: vals.length }];
  }
  const w = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, n: 0 }));
  for (const v of vals) {
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / w)));
    out[idx].n += 1;
  }
  return out;
}

function impliedAmericanFromProb(p: number) {
  if (!isFinite(p) || p <= 0) return "∞";
  if (p >= 1) return "-∞";
  const x = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  const rounded = Math.round(x);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function roundToHalf(x: number) {
  return Math.round(x * 2) / 2;
}

function fmtLine(x: number) {
  // keep .5 when present, otherwise integer
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function OverlayModal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(12px, 2vw, 24px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 96vw)",
          maxHeight: "min(80vh, 760px)",
          background: "var(--card, #fff)",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 16,
          boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 14 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "var(--card, #fff)",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: 14, overflow: "auto" }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Walks the compact players object and returns a flattened list of stat series.
 * We keep it generic because the stat names can vary.
 */
function flattenPlayerSeries(playersObj: any) {
  // shape from builder: players[team][player][role][stat] = [vals...] :contentReference[oaicite:3]{index=3}
  const rows: Array<{
    team: string;
    player: string;
    role: string;
    stat: string;
    vals: number[];
    mean: number;
    med: number;
  }> = [];

  if (!playersObj || typeof playersObj !== "object") return rows;

  for (const team of Object.keys(playersObj)) {
    const teamObj = playersObj[team];
    if (!teamObj || typeof teamObj !== "object") continue;

    for (const player of Object.keys(teamObj)) {
      const playerObj = teamObj[player];
      if (!playerObj || typeof playerObj !== "object") continue;

      for (const role of Object.keys(playerObj)) {
        const roleObj = playerObj[role];
        if (!roleObj || typeof roleObj !== "object") continue;

        for (const stat of Object.keys(roleObj)) {
          const valsRaw = roleObj[stat];
          if (!Array.isArray(valsRaw)) continue;
          const vals = valsRaw.map((x: any) => Number(x)).filter((x: number) => isFinite(x));
          if (!vals.length) continue;

          rows.push({
            team,
            player,
            role,
            stat,
            vals,
            mean: mean(vals),
            med: median(vals),
          });
        }
      }
    }
  }

  return rows;
}

function SeedBadge({ seed }: { seed: number }) {
  return (
    <span
      style={{
        minWidth: 26,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: "rgba(0,0,0,0.06)",
        color: "var(--text)",
      }}
      title={`Seed ${seed}`}
    >
      {seed}
    </span>
  );
}

function TeamRow({
  team,
  align = "left",
  onClick,
  selected,
  disabled,
  projectedScore,
}: {
  team: TeamInfo | { placeholder: string };
  align?: "left" | "right";
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  projectedScore?: number; // ✅ new
}) {
  const isPlaceholder = "placeholder" in team;

  const scoreText =
    projectedScore === undefined || !isFinite(projectedScore)
      ? ""
      : String(Math.round(projectedScore));

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isPlaceholder || !onClick}
      style={{
        cursor: !isPlaceholder && onClick && !disabled ? "pointer" : "default",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        justifyContent: "space-between", // ✅ to make room for right score box
        padding: "8px 10px",
        borderRadius: 10,
        background: selected ? "color-mix(in oklab, var(--brand) 18%, white)" : "rgba(255,255,255,0.9)",
        border: selected ? "1px solid color-mix(in oklab, var(--brand) 45%, rgba(0,0,0,0.08))" : "1px solid rgba(0,0,0,0.08)",
        opacity: disabled ? 0.6 : 1,
      }}
      title={isPlaceholder ? team.placeholder : onClick ? `Pick ${(team as TeamInfo).name} to advance` : (team as TeamInfo).name}
    >
      {/* left content */}
      {!isPlaceholder ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: align === "right" ? "flex-end" : "flex-start",
            minWidth: 0,
          }}
        >
          {align === "right" ? null : <SeedBadge seed={(team as TeamInfo).seed} />}
          <img
            src={logoUrl((team as TeamInfo).espnId)}
            alt={`${(team as TeamInfo).name} logo`}
            style={{ width: 22, height: 22, objectFit: "contain" }}
            loading="lazy"
          />
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 170,
            }}
          >
            {(team as TeamInfo).name}
          </div>
          {align === "right" ? <SeedBadge seed={(team as TeamInfo).seed} /> : null}
        </div>
      ) : (
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            opacity: 0.65,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 220,
          }}
        >
          {team.placeholder}
        </div>
      )}

      {/* ✅ right score “red box” */}
      <div
        style={{
          width: 54,
          height: 34,
          borderRadius: 8,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: 13,
          color: "var(--text)",
        }}
        title={scoreText ? `Projected median: ${scoreText}` : "Projected score pending"}
      >
        {scoreText}
      </div>
    </button>
  );
}


type Proj = {
  awayMed: number;
  homeMed: number;
  pAwayWin: number;
  pHomeWin: number;
  nsims: number;
  awayPts: number[];
  homePts: number[];
  total: number[];
  spreadHomeMinusAway: number[];
};

function MatchCard({
  m,
  cardHeightPx,
  teamsResolved,
  pick,
  setPick,
  compact,
  loading,
}: {
  m: MatchInfo;
  cardHeightPx: number;
  teamsResolved: { away?: TeamInfo; home?: TeamInfo };
  pick?: TeamKey;
  setPick: (winner?: TeamKey) => void;
  compact?: CompactPayload;
  loading?: boolean;
}) {
  const [openModal, setOpenModal] = useState<null | "scores" | "stats">(null);
  const [spreadLine, setSpreadLine] = useState<number>(-6.5); // default; you can set 0 or pull from metadata later

  const away = teamsResolved.away;
  const home = teamsResolved.home;
  const hasTeams = !!away && !!home;

  const proj = useMemo<Proj | null>(() => {
    if (!compact || !hasTeams) return null;

    const A = compact.teams?.A;
    const B = compact.teams?.B;
    const awayName = away!.name;
    const homeName = home!.name;

    const A_is_away = A === awayName && B === homeName;
    const A_is_home = A === homeName && B === awayName;

    if (!A_is_away && !A_is_home) return null;

    const A_pts = compact.scores?.A_pts ?? [];
    const B_pts = compact.scores?.B_pts ?? [];

    const awayPts = A_is_away ? A_pts : B_pts;
    const homePts = A_is_away ? B_pts : A_pts;

    const awayMed = median(awayPts);
    const homeMed = median(homePts);

    const n = Math.min(awayPts.length, homePts.length);
    const pAwayWin =
      n > 0 ? awayPts.slice(0, n).filter((x, i) => x > homePts[i]).length / n : NaN;

    return {
      awayMed,
      homeMed,
      pAwayWin,
      pHomeWin: isFinite(pAwayWin) ? 1 - pAwayWin : NaN,
      nsims: compact.nsims,
      awayPts,
      homePts,
      total: awayPts.map((x, i) => x + homePts[i]),
      spreadHomeMinusAway: homePts.map((x, i) => x - awayPts[i]),
    };
  }, [compact, hasTeams, away, home]);

  const spreadInfo = useMemo(() => {
    if (!proj || !away || !home) return null;

    // margin = home - away (already how you built proj.spreadHomeMinusAway)
    const m = proj.spreadHomeMinusAway;
    const L = Number(spreadLine);
    if (!isFinite(L) || !m.length) return null;

    // Home spread line convention: home + L vs away
    // Home covers if (home + L) > away  <=>  (home - away) > -L
    const thresh = -L;

    let homeCover = 0;
    let awayCover = 0;
    let push = 0;

    for (const margin of m) {
        if (margin > thresh) homeCover++;
        else if (margin < thresh) awayCover++;
        else push++;
    }

    const n = m.length;
    const pHome = homeCover / n;
    const pAway = awayCover / n;
    const pPush = push / n;

    // convert to "win odds given no push"
    const denom = 1 - pPush;
    const pHomeNoPush = denom > 0 ? pHome / denom : pHome;
    const pAwayNoPush = denom > 0 ? pAway / denom : pAway;

    return {
        n,
        L,
        thresh,
        pHome,
        pAway,
        pPush,
        homeOdds: impliedAmericanFromProb(pHomeNoPush),
        awayOdds: impliedAmericanFromProb(pAwayNoPush),
    };
    }, [proj, away, home, spreadLine]);


  const awayMedian = proj && isFinite(proj.awayMed) ? proj.awayMed : undefined;
  const homeMedian = proj && isFinite(proj.homeMed) ? proj.homeMed : undefined;

  const scoreLine = useMemo(() => {
    if (!proj || !away || !home) return null;
    if (!isFinite(proj.awayMed) || !isFinite(proj.homeMed)) return null;
    return `${away.name} ${proj.awayMed.toFixed(1)} — ${home.name} ${proj.homeMed.toFixed(1)}`;
  }, [proj, away, home]);

  return (
    <div
      style={{
        borderRadius: 14,
        background: "var(--card, #fff)",
        border: "1px solid rgba(0,0,0,0.10)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        padding: 12,
        height: cardHeightPx,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        {m.away ? (
          <TeamRow
            team={away ?? (m.away as any)}
            selected={!!away && pick === away.name}
            disabled={!away || !home}
            onClick={away && home ? () => setPick(away.name) : undefined}
            projectedScore={awayMedian}
          />
        ) : null}

        {m.home ? (
          <TeamRow
            team={home ?? (m.home as any)}
            selected={!!home && pick === home.name}
            disabled={!away || !home}
            onClick={away && home ? () => setPick(home.name) : undefined}
            projectedScore={homeMedian}
          />
        ) : null}

        {/* gray win% line */}
        <div style={{ marginTop: 2, display: "grid", gap: 6 }}>
          <div
            style={{
              fontSize: 12,
              opacity: 0.82,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>
                {loading ? "Loading sims…" : !hasTeams ? "Waiting on teams…" : !proj ? "No compact found" : ""}
            </div>


            {proj && isFinite(proj.pAwayWin) && away && home ? (
              <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }} title={`Based on ${proj.nsims} sims`}>
                {away.name} {(proj.pAwayWin * 100).toFixed(1)}% • {home.name} {(proj.pHomeWin * 100).toFixed(1)}%
              </div>
            ) : null}
          </div>

          {/* small buttons under win% line */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!proj}
              onClick={() => setOpenModal("scores")}
              style={{
                padding: "4px 8px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                // background: showScores ? "var(--brand)" : "var(--card)",
                // color: showScores ? "var(--brand-contrast)" : "var(--text)",
                cursor: proj ? "pointer" : "not-allowed",
                fontSize: 12,
                lineHeight: 1.1,
                fontWeight: 800,
              }}
            >
              Scores
            </button>

            <button
              type="button"
              disabled={!compact}
              onClick={() => setOpenModal("stats")}
              style={{
                padding: "4px 8px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                // background: showPlayers ? "var(--accent)" : "var(--card)",
                // color: showPlayers ? "var(--brand-contrast)" : "var(--text)",
                cursor: compact ? "pointer" : "not-allowed",
                fontSize: 12,
                lineHeight: 1.1,
                fontWeight: 800,
              }}
            >
              Stats
            </button>

            {pick ? (
              <button
                type="button"
                onClick={() => setPick(undefined)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text)",
                  fontSize: 12,
                  lineHeight: 1.1,
                  fontWeight: 800,
                }}
                title="Clear this pick"
              >
                Clear
              </button>
            ) : null}
          </div>

        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          opacity: 0.75,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={{ fontWeight: 700 }}>{m.round}</span>
        <span style={{ textAlign: "right" }}>{m.meta}</span>
      </div>

    <OverlayModal
    title={away && home ? `Score Distributions • ${away.name} vs ${home.name}` : "Score Distributions"}
    open={openModal === "scores"}
    onClose={() => setOpenModal(null)}
    >
    {proj && away && home ? (
        (() => {
        const aCol = getTeamColors(away.name)?.primary ?? "rgba(0,0,0,0.25)";
        const hCol = getTeamColors(home.name)?.primary ?? "rgba(0,0,0,0.25)";

        return (
            <div style={{ display: "grid", gap: 16 }}>
            {/* Total Points (blend both team colors) */}
            <MiniHist
                title="Total Points"
                values={proj.total}
                subtitle={`Median ${Math.round(median(proj.total))}`}
                barFill={() => `linear-gradient(90deg, ${aCol} 0%, ${aCol} 50%, ${hCol} 50%, ${hCol} 100%)`}
            />

            {/* Spread/Margin distribution colored by winner */}
            <MiniHist
                title={`${home.name} − ${away.name} (Margin)`}
                values={proj.spreadHomeMinusAway}
                subtitle={`Median ${median(proj.spreadHomeMinusAway).toFixed(1)}`}
                barFill={(mid) => {
                if (mid > 0) return hCol;      // home "wins" bins
                if (mid < 0) return aCol;      // away "wins" bins
                return "rgba(0,0,0,0.18)";     // tie bin
                }}
            />

            {/* Line control + Prob vs Line */}
            <div
                style={{
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 14,
                padding: 14,
                background: "rgba(0,0,0,0.02)",
                display: "grid",
                gap: 10,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>Line (Home Spread)</div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                    type="button"
                    onClick={() => setSpreadLine((v) => roundToHalf(v - 0.5))}
                    style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "white",
                        fontWeight: 900,
                    }}
                    >
                    −
                    </button>

                    <input
                    value={fmtLine(spreadLine)}
                    onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setSpreadLine(roundToHalf(v));
                    }}
                    style={{
                        width: 90,
                        textAlign: "center",
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.12)",
                        fontWeight: 900,
                    }}
                    />

                    <button
                    type="button"
                    onClick={() => setSpreadLine((v) => roundToHalf(v + 0.5))}
                    style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "white",
                        fontWeight: 900,
                    }}
                    >
                    +
                    </button>

                    <div style={{ fontSize: 13, opacity: 0.75, whiteSpace: "nowrap" }}>
                    {home.name} {spreadLine > 0 ? `+${fmtLine(spreadLine)}` : fmtLine(spreadLine)} (away is {spreadLine < 0 ? `+${fmtLine(-spreadLine)}` : fmtLine(-spreadLine)})
                    </div>
                </div>
                </div>

                {spreadInfo ? (
                <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 900, fontSize: 14 }}>Probability vs Line</div>

                    <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div style={{ fontWeight: 900 }}>
                        {away.name} (Cover):{" "}
                        <span style={{ fontWeight: 700 }}>
                            {(spreadInfo.pAway * 100).toFixed(1)}% ({spreadInfo.awayOdds})
                        </span>
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                        {away.name} {spreadLine < 0 ? `+${fmtLine(-spreadLine)}` : fmtLine(-spreadLine)}
                        </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div style={{ fontWeight: 900 }}>
                        Push (At):{" "}
                        <span style={{ fontWeight: 700 }}>{(spreadInfo.pPush * 100).toFixed(1)}%</span>
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>Exact margin = {fmtLine(spreadInfo.thresh)}</div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div style={{ fontWeight: 900 }}>
                        {home.name} (Cover):{" "}
                        <span style={{ fontWeight: 700 }}>
                            {(spreadInfo.pHome * 100).toFixed(1)}% ({spreadInfo.homeOdds})
                        </span>
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                        {home.name} {spreadLine > 0 ? `+${fmtLine(spreadLine)}` : fmtLine(spreadLine)}
                        </div>
                    </div>
                    </div>
                </div>
                ) : (
                <div style={{ fontSize: 13, opacity: 0.75 }}>Enter a valid line to compute cover odds.</div>
                )}
            </div>
            </div>
        );
        })()
    ) : (
        <div style={{ fontSize: 13, opacity: 0.8 }}>No score distribution available.</div>
    )}
    </OverlayModal>



    </div>
  );
}


function MiniHist({
  title,
  subtitle,
  values,
  barFill,
}: {
  title: string;
  subtitle?: string;
  values: number[];
  barFill?: (binMid: number, idx: number) => string;
}) {
  const bins = useMemo(() => histBins(values, 18), [values]);
  const maxN = useMemo(() => Math.max(1, ...bins.map((b) => b.n)), [bins]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 13, opacity: 0.75 }}>{subtitle}</div> : null}
      </div>

      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 90, marginTop: 8 }}>
        {bins.map((b, i) => {
          const mid = (b.x0 + b.x1) / 2;
          const fill = barFill ? barFill(mid, i) : "rgba(0,0,0,0.18)";
          return (
            <div
              key={i}
              title={`${b.x0.toFixed(1)} to ${b.x1.toFixed(1)}: ${b.n}`}
              style={{
                flex: 1,
                height: `${Math.round((b.n / maxN) * 100)}%`,
                background: fill,
                borderRadius: 4,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}


function PlayerStatsPanel({ compact }: { compact: CompactPayload }) {
  const rows = useMemo(() => flattenPlayerSeries(compact.players), [compact.players]);

  const [teamFilter, setTeamFilter] = useState<string>("All");
  const [statFilter, setStatFilter] = useState<string>("All");

  const teams = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.team);
    return ["All", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const stats = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.stat);
    return ["All", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (teamFilter !== "All") out = out.filter((r) => r.team === teamFilter);
    if (statFilter !== "All") out = out.filter((r) => r.stat === statFilter);
    // show most “impactful” by median magnitude
    return [...out].sort((a, b) => Math.abs(b.med) - Math.abs(a.med)).slice(0, 18);
  }, [rows, teamFilter, statFilter]);

  if (!rows.length) {
    return <div style={{ fontSize: 12, opacity: 0.8 }}>No player stat distributions in this compact.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 12 }}>Player Stat Distributions</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, opacity: 0.75 }}>Team:</label>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label style={{ fontSize: 12, opacity: 0.75 }}>Stat:</label>
          <select
            value={statFilter}
            onChange={(e) => setStatFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            {stats.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr style={{ background: "color-mix(in oklab, var(--brand) 10%, white)" }}>
              <th style={thStyle}>Team</th>
              <th style={thStyle}>Player</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Stat</th>
              <th style={thStyle}>Median</th>
              <th style={thStyle}>Mean</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={idx} style={{ background: idx % 2 ? "rgba(0,0,0,0.02)" : "transparent" }}>
                <td style={tdStyle}>{r.team}</td>
                <td style={tdStyle}>{r.player}</td>
                <td style={tdStyle}>{r.role}</td>
                <td style={tdStyle}>{r.stat}</td>
                <td style={tdStyle}>{isFinite(r.med) ? r.med.toFixed(1) : "-"}</td>
                <td style={tdStyle}>{isFinite(r.mean) ? r.mean.toFixed(1) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Showing top {filtered.length} by |median|. Use filters to narrow.
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  position: "sticky",
  top: 0,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  whiteSpace: "nowrap",
};

function RoundColumn({
  title,
  items,
  cardHeightPx,
  gapPx,
  paddingTopPx = 0,
  renderMatch,
}: {
  title: string;
  items: MatchInfo[];
  cardHeightPx: number;
  gapPx: number;
  paddingTopPx?: number;
  renderMatch: (m: MatchInfo) => React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          opacity: 0.8,
          padding: "6px 2px",
        }}
      >
        {title}
      </div>

      <div style={{ display: "grid", gap: gapPx, paddingTop: paddingTopPx }}>
        {items.map((m) => (
          <React.Fragment key={m.id}>{renderMatch(m)}</React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function Bracket() {
  // Tunables — keep your visual spacing exactly the same
  const CARD_H = 176;
  const GAP = 14;
  const SEMI_PAD_TOP = (CARD_H + GAP) / 2;
  const SEMI_GAP = CARD_H + 2 * GAP;
  const CHAMP_PAD_TOP = 1.5 * (CARD_H + GAP);

  // HF compacts location (matches hf_publish_playoff_compacts.py) :contentReference[oaicite:4]{index=4}
  const SEASON = 2026;
  const WEEK = 15;
  const REPO_ID = "mvpeav/cfb-playoff-compacts-2026";
  const baseUrl = `https://huggingface.co/datasets/${REPO_ID}/resolve/main/${SEASON}/playoffs/week${WEEK}/compact`;

  // picks: matchId -> winner team
  const [picks, setPicks] = useState<Partial<Record<MatchId, TeamKey>>>({});

  // compact caches
  const [indexFiles, setIndexFiles] = useState<Set<string> | null>(null);
  const [compactCache, setCompactCache] = useState<Record<string, CompactPayload>>({});
  const [loadingPairs, setLoadingPairs] = useState<Record<string, boolean>>({});
  const inflightRef = useRef<Record<string, boolean>>({});

  const rounds = useMemo(() => {
    const firstRound: MatchInfo[] = [
      {
        id: "FR-1",
        round: "First Round",
        away: TEAM["James Madison"],
        home: TEAM["Oregon"],
        meta: "Dec 20 • 7:30 PM ET • Autzen Stadium",
      },
      {
        id: "FR-2",
        round: "First Round",
        away: TEAM["Alabama"],
        home: TEAM["Oklahoma"],
        meta: "Dec 19 • 8:00 PM ET • Memorial Stadium (Norman)",
      },
      {
        id: "FR-3",
        round: "First Round",
        away: TEAM["Tulane"],
        home: TEAM["Ole Miss"],
        meta: "Dec 20 • 3:30 PM ET • Oxford, MS",
      },
      {
        id: "FR-4",
        round: "First Round",
        away: TEAM["Miami"],
        home: TEAM["Texas A&M"],
        meta: "Dec 20 • Noon ET • Kyle Field",
      },
    ];

    const quarterfinals: MatchInfo[] = [
      {
        id: "QF-1",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-1" },
        home: TEAM["Texas Tech"],
        meta: "Jan 1 • Noon ET • Orange Bowl",
      },
      {
        id: "QF-2",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-2" },
        home: TEAM["Indiana"],
        meta: "Jan 1 • 4:00 PM ET • Rose Bowl",
      },
      {
        id: "QF-3",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-3" },
        home: TEAM["Georgia"],
        meta: "Jan 1 • 8:00 PM ET • Sugar Bowl",
      },
      {
        id: "QF-4",
        round: "Quarterfinals",
        away: { placeholder: "Winner FR-4" },
        home: TEAM["Ohio State"],
        meta: "Dec 31 • 7:30 PM ET • Cotton Bowl",
      },
    ];

    const semifinals: MatchInfo[] = [
      {
        id: "SF-1",
        round: "Semifinals",
        away: { placeholder: "Winner QF-1" },
        home: { placeholder: "Winner QF-2" },
        meta: "Jan 9 • 7:30 PM ET • Peach Bowl",
      },
      {
        id: "SF-2",
        round: "Semifinals",
        away: { placeholder: "Winner QF-3" },
        home: { placeholder: "Winner QF-4" },
        meta: "Jan 9 • 7:30 PM ET • Fiesta Bowl",
      },
    ];

    const championship: MatchInfo[] = [
      {
        id: "NC",
        round: "Championship",
        away: { placeholder: "Winner SF-1" },
        home: { placeholder: "Winner SF-2" },
        meta: "2026 National Championship • TBD",
      },
    ];

    return { firstRound, quarterfinals, semifinals, championship };
  }, []);

  // Load index.json once so we can resolve compact filenames without guessing
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/index.json`, { cache: "no-store" });
        if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
        const idx = await res.json();
        const files: string[] = Array.isArray(idx?.files) ? idx.files : [];
        if (!cancelled) setIndexFiles(new Set(files));
      } catch (e) {
        if (!cancelled) setIndexFiles(new Set()); // fail closed but keep UI working
        // eslint-disable-next-line no-console
        console.warn("Failed to load playoff compacts index.json", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  // Resolve bracket participants based on picks
  const resolvedTeamsByMatch = useMemo(() => {
    const winnerOf = (id: MatchId): TeamInfo | undefined => {
      const w = picks[id];
      return w ? TEAM[w] : undefined;
    };

    const fr1 = { away: TEAM["James Madison"], home: TEAM["Oregon"] };
    const fr2 = { away: TEAM["Alabama"], home: TEAM["Oklahoma"] };
    const fr3 = { away: TEAM["Tulane"], home: TEAM["Ole Miss"] };
    const fr4 = { away: TEAM["Miami"], home: TEAM["Texas A&M"] };

    const qf1 = { away: winnerOf("FR-1"), home: TEAM["Texas Tech"] };
    const qf2 = { away: winnerOf("FR-2"), home: TEAM["Indiana"] };
    const qf3 = { away: winnerOf("FR-3"), home: TEAM["Georgia"] };
    const qf4 = { away: winnerOf("FR-4"), home: TEAM["Ohio State"] };

    const sf1 = { away: winnerOf("QF-1"), home: winnerOf("QF-2") };
    const sf2 = { away: winnerOf("QF-3"), home: winnerOf("QF-4") };

    const nc = { away: winnerOf("SF-1"), home: winnerOf("SF-2") };

    return {
      "FR-1": fr1,
      "FR-2": fr2,
      "FR-3": fr3,
      "FR-4": fr4,
      "QF-1": qf1,
      "QF-2": qf2,
      "QF-3": qf3,
      "QF-4": qf4,
      "SF-1": sf1,
      "SF-2": sf2,
      NC: nc,
    } as Record<MatchId, { away?: TeamInfo; home?: TeamInfo }>;
  }, [picks]);

  // Auto-clear downstream picks if a matchup's teams changed and the saved winner is no longer in that game
  useEffect(() => {
    const next = { ...picks };
    let changed = false;

    (Object.keys(resolvedTeamsByMatch) as MatchId[]).forEach((mid) => {
      const w = next[mid];
      if (!w) return;
      const r = resolvedTeamsByMatch[mid];
      const ok =
        (r.away && r.away.name === w) ||
        (r.home && r.home.name === w);
      if (!ok) {
        delete next[mid];
        changed = true;
      }
    });

    if (changed) setPicks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTeamsByMatch]);

  // fetch + cache compact for a given pair
  const ensureCompact = async (teamA: TeamKey, teamB: TeamKey) => {
    const key = pairKey(teamA, teamB);
    if (compactCache[key]) return;
    if (inflightRef.current[key]) return;
    inflightRef.current[key] = true;

    setLoadingPairs((p) => ({ ...p, [key]: true }));
    try {
      const a = slugTeam(teamA);
      const b = slugTeam(teamB);
      const name1 = `compact_${a}__${b}.json`;
      const name2 = `compact_${b}__${a}.json`;

      let fname: string | null = null;
      if (indexFiles?.has(name1)) fname = name1;
      else if (indexFiles?.has(name2)) fname = name2;
      else {
        // If index didn't load, try both
        fname = name1;
      }

      let res = await fetch(`${baseUrl}/${fname}`, { cache: "no-store" });
      if (!res.ok && fname === name1) {
        // fallback swap
        res = await fetch(`${baseUrl}/${name2}`, { cache: "no-store" });
      }
      if (!res.ok) throw new Error(`compact fetch HTTP ${res.status}`);

      const payload: CompactPayload = await res.json();
      setCompactCache((c) => ({ ...c, [key]: payload }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Failed to load compact", teamA, teamB, e);
    } finally {
      inflightRef.current[key] = false;
      setLoadingPairs((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  };

  useEffect(() => {
    if (!indexFiles) return;

    const teams = Object.keys(TEAM) as TeamKey[];

    // Preload every possible pair among playoff teams
    for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
        ensureCompact(teams[i], teams[j]);
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [indexFiles]);


  // Proactively load compacts for every matchup that becomes “known” as picks progress
  useEffect(() => {
    const seen = new Set<string>();
    (Object.keys(resolvedTeamsByMatch) as MatchId[]).forEach((mid) => {
      const r = resolvedTeamsByMatch[mid];
      if (!r.away || !r.home) return;
      const k = pairKey(r.away.name, r.home.name);
      if (seen.has(k)) return;
      seen.add(k);
      ensureCompact(r.away.name, r.home.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTeamsByMatch, indexFiles]);

  // win prob lookup from cached compacts
  const winProb = (a: TeamKey, b: TeamKey) => {
    const key = pairKey(a, b);
    const c = compactCache[key];
    if (!c?.scores?.A_pts?.length || !c?.scores?.B_pts?.length) return 0.5;

    // c has internal A/B labels; compute p(a beats b)
    const A = c.teams.A;
    const B = c.teams.B;
    const A_pts = c.scores.A_pts;
    const B_pts = c.scores.B_pts;
    const n = Math.min(A_pts.length, B_pts.length);

    if (A === a && B === b) {
      let w = 0;
      for (let i = 0; i < n; i++) if (A_pts[i] > B_pts[i]) w++;
      return w / n;
    }
    if (A === b && B === a) {
      let w = 0;
      for (let i = 0; i < n; i++) if (B_pts[i] > A_pts[i]) w++;
      return w / n;
    }
    return 0.5;
  };

  // Dynamic programming over bracket to compute Natty win% for each team
  const natty = useMemo(() => {
    const degenerate = (t?: TeamInfo) => (t ? ({ [t.name]: 1 } as Record<TeamKey, number>) : ({} as Record<TeamKey, number>));

    const normalize = (m: Record<TeamKey, number>) => {
      let s = 0;
      for (const k of Object.keys(m) as TeamKey[]) s += m[k] || 0;
      if (s <= 0) return m;
      const out = {} as Record<TeamKey, number>;
      for (const k of Object.keys(m) as TeamKey[]) out[k] = (m[k] || 0) / s;
      return out;
    };

    const combineMatch = (
      matchId: MatchId,
      left: Record<TeamKey, number>,
      right: Record<TeamKey, number>
    ) => {
      const picked = picks[matchId];
      // if user picked, lock it (as long as that team is present)
      if (picked) {
        const present = (left[picked] ?? 0) > 0 || (right[picked] ?? 0) > 0;
        if (present) return { [picked]: 1 } as Record<TeamKey, number>;
      }

      const out = {} as Record<TeamKey, number>;
      const L = Object.keys(left) as TeamKey[];
      const R = Object.keys(right) as TeamKey[];

      for (const a of L) {
        for (const b of R) {
          const pMeet = (left[a] || 0) * (right[b] || 0);
          if (pMeet <= 0) continue;
          const pA = winProb(a, b);
          out[a] = (out[a] || 0) + pMeet * pA;
          out[b] = (out[b] || 0) + pMeet * (1 - pA);
        }
      }
      return normalize(out);
    };

    // First round participant dists
    const fr1 = degenerate(TEAM["James Madison"]);
    const fr1b = degenerate(TEAM["Oregon"]);
    const fr2 = degenerate(TEAM["Alabama"]);
    const fr2b = degenerate(TEAM["Oklahoma"]);
    const fr3 = degenerate(TEAM["Tulane"]);
    const fr3b = degenerate(TEAM["Ole Miss"]);
    const fr4 = degenerate(TEAM["Miami"]);
    const fr4b = degenerate(TEAM["Texas A&M"]);

    const fr1W = combineMatch("FR-1", fr1, fr1b);
    const fr2W = combineMatch("FR-2", fr2, fr2b);
    const fr3W = combineMatch("FR-3", fr3, fr3b);
    const fr4W = combineMatch("FR-4", fr4, fr4b);

    const qf1W = combineMatch("QF-1", fr1W, degenerate(TEAM["Texas Tech"]));
    const qf2W = combineMatch("QF-2", fr2W, degenerate(TEAM["Indiana"]));
    const qf3W = combineMatch("QF-3", fr3W, degenerate(TEAM["Georgia"]));
    const qf4W = combineMatch("QF-4", fr4W, degenerate(TEAM["Ohio State"]));

    const sf1W = combineMatch("SF-1", qf1W, qf2W);
    const sf2W = combineMatch("SF-2", qf3W, qf4W);

    const ncW = combineMatch("NC", sf1W, sf2W);

    // Return sorted list
    const arr = (Object.keys(TEAM) as TeamKey[])
      .map((t) => ({ team: t, p: ncW[t] || 0 }))
      .sort((a, b) => b.p - a.p);

    return arr;
  }, [compactCache, picks]); // winProb uses compactCache

  const renderMatch = (m: MatchInfo) => {
    const teamsResolved = resolvedTeamsByMatch[m.id];
    const away = teamsResolved.away;
    const home = teamsResolved.home;

    const compactKey = away && home ? pairKey(away.name, home.name) : null;
    const compact = compactKey ? compactCache[compactKey] : undefined;
    const loading = compactKey ? !!loadingPairs[compactKey] : false;

    const pick = picks[m.id];
    const setPick = (winner?: TeamKey) => setPicks((p) => ({ ...p, [m.id]: winner }));

    return (
      <MatchCard
        m={m}
        cardHeightPx={CARD_H}
        teamsResolved={teamsResolved}
        pick={pick}
        setPick={setPick}
        compact={compact}
        loading={loading}
      />
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 0.2 }}>CFB Playoff Bracket</h1>
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
            2025–26 CFP • pick winners to advance • live title odds
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Compacts: {indexFiles ? `${indexFiles.size} files` : "loading…"}
          </div>
          <button
            type="button"
            onClick={() => setPicks({})}
            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            Clear All Picks
          </button>
        </div>
      </div>

      {/* National Championship odds */}
      <div
        className="card"
        style={{
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(0,0,0,0.10)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
          background: "var(--card, #fff)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>National Championship Odds (based on current bracket)</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Unpicked games use sim win% from the compacts; picked games are treated as fixed outcomes.
          </div>
        </div>

        <div
        style={{
            marginTop: 10,
            overflowX: "auto",
            overflowY: "hidden",
            WebkitOverflowScrolling: "touch",
            paddingBottom: 8,
            marginLeft: -16,  // optional: edge-to-edge on mobile
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
        }}
        >
        <table
            style={{
            width: "max-content",     // key: don’t force-fit into viewport
            minWidth: "100%",         // still fills on desktop
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: 13,
            }}
        >

            <thead>
              <tr style={{ background: "color-mix(in oklab, var(--brand) 10%, white)" }}>
                <th style={thStyle}>Team</th>
                <th style={thStyle}>Win%</th>
                <th style={thStyle}>American</th>
              </tr>
            </thead>
            <tbody>
              {natty.map((r, idx) => (
                <tr key={r.team} style={{ background: idx % 2 ? "rgba(0,0,0,0.02)" : "transparent" }}>
                  <td style={{ ...tdStyle, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                    <img src={logoUrl(TEAM[r.team].espnId)} style={{ width: 18, height: 18, objectFit: "contain" }} alt="" />
                    {r.team}
                  </td>
                  <td style={tdStyle}>{(r.p * 100).toFixed(2)}%</td>
                  <td style={tdStyle}>{r.p > 0 ? americanOdds(r.p) : "∞"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

        {/* Bracket grid */}
        <div
            style={{
            overflowX: "auto",
            overflowY: "visible",
            WebkitOverflowScrolling: "touch",
            paddingBottom: 8, // gives space so the horizontal scrollbar doesn't cover content
            marginLeft: -16,  // optional: lets it bleed edge-to-edge on phones
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
            }}
        >
            <div
            style={{
                display: "inline-grid", // key: size to content so scroll works reliably
                gridTemplateColumns: "repeat(4, minmax(240px, 1fr))",
                gap: 14,
                alignItems: "start",
                minWidth: "max-content", // ensures it won’t shrink into the viewport
            }}
            >
            <RoundColumn title="First Round" items={rounds.firstRound} cardHeightPx={CARD_H} gapPx={GAP} renderMatch={renderMatch} />
            <RoundColumn title="Quarterfinals" items={rounds.quarterfinals} cardHeightPx={CARD_H} gapPx={GAP} renderMatch={renderMatch} />
            <RoundColumn title="Semifinals" items={rounds.semifinals} cardHeightPx={CARD_H} gapPx={SEMI_GAP} paddingTopPx={SEMI_PAD_TOP} renderMatch={renderMatch} />
            <RoundColumn title="Championship" items={rounds.championship} cardHeightPx={CARD_H} gapPx={GAP} paddingTopPx={CHAMP_PAD_TOP} renderMatch={renderMatch} />
            </div>
        </div>


      <div style={{ fontSize: 12, opacity: 0.65 }}>
        Tip: click a team to advance it. As soon as both teams are known for a matchup, the projected score + buttons become available.
      </div>
    </div>
  );
}
