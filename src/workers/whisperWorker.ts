/**
 * Web Worker — Whisper speech-to-text via @huggingface/transformers.
 *
 * Loads whisper-tiny (quantized, ~50 MB one-time download, cached in browser)
 * and transcribes Float32Array PCM audio chunks sent from the main thread.
 *
 * Messages IN:
 *   { type: "init" }                              — pre-load the model
 *   { type: "transcribe", id, audio: Float32Array } — transcribe a chunk
 *
 * Messages OUT:
 *   { type: "status", message: string }            — loading/progress updates
 *   { type: "ready" }                              — model loaded, ready
 *   { type: "result", id, text: string }           — transcription result
 *   { type: "error", id?, message: string }        — error
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

async function transcribe(id: number, audio: Float32Array) {
  if (!transcriber) {
    self.postMessage({ type: "error", id, message: "Model not loaded" });
    return;
  }

  try {
    const result = await transcriber(audio, {
      language: "en",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text;
    self.postMessage({ type: "result", id, text: text.trim() });
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
