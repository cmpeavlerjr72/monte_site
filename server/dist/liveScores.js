// server/liveScores.ts
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
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
process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason?.stack || reason?.message || reason);
});
process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err?.stack || err?.message || err);
});
/** Wrap an async route so a rejection becomes next(err), not a process exit. */
function asyncRoute(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
// Liveness/readiness probe. Cheap, never touches an upstream, and reports the
// counters that historically preceded an OOM kill.
app.get("/healthz", (_req, res) => {
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
const TX_INGEST_TOKEN = process.env.TX_INGEST_TOKEN || "";
const TX_MAX_ENTRIES = 500; // ring buffer size across all streams
const TX_MAX_AGE_MS = 30 * 60_000; // drop anything older than 30 min
const txEntries = [];
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
    const body = req.body;
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
        if (!Number.isFinite(streamNumber) || !text || !Number.isFinite(series))
            continue;
        if (text.length > 1000)
            continue; // sanity cap per entry
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
    const out = [];
    for (const e of txEntries) {
        if (e.id <= since)
            continue;
        if (series && e.series !== series)
            continue;
        if (streamFilter && !streamFilter.has(e.streamNumber))
            continue;
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
function allEventsFromScoreboard(sb) {
    const direct = Array.isArray(sb?.events) ? sb.events : [];
    const leagueLists = Array.isArray(sb?.leagues)
        ? sb.leagues.flatMap((L) => (Array.isArray(L?.events) ? L.events : []))
        : [];
    // If leagues[].events has more, prefer that; otherwise fall back to events.
    const raw = leagueLists.length >= direct.length ? leagueLists : direct;
    // Dedupe by event id
    const seen = new Set();
    const out = [];
    for (const ev of raw) {
        const id = String(ev?.id ?? "");
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(ev);
    }
    return out;
}
function normalizeScoreboardPayload(sb) {
    if (!sb || typeof sb !== "object")
        return sb;
    const all = allEventsFromScoreboard(sb);
    // Only replace if we actually expanded the list
    if (Array.isArray(sb.events)) {
        sb.events = all;
    }
    else if (all.length) {
        sb.events = all;
    }
    return sb;
}
// Build a sorted pair key from two ESPN team IDs
const pairKey = (a, b) => {
    if (!a || !b)
        return '';
    const [x, y] = [String(a), String(b)].sort();
    return `${x}-${y}`;
};
// Build a lookup map from index.json contents
export function buildIndexByEspnPair(indexGames) {
    const map = {};
    for (const g of indexGames) {
        const A = g.A_espn?.espn_id;
        const B = g.B_espn?.espn_id;
        if (A && B) {
            const k = pairKey(A, B);
            if (!k)
                continue;
            (map[k] ||= []).push(g);
        }
    }
    return map;
}
// Fallback: single-team key, to handle entries where one side lacks ESPN metadata
const singleKey = (id) => (id ? `t:${id}` : '');
export function buildIndexBySingleTeam(indexGames) {
    const map = {};
    for (const g of indexGames) {
        const A = g.A_espn?.espn_id;
        const B = g.B_espn?.espn_id;
        if (A)
            (map[singleKey(A)] ||= []).push(g);
        if (B)
            (map[singleKey(B)] ||= []).push(g);
    }
    return map;
}
function toSport(q) {
    const s = String(q || "cfb").toLowerCase();
    if (s === "cbb")
        return "cbb";
    if (s === "mlb")
        return "mlb";
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
function normDate(raw) {
    const d = String(raw ?? "").replace(/-/g, "").trim();
    return /^\d{8}$/.test(d) ? d : currentETDate();
}
/** ESPN group ids are digits and commas; anything else is dropped. */
function normGroups(raw) {
    const g = String(raw ?? "").trim();
    if (!g)
        return undefined;
    return /^[0-9]{1,4}(,[0-9]{1,4}){0,8}$/.test(g) ? g : undefined;
}
function clampLimit(raw, dflt = 3000) {
    const n = Number(raw ?? dflt);
    if (!Number.isFinite(n))
        return dflt;
    return Math.min(3000, Math.max(1, Math.trunc(n)));
}
// replace the existing espnUrl with:
function espnUrl(sport, dateYYYYMMDD, opts) {
    const d = String(dateYYYYMMDD).replace(/-/g, "");
    const groups = opts?.groups;
    const limit = String(opts?.limit ?? 3000); // default high
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
function countLiveGames(payload) {
    try {
        const events = allEventsFromScoreboard(payload);
        return events.filter((e) => e?.status?.type?.state === "in").length;
    }
    catch {
        return 0;
    }
}
function withParam(u, k, v) {
    const url = new URL(u);
    url.searchParams.set(k, String(v));
    return url.toString();
}
// Safely coerce possibly-missing arrays to real arrays
function collectArrays(v) {
    return Array.isArray(v) ? v : [];
}
/** Fetch page 1..N and merge. Stops when:
 *  - page has 0 events, or
 *  - no new event ids appear, or
 *  - maxPages is reached (safety)
 */
async function fetchAllPages(baseUrl, maxPages = 8) {
    let merged = null;
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
        const url = withParam(baseUrl, "page", page);
        const raw = await fetchJsonWithTimeout(url);
        const norm = normalizeScoreboardPayload(raw);
        const evs = collectArrays(norm.events);
        // First page: take the whole object as the scaffold
        if (!merged)
            merged = norm;
        // Merge events (dedupe by id)
        const fresh = [];
        for (const ev of evs) {
            const id = String(ev?.id ?? "");
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            fresh.push(ev);
        }
        // If this page yielded nothing new, we’re done
        if (fresh.length === 0)
            break;
        // Append to merged.events
        merged.events = [...collectArrays(merged.events), ...fresh];
        // Heuristic: ESPN often returns <=25 per page; if we got <25, assume last page
        if (evs.length < 25)
            break;
    }
    // Ensure final shape is normalized (events deduped, etc.)
    return normalizeScoreboardPayload(merged ?? {});
}
function ttlFor(liveCount) {
    // Shorter TTL when there are live games, longer when there aren't.
    return liveCount > 0 ? 20_000 : 120_000;
}
// ESPN date helper – returns YYYYMMDD in America/New_York
function currentETDate() {
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
async function fetchWithTimeout(url, init = {}, ms = 15_000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        return (await fetch(url, { ...init, signal: ctrl.signal }));
    }
    finally {
        clearTimeout(id);
    }
}
async function fetchJsonWithTimeout(url, ms = 10_000) {
    const resp = await fetchWithTimeout(url, {
        headers: {
            "cache-control": "no-cache",
            "user-agent": "Mozilla/5.0",
        },
    }, ms);
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status}`);
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
const SCOREBOARD_CACHE = new Map();
const SCOREBOARD_CACHE_MAX = 24;
const SCOREBOARD_INFLIGHT = new Map();
function scoreboardCacheSet(key, entry) {
    if (SCOREBOARD_CACHE.has(key))
        SCOREBOARD_CACHE.delete(key);
    SCOREBOARD_CACHE.set(key, entry);
    while (SCOREBOARD_CACHE.size > SCOREBOARD_CACHE_MAX) {
        const oldest = SCOREBOARD_CACHE.keys().next().value;
        if (oldest === undefined)
            break;
        SCOREBOARD_CACHE.delete(oldest);
    }
}
// add param
async function getScoreboard(sport, dateYYYYMMDD, force = false, opts) {
    const cacheKey = `${sport}:${dateYYYYMMDD}:${opts?.groups ?? ""}:${opts?.limit ?? ""}`;
    const existing = SCOREBOARD_CACHE.get(cacheKey);
    const now = Date.now();
    if (!force && existing) {
        const age = now - existing.fetchedAt;
        const ttl = ttlFor(existing.liveCount);
        if (age < ttl)
            return existing.payload;
    }
    // Someone else is already walking this exact key upstream — ride along.
    const pending = SCOREBOARD_INFLIGHT.get(cacheKey);
    if (pending)
        return pending;
    const work = (async () => {
        const url = espnUrl(sport, dateYYYYMMDD, opts);
        console.log("[scoreboard fetch base]", url);
        let payload = await fetchAllPages(url); // pull & merge pages
        // Retry only on a genuinely empty first walk. The old condition (<= 25
        // events) refetched every small slate, doubling cold-start latency and
        // upstream load for no gain.
        if ((payload?.events?.length ?? 0) === 0) {
            console.log("[scoreboard refetch] empty result; retrying pages");
            payload = await fetchAllPages(url);
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
    }
    catch (err) {
        // Serve a stale payload rather than an error when we have one: a blip at
        // ESPN should degrade the scoreboard, not blank it.
        if (existing) {
            console.warn(`[scoreboard] upstream failed for ${cacheKey}, serving stale (${Math.round((Date.now() - existing.fetchedAt) / 1000)}s old):`, err?.message ?? err);
            return existing.payload;
        }
        throw err;
    }
    finally {
        SCOREBOARD_INFLIGHT.delete(cacheKey);
    }
}
// ----------------------------------------------------------------------------
// SSE helpers
// ----------------------------------------------------------------------------
/** Write one SSE frame. Never throws — a dead socket is not an exception. */
function sseSend(res, data) {
    try {
        return res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    catch (err) {
        console.warn("[sse] write failed:", err?.message ?? err);
        return false;
    }
}
const clients = [];
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
app.get("/api/scoreboard", asyncRoute(async (req, res) => {
    const sport = toSport(req.query.sport);
    const date = normDate(req.query.date);
    const force = String(req.query.fresh || "") === "1";
    const groups = normGroups(req.query.groups);
    const limit = clampLimit(req.query.limit);
    try {
        const payload = await getScoreboard(sport, date, force, { groups, limit });
        res.json({ sport, date, payload, cached_at: new Date().toISOString() });
    }
    catch (err) {
        const timedOut = err?.name === "AbortError";
        console.error(`[/api/scoreboard] ${sport} ${date} failed:`, err?.message ?? err);
        res.status(timedOut ? 504 : 502).json({
            error: timedOut ? "scoreboard_upstream_timeout" : "scoreboard_upstream_error",
            sport,
            date,
        });
    }
}));
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
app.get("/api/live", (req, res) => {
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
    let timer = null;
    let heartbeat = null;
    const cleanup = () => {
        if (closed)
            return;
        closed = true;
        sseClients = Math.max(0, sseClients - 1);
        if (timer)
            clearInterval(timer);
        if (heartbeat)
            clearInterval(heartbeat);
        timer = null;
        heartbeat = null;
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
    const push = async (type) => {
        if (closed)
            return;
        try {
            const payload = await getScoreboard(sport, date, type === "hello" && force, {
                groups,
                limit,
            });
            if (!closed)
                sseSend(res, { type, meta: { sport, date }, payload });
        }
        catch (err) {
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
        if (closed)
            return;
        try {
            res.write(": ping\n\n");
        }
        catch {
            cleanup();
        }
    }, 25_000);
});
// ---- EXACT ESPN PASS-THROUGH (no cache, no wrapping) ----
app.get("/api/espn/scoreboard", async (req, res) => {
    try {
        // Accept both "date" (20251126 or 2025-11-26) and ESPN's "dates"
        const datesRaw = req.query.dates || req.query.date || currentETDate();
        const dates = String(datesRaw).replace(/-/g, "");
        // Allow caller to override groups/limit; default to men's D-I and 357 cap
        const groups = req.query.groups ?? "50";
        const limit = req.query.limit ?? "357";
        // Build ESPN URL 1:1
        const url = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard");
        url.searchParams.set("dates", dates);
        url.searchParams.set("groups", groups);
        url.searchParams.set("limit", limit);
        // Fetch and return **exact** body (no mutation)
        const r = await fetchWithTimeout(url.toString(), {
            headers: {
                // ESPN sometimes behaves better with a UA; also disable upstream caching hints
                "user-agent": "Mozilla/5.0",
                "cache-control": "no-cache",
            },
        }, 15_000);
        const body = await r.text(); // keep text to avoid JSON re-stringify differences
        res
            .status(r.status)
            .set("Content-Type", r.headers.get("content-type") || "application/json")
            .set("Cache-Control", "no-store") // do not let proxies cache our proxy
            .send(body);
    }
    catch (err) {
        console.error("GET /api/espn/scoreboard error:", err?.message || err);
        if (res.headersSent) {
            res.end();
            return;
        }
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
const HF_ARCHIVE_REPOS = new Set([
    "cfb-sims-2025",
]);
const HF_LIVE_REPOS = new Set([
    // 2026 CFB sims: in-season, re-uploaded weekly -> live set (5-min TTL).
    // 2025 stays in HF_ARCHIVE_REPOS above and is cached forever.
    "cfb-sims-2026",
    "cfb-playoff-compacts-2026",
    "cbb-sims-2026",
    "mlb-sims-2026",
    "nascar-predictions",
    "tennis-predictions",
]);
/** TTFB deadline for the Hub. Cleared once headers land so a slow large CSV
 *  body is never cut off mid-stream. */
const HF_TTFB_TIMEOUT_MS = 15_000;
app.get("/api/data/:repo/*", asyncRoute(async (req, res) => {
    const repo = String(req.params.repo || "");
    const isArchive = HF_ARCHIVE_REPOS.has(repo);
    if (!isArchive && !HF_LIVE_REPOS.has(repo)) {
        res.status(404).json({ error: "unknown_dataset", repo });
        return;
    }
    // Everything after /api/data/<repo>/ is the path inside the dataset.
    const rest = req.params[0] || "";
    if (rest.includes("..") || rest.startsWith("/")) {
        res.status(400).json({ error: "bad_path" });
        return;
    }
    const upstream = `https://huggingface.co/datasets/${HF_OWNER}/${repo}/resolve/main/` +
        rest.split("/").map(encodeURIComponent).join("/");
    try {
        const headers = { "user-agent": "monte-site-proxy" };
        // Let the browser revalidate instead of re-downloading unchanged files.
        const inm = req.headers["if-none-match"];
        if (typeof inm === "string")
            headers["if-none-match"] = inm;
        const r = await fetchWithTimeout(upstream, { headers, redirect: "follow" }, HF_TTFB_TIMEOUT_MS);
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
        if (ct)
            res.set("Content-Type", ct);
        const etag = r.headers.get("etag");
        if (etag)
            res.set("ETag", etag);
        // Deliberately not forwarding Content-Length/Content-Encoding: the Hub
        // gzips these CSVs and node-fetch decompresses them, so the upstream length
        // describes bytes we are no longer sending. Let compression() re-encode.
        res.set("Cache-Control", isArchive
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, stale-while-revalidate=600");
        if (!r.body) {
            res.end();
            return;
        }
        // pipe() with no 'error' listener on either side is an uncaught
        // exception waiting to happen: a Hub reset mid-body, or an EPIPE when
        // the browser navigates away, used to take the whole process down.
        const body = r.body;
        body.on("error", (err) => {
            console.error(`[/api/data] upstream body error ${repo}/${rest}:`, err?.message ?? err);
            if (res.headersSent)
                res.destroy(err);
            else
                res.status(502).json({ error: "dataset_stream_error", path: rest });
        });
        res.on("error", (err) => {
            console.warn(`[/api/data] client stream error ${repo}/${rest}:`, err?.message ?? err);
            body.destroy?.();
        });
        // Client hung up (tab closed, navigation) — stop pulling from the Hub.
        res.on("close", () => {
            if (!res.writableEnded)
                body.destroy?.();
        });
        body.pipe(res);
    }
    catch (err) {
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
}));
// ----------------------------------------------------------------------------
// Static React build
// ----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "../../dist");
// Unknown /api routes must answer JSON. Without this the SPA catch-all below
// serves index.html for a typo'd or removed endpoint, and the client blows up
// on `JSON.parse("<!doctype html>")` — which looks like a page crash, not a
// 404.
app.use("/api", (req, res) => {
    res.status(404).json({ error: "unknown_api_route", path: req.originalUrl });
});
app.use(express.static(staticDir));
app.get("*", (_req, res, next) => {
    res.sendFile(path.join(staticDir, "index.html"), (err) => {
        // Missing/unbuilt dist: report it instead of leaving the request hanging.
        if (err)
            next(err);
    });
});
// ----------------------------------------------------------------------------
// Error middleware (must be last, must take 4 args)
// ----------------------------------------------------------------------------
app.use((err, req, res, _next) => {
    console.error(`[express error] ${req.method} ${req.originalUrl}:`, err?.stack || err?.message || err);
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
for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
        console.log(`[${sig}] closing server`);
        server.close(() => process.exit(0));
        // Do not wait on lingering SSE streams forever.
        setTimeout(() => process.exit(0), 5_000).unref();
    });
}
