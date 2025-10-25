import express, { Request, Response } from "express";
import cors from "cors";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

// ---------- Express basic ----------
const app = express();
app.use(cors());
const PORT = process.env.PORT || 8080;

// ---------- Helpers ----------
type CacheEntry = {
  ts: number;          // ms
  ttl: number;         // ms
  hash: string;
  payload: any;
  liveCount: number;
};
const memCache = new Map<string, CacheEntry>();
type Client = { id: string; res: Response; date: string };
const clients: Client[] = [];
const POLL_KEYS = new Set<string>();

const jsonHash = (obj: any) =>
  crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex");
const now = () => Date.now();

function espnUrl(dateYYYYMMDD: string, groups = "80") {
  return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${groups}&dates=${dateYYYYMMDD}`;
}

function countLiveGames(payload: any): number {
  try {
    const events = payload?.events ?? [];
    return events.filter((e: any) => e?.status?.type?.state === "in").length;
  } catch {
    return 0;
  }
}
function ttlFor(liveCount: number) {
  return liveCount > 0 ? 20_000 : 120_000;
}
function currentETDate() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = fmt.formatToParts(new Date());
  const y = p.find((x) => x.type === "year")!.value;
  const m = p.find((x) => x.type === "month")!.value;
  const d = p.find((x) => x.type === "day")!.value;
  return `${y}${m}${d}`;
}

// fetch with timeout (node-fetch v3)
async function fetchJsonWithTimeout(url: string, ms = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`ESPN ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}

// Cache-on-read fetcher
async function getScoreboard(date: string) {
  const key = `espn:cfb:${date}`;
  const cached = memCache.get(key);
  if (cached && now() - cached.ts < cached.ttl) return cached.payload;

  const payload = await fetchJsonWithTimeout(espnUrl(date));
  const hash = jsonHash(payload);
  const liveCount = countLiveGames(payload);
  const ttl = ttlFor(liveCount);
  memCache.set(key, { ts: now(), ttl, hash, payload, liveCount });
  return payload;
}

// ---------- REST (pull) ----------
app.get("/api/scoreboard", async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || currentETDate();
    const payload = await getScoreboard(date);
    res.json({ date, payload, cached_at: new Date().toISOString() });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Fetch failed" });
  }
});

// ---------- SSE (push) ----------
app.get("/api/live", async (req: Request, res: Response) => {
  const date = (req.query.date as string) || currentETDate();
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const id = crypto.randomUUID();
  const client: Client = { id, res, date };
  clients.push(client);
  POLL_KEYS.add(date);

  try {
    const snapshot = await getScoreboard(date);
    sseSend(res, { type: "hello", date, payload: snapshot });
  } catch { /* ignore */ }

  req.on("close", () => {
    const idx = clients.findIndex((c) => c.id === id);
    if (idx >= 0) clients.splice(idx, 1);
    if (!clients.some((c) => c.date === date)) POLL_KEYS.delete(date);
  });
});

function sseSend(res: Response, data: any) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function broadcast(date: string, data: any) {
  clients.filter((c) => c.date === date).forEach((c) => sseSend(c.res, data));
}

// Proactive refresher (optional but nice when clients are connected)
setInterval(async () => {
  for (const date of POLL_KEYS) {
    try {
      const key = `espn:cfb:${date}`;
      const before = memCache.get(key);
      const payload = await getScoreboard(date);
      const after = memCache.get(key);
      if (!before || (after && before.hash !== after.hash)) {
        broadcast(date, { type: "scoreboard", date, payload });
      }
    } catch { /* retry next tick */ }
  }
}, 5_000);

// ---------- Serve React build from /dist ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "../../dist");
app.use(express.static(staticDir));
app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`liveScores listening on :${PORT}`);
});
