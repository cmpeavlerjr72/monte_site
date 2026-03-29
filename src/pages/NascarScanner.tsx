// src/pages/NascarScanner.tsx
//
// Live NASCAR Scanner — multi-stream mixer with up to 5 simultaneous channels.
// All audio flows browser → sa.aws.nascar.com (zero bandwidth on our server).
// Audio mapping JSON fetched from cf.nascar.com (also zero cost to us).
// Each stream gets a Web Audio AnalyserNode for voice activity detection.

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

const MAX_STREAMS = 5;

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

/** Runtime state for one active stream in the mixer. */
interface ActiveStream {
  entry: AudioEntry;
  audio: HTMLAudioElement;
  hls: any | null;
  analyser: AnalyserNode | null;
  source: MediaElementAudioSourceNode | null;
  volume: number; // 0-100 per-stream
}

/* ── Helpers ──────────────────────────────────────────────── */

const SPECIAL_CHANNELS = new Set(["All Scan", "MRN", "NRN", "Officials"]);

const CAR_BADGE_CDN: Record<SeriesKey, string> = {
  cup:     "https://cf.nascar.com/data/images/carbadges/1",
  xfinity: "https://cf.nascar.com/data/images/carbadges/2",
  trucks:  "https://cf.nascar.com/data/images/carbadges/3",
};

function streamLabel(entry: AudioEntry): string {
  if (SPECIAL_CHANNELS.has(entry.driver_name)) {
    return entry.driver_name === "MRN" || entry.driver_name === "NRN"
      ? `${entry.driver_name} Radio`
      : entry.driver_name;
  }
  return `#${entry.driver_number} ${entry.driver_name}`;
}

/* ── Component ────────────────────────────────────────────── */

