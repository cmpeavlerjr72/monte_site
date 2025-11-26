// server/liveScores.ts
import express, { Request, Response } from "express";
import cors from "cors";
import fetch, { Response as FetchResponse } from "node-fetch";
import AbortController from "abort-controller";
import compression from "compression";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

type Sport = "cfb" | "cbb";

interface ScoreboardPayload {
  // We don't care about the exact ESPN shape here; treat as any.
  [key: string]: any;
}

interface CacheEntry {
  sport: Sport;
  date: string;
  payload: ScoreboardPayload;
  fetchedAt: number;
  liveCount: number;
}

interface LiveClient {
  id: string;
  res: Response;
  sport: Sport;
  date: string;
}

const app = express();
app.use(cors());
app.use(compression());

const PORT = process.env.PORT || 8080;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------


function allEventsFromScoreboard(sb: any): any[] {
  const direct = Array.isArray(sb?.events) ? sb.events : [];
  const leagueLists = Array.isArray(sb?.leagues)
    ? sb.leagues.flatMap((L: any) => (Array.isArray(L?.events) ? L.events : []))
    : [];

  // If leagues[].events has more, prefer that; otherwise fall back to events.
  const raw = leagueLists.length >= direct.length ? leagueLists : direct;

  // Dedupe by event id
  const seen = new Set<string>();
  const out: any[] = [];
  for (const ev of raw) {
    const id = String(ev?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(ev);
  }
  return out;
}

function normalizeScoreboardPayload(sb: any): any {
  if (!sb || typeof sb !== "object") return sb;
  const all = allEventsFromScoreboard(sb);
  // Only replace if we actually expanded the list
  if (Array.isArray(sb.events)) {
    sb.events = all;
  } else if (all.length) {
    sb.events = all;
  }
  return sb;
}


// liveScores.ts
type IndexGame = {
  game_id: string;
  start_utc?: string;
  A_espn?: { espn_id?: string };
  B_espn?: { espn_id?: string };
};

type GameIndex = Record<string, IndexGame[]>; // key: "123-987" (sorted pair), value: possible matches (rarely >1)

// Build a sorted pair key from two ESPN team IDs
const pairKey = (a?: string, b?: string) => {
  if (!a || !b) return '';
  const [x, y] = [String(a), String(b)].sort();
  return `${x}-${y}`;
};

// Build a lookup map from index.json contents
export function buildIndexByEspnPair(indexGames: IndexGame[]): GameIndex {
  const map: GameIndex = {};
  for (const g of indexGames) {
    const A = g.A_espn?.espn_id;
    const B = g.B_espn?.espn_id;
    if (A && B) {
      const k = pairKey(A, B);
      if (!k) continue;
      (map[k] ||= []).push(g);
    }
  }
  return map;
}

// Fallback: single-team key, to handle entries where one side lacks ESPN metadata
const singleKey = (id?: string) => (id ? `t:${id}` : '');

export function buildIndexBySingleTeam(indexGames: IndexGame[]): Record<string, IndexGame[]> {
  const map: Record<string, IndexGame[]> = {};
  for (const g of indexGames) {
    const A = g.A_espn?.espn_id;
    const B = g.B_espn?.espn_id;
    if (A) (map[singleKey(A)] ||= []).push(g);
    if (B) (map[singleKey(B)] ||= []).push(g);
  }
  return map;
}


function toSport(q: any): Sport {
  const s = String(q || "cfb").toLowerCase();
  return s === "cbb" ? "cbb" : "cfb";
}

// replace the existing espnUrl with:
function espnUrl(
    sport: Sport,
    dateYYYYMMDD: string,
    opts?: { groups?: string; limit?: number }
  ): string {
    const d = String(dateYYYYMMDD).replace(/-/g, "");
    const groups = opts?.groups;
    const limit  = String(opts?.limit ?? 3000); // default high

    if (sport === "cbb") {
      const g = groups ?? "50"; // Men's D-I
      return `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${d}&groups=${g}&limit=${limit}`;
    }

    // CFB
    const g = groups ?? "80,81"; // FBS + FCS
    return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${d}&groups=${g}&limit=${limit}`;
  }


function countLiveGames(payload: ScoreboardPayload): number {
  try {
    const events: any[] = allEventsFromScoreboard(payload);
    return events.filter((e) => e?.status?.type?.state === "in").length;
  } catch {
    return 0;
  }
}

function withParam(u: string, k: string, v: string | number) {
  const url = new URL(u);
  url.searchParams.set(k, String(v));
  return url.toString();
}

// Safely coerce possibly-missing arrays to real arrays
function collectArrays<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}


/** Fetch page 1..N and merge. Stops when:
 *  - page has 0 events, or
 *  - no new event ids appear, or
 *  - maxPages is reached (safety)
 */
async function fetchAllPages(baseUrl: string, maxPages = 8): Promise<any> {
  let merged: any = null;
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = withParam(baseUrl, "page", page);
    const raw = await fetchJsonWithTimeout(url);
    const norm = normalizeScoreboardPayload(raw);
    const evs = collectArrays<any>(norm.events);

    // First page: take the whole object as the scaffold
    if (!merged) merged = norm;
    // Merge events (dedupe by id)
    const fresh: any[] = [];
    for (const ev of evs) {
      const id = String(ev?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh.push(ev);
    }
    // If this page yielded nothing new, we’re done
    if (fresh.length === 0) break;

    // Append to merged.events
    merged.events = [...collectArrays<any>(merged.events), ...fresh];

    // Heuristic: ESPN often returns <=25 per page; if we got <25, assume last page
    if (evs.length < 25) break;
  }

  // Ensure final shape is normalized (events deduped, etc.)
  return normalizeScoreboardPayload(merged ?? {});
}



function ttlFor(liveCount: number): number {
  // Shorter TTL when there are live games, longer when there aren't.
  return liveCount > 0 ? 20_000 : 120_000;
}

// ESPN date helper – returns YYYYMMDD in America/New_York
function currentETDate(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}${m}${d}`;
}

async function fetchJsonWithTimeout(url: string, ms = 10_000): Promise<any> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);

  try {
    const resp: FetchResponse = await fetch(url, {
      signal: ctrl.signal as any,
      headers: {
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0",          // <-- add this
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}


// ----------------------------------------------------------------------------
// Simple in-memory cache for scoreboard payloads
// ----------------------------------------------------------------------------

const SCOREBOARD_CACHE = new Map<string, CacheEntry>();

// add param
async function getScoreboard(
  sport: Sport,
  dateYYYYMMDD: string,
  force = false,
  opts?: { groups?: string; limit?: number }
): Promise<ScoreboardPayload> {
  const cacheKey = `${sport}:${dateYYYYMMDD}:${opts?.groups ?? ""}:${opts?.limit ?? ""}`;
  const existing = SCOREBOARD_CACHE.get(cacheKey);
  const now = Date.now();

  if (!force && existing) {
    const age = now - existing.fetchedAt;
    const ttl = ttlFor(existing.liveCount);
    if (age < ttl) return existing.payload;
  }

  const url = espnUrl(sport, dateYYYYMMDD, opts);
  console.log("[scoreboard fetch base]", url);

  let payload = await fetchAllPages(url); // 👈 pull & merge pages

  // Optional: belt-and-suspenders retry if somehow still 25 with a big limit
  if ((payload?.events?.length ?? 0) <= 25 && (opts?.limit ?? 3000) > 25) {
    console.log("[scoreboard refetch] still small; retrying pages");
    payload = await fetchAllPages(url);
  }

  const liveCount = countLiveGames(payload);
  SCOREBOARD_CACHE.set(cacheKey, { sport, date: dateYYYYMMDD, payload, fetchedAt: now, liveCount });
  return payload;

  }



// ----------------------------------------------------------------------------
// SSE helpers
// ----------------------------------------------------------------------------

function sseSend(res: Response, data: any): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const clients: LiveClient[] = [];

// ----------------------------------------------------------------------------
// REST: /api/scoreboard
// ----------------------------------------------------------------------------

// app.get("/api/scoreboard", async (req: Request, res: Response) => {
//   try {
//     const sport = toSport(req.query.sport);
//     const date = (req.query.date as string) || currentETDate();

//     const payload = await getScoreboard(sport, date);
//     res.json({
//       sport,
//       date,
//       payload,
//       cached_at: new Date().toISOString(),
//     });
//   } catch (err: any) {
//     console.error("GET /api/scoreboard error", err?.message || err);
//     res.status(500).json({ error: "failed_to_fetch_scoreboard" });
//   }
// });

app.get("/api/scoreboard", async (req, res) => {
  const sport = toSport(req.query.sport);
  const date  = (req.query.date as string) || currentETDate();
  const force = String(req.query.fresh || "") === "1";
  const groups = (req.query.groups as string) || undefined;
  const limit  = Number(req.query.limit ?? 3000);

  const payload = await getScoreboard(sport, date, force, { groups, limit });
  res.json({ sport, date, payload, cached_at: new Date().toISOString() });
});


// ----------------------------------------------------------------------------
// SSE: /api/live
// ----------------------------------------------------------------------------

app.get("/api/live", async (req: Request, res: Response) => {
  const sport  = toSport(req.query.sport);
  const date   = (req.query.date as string) || currentETDate();
  const force  = String(req.query.fresh || "") === "1";
  const groups = (req.query.groups as string) || undefined;
  const limit  = Number(req.query.limit ?? 3000);

  // ...headers...

  // initial snapshot
  const snapshot = await getScoreboard(sport, date, force, { groups, limit });
  sseSend(res, { type: "hello", meta: { sport, date }, payload: snapshot });

  const intervalMs = 20_000;
  const timer = setInterval(async () => {
    const payload = await getScoreboard(sport, date, false, { groups, limit });
    sseSend(res, { type: "tick", meta: { sport, date }, payload });
  }, intervalMs);

  req.on("close", () => clearInterval(timer));
});


// ---- EXACT ESPN PASS-THROUGH (no cache, no wrapping) ----
app.get("/api/espn/scoreboard", async (req: Request, res: Response) => {
  try {
    // Accept both "date" (20251126 or 2025-11-26) and ESPN's "dates"
    const datesRaw = (req.query.dates as string) || (req.query.date as string) || currentETDate();
    const dates = String(datesRaw).replace(/-/g, "");

    // Allow caller to override groups/limit; default to men's D-I and 357 cap
    const groups = (req.query.groups as string) ?? "50";
    const limit  = (req.query.limit  as string) ?? "357";

    // Build ESPN URL 1:1
    const url = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard");
    url.searchParams.set("dates", dates);
    url.searchParams.set("groups", groups);
    url.searchParams.set("limit",  limit);

    // Fetch and return **exact** body (no mutation)
    const r = await fetch(url.toString(), {
      headers: {
        // ESPN sometimes behaves better with a UA; also disable upstream caching hints
        "user-agent": "Mozilla/5.0",
        "cache-control": "no-cache",
      },
    });

    const body = await r.text(); // keep text to avoid JSON re-stringify differences
    res
      .status(r.status)
      .set("Content-Type", r.headers.get("content-type") || "application/json")
      .set("Cache-Control", "no-store") // do not let proxies cache our proxy
      .send(body);

  } catch (err: any) {
    console.error("GET /api/espn/scoreboard error:", err?.message || err);
    res.status(502).json({ error: "espn_upstream_error" });
  }
});


// ----------------------------------------------------------------------------
// Static React build
// ----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "../../dist");

app.use(express.static(staticDir));

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

// ----------------------------------------------------------------------------
// Start
// ----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`liveScores listening on :${PORT}`);
});
