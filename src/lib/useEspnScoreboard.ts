import { useEffect, useState } from "react";

type Opts = {
  sport?: "cbb" | "cfb";   // default cbb below
  groups?: string;         // "50" for NCAAM D-I
  limit?: number;          // 357 is plenty, 3000 OK too
  pollMs?: number;         // how often to refresh
};

/**
 * Directly fetch ESPN's public scoreboard JSON (polling),
 * and fall back to your /api/espn/scoreboard proxy if CORS blocks it.
 *
 * Returns the raw ESPN payload (with .events etc.).
 */
export function useEspnScoreboard(
  date: string | null | undefined,
  opts: Opts = {}
) {
  const [payload, setPayload] = useState<any | null>(null);

  const sport  = opts.sport ?? "cbb";
  const groups = opts.groups ?? (sport === "cbb" ? "50" : "80,81");
  const limit  = String(opts.limit ?? (sport === "cbb" ? 357 : 3000));
  const pollMs = opts.pollMs ?? 20000;

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    let timer: any;

    const d = String(date).replace(/-/g, "");

    const directUrl =
      sport === "cbb"
        ? `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${d}&groups=${groups}&limit=${limit}`
        : `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${d}&groups=${groups}&limit=${limit}`;

    const proxyUrl = `/api/espn/scoreboard?dates=${d}&groups=${groups}&limit=${limit}`;

    async function pull() {
      try {
        // Try direct ESPN first
        const r = await fetch(directUrl, { cache: "no-cache" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!cancelled) setPayload(json);
      } catch (err) {
        // Fallback to your proxy (works even if ESPN blocks CORS)
        try {
          const p = await fetch(proxyUrl, { cache: "no-cache" });
          if (!p.ok) throw new Error(`Proxy HTTP ${p.status}`);
          // Your proxy may return JSON or text; handle both
          const ct = p.headers.get("content-type") || "";
          const data = ct.includes("application/json")
            ? await p.json()
            : JSON.parse(await p.text());
          if (!cancelled) setPayload(data);
        } catch (e) {
          console.warn("Failed to fetch ESPN scoreboard (direct+proxy):", e);
        }
      }

      if (!cancelled) timer = setTimeout(pull, pollMs);
    }

    pull();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date, sport, groups, limit, pollMs]);

  return payload;
}
