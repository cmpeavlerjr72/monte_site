// src/pages/NascarLive.tsx
import { useEffect, useMemo, useState } from "react";
import {
  useNascarLive,
  getFlagInfo,
  SERIES_NAMES,
  type LiveVehicle,
  type LiveFeed,
  type LivePitEntry,
} from "../lib/useNascarLive";
import { getCarColors } from "../utils/nascarData";

/* ── Constants ─────────────────────────────────────────────── */

const MFR_IMG: Record<string, { src: string; w: number; h: number }> = {
  Chevrolet: { src: "/nascar/chevy.png", w: 28, h: 12 },
  Ford:      { src: "/nascar/ford.png",  w: 26, h: 14 },
  Toyota:    { src: "/nascar/toyota.png", w: 26, h: 14 },
};

const BADGE_CDN: Record<number, string> = {
  1: "https://cf.nascar.com/data/images/carbadges/1",
  2: "https://cf.nascar.com/data/images/carbadges/2",
  3: "https://cf.nascar.com/data/images/carbadges/3",
};

/* ── Helpers ───────────────────────────────────────────────── */

function formatLapTime(t: number) {
  if (!t || t <= 0) return "-";
  if (t > 200) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(3);
    return `${m}:${parseFloat(s) < 10 ? "0" : ""}${s}`;
  }
  return t.toFixed(3);
}

function formatDelta(d: number) {
  if (!d || d === 0) return "Leader";
  if (d < 0) return `${d.toFixed(3)}`;
  return `+${d.toFixed(3)}`;
}

function posChange(start: number, current: number) {
  const diff = start - current;
  if (diff === 0) return { label: "-", color: "var(--muted)" };
  if (diff > 0) return { label: `+${diff}`, color: "#16a34a" };
  return { label: `${diff}`, color: "#dc2626" };
}

function totalLapsLed(v: LiveVehicle): number {
  return v.laps_led.reduce((sum, l) => sum + (l.end_lap - l.start_lap + 1), 0);
}

function tiresLabel(entry: LivePitEntry): string {
  const count = [
    entry.left_front_tire_changed,
    entry.left_rear_tire_changed,
    entry.right_front_tire_changed,
    entry.right_rear_tire_changed,
  ].filter(Boolean).length;
  if (count === 4) return "4 tires";
  if (count === 2) {
    if (entry.right_front_tire_changed && entry.right_rear_tire_changed) return "2 R";
    if (entry.left_front_tire_changed && entry.left_rear_tire_changed) return "2 L";
    return `${count} tires`;
  }
  if (count === 0) return "None";
  return `${count} tire${count > 1 ? "s" : ""}`;
}

/* ── Sub-components ────────────────────────────────────────── */

function CarBadge({ num, seriesId }: { num: string; seriesId: number }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [num, seriesId]);
  const cdn = BADGE_CDN[seriesId] || BADGE_CDN[1];

  if (!num || err) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 36, height: 28, fontWeight: 900, fontStyle: "italic", fontSize: 16,
        fontFamily: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
        color: "var(--text)",
      }}>
        {num || "?"}
      </span>
    );
  }
  return (
    <img
      src={`${cdn}/${num}.png`}
      alt={`#${num}`}
      onError={() => setErr(true)}
      style={{ height: 24, width: "auto", display: "block" }}
    />
  );
}

function MfrLogo({ mfr }: { mfr: string }) {
  const info = MFR_IMG[mfr];
  if (!info) return <span style={{ fontSize: 11, fontWeight: 600 }}>{mfr}</span>;
  return <img src={info.src} alt={mfr} style={{ width: info.w, height: info.h, objectFit: "contain" }} />;
}

function FlagBadge({ state }: { state: number }) {
  const f = getFlagInfo(state);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 12px", borderRadius: 6,
      background: f.bg, color: f.color,
      fontWeight: 800, fontSize: 13, letterSpacing: 0.5,
      border: state === 4 ? "2px solid #555" : state === 8 ? "2px solid #999" : "none",
    }}>
      {state === 4 && <span style={{ fontSize: 16 }}>{"\u2691"}</span>}
      {f.label.toUpperCase()}
    </span>
  );
}

