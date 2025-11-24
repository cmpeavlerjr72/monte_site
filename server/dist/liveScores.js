// server/dist/liveScores.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import compression from "compression";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8080;

// ---- in-memory state ----
const memCache = new Map(); // key: espn:${sport}:${date} -> { ts, ttl, hash, payload, liveCount }
const clients = [];         // { id, res, sport, date }
const POLL_KEYS = new Set();// keys like "cfb:20251103" or "cbb:20251103"

const jsonHash = (obj) => crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex");
const now = () => Date.now();

function espnUrl(sport, dateYYYYMMDD, groups) {
  const d = String(dateYYYYMMDD).replace(/-/g, "");
  if (sport === "cbb") {
    const g = groups || "50"; // Men's D-I
    const limit = 3000;
    return `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${d}&groups=${g}&limit=${limit}`;
  }
  const g = groups || "80,81"; // FBS + FCS
  const limit = 3000;
  return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${d}&groups=${g}&limit=${limit}`;
}


function countLiveGames(payload) {
  try {
    const events = payload?.events ?? [];
    return events.filter((e) => e?.status?.type?.state === "in").length;
  } catch {
    return 0;
  }
}
function ttlFor(liveCount) {
  return liveCount > 0 ? 20_000 : 120_000;
}

function currentETDate() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = fmt.formatToParts(new Date());
  const y = p.find((x) => x.type === "year").value;
  const m = p.find((x) => x.type === "month").value;
  const d = p.find((x) => x.type === "day").value;
  return `${y}${m}${d}`;
}

function toSport(q) {
  const s = String(q || "cfb").toLowerCase();
  return s === "cbb" ? "cbb" : "cfb";
}

// fetch with timeout (node-fetch v3)
async function fetchJsonWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { "cache-control": "no-cache" } });
    if (!resp.ok) throw new Error(`ESPN ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}

// Cache-on-read fetcher per sport+date
async function getScoreboard(sport, date) {
  const key = `espn:${sport}:${date}`;
  const cached = memCache.get(key);
  if (cached && now() - cached.ts < cached.ttl) return cached.payload;

  const url = espnUrl(sport, date);
  const payload = await fetchJsonWithTimeout(url);
  const hash = jsonHash(payload);
  const liveCount = countLiveGames(payload);
  const ttl = ttlFor(liveCount);

  memCache.set(key, { ts: now(), ttl, hash, payload, liveCount, url });
  return payload;
}

// ---------- REST (pull) ----------
app.get("/api/scoreboard", async (req, res) => {
  try {
    const sport = toSport(req.query.sport);
    const date = req.query.date || currentETDate();
    const payload = await getScoreboard(sport, date);
    res.json({ sport, date, payload, cached_at: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e?.message ?? "Fetch failed" });
  }
});

// ---------- SSE (push) ----------
app.get("/api/live", async (req, res) => {
  const sport = toSport(req.query.sport);
  const date = req.query.date || currentETDate();
  const key = `${sport}:${date}`;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Vary": "sport, date",
  });
  res.flushHeaders?.();

  const id = crypto.randomUUID();
  const client = { id, res, sport, date };
  clients.push(client);
  POLL_KEYS.add(key);

  try {
    const snapshot = await getScoreboard(sport, date);
    sseSend(res, { type: "hello", meta: { sport, date, key }, payload: snapshot });
  } catch { /* ignore */ }

  req.on("close", () => {
    const idx = clients.findIndex((c) => c.id === id);
    if (idx >= 0) clients.splice(idx, 1);
    if (!clients.some((c) => c.sport === sport && c.date === date)) {
      POLL_KEYS.delete(key);
    }
  });
});

// Gzip all responses except SSE
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    const isSSE = req.path?.startsWith("/api/live") ||
      req.headers.accept?.includes("text/event-stream");
    if (isSSE) return false;
    return compression.filter(req, res);
  },
}));

function sseSend(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function broadcast(key, data) {
  const [sport, date] = key.split(":");
  clients
    .filter((c) => c.sport === sport && c.date === date)
    .forEach((c) => sseSend(c.res, data));
}

// Proactive refresher per sport:date
setInterval(async () => {
  for (const key of POLL_KEYS) {
    try {
      const [sport, date] = key.split(":");
      const cacheKey = `espn:${sport}:${date}`;
      const before = memCache.get(cacheKey);
      const payload = await getScoreboard(sport, date);
      const after = memCache.get(cacheKey);
      if (!before || (after && before.hash !== after.hash)) {
        broadcast(key, { type: "scoreboard", meta: { sport, date, key }, payload });
      }
    } catch {
      // ignore; try next tick
    }
  }
}, 5_000);

// ---------- Serve React build from /dist ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "../../dist");
app.use(express.static(staticDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`liveScores listening on :${PORT}`);
});