export default function NascarScanner() {
  const [series, setSeries] = useState<SeriesKey>("cup");
  const [mapping, setMapping] = useState<AudioMapping | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [delay, setDelay] = useState(0);
  const [search, setSearch] = useState("");
  const [badgeErrors, setBadgeErrors] = useState<Set<string>>(new Set());

  // Multi-stream mixer state
  const [streams, setStreams] = useState<ActiveStream[]>([]);
  // Audio activity levels per stream_number (0-1), updated by animation loop
  const [levels, setLevels] = useState<Record<number, number>>({});

  const audioCtxRef = useRef<AudioContext | null>(null);
  const hlsJsLoaded = useRef(false);
  const animFrameRef = useRef<number>(0);

  // Lazy-init shared AudioContext
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Load hls.js from CDN once
  useEffect(() => {
    if (hlsJsLoaded.current) return;
    if ((window as any).Hls) { hlsJsLoaded.current = true; return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
    script.onload = () => { hlsJsLoaded.current = true; };
    document.head.appendChild(script);
  }, []);

  // HLS config builder
  const hlsConfig = useCallback((delaySec: number) => {
    const segDur = 2;
    const base = 2;
    const delaySegs = Math.ceil(delaySec / segDur);
    return {
      liveSyncDurationCount: base + delaySegs,
      liveMaxLatencyDurationCount: base + delaySegs + 3,
      enableWorker: true,
      lowLatencyMode: delaySec === 0,
    };
  }, []);

  // Fetch audio mapping when series changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMapping(null);
    stopAll();

    const url = AUDIO_MAPPING_URL.replace("{series}", String(SERIES_MAP[series].id));
    fetch(url, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: AudioMapping) => { if (!cancelled) { setMapping(data); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });

    return () => { cancelled = true; };
  }, [series]);

  useEffect(() => setBadgeErrors(new Set()), [series]);

  // ── Animation loop: sample analyser levels ──
  useEffect(() => {
    const buf = new Uint8Array(256);
    const tick = () => {
      const next: Record<number, number> = {};
      // Read from current streams ref via closure over state
      setStreams((prev) => {
        for (const s of prev) {
          if (s.analyser) {
            s.analyser.getByteFrequencyData(buf);
            // RMS over frequency bins, normalized 0-1
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            next[s.entry.stream_number] = Math.sqrt(sum / buf.length) / 255;
          } else {
            next[s.entry.stream_number] = 0;
          }
        }
        return prev; // no mutation
      });
      setLevels(next);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ── Stop a single stream ──
  const stopStream = useCallback((streamNumber: number) => {
    setStreams((prev) => {
      const idx = prev.findIndex((s) => s.entry.stream_number === streamNumber);
      if (idx === -1) return prev;
      const s = prev[idx];
      if (s.hls) s.hls.destroy();
      s.audio.pause();
      s.audio.src = "";
      s.audio.remove();
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // ── Stop all streams ──
  const stopAll = useCallback(() => {
    setStreams((prev) => {
      for (const s of prev) {
        if (s.hls) s.hls.destroy();
        s.audio.pause();
        s.audio.src = "";
        s.audio.remove();
      }
      return [];
    });
  }, []);

  // ── Toggle a stream on/off ──
  const toggleStream = useCallback((entry: AudioEntry) => {
    // If already active, remove it
    setStreams((prev) => {
      const existing = prev.find((s) => s.entry.stream_number === entry.stream_number);
      if (existing) {
        if (existing.hls) existing.hls.destroy();
        existing.audio.pause();
        existing.audio.src = "";
        existing.audio.remove();
        return prev.filter((s) => s.entry.stream_number !== entry.stream_number);
      }

      // Max streams check
      if (prev.length >= MAX_STREAMS) return prev;

      // Create new stream
      const Hls = (window as any).Hls;
      const audio = document.createElement("audio");
      audio.crossOrigin = "anonymous";
      const url = entry.base_url + entry.stream_ios;
      const defaultVol = 80;

      let analyser: AnalyserNode | null = null;
      let source: MediaElementAudioSourceNode | null = null;

      // Set up Web Audio analyser for activity detection
      try {
        const ctx = getAudioCtx();
        source = ctx.createMediaElementSource(audio);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        analyser.connect(ctx.destination);
      } catch {
        // Fallback: no analyser, audio still plays directly
      }

      let hlsInstance: any = null;

      if (Hls && Hls.isSupported()) {
        hlsInstance = new Hls(hlsConfig(delay));
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(audio);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.volume = defaultVol / 100;
          audio.play().catch(() => {});
        });
        hlsInstance.on(Hls.Events.ERROR, (_: any, data: any) => {
          if (data.fatal) setError(`Stream error: ${streamLabel(entry)}`);
        });
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        audio.src = url;
        audio.volume = defaultVol / 100;
        audio.play().catch(() => {});
      }

      const newStream: ActiveStream = {
        entry,
        audio,
        hls: hlsInstance,
        analyser,
        source,
        volume: defaultVol,
      };

      return [...prev, newStream];
    });
  }, [delay, hlsConfig, getAudioCtx]);

  // ── Per-stream volume change ──
  const setStreamVolume = useCallback((streamNumber: number, vol: number) => {
    setStreams((prev) =>
      prev.map((s) => {
        if (s.entry.stream_number !== streamNumber) return s;
        s.audio.volume = vol / 100;
        return { ...s, volume: vol };
      })
    );
  }, []);

  // ── Apply delay changes to all active HLS instances ──
  useEffect(() => {
    const cfg = hlsConfig(delay);
    setStreams((prev) => {
      for (const s of prev) {
        if (!s.hls) continue;
        s.hls.config.liveSyncDurationCount = cfg.liveSyncDurationCount;
        s.hls.config.liveMaxLatencyDurationCount = cfg.liveMaxLatencyDurationCount;
        s.hls.config.lowLatencyMode = cfg.lowLatencyMode;
        if (s.hls.liveSyncPosition != null) {
          const target = s.hls.liveSyncPosition;
          if (Math.abs(s.audio.currentTime - target) > 3) {
            s.audio.currentTime = target;
          }
        }
      }
      return prev; // no mutation needed for re-render
    });
  }, [delay, hlsConfig]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setStreams((prev) => {
        for (const s of prev) {
          if (s.hls) s.hls.destroy();
          s.audio.pause();
          s.audio.remove();
        }
        return [];
      });
      cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const configs = mapping?.audio_config ?? [];
  const disabled = mapping?.disable_scanner !== "off" && mapping?.disable_scanner != null;
  const activeNumbers = new Set(streams.map((s) => s.entry.stream_number));

  const filtered = configs.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.driver_name.toLowerCase().includes(q) || c.driver_number.toLowerCase().includes(q);
  });

  const driverStreams = filtered.filter((c) => !SPECIAL_CHANNELS.has(c.driver_name));
  const specialStreams = filtered.filter((c) => SPECIAL_CHANNELS.has(c.driver_name));

  // Which stream is loudest right now (for "speaking" highlight in grid)
  const loudestStream = streams.length > 0
    ? streams.reduce((best, s) => {
        const lvl = levels[s.entry.stream_number] ?? 0;
        return lvl > (levels[best.entry.stream_number] ?? 0) ? s : best;
      })
    : null;
  const SPEAK_THRESHOLD = 0.08;

  return (
    <div>
      {/* Header card */}
      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontWeight: 900, fontSize: 24 }}>NASCAR Scanner</h1>
          <div style={{ display: "flex", gap: 4 }}>
            {SERIES_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSeries(key)}
                style={{
                  padding: "5px 14px", borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: series === key ? "var(--brand)" : "var(--card)",
                  color: series === key ? "var(--brand-contrast)" : "var(--text)",
                  cursor: "pointer", fontWeight: 700, fontSize: 13,
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {SERIES_MAP[key].label}
              </button>
            ))}
          </div>
        </div>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
          Live driver &amp; crew chief radio — click up to {MAX_STREAMS} channels to mix
          {mapping && <> &middot; Race ID: {mapping.historical_race_id} &middot; {configs.length} channels</>}
        </p>
        {disabled && (
          <p style={{ margin: "8px 0 0", color: "#b91c1c", fontWeight: 600, fontSize: 14 }}>
            Scanner is currently disabled for this session.
          </p>
        )}
      </section>

      {/* ── Mixer Panel ── */}
      <section className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: streams.length > 0 ? 12 : 0, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            Mixer {streams.length > 0 && `(${streams.length}/${MAX_STREAMS})`}
          </span>

          {streams.length > 0 && (
            <button
              onClick={stopAll}
              style={{
                padding: "5px 14px", borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--brand)", color: "var(--brand-contrast)",
                cursor: "pointer", fontWeight: 600, fontSize: 13,
              }}
            >
              Stop All
            </button>
          )}

          {/* TV Sync delay */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: streams.length > 0 ? "auto" : 0, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>TV Sync</span>
            <div style={{ display: "flex", gap: 2 }}>
              {[0, 15, 25, 30, 45].map((d) => (
                <button
                  key={d}
                  onClick={() => setDelay(d)}
                  style={{
                    padding: "3px 8px", borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: delay === d ? "var(--brand)" : "var(--card)",
                    color: delay === d ? "var(--brand-contrast)" : "var(--text)",
                    cursor: "pointer", fontWeight: 600, fontSize: 11,
                  }}
                >
                  {d === 0 ? "Live" : `${d}s`}
                </button>
              ))}
            </div>
            <input
              type="range" min={0} max={90} step={1} value={delay}
              onChange={(e) => setDelay(Number(e.target.value))}
              style={{ width: 90, accentColor: "var(--brand)" }}
            />
            {/* Editable numeric input with +/- buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              <button
                onClick={() => setDelay(Math.max(0, delay - 1))}
                style={{
                  width: 24, height: 26, borderRadius: "6px 0 0 6px",
                  border: "1px solid var(--border)", borderRight: "none",
                  background: "var(--card)", cursor: "pointer",
                  fontSize: 14, fontWeight: 700, color: "var(--text)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                −
              </button>
              <input
                type="number"
                min={0}
                max={90}
                value={delay}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setDelay(Math.max(0, Math.min(90, v)));
                }}
                style={{
                  width: 42, height: 26, textAlign: "center",
                  border: "1px solid var(--border)", borderRadius: 0,
                  fontSize: 12, fontWeight: 700, padding: 0,
                  MozAppearance: "textfield",
                }}
              />
              <button
                onClick={() => setDelay(Math.min(90, delay + 1))}
                style={{
                  width: 24, height: 26, borderRadius: "0 6px 6px 0",
                  border: "1px solid var(--border)", borderLeft: "none",
                  background: "var(--card)", cursor: "pointer",
                  fontSize: 14, fontWeight: 700, color: "var(--text)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                +
              </button>
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>sec</span>
          </div>
        </div>

        {/* Active stream rows */}
        {streams.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
            Click a driver or channel below to start listening. You can add up to {MAX_STREAMS} at once.
          </p>
        )}

        {streams.map((s) => {
          const lvl = levels[s.entry.stream_number] ?? 0;
          const isSpeaking = lvl > SPEAK_THRESHOLD;
          const isLoudest = loudestStream?.entry.stream_number === s.entry.stream_number && isSpeaking;

          return (
            <div
              key={s.entry.stream_number}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                marginBottom: 4,
                borderRadius: 10,
                border: `2px solid ${isLoudest ? "#e10600" : isSpeaking ? "var(--brand)" : "var(--border)"}`,
                background: isLoudest
                  ? "color-mix(in oklab, #e10600 8%, var(--card))"
                  : isSpeaking
                  ? "color-mix(in oklab, var(--brand) 6%, var(--card))"
                  : "var(--card)",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {/* Activity meter bar */}
              <div
                style={{
                  width: 4,
                  height: 28,
                  borderRadius: 2,
                  background: "var(--border)",
                  position: "relative",
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${Math.min(lvl * 250, 100)}%`,
                    background: isLoudest ? "#e10600" : "var(--brand)",
                    borderRadius: 2,
                    transition: "height 0.1s",
                  }}
                />
              </div>

              {/* Speaking indicator dot */}
              <span
                style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: isLoudest ? "#e10600" : isSpeaking ? "var(--brand)" : "var(--border)",
                  animation: isLoudest ? "scanner-pulse 0.8s infinite" : "none",
                  transition: "background 0.15s",
                }}
              />

              {/* Label */}
              <span style={{
                fontWeight: isLoudest ? 800 : 600,
                fontSize: 14,
                minWidth: 140,
                color: isLoudest ? "#e10600" : "var(--text)",
                transition: "color 0.15s",
              }}>
                {streamLabel(s.entry)}
                {isLoudest && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, opacity: 0.8 }}>
                    SPEAKING
                  </span>
                )}
              </span>

              {/* Per-stream volume */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Vol</span>
                <input
                  type="range" min={0} max={100} value={s.volume}
                  onChange={(e) => setStreamVolume(s.entry.stream_number, Number(e.target.value))}
                  style={{ width: 80, accentColor: "var(--brand)" }}
                />
              </div>

              {/* Remove button */}
              <button
                onClick={() => stopStream(s.entry.stream_number)}
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: "1px solid var(--border)", background: "var(--card)",
                  cursor: "pointer", fontSize: 16, lineHeight: 1,
                  color: "var(--muted)", display: "flex", alignItems: "center",
                  justifyContent: "center", flexShrink: 0,
                }}
                title="Remove stream"
              >
                ×
              </button>
            </div>
          );
        })}
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
        <p style={{ color: "#b91c1c", padding: "12px 0", fontSize: 14 }}>{error}</p>
      )}

      {/* Special channels */}
      {specialStreams.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {specialStreams.map((c) => {
            const isActive = activeNumbers.has(c.stream_number);
            const lvl = levels[c.stream_number] ?? 0;
            const isSpeaking = isActive && lvl > SPEAK_THRESHOLD;
            return (
              <button
                key={c.stream_number}
                onClick={() => toggleStream(c)}
                style={{
                  padding: "10px 20px", borderRadius: 10,
                  border: `2px solid ${isSpeaking ? "#e10600" : isActive ? "var(--brand)" : "var(--border)"}`,
                  background: isActive ? "var(--brand)" : "var(--card)",
                  color: isActive ? "var(--brand-contrast)" : "var(--text)",
                  cursor: streams.length >= MAX_STREAMS && !isActive ? "not-allowed" : "pointer",
                  opacity: streams.length >= MAX_STREAMS && !isActive ? 0.5 : 1,
                  fontWeight: 700, fontSize: 14, transition: "all 0.15s",
                }}
              >
                {c.driver_name === "MRN" || c.driver_name === "NRN"
                  ? `${c.driver_name} Radio` : c.driver_name}
                {!c.requiresAuth && (
                  <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>FREE</span>
                )}
              </button>
            );
          })}
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
            const isActive = activeNumbers.has(c.stream_number);
            const lvl = levels[c.stream_number] ?? 0;
            const isSpeaking = isActive && lvl > SPEAK_THRESHOLD;
            const isLoudest = isActive && loudestStream?.entry.stream_number === c.stream_number && isSpeaking;
            const atMax = streams.length >= MAX_STREAMS && !isActive;
            const showBadge = !badgeErrors.has(c.driver_number);

            return (
              <button
                key={c.stream_number}
                onClick={() => !atMax && toggleStream(c)}
                className="card"
                style={{
                  padding: 12, cursor: atMax ? "not-allowed" : "pointer",
                  opacity: atMax ? 0.5 : 1,
                  border: `2px solid ${isLoudest ? "#e10600" : isSpeaking ? "color-mix(in oklab, var(--brand) 70%, #e10600)" : isActive ? "var(--brand)" : "var(--border)"}`,
                  background: isLoudest
                    ? "color-mix(in oklab, #e10600 10%, var(--card))"
                    : isActive
                    ? "color-mix(in oklab, var(--brand) 10%, var(--card))"
                    : "var(--card)",
                  borderRadius: 12, textAlign: "left",
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 10,
                }}
              >
                {showBadge ? (
                  <img
                    src={`${CAR_BADGE_CDN[series]}/${c.driver_number}.png`}
                    alt={`#${c.driver_number}`}
                    onError={() => setBadgeErrors((prev) => new Set(prev).add(c.driver_number))}
                    style={{ height: 32, width: "auto", flexShrink: 0 }}
                  />
                ) : (
                  <span
                    style={{
                      fontWeight: 900, fontStyle: "italic", fontSize: 20,
                      fontFamily: "Impact, 'Arial Narrow Bold', sans-serif",
                      color: "var(--brand)", minWidth: 36, textAlign: "center", flexShrink: 0,
                    }}
                  >
                    {c.driver_number}
                  </span>
                )}
                <span style={{
                  fontWeight: 600, fontSize: 14,
                  color: isLoudest ? "#e10600" : "var(--text)",
                  transition: "color 0.15s",
                }}>
                  {c.driver_name}
                </span>
                {isActive && (
                  <span
                    style={{
                      marginLeft: "auto", width: 8, height: 8,
                      borderRadius: "50%", flexShrink: 0,
                      background: isLoudest ? "#e10600" : isSpeaking ? "var(--brand)" : "var(--border)",
                      animation: isLoudest ? "scanner-pulse 0.8s infinite" : "none",
                      transition: "background 0.15s",
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

      <style>{`
        @keyframes scanner-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        /* Hide number input spinners */
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>
    </div>
  );
}
