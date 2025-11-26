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

function espnUrl(sport: Sport, dateYYYYMMDD: string, groups?: string): string {
  const d = String(dateYYYYMMDD).replace(/-/g, "");

  if (sport === "cbb") {
    const g = groups || "50"; // Men's D-I
    const limit = 3000;
    return `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${d}&groups=${g}&limit=${limit}`;
  }

  // Default: CFB
  const g = groups || "80,81"; // FBS + FCS
  const limit = 3000;
  return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${d}&groups=${g}&limit=${limit}`;
}

function countLiveGames(payload: ScoreboardPayload): number {
  try {
    const events: any[] = payload?.events ?? [];
    return events.filter((e) => e?.status?.type?.state === "in").length;
  } catch {
    return 0;
  }
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
      },
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}

// ----------------------------------------------------------------------------
// Simple in-memory cache for scoreboard payloads
// ----------------------------------------------------------------------------

const SCOREBOARD_CACHE = new Map<string, CacheEntry>();

async function getScoreboard(
  sport: Sport,
  dateYYYYMMDD: string
): Promise<ScoreboardPayload> {
  const key = `${sport}:${dateYYYYMMDD}`;
  const existing = SCOREBOARD_CACHE.get(key);
  const now = Date.now();

  if (existing) {
    const age = now - existing.fetchedAt;
    const ttl = ttlFor(existing.liveCount);
    if (age < ttl) {
      return existing.payload;
    }
  }

  const url = espnUrl(sport, dateYYYYMMDD);
  const payload = (await fetchJsonWithTimeout(url)) as ScoreboardPayload;
  const liveCount = countLiveGames(payload);

  SCOREBOARD_CACHE.set(key, {
    sport,
    date: dateYYYYMMDD,
    payload,
    fetchedAt: now,
    liveCount,
  });

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

app.get("/api/scoreboard", async (req: Request, res: Response) => {
  try {
    const sport = toSport(req.query.sport);
    const date = (req.query.date as string) || currentETDate();

    const payload = await getScoreboard(sport, date);
    res.json({
      sport,
      date,
      payload,
      cached_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("GET /api/scoreboard error", err?.message || err);
    res.status(500).json({ error: "failed_to_fetch_scoreboard" });
  }
});

// ----------------------------------------------------------------------------
// SSE: /api/live
// ----------------------------------------------------------------------------

app.get("/api/live", async (req: Request, res: Response) => {
  const sport = toSport(req.query.sport);
  const date = (req.query.date as string) || currentETDate();
  const key = `${sport}:${date}`;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    Vary: "sport, date",
  });
  (res as any).flushHeaders?.();

  const id = crypto.randomUUID();
  const client: LiveClient = { id, res, sport, date };
  clients.push(client);

  // Send initial snapshot
  try {
    const snapshot = await getScoreboard(sport, date);
    sseSend(res, { type: "hello", meta: { sport, date, key }, payload: snapshot });
  } catch (err: any) {
    console.error("SSE hello error", err?.message || err);
  }

  // Periodic polling loop per client
  const intervalMs = 20_000;
  const timer = setInterval(async () => {
    try {
      const payload = await getScoreboard(sport, date);
      sseSend(res, { type: "tick", meta: { sport, date, key }, payload });
    } catch (err: any) {
      console.error("SSE tick error", err?.message || err);
    }
  }, intervalMs);

  req.on("close", () => {
    clearInterval(timer);
    const idx = clients.findIndex((c) => c.id === id);
    if (idx >= 0) {
      clients.splice(idx, 1);
    }
  });
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
