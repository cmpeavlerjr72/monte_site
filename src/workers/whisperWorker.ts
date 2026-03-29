/**
 * Web Worker — Whisper speech-to-text via @huggingface/transformers.
 *
 * Receives pre-decoded PCM Float32Array (16kHz mono) and transcribes.
 * Audio decoding happens in the main thread (AudioContext is not
 * available in Workers).
 *
 * Messages IN:
 *   { type: "init" }                                     — pre-load model
 *   { type: "transcribe", id, audio: Float32Array }      — transcribe PCM
 *
 * Messages OUT:
 *   { type: "status", message }  — loading/progress
 *   { type: "ready" }            — model loaded
 *   { type: "result", id, text } — transcription
 *   { type: "error", id?, message } — error
 */

// @ts-nocheck — Transformers.js pipeline types are too complex for TS strict mode
import { pipeline } from "@huggingface/transformers";

let transcriber: any = null;
let loading = false;

async function initModel() {
  if (transcriber || loading) return;
  loading = true;

  self.postMessage({ type: "status", message: "Loading Whisper model (~50 MB first time)..." });

  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny.en",
      {
        dtype: "q4",
        device: "wasm",
        progress_callback: (p: any) => {
          if (p.status === "progress" && p.progress != null) {
            self.postMessage({
              type: "status",
              message: `Downloading model: ${Math.round(p.progress)}%`,
            });
          }
        },
      },
    );

    loading = false;
    self.postMessage({ type: "ready" });
  } catch (e: any) {
    loading = false;
    self.postMessage({ type: "error", message: `Model load failed: ${e.message}` });
  }
}

async function transcribe(id: number, pcm: Float32Array) {
  if (!transcriber) {
    self.postMessage({ type: "error", id, message: "Model not loaded" });
    return;
  }

  try {
    if (pcm.length < 16000) return;

    let rms = 0;
    for (let i = 0; i < pcm.length; i++) rms += pcm[i] * pcm[i];
    rms = Math.sqrt(rms / pcm.length);
    if (rms < 0.001) return;

    const result = await transcriber(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = Array.isArray(result)
      ? result.map((r: any) => r.text).join(" ")
      : result.text;

    const cleaned = text.trim();
    // Filter Whisper hallucinations on noise
    if (
      cleaned &&
      cleaned !== "." &&
      cleaned !== "..." &&
      !cleaned.match(/^\[.*\]$/) &&
      !cleaned.match(/^you$/i) &&
      cleaned.length > 2
    ) {
      self.postMessage({ type: "result", id, text: cleaned });
    }
  } catch (e: any) {
    self.postMessage({ type: "error", id, message: e.message });
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;
  if (type === "init") {
    initModel();
  } else if (type === "transcribe") {
    transcribe(e.data.id, e.data.audio);
  }
};
