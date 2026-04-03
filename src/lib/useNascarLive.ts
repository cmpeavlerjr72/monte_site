// src/lib/useNascarLive.ts
// Custom hook that polls NASCAR CDN live endpoints directly from the browser.
// All bandwidth goes to cf.nascar.com — zero Render traffic for live data.

import { useEffect, useRef, useState, useCallback } from "react";

const CDN = "https://cf.nascar.com/cacher";

/* ── Types ─────────────────────────────────────────────────── */

export interface LiveDriver {
  driver_id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  is_in_chase: boolean;
}

export interface PitStop {
  positions_gained_lossed: number;
  pit_in_elapsed_time: number;
  pit_in_lap_count: number;
  pit_in_leader_lap: number;
  pit_out_elapsed_time: number;
  pit_in_rank: number;
  pit_out_rank: number;
}

export interface LapsLed {
  start_lap: number;
  end_lap: number;
}

export interface LiveVehicle {
  vehicle_number: string;
  vehicle_manufacturer: string;
  sponsor_name: string;
  driver: LiveDriver;
  running_position: number;
  starting_position: number;
  laps_completed: number;
  last_lap_time: number;
  last_lap_speed: number;
  best_lap_time: number;
  best_lap_speed: number;
  average_speed: number;
  average_running_position: number;
  average_restart_speed: number;
  delta: number;
  status: string;
  is_on_track: boolean;
  is_on_dvp: boolean;
  passes_made: number;
  times_passed: number;
  quality_passes: number;
  passing_differential: number;
  position_differential_last_10_percent: number;
  fastest_laps_run: number;
  laps_position_improved: number;
  laps_led: LapsLed[];
  pit_stops: PitStop[];
  qualifying_status: string;
}

export interface LiveStage {
  stage_num: number;
  finish_at_lap: number;
  laps_in_stage: number;
}

export interface LiveFeed {
  lap_number: number;
  elapsed_time: string;
  flag_state: number;
  race_id: number;
  laps_in_race: number;
  laps_to_go: number;
  vehicles: LiveVehicle[];
  run_id: number;
  run_name: string;
  series_id: number;
  time_of_day: string;
  time_of_day_os: string;
  track_id: number;
  track_name: string;
  track_length: number;
  run_type: number;
  number_of_caution_segments: number;
  number_of_caution_laps: number;
  number_of_lead_changes: number;
  number_of_leaders: number;
  stage: LiveStage;
}

export interface LivePitEntry {
  vehicle_number: string;
  driver_name: string;
  vehicle_manufacturer: string;
  leader_lap: number;
  lap_count: number;
  pit_in_flag_status: number;
  pit_out_flag_status: number;
  pit_in_race_time: number;
  pit_out_race_time: number;
  total_duration: number;
  pit_stop_duration: number;
  in_travel_duration: number;
  out_travel_duration: number;
  pit_stop_type: string;
  left_front_tire_changed: boolean;
  left_rear_tire_changed: boolean;
  right_front_tire_changed: boolean;
  right_rear_tire_changed: boolean;
  previous_lap_time: number;
  next_lap_time: number;
  pit_in_rank: number;
  pit_out_rank: number;
  positions_gained_lost: number;
}

/* ── Flag state constants ─────────────────────────────────── */

export const FLAG_STATES: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: "Pre-Race",   color: "#fff",    bg: "#555"    },
  1: { label: "Green",      color: "#fff",    bg: "#16a34a" },
  2: { label: "Yellow",     color: "#1a1a1a", bg: "#eab308" },
  3: { label: "Red",        color: "#fff",    bg: "#dc2626" },
  4: { label: "Checkered",  color: "#fff",    bg: "#1a1a1a" },
  8: { label: "White",      color: "#1a1a1a", bg: "#f5f5f5" },
  9: { label: "Warm-Up",    color: "#fff",    bg: "#555"    },
};

export function getFlagInfo(state: number) {
  return FLAG_STATES[state] ?? { label: `Flag ${state}`, color: "#fff", bg: "#555" };
}

/* ── Series name helpers ──────────────────────────────────── */

export const SERIES_NAMES: Record<number, string> = {
  1: "Cup Series",
  2: "Xfinity Series",
  3: "Craftsman Truck Series",
};

/* ── Polling intervals (ms) ───────────────────────────────── */

const INTERVAL_GREEN   = 10_000;  // 10s during green flag
const INTERVAL_CAUTION = 15_000;  // 15s during caution
const INTERVAL_IDLE    = 30_000;  // 30s when no race / pre-race / checkered

function getInterval(flagState: number | null): number {
  if (flagState === 1) return INTERVAL_GREEN;
  if (flagState === 2) return INTERVAL_CAUTION;
  return INTERVAL_IDLE;
}

/* ── Hook ─────────────────────────────────────────────────── */

export function useNascarLive() {
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [pitData, setPitData] = useState<LivePitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const flagRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`${CDN}/live/live-feed.json`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Feed ${res.status}`);
      const data: LiveFeed = await res.json();
      if (!mountedRef.current) return;

      // Sort vehicles by running position
      data.vehicles.sort((a, b) => a.running_position - b.running_position);

      setFeed(data);
      setError("");
      setLastUpdate(new Date());
      setLoading(false);
      flagRef.current = data.flag_state;
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e.message);
      setLoading(false);
      flagRef.current = null;
    }
  }, []);

  const fetchPitData = useCallback(async () => {
    try {
      const res = await fetch(`${CDN}/live/live-pit-data.json`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: LivePitEntry[] = await res.json();
      if (mountedRef.current) setPitData(data);
    } catch {
      // non-critical — silently ignore
    }
  }, []);

  // Main polling loop
  useEffect(() => {
    mountedRef.current = true;

    const poll = async () => {
      await fetchFeed();
      if (!mountedRef.current) return;
      const interval = getInterval(flagRef.current);
      timerRef.current = setTimeout(poll, interval);
    };

    poll();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchFeed]);

  return { feed, pitData, loading, error, lastUpdate, fetchPitData };
}
