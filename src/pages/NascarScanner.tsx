// src/pages/NascarScanner.tsx
//
// Live NASCAR Scanner — streams driver comms directly from NASCAR's CDN.
// All audio flows browser → sa.aws.nascar.com (zero bandwidth on our server).
// Audio mapping JSON fetched from cf.nascar.com (also zero cost to us).

import { useCallback, useEffect, useRef, useState } from "react";

/* ── NASCAR Audio Mapping API ─────────────────────────────── */

const AUDIO_MAPPING_URL =
  "https://cf.nascar.com/config/audio/audio_mapping_{series}_3.json";

type SeriesKey = "cup" | "xfinity" | "trucks";

const SERIES_MAP: Record<SeriesKey, { id: number; label: string }> = {
  cup:     { id: 1, label: "Cup Series" },
  xfinity: { id: 2, label: "Xfinity Series" },
  trucks:  { id: 3, label: "Craftsman Truck Series" },
};

const SERIES_KEYS: SeriesKey[] = ["cup", "xfinity", "trucks"];

interface AudioEntry {
  stream_number: number;
  driver_number: string;
  driver_name: string;
  base_url: string;
  stream_ios: string;
  requiresAuth: boolean;
}

interface AudioMapping {
  historical_race_id: number;
  race_name: string;
  series_id: number;
  disable_scanner: string;
  audio_config: AudioEntry[];
}

/* ── Helpers ──────────────────────────────────────────────── */

const SPECIAL_CHANNELS = new Set(["All Scan", "MRN", "NRN", "Officials"]);

const CAR_BADGE_CDN: Record<SeriesKey, string> = {
  cup:     "https://cf.nascar.com/data/images/carbadges/1",
  xfinity: "https://cf.nascar.com/data/images/carbadges/2",
  trucks:  "https://cf.nascar.com/data/images/carbadges/3",
};

/* ── Component ────────────────────────────────────────────── */

