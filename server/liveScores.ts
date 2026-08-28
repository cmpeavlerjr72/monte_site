// server/liveScores.ts
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import fetch, { Response as FetchResponse } from "node-fetch";
import AbortController from "abort-controller";
import compression from "compression";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Pure, so scripts/check_fcs_names.mjs can verify the Kalshi join against the
// real FBS + FCS school lists without booting this server.
import { cfbNameKey, pairKeyOf } from "./cfbNames.js";

type Sport = "cfb" | "cbb" | "mlb";

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
// JSON body parser for transcription ingest (small payloads; cap at 128 KB)
app.use(express.json({ limit: "128kb" }));

const PORT = process.env.PORT || 8080;

// ----------------------------------------------------------------------------
// Process-level safety net
//
// Every 502 this box has served traces back to the process dying, not to a
// route returning an error: one rejected upstream fetch inside an async route
// (or worse, inside the /api/live setInterval, which nothing could ever catch)
// becomes an unhandledRejection, and Node >= 15 turns that into an exit. The
// host restarts us, but every in-flight request in that window is a 502 from
// the edge proxy. Log and keep serving instead — a degraded endpoint beats a
// dead server, and /healthz below makes the degradation visible.
// ----------------------------------------------------------------------------

process.on("unhandledRejection", (reason: any) => {
  console.error(
    "[unhandledRejection]",
    reason?.stack || reason?.message || reason
  );
});

process.on("uncaughtException", (err: any) => {
  console.error("[uncaughtException]", err?.stack || err?.message || err);
});

/** Wrap an async route so a rejection becomes next(err), not a process exit. */
function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Liveness/readiness probe. Cheap, never touches an upstream, and reports the
// counters that historically preceded an OOM kill.
app.get("/healthz", (_req: Request, res: Response) => {
  const mem = process.memoryUsage();
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    rss_mb: Math.round(mem.rss / 1048576),
    heap_mb: Math.round(mem.heapUsed / 1048576),
    scoreboard_cache: SCOREBOARD_CACHE.size,
    scoreboard_inflight: SCOREBOARD_INFLIGHT.size,
    sse_clients: sseClients,
    tx_entries: txEntries.length,
    now: new Date().toISOString(),
  });
});

// ----------------------------------------------------------------------------
// NASCAR scanner transcription — ingested from user's local PC, served to browsers
// ----------------------------------------------------------------------------
//
// Flow: user's PC runs Whisper on each driver's HLS feed and POSTs transcripts
// here. Browsers (including mobile) poll GET to receive them. Transcripts are
// ephemeral — we keep the most recent N entries per stream_number in memory.
// No database; if the server restarts, scrollback is lost but live keeps flowing.

interface TxEntry {
  id: number;              // monotonic per-server entry id (for "since" queries)
  streamNumber: number;    // matches NASCAR audio_config.stream_number
  text: string;
  timestamp: number;       // ms since epoch, wall clock on the PC worker
  series: number;          // 1=cup, 2=xfinity, 3=trucks
}

const TX_INGEST_TOKEN = process.env.TX_INGEST_TOKEN || "";
const TX_MAX_ENTRIES = 500;        // ring buffer size across all streams
const TX_MAX_AGE_MS = 30 * 60_000; // drop anything older than 30 min

const txEntries: TxEntry[] = [];
let txNextId = 1;

function pruneOldTx() {
  const cutoff = Date.now() - TX_MAX_AGE_MS;
  // Single pass: drop old and trim to cap
  let writeIdx = 0;
  for (let i = 0; i < txEntries.length; i++) {
    if (txEntries[i].timestamp >= cutoff) {
      txEntries[writeIdx++] = txEntries[i];
    }
  }
  txEntries.length = writeIdx;
  if (txEntries.length > TX_MAX_ENTRIES) {
    txEntries.splice(0, txEntries.length - TX_MAX_ENTRIES);
  }
}

// POST /api/tx/ingest   body: { streamNumber, text, timestamp?, series }
// Auth: header "x-tx-token" must match TX_INGEST_TOKEN env var
app.post("/api/tx/ingest", (req, res) => {
  if (!TX_INGEST_TOKEN) {
    return res.status(503).json({ error: "ingest_not_configured" });
  }
  const token = req.header("x-tx-token") || "";
  if (token !== TX_INGEST_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const body = req.body as Partial<TxEntry> | Partial<TxEntry>[] | undefined;
  const items = Array.isArray(body) ? body : body ? [body] : [];
  if (items.length === 0) {
    return res.status(400).json({ error: "empty_body" });
  }

  let accepted = 0;
  for (const raw of items) {
    const streamNumber = Number(raw?.streamNumber);
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    const series = Number(raw?.series);
    const timestamp = Number(raw?.timestamp) || Date.now();
    if (!Number.isFinite(streamNumber) || !text || !Number.isFinite(series)) continue;
    if (text.length > 1000) continue; // sanity cap per entry
    txEntries.push({
      id: txNextId++,
      streamNumber,
      text,
      timestamp,
      series,
    });
    accepted++;
  }
  pruneOldTx();
  res.json({ accepted, total: txEntries.length, lastId: txNextId - 1 });
});

// GET /api/tx/stream?since=<id>&series=<1|2|3>&streams=<csv of stream_numbers>
// Returns transcripts with id > since, filtered by series and (optionally) streams.
app.get("/api/tx/stream", (req, res) => {
  const since = Number(req.query.since) || 0;
  const series = Number(req.query.series) || 0;
  const streamsRaw = String(req.query.streams || "").trim();
  const streamFilter = streamsRaw
    ? new Set(streamsRaw.split(",").map((s) => Number(s)).filter(Number.isFinite))
    : null;

  pruneOldTx();

  const out: TxEntry[] = [];
  for (const e of txEntries) {
    if (e.id <= since) continue;
    if (series && e.series !== series) continue;
    if (streamFilter && !streamFilter.has(e.streamNumber)) continue;
    out.push(e);
  }

  // Cap response size
  const MAX_RETURN = 200;
  const trimmed = out.length > MAX_RETURN ? out.slice(-MAX_RETURN) : out;
  const lastId = txEntries.length > 0 ? txEntries[txEntries.length - 1].id : since;

  res.set("Cache-Control", "no-store");
  res.json({ entries: trimmed, lastId });
});

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
  if (s === "cbb") return "cbb";
  if (s === "mlb") return "mlb";
  return "cfb";
}

// ----------------------------------------------------------------------------
// Query sanitizers.
//
// sport/date/groups/limit all feed the scoreboard cache key. Left raw, any
// caller can mint unlimited distinct keys (each holding a multi-MB ESPN
// payload) and walk us into an OOM kill. Normalizing them bounds the key space
// to something the LRU below can actually hold.
// ----------------------------------------------------------------------------

/** YYYYMMDD, or today in ET if the caller sent anything else. */
function normDate(raw: any): string {
  const d = String(raw ?? "").replace(/-/g, "").trim();
  return /^\d{8}$/.test(d) ? d : currentETDate();
}

/** ESPN group ids are digits and commas; anything else is dropped. */
function normGroups(raw: any): string | undefined {
  const g = String(raw ?? "").trim();
  if (!g) return undefined;
  return /^[0-9]{1,4}(,[0-9]{1,4}){0,8}$/.test(g) ? g : undefined;
}

