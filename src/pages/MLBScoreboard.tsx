// src/pages/MLBScoreboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { useLiveScoreboard } from "../lib/useLiveScoreboard";

/* ---------- HuggingFace dataset ---------- */
const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/mlb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026";

/* ---------- Types ---------- */
type GameSummary = {
  game_id: string;
  slug: string;
  date: string;
  away_team: string;
  home_team: string;
  away_pitcher: string;
  home_pitcher: string;
  away_abbr?: string;
  home_abbr?: string;
  n_sims: number;
  // Full game
  home_win_pct: number;
  away_win_pct: number;
  home_implied_ml: string;
  away_implied_ml: string;
  avg_home_score: number;
  avg_away_score: number;
  avg_total: number;
  over_7_5_pct: number;
  over_8_5_pct: number;
  over_9_5_pct: number;
  home_cover_1_5_pct: number;
  away_cover_1_5_pct: number;
  // F5
  f5_home_win_pct: number;
  f5_away_win_pct: number;
  f5_tie_pct: number;
  f5_home_implied_ml: string;
  f5_away_implied_ml: string;
  f5_avg_home_score: number;
  f5_avg_away_score: number;
  f5_avg_total: number;
  f5_over_3_5_pct: number;
  f5_over_4_5_pct: number;
  f5_over_5_5_pct: number;
};

type PitcherProps = {
  [pitcherName: string]: {
    [stat: string]: {
      mean: number;
      median: number;
      p10: number;
      p25: number;
      p75: number;
      p90: number;
      mode: number;
      [key: string]: number;  // over_X_Y keys
    };
  };
};

type LiveGame = {
  id: string;
  state: string;
  awayTeam?: string;
  homeTeam?: string;
  awayScore?: number;
  homeScore?: number;
  statusText: string;
  awayLogo?: string;
  homeLogo?: string;
  liveTotal?: number;
  liveSpread?: number;
};

/* ---------- Helpers ---------- */
function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}
function pct(n: number): string {
  return (n * 100).toFixed(0) + "%";
}
function mlColor(ml: string): string {
  if (ml.startsWith("-")) return "#16a34a";
  if (ml.startsWith("+")) return "#dc2626";
  return "var(--text)";
}

