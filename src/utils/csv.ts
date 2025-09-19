// src/utils/csv.ts
import * as Papa from "papaparse";

/** Very conservative Safari / iOS detector (works in WKWebView too). */
export const isSafari = /^((?!chrome|android).)*safari/i.test(
  typeof navigator !== "undefined" ? navigator.userAgent : ""
);

/** Fetch (if URL) + parse TEXT with Papa. Avoid Papa's download path on iOS. */
export async function parseCsvFromItemSafe<T = any>(
  item: { url?: string; raw?: string },
  papaOpts?: Papa.ParseConfig<T>,
  signal?: AbortSignal
): Promise<T[]> {
  let text = "";

  // Prefer URL if present; make absolute to dodge Safari worker/URL quirks
  if (item?.url && item.url.trim()) {
    try {
      const abs = new URL(item.url, typeof window !== "undefined" ? window.location.href : "http://localhost").toString();
      const res = await fetch(abs, { cache: "no-store", signal });
      text = await res.text();
    } catch (e) {
      // fall through to raw if available
      // eslint-disable-next-line no-console
      console.warn("CSV fetch failed:", item?.url, e);
    }
  }

  // Fallback to raw text bundled by Vite
  if (!text && item?.raw) text = item.raw;
  if (!text) return [];

  return new Promise<T[]>((resolve, reject) => {
    Papa.parse<T>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      download: false,          // we already have text
      worker: false,            // safer for text input across WebKit
      ...(papaOpts as Papa.ParseConfig<T> | undefined),
      complete: (res) => resolve(res.data as T[]),
      error: reject,
    } as Papa.ParseConfig<T>);
  });
}

/** Limit concurrency to keep iOS memory under control. */
export async function pAllLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