function clampLimit(raw: any, dflt = 3000): number {
  const n = Number(raw ?? dflt);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(3000, Math.max(1, Math.trunc(n)));
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

    if (sport === "mlb") {
      return `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${d}&limit=${limit}`;
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



/**
 * ESPN's multi-group scoreboard (`groups=80,81`) returns STUB events — `{}`,
 * no id, no competitors — whenever one of the groups has no games that date.
 * Observed 2026-08-27, an FCS-only Thursday: `groups=81` alone answered all
 * 22 games fully populated while `80,81` served 22 empty objects (any limit,
 * range form included). fetchAllPages drops id-less events, so the merged
 * payload came back EMPTY on exactly the nights only one division plays —
 * FCS Thursdays/Fridays. Fetch each group separately and merge instead.
 */
async function fetchScoreboardMerged(
  sport: Sport,
  dateYYYYMMDD: string,
  opts?: { groups?: string; limit?: number }
): Promise<any> {
  const effGroups = sport === "cfb" ? opts?.groups ?? "80,81" : opts?.groups;
  const parts = (effGroups ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (sport !== "cfb" || parts.length <= 1) {
    const url = espnUrl(sport, dateYYYYMMDD, opts);
    console.log("[scoreboard fetch base]", url);
    return fetchAllPages(url);
  }

  const walks = await Promise.all(
    parts.map(async (g) => {
      const url = espnUrl(sport, dateYYYYMMDD, { ...opts, groups: g });
      console.log("[scoreboard fetch group]", url);
      try {
        return await fetchAllPages(url);
      } catch (err) {
        console.warn(`[scoreboard] group ${g} walk failed:`, err);
        return null;
      }
    })
  );

  let scaffold: any = null;
  const events: any[] = [];
  const seen = new Set<string>();
  for (const p of walks) {
    if (!p) continue;
    if (!scaffold) scaffold = p;
    for (const ev of collectArrays<any>(p.events)) {
      const id = String(ev?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      events.push(ev);
    }
  }
  if (!scaffold) throw new Error("scoreboard: every group walk failed");

  // Kickoff order, so the merged slate is stable across group boundaries.
  events.sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")));
  scaffold.events = events;
  return scaffold;
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

/**
 * fetch() with a hard deadline. node-fetch has no default timeout, so without
 * this a hung upstream socket pins a request open until the edge proxy gives
 * up on us — which the browser sees as a 502/504.
 */
async function fetchWithTimeout(
  url: string,
  init: Record<string, any> = {},
  ms = 15_000
): Promise<FetchResponse> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return (await fetch(url, { ...init, signal: ctrl.signal as any })) as FetchResponse;
  } finally {
    clearTimeout(id);
  }
}

async function fetchJsonWithTimeout(url: string, ms = 10_000): Promise<any> {
  const resp = await fetchWithTimeout(
    url,
    {
      headers: {
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0",
      },
    },
    ms
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}


// ----------------------------------------------------------------------------
// Bounded in-memory cache for scoreboard payloads
//
// Was an unbounded Map keyed on user-supplied query params, holding merged
// multi-MB ESPN payloads forever. Now: insertion-order LRU with a hard cap,
// plus in-flight coalescing so a cold cache under load runs ONE upstream page
// walk instead of one per concurrent request (the stampede that used to get us
// rate-limited by ESPN, which then threw, which then killed the process).
// ----------------------------------------------------------------------------

const SCOREBOARD_CACHE = new Map<string, CacheEntry>();
const SCOREBOARD_CACHE_MAX = 24;
const SCOREBOARD_INFLIGHT = new Map<string, Promise<ScoreboardPayload>>();

function scoreboardCacheSet(key: string, entry: CacheEntry): void {
  if (SCOREBOARD_CACHE.has(key)) SCOREBOARD_CACHE.delete(key);
  SCOREBOARD_CACHE.set(key, entry);
  while (SCOREBOARD_CACHE.size > SCOREBOARD_CACHE_MAX) {
    const oldest = SCOREBOARD_CACHE.keys().next().value;
    if (oldest === undefined) break;
    SCOREBOARD_CACHE.delete(oldest);
  }
}

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

  // Someone else is already walking this exact key upstream — ride along.
  const pending = SCOREBOARD_INFLIGHT.get(cacheKey);
  if (pending) return pending;

  const work = (async () => {
    // Per-group walk + merge (see fetchScoreboardMerged for the ESPN stub bug
    // this works around).
    let payload = await fetchScoreboardMerged(sport, dateYYYYMMDD, opts);

    // Retry only on a genuinely empty first walk. The old condition (<= 25
    // events) refetched every small slate, doubling cold-start latency and
    // upstream load for no gain.
    if ((payload?.events?.length ?? 0) === 0) {
      console.log("[scoreboard refetch] empty result; retrying pages");
      payload = await fetchScoreboardMerged(sport, dateYYYYMMDD, opts);
    }

    const liveCount = countLiveGames(payload);
    scoreboardCacheSet(cacheKey, {
      sport,
      date: dateYYYYMMDD,
      payload,
      fetchedAt: Date.now(),
      liveCount,
    });
    return payload;
  })();

  SCOREBOARD_INFLIGHT.set(cacheKey, work);
  try {
    return await work;
  } catch (err) {
    // Serve a stale payload rather than an error when we have one: a blip at
    // ESPN should degrade the scoreboard, not blank it.
    if (existing) {
      console.warn(
        `[scoreboard] upstream failed for ${cacheKey}, serving stale (${Math.round(
          (Date.now() - existing.fetchedAt) / 1000
        )}s old):`,
        (err as any)?.message ?? err
      );
      return existing.payload;
    }
    throw err;
  } finally {
    SCOREBOARD_INFLIGHT.delete(cacheKey);
  }
}



// ----------------------------------------------------------------------------
// SSE helpers
// ----------------------------------------------------------------------------

/** Write one SSE frame. Never throws — a dead socket is not an exception. */
function sseSend(res: Response, data: any): boolean {
  try {
    return res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (err: any) {
    console.warn("[sse] write failed:", err?.message ?? err);
    return false;
  }
}

const clients: LiveClient[] = [];

// Bound the number of open SSE streams. Each one owns two timers and a 20s
// upstream poll; unbounded, a crawler holding connections open multiplies our
// ESPN traffic until we get throttled.
const SSE_MAX_CLIENTS = 50;
let sseClients = 0;

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

// NOTE: asyncRoute is load-bearing. This handler used to be a bare `async` fn,
// so any ESPN failure (timeout, 5xx, rate limit) rejected with nothing
// attached -> unhandledRejection -> process exit -> 502 on every route,
// including the /api/data proxy the CFB scoreboard page depends on.
app.get(
  "/api/scoreboard",
  asyncRoute(async (req, res) => {
    const sport = toSport(req.query.sport);
    const date = normDate(req.query.date);
    const force = String(req.query.fresh || "") === "1";
    const groups = normGroups(req.query.groups);
    const limit = clampLimit(req.query.limit);

    try {
      const payload = await getScoreboard(sport, date, force, { groups, limit });
      res.json({ sport, date, payload, cached_at: new Date().toISOString() });
    } catch (err: any) {
      const timedOut = err?.name === "AbortError";
      console.error(
        `[/api/scoreboard] ${sport} ${date} failed:`,
        err?.message ?? err
      );
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "scoreboard_upstream_timeout" : "scoreboard_upstream_error",
        sport,
        date,
      });
    }
  })
);


// ----------------------------------------------------------------------------
// SSE: /api/live
// ----------------------------------------------------------------------------

// This route was the single most reliable way to kill the process:
//   1. the `await getScoreboard(...)` snapshot rejected with no catch, and
//   2. the setInterval callback was `async`, so its rejection could not be
//      caught by ANYTHING — it fired every 20s per connected client forever.
// It also never sent SSE headers (the `// ...headers...` stub), so
// compression() buffered the stream and the edge proxy eventually 502'd the
// hung response. Both are fixed below.
app.get("/api/live", (req: Request, res: Response) => {
  const sport = toSport(req.query.sport);
  const date = normDate(req.query.date);
  const force = String(req.query.fresh || "") === "1";
  const groups = normGroups(req.query.groups);
  const limit = clampLimit(req.query.limit);

  if (sseClients >= SSE_MAX_CLIENTS) {
    res.status(503).json({ error: "too_many_live_clients" });
    return;
  }

  // `no-transform` tells compression() to leave the stream alone;
  // `X-Accel-Buffering: no` does the same for an nginx front end.
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  sseClients++;

  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    sseClients = Math.max(0, sseClients - 1);
    if (timer) clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    timer = null;
    heartbeat = null;
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);

  const push = async (type: "hello" | "tick") => {
    if (closed) return;
    try {
      const payload = await getScoreboard(sport, date, type === "hello" && force, {
        groups,
        limit,
      });
      if (!closed) sseSend(res, { type, meta: { sport, date }, payload });
    } catch (err: any) {
      // Report upstream trouble down the stream; the client falls back to
      // /api/scoreboard on its own. Do NOT let this escape.
      console.error(`[/api/live] ${type} failed (${sport} ${date}):`, err?.message ?? err);
      if (!closed) {
        sseSend(res, {
          type: "error",
          meta: { sport, date },
          error: String(err?.message ?? err),
        });
      }
    }
  };

  void push("hello");
  timer = setInterval(() => { void push("tick"); }, 20_000);
  // Keeps idle proxies from reaping the connection at 30-60s.
  heartbeat = setInterval(() => {
    if (closed) return;
    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, 25_000);
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
    const r = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          // ESPN sometimes behaves better with a UA; also disable upstream caching hints
          "user-agent": "Mozilla/5.0",
          "cache-control": "no-cache",
        },
      },
      15_000
    );

    const body = await r.text(); // keep text to avoid JSON re-stringify differences
    res
      .status(r.status)
      .set("Content-Type", r.headers.get("content-type") || "application/json")
      .set("Cache-Control", "no-store") // do not let proxies cache our proxy
      .send(body);

  } catch (err: any) {
    console.error("GET /api/espn/scoreboard error:", err?.message || err);
    if (res.headersSent) { res.end(); return; }
    const timedOut = err?.name === "AbortError";
    res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "espn_upstream_timeout" : "espn_upstream_error" });
  }
});


