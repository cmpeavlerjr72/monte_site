/**
 * useTranscription — fetches HLS audio segments directly and feeds them
 * to a Whisper Web Worker for live speech-to-text.
 *
 * Strategy:
 *   1. For each active stream, poll the HLS manifest for new segment URLs
 *   2. Fetch new AAC segments independently (separate from hls.js playback)
 *   3. Accumulate segments, periodically send concatenated audio to Worker
 *   4. Worker decodes AAC → PCM via AudioContext and runs Whisper
 *
 * This avoids the hls.js FRAG_LOADED issue where payload is 0 bytes
 * (hls.js detaches the buffer internally before the event fires).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface TranscriptEntry {
  streamNumber: number;
  text: string;
  timestamp: number;
}

interface StreamState {
  /** HLS manifest URL for this stream */
  manifestUrl: string;
  /** Segment URLs we've already fetched */
  fetchedSegments: Set<string>;
  /** Raw AAC segment buffers waiting to be sent */
  pendingBuffers: ArrayBuffer[];
  pendingBytes: number;
  /** Timestamp of last send to worker */
  lastSent: number;
}

const POLL_INTERVAL_MS = 4000;   // poll manifest every 4s (segments are ~2s)
const SEND_INTERVAL_MS = 10000;  // send to worker every 10s
const MAX_PENDING_BYTES = 300000;
const MAX_TRANSCRIPT_LINES = 50;

export function useTranscription() {
  const [enabled, setEnabled] = useState(false);
  const [modelStatus, setModelStatus] = useState<string>("");
  const [modelReady, setModelReady] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const streamsRef = useRef<Map<number, StreamState>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Worker lifecycle ──
  useEffect(() => {
    if (!enabled) {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      setModelReady(false);
      setModelStatus("");
      return;
    }

    const worker = new Worker(
      new URL("../workers/whisperWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "status") {
        setModelStatus(msg.message);
      } else if (msg.type === "ready") {
        setModelReady(true);
        setModelStatus("Ready");
      } else if (msg.type === "result" && msg.text) {
        setTranscripts((prev) =>
          [...prev, { streamNumber: msg.id, text: msg.text, timestamp: Date.now() }]
            .slice(-MAX_TRANSCRIPT_LINES),
        );
      } else if (msg.type === "error") {
        setModelStatus(`Error: ${msg.message}`);
      }
    };

    worker.postMessage({ type: "init" });
    workerRef.current = worker;

    return () => { worker.terminate(); workerRef.current = null; };
  }, [enabled]);

  // ── Manifest polling: discover and fetch new segments ──
  useEffect(() => {
    if (!enabled) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const poll = async () => {
      const entries = Array.from(streamsRef.current.entries());
      for (const [streamNum, state] of entries) {
        try {
          const resp = await fetch(state.manifestUrl, { cache: "no-store" });
          if (!resp.ok) continue;
          const text = await resp.text();

          // Parse segment URLs from manifest
          const lines = text.split("\n");
          const baseUrl = state.manifestUrl.substring(0, state.manifestUrl.lastIndexOf("/") + 1);
          const segmentUrls: string[] = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
              // Relative URL
              segmentUrls.push(trimmed.startsWith("http") ? trimmed : baseUrl + trimmed);
            }
          }

          // Fetch any new segments we haven't seen
          for (const segUrl of segmentUrls) {
            if (state.fetchedSegments.has(segUrl)) continue;
            state.fetchedSegments.add(segUrl);

            try {
              const segResp = await fetch(segUrl);
              if (!segResp.ok) continue;
              const buf = await segResp.arrayBuffer();
              if (buf.byteLength > 0) {
                state.pendingBuffers.push(buf);
                state.pendingBytes += buf.byteLength;

                // Trim old if over limit
                while (state.pendingBytes > MAX_PENDING_BYTES && state.pendingBuffers.length > 3) {
                  const removed = state.pendingBuffers.shift()!;
                  state.pendingBytes -= removed.byteLength;
                }
              }
            } catch {
              // segment fetch failed, skip
            }
          }

          // Keep fetchedSegments from growing unbounded
          if (state.fetchedSegments.size > 100) {
            const keep = new Set(segmentUrls);
            state.fetchedSegments = keep;
          }
        } catch {
          // manifest fetch failed, skip this cycle
        }
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    // Run immediately on start
    poll();

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [enabled]);

  // ── Periodic send to worker ──
  useEffect(() => {
    if (!enabled || !modelReady) {
      if (sendRef.current) clearInterval(sendRef.current);
      return;
    }

    sendRef.current = setInterval(() => {
      const worker = workerRef.current;
      if (!worker) return;
      const now = Date.now();

      streamsRef.current.forEach((state, streamNum) => {
        if (now - state.lastSent < SEND_INTERVAL_MS) return;
        if (state.pendingBuffers.length < 3) return; // need ~6s minimum

        // Concatenate pending buffers
        const combined = new Uint8Array(state.pendingBytes);
        let offset = 0;
        for (const buf of state.pendingBuffers) {
          combined.set(new Uint8Array(buf), offset);
          offset += buf.byteLength;
        }

        state.lastSent = now;
        // Keep last 2 segments for overlap on next send
        const keep = state.pendingBuffers.slice(-2);
        state.pendingBuffers = keep;
        state.pendingBytes = keep.reduce((s, b) => s + b.byteLength, 0);

        worker.postMessage(
          { type: "transcribe", id: streamNum, audio: combined.buffer },
          [combined.buffer],
        );
      });
    }, 3000);

    return () => { if (sendRef.current) clearInterval(sendRef.current); };
  }, [enabled, modelReady]);

  /**
   * Register a stream for transcription. Call when a stream starts playing.
   * manifestUrl is the HLS .m3u8 URL (e.g. https://sa.aws.nascar.com/driveaudio1/stream_12.m3u8)
   */
  const addStream = useCallback((streamNumber: number, manifestUrl: string) => {
    if (!enabled) return;
    if (streamsRef.current.has(streamNumber)) return;
    streamsRef.current.set(streamNumber, {
      manifestUrl,
      fetchedSegments: new Set(),
      pendingBuffers: [],
      pendingBytes: 0,
      lastSent: Date.now(),
    });
  }, [enabled]);

  /** Stop transcription for a stream. */
  const removeStream = useCallback((streamNumber: number) => {
    streamsRef.current.delete(streamNumber);
  }, []);

  /** Clear all transcripts and stream state. */
  const clearAll = useCallback(() => {
    setTranscripts([]);
    streamsRef.current.clear();
  }, []);

  return {
    enabled,
    setEnabled,
    modelStatus,
    modelReady,
    transcripts,
    addStream,
    removeStream,
    clearAll,
  };
}