function ProgressBar({ lap, total, stage }: { lap: number; total: number; stage: LiveFeed["stage"] }) {
  const pct = total > 0 ? Math.min((lap / total) * 100, 100) : 0;
  const stagePct = stage && stage.finish_at_lap > 0
    ? Math.min((stage.finish_at_lap / total) * 100, 100)
    : null;

  return (
    <div style={{ position: "relative", height: 18, background: "var(--border)", borderRadius: 9, overflow: "hidden", flex: 1, minWidth: 120 }}>
      <div style={{
        height: "100%", borderRadius: 9,
        background: "linear-gradient(90deg, var(--brand) 0%, #16a34a 100%)",
        width: `${pct}%`, transition: "width 0.5s ease",
      }} />
      {stagePct != null && (
        <div style={{
          position: "absolute", top: 0, left: `${stagePct}%`,
          width: 2, height: "100%", background: "var(--text)", opacity: 0.5,
        }} />
      )}
      <span style={{
        position: "absolute", top: 0, left: 0, right: 0,
        textAlign: "center", fontSize: 11, fontWeight: 700,
        lineHeight: "18px", color: "#fff",
        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
      }}>
        Lap {lap} / {total}
        {stage && stage.stage_num > 0 && ` (Stage ${stage.stage_num} ends lap ${stage.finish_at_lap})`}
      </span>
    </div>
  );
}

/* ── Pit Data Panel ────────────────────────────────────────── */