// ----------------------------------------------------------------------------
// Hugging Face dataset pass-through
//
// Some school/office networks block huggingface.co outright. Serving the data
// from our own origin means a visitor who can load the site can always load the
// data. Repos are allowlisted so this cannot be used as an open relay.
// ----------------------------------------------------------------------------

const HF_OWNER = "mvpeav";

// Frozen archives -> cache forever. Live-season repos -> short TTL.
const HF_ARCHIVE_REPOS = new Set<string>([
  "cfb-sims-2025",
]);
const HF_LIVE_REPOS = new Set<string>([
  // 2026 CFB sims: in-season, re-uploaded weekly -> live set (5-min TTL).
  // 2025 stays in HF_ARCHIVE_REPOS above and is cached forever.
  "cfb-sims-2026",
  // FCS 2026 sims: separate public dataset, root dir "fcs-2026". The client
  // passes the namespace "fcs-2026" wherever a season goes, which makes
  // repoForSeason() produce this name — no other fetch-layer change needed.
  "cfb-sims-fcs-2026",
  "cfb-playoff-compacts-2026",
  "cbb-sims-2026",
  "mlb-sims-2026",
  "nascar-predictions",
  "tennis-predictions",
]);

/** TTFB deadline for the Hub. Cleared once headers land so a slow large CSV
 *  body is never cut off mid-stream. */
const HF_TTFB_TIMEOUT_MS = 15_000;

app.get(
  "/api/data/:repo/*",
  asyncRoute(async (req: Request, res: Response) => {
    const repo = String(req.params.repo || "");
    const isArchive = HF_ARCHIVE_REPOS.has(repo);
    if (!isArchive && !HF_LIVE_REPOS.has(repo)) {
      res.status(404).json({ error: "unknown_dataset", repo });
      return;
    }

    // Everything after /api/data/<repo>/ is the path inside the dataset.
    const rest = (req.params as Record<string, string>)[0] || "";
    if (rest.includes("..") || rest.startsWith("/")) {
      res.status(400).json({ error: "bad_path" });
      return;
    }

    const upstream =
      `https://huggingface.co/datasets/${HF_OWNER}/${repo}/resolve/main/` +
      rest.split("/").map(encodeURIComponent).join("/");

    try {
      const headers: Record<string, string> = { "user-agent": "monte-site-proxy" };
      // Let the browser revalidate instead of re-downloading unchanged files.
      const inm = req.headers["if-none-match"];
      if (typeof inm === "string") headers["if-none-match"] = inm;

      const r = await fetchWithTimeout(
        upstream,
        { headers, redirect: "follow" },
        HF_TTFB_TIMEOUT_MS
      );

      if (r.status === 304) {
        res.status(304).end();
        return;
      }
      if (!r.ok) {
        // Forward upstream 4xx as-is. A dataset that has not been published
        // (or is still private) answers 401/403/404 — that is "not there",
        // not a gateway fault, and the client's season fallback depends on
        // being able to tell the difference. 5xx/network still map to 502.
        const status = r.status >= 400 && r.status < 500 ? r.status : 502;
        res
          .status(status)
          .json({ error: "dataset_upstream_error", status: r.status, path: rest });
        return;
      }

      const ct = r.headers.get("content-type");
      if (ct) res.set("Content-Type", ct);
      const etag = r.headers.get("etag");
      if (etag) res.set("ETag", etag);
      // Deliberately not forwarding Content-Length/Content-Encoding: the Hub
      // gzips these CSVs and node-fetch decompresses them, so the upstream length
      // describes bytes we are no longer sending. Let compression() re-encode.

      res.set(
        "Cache-Control",
        isArchive
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300, stale-while-revalidate=600"
      );

      if (!r.body) {
        res.end();
        return;
      }

      // pipe() with no 'error' listener on either side is an uncaught
      // exception waiting to happen: a Hub reset mid-body, or an EPIPE when
      // the browser navigates away, used to take the whole process down.
      const body = r.body as unknown as NodeJS.ReadableStream;

      body.on("error", (err: any) => {
        console.error(`[/api/data] upstream body error ${repo}/${rest}:`, err?.message ?? err);
        if (res.headersSent) res.destroy(err);
        else res.status(502).json({ error: "dataset_stream_error", path: rest });
      });

      res.on("error", (err: any) => {
        console.warn(`[/api/data] client stream error ${repo}/${rest}:`, err?.message ?? err);
        (body as any).destroy?.();
      });

      // Client hung up (tab closed, navigation) — stop pulling from the Hub.
      res.on("close", () => {
        if (!res.writableEnded) (body as any).destroy?.();
      });

      body.pipe(res);
    } catch (err: any) {
      console.error(`GET /api/data/${repo}/${rest} error:`, err?.message || err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const timedOut = err?.name === "AbortError";
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "dataset_upstream_timeout" : "dataset_upstream_error",
        path: rest,
      });
    }
  })
);

