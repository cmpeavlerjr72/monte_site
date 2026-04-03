// src/pages/MLBGameDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  Cell,
} from "recharts";

/* ---------- HuggingFace dataset ---------- */
const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/mlb-sims-2026/resolve/main";
const SEASON = "2026";

/* ---------- Types ---------- */
type StatDist = {
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  mode: number;
  [key: string]: number;
};

type PlayerProps = Record<string, Record<string, StatDist>>;
type PlayerTeams = Record<string, "away" | "home">;
type GameSummary = Record<string, any>;

/* ---------- Stat display config ---------- */
const BATTER_STATS_ORDER = ["h", "tb", "hr", "rbi", "r", "k", "bb", "singles", "doubles", "triples", "h_r_rbi"];
const BATTER_STAT_LABELS: Record<string, string> = {
  h: "H", tb: "TB", hr: "HR", rbi: "RBI", r: "R",
  k: "K", bb: "BB", singles: "1B", doubles: "2B",
  triples: "3B", h_r_rbi: "H+R+RBI", pa: "PA", ab: "AB",
};
const BATTER_STAT_FULL_LABELS: Record<string, string> = {
  h: "Hits", tb: "Total Bases", hr: "Home Runs", rbi: "RBI", r: "Runs",
  k: "Strikeouts", bb: "Walks", singles: "Singles", doubles: "Doubles",
  triples: "Triples", h_r_rbi: "H+R+RBI", pa: "PA", ab: "AB",
};

const PITCHER_STATS_ORDER = ["k", "h_allowed", "bb", "hr_allowed", "outs_recorded", "ip_float"];
const PITCHER_STAT_LABELS: Record<string, string> = {
  k: "K", h_allowed: "H", bb: "BB",
  hr_allowed: "HR", outs_recorded: "Outs",
  ip_float: "IP", bf: "BF",
  runs_allowed: "RA", hbp: "HBP",
};
const PITCHER_STAT_FULL_LABELS: Record<string, string> = {
  k: "Strikeouts", h_allowed: "Hits Allowed", bb: "Walks",
  hr_allowed: "HR Allowed", outs_recorded: "Outs Rec.",
  ip_float: "Innings Pitched", bf: "Batters Faced",
  runs_allowed: "Runs Allowed", hbp: "HBP",
};

/* Box score compact columns */
const BATTER_BOX_COLS = ["h", "tb", "hr", "rbi", "r", "k", "bb"];
const PITCHER_BOX_COLS = ["k", "bb", "h_allowed", "hr_allowed", "ip_float"];

/* ---------- Helpers ---------- */
function pct(n: number): string {
  return (n * 100).toFixed(0) + "%";
}
function fmt(n: number, d = 2): string {
  return n.toFixed(d);
}

function overUnderKeys(stat: StatDist): { key: string; line: string; val: number }[] {
  return Object.entries(stat)
    .filter(([k]) => k.startsWith("over_"))
    .map(([k, v]) => ({
      key: k,
      line: k.replace("over_", "").replace("_", "."),
      val: v,
    }))
    .sort((a, b) => parseFloat(a.line) - parseFloat(b.line));
}

/* ESPN logo */
const MLB_ESPN_IDS: Record<string, number> = {
  "arizona diamondbacks": 29, "atlanta braves": 15, "baltimore orioles": 1,
  "boston red sox": 2, "chicago cubs": 16, "chicago white sox": 4,
  "cincinnati reds": 17, "cleveland guardians": 5, "colorado rockies": 27,
  "detroit tigers": 6, "houston astros": 18, "kansas city royals": 7,
  "los angeles angels": 3, "los angeles dodgers": 19, "miami marlins": 28,
  "milwaukee brewers": 8, "minnesota twins": 9, "new york mets": 21,
  "new york yankees": 10, "oakland athletics": 11, "philadelphia phillies": 22,
  "pittsburgh pirates": 23, "san diego padres": 25, "san francisco giants": 26,
  "seattle mariners": 12, "st. louis cardinals": 24, "tampa bay rays": 30,
  "texas rangers": 13, "toronto blue jays": 14, "washington nationals": 20,
  athletics: 11,
};
function mlbLogoUrl(name: string): string {
  const id = MLB_ESPN_IDS[name.toLowerCase()] ?? 0;
  return id ? `https://a.espncdn.com/i/teamlogos/mlb/500/${id}.png` : "";
}