export default function NascarScanner() {
  const [series, setSeries] = useState<SeriesKey>("cup");
  const [mapping, setMapping] = useState<AudioMapping | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStream, setActiveStream] = useState<AudioEntry | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [delay, setDelay] = useState(0); // seconds behind live edge (TV sync)
  const [search, setSearch] = useState("");
  const [badgeErrors, setBadgeErrors] = useState<Set<string>>(new Set());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<any>(null);
  const hlsJsLoaded = useRef(false);

  // Load hls.js from CDN once
  useEffect(() => {
    if (hlsJsLoaded.current) return;
    if ((window as any).Hls) { hlsJsLoaded.current = true; return; }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
    script.onload = () => { hlsJsLoaded.current = true; };
    document.head.appendChild(script);
  }, []);

  // Fetch audio mapping when series changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMapping(null);
    stopPlayback();

    const url = AUDIO_MAPPING_URL.replace("{series}", String(SERIES_MAP[series].id));
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: AudioMapping) => {
        if (!cancelled) {
          setMapping(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [series]);

  // Reset badge errors when series changes
  useEffect(() => setBadgeErrors(new Set()), [series]);

  // Volume sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  const stopPlayback = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setPlaying(false);
    setActiveStream(null);
  }, []);

  // Build hls.js config based on current delay.
  // Each HLS segment is ~2s. liveSyncDurationCount = how many segments behind
  // the live edge to target. liveMaxLatencyDurationCount is the ceiling before
  // hls.js jumps forward to catch up.
  const hlsConfig = useCallback((delaySec: number) => {
    const segmentDuration = 2; // ~2s per AAC segment
    const baseSegments = 2;    // minimum buffer even at 0 delay
    const delaySegments = Math.ceil(delaySec / segmentDuration);
    return {
      liveSyncDurationCount: baseSegments + delaySegments,
      liveMaxLatencyDurationCount: baseSegments + delaySegments + 3,
      enableWorker: true,
      lowLatencyMode: delaySec === 0,
    };
  }, []);

  const playStream = useCallback((entry: AudioEntry) => {
    const Hls = (window as any).Hls;
    const audio = audioRef.current;
    if (!audio) return;

    // Stop current
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    audio.pause();

    const url = entry.base_url + entry.stream_ios;
    setActiveStream(entry);
    setPlaying(true);

    if (Hls && Hls.isSupported()) {
      const hls = new Hls(hlsConfig(delay));
      hls.loadSource(url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        audio.volume = volume / 100;
        audio.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) {
          setPlaying(false);
          setError("Stream offline or unavailable");
        }
      });
      hlsRef.current = hls;
    } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS — no delay control available
      audio.src = url;
      audio.volume = volume / 100;
      audio.play().catch(() => {});
    } else {
      setError("Your browser does not support HLS audio playback.");
      setPlaying(false);
    }
  }, [volume, delay, hlsConfig]);

  // When delay changes mid-playback, reconfigure hls.js
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || !playing) return;

    const cfg = hlsConfig(delay);
    hls.config.liveSyncDurationCount = cfg.liveSyncDurationCount;
    hls.config.liveMaxLatencyDurationCount = cfg.liveMaxLatencyDurationCount;
    hls.config.lowLatencyMode = cfg.lowLatencyMode;
    // Nudge playback position to match new delay target
    const audio = audioRef.current;
    if (audio && hls.liveSyncPosition != null) {
      const target = hls.liveSyncPosition;
      if (Math.abs(audio.currentTime - target) > 3) {
        audio.currentTime = target;
      }
    }
  }, [delay, playing, hlsConfig]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, []);

  const configs = mapping?.audio_config ?? [];
  const disabled = mapping?.disable_scanner !== "off" && mapping?.disable_scanner != null;

  // Filter by search
  const filtered = configs.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.driver_name.toLowerCase().includes(q) ||
      c.driver_number.toLowerCase().includes(q)
    );
  });

  // Split into drivers vs special channels
  const driverStreams = filtered.filter((c) => !SPECIAL_CHANNELS.has(c.driver_name));
  const specialStreams = filtered.filter((c) => SPECIAL_CHANNELS.has(c.driver_name));

  const activeLabel = activeStream
    ? SPECIAL_CHANNELS.has(activeStream.driver_name)
      ? activeStream.driver_name
      : `#${activeStream.driver_number} ${activeStream.driver_name}`
    : null;

  return (
    <div>
      <audio ref={audioRef} />

      {/* Header card */}
      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontWeight: 900, fontSize: 24 }}>
            NASCAR Scanner
          </h1>

          {/* Series pills */}
          <div style={{ display: "flex", gap: 4 }}>
            {SERIES_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSeries(key)}
                style={{
                  padding: "5px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: series === key ? "var(--brand)" : "var(--card)",
                  color: series === key ? "var(--brand-contrast)" : "var(--text)",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {SERIES_MAP[key].label}
              </button>
            ))}
          </div>
        </div>

        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
          Live driver &amp; crew chief radio — audio streams directly from NASCAR
          {mapping && <> &middot; Race ID: {mapping.historical_race_id} &middot; {configs.length} channels</>}
        </p>

        {disabled && (
          <p style={{ margin: "8px 0 0", color: "#b91c1c", fontWeight: 600, fontSize: 14 }}>
            Scanner is currently disabled for this session.
          </p>
        )}
      </section>

      {/* Now Playing bar */}
      <section
        className="card"
        style={{
          padding: "12px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* Live dot */}
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: playing ? "#e10600" : "var(--border)",
            animation: playing ? "scanner-pulse 1.5s infinite" : "none",
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 15, minWidth: 120 }}>
          {playing ? activeLabel : "Not playing"}
        </span>

        <button
          onClick={stopPlayback}
          disabled={!playing}
          style={{
            padding: "6px 16px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: playing ? "var(--brand)" : "var(--card)",
            color: playing ? "var(--brand-contrast)" : "var(--muted)",
            cursor: playing ? "pointer" : "default",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Stop
        </button>

        {/* TV Sync delay */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            TV Sync
          </span>
          <div style={{ display: "flex", gap: 2 }}>
            {[0, 10, 20, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDelay(d)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: delay === d ? "var(--brand)" : "var(--card)",
                  color: delay === d ? "var(--brand-contrast)" : "var(--text)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                {d === 0 ? "Live" : `${d}s`}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={2}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            style={{ width: 80, accentColor: "var(--brand)" }}
          />
          <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 28, textAlign: "right" }}>
            {delay === 0 ? "Live" : `-${delay}s`}
          </span>
        </div>

        {/* Volume */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Vol</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: 100, accentColor: "var(--brand)" }}
          />
        </div>
      </section>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search driver or car number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", maxWidth: 360, padding: "8px 12px", fontSize: 14 }}
        />
      </div>

      {loading && (
        <p style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          Loading scanner feeds...
        </p>
      )}

      {error && !loading && (
        <p style={{ color: "#b91c1c", padding: "12px 0", fontSize: 14 }}>
          {error}
        </p>
      )}

      {/* Special channels */}
      {specialStreams.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {specialStreams.map((c) => (
            <button
              key={c.stream_number}
              onClick={() => playStream(c)}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: `2px solid ${activeStream?.stream_number === c.stream_number ? "var(--brand)" : "var(--border)"}`,
                background: activeStream?.stream_number === c.stream_number ? "var(--brand)" : "var(--card)",
                color: activeStream?.stream_number === c.stream_number ? "var(--brand-contrast)" : "var(--text)",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 14,
                transition: "all 0.15s",
              }}
            >
              {c.driver_name === "MRN" || c.driver_name === "NRN"
                ? `${c.driver_name} Radio`
                : c.driver_name}
              {!c.requiresAuth && (
                <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>FREE</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Driver grid */}
      {driverStreams.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 8,
          }}
        >
          {driverStreams.map((c) => {
            const isActive = activeStream?.stream_number === c.stream_number;
            const showBadge = !badgeErrors.has(c.driver_number);
            return (
              <button
                key={c.stream_number}
                onClick={() => playStream(c)}
                className="card"
                style={{
                  padding: 12,
                  cursor: "pointer",
                  border: `2px solid ${isActive ? "var(--brand)" : "var(--border)"}`,
                  background: isActive ? "color-mix(in oklab, var(--brand) 10%, var(--card))" : "var(--card)",
                  borderRadius: 12,
                  textAlign: "left",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {/* Car number badge or fallback */}
                {showBadge ? (
                  <img
                    src={`${CAR_BADGE_CDN[series]}/${c.driver_number}.png`}
                    alt={`#${c.driver_number}`}
                    onError={() =>
                      setBadgeErrors((prev) => new Set(prev).add(c.driver_number))
                    }
                    style={{ height: 32, width: "auto", flexShrink: 0 }}
                  />
                ) : (
                  <span
                    style={{
                      fontWeight: 900,
                      fontStyle: "italic",
                      fontSize: 20,
                      fontFamily: "Impact, 'Arial Narrow Bold', sans-serif",
                      color: "var(--brand)",
                      minWidth: 36,
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {c.driver_number}
                  </span>
                )}
                <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                  {c.driver_name}
                </span>
                {isActive && playing && (
                  <span
                    style={{
                      marginLeft: "auto",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#e10600",
                      animation: "scanner-pulse 1.5s infinite",
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && configs.length === 0 && (
        <section className="card" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            No live scanner feeds available
          </p>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Scanner audio is only available during live race sessions.
            Check back when a race is underway.
          </p>
        </section>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes scanner-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