// ----------------------------------------------------------------------------
// Kalshi CFB market data
//
// Read-only market data for the current CFB slate, mapped onto OUR game slugs
// so the scoreboard can print market-implied numbers beside the sim's.
//
// AUTH: none for THIS section. Kalshi's market-data endpoints (/series,
// /events, /markets) serve unauthenticated, which is all this route needs.
// (Historical note: this repo once guaranteed "no credentials anywhere"; the
// owner-only portfolio portal below deliberately amended that on 2026-08-26 —
// creds live in deployment env vars only, never in code, and market data here
// remains credential-free.) If Kalshi ever gates these endpoints this route
// degrades to {available:false, reason:"upstream_unavailable"}.
//
// Three series carry a game (all share one event suffix, e.g. 26AUG29UNCTCU):
//   KXNCAAFGAME-<suffix>    one binary market per team  -> winner
//   KXNCAAFTOTAL-<suffix>   ladder of "Over X.5 points" -> total
//   KXNCAAFSPREAD-<suffix>  ladder of "<Team> wins by over X.5" -> spread
// ----------------------------------------------------------------------------

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_GAME_SERIES = "KXNCAAFGAME";
const KALSHI_TTL_MS = 45_000;

type KalshiSide = { line: number | null; yes_price: number | null };

/**
 * One rung of a strike ladder.
 *
 * total:  line = points, yes_price = P(total OVER line)
 * spread: line is HOME-perspective (negative = home favored),
 *         yes_price = P(home covers that line)
 *
 * The client needs the whole ladder, not just the market's own line, so it can
 * price the exact bet the BOOK is offering rather than whichever rung Kalshi
 * happens to be centred on.
 */
type KalshiRung = { line: number; yes_price: number };

/**
 * Per-team STAT ladders (KXNCAAFTEAM*), added 2026-08-28 so the Team Stats
 * panel prices LIVE instead of off a daily published snapshot.
 *
 * `stat` is our team_stats.json key, so the client joins by (stat, side,
 * strike) and never re-derives a probability. Both sides of the book travel
 * because the panel's quality gate is "is this book real?" — a one-sided
 * quote or a >30c spread suppresses the edge badge — and a midpoint alone
 * cannot answer that.
 *
 * KXNCAAFTEAMTD / TEAMFG / TEAMTO are deliberately EXCLUDED: team-TD counts
 * defensive and return scores the sim does not produce (our number is only a
 * floor), and FG / turnovers are not simulated at all.
 */
const KALSHI_STAT_SERIES: Record<string, string> = {
  // Team points. Already fetched above for the game-level total, but this is
  // the PER-TEAM ladder and it is the most-traded of the lot — the panel's
  // first row would otherwise be the only one with no live prices at all.
  KXNCAAFTEAMTOTAL: "points",
  KXNCAAFTEAMRECYDS: "rec_yards",
  KXNCAAFTEAMRSHYDS: "rush_yards",
  KXNCAAFTEAMYDS: "total_yards",
  KXNCAAFTEAMREC: "receptions",
  KXNCAAFTEAMRSHATT: "rush_att",
  KXNCAAFTEAMRSHTD: "rush_td",
  KXNCAAFTEAMRECTD: "rec_td",
  KXNCAAFTEAMSACK: "def_sacks",
  KXNCAAFTEAMINT: "def_ints",
};

/** The school a stat-market subtitle names, with the strike phrase stripped. */
function statMarketTeam(subTitle: unknown): string {
  const s = String(subTitle ?? "").trim();
  const colon = s.indexOf(":");
  if (colon > 0) return s.slice(0, colon);
  const over = s.match(/^(.+?)\s+over\s+[\d.]+\s+points scored$/i);
  return over ? over[1] : s;
}

type KalshiStatQuote = {
  /** team_stats.json stat key. */
  stat: string;
  /** Which side of THIS game — resolved server-side, so no client name join. */
  side: "A" | "B";
  strike: number;
  yes_bid: number | null;
  yes_ask: number | null;
};

type KalshiGame = {
  slug: string;
  event_ticker: string;
  winner: { teamA_price: number | null; teamB_price: number | null };
  total: KalshiSide;
  spread: KalshiSide;
  /** Full ladders, so the client can match the book's line exactly. */
  total_ladder: KalshiRung[];
  spread_ladder: KalshiRung[];
  /** Live per-team stat-market quotes; [] when Kalshi lists none. */
  stat_quotes: KalshiStatQuote[];
};
type KalshiPayload = {
  available: boolean;
  updated: string;
  reason?: string;
  season?: string;
  week?: string;
  matched?: number;
  unmatched?: string[];
  games: KalshiGame[];
};

// cfbNameKey / KALSHI_TEAM_ALIASES / pairKeyOf now live in ./cfbNames.ts —
// pure and unit-checkable (scripts/check_fcs_names.mjs), because the FCS slate
// joins to Kalshi through exactly this normalization and a collision there
// would price the wrong game.

