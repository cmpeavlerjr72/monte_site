import { useEffect, useRef, useState } from "react";

export function useLiveScoreboard(dateYYYYMMDD?: string) {
  const [data, setData] = useState<any>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/live${dateYYYYMMDD ? `?date=${dateYYYYMMDD}` : ""}`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.payload) setData(msg.payload);
      } catch {}
    };
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => { es.close(); esRef.current = null; };
  }, [dateYYYYMMDD]);

  return data; // ESPN-shaped scoreboard JSON
}
