// src/lib/useLiveScoreboard.ts
import { useEffect, useState } from "react";

/**
 * Subscribe to ESPN live scoreboard via the /api/live SSE endpoint,
 * with a fallback to /api/scoreboard.
 *
 * @param date  e.g. "20251123" or "2025-11-23"
 * @param sport "cfb" or "cbb" (defaults to "cfb" for backwards compatibility)
 */
export function useLiveScoreboard(
  date: string | null | undefined,
  sport: "cfb" | "cbb" = "cfb"
) {
  const [payload, setPayload] = useState<any | null>(null);

  useEffect(() => {
    if (!date) return;

    const params = new URLSearchParams();
    params.set("date", String(date));
    params.set("sport", sport);

    const liveUrl = `/api/live?${params.toString()}`;
    const pullUrl = `/api/scoreboard?${params.toString()}`;

    let cancelled = false;
    let es: EventSource | null = null;

    function handlePayload(raw: any) {
      if (cancelled) return;
      // SSE sends { type, meta, payload }, REST sends { sport, date, payload, ... }
      const pl = raw?.payload ?? raw;
      setPayload(pl);
    }

    async function fallbackFetch() {
      try {
        const resp = await fetch(pullUrl, { cache: "no-cache" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        handlePayload(json);
      } catch (err) {
        console.error("useLiveScoreboard fallback error", err);
      }
    }

    try {
      es = new EventSource(liveUrl);
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          handlePayload(data);
        } catch (err) {
          console.error("useLiveScoreboard SSE parse error", err);
        }
      };
      es.onerror = () => {
        console.warn("useLiveScoreboard SSE error – falling back to pull");
        es?.close();
        es = null;
        fallbackFetch();
      };
    } catch (err) {
      console.warn("useLiveScoreboard SSE unsupported – using pull", err);
      fallbackFetch();
    }

    return () => {
      cancelled = true;
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [date, sport]);

  return payload;
}