const MONTH3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/** "2026-08-29" -> "26AUG29", matching Kalshi's event-ticker date segment. */
function kalshiDateToken(isoDate?: string): string | null {
  const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1].slice(2)}${MONTH3[Number(m[2]) - 1]}${m[3]}`;
}

/** Kalshi publishes prices as decimal-dollar strings ("0.7400"). */
const dollars = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Mid of the book when both sides quote, else the last trade. */
function marketPrice(m: any): number | null {
  const bid = dollars(m?.yes_bid_dollars);
  const ask = dollars(m?.yes_ask_dollars);
  if (bid !== null && ask !== null && (bid > 0 || ask > 0)) return (bid + ask) / 2;
  const last = dollars(m?.last_price_dollars);
  return last !== null && last > 0 ? last : null;
}

const openInterest = (m: any): number => Number(m?.open_interest_fp ?? 0) || 0;

/**
 * Pick the rung of a strike ladder that represents "the market's line".
 *
 * Neither obvious criterion works alone. Pure "closest to 50c" picks a thin
 * rung one tick off the real line. Pure "most open interest" picked a 32.5
 * total priced at 91c for EMU/Sacramento St. — a deep contract that had simply
 * accumulated the most volume, which is not a line at all.
 *
 * So: restrict to rungs actually priced like a line (25c-75c) when any exist,
 * then take the most-traded of those, tie-broken toward a coin flip.
 */
const LINE_BAND_LO = 0.25;
const LINE_BAND_HI = 0.75;

function pickLadderRung(markets: any[]): any | null {
  const priced = markets
    .map((m) => ({ m, price: marketPrice(m) as number, oi: openInterest(m) }))
    .filter((x) => x.price !== null);
  if (!priced.length) return null;

  const inBand = priced.filter((x) => x.price >= LINE_BAND_LO && x.price <= LINE_BAND_HI);
  const pool = inBand.length ? inBand : priced;

  pool.sort((a, b) => b.oi - a.oi || Math.abs(a.price - 0.5) - Math.abs(b.price - 0.5));
  return pool[0];
}

/** Prices this far out are noise, not a line; keeps the payload small too. */
const LADDER_MIN_PRICE = 0.03;
const LADDER_MAX_PRICE = 0.97;

/** Every usefully-priced rung of a ladder, ascending by line. */
function buildLadder(
  markets: any[],
  toLine: (m: any) => number | null,
  toPrice: (m: any, price: number) => number | null
): KalshiRung[] {
  const out: KalshiRung[] = [];
  for (const m of markets) {
    const price = marketPrice(m);
    if (price === null || price < LADDER_MIN_PRICE || price > LADDER_MAX_PRICE) continue;
    const line = toLine(m);
    const yes = toPrice(m, price);
    if (line === null || yes === null) continue;
    // 3dp keeps a 30-rung ladder under ~600 bytes.
    out.push({ line, yes_price: Math.round(yes * 1000) / 1000 });
  }
  out.sort((a, b) => a.line - b.line);
  // Collapse duplicate strikes (defensive: one rung per line).
  return out.filter((r, i) => i === 0 || r.line !== out[i - 1].line);
}

async function kalshiJson(path: string, signal?: AbortSignal): Promise<any> {
  // Signed whenever the portal's creds exist: authenticated requests draw on
  // the API key's rate bucket instead of the shared egress IP's anonymous
  // one. Production incident 2026-08-26: once the portal added signed calls
  // from the same IP, these anonymous market-data calls started 429ing and
  // every card's Kalshi column (and the portal's slate join) went blank.
  // Market-data endpoints accept signed requests (RFQ dashboard precedent).
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      accept: "application/json", "user-agent": "monte-site",
    };
    const key = portalPrivateKey();
    if (key && PORTAL_KEY_ID) {
      const ts = String(Date.now());
      const sig = crypto.sign("sha256",
        Buffer.from(ts + "GET" + "/trade-api/v2" + path.split("?", 1)[0]), {
          key,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        });
      headers["KALSHI-ACCESS-KEY"] = PORTAL_KEY_ID;
      headers["KALSHI-ACCESS-SIGNATURE"] = sig.toString("base64");
      headers["KALSHI-ACCESS-TIMESTAMP"] = ts;
    }
    const r = await fetchWithTimeout(`${KALSHI_BASE}${path}`, { headers, signal }, 12_000);
    if (r.status === 429 && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 700 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`kalshi ${path} -> HTTP ${r.status}`);
    return r.json();
  }
}

/** All open events in a series, following the cursor. */
async function kalshiEvents(series: string): Promise<any[]> {
  const out: any[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const q = `/events?series_ticker=${series}&limit=200&status=open${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const j = await kalshiJson(q);
    out.push(...(j?.events ?? []));
    cursor = j?.cursor || "";
    if (!cursor) break;
  }
  return out;
}

/**
 * Every open market in a series, grouped by event ticker.
 *
 * Deliberately bulk rather than one request per game: fetching each game's
 * three series separately was ~25 calls per refresh, and Kalshi rate-limited
 * the tail of them — which showed up as games silently missing their prices
 * while the first few looked fine. Whole-series paging is 5 calls for the
 * entire slate.
 */
