/**
 * Web Worker — Whisper speech-to-text via @huggingface/transformers.
 *
 * Receives raw AAC audio data, decodes to PCM, and transcribes.
 *
 * Messages IN:
 *   { type: "init" }                                    — pre-load the model
 *   { type: "transcribe", id, audio: ArrayBuffer }      — transcribe raw audio
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

const TARGET_SR = 16000;

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

/**
 * Decode raw AAC/ADTS audio to 16kHz mono Float32Array using OfflineAudioContext.
 */
async function decodeAudio(rawBuffer: ArrayBuffer): Promise<Float32Array> {
  // Create a Blob and object URL so AudioContext can decode from it
  // OfflineAudioContext needs to know the length upfront, so we use a regular
  // AudioContext (available in Worker scope in modern browsers)
  const blob = new Blob([rawBuffer], { type: "audio/aac" });
  const url = URL.createObjectURL(blob);

  try {
    // Try fetching from blob URL and using AudioContext to decode
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    // Workers in Chrome/Edge/Firefox support AudioContext or OfflineAudioContext
    const AudioCtx = (self as any).AudioContext || (self as any).OfflineAudioContext;
    if (!AudioCtx) {
      throw new Error("No AudioContext available in worker");
    }

    let audioBuffer: AudioBuffer;
    if ((self as any).AudioContext) {
      const ctx = new (self as any).AudioContext({ sampleRate: TARGET_SR });
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      ctx.close();
    } else {
      // Fallback: guess duration from byte size (~20kbps AAC ≈ 2500 bytes/sec)
      const estDuration = Math.max(1, rawBuffer.byteLength / 2500);
      const estSamples = Math.ceil(estDuration * TARGET_SR);
      const ctx = new OfflineAudioContext(1, estSamples, TARGET_SR);
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    }

    // Mix to mono and resample
    const numCh = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < numCh; ch++) {
      const chData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += chData[i] / numCh;
    }

    // Resample if needed
    const srcRate = audioBuffer.sampleRate;
    if (srcRate === TARGET_SR) return mono;

    const ratio = srcRate / TARGET_SR;
    const outLen = Math.round(length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const si = i * ratio;
      const lo = Math.floor(si);
      const hi = Math.min(lo + 1, length - 1);
      const f = si - lo;
      out[i] = mono[lo] * (1 - f) + mono[hi] * f;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function transcribe(id: number, rawAudio: ArrayBuffer) {
  if (!transcriber) {
    self.postMessage({ type: "error", id, message: "Model not loaded" });
    return;
  }

  try {
    // Decode raw AAC to PCM
    const pcm = await decodeAudio(rawAudio);

    if (pcm.length < TARGET_SR) {
      // Less than 1 second of audio — skip
      return;
    }

    // Check if audio has actual content (not silence)
    let rms = 0;
    for (let i = 0; i < pcm.length; i++) rms += pcm[i] * pcm[i];
    rms = Math.sqrt(rms / pcm.length);
    if (rms < 0.001) {
      // Essentially silent — skip
      return;
    }

    const result = await transcriber(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = Array.isArray(result)
      ? result.map((r: any) => r.text).join(" ")
      : result.text;

    // Filter out common Whisper hallucinations on noise/silence
    const cleaned = text.trim();
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
