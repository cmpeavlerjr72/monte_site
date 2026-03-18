// src/pages/TennisPredictions.tsx
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/tennis-predictions/resolve/main";

/* -- Types --------------------------------------------------- */

interface Player {
  name: string;
  country_code: string;
  flag_url: string;
  hand: string;
  elo: number;
  serve_pct: number;
  return_pct: number;
  recent_form: number;
}

interface Prediction {
  prob_a: number;
  prob_b: number;
  calibrated_prob_a: number;
  calibrated_prob_b: number;
  elo_prob_a: number;
  sim_prob_a: number;
  ml_prob_a: number;
  confidence: "high" | "medium" | "low";
  fair_odds_a: number;
  fair_odds_b: number;
}

interface Market {
  odds_a: number | null;
  odds_b: number | null;
  value_a: number | null;
  value_b: number | null;
}

interface H2H {
  total: number;
  pct_a: number | null;
}

interface MatchResult {
  winner: "a" | "b";
  winner_name: string;
  score: number[] | null;
  score_loser: number[] | null;
  correct: boolean;
  pnl: number | null;
}

interface ResultsSummary {
  updated_at: string;
  total_completed: number;
  correct: number;
  incorrect: number;
  accuracy_pct: number;
  total_pnl?: number;
  avg_pnl?: number;
}

interface Match {
  tournament: string;
  tour: string;
  surface: string;
  round: string;
  match_time: string;
  best_of: number;
  player_a: Player;
  player_b: Player;
  prediction: Prediction;
  market: Market;
  h2h: H2H;
  result?: MatchResult;
}

interface DayPredictions {
  date: string;
  generated_at: string;
  model_version: string;
  total_matches: number;
  by_tour: Record<string, number>;
  matches: Match[];
  results_summary?: ResultsSummary;
}

interface IndexEntry {
  date: string;
  match_count: number;
  generated_at: string;
}

type TourFilter = "all" | "ATP" | "WTA" | "Challenger";
type SortKey = "prob" | "value" | "elo_diff" | "tournament";
type ViewTab = "predictions" | "performance";

/* -- Helpers ------------------------------------------------- */

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#16a34a",
  medium: "#ca8a04",
  low: "#9ca3af",
};

const SURFACE_COLORS: Record<string, string> = {
  Hard: "#3b82f6",
  Clay: "#ea580c",
  Grass: "#22c55e",
  Carpet: "#8b5cf6",
};

function formatPct(v: number) {
  return `${v.toFixed(1)}%`;
}

function formatOdds(v: number | null) {
  if (v == null) return "-";
  if (v > 0) return `+${v}`;
  return `${v}`;
}

function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatScore(score: number[] | null, scoreLose: number[] | null) {
  if (!score || !scoreLose) return "";
  return score.map((s, i) => `${s}-${scoreLose[i] ?? 0}`).join(", ");
}

/* -- Flag image component ------------------------------------ */

function Flag({ url, code }: { url: string; code: string }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [url]);

  if (!url || err) {
    return (
      <span
        style={{
          display: "inline-block",
          width: 24,
          height: 18,
          background: "var(--border)",
          borderRadius: 2,
          fontSize: 10,
          textAlign: "center",
          lineHeight: "18px",
          color: "var(--muted)",
        }}
      >
        {code || "?"}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={code}
      onError={() => setErr(true)}
      style={{
        width: 24,
        height: 18,
        objectFit: "cover",
        borderRadius: 2,
        border: "1px solid var(--border)",
        verticalAlign: "middle",
      }}
    />
  );
}

/* -- Confidence badge ---------------------------------------- */

function ConfBadge({ level }: { level: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "#fff",
        background: CONFIDENCE_COLORS[level] ?? CONFIDENCE_COLORS.low,
      }}
    >
      {level}
    </span>
  );
}

/* -- Surface pill -------------------------------------------- */

function SurfacePill({ surface }: { surface: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "#fff",
        background: SURFACE_COLORS[surface] ?? "var(--muted)",
      }}
    >
      {surface}
    </span>
  );
}

/* -- Result badge -------------------------------------------- */

function ResultBadge({ result }: { result: MatchResult }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        color: "#fff",
        background: result.correct ? "#16a34a" : "#dc2626",
      }}
    >
      {result.correct ? "W" : "L"}
      {result.pnl != null && (
        <span style={{ fontWeight: 400 }}>
          {result.pnl > 0 ? `+$${result.pnl}` : `-$${Math.abs(result.pnl)}`}
        </span>
      )}
    </span>
  );
}