/* Split players into away/home using the team mapping */
function splitByTeam(
  data: PlayerProps,
  teamMap: PlayerTeams,
): { away: { name: string; stats: Record<string, StatDist> }[]; home: { name: string; stats: Record<string, StatDist> }[] } {
  const away: { name: string; stats: Record<string, StatDist> }[] = [];
  const home: { name: string; stats: Record<string, StatDist> }[] = [];

  for (const [name, stats] of Object.entries(data)) {
    const side = teamMap[name];
    if (side === "home") {
      home.push({ name, stats });
    } else {
      away.push({ name, stats });
    }
  }

  return { away, home };
}

/* ---------- Main Component ---------- */
export default function MLBGameDetail() {
  const { "*": slug } = useParams();
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [players, setPlayers] = useState<PlayerProps>({});
  const [f5Players, setF5Players] = useState<PlayerProps>({});
  const [pitchers, setPitchers] = useState<PlayerProps>({});
  const [playerTeams, setPlayerTeams] = useState<PlayerTeams>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"batters" | "pitchers" | "f5">("batters");

  const dateFromSlug = slug?.slice(0, 10) ?? "";

  useEffect(() => {
    if (!slug || !dateFromSlug) return;
    let cancelled = false;
    setLoading(true);

    const base = `${DATASET_ROOT}/${SEASON}/days/${dateFromSlug}/games/${slug}`;

    Promise.all([
      fetch(`${base}/summary.json`).then((r) => r.ok ? r.json() : null),
      fetch(`${base}/player_props.json`).then((r) => r.ok ? r.json() : {}),
      fetch(`${base}/f5_player_props.json`).then((r) => r.ok ? r.json() : {}),
      fetch(`${base}/pitcher_props.json`).then((r) => r.ok ? r.json() : {}),
      fetch(`${base}/player_teams.json`).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([sum, pl, f5pl, pit, teams]) => {
      if (cancelled) return;
      setSummary(sum);
      setPlayers(pl ?? {});
      setF5Players(f5pl ?? {});
      setPitchers(pit ?? {});
      setPlayerTeams(teams ?? {});
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [slug, dateFromSlug]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading game data...</p>;
  if (!summary) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p>Game not found. <Link to="/mlb/scoreboard">Back to scoreboard</Link></p>
      </div>
    );
  }

  const awayLogo = mlbLogoUrl(summary.away_team);
  const homeLogo = mlbLogoUrl(summary.home_team);
  const hasTeamMap = Object.keys(playerTeams).length > 0;

  return (
    <div>
      {/* Back link */}
      <Link to="/mlb/scoreboard" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
        &larr; Back to Scoreboard
      </Link>

      {/* Game header */}
      <div className="card" style={{ marginTop: 10, padding: 16, borderRadius: 16, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            {awayLogo && <img src={awayLogo} alt="" width={48} height={48} />}
            <div style={{ fontWeight: 800, fontSize: 16 }}>{summary.away_team}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{summary.away_pitcher}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 24, color: "var(--brand)" }}>@</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{summary.date}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            {homeLogo && <img src={homeLogo} alt="" width={48} height={48} />}
            <div style={{ fontWeight: 800, fontSize: 16 }}>{summary.home_team}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{summary.home_pitcher}</div>
          </div>
        </div>

        {/* Summary grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 16 }}>
          <StatBox label="Full Game ML" away={summary.away_implied_ml} home={summary.home_implied_ml} />
          <StatBox label="Avg Total" value={fmt(summary.avg_total, 1)} />
          <StatBox label="F5 ML" away={summary.f5_away_implied_ml} home={summary.f5_home_implied_ml} />
          <StatBox label="F5 Total" value={fmt(summary.f5_avg_total, 1)} />
          <StatBox label="Run Line -1.5" away={pct(summary.away_cover_1_5_pct)} home={pct(summary.home_cover_1_5_pct)} />
          <StatBox label="O/U 8.5" value={`O ${pct(summary.over_8_5_pct)} / U ${pct(1 - summary.over_8_5_pct)}`} />
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginTop: 16, marginBottom: 12 }}>
        {(["batters", "pitchers", "f5"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: `2px solid ${tab === t ? "var(--accent)" : "var(--border)"}`,
              background: tab === t ? "var(--accent)" : "var(--card)",
              color: tab === t ? "#fff" : "var(--text)",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t === "f5" ? "F5 Batters" : t === "batters" ? "Batter Props" : "Pitcher Props"}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "batters" && (
        hasTeamMap ? (
          <BoxScoreView
            data={players}
            teamMap={playerTeams}
            pitcherData={pitchers}
            summary={summary}
          />
        ) : (
          <FlatBatterList data={players} />
        )
      )}
      {tab === "f5" && (
        hasTeamMap ? (
          <BoxScoreView
            data={f5Players}
            teamMap={playerTeams}
            pitcherData={pitchers}
            summary={summary}
            isF5
          />
        ) : (
          <FlatBatterList data={f5Players} isF5 />
        )
      )}
      {tab === "pitchers" && (
        hasTeamMap ? (
          <PitcherBoxScore
            data={pitchers}
            teamMap={playerTeams}
            summary={summary}
          />
        ) : (
          <FlatPitcherList data={pitchers} />
        )
      )}
    </div>
  );
}


/* ---------- Stat Box ---------- */
function StatBox({ label, value, away, home }: { label: string; value?: string; away?: string; home?: string }) {
  return (
    <div style={{ background: "var(--bg)", borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      {value && <div style={{ fontWeight: 800, fontSize: 16 }}>{value}</div>}
      {away && home && (
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14 }}>
          <span>{away}</span>
          <span>{home}</span>
        </div>
      )}
    </div>
  );
}


/* ==========================================================================
   BOX SCORE VIEW — Team-grouped layout
   ========================================================================== */

function BoxScoreView({
  data, teamMap, pitcherData, summary, isF5,
}: {
  data: PlayerProps;
  teamMap: PlayerTeams;
  pitcherData: PlayerProps;
  summary: GameSummary;
  isF5?: boolean;
}) {
  const { away, home } = useMemo(() => splitByTeam(data, teamMap), [data, teamMap]);

  const awayPitcher = summary.away_pitcher;
  const homePitcher = summary.home_pitcher;
  const awayPitcherStats = pitcherData[awayPitcher];
  const homePitcherStats = pitcherData[homePitcher];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TeamBoxScore
        teamName={summary.away_team}
        logoUrl={mlbLogoUrl(summary.away_team)}
        players={away}
        pitcherName={awayPitcher}
        pitcherStats={awayPitcherStats}
        isF5={isF5}
        side="away"
      />
      <TeamBoxScore
        teamName={summary.home_team}
        logoUrl={mlbLogoUrl(summary.home_team)}
        players={home}
        pitcherName={homePitcher}
        pitcherStats={homePitcherStats}
        isF5={isF5}
        side="home"
      />
    </div>
  );
}

function TeamBoxScore({
  teamName, logoUrl, players, pitcherName, pitcherStats, isF5, side,
}: {
  teamName: string;
  logoUrl: string;
  players: { name: string; stats: Record<string, StatDist> }[];
  pitcherName?: string;
  pitcherStats?: Record<string, StatDist>;
  isF5?: boolean;
  side: "away" | "home";
}) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  // Sort lineup by PA (batting order proxy) — higher PA = hit earlier in order
  const sorted = useMemo(() =>
    [...players].sort((a, b) => (b.stats.pa?.mean ?? 0) - (a.stats.pa?.mean ?? 0)),
    [players],
  );

  const sideColor = side === "away" ? "var(--brand)" : "var(--accent)";

  return (
    <div
      className="card"
      style={{
        borderRadius: 16,
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* Team header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `3px solid ${sideColor}`,
          background: "var(--bg)",
        }}
      >
        {logoUrl && <img src={logoUrl} alt="" width={32} height={32} />}
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{teamName}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {side === "away" ? "Away" : "Home"}{isF5 ? " (First 5 Inn.)" : ""}
          </div>
        </div>
      </div>

      {/* Starting pitcher summary row */}
      {pitcherName && pitcherStats && !isF5 && (
        <PitcherSummaryRow
          name={pitcherName}
          stats={pitcherStats}
          expanded={expandedPlayer === `SP:${pitcherName}`}
          onToggle={() => setExpandedPlayer(expandedPlayer === `SP:${pitcherName}` ? null : `SP:${pitcherName}`)}
        />
      )}

      {/* Column header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(120px, 1fr) ${BATTER_BOX_COLS.map(() => "52px").join(" ")}`,
          padding: "6px 16px",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        <div>Batter</div>
        {BATTER_BOX_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center" }}>{BATTER_STAT_LABELS[col]}</div>
        ))}
      </div>

      {/* Player rows */}
      {sorted.length === 0 ? (
        <div style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}>
          No {isF5 ? "F5 " : ""}batter data available.
        </div>
      ) : (
        sorted.map(({ name, stats }, idx) => (
          <BatterRow
            key={name}
            name={name}
            stats={stats}
            index={idx + 1}
            expanded={expandedPlayer === name}
            onToggle={() => setExpandedPlayer(expandedPlayer === name ? null : name)}
          />
        ))
      )}
    </div>
  );
}


/* ---------- Pitcher summary row within batter box score ---------- */
function PitcherSummaryRow({
  name, stats, expanded, onToggle,
}: {
  name: string;
  stats: Record<string, StatDist>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px",
          cursor: "pointer",
          background: "#1e3a5f0a",
        }}
      >
        <span
          style={{
            fontSize: 10, fontWeight: 700, padding: "2px 6px",
            borderRadius: 4, background: "#dbeafe", color: "#1e40af",
          }}
        >
          SP
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{name}</span>
        <div style={{ display: "flex", gap: 14 }}>
          {PITCHER_BOX_COLS.map((col) => {
            const s = stats[col];
            if (!s) return null;
            return (
              <div key={col} style={{ textAlign: "center", minWidth: 36 }}>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
                  {PITCHER_STAT_LABELS[col]}
                </div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{fmt(s.mean)}</div>
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 14, color: "var(--muted)", marginLeft: 4 }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </div>
      {expanded && (
        <PlayerDetailPanel stats={stats} statOrder={PITCHER_STATS_ORDER} labels={PITCHER_STAT_FULL_LABELS} />
      )}
    </div>
  );
}


/* ---------- Batter row in box score ---------- */
function BatterRow({
  name, stats, index, expanded, onToggle,
}: {
  name: string;
  stats: Record<string, StatDist>;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Compact row */}
      <div
        onClick={onToggle}
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(120px, 1fr) ${BATTER_BOX_COLS.map(() => "52px").join(" ")}`,
          padding: "8px 16px",
          cursor: "pointer",
          alignItems: "center",
          transition: "background 0.1s",
          background: expanded ? "var(--bg)" : undefined,
        }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = "var(--bg)"; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = ""; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, width: 16, textAlign: "right" }}>
            {index}
          </span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
        </div>
        {BATTER_BOX_COLS.map((col) => {
          const s = stats[col];
          if (!s) return <div key={col} style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>—</div>;

          const ous = overUnderKeys(s);
          const bestOu = ous.length > 0 ? ous[0] : null;
          const highlight = bestOu && (bestOu.val > 0.6 || bestOu.val < 0.4);

          return (
            <div key={col} style={{ textAlign: "center" }}>
              <div style={{
                fontWeight: 800,
                fontSize: 14,
                color: highlight
                  ? (bestOu!.val > 0.6 ? "#16a34a" : "#dc2626")
                  : "var(--text)",
              }}>
                {fmt(s.mean)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <PlayerDetailPanel stats={stats} statOrder={BATTER_STATS_ORDER} labels={BATTER_STAT_FULL_LABELS} />
      )}
    </div>
  );
}


/* ---------- Pitcher Box Score (for pitcher tab) ---------- */
function PitcherBoxScore({
  data, teamMap, summary,
}: {
  data: PlayerProps;
  teamMap: PlayerTeams;
  summary: GameSummary;
}) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  const awayPitchers: { name: string; stats: Record<string, StatDist> }[] = [];
  const homePitchers: { name: string; stats: Record<string, StatDist> }[] = [];

  for (const [name, stats] of Object.entries(data)) {
    if (teamMap[name] === "home") {
      homePitchers.push({ name, stats });
    } else {
      awayPitchers.push({ name, stats });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {[
        { label: summary.away_team, logo: mlbLogoUrl(summary.away_team), pitchers: awayPitchers, side: "away" as const },
        { label: summary.home_team, logo: mlbLogoUrl(summary.home_team), pitchers: homePitchers, side: "home" as const },
      ].map(({ label, logo, pitchers, side }) => (
        <div
          key={side}
          className="card"
          style={{ borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}
        >
          {/* Team header */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px",
              borderBottom: `3px solid ${side === "away" ? "var(--brand)" : "var(--accent)"}`,
              background: "var(--bg)",
            }}
          >
            {logo && <img src={logo} alt="" width={32} height={32} />}
            <div style={{ fontWeight: 800, fontSize: 16 }}>{label}</div>
          </div>

          {/* Column header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(140px, 1fr) ${PITCHER_BOX_COLS.map(() => "52px").join(" ")}`,
              padding: "6px 16px",
              background: "var(--bg)",
              borderBottom: "1px solid var(--border)",
              fontSize: 11, fontWeight: 700, color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.5px",
            }}
          >
            <div>Pitcher</div>
            {PITCHER_BOX_COLS.map((col) => (
              <div key={col} style={{ textAlign: "center" }}>{PITCHER_STAT_LABELS[col]}</div>
            ))}
          </div>

          {pitchers.length === 0 ? (
            <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No pitcher data.</div>
          ) : (
            pitchers.map(({ name, stats }) => (
              <div key={name} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => setExpandedPlayer(expandedPlayer === name ? null : name)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `minmax(140px, 1fr) ${PITCHER_BOX_COLS.map(() => "52px").join(" ")}`,
                    padding: "8px 16px",
                    cursor: "pointer",
                    alignItems: "center",
                    background: expandedPlayer === name ? "var(--bg)" : undefined,
                  }}
                  onMouseEnter={(e) => { if (expandedPlayer !== name) e.currentTarget.style.background = "var(--bg)"; }}
                  onMouseLeave={(e) => { if (expandedPlayer !== name) e.currentTarget.style.background = ""; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 6px",
                        borderRadius: 4, background: "#dbeafe", color: "#1e40af",
                      }}
                    >
                      SP
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
                  </div>
                  {PITCHER_BOX_COLS.map((col) => {
                    const s = stats[col];
                    if (!s) return <div key={col} style={{ textAlign: "center", color: "var(--muted)" }}>—</div>;
                    return (
                      <div key={col} style={{ textAlign: "center", fontWeight: 800, fontSize: 14 }}>
                        {fmt(s.mean)}
                      </div>
                    );
                  })}
                </div>
                {expandedPlayer === name && (
                  <PlayerDetailPanel stats={stats} statOrder={PITCHER_STATS_ORDER} labels={PITCHER_STAT_FULL_LABELS} />
                )}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}


/* ==========================================================================
   PLAYER DETAIL PANEL — Expanded view with percentiles, O/U, charts
   ========================================================================== */

function PlayerDetailPanel({
  stats, statOrder, labels,
}: {
  stats: Record<string, StatDist>;
  statOrder: string[];
  labels: Record<string, string>;
}) {
  return (
    <div style={{ padding: "8px 16px 16px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}>
        {statOrder.map((sk) => {
          const s = stats[sk];
          if (!s) return null;
          const ous = overUnderKeys(s);
          return (
            <div
              key={sk}
              style={{
                background: "var(--card)",
                borderRadius: 10,
                padding: 12,
                border: "1px solid var(--border)",
              }}
            >
              {/* Stat header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>{labels[sk] ?? sk}</span>
                <span style={{ fontWeight: 900, fontSize: 22 }}>{fmt(s.mean)}</span>
              </div>

              {/* Percentile bar */}
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 11, color: "var(--muted)", marginBottom: 8,
              }}>
                <span>p10: {fmt(s.p10)}</span>
                <span>p25: {fmt(s.p25)}</span>
                <span>med: {fmt(s.median)}</span>
                <span>p75: {fmt(s.p75)}</span>
                <span>p90: {fmt(s.p90)}</span>
              </div>

              {/* O/U pills */}
              {ous.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                  {ous.map((ou) => (
                    <OverUnderPill key={ou.key} line={ou.line} val={ou.val} />
                  ))}
                </div>
              )}

              {/* Mini bar chart */}
              {ous.length > 0 && (
                <div style={{ height: 50, marginTop: 4 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={ous.map((ou) => ({
                        line: `o${ou.line}`,
                        over: +(ou.val * 100).toFixed(0),
                      }))}
                      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                    >
                      <XAxis dataKey="line" tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="over" name="Over %">
                        {ous.map((ou, i) => (
                          <Cell key={i} fill={ou.val > 0.5 ? "#16a34a" : "#94a3b8"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ---------- Over/Under Pill ---------- */
function OverUnderPill({ line, val }: { line: string; val: number }) {
  const isOver = val > 0.5;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        background: isOver ? "#dcfce7" : "#fee2e2",
        color: isOver ? "#166534" : "#991b1b",
        border: `1px solid ${isOver ? "#bbf7d0" : "#fecaca"}`,
      }}
    >
      <span style={{ fontSize: 10, opacity: 0.7 }}>o{line}</span>
      <span>{pct(val)}</span>
    </div>
  );
}


/* ==========================================================================
   FALLBACK — Flat list for old data without player_teams.json
   ========================================================================== */

function FlatBatterList({ data, isF5 }: { data: PlayerProps; isF5?: boolean }) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return Object.entries(data)
      .map(([name, stats]) => ({ name, stats }))
      .sort((a, b) => (b.stats.tb?.mean ?? 0) - (a.stats.tb?.mean ?? 0));
  }, [data]);

  if (sorted.length === 0) {
    return <p style={{ color: "var(--muted)" }}>No {isF5 ? "F5 " : ""}batter prop data available.</p>;
  }

  return (
    <div className="card" style={{ borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
      {/* Column header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(120px, 1fr) ${BATTER_BOX_COLS.map(() => "52px").join(" ")}`,
          padding: "6px 16px",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontWeight: 700, color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: "0.5px",
        }}
      >
        <div>Batter</div>
        {BATTER_BOX_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center" }}>{BATTER_STAT_LABELS[col]}</div>
        ))}
      </div>
      {sorted.map(({ name, stats }, idx) => (
        <BatterRow
          key={name}
          name={name}
          stats={stats}
          index={idx + 1}
          expanded={expandedPlayer === name}
          onToggle={() => setExpandedPlayer(expandedPlayer === name ? null : name)}
        />
      ))}
    </div>
  );
}


function FlatPitcherList({ data }: { data: PlayerProps }) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const entries = Object.entries(data);
  if (entries.length === 0) return <p style={{ color: "var(--muted)" }}>No pitcher prop data available.</p>;

  return (
    <div className="card" style={{ borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(140px, 1fr) ${PITCHER_BOX_COLS.map(() => "52px").join(" ")}`,
          padding: "6px 16px",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontWeight: 700, color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: "0.5px",
        }}
      >
        <div>Pitcher</div>
        {PITCHER_BOX_COLS.map((col) => (
          <div key={col} style={{ textAlign: "center" }}>{PITCHER_STAT_LABELS[col]}</div>
        ))}
      </div>
      {entries.map(([name, stats]) => (
        <div key={name} style={{ borderBottom: "1px solid var(--border)" }}>
          <div
            onClick={() => setExpandedPlayer(expandedPlayer === name ? null : name)}
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(140px, 1fr) ${PITCHER_BOX_COLS.map(() => "52px").join(" ")}`,
              padding: "8px 16px",
              cursor: "pointer",
              background: expandedPlayer === name ? "var(--bg)" : undefined,
            }}
            onMouseEnter={(e) => { if (expandedPlayer !== name) e.currentTarget.style.background = "var(--bg)"; }}
            onMouseLeave={(e) => { if (expandedPlayer !== name) e.currentTarget.style.background = ""; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#dbeafe", color: "#1e40af" }}>SP</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
            </div>
            {PITCHER_BOX_COLS.map((col) => {
              const s = stats[col];
              if (!s) return <div key={col} style={{ textAlign: "center", color: "var(--muted)" }}>—</div>;
              return <div key={col} style={{ textAlign: "center", fontWeight: 800, fontSize: 14 }}>{fmt(s.mean)}</div>;
            })}
          </div>
          {expandedPlayer === name && (
            <PlayerDetailPanel stats={stats} statOrder={PITCHER_STATS_ORDER} labels={PITCHER_STAT_FULL_LABELS} />
          )}
        </div>
      ))}
    </div>
  );
}