function PitPanel({ pitData, driverFilter }: { pitData: LivePitEntry[]; driverFilter: string | null }) {
  const filtered = useMemo(() => {
    const data = driverFilter
      ? pitData.filter(p => p.vehicle_number === driverFilter)
      : pitData;
    // most recent first
    return [...data].reverse();
  }, [pitData, driverFilter]);

  if (filtered.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>No pit stop data available.</p>;
  }

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
            <th style={thSm}>Car</th>
            <th style={thSm}>Driver</th>
            <th style={thSm}>Lap</th>
            <th style={{ ...thSm, textAlign: "right" }}>Duration</th>
            <th style={thSm}>Tires</th>
            <th style={{ ...thSm, textAlign: "center" }}>Pos +/-</th>
            <th style={{ ...thSm, textAlign: "right" }}>In Rank</th>
            <th style={{ ...thSm, textAlign: "right" }}>Out Rank</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 50).map((p, i) => {
            const posGain = p.positions_gained_lost;
            const posColor = posGain > 0 ? "#16a34a" : posGain < 0 ? "#dc2626" : "var(--muted)";
            const posLabel = posGain > 0 ? `+${posGain}` : posGain === 0 ? "-" : `${posGain}`;
            return (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--card)" : "var(--bg)" }}>
                <td style={tdSm}>{p.vehicle_number}</td>
                <td style={tdSm}>{p.driver_name}</td>
                <td style={tdSm}>{p.lap_count}</td>
                <td style={{ ...tdSm, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.pit_stop_duration.toFixed(1)}s</td>
                <td style={tdSm}>{tiresLabel(p)}</td>
                <td style={{ ...tdSm, textAlign: "center", color: posColor, fontWeight: 600 }}>{posLabel}</td>
                <td style={{ ...tdSm, textAlign: "right" }}>P{p.pit_in_rank}</td>
                <td style={{ ...tdSm, textAlign: "right" }}>P{p.pit_out_rank}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */

export default function NascarLive() {
  const { feed, pitData, loading, error, lastUpdate, fetchPitData } = useNascarLive();
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [showPits, setShowPits] = useState(false);
  const [pitLoading, setPitLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"leaderboard" | "stats">("leaderboard");

  const isRaceActive = feed != null && feed.vehicles.length > 0;
  const seriesName = feed ? (SERIES_NAMES[feed.series_id] ?? `Series ${feed.series_id}`) : "";

  const handlePitToggle = async () => {
    if (!showPits && pitData.length === 0) {
      setPitLoading(true);
      await fetchPitData();
      setPitLoading(false);
    }
    setShowPits(v => !v);
  };

  // Refresh pit data when pit panel is open (every 30s)
  useEffect(() => {
    if (!showPits) return;
    const id = setInterval(fetchPitData, 30_000);
    return () => clearInterval(id);
  }, [showPits, fetchPitData]);

  /* ── Loading state ──────────────────────────────── */
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Connecting to NASCAR Live Feed...</div>
        <div style={{ fontSize: 13 }}>Fetching data from NASCAR CDN</div>
      </div>
    );
  }

  /* ── No race active ─────────────────────────────── */
  if (!isRaceActive) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>{"\u2691"}</div>
        <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>No Race Currently Active</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, maxWidth: 400, margin: "0 auto" }}>
          The live feed updates when a NASCAR Cup, Xfinity, or Truck Series session is running.
          Check back during race weekend for live data.
        </p>
        {error && (
          <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
        {lastUpdate && (
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
            Last checked: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </div>
    );
  }

  /* ── Race active ────────────────────────────────── */
  const flag = getFlagInfo(feed!.flag_state);
  const vehicles = feed!.vehicles;
  const leader = vehicles[0];

  return (
    <div>
      {/* Race header card */}
      <section className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <FlagBadge state={feed!.flag_state} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: 0, fontWeight: 900, fontSize: 20, lineHeight: 1.2 }}>
              {feed!.run_name || "Live Race"}
            </h1>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>
              {seriesName} &middot; {feed!.track_name}
              {feed!.track_length > 0 && ` (${feed!.track_length} mi)`}
            </p>
          </div>
          {lastUpdate && (
            <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <ProgressBar lap={feed!.lap_number} total={feed!.laps_in_race} stage={feed!.stage} />

        {/* Race stats row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
          <Stat label="Laps to Go" value={feed!.laps_to_go} />
          <Stat label="Lead Changes" value={feed!.number_of_lead_changes} />
          <Stat label="Leaders" value={feed!.number_of_leaders} />
          <Stat label="Cautions" value={`${feed!.number_of_caution_segments} (${feed!.number_of_caution_laps} laps)`} />
          <Stat label="Cars" value={vehicles.length} />
        </div>
      </section>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <TabBtn active={viewMode === "leaderboard"} onClick={() => setViewMode("leaderboard")}>Leaderboard</TabBtn>
          <TabBtn active={viewMode === "stats"} onClick={() => setViewMode("stats")}>Extended Stats</TabBtn>
        </div>
        <button
          onClick={handlePitToggle}
          style={{
            padding: "5px 14px", borderRadius: 8,
            border: "1px solid var(--border)",
            background: showPits ? "var(--brand)" : "var(--card)",
            color: showPits ? "var(--brand-contrast)" : "var(--text)",
            cursor: "pointer", fontWeight: 700, fontSize: 13,
          }}
        >
          {pitLoading ? "Loading..." : showPits ? "Hide Pit Stops" : "Pit Stops"}
        </button>
      </div>

      {/* Pit data panel */}
      {showPits && (
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <h2 style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 16 }}>
            Pit Stops
            {expandedDriver && (
              <button
                onClick={() => setExpandedDriver(null)}
                style={{
                  marginLeft: 8, fontSize: 12, padding: "2px 8px",
                  borderRadius: 4, border: "1px solid var(--border)",
                  background: "var(--bg)", color: "var(--text)", cursor: "pointer",
                }}
              >
                Show All
              </button>
            )}
          </h2>
          <PitPanel pitData={pitData} driverFilter={expandedDriver} />
        </section>
      )}

      {/* Leaderboard */}
      <section className="card" style={{ padding: 0 }}>
        <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                <th style={{ ...thSm, width: 36, textAlign: "center" }}>Pos</th>
                <th style={{ ...thSm, width: 40 }}>Car</th>
                <th style={thSm}>Driver</th>
                <th style={{ ...thSm, width: 30 }}>MFR</th>
                {viewMode === "leaderboard" ? (
                  <>
                    <th style={{ ...thSm, textAlign: "right" }}>Delta</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Last Lap</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Best Lap</th>
                    <th style={{ ...thSm, textAlign: "center" }}>+/-</th>
                    <th style={{ ...thSm, textAlign: "center" }}>Pits</th>
                    <th style={{ ...thSm, textAlign: "center" }}>Status</th>
                  </>
                ) : (
                  <>
                    <th style={{ ...thSm, textAlign: "right" }}>Avg Pos</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Avg Speed</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Passes</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Quality</th>
                    <th style={{ ...thSm, textAlign: "right" }}>+/- Diff</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Laps Led</th>
                    <th style={{ ...thSm, textAlign: "right" }}>Last 10%</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, i) => (
                <LeaderboardRow
                  key={v.vehicle_number}
                  v={v}
                  i={i}
                  seriesId={feed!.series_id}
                  viewMode={viewMode}
                  onPitClick={() => {
                    setExpandedDriver(v.vehicle_number);
                    if (!showPits) handlePitToggle();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ── Row component (avoids re-render of entire table) ──── */

function LeaderboardRow({ v, i, seriesId, viewMode, onPitClick }: {
  v: LiveVehicle; i: number; seriesId: number;
  viewMode: "leaderboard" | "stats";
  onPitClick: () => void;
}) {
  const colors = getCarColors(v.vehicle_number, v.vehicle_manufacturer);
  const pos = posChange(v.starting_position, v.running_position);
  const isLeader = v.running_position === 1;
  const isOffTrack = !v.is_on_track;
  const rowOpacity = isOffTrack ? 0.5 : 1;

  const statusLabel = v.is_on_dvp
    ? "DVP"
    : v.status === "Running"
      ? v.is_on_track ? "" : "Garage"
      : v.status || "";

  return (
    <tr style={{
      borderBottom: "1px solid var(--border)",
      background: i % 2 === 0 ? "var(--card)" : "var(--bg)",
      opacity: rowOpacity,
    }}>
      {/* Position with color accent */}
      <td style={{ ...tdSm, textAlign: "center", fontWeight: 800, position: "relative" }}>
        <span style={{
          position: "absolute", left: 0, top: 2, bottom: 2, width: 3,
          borderRadius: 2, background: colors.bg,
        }} />
        {v.running_position}
      </td>
      <td style={{ ...tdSm, padding: "3px 4px" }}>
        <CarBadge num={v.vehicle_number} seriesId={seriesId} />
      </td>
      <td style={{ ...tdSm, fontWeight: 600, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
        {v.driver.full_name}
      </td>
      <td style={{ ...tdSm, verticalAlign: "middle" }}>
        <MfrLogo mfr={v.vehicle_manufacturer} />
      </td>

      {viewMode === "leaderboard" ? (
        <>
          <td style={{ ...tdSm, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: isLeader ? 700 : 400 }}>
            {isLeader ? "Leader" : v.delta > 0 ? `+${v.delta.toFixed(3)}` : formatDelta(v.delta)}
          </td>
          <td style={{ ...tdSm, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {formatLapTime(v.last_lap_time)}
          </td>
          <td style={{ ...tdSm, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {formatLapTime(v.best_lap_time)}
          </td>
          <td style={{ ...tdSm, textAlign: "center", color: pos.color, fontWeight: 600 }}>
            {pos.label}
          </td>
          <td style={{ ...tdSm, textAlign: "center" }}>
            <button
              onClick={onPitClick}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--brand)", fontWeight: 700, fontSize: 13,
                padding: "0 4px", textDecoration: v.pit_stops.length > 0 ? "underline" : "none",
              }}
            >
              {v.pit_stops.length}
            </button>
          </td>
          <td style={{ ...tdSm, textAlign: "center", fontSize: 11 }}>
            {statusLabel && (
              <span style={{
                padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: v.is_on_dvp ? "#dc262620" : "#55555520",
                color: v.is_on_dvp ? "#dc2626" : "var(--muted)",
              }}>
                {statusLabel}
              </span>
            )}
          </td>
        </>
      ) : (
        <>
          <td style={{ ...tdSm, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {v.average_running_position.toFixed(1)}
          </td>
          <td style={{ ...tdSm, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {v.average_speed > 0 ? v.average_speed.toFixed(1) : "-"}
          </td>
          <td style={{ ...tdSm, textAlign: "right" }}>{v.passes_made}</td>
          <td style={{ ...tdSm, textAlign: "right" }}>{v.quality_passes}</td>
          <td style={{
            ...tdSm, textAlign: "right", fontWeight: 600,
            color: v.passing_differential > 0 ? "#16a34a" : v.passing_differential < 0 ? "#dc2626" : "var(--muted)",
          }}>
            {v.passing_differential > 0 ? `+${v.passing_differential}` : v.passing_differential}
          </td>
          <td style={{ ...tdSm, textAlign: "right", fontWeight: totalLapsLed(v) > 0 ? 700 : 400 }}>
            {totalLapsLed(v) || "-"}
          </td>
          <td style={{
            ...tdSm, textAlign: "right",
            color: v.position_differential_last_10_percent > 0 ? "#16a34a" : v.position_differential_last_10_percent < 0 ? "#dc2626" : "var(--muted)",
            fontWeight: 600,
          }}>
            {v.position_differential_last_10_percent > 0 ? `+${v.position_differential_last_10_percent}` : v.position_differential_last_10_percent || "-"}
          </td>
        </>
      )}
    </tr>
  );
}

/* ── Tiny reusable pieces ─────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <span style={{ fontWeight: 700, color: "var(--text)" }}>{value}</span>{" "}
      <span>{label}</span>
    </span>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 14px", borderRadius: 8,
        border: "1px solid var(--border)",
        background: active ? "var(--brand)" : "var(--card)",
        color: active ? "var(--brand-contrast)" : "var(--text)",
        cursor: "pointer", fontWeight: 700, fontSize: 13,
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

/* ── Style constants ──────────────────────────────────────── */

const thSm: React.CSSProperties = {
  padding: "8px 6px", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap",
};

const tdSm: React.CSSProperties = {
  padding: "6px 6px", whiteSpace: "nowrap",
};