/* -- Value indicator ----------------------------------------- */

function ValueCell({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "var(--muted)" }}>-</span>;
  const color = value > 3 ? "#16a34a" : value < -3 ? "#dc2626" : "var(--muted)";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {value > 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

/* -- Probability bar ----------------------------------------- */

function ProbBar({ probA, result }: { probA: number; result?: MatchResult }) {
  const probB = 100 - probA;
  const favA = probA >= 50;
  const winnerA = result?.winner === "a";
  const winnerB = result?.winner === "b";

  return (
    <div
      style={{
        display: "flex",
        height: 22,
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 11,
        fontWeight: 700,
        minWidth: 140,
      }}
    >
      <div
        style={{
          width: `${probA}%`,
          background: result
            ? winnerA ? "#16a34a" : "#ef4444"
            : favA ? "var(--brand)" : "#e2e8f0",
          color: result || favA ? "#fff" : "var(--text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "width 0.3s",
        }}
      >
        {probA >= 20 && formatPct(probA)}
      </div>
      <div
        style={{
          width: `${probB}%`,
          background: result
            ? winnerB ? "#16a34a" : "#ef4444"
            : !favA ? "var(--brand)" : "#e2e8f0",
          color: result || !favA ? "#fff" : "var(--text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "width 0.3s",
        }}
      >
        {probB >= 20 && formatPct(probB)}
      </div>
    </div>
  );
}

/* -- Performance dashboard ----------------------------------- */

function PerformanceDashboard({
  dateIndex,
  season,
}: {
  dateIndex: IndexEntry[];
  season: number;
}) {
  const [allData, setAllData] = useState<DayPredictions[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all dates that might have results
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const sorted = [...dateIndex].sort((a, b) => a.date.localeCompare(b.date));

    Promise.all(
      sorted.map((entry) =>
        fetch(
          `${DATASET_ROOT}/${season}/tennis/days/${entry.date}/predictions.json`,
          { cache: "no-store" }
        )
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setAllData(results.filter((d): d is DayPredictions => d != null));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [dateIndex, season]);

  // Aggregate stats across all dates
  const stats = useMemo(() => {
    const days: {
      date: string;
      correct: number;
      total: number;
      pnl: number;
      cumPnl: number;
      accuracy: number;
    }[] = [];
    let cumPnl = 0;
    let totalCorrect = 0;
    let totalMatches = 0;
    let totalPnl = 0;
    let betsPlaced = 0;

    // By confidence level
    const byConf: Record<string, { correct: number; total: number; pnl: number }> = {};
    // By tour
    const byTour: Record<string, { correct: number; total: number; pnl: number }> = {};

    for (const day of allData) {
      const completed = day.matches.filter((m) => m.result);
      if (completed.length === 0) continue;

      const dayCorrect = completed.filter((m) => m.result!.correct).length;
      const dayPnl = completed.reduce(
        (sum, m) => sum + (m.result!.pnl ?? 0),
        0
      );
      cumPnl += dayPnl;
      totalCorrect += dayCorrect;
      totalMatches += completed.length;
      totalPnl += dayPnl;
      betsPlaced += completed.filter((m) => m.result!.pnl != null).length;

      days.push({
        date: day.date,
        correct: dayCorrect,
        total: completed.length,
        pnl: dayPnl,
        cumPnl,
        accuracy: Math.round((dayCorrect / completed.length) * 100),
      });

      // Breakdown
      for (const m of completed) {
        const conf = m.prediction.confidence;
        if (!byConf[conf]) byConf[conf] = { correct: 0, total: 0, pnl: 0 };
        byConf[conf].total++;
        if (m.result!.correct) byConf[conf].correct++;
        byConf[conf].pnl += m.result!.pnl ?? 0;

        const tour = m.tour;
        if (!byTour[tour]) byTour[tour] = { correct: 0, total: 0, pnl: 0 };
        byTour[tour].total++;
        if (m.result!.correct) byTour[tour].correct++;
        byTour[tour].pnl += m.result!.pnl ?? 0;
      }
    }

    return {
      days,
      totalCorrect,
      totalMatches,
      totalPnl,
      betsPlaced,
      accuracy: totalMatches > 0 ? (totalCorrect / totalMatches) * 100 : 0,
      byConf,
      byTour,
    };
  }, [allData]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
        Loading performance data...
      </div>
    );
  }

  if (stats.totalMatches === 0) {
    return (
      <section className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
        No completed matches with results yet. Results are updated daily.
      </section>
    );
  }

  return (
    <div>
      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="card" style={{ padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 900 }}>
            {stats.accuracy.toFixed(1)}%
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Accuracy</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {stats.totalCorrect}/{stats.totalMatches}
          </div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: "center" }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 900,
              color: stats.totalPnl >= 0 ? "#16a34a" : "#dc2626",
            }}
          >
            {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(0)}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Total PnL</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {stats.betsPlaced} bets ($100/bet)
          </div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 900 }}>
            {stats.days.length}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Days Tracked</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: "center" }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 900,
              color:
                stats.betsPlaced > 0 && stats.totalPnl / stats.betsPlaced > 0
                  ? "#16a34a"
                  : "#dc2626",
            }}
          >
            {stats.betsPlaced > 0
              ? `${((stats.totalPnl / (stats.betsPlaced * 100)) * 100).toFixed(1)}%`
              : "-"}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>ROI</div>
        </div>
      </div>

      {/* Cumulative PnL chart */}
      {stats.days.length > 1 && (
        <section className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 18 }}>
            Cumulative PnL
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.days} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5)}
                fontSize={12}
              />
              <YAxis
                tickFormatter={(v: number) => `$${v}`}
                fontSize={12}
              />
              <Tooltip
                formatter={(v: number, name: string) => [
                  `$${v.toFixed(0)}`,
                  name === "cumPnl" ? "Cumulative PnL" : name,
                ]}
                labelFormatter={(l: string) => formatDate(l)}
              />
              <Line
                type="monotone"
                dataKey="cumPnl"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Cumulative PnL"
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Daily accuracy chart */}
      {stats.days.length > 1 && (
        <section className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 18 }}>
            Daily Accuracy
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.days} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5)}
                fontSize={12}
              />
              <YAxis
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, 100]}
                fontSize={12}
              />
              <Tooltip
                formatter={(v: number, name: string) => [
                  `${v}%`,
                  name === "accuracy" ? "Accuracy" : name,
                ]}
                labelFormatter={(l: string) => `${formatDate(l)}`}
              />
              <Legend />
              <Bar dataKey="accuracy" name="Accuracy" radius={[4, 4, 0, 0]}>
                {stats.days.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.accuracy >= 60 ? "#16a34a" : d.accuracy >= 50 ? "#ca8a04" : "#dc2626"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Breakdown tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        {/* By confidence */}
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 16 }}>By Confidence</h3>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "4px 0" }}>Level</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Record</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Acc%</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>PnL</th>
              </tr>
            </thead>
            <tbody>
              {(["high", "medium", "low"] as const).map((conf) => {
                const d = stats.byConf[conf];
                if (!d) return null;
                const acc = ((d.correct / d.total) * 100).toFixed(1);
                return (
                  <tr key={conf} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 0" }}>
                      <ConfBadge level={conf} />
                    </td>
                    <td style={{ textAlign: "right", padding: "4px 0" }}>
                      {d.correct}-{d.total - d.correct}
                    </td>
                    <td style={{ textAlign: "right", padding: "4px 0" }}>{acc}%</td>
                    <td
                      style={{
                        textAlign: "right",
                        padding: "4px 0",
                        fontWeight: 600,
                        color: d.pnl >= 0 ? "#16a34a" : "#dc2626",
                      }}
                    >
                      {d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* By tour */}
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 16 }}>By Tour</h3>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "4px 0" }}>Tour</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Record</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Acc%</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>PnL</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.byTour)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([tour, d]) => {
                  const acc = ((d.correct / d.total) * 100).toFixed(1);
                  return (
                    <tr key={tour} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 0", fontWeight: 600 }}>{tour}</td>
                      <td style={{ textAlign: "right", padding: "4px 0" }}>
                        {d.correct}-{d.total - d.correct}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 0" }}>{acc}%</td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "4px 0",
                          fontWeight: 600,
                          color: d.pnl >= 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(0)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      </div>

      {/* Daily breakdown table */}
      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 16 }}>Daily Results</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "6px 0" }}>Date</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>Record</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>Accuracy</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>Day PnL</th>
              <th style={{ textAlign: "right", padding: "6px 0" }}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {stats.days.map((d) => (
              <tr key={d.date} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 0" }}>{formatDate(d.date)}</td>
                <td style={{ textAlign: "right", padding: "6px 0" }}>
                  {d.correct}-{d.total - d.correct}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "6px 0",
                    color: d.accuracy >= 60 ? "#16a34a" : d.accuracy >= 50 ? "#ca8a04" : "#dc2626",
                    fontWeight: 600,
                  }}
                >
                  {d.accuracy}%
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "6px 0",
                    fontWeight: 600,
                    color: d.pnl >= 0 ? "#16a34a" : "#dc2626",
                  }}
                >
                  {d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(0)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "6px 0",
                    fontWeight: 600,
                    color: d.cumPnl >= 0 ? "#16a34a" : "#dc2626",
                  }}
                >
                  {d.cumPnl >= 0 ? "+" : ""}${d.cumPnl.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* -- Main Component ------------------------------------------ */

export default function TennisPredictions() {
  const [dateIndex, setDateIndex] = useState<IndexEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [data, setData] = useState<DayPredictions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tourFilter, setTourFilter] = useState<TourFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("prob");
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("predictions");

  const season = new Date().getFullYear();

  // Fetch index
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch(`${DATASET_ROOT}/${season}/tennis/index.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((idx: IndexEntry[]) => {
        if (cancelled) return;
        setDateIndex(idx);
        // Select most recent date
        if (idx.length > 0) {
          const sorted = [...idx].sort((a, b) => b.date.localeCompare(a.date));
          setSelectedDate(sorted[0].date);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [season]);

  // Fetch predictions for selected date
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;

    fetch(
      `${DATASET_ROOT}/${season}/tennis/days/${selectedDate}/predictions.json`,
      { cache: "no-store" }
    )
      .then((r) => {
        if (!r.ok) throw new Error(`No data for ${selectedDate}`);
        return r.json();
      })
      .then((d: DayPredictions) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => { cancelled = true; };
  }, [selectedDate, season]);

  // Filter and sort matches
  const filteredMatches = useMemo(() => {
    if (!data) return [];
    let matches = data.matches;

    // Tour filter
    if (tourFilter !== "all") {
      matches = matches.filter((m) => {
        if (tourFilter === "Challenger") return m.tour === "Challenger" || m.tour === "WTA Challenger";
        return m.tour === tourFilter;
      });
    }

    // Sort
    matches = [...matches].sort((a, b) => {
      switch (sortKey) {
        case "prob": {
          const maxA = Math.max(a.prediction.prob_a, a.prediction.prob_b);
          const maxB = Math.max(b.prediction.prob_a, b.prediction.prob_b);
          return maxB - maxA;
        }
        case "value": {
          const va = Math.max(a.market.value_a ?? -999, a.market.value_b ?? -999);
          const vb = Math.max(b.market.value_a ?? -999, b.market.value_b ?? -999);
          return vb - va;
        }
        case "elo_diff":
          return Math.abs(b.player_a.elo - b.player_b.elo) - Math.abs(a.player_a.elo - a.player_b.elo);
        case "tournament":
          return a.tournament.localeCompare(b.tournament);
        default:
          return 0;
      }
    });

    return matches;
  }, [data, tourFilter, sortKey]);

  // Chart data: top 12 most lopsided matches
  const chartData = useMemo(() => {
    if (!data) return [];
    return [...data.matches]
      .sort((a, b) => {
        const maxA = Math.max(a.prediction.prob_a, a.prediction.prob_b);
        const maxB = Math.max(b.prediction.prob_a, b.prediction.prob_b);
        return maxB - maxA;
      })
      .slice(0, 12)
      .map((m) => {
        const favA = m.prediction.prob_a >= m.prediction.prob_b;
        return {
          label: favA
            ? `${m.player_a.name.split(" ").pop()} v ${m.player_b.name.split(" ").pop()}`
            : `${m.player_b.name.split(" ").pop()} v ${m.player_a.name.split(" ").pop()}`,
          value: Math.max(m.prediction.prob_a, m.prediction.prob_b),
          surface: m.surface,
          confidence: m.prediction.confidence,
        };
      });
  }, [data]);

  // Tour counts for filter buttons
  const tourCounts = useMemo(() => {
    if (!data) return {};
    const counts: Record<string, number> = { all: data.matches.length };
    for (const m of data.matches) {
      const key = m.tour === "WTA Challenger" ? "Challenger" : m.tour;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
        Loading tennis predictions...
      </div>
    );
  }

  return (
    <div>
      {/* Header card */}
      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontWeight: 900, fontSize: 24 }}>
            Tennis Predictions
          </h1>

          {/* View tabs */}
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {(["predictions", "performance"] as ViewTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setViewTab(tab)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: viewTab === tab ? "var(--brand)" : "var(--card)",
                  color: viewTab === tab ? "var(--brand-contrast)" : "var(--text)",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  textTransform: "capitalize",
                }}
              >
                {tab === "performance" ? "PnL & Accuracy" : "Predictions"}
              </button>
            ))}
          </div>

          {viewTab === "predictions" && (
            <select
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setError("");
              }}
              style={{ fontSize: 14, padding: "6px 10px" }}
            >
              {dateIndex
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((entry) => (
                  <option key={entry.date} value={entry.date}>
                    {formatDate(entry.date)} ({entry.match_count} matches)
                  </option>
                ))}
            </select>
          )}
        </div>

        {viewTab === "predictions" && data && (
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
            {data.total_matches} matches &middot; Model: Hybrid (Elo + Point Sim + LightGBM)
            &middot; Generated {new Date(data.generated_at).toLocaleString()}
            {data.results_summary && (
              <> &middot; Results: {data.results_summary.correct}/{data.results_summary.total_completed} ({data.results_summary.accuracy_pct}%)</>
            )}
          </p>
        )}

        {error && (
          <p style={{ margin: "12px 0 0", color: "#b91c1c", fontSize: 14 }}>{error}</p>
        )}
      </section>

      {/* Performance view */}
      {viewTab === "performance" && (
        <PerformanceDashboard dateIndex={dateIndex} season={season} />
      )}

      {/* Predictions view */}
      {viewTab === "predictions" && (
        <>
          {/* Filters + sort */}
          {data && (
            <section className="card" style={{ padding: 12, marginBottom: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>Tour:</span>
                {(["all", "ATP", "WTA", "Challenger"] as TourFilter[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTourFilter(t)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: tourFilter === t ? "var(--brand)" : "var(--card)",
                      color: tourFilter === t ? "var(--brand-contrast)" : "var(--text)",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {t === "all" ? "All" : t} {tourCounts[t] != null ? `(${tourCounts[t]})` : ""}
                  </button>
                ))}

                <span style={{ marginLeft: 16, fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>Sort:</span>
                {([
                  ["prob", "Confidence"],
                  ["value", "Value"],
                  ["elo_diff", "Elo Gap"],
                  ["tournament", "Tournament"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSortKey(key)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: sortKey === key ? "var(--brand)" : "var(--card)",
                      color: sortKey === key ? "var(--brand-contrast)" : "var(--text)",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Probability chart */}
          {chartData.length > 0 && (
            <section className="card" style={{ padding: 16, marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 18 }}>
                Top Predictions
              </h2>
              <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 32)}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    domain={[40, 100]}
                    fontSize={12}
                  />
                  <YAxis dataKey="label" type="category" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(v: number) => [`${v.toFixed(1)}%`, "Win Prob"]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {chartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={SURFACE_COLORS[d.surface] ?? "var(--brand)"}
                        opacity={d.confidence === "high" ? 1 : d.confidence === "medium" ? 0.75 : 0.5}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Surface legend */}
              <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
                {Object.entries(SURFACE_COLORS).map(([surface, color]) => (
                  <span key={surface} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: "inline-block" }} />
                    {surface}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Match cards */}
          {filteredMatches.length > 0 && (
            <section>
              <h2 style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 18 }}>
                Match Predictions ({filteredMatches.length})
              </h2>
              {filteredMatches.map((m, i) => {
                const expanded = expandedMatch === i;
                const favA = m.prediction.prob_a >= m.prediction.prob_b;
                const bestValue = Math.max(m.market.value_a ?? -999, m.market.value_b ?? -999);
                const hasValue = bestValue > 3;

                return (
                  <div
                    key={i}
                    className="card"
                    style={{
                      padding: 14,
                      marginBottom: 10,
                      cursor: "pointer",
                      borderLeft: m.result
                        ? `4px solid ${m.result.correct ? "#16a34a" : "#dc2626"}`
                        : hasValue
                          ? "4px solid #16a34a"
                          : "4px solid transparent",
                    }}
                    onClick={() => setExpandedMatch(expanded ? null : i)}
                  >
                    {/* Tournament + surface + confidence + result row */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>{m.tour}</span>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>{m.tournament}</span>
                      <SurfacePill surface={m.surface} />
                      <ConfBadge level={m.prediction.confidence} />
                      {m.result && <ResultBadge result={m.result} />}
                      {m.match_time && !m.result && (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{m.match_time}</span>
                      )}
                    </div>

                    {/* Player names + flags + prob bar */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      {/* Player A */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 150 }}>
                        <Flag url={m.player_a.flag_url} code={m.player_a.country_code} />
                        <span style={{
                          fontWeight: favA ? 800 : 400,
                          fontSize: 15,
                          textDecoration: m.result && m.result.winner !== "a" ? "line-through" : "none",
                          opacity: m.result && m.result.winner !== "a" ? 0.5 : 1,
                        }}>
                          {m.player_a.name}
                        </span>
                      </div>

                      {/* Prob bar */}
                      <div style={{ flex: 1, minWidth: 140, maxWidth: 300 }}>
                        <ProbBar probA={m.prediction.prob_a} result={m.result} />
                      </div>

                      {/* Player B */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 150, justifyContent: "flex-end" }}>
                        <span style={{
                          fontWeight: !favA ? 800 : 400,
                          fontSize: 15,
                          textDecoration: m.result && m.result.winner !== "b" ? "line-through" : "none",
                          opacity: m.result && m.result.winner !== "b" ? 0.5 : 1,
                        }}>
                          {m.player_b.name}
                        </span>
                        <Flag url={m.player_b.flag_url} code={m.player_b.country_code} />
                      </div>
                    </div>

                    {/* Score line for completed matches */}
                    {m.result && m.result.score && (
                      <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, marginTop: 4, color: "var(--muted)" }}>
                        {m.result.winner === "a" ? m.player_a.name.split(" ").pop() : m.player_b.name.split(" ").pop()} won {formatScore(m.result.score, m.result.score_loser)}
                      </div>
                    )}

                    {/* Quick stats row */}
                    <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
                      <span>Fair: {formatOdds(m.prediction.fair_odds_a)} / {formatOdds(m.prediction.fair_odds_b)}</span>
                      {m.market.odds_a != null && (
                        <span>Market: {formatOdds(m.market.odds_a)} / {formatOdds(m.market.odds_b)}</span>
                      )}
                      {m.market.value_a != null && (
                        <span>Value: <ValueCell value={m.market.value_a} /> / <ValueCell value={m.market.value_b} /></span>
                      )}
                      {m.h2h.total > 0 && (
                        <span>H2H: {Math.round((m.h2h.pct_a ?? 50) / 100 * m.h2h.total)}-{m.h2h.total - Math.round((m.h2h.pct_a ?? 50) / 100 * m.h2h.total)}</span>
                      )}
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px solid var(--border)",
                          display: "grid",
                          gridTemplateColumns: "1fr auto 1fr",
                          gap: 8,
                          fontSize: 13,
                        }}
                      >
                        {/* Player A details */}
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{m.player_a.name}</div>
                          <div>Elo: <strong>{m.player_a.elo.toFixed(0)}</strong></div>
                          <div>Serve: <strong>{formatPct(m.player_a.serve_pct)}</strong></div>
                          <div>Return: <strong>{formatPct(m.player_a.return_pct)}</strong></div>
                          <div>Form: <strong>{formatPct(m.player_a.recent_form)}</strong></div>
                          <div>Hand: <strong>{m.player_a.hand === "R" ? "Right" : m.player_a.hand === "L" ? "Left" : "Unknown"}</strong></div>
                        </div>

                        {/* Model breakdown */}
                        <div style={{ textAlign: "center", minWidth: 120 }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>Model Breakdown</div>
                          <div>Elo: {formatPct(m.prediction.elo_prob_a)}</div>
                          <div>Point Sim: {formatPct(m.prediction.sim_prob_a)}</div>
                          <div>ML: {formatPct(m.prediction.ml_prob_a)}</div>
                          <div style={{ marginTop: 4, fontWeight: 700 }}>
                            Hybrid: {formatPct(m.prediction.prob_a)}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                            Best of {m.best_of}
                          </div>
                        </div>

                        {/* Player B details */}
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{m.player_b.name}</div>
                          <div>Elo: <strong>{m.player_b.elo.toFixed(0)}</strong></div>
                          <div>Serve: <strong>{formatPct(m.player_b.serve_pct)}</strong></div>
                          <div>Return: <strong>{formatPct(m.player_b.return_pct)}</strong></div>
                          <div>Form: <strong>{formatPct(m.player_b.recent_form)}</strong></div>
                          <div>Hand: <strong>{m.player_b.hand === "R" ? "Right" : m.player_b.hand === "L" ? "Left" : "Unknown"}</strong></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {filteredMatches.length === 0 && data && (
            <section className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
              No matches found for the selected filters.
            </section>
          )}
        </>
      )}
    </div>
  );
}
