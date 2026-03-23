// src/pages/MLBGameDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
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
type GameSummary = Record<string, any>;

/* ---------- Stat display config ---------- */
const BATTER_STATS_ORDER = ["h", "tb", "hr", "rbi", "r", "k", "bb", "singles", "doubles", "triples", "h_r_rbi"];
const BATTER_STAT_LABELS: Record<string, string> = {
  h: "Hits", tb: "Total Bases", hr: "Home Runs", rbi: "RBI", r: "Runs",
  k: "Strikeouts", bb: "Walks", singles: "Singles", doubles: "Doubles",
  triples: "Triples", h_r_rbi: "H+R+RBI", pa: "PA", ab: "AB",
};

const PITCHER_STATS_ORDER = ["k", "h_allowed", "bb", "hr_allowed", "outs_recorded", "ip_float"];
const PITCHER_STAT_LABELS: Record<string, string> = {
  k: "Strikeouts", h_allowed: "Hits Allowed", bb: "Walks",
  hr_allowed: "HR Allowed", outs_recorded: "Outs Rec.",
  ip_float: "Innings Pitched", bf: "Batters Faced",
  runs_allowed: "Runs Allowed", hbp: "HBP",
};

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
};
function mlbLogoUrl(name: string): string {
  const id = MLB_ESPN_IDS[name.toLowerCase()] ?? 0;
  return id ? `https://a.espncdn.com/i/teamlogos/mlb/500/${id}.png` : "";
}

/* ---------- Main Component ---------- */
export default function MLBGameDetail() {
  const { "*": slug } = useParams();
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [players, setPlayers] = useState<PlayerProps>({});
  const [f5Players, setF5Players] = useState<PlayerProps>({});
  const [pitchers, setPitchers] = useState<PlayerProps>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"batters" | "pitchers" | "f5">("batters");

  // Extract date from slug: 2026-03-25__team__team
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
    ]).then(([sum, pl, f5pl, pit]) => {
      if (cancelled) return;
      setSummary(sum);
      setPlayers(pl ?? {});
      setF5Players(f5pl ?? {});
      setPitchers(pit ?? {});
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
      {tab === "batters" && <BatterPropsTable data={players} />}
      {tab === "f5" && <BatterPropsTable data={f5Players} isF5 />}
      {tab === "pitchers" && <PitcherPropsSection data={pitchers} />}
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


/* ---------- Batter Props Table ---------- */
function BatterPropsTable({ data, isF5 }: { data: PlayerProps; isF5?: boolean }) {
  const sorted = useMemo(() => {
    return Object.entries(data)
      .map(([name, stats]) => ({ name, stats }))
      .sort((a, b) => (b.stats.tb?.mean ?? 0) - (a.stats.tb?.mean ?? 0));
  }, [data]);

  if (sorted.length === 0) {
    return <p style={{ color: "var(--muted)" }}>No {isF5 ? "F5 " : ""}batter prop data available.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sorted.map(({ name, stats }) => (
        <PlayerCard key={name} name={name} stats={stats} statOrder={BATTER_STATS_ORDER} labels={BATTER_STAT_LABELS} />
      ))}
    </div>
  );
}


/* ---------- Pitcher Props Section ---------- */
function PitcherPropsSection({ data }: { data: PlayerProps }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p style={{ color: "var(--muted)" }}>No pitcher prop data available.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {entries.map(([name, stats]) => (
        <PlayerCard key={name} name={name} stats={stats} statOrder={PITCHER_STATS_ORDER} labels={PITCHER_STAT_LABELS} isPitcher />
      ))}
    </div>
  );
}


/* ---------- Player Card (reusable for batters & pitchers) ---------- */
function PlayerCard({
  name,
  stats,
  statOrder,
  labels,
  isPitcher,
}: {
  name: string;
  stats: Record<string, StatDist>;
  statOrder: string[];
  labels: Record<string, string>;
  isPitcher?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Key stats to show in collapsed view
  const keyStats = isPitcher
    ? ["k", "bb", "h_allowed", "ip_float"]
    : ["h", "tb", "hr", "rbi", "k"];

  return (
    <div
      className="card"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: isPitcher ? "#1e3a5f08" : undefined,
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{name}</span>
          {isPitcher && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 6px",
              borderRadius: 4, background: "#dbeafe", color: "#1e40af",
            }}>
              SP
            </span>
          )}
        </div>
        <span style={{ fontSize: 18, color: "var(--muted)" }}>{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>

      {/* Quick stats row */}
      <div style={{ padding: "0 16px 10px", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {keyStats.map((sk) => {
          const s = stats[sk];
          if (!s) return null;
          const ous = overUnderKeys(s);
          return (
            <div key={sk} style={{ minWidth: 80 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                {labels[sk] ?? sk}
              </div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{fmt(s.mean)}</div>
              {ous.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                  {ous.slice(0, 3).map((ou) => (
                    <span
                      key={ou.key}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 4px",
                        borderRadius: 4,
                        background: ou.val > 0.55 ? "#dcfce7" : ou.val < 0.45 ? "#fee2e2" : "#f3f4f6",
                        color: ou.val > 0.55 ? "#166534" : ou.val < 0.45 ? "#991b1b" : "#374151",
                      }}
                    >
                      o{ou.line}: {pct(ou.val)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            {statOrder.map((sk) => {
              const s = stats[sk];
              if (!s) return null;
              const ous = overUnderKeys(s);
              return (
                <div
                  key={sk}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr",
                    gap: 8,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    alignItems: "start",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{labels[sk] ?? sk}</div>
                    <div style={{ fontWeight: 900, fontSize: 20 }}>{fmt(s.mean)}</div>
                  </div>
                  <div>
                    {/* Percentiles */}
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                      <span>p10: {fmt(s.p10)}</span>
                      <span>p25: {fmt(s.p25)}</span>
                      <span>med: {fmt(s.median)}</span>
                      <span>p75: {fmt(s.p75)}</span>
                      <span>p90: {fmt(s.p90)}</span>
                    </div>
                    {/* Over/under lines */}
                    {ous.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {ous.map((ou) => (
                          <OverUnderPill key={ou.key} line={ou.line} val={ou.val} />
                        ))}
                      </div>
                    )}
                    {/* Mini bar chart for distribution */}
                    {ous.length > 0 && (
                      <div style={{ marginTop: 8, height: 60 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={ous.map((ou) => ({
                              line: `o${ou.line}`,
                              over: +(ou.val * 100).toFixed(0),
                              under: +((1 - ou.val) * 100).toFixed(0),
                            }))}
                            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                          >
                            <XAxis dataKey="line" tick={{ fontSize: 10 }} />
                            <Tooltip
                              formatter={(v: number) => `${v}%`}
                              contentStyle={{ fontSize: 12 }}
                            />
                            <Bar dataKey="over" name="Over %" stackId="a">
                              {ous.map((ou, i) => (
                                <Cell key={i} fill={ou.val > 0.5 ? "#16a34a" : "#94a3b8"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
        gap: 4,
        padding: "3px 8px",
        borderRadius: 8,
        fontSize: 12,
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
