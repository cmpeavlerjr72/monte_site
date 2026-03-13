// src/pages/NascarPredictions.tsx
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
} from "recharts";
// Driver color data in ../utils/nascarData.ts (available if needed for future features)

const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/nascar-predictions/resolve/main";

/* ── Types ─────────────────────────────────────────────────── */

interface Driver {
  predicted_position: number;
  driver_name: string;
  car_number: string;
  manufacturer: string;
  p_won: number;
  p_top3: number;
  p_top5: number;
  p_top10: number;
  composite?: number;
  win_odds?: number;
  actual_position?: number;
}

interface RacePrediction {
  source_file: string;
  season: number;
  model: string;
  drivers: Driver[];
}

interface IndexEntry {
  slug: string;
  has_predictions: boolean;
  driver_count: number;
  source_file: string;
  has_odds: boolean;
}

interface ScheduleRace {
  race_name: string;
  track_name: string;
  date: string;
  slug: string;
  completed: boolean;
}

type SortKey =
  | "predicted_position"
  | "driver_name"
  | "car_number"
  | "manufacturer"
  | "p_won"
  | "p_top3"
  | "p_top5"
  | "p_top10"
  | "win_odds"
  | "actual_position";

type ProbKey = "p_won" | "p_top3" | "p_top5" | "p_top10";

/* ── Constants ─────────────────────────────────────────────── */

const MFR_CHART_COLORS: Record<string, string> = {
  Chevrolet: "#d4a50a",
  Ford: "#003478",
  Toyota: "#c8102e",
};

const PROB_LABELS: Record<ProbKey, string> = {
  p_won: "Win",
  p_top3: "Top 3",
  p_top5: "Top 5",
  p_top10: "Top 10",
};

/* ── Helpers ───────────────────────────────────────────────── */

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function americanOdds(odds: number | undefined) {
  if (odds == null) return "-";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Car Number Badge (official NASCAR CDN images) ─────────── */

const BADGE_CDN = "https://cf.nascar.com/data/images/carbadges/1";

function CarNumber({ num }: { num: string }) {
  const [err, setErr] = useState(false);

  if (!num || err) {
    // Fallback: styled text number
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 40,
          height: 32,
          fontWeight: 900,
          fontStyle: "italic",
          fontSize: 18,
          fontFamily: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
          color: "var(--text)",
        }}
      >
        {num || "?"}
      </span>
    );
  }

  return (
    <img
      src={`${BADGE_CDN}/${num}.png`}
      alt={`#${num}`}
      onError={() => setErr(true)}
      style={{ height: 28, width: "auto", display: "block" }}
    />
  );
}

/* ── Manufacturer Logo ─────────────────────────────────────── */

const MFR_IMG: Record<string, { src: string; width: number; height: number }> = {
  Chevrolet: { src: "/nascar/chevy.png", width: 32, height: 14 },
  Ford:      { src: "/nascar/ford.png",  width: 30, height: 16 },
  Toyota:    { src: "/nascar/toyota.png", width: 30, height: 16 },
};

function MfrLogo({ manufacturer, scale = 1 }: { manufacturer: string; scale?: number }) {
  const info = MFR_IMG[manufacturer];
  if (!info) return <span style={{ fontWeight: 600, fontSize: 12 }}>{manufacturer}</span>;

  return (
    <img
      src={info.src}
      alt={manufacturer}
      style={{
        width: info.width * scale,
        height: info.height * scale,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
      }}
    />
  );
}

/* ── Sort Arrow ────────────────────────────────────────────── */

function SortArrow({ col, sortKey, sortAsc }: { col: SortKey; sortKey: SortKey; sortAsc: boolean }) {
  if (col !== sortKey) return <span style={{ opacity: 0.25, marginLeft: 2 }}>{"\u2195"}</span>;
  return <span style={{ marginLeft: 2 }}>{sortAsc ? "\u25B2" : "\u25BC"}</span>;
}

/* ── Main Component ────────────────────────────────────────── */

