/**
 * useTranscription — hooks hls.js fragment loading to feed PCM audio
 * to a Whisper Web Worker for live speech-to-text.
 *
 * Strategy:
 *   1. Listen for hls.js FRAG_LOADED events to capture raw AAC data
 *   2. Decode AAC → PCM via AudioContext.decodeAudioData()
 *   3. Resample to 16 kHz mono Float32Array (Whisper's expected format)
 *   4. Accumulate a rolling buffer (~10s), send to worker periodically
 *   5. Worker runs whisper-tiny and returns text
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface TranscriptEntry {
  streamNumber: number;
  text: string;
  timestamp: number;
}

interface StreamBuffer {
  /** Accumulated PCM samples at 16kHz mono */
  samples: Float32Array[];
  totalSamples: number;
  /** Timestamp of last transcription send */
  lastSent: number;
}

const TARGET_SAMPLE_RATE = 16000;
const SEND_INTERVAL_MS = 8000;  // send audio to worker every 8s
const MAX_BUFFER_SEC = 15;      // keep last 15s of audio per stream
const MAX_BUFFER_SAMPLES = TARGET_SAMPLE_RATE * MAX_BUFFER_SEC;
const MAX_TRANSCRIPT_LINES = 50;

/**
 * Resample an AudioBuffer to 16kHz mono Float32Array.
 */
function resampleTo16kMono(audioBuffer: AudioBuffer): Float32Array {
  // Mix down to mono
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / numChannels;
    }
  }

  // Resample to 16kHz
  const srcRate = audioBuffer.sampleRate;
  if (srcRate === TARGET_SAMPLE_RATE) return mono;

  const ratio = srcRate / TARGET_SAMPLE_RATE;
  const outLen = Math.round(length / ratio);
  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, length - 1);
    const frac = srcIdx - lo;
    out[i] = mono[lo] * (1 - frac) + mono[hi] * frac;
  }

  return out;
}

/**
 * Merge an array of Float32Array chunks into a single contiguous array,
 * trimming to maxSamples from the end (keeps most recent audio).
 */
function mergeBuffers(chunks: Float32Array[], maxSamples: number): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;

  const start = Math.max(0, total - maxSamples);
  const out = new Float32Array(Math.min(total, maxSamples));
  let readPos = 0;
  let writePos = 0;

  for (const c of chunks) {
    const chunkEnd = readPos + c.length;
    if (chunkEnd > start) {
      const offset = Math.max(0, start - readPos);
      const copyLen = c.length - offset;
      out.set(c.subarray(offset), writePos);
      writePos += copyLen;
    }
    readPos = chunkEnd;
  }

  return out;
}

export function useTranscription() {
  const [enabled, setEnabled] = useState(false);
  const [modelStatus, setModelStatus] = useState<string>("");
  const [modelReady, setModelReady] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const buffersRef = useRef<Map<number, StreamBuffer>>(new Map());
  const decodeCtxRef = useRef<OfflineAudioContext | null>(null);
  const sendIdRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Spin up / tear down worker ──
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
      } else if (msg.type === "result") {
        if (msg.text) {
          setTranscripts((prev) => {
            const next = [
              ...prev,
              { streamNumber: msg.id, text: msg.text, timestamp: Date.now() },
            ];
            return next.slice(-MAX_TRANSCRIPT_LINES);
          });
        }
      } else if (msg.type === "error") {
        setModelStatus(`Error: ${msg.message}`);
      }
    };

    worker.postMessage({ type: "init" });
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  // ── Periodic send: flush accumulated audio to worker ──
  useEffect(() => {
    if (!enabled || !modelReady) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      const worker = workerRef.current;
      if (!worker) return;

      const now = Date.now();
      buffersRef.current.forEach((buf, streamNum) => {
        if (now - buf.lastSent < SEND_INTERVAL_MS) return;
        if (buf.totalSamples < TARGET_SAMPLE_RATE * 2) return; // need at least 2s

        const merged = mergeBuffers(buf.samples, MAX_BUFFER_SAMPLES);
        buf.lastSent = now;
        // Trim buffer to prevent unbounded growth
        buf.samples = [merged];
        buf.totalSamples = merged.length;

        worker.postMessage(
          { type: "transcribe", id: streamNum, audio: merged },
          [merged.buffer], // transfer, not copy
        );
      });
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, modelReady]);

  /**
   * Call this from an hls.js FRAG_LOADED handler with the raw segment data.
   * The data is an ArrayBuffer of AAC audio.
   */
  const feedSegment = useCallback(
    async (streamNumber: number, data: ArrayBuffer) => {
      if (!enabled) return;

      try {
        // Decode AAC → PCM using OfflineAudioContext
        // Create a fresh context for each decode (required by spec for OfflineAudioContext)
        const tempCtx = new AudioContext();
        const audioBuffer = await tempCtx.decodeAudioData(data.slice(0)); // slice to avoid detached buffer
        await tempCtx.close();

        const pcm = resampleTo16kMono(audioBuffer);

        // Push into per-stream buffer
        if (!buffersRef.current.has(streamNumber)) {
          buffersRef.current.set(streamNumber, {
            samples: [],
            totalSamples: 0,
            lastSent: 0,
          });
        }
        const buf = buffersRef.current.get(streamNumber)!;
        buf.samples.push(pcm);
        buf.totalSamples += pcm.length;
      } catch {
        // AAC decode can fail on partial/corrupt segments — just skip
      }
    },
    [enabled],
  );

  /** Remove transcript history for a stream that was stopped. */
  const clearStream = useCallback((streamNumber: number) => {
    buffersRef.current.delete(streamNumber);
  }, []);

  /** Clear all transcripts. */
  const clearAll = useCallback(() => {
    setTranscripts([]);
    buffersRef.current.clear();
  }, []);

  return {
    enabled,
    setEnabled,
    modelStatus,
    modelReady,
    transcripts,
    feedSegment,
    clearStream,
    clearAll,
  };
}