function todayStr(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function espnDateStr(iso: string): string {
  return iso.replace(/-/g, "");
}

/* ESPN MLB team logo URL from ESPN team ID */
function mlbLogoUrl(teamName: string): string {
  const id = MLB_ESPN_IDS[teamName.toLowerCase()] ?? 0;
  if (!id) return "";
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${id}.png`;
}

/* ESPN team ID lookup */
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

/* ---------- Component ---------- */
export default function MLBScoreboard() {
  const [date, setDate] = useState(todayStr);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [pitcherData, setPitcherData] = useState<Record<string, PitcherProps>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"full" | "f5">("full");

  // ESPN live data
  const livePayload = useLiveScoreboard(espnDateStr(date), "mlb" as any);

  // Parse ESPN live games
  const liveGames = useMemo<LiveGame[]>(() => {
    if (!livePayload) return [];
    const events = livePayload?.events ?? [];
    return events.map((e: any) => {
      const comp = e?.competitions?.[0];
      const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
      const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
      const type = e?.status?.type ?? comp?.status?.type ?? {};
      const odds = comp?.odds?.[0];

      let state = String(type.state || "pre").toLowerCase();
      if (type.completed || String(type.name || "").includes("FINAL")) state = "final";

      return {
        id: String(e?.id ?? ""),
        state,
        awayTeam: away?.team?.location ?? away?.team?.name ?? "",
        homeTeam: home?.team?.location ?? home?.team?.name ?? "",
        awayScore: Number(away?.score) || undefined,
        homeScore: Number(home?.score) || undefined,
        statusText: type?.shortDetail ?? type?.detail ?? "",
        awayLogo: away?.team?.logo,
        homeLogo: home?.team?.logo,
        liveTotal: odds ? Number(odds.overUnder) : undefined,
        liveSpread: odds ? Number(odds.spread) : undefined,
      };
    });
  }, [livePayload]);

  // Fetch sim data from HuggingFace
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const indexUrl = `${DATASET_ROOT}/${SEASON_PREFIX}/days/${date}/index.json`;

    fetch(indexUrl, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`No sim data for ${date}`);
        return r.json();
      })
      .then(async (idx) => {
        if (cancelled) return;
        const gameSlugs: string[] = (idx.games ?? []).map((g: any) => g.slug);

        // Fetch per-game summaries and pitcher props in parallel
        const summaries: GameSummary[] = [];
        const pitcherMap: Record<string, PitcherProps> = {};

        await Promise.all(
          gameSlugs.map(async (slug) => {
            try {
              const [sumResp, pitResp] = await Promise.all([
                fetch(`${DATASET_ROOT}/${SEASON_PREFIX}/days/${date}/games/${slug}/summary.json`),
                fetch(`${DATASET_ROOT}/${SEASON_PREFIX}/days/${date}/games/${slug}/pitcher_props.json`),
              ]);
              if (sumResp.ok) {
                const s = await sumResp.json();
                s.slug = slug;
                summaries.push(s);
              }
              if (pitResp.ok) {
                pitcherMap[slug] = await pitResp.json();
              }
            } catch (e) {
              console.warn(`Failed to load game ${slug}`, e);
            }
          })
        );

        if (!cancelled) {
          setGames(summaries);
          setPitcherData(pitcherMap);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setGames([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [date]);

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>MLB Simulations</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--text)",
            fontSize: 14,
          }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setViewMode("full")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `2px solid ${viewMode === "full" ? "var(--accent)" : "var(--border)"}`,
              background: viewMode === "full" ? "var(--accent)" : "var(--card)",
              color: viewMode === "full" ? "#fff" : "var(--text)",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Full Game
          </button>
          <button
            onClick={() => setViewMode("f5")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `2px solid ${viewMode === "f5" ? "#2563eb" : "var(--border)"}`,
              background: viewMode === "f5" ? "#2563eb" : "var(--card)",
              color: viewMode === "f5" ? "#fff" : "var(--text)",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            First 5 (F5)
          </button>
        </div>
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Loading simulations...</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {/* Game cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {games.map((g) => (
          <GameCard
            key={g.slug}
            game={g}
            pitchers={pitcherData[g.slug]}
            mode={viewMode}
            liveGames={liveGames}
          />
        ))}
      </div>

      {!loading && !error && games.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>No simulation data for {date}</p>
          <p style={{ color: "var(--muted)" }}>
            Sims are published daily once lineups are announced. Check back closer to game time.
          </p>
        </div>
      )}
    </div>
  );
}


/* ---------- Game Card ---------- */
function GameCard({
  game: g,
  pitchers,
  mode,
  liveGames,
}: {
  game: GameSummary;
  pitchers?: PitcherProps;
  mode: "full" | "f5";
  liveGames: LiveGame[];
}) {
  const awayLogo = mlbLogoUrl(g.away_team);
  const homeLogo = mlbLogoUrl(g.home_team);

  // Match with live game
  const live = liveGames.find((lg) => {
    const aN = (lg.awayTeam ?? "").toLowerCase();
    const hN = (lg.homeTeam ?? "").toLowerCase();
    return (
      g.away_team.toLowerCase().includes(aN) || aN.includes(g.away_team.toLowerCase().split(" ").pop()!) ||
      g.home_team.toLowerCase().includes(hN) || hN.includes(g.home_team.toLowerCase().split(" ").pop()!)
    );
  });

  const isF5 = mode === "f5";

  // Pick the right set of stats
  const winPctAway = isF5 ? g.f5_away_win_pct : g.away_win_pct;
  const winPctHome = isF5 ? g.f5_home_win_pct : g.home_win_pct;
  const mlAway = isF5 ? g.f5_away_implied_ml : g.away_implied_ml;
  const mlHome = isF5 ? g.f5_home_implied_ml : g.home_implied_ml;
  const avgAway = isF5 ? g.f5_avg_away_score : g.avg_away_score;
  const avgHome = isF5 ? g.f5_avg_home_score : g.avg_home_score;
  const avgTotal = isF5 ? g.f5_avg_total : g.avg_total;

  return (
    <div
      className="card"
      style={{
        padding: 0,
        border: "1px solid var(--border)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {/* Top bar: mode indicator */}
      <div
        style={{
          background: isF5 ? "#2563eb" : "var(--brand)",
          color: "#fff",
          padding: "6px 16px",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{isF5 ? "FIRST 5 INNINGS" : "FULL GAME"}</span>
        <span style={{ opacity: 0.7 }}>{g.n_sims?.toLocaleString()} sims</span>
      </div>

      {/* Main matchup */}
      <div style={{ padding: "12px 16px" }}>
        {/* Teams row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          {/* Away */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {awayLogo && <img src={awayLogo} alt="" width={32} height={32} style={{ borderRadius: 4 }} />}
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{g.away_team}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{g.away_pitcher}</div>
              </div>
            </div>
          </div>

          {/* VS / Score */}
          <div style={{ textAlign: "center", minWidth: 80 }}>
            {live && live.state !== "pre" ? (
              <div>
                <div style={{ fontWeight: 900, fontSize: 20 }}>
                  {live.awayScore} - {live.homeScore}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{live.statusText}</div>
              </div>
            ) : (
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--muted)" }}>@</div>
            )}
          </div>

          {/* Home */}
          <div style={{ flex: 1, textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{g.home_team}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{g.home_pitcher}</div>
              </div>
              {homeLogo && <img src={homeLogo} alt="" width={32} height={32} style={{ borderRadius: 4 }} />}
            </div>
          </div>
        </div>

        {/* Betting lines grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            marginTop: 12,
          }}
        >
          {/* Moneyline */}
          <div style={{ background: "var(--bg)", borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
              MONEYLINE
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800, color: mlColor(mlAway) }}>{mlAway}</span>
              <span style={{ fontWeight: 800, color: mlColor(mlHome) }}>{mlHome}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
              <span>{pct(winPctAway)}</span>
              <span>{pct(winPctHome)}</span>
            </div>
          </div>

          {/* Total */}
          <div style={{ background: "var(--bg)", borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
              TOTAL
            </div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{fmt(avgTotal)}</div>
            {!isF5 && (
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                O8.5: {pct(g.over_8_5_pct)}
              </div>
            )}
            {isF5 && (
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                O4.5: {pct(g.f5_over_4_5_pct)}
              </div>
            )}
          </div>

          {/* Run Line / Projected Score */}
          <div style={{ background: "var(--bg)", borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
              {isF5 ? "F5 SCORE" : "RUN LINE"}
            </div>
            {isF5 ? (
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {fmt(avgAway)} - {fmt(avgHome)}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                  <span>-1.5: {pct(g.away_cover_1_5_pct)}</span>
                  <span>-1.5: {pct(g.home_cover_1_5_pct)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {fmt(avgAway)} - {fmt(avgHome)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* F5 tie indicator */}
        {isF5 && g.f5_tie_pct > 0 && (
          <div style={{ marginTop: 6, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
            Tie probability: {pct(g.f5_tie_pct)}
          </div>
        )}

        {/* Pitcher K props (always shown) */}
        {pitchers && (
          <PitcherKSection pitchers={pitchers} awayPitcher={g.away_pitcher} homePitcher={g.home_pitcher} />
        )}

        {/* Link to game detail */}
        <div style={{ marginTop: 10, textAlign: "center" }}>
          <Link
            to={`/mlb/game/${g.slug}`}
            style={{
              color: "var(--accent)",
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            View Player Props & Full Analysis &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}


/* ---------- Pitcher Strikeout Section ---------- */
function PitcherKSection({
  pitchers,
  awayPitcher,
  homePitcher,
}: {
  pitchers: PitcherProps;
  awayPitcher: string;
  homePitcher: string;
}) {
  const away = pitchers[awayPitcher];
  const home = pitchers[homePitcher];
  if (!away?.k && !home?.k) return null;

  return (
    <div
      style={{
        marginTop: 12,
        background: "var(--bg)",
        borderRadius: 10,
        padding: "8px 12px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6, letterSpacing: 0.5 }}>
        PITCHER STRIKEOUTS
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { name: awayPitcher, data: away?.k },
          { name: homePitcher, data: home?.k },
        ].map(({ name, data }) =>
          data ? (
            <div key={name}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{name}</div>
              <div style={{ fontWeight: 900, fontSize: 20 }}>{fmt(data.mean)}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {(["over_3_5", "over_4_5", "over_5_5", "over_6_5", "over_7_5"] as const).map((key) => {
                  const val = data[key];
                  if (val === undefined) return null;
                  const label = key.replace("over_", "o").replace("_", ".");
                  return (
                    <span
                      key={key}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 6,
                        background: val > 0.55 ? "#dcfce7" : val < 0.45 ? "#fee2e2" : "#f3f4f6",
                        color: val > 0.55 ? "#166534" : val < 0.45 ? "#991b1b" : "#374151",
                      }}
                    >
                      {label}: {pct(val)}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
