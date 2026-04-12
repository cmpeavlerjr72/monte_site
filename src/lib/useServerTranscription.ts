/**
 * useServerTranscription — reads NASCAR scanner transcripts produced by a
 * local Whisper worker running on the operator's PC. The PC pushes entries to
 * /api/tx/ingest; the browser polls /api/tx/stream and filters by the driver
 * streams currently selected.
 *
 * Works on any device (desktop and mobile) because no speech model runs in
 * the browser — all inference happens on the operator's PC.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TranscriptEntry {
  streamNumber: number;
  text: string;
  timestamp: number;
}

interface ServerEntry extends TranscriptEntry {
  id: number;
  series: number;
}

const POLL_INTERVAL_MS = 3000;
const MAX_TRANSCRIPT_LINES = 100;

/**
 * @param enabled       gate polling (off by default; user opts in)
 * @param seriesId      1=cup, 2=xfinity, 3=trucks — filters server-side
 * @param streamNumbers currently selected driver stream numbers — also
 *                      filtered server-side so the payload stays small
 */
export function useServerTranscription(
  enabled: boolean,
  seriesId: number,
  streamNumbers: number[],
) {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState<string>("");
  const [online, setOnline] = useState<boolean>(false);

  const lastIdRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest stream filter in a ref so the polling loop always
  // sends the current selection without restarting the interval.
  const streamsKey = streamNumbers.slice().sort((a, b) => a - b).join(",");
  const streamsKeyRef = useRef(streamsKey);
  streamsKeyRef.current = streamsKey;
  const seriesRef = useRef(seriesId);
  seriesRef.current = seriesId;

  useEffect(() => {
    if (!enabled) {
      if (pollRef.current) clearTimeout(pollRef.current);
      setStatus("");
      setOnline(false);
      return;
    }

    let cancelled = false;
    setStatus("Connecting to local transcription server...");

    const tick = async () => {
      if (cancelled) return;
      const series = seriesRef.current;
      const streams = streamsKeyRef.current;
      const since = lastIdRef.current;

      const params = new URLSearchParams();
      if (since) params.set("since", String(since));
      if (series) params.set("series", String(series));
      if (streams) params.set("streams", streams);

      try {
        const resp = await fetch(`/api/tx/stream?${params.toString()}`, {
          cache: "no-store",
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as { entries: ServerEntry[]; lastId: number };

        if (!cancelled && data.entries && data.entries.length > 0) {
          const additions: TranscriptEntry[] = data.entries.map((e) => ({
            streamNumber: e.streamNumber,
            text: e.text,
            timestamp: e.timestamp,
          }));
          setTranscripts((prev) => [...prev, ...additions].slice(-MAX_TRANSCRIPT_LINES));
        }

        if (typeof data.lastId === "number" && data.lastId > lastIdRef.current) {
          lastIdRef.current = data.lastId;
        }

        if (!cancelled) {
          setOnline(true);
          setStatus("Connected");
        }
      } catch {
        if (!cancelled) {
          setOnline(false);
          setStatus("Waiting for local server...");
        }
      } finally {
        if (!cancelled) {
          pollRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    };

    // Fire immediately then poll
    tick();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [enabled]);

  const clearAll = useCallback(() => {
    setTranscripts([]);
    // Note: lastIdRef is preserved so we don't re-fetch history on clear
  }, []);

  // Only surface transcripts for currently selected streams. Server already
  // filters but we also filter client-side in case selection changed mid-poll.
  const selected = useMemo(() => new Set(streamNumbers), [streamsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredTranscripts = useMemo(
    () => transcripts.filter((t) => selected.has(t.streamNumber)),
    [transcripts, selected],
  );

  return useMemo(
    () => ({
      enabled,
      status,
      online,
      transcripts: filteredTranscripts,
      clearAll,
    }),
    [enabled, status, online, filteredTranscripts, clearAll],
  );
}