export default function NascarPredictions() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRace[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [prediction, setPrediction] = useState<RacePrediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartMetric, setChartMetric] = useState<ProbKey>("p_won");
  const [sortKey, setSortKey] = useState<SortKey>("predicted_position");
  const [sortAsc, setSortAsc] = useState(true);

  const season = new Date().getFullYear();

  // Fetch index + schedule in parallel
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const fetchIndex = fetch(`${DATASET_ROOT}/${season}/index.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [] as IndexEntry[]);

    const fetchSchedule = fetch(`${DATASET_ROOT}/${season}/schedule.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [] as ScheduleRace[]);

    Promise.all([fetchIndex, fetchSchedule]).then(([idx, sched]) => {
      if (cancelled) return;
      setIndex(idx);
      setSchedule(sched);

      // Default to the next upcoming race that has predictions
      const availableSlugs = new Set((idx as IndexEntry[]).map((e) => e.slug));
      const nextRace = (sched as ScheduleRace[]).find(
        (r) => !r.completed && availableSlugs.has(r.slug)
      );
      if (nextRace) {
        setSelected(nextRace.slug);
      } else if (idx.length > 0) {
        setSelected(idx[idx.length - 1].slug);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [season]);

  // Fetch predictions for selected race
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPrediction(null);

    fetch(`${DATASET_ROOT}/${season}/races/${selected}/predictions.json`, {
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Predictions not found (${r.status})`);
        return r.json();
      })
      .then((data: RacePrediction) => {
        if (!cancelled) setPrediction(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => { cancelled = true; };
  }, [selected, season]);

  // Build the race dropdown options from schedule
  const raceOptions = useMemo(() => {
    const availableSlugs = new Set(index.map((e) => e.slug));
    return schedule.map((r) => ({
      ...r,
      hasPredictions: availableSlugs.has(r.slug),
    }));
  }, [schedule, index]);

  // Current race info
  const currentRace = schedule.find((r) => r.slug === selected);

  // Sorted drivers
  const drivers = prediction?.drivers ?? [];
  const sortedDrivers = useMemo(() => {
    const sorted = [...drivers].sort((a, b) => {
      let av: string | number = a[sortKey] ?? 0;
      let bv: string | number = b[sortKey] ?? 0;
      if (sortKey === "car_number") {
        av = parseInt(a.car_number) || 999;
        bv = parseInt(b.car_number) || 999;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [drivers, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      // Default descending for probabilities, ascending for position/name
      setSortAsc(
        key === "predicted_position" ||
        key === "actual_position" ||
        key === "driver_name" ||
        key === "car_number" ||
        key === "manufacturer"
      );
    }
  };

  const hasOdds = drivers.some((d) => d.win_odds != null);
  const hasActuals = drivers.some((d) => d.actual_position != null);

  // Chart data (top 15)
  const chartData = drivers.slice(0, 15).map((d) => ({
    name: d.driver_name.split(" ").pop() ?? d.driver_name,
    fullName: d.driver_name,
    value: d[chartMetric] * 100,
    manufacturer: d.manufacturer,
  }));

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
        Loading NASCAR predictions...
      </div>
    );
  }

  if (error && !prediction) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "#b91c1c", fontWeight: 600 }}>{error}</p>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          No predictions available yet. Check back after the weekly pipeline runs.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Race selector card */}
      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          <h1 style={{ margin: 0, fontWeight: 900, fontSize: 24 }}>
            NASCAR Predictions
          </h1>

          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setError("");
            }}
            style={{ fontSize: 14, padding: "6px 10px", maxWidth: 400 }}
          >
            {raceOptions.map((r) => (
              <option
                key={r.slug}
                value={r.slug}
                disabled={!r.hasPredictions}
              >
                {formatDate(r.date)} - {r.race_name}
                {r.completed ? " (completed)" : ""}
                {!r.hasPredictions ? "" : ""}
              </option>
            ))}
          </select>
        </div>

        {currentRace && (
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
            {currentRace.track_name} &middot; {currentRace.date} &middot;{" "}
            {drivers.length} drivers &middot; Model: LightGBM + Platt calibration
          </p>
        )}
      </section>

      {/* Probability chart */}
      {drivers.length > 0 && (
        <section className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <h2 style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>
              Probability Chart
            </h2>
            <div style={{ display: "flex", gap: 4 }}>
              {(Object.keys(PROB_LABELS) as ProbKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setChartMetric(key)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background:
                      chartMetric === key ? "var(--brand)" : "var(--card)",
                    color:
                      chartMetric === key
                        ? "var(--brand-contrast)"
                        : "var(--text)",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {PROB_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={380}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                domain={[0, "auto"]}
                fontSize={12}
              />
              <YAxis
                dataKey="name"
                type="category"
                width={100}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(v: number) => [`${v.toFixed(1)}%`, PROB_LABELS[chartMetric]]}
                labelFormatter={(label: string, payload: readonly any[]) =>
                  payload?.[0]?.payload?.fullName ?? label
                }
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={MFR_CHART_COLORS[d.manufacturer] ?? "var(--brand)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Manufacturer legend */}
          <div
            style={{
              display: "flex",
              gap: 16,
              justifyContent: "center",
              marginTop: 8,
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            {Object.entries(MFR_CHART_COLORS).map(([mfr, color]) => (
              <span key={mfr} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: color,
                    display: "inline-block",
                  }}
                />
                <MfrLogo manufacturer={mfr} scale={1.2} />
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Full predictions table */}
      {drivers.length > 0 && (
        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 18 }}>
            Full Predictions
          </h2>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
            Click any column header to sort
          </p>

          <div className="table-scroll">
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                  <Th col="predicted_position" label="Pred" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} />
                  {hasActuals && (
                    <Th col="actual_position" label="Finish" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} />
                  )}
                  {hasActuals && (
                    <th style={{ ...thStyle, textAlign: "center" }}>+/-</th>
                  )}
                  <Th col="car_number" label="Car" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} />
                  <Th col="driver_name" label="Driver" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} />
                  <Th col="manufacturer" label="MFR" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} />
                  <Th col="p_won" label="Win%" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} align="right" />
                  <Th col="p_top3" label="Top 3%" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} align="right" />
                  <Th col="p_top5" label="Top 5%" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} align="right" />
                  <Th col="p_top10" label="Top 10%" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} align="right" />
                  {hasOdds && (
                    <Th col="win_odds" label="Odds" sortKey={sortKey} sortAsc={sortAsc} onClick={handleSort} align="right" />
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedDrivers.map((d, i) => (
                  <tr
                    key={d.driver_name}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "var(--card)" : "var(--bg)",
                    }}
                  >
                    <td style={tdStyle}>{d.predicted_position}</td>
                    {hasActuals && (
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {d.actual_position ?? "-"}
                      </td>
                    )}
                    {hasActuals && (() => {
                      const diff = d.actual_position != null
                        ? d.predicted_position - d.actual_position
                        : null;
                      const color = diff == null ? "var(--muted)"
                        : diff > 0 ? "#16a34a"
                        : diff < 0 ? "#dc2626"
                        : "var(--muted)";
                      const label = diff == null ? "-"
                        : diff > 0 ? `+${diff}`
                        : diff === 0 ? "="
                        : `${diff}`;
                      return (
                        <td style={{ ...tdStyle, textAlign: "center", color, fontWeight: 600, fontSize: 13 }}>
                          {label}
                        </td>
                      );
                    })()}
                    <td style={{ ...tdStyle, padding: "4px 6px" }}>
                      <CarNumber num={d.car_number} />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{d.driver_name}</td>
                    <td style={{ ...tdStyle, verticalAlign: "middle" }}>
                      <MfrLogo manufacturer={d.manufacturer} />
                    </td>
                    <td style={tdRight}>{pct(d.p_won)}</td>
                    <td style={tdRight}>{pct(d.p_top3)}</td>
                    <td style={tdRight}>{pct(d.p_top5)}</td>
                    <td style={tdRight}>{pct(d.p_top10)}</td>
                    {hasOdds && <td style={tdRight}>{americanOdds(d.win_odds)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Sortable Table Header ─────────────────────────────────── */

function Th({
  col,
  label,
  sortKey,
  sortAsc,
  onClick,
  align = "left",
}: {
  col: SortKey;
  label: string;
  sortKey: SortKey;
  sortAsc: boolean;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={() => onClick(col)}
      style={{
        ...thStyle,
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
      <SortArrow col={col} sortKey={sortKey} sortAsc={sortAsc} />
    </th>
  );
}

/* ── Style constants ───────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  fontWeight: 700,
  fontSize: 13,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 6px",
  whiteSpace: "nowrap",
};

const tdRight: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