async function kalshiMarketsBySeries(series: string): Promise<Map<string, any[]>> {
  const byEvent = new Map<string, any[]>();
  let cursor = "";
  for (let page = 0; page < 8; page++) {
    const q = `/markets?series_ticker=${series}&status=open&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const j = await kalshiJson(q);
    for (const m of j?.markets ?? []) {
      const ev = String(m?.event_ticker ?? "");
      if (!ev) continue;
      const list = byEvent.get(ev);
      if (list) list.push(m);
      else byEvent.set(ev, [m]);
    }
    cursor = j?.cursor || "";
    if (!cursor) break;
  }
  return byEvent;
}

/** Our slate for a season/week, straight from the dataset week index. */
async function ourWeekGames(season: string, week: string): Promise<
  { slug: string; teamA: string; teamB: string; date?: string }[]
> {
  // `season` is a dataset NAMESPACE, not necessarily a year: "2026" -> repo
  // cfb-sims-2026 / root dir 2026, "fcs-2026" -> cfb-sims-fcs-2026 / fcs-2026.
  // Both layouts are identical below this line.
  const repo = `cfb-sims-${season}`;
  if (!HF_ARCHIVE_REPOS.has(repo) && !HF_LIVE_REPOS.has(repo)) return [];

  // Same dual probe the client uses: 2026 publishes the new index at
  // weeks/<id>/index.json, 2025 at weeks/<id>/games/index.json.
  for (const rel of [`weeks/${week}/index.json`, `weeks/${week}/games/index.json`]) {
    try {
      const url = `https://huggingface.co/datasets/${HF_OWNER}/${repo}/resolve/main/${season}/${rel}`;
      const r = await fetchWithTimeout(url, { headers: { "user-agent": "monte-site-proxy" }, redirect: "follow" }, 12_000);
      if (!r.ok) continue;
      const j: any = await r.json();
      const games = (j?.games ?? [])
        .map((g: any) => ({
          slug: String(g?.slug ?? ""),
          teamA: String(g?.teamA ?? ""),
          teamB: String(g?.teamB ?? ""),
          date: g?.date ? String(g.date) : undefined,
        }))
        .filter((g: any) => g.slug && g.teamA && g.teamB);
      if (games.length) return games;
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

async function buildKalshiCfb(season: string, week: string): Promise<KalshiPayload> {
  const updated = new Date().toISOString();

  const ours = await ourWeekGames(season, week);
  if (!ours.length) {
    return { available: false, reason: "no_slate", updated, season, week, games: [] };
  }

  const events = await kalshiEvents(KALSHI_GAME_SERIES);
  if (!events.length) {
    return { available: false, reason: "no_markets_listed", updated, season, week, games: [] };
  }

  // Index Kalshi events by unordered team pair + date. Titles read
  // "<away> vs <home>"; the date lives in the ticker (…-26AUG29UNCTCU).
  const byPair = new Map<string, any>();
  for (const e of events) {
    const title = String(e?.title ?? "");
    const parts = title.split(/\s+vs\.?\s+/i);
    if (parts.length !== 2) continue;
    const dateTok = (String(e?.event_ticker ?? "").match(/-(\d{2}[A-Z]{3}\d{2})/) || [])[1] || "";
    byPair.set(`${pairKeyOf(parts[0], parts[1])}@${dateTok}`, e);
  }

  const matches: { slug: string; ev: any; teamA: string; teamB: string }[] = [];
  const unmatched: string[] = [];
  for (const g of ours) {
    const tok = kalshiDateToken(g.date) || "";
    const ev =
      byPair.get(`${pairKeyOf(g.teamA, g.teamB)}@${tok}`) ??
      // Kalshi can shift a listing by a day for late kicks; retry undated.
      [...byPair.entries()].find(([k]) => k.startsWith(`${pairKeyOf(g.teamA, g.teamB)}@`))?.[1];
    if (ev) matches.push({ slug: g.slug, ev, teamA: g.teamA, teamB: g.teamB });
    else unmatched.push(`${g.teamB} @ ${g.teamA}`);
  }

  if (unmatched.length) {
    console.log(`[kalshi] ${matches.length}/${ours.length} matched; unmatched: ${unmatched.join(" | ")}`);
  }

  // Bulk series paging only — one /markets call per series per TTL window,
  // never per market. Adding the stat families grows the fan-out by 9 cheap
  // calls per 45s (a staged-empty family is a single empty page), which is
  // what keeps this route clear of the shared-IP 429 episode of 2026-08-26.
  const statSeries = Object.keys(KALSHI_STAT_SERIES);
  const [winBy, totBy, sprBy, ...statBy] = await Promise.all([
    kalshiMarketsBySeries("KXNCAAFGAME"),
    kalshiMarketsBySeries("KXNCAAFTOTAL"),
    kalshiMarketsBySeries("KXNCAAFSPREAD"),
    ...statSeries.map((s) => kalshiMarketsBySeries(s)),
  ]);

  const games = matches.map(({ slug, ev, teamA, teamB }): KalshiGame => {
    const suffix = String(ev.event_ticker).replace(/^KXNCAAFGAME-/, "");
    const out: KalshiGame = {
      slug,
      event_ticker: ev.event_ticker,
      winner: { teamA_price: null, teamB_price: null },
      total: { line: null, yes_price: null },
      spread: { line: null, yes_price: null },
      total_ladder: [],
      spread_ladder: [],
      stat_quotes: [],
    };

    const keyA = cfbNameKey(teamA);
    const keyB = cfbNameKey(teamB);

    // Per-team stat ladders. Subtitle is "<Team>: <K>+" (verified live on
    // RECYDS / RSHTD / RECTD), and floor_strike is the K the rung settles
    // over — the same half-integer grid team_stats.json publishes rungs on,
    // so the client joins by strike with no interpolation anywhere.
    for (let i = 0; i < statSeries.length; i++) {
      const stat = KALSHI_STAT_SERIES[statSeries[i]];
      for (const m of statBy[i].get(`${statSeries[i]}-${suffix}`) ?? []) {
        // Two live subtitle shapes, both verified 2026-08-26/28:
        //   "North Carolina: 300+"                  (the stat ladders)
        //   "North Carolina over 6.5 points scored" (the team-points ladder)
        const who = cfbNameKey(statMarketTeam(m?.yes_sub_title));
        const side = who === keyA ? "A" : who === keyB ? "B" : null;
        const strike = dollars(m?.floor_strike);
        if (!side || strike === null) continue;
        out.stat_quotes.push({
          stat, side, strike,
          yes_bid: dollars(m?.yes_bid_dollars),
          yes_ask: dollars(m?.yes_ask_dollars),
        });
      }
    }

    // Winner: one binary market per team, identified by yes_sub_title.
    for (const m of winBy.get(`KXNCAAFGAME-${suffix}`) ?? []) {
      const k = cfbNameKey(m?.yes_sub_title ?? "");
      const price = marketPrice(m);
      if (k === keyA) out.winner.teamA_price = price;
      else if (k === keyB) out.winner.teamB_price = price;
    }

    // Total: "Over X.5 points scored"; floor_strike is the line.
    const totalMarkets = totBy.get(`KXNCAAFTOTAL-${suffix}`) ?? [];
    const spreadMarkets = sprBy.get(`KXNCAAFSPREAD-${suffix}`) ?? [];

    // Totals: floor_strike is the line, yes = P(over).
    out.total_ladder = buildLadder(
      totalMarkets,
      (m) => dollars(m?.floor_strike),
      (_m, price) => price
    );

    // Spreads: each rung reads "<Team> wins by over X.5". Normalise to
    // home-perspective so a rung is always "P(home covers line)":
    // a rung naming the away team is mirrored (line flips sign, price -> 1-p).
    out.spread_ladder = buildLadder(
      spreadMarkets,
      (m) => {
        const floor = dollars(m?.floor_strike);
        if (floor === null) return null;
        const who = cfbNameKey(String(m?.yes_sub_title ?? "").split(/\s+wins\s+by\s+/i)[0] ?? "");
        return who === keyA ? -floor : floor;
      },
      (m, price) => {
        const who = cfbNameKey(String(m?.yes_sub_title ?? "").split(/\s+wins\s+by\s+/i)[0] ?? "");
        return who === keyA ? price : 1 - price;
      }
    );

    const totRung = pickLadderRung(totalMarkets);
    if (totRung) {
      out.total.line = dollars(totRung.m?.floor_strike);
      out.total.yes_price = totRung.price;
    }

    // Spread: "<Team> wins by over X.5". Reported HOME-perspective to match
    // the sim's convention (negative = home favored), so a rung naming the
    // away team flips sign.
    const sprRung = pickLadderRung(spreadMarkets);
    if (sprRung) {
      const floor = dollars(sprRung.m?.floor_strike);
      const who = cfbNameKey(String(sprRung.m?.yes_sub_title ?? "").split(/\s+wins\s+by\s+/i)[0] ?? "");
      if (floor !== null) out.spread.line = who === keyA ? -floor : floor;
      out.spread.yes_price = sprRung.price;
    }

    return out;
  });

  return {
    available: games.length > 0,
    reason: games.length ? undefined : "no_games_matched",
    updated,
    season,
    week,
    matched: games.length,
    unmatched,
    games,
  };
}

// 45s TTL + in-flight coalescing, same discipline as the scoreboard cache.
const KALSHI_CACHE = new Map<string, { at: number; payload: KalshiPayload }>();
const KALSHI_INFLIGHT = new Map<string, Promise<KalshiPayload>>();

app.get(
  "/api/kalshi/cfb",
  asyncRoute(async (req: Request, res: Response) => {
    // "2026" or the FCS namespace "fcs-2026". Accepting only \d{4} here used
    // to be a silent trap: an fcs-2026 request fell back to "2026" and came
    // back with the FBS slate's prices keyed by FBS slugs, which the client
    // would then have shown against FCS games.
    const season = /^(?:fcs-)?\d{4}$/.test(String(req.query.season || ""))
      ? String(req.query.season)
      : "2026";
    const week = /^week\d{2}$/.test(String(req.query.week || "")) ? String(req.query.week) : "week00";
    const key = `${season}:${week}`;

    res.set("Cache-Control", "public, max-age=45");

    const hit = KALSHI_CACHE.get(key);
    if (hit && Date.now() - hit.at < KALSHI_TTL_MS) {
      res.json(hit.payload);
      return;
    }

    let work = KALSHI_INFLIGHT.get(key);
    if (!work) {
      work = buildKalshiCfb(season, week)
        .then((payload) => {
          KALSHI_CACHE.set(key, { at: Date.now(), payload });
          if (KALSHI_CACHE.size > 8) {
            const oldest = KALSHI_CACHE.keys().next().value;
            if (oldest !== undefined) KALSHI_CACHE.delete(oldest);
          }
          return payload;
        })
        .finally(() => KALSHI_INFLIGHT.delete(key));
      KALSHI_INFLIGHT.set(key, work);
    }

    try {
      res.json(await work);
    } catch (err: any) {
      console.error("[/api/kalshi/cfb] failed:", err?.message ?? err);
      // Never throw at the client: an unavailable market feed just hides the row.
      res.json({
        available: false,
        reason: "upstream_unavailable",
        updated: new Date().toISOString(),
        season,
        week,
        games: [],
      });
    }
  })
);

// ----------------------------------------------------------------------------
// Static React build
// ----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "../../dist");

// ============================================================================
// My-Kalshi portfolio portal (owner-only, token-gated)
//
// Read-only resting orders + fills on the NCAAF market families for the
// OWNER's Kalshi account, so the scoreboard can pin and badge the games the
// owner has money on. This deliberately amends the older "no credentials
// anywhere in this repo" stance (user decision 2026-08-26): credentials are
// still never in CODE — they arrive only through deployment env vars —
//   KALSHI_API_KEY_ID       the API key id
//   KALSHI_PRIVATE_KEY_PATH path to the PEM — THE production pattern
//                           (owner-proven): upload the key as a host
//                           Secret File and point here, e.g.
//                           KALSHI_PRIVATE_KEY_PATH=/etc/secrets/kalshi.pem.
//                           Inline PEMs in env vars mangle newlines.
//   KALSHI_PRIVATE_KEY      inline PEM fallback ("\n"-escaped)
//   CFB_PORTAL_PASSWORD     the owner-chosen login password
// and every one of them missing means the route answers 503, never a stack
// trace and never an open portal. The token check is timing-safe. This route
// family is where order entry would eventually live, so the auth gate exists
// BEFORE any mutating endpoint ever does.
// ============================================================================

// The owner's login secret is a PASSWORD OF THEIR CHOOSING (user 2026-08-26:
// a random token is unusable at login time), set as CFB_PORTAL_PASSWORD.
// The old CFB_PORTFOLIO_TOKEN name still works as an alias. A human-chosen
// password is guessable in a way a token is not, so failures rate-limit:
// 5 consecutive misses lock the route for 60s (single-operator portal — a
// legitimate user never hits that; a script does immediately).
const PORTAL_SECRET =
  process.env.CFB_PORTAL_PASSWORD || process.env.CFB_PORTFOLIO_TOKEN || "";
const PORTAL_KEY_ID = process.env.KALSHI_API_KEY_ID || "";
const PORTAL_MAX_FAILS = 5;
const PORTAL_LOCK_MS = 60_000;
let portalFails = 0;
let portalLockUntil = 0;
const PORTAL_TTL_MS = 20_000;
const PORTAL_NCAAF = /^KXNCAAF/;
/** Multivariate combos (2+ legs picked in the Kalshi app). Kept when at
 *  least one leg is an NCAAF game market. */
const PORTAL_MVE = /^KXMVE/;
const portalKeep = (t: string) => PORTAL_NCAAF.test(t) || PORTAL_MVE.test(t);

/** ticker -> {legs, title}. Permanent: a combo's legs never change. A fetch
 *  error stays UNcached so the next poll retries. */
const portalMveCache = new Map<string, { legs: PortalLeg[]; title: string } | null>();

async function portalMveInfo(ticker: string) {
  if (portalMveCache.has(ticker)) return portalMveCache.get(ticker) ?? null;
  const body = await portalGet(`/markets/${encodeURIComponent(ticker)}`);
  const m = body?.market || body || {};
  const legs: PortalLeg[] = (m.mve_selected_legs || [])
    .map((l: any) => ({
      market_ticker: String(l?.market_ticker || ""),
      side: String(l?.side || ""),
    }))
    .filter((l: PortalLeg) => l.market_ticker);
  const info = legs.length
    ? { legs, title: String(m.title || "") }
    : null;
  portalMveCache.set(ticker, info);
  return info;
}

/** Pass combo rows through leg resolution; drop combos with no NCAAF leg.
 *  A resolution FAILURE also drops the row for this poll (retried next). */
async function portalResolveMve<T extends { ticker: string; legs?: PortalLeg[]; title?: string }>(
  rows: T[],
): Promise<T[]> {
  const out: T[] = [];
  for (const r of rows) {
    if (!PORTAL_MVE.test(r.ticker)) { out.push(r); continue; }
    try {
      const info = await portalMveInfo(r.ticker);
      if (info && info.legs.some((l) => PORTAL_NCAAF.test(l.market_ticker))) {
        out.push({ ...r, legs: info.legs, title: info.title });
      }
    } catch (err: any) {
      console.warn("[portal] mve leg fetch failed:", r.ticker, err?.message ?? err);
    }
  }
  return out;
}

/** Lazy, cached; null = tried and unavailable (missing/bad env). */
let portalKeyCache: crypto.KeyObject | null | undefined;
function portalPrivateKey(): crypto.KeyObject | null {
  if (portalKeyCache !== undefined) return portalKeyCache;
  try {
    const inline = process.env.KALSHI_PRIVATE_KEY || "";
    const p = process.env.KALSHI_PRIVATE_KEY_PATH || "";
    const pem = inline.includes("BEGIN")
      ? inline.replace(/\\n/g, "\n")
      : p ? fs.readFileSync(p, "utf8") : "";
    portalKeyCache = pem ? crypto.createPrivateKey(pem) : null;
  } catch (err: any) {
    console.error("[portal] private key load failed:", err?.message ?? err);
    portalKeyCache = null;
  }
  return portalKeyCache;
}

/** Signed GET against Kalshi's portfolio API (RSA-PSS-SHA256, query
 *  stripped from the signed path — same scheme as the RFQ dashboard). */
async function portalGet(apiPath: string): Promise<any> {
  const key = portalPrivateKey();
  if (!key || !PORTAL_KEY_ID) throw new Error("portal_credentials_missing");
  for (let attempt = 0; ; attempt++) {
    const ts = String(Date.now());
    const signPath = "/trade-api/v2" + apiPath.split("?", 1)[0];
    const sig = crypto.sign("sha256", Buffer.from(ts + "GET" + signPath), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });
    const r = await fetchWithTimeout(`${KALSHI_BASE}${apiPath}`, {
      headers: {
        "KALSHI-ACCESS-KEY": PORTAL_KEY_ID,
        "KALSHI-ACCESS-SIGNATURE": sig.toString("base64"),
        "KALSHI-ACCESS-TIMESTAMP": ts,
        accept: "application/json",
      },
    }, 10_000);
    if (r.status === 429 && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`kalshi ${apiPath} -> HTTP ${r.status}`);
    return r.json();
  }
}

/** This API tier returns fixed-point STRINGS (count_fp, yes_price_dollars,
 *  fee_cost) — verified live 2026-08-26 on the first CFB maker fills. */
const portalNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** One leg of a multivariate combo (Kalshi "MVE" tickers are opaque shard
 *  hashes; the market object's mve_selected_legs carries the real per-game
 *  market tickers, which is what the client joins on). */
type PortalLeg = { market_ticker: string; side: string };

type PortalOrder = {
  ticker: string; order_id: string; side: string;
  yes_price: number | null; no_price: number | null;
  initial: number | null; filled: number | null; remaining: number | null;
  created_time: string;
  legs?: PortalLeg[]; title?: string;
  /** Live book on the entry's own market, refreshed with the payload. */
  mkt_yes_bid?: number | null; mkt_yes_ask?: number | null;
};
type PortalFill = {
  ticker: string; side: string; action: string;
  count: number | null; yes_price: number | null; no_price: number | null;
  fee: number | null; is_taker: boolean; created_time: string;
};
/** Held contracts from /portfolio/positions — the ground truth for "what
 *  filled". position_fp is SIGNED (+yes / −no); exposure ÷ count = the held
 *  side's cost basis (verified: −3 @ $1.41 = NO bought at 47¢). Fills alone
 *  cannot reconstruct this: Kalshi logs a NO buy as a YES-book "sell". */
type PortalPosition = {
  ticker: string; side: string; count: number;
  avg_price: number | null; fees: number | null;
  legs?: PortalLeg[]; title?: string;
  mkt_yes_bid?: number | null; mkt_yes_ask?: number | null;
};
type PortalPayload = {
  fetched_at: string; orders: PortalOrder[]; fills: PortalFill[];
  positions: PortalPosition[];
};

async function portalOrders(): Promise<PortalOrder[]> {
  const out: PortalOrder[] = [];
  let cursor = "";
  // Cursor ALWAYS drained (kalshi-rfq's 2026-07-22 page-1-only incident).
  for (let page = 0; page < 10; page++) {
    const body = await portalGet("/portfolio/orders?status=resting&limit=200" +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    for (const o of body?.orders || []) {
      const t = String(o.ticker || "");
      if (!portalKeep(t)) continue;
      out.push({
        ticker: t,
        order_id: String(o.order_id || ""),
        side: String(o.outcome_side || o.side || ""),
        yes_price: portalNum(o.yes_price_dollars),
        no_price: portalNum(o.no_price_dollars),
        initial: portalNum(o.initial_count_fp ?? o.initial_count),
        filled: portalNum(o.fill_count_fp ?? o.fill_count),
        remaining: portalNum(o.remaining_count_fp ?? o.remaining_count),
        created_time: String(o.created_time || ""),
      });
    }
    cursor = String(body?.cursor || "");
    if (!cursor) break;
  }
  return portalResolveMve(out);
}

async function portalFills(): Promise<PortalFill[]> {
  const out: PortalFill[] = [];
  let cursor = "";
  for (let page = 0; page < 3; page++) {
    const body = await portalGet("/portfolio/fills?limit=200" +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    for (const f of body?.fills || []) {
      const t = String(f.ticker || f.market_ticker || "");
      if (!PORTAL_NCAAF.test(t)) continue;
      out.push({
        ticker: t,
        side: String(f.outcome_side || f.side || ""),
        action: String(f.action || ""),
        count: portalNum(f.count_fp ?? f.count),
        yes_price: portalNum(f.yes_price_dollars),
        no_price: portalNum(f.no_price_dollars),
        fee: portalNum(f.fee_cost),
        is_taker: Boolean(f.is_taker),
        created_time: String(f.created_time || ""),
      });
    }
    cursor = String(body?.cursor || "");
    if (!cursor) break;
  }
  return out;
}

async function portalPositions(): Promise<PortalPosition[]> {
  const out: PortalPosition[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const body = await portalGet("/portfolio/positions?limit=200" +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    for (const p of body?.market_positions || body?.positions || []) {
      const t = String(p.ticker || "");
      if (!portalKeep(t)) continue;
      const pos = portalNum(p.position_fp ?? p.position) ?? 0;
      if (!pos) continue;
      const count = Math.abs(pos);
      const exposure = portalNum(p.market_exposure_dollars);
      out.push({
        ticker: t,
        side: pos > 0 ? "yes" : "no",
        count,
        avg_price: exposure !== null && count > 0 ? exposure / count : null,
        fees: portalNum(p.fees_paid_dollars),
      });
    }
    cursor = String(body?.cursor || "");
    if (!cursor) break;
  }
  return portalResolveMve(out);
}

let portalCache: { at: number; payload: PortalPayload } | null = null;

app.get("/api/portfolio/cfb", asyncRoute(async (req: Request, res: Response) => {
  // Personal financial data: never cacheable by intermediaries.
  res.set("Cache-Control", "no-store");
  if (!PORTAL_SECRET) {
    res.status(503).json({ error: "portal_not_configured" });
    return;
  }
  if (Date.now() < portalLockUntil) {
    res.status(429).json({
      error: "locked",
      retry_in_s: Math.ceil((portalLockUntil - Date.now()) / 1000),
    });
    return;
  }
  const got = Buffer.from(String(req.header("x-cfb-token") || ""), "utf8");
  const want = Buffer.from(PORTAL_SECRET, "utf8");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    portalFails++;
    if (portalFails >= PORTAL_MAX_FAILS) {
      portalLockUntil = Date.now() + PORTAL_LOCK_MS;
      portalFails = 0;
      console.warn("[portal] too many failed logins — locked 60s");
    }
    res.status(401).json({ error: "bad_password" });
    return;
  }
  portalFails = 0;
  if (portalCache && Date.now() - portalCache.at < PORTAL_TTL_MS) {
    res.json(portalCache.payload);
    return;
  }
  const [orders, fills, positions] = await Promise.all([
    portalOrders(), portalFills(), portalPositions(),
  ]);
  // Live book per entry ticker, so the client can price EV off Kalshi NOW
  // (refreshes with every payload build, i.e. every page load past the TTL).
  const tickers = [...new Set([...orders, ...positions].map((e) => e.ticker))];
  const books = new Map<string, { bid: number | null; ask: number | null }>();
  await Promise.all(tickers.map(async (t) => {
    try {
      const body = await portalGet(`/markets/${encodeURIComponent(t)}`);
      const m = body?.market || {};
      books.set(t, {
        bid: portalNum(m.yes_bid_dollars),
        ask: portalNum(m.yes_ask_dollars),
      });
    } catch { /* entry just ships without a live book this build */ }
  }));
  for (const e of [...orders, ...positions]) {
    const b = books.get(e.ticker);
    if (b) { e.mkt_yes_bid = b.bid; e.mkt_yes_ask = b.ask; }
  }
  const payload: PortalPayload = {
    fetched_at: new Date().toISOString(), orders, fills, positions,
  };
  portalCache = { at: Date.now(), payload };
  res.json(payload);
}));

// Unknown /api routes must answer JSON. Without this the SPA catch-all below
// serves index.html for a typo'd or removed endpoint, and the client blows up
// on `JSON.parse("<!doctype html>")` — which looks like a page crash, not a
// 404.
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({ error: "unknown_api_route", path: req.originalUrl });
});

app.use(express.static(staticDir));

app.get("*", (_req: Request, res: Response, next: NextFunction) => {
  res.sendFile(path.join(staticDir, "index.html"), (err) => {
    // Missing/unbuilt dist: report it instead of leaving the request hanging.
    if (err) next(err);
  });
});

// ----------------------------------------------------------------------------
// Error middleware (must be last, must take 4 args)
// ----------------------------------------------------------------------------

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(
    `[express error] ${req.method} ${req.originalUrl}:`,
    err?.stack || err?.message || err
  );
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const explicit = Number(err?.status || err?.statusCode);
  const status = Number.isFinite(explicit) && explicit >= 400 && explicit < 600
    ? explicit
    : err?.name === "AbortError"
    ? 504
    : 500;
  res.status(status).json({ error: "internal_error" });
});

// ----------------------------------------------------------------------------
// Start
// ----------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`liveScores listening on :${PORT}`);
});

// Classic phantom-502 source behind a managed proxy: Node's 5s keep-alive
// closes a socket the proxy still considers reusable, the proxy sends a
// request into the dying socket and reports 502. Keep ours longer than the
// upstream idle timeout, and headersTimeout strictly above keepAliveTimeout.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[${sig}] closing server`);
    server.close(() => process.exit(0));
    // Do not wait on lingering SSE streams forever.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
