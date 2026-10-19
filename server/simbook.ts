// ============================================================================
// THE SIM BOOK (owner 2026-10-19) — a private sportsbook where the SIM is the
// house. An invited friend bets units on DraftKings' lines at OUR prices; the
// server grades every ticket from SportsGameOdds results; the owner sees
// whether "ball knowledge" beats the sim.
//
// PRICING (owner decisions 2026-10-19: "sim + guardrails", standard juice):
//   q_sim   = the sim's probability his side wins (push-free), from seeds.json
//   p_mkt   = DraftKings' no-vig probability for the same side and line
//   p_house = (q_sim + p_mkt) / 2        — our calibration work showed the raw
//             sim is overconfident against the market, the blend is not
//   price   = the WORST for him of:
//               DK's own price                     (never better than DK)
//               (1 - H) / p_house                  (standard juice, 4.5% / 6% props)
//               (1 - H_SIM) / q_sim                (the sim always keeps >= 3%)
//   so the side the sim likes gets extra juice automatically, and every
//   ticket is +EV for the house by the sim's own numbers.
// Parlays: the sim's JOINT probability (same-game legs correlate through the
// seeds), market = product of the legs, juice compounds per leg, DK clamp =
// the product of DK's leg prices.
//
// TRUST: the browser never sends a price. It sends leg KEYS; the server
// re-fetches DK, re-prices, and stores what IT computed. A worse price than
// the one he saw comes back as 409 `price_changed` with the new quote.
// Tables: supabase/migrations/20261019_simbook.sql (RLS on, no client policy).
// ============================================================================
import type { Express, Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export type SimbookDeps = {
  supa: SupabaseClient | null;
  userOf: (req: Request) => { id: string } | null;
  isOwner: (uid: string) => boolean;
  hfOwner: string;
};

const REPO = "cfb-sims-2026";
const SEASON = 2026;
const SGO_KEY = process.env.SGO_API_KEY || "";
const SGO_BASE = "https://api.sportsgameodds.com/v2";
const SGO_MONTH_CAP = Number(process.env.SIMBOOK_SGO_MONTH_CAP || 2300); // plan allows 2,500 games/month
const EVENT_TTL_MS = 120_000;        // tickets re-read a game's DK board at most every 2 min
const OPEN_TTL_MS = 10 * 60_000;     // opening a game re-reads its board when the snapshot is older than this
// The card snapshot (owner 2026-10-19: "prices need to load automatically"): every
// not-yet-kicked game's board is re-read in ONE batched pass, at most this often.
// SGO bills each event read against 2,500/month, so 56 games x once a day is ~1,700.
const CARD_TTL_MS = Number(process.env.SIMBOOK_CARD_TTL_H || 20) * 3600_000;
// A game DK hasn't posted is looked for again on the same daily pass (opening it looks right away).
const H_LINES = 0.045;               // juice on spreads, totals, moneylines, team totals
const H_PROPS = 0.06;                // juice on player props
const H_SIM = 0.03;                  // the house keeps at least this much by the sim
const MAX_LEGS = 8;
const MAX_PAYOUT = 250;              // units, including stake
const AM_MIN = -1000, AM_MAX_SINGLE = 1500, AM_MAX_PARLAY = 10000;

/* -------------------------------------------------------------- small utils */
const nameKey = (s: string) =>
  String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");

const sgoStem = (s: string) =>
  String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/�/g, "e")
    .toUpperCase().replace(/&/g, "").replace(/[’']/g, "")
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Our school name -> SGO team-id stems to try, best guess first. */
const SGO_ALIASES: Record<string, string[]> = {
  "app state": ["APPALACHIAN_STATE"],
  "ul monroe": ["LOUISIANA_MONROE", "ULM"],
  "hawaii": ["HAWAII"],
  "miami (oh)": ["MIAMI_OH", "MIAMI_OHIO"],
  "miami": ["MIAMI_FL", "MIAMI"],
  "massachusetts": ["UMASS", "MASSACHUSETTS"],
  "ut san antonio": ["UTSA", "UT_SAN_ANTONIO"],
  "utsa": ["UTSA"],
  "florida international": ["FIU", "FLORIDA_INTERNATIONAL"],
  "fiu": ["FIU"],
  "uconn": ["UCONN", "CONNECTICUT"],
  "connecticut": ["UCONN", "CONNECTICUT"],
  "southern miss": ["SOUTHERN_MISS", "SOUTHERN_MISSISSIPPI"],
  "sam houston": ["SAM_HOUSTON", "SAM_HOUSTON_STATE"],
  "louisiana": ["LOUISIANA", "LOUISIANA_LAFAYETTE"],
  "nc state": ["NC_STATE", "NORTH_CAROLINA_STATE"],
  "ole miss": ["OLE_MISS", "MISSISSIPPI"],
};
function sgoTeamIds(name: string): string[] {
  const k = String(name || "").toLowerCase().replace(/ʻ|'/g, "").trim();
  const out = [...(SGO_ALIASES[k] || []), sgoStem(name)];
  return [...new Set(out)].map((s) => `${s}_NCAAF`);
}

function amToDec(am: number): number { return am > 0 ? 1 + am / 100 : 1 + 100 / -am; }
/** Decimal -> American, rounded in the HOUSE's favour to a multiple of 5. */
function decToAmHouse(dec: number): number {
  if (dec >= 2) return Math.floor((100 * (dec - 1)) / 5 + 1e-7) * 5 || -100;
  const am = -100 / (dec - 1);
  return Math.ceil(Math.abs(am) / 5 - 1e-7) * -5;
}
function parseAm(s: any): number | null {
  const n = Number(String(s ?? "").replace("+", ""));
  return Number.isFinite(n) && n !== 0 && Math.abs(n) >= 100 ? n : null;
}

/* ------------------------------------------------------------- HF data */
const hfCache = new Map<string, { at: number; p: Promise<any> }>();
function hfJson(deps: SimbookDeps, rel: string, ttlMs = 10 * 60_000): Promise<any> {
  const hit = hfCache.get(rel);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p;
  const url = `https://huggingface.co/datasets/${deps.hfOwner}/${REPO}/resolve/main/${rel}`;
  const p = (async () => {
    const r = await fetch(url, { headers: { "user-agent": "monte-simbook" }, redirect: "follow" } as any);
    if (!r.ok) { const e: any = new Error(`HF ${r.status} ${rel}`); e.status = r.status; throw e; }
    return r.json();
  })();
  p.catch(() => hfCache.delete(rel));
  if (hfCache.size > 200) hfCache.clear();
  hfCache.set(rel, { at: Date.now(), p });
  return p;
}

type SlateGame = { slug: string; home: string; away: string; kickoff: string; seeds_path: string; week: number };
async function currentWeek(deps: SimbookDeps): Promise<number> {
  const idx = await hfJson(deps, `${SEASON}/season_index.json`);
  const weeks = (idx?.weeks || []).map((w: any) => Number(w.week)).filter(Number.isFinite);
  return Math.max(...weeks);
}
async function slate(deps: SimbookDeps, week: number): Promise<SlateGame[]> {
  const ww = String(week).padStart(2, "0");
  const idx = await hfJson(deps, `${SEASON}/weeks/week${ww}/index.json`);
  return (idx?.games || []).map((g: any) => ({
    slug: g.slug, home: g.teamA, away: g.teamB, kickoff: g.time_utc || `${g.date}T16:00:00Z`,
    seeds_path: g.seeds_path || String(g.summary_path || "").replace(/summary\.json$/, "seeds.json"),
    week,
  }));
}
async function gameOf(deps: SimbookDeps, week: number, slug: string): Promise<SlateGame | null> {
  return (await slate(deps, week)).find((g) => g.slug === slug) || null;
}
type Seeds = { A: number[]; B: number[]; players: Record<string, number[]>; names: Map<string, string[]> };
const seedsMemo = new Map<string, Promise<Seeds>>();
function seedsFor(deps: SimbookDeps, g: SlateGame): Promise<Seeds> {
  const key = `${g.week}/${g.slug}`;
  const hit = seedsMemo.get(key);
  if (hit) return hit;
  const p = (async () => {
    const raw = await hfJson(deps, `${SEASON}/${g.seeds_path}`, 60 * 60_000);
    hfCache.delete(`${SEASON}/${g.seeds_path}`); // the parsed copy below is what we keep
    const names = new Map<string, string[]>();
    for (const k of Object.keys(raw.players || {})) {
      const nm = k.split("|")[0];
      const nk = nameKey(nm);
      const arr = names.get(nk) || [];
      if (!arr.includes(nm)) arr.push(nm);
      names.set(nk, arr);
    }
    return { A: raw.A_pts, B: raw.B_pts, players: raw.players || {}, names };
  })();
  p.catch(() => seedsMemo.delete(key));
  if (seedsMemo.size > 12) seedsMemo.delete(seedsMemo.keys().next().value!);
  seedsMemo.set(key, p);
  return p;
}

/* ------------------------------------------------------- SportsGameOdds */
let sgoCalls: number[] = [];
let sgoUsage = { at: 0, used: 0 };
async function sgoGet(path: string, params: Record<string, string>): Promise<any> {
  if (!SGO_KEY) { const e: any = new Error("no_sgo_key"); e.code = "no_lines"; throw e; }
  // 10 requests a minute on this plan: wait for a slot rather than 429.
  for (;;) {
    const now = Date.now();
    sgoCalls = sgoCalls.filter((t) => now - t < 60_000);
    if (sgoCalls.length < 9) break;
    await new Promise((r) => setTimeout(r, 60_000 - (now - sgoCalls[0]) + 50));
  }
  sgoCalls.push(Date.now());
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${SGO_BASE}/${path}?${qs}`, { headers: { "x-api-key": SGO_KEY, "user-agent": "monte-simbook" } } as any);
  if (!r.ok) { const e: any = new Error(`SGO ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
/** Monthly game budget: refuse new reads before the plan's cap, keep a reserve for grading. */
async function sgoBudgetOk(reserve = 0): Promise<boolean> {
  if (Date.now() - sgoUsage.at > 10 * 60_000) {
    try {
      const d = await sgoGet("account/usage", {});
      sgoUsage = { at: Date.now(), used: Number(d?.data?.rateLimits?.["per-month"]?.["current-entities"] ?? 0) };
    } catch { sgoUsage.at = Date.now(); }
  }
  return sgoUsage.used + reserve < SGO_MONTH_CAP;
}

type SgoEvent = any;
const eventIdBySlug = new Map<string, string>();
const eventCache = new Map<string, { at: number; ev: SgoEvent | null }>();

/** Does this SGO event describe our game? (team ids, or names when the ids miss) */
function eventMatches(e: any, g: SlateGame): boolean {
  const h = e?.teams?.home?.teamID, a = e?.teams?.away?.teamID;
  const homeKeys = sgoTeamIds(g.home), awayKeys = sgoTeamIds(g.away);
  const hn = nameKey(e?.teams?.home?.names?.long), an = nameKey(e?.teams?.away?.names?.long);
  return (homeKeys.includes(h) && awayKeys.includes(a)) ||
         (hn === nameKey(g.home) && an === nameKey(g.away)) ||
         (homeKeys.includes(h) && an === nameKey(g.away)) ||
         (awayKeys.includes(a) && hn === nameKey(g.home));
}

/* The snapshot lives in simbook_events so a redeploy reloads it instead of
   re-buying it from SGO. */
let snapSupa: SupabaseClient | null = null;
const snapLoaded = new Map<number, Promise<void>>();
function ensureSnapshot(week: number): Promise<void> {
  const hit = snapLoaded.get(week); if (hit) return hit;
  const p = (async () => {
    if (!snapSupa) return;
    const { data, error } = await snapSupa.from("simbook_events").select("slug, event_id, fetched_at, event").eq("season", SEASON).eq("week", week);
    if (error) throw error;
    for (const r of data || []) {
      const ck = `${week}/${r.slug}`, at = Date.parse(r.fetched_at);
      if (r.event_id) eventIdBySlug.set(ck, r.event_id);
      const cur = eventCache.get(ck);
      if (!cur || cur.at < at) eventCache.set(ck, { at, ev: r.event || null });
    }
  })();
  p.catch((e) => { snapLoaded.delete(week); console.warn("[simbook] snapshot load:", e?.message ?? e); });
  snapLoaded.set(week, p);
  return p;
}
function saveEvent(g: SlateGame, ev: SgoEvent | null, at: number) {
  const ck = `${g.week}/${g.slug}`;
  eventCache.set(ck, { at, ev });
  if (ev?.eventID) eventIdBySlug.set(ck, ev.eventID);
  if (!snapSupa || PREVIEW) return;
  snapSupa.from("simbook_events").upsert({ season: SEASON, week: g.week, slug: g.slug, event_id: ev?.eventID ?? eventIdBySlug.get(ck) ?? null,
    fetched_at: new Date(at).toISOString(), event: ev }).then(({ error }) => { if (error) console.warn("[simbook] snapshot save:", error.message); });
}

async function sgoEventFor(g: SlateGame, maxAgeMs = EVENT_TTL_MS): Promise<SgoEvent | null> {
  const ck = `${g.week}/${g.slug}`;
  await ensureSnapshot(g.week).catch(() => {});
  const hit = eventCache.get(ck);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.ev;
  if (!(await sgoBudgetOk(100))) {
    if (hit) return hit.ev;              // out of budget: the last board beats no board (bets still re-price)
    const e: any = new Error("sgo_budget"); e.code = "budget"; throw e;
  }
  const base = { leagueID: "NCAAF", bookmakerID: "draftkings", includeAltLines: "true", limit: "1" };
  let ev: SgoEvent | null = null;
  const known = eventIdBySlug.get(ck);
  if (known) {
    const d = await sgoGet("events", { ...base, eventIDs: known });
    ev = d?.data?.[0] || null;
  } else {
    const after = new Date(Date.parse(g.kickoff) - 3 * 86400_000).toISOString();
    outer: for (const tid of [...sgoTeamIds(g.home), ...sgoTeamIds(g.away)]) {
      const d = await sgoGet("events", { ...base, teamID: tid, startsAfter: after });
      for (const e of d?.data || []) if (eventMatches(e, g)) { ev = e; break outer; }
    }
  }
  if (eventCache.size > 400) eventCache.clear();
  saveEvent(g, ev, Date.now());
  return ev;
}

/** Spend no faster than the month allows: the cap, pro-rated to today, plus slack. */
async function budgetPaced(n: number): Promise<boolean> {
  if (!(await sgoBudgetOk(100 + n))) return false;
  const d = new Date(), dim = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
  const allowance = SGO_MONTH_CAP * (d.getUTCDate() / dim) + 300;
  return sgoUsage.used + n <= allowance;
}

/** Re-read every not-yet-kicked game's board in batched calls, then price the
 *  cards. Runs in the background off a slate request, one pass per week at a time. */
const warming = new Map<number, Promise<void>>();
function warmSlate(deps: SimbookDeps, week: number): Promise<void> {
  const running = warming.get(week); if (running) return running;
  const p = (async () => {
    await ensureSnapshot(week).catch(() => {});
    const games = await slate(deps, week);
    const now = Date.now();
    const open = games.filter((g) => now < Date.parse(g.kickoff) - 60_000);
    const ckOf = (g: SlateGame) => `${week}/${g.slug}`;
    if (PREVIEW) {
      for (const g of open) if (!eventCache.has(ckOf(g))) eventCache.set(ckOf(g), { at: now, ev: await previewEvent(deps, g).catch(() => null) });
    } else {
      const stale = open.filter((g) => {
        const h = eventCache.get(ckOf(g));
        return !h || now - h.at > CARD_TTL_MS;
      });
      if (stale.length && (await budgetPaced(stale.length))) {
        const base = { leagueID: "NCAAF", bookmakerID: "draftkings", includeAltLines: "true" };
        const known = stale.filter((g) => eventIdBySlug.has(ckOf(g)));
        const unknown = stale.filter((g) => !eventIdBySlug.has(ckOf(g)));
        if (unknown.length > 5) {
          // ONE league-wide pass over the window: with the DK filter SGO returns exactly
          // the games DK lists, so this refreshes the known ones and finds new ones together.
          const ks = stale.map((g) => Date.parse(g.kickoff));
          const params: Record<string, string> = { ...base, limit: "100",
            startsAfter: new Date(Math.min(...ks) - 3 * 3600_000).toISOString(), startsBefore: new Date(Math.max(...ks) + 3 * 3600_000).toISOString() };
          const found = new Map<string, any>();
          for (let page = 0; page < 6; page++) {
            const d = await sgoGet("events", params);
            for (const e of d?.data || []) {
              const g = stale.find((x) => !found.has(x.slug) && (eventIdBySlug.get(ckOf(x)) === e.eventID || eventMatches(e, x)));
              if (g) found.set(g.slug, e);
            }
            if (!d?.nextCursor) break;
            params.cursor = String(d.nextCursor);
          }
          for (const g of stale) saveEvent(g, found.get(g.slug) || null, Date.now());
        } else {
          for (let i = 0; i < known.length; i += 25) {
            const chunk = known.slice(i, i + 25);
            const d = await sgoGet("events", { ...base, eventIDs: chunk.map((g) => eventIdBySlug.get(ckOf(g))!).join(","), limit: "25" });
            const byId = new Map<string, any>((d?.data || []).map((e: any) => [e.eventID, e]));
            for (const g of chunk) saveEvent(g, byId.get(eventIdBySlug.get(ckOf(g))!) || null, Date.now());
          }
          // a few strays (usually games DK hasn't posted): the per-team lookup costs a handful, not a league
          for (const g of unknown) await sgoEventFor(g, 0).catch(() => null);
        }
        if (snapSupa) snapSupa.from("simbook_events").delete().eq("season", SEASON).lt("week", week - 1).then(() => {});
      }
    }
    for (const g of open) await cardFor(deps, g).catch(() => null);
  })();
  p.catch((e) => console.warn("[simbook] warm:", e?.message ?? e)).finally(() => warming.delete(week));
  warming.set(week, p);
  return p;
}

/* ------------------------------------------------------------ PREVIEW MODE */
// No SGO_API_KEY (owner 2026-10-19: "just wanna look at the interface"): build an
// SGO-shaped event from what we already publish — the consensus close in
// lines.json, a normal-curve alt ladder around it, and props at the sim's own
// medians — so the whole board renders. Prices are SAMPLES: betting is refused.
const PREVIEW = !SGO_KEY;
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
function amFromP(p: number, vig = 0.0225): string {
  const q = Math.min(0.97, Math.max(0.03, p * (1 + vig)));
  const am = q >= 0.5 ? -Math.round((100 * q) / (1 - q)) : Math.round((100 * (1 - q)) / q);
  return am > 0 ? `+${am}` : `${am}`;
}
async function previewEvent(deps: SimbookDeps, g: SlateGame): Promise<SgoEvent | null> {
  const ww = String(g.week).padStart(2, "0");
  const lines = await hfJson(deps, `${SEASON}/weeks/week${ww}/lines.json`).catch(() => null);
  const L = lines?.games?.[g.slug];
  const hm = Number(L?.spread?.close ?? L?.spread?.open);          // home handicap, negative = home favoured
  const tot = Number(L?.total?.close ?? L?.total?.open);
  if (!Number.isFinite(hm) || !Number.isFinite(tot)) return null;
  const mu = -hm, SDM = 15, SDT = 13, SDTT = 9;
  const odds: Record<string, any> = {};
  const half = (x: number) => Math.round(x * 2) / 2;
  const ladder = (mainLine: number, pOf: (line: number) => number, field: "spread" | "overUnder", sign = 1) => {
    const fmt = (v: number) => (field === "spread" && v > 0 ? `+${v}` : `${v}`);
    const main = { odds: amFromP(pOf(mainLine)), [field]: fmt(mainLine), available: true, altLines: [] as any[] };
    for (let k = -7; k <= 7; k++) {
      if (!k) continue;
      const ln = mainLine + sign * k;
      main.altLines.push({ odds: amFromP(pOf(ln)), [field]: fmt(ln), available: true });
    }
    return { byBookmaker: { draftkings: main } };
  };
  odds["points-home-game-sp-home"] = ladder(hm, (h) => 1 - normCdf((-h - mu) / SDM), "spread");
  odds["points-away-game-sp-away"] = ladder(-hm, (a) => normCdf((a - mu) / SDM), "spread");
  odds["points-all-game-ou-over"] = ladder(tot, (t) => 1 - normCdf((t - tot) / SDT), "overUnder");
  odds["points-all-game-ou-under"] = ladder(tot, (t) => normCdf((t - tot) / SDT), "overUnder");
  const hT = half((tot + mu) / 2) + 0.5 * (Number.isInteger(half((tot + mu) / 2)) ? 1 : 0);
  const aT = half((tot - mu) / 2) + 0.5 * (Number.isInteger(half((tot - mu) / 2)) ? 1 : 0);
  odds["points-home-game-ou-over"] = ladder(hT, (t) => 1 - normCdf((t - (tot + mu) / 2) / SDTT), "overUnder");
  odds["points-home-game-ou-under"] = ladder(hT, (t) => normCdf((t - (tot + mu) / 2) / SDTT), "overUnder");
  odds["points-away-game-ou-over"] = ladder(aT, (t) => 1 - normCdf((t - (tot - mu) / 2) / SDTT), "overUnder");
  odds["points-away-game-ou-under"] = ladder(aT, (t) => normCdf((t - (tot - mu) / 2) / SDTT), "overUnder");
  const pHome = normCdf(mu / SDM);
  odds["points-home-game-ml-home"] = { byBookmaker: { draftkings: { odds: amFromP(pHome), available: true } } };
  odds["points-away-game-ml-away"] = { byBookmaker: { draftkings: { odds: amFromP(1 - pHome), available: true } } };
  // props at the sim's median, priced -115 over (overs only, as live)
  const s = await seedsFor(deps, g);
  const players: Record<string, any> = {};
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] || 0; };
  const PICK: [string, string, number][] = [
    ["passing_yards", "pass_yds", 120], ["passing_completions", "pass_comp", 10], ["passing_attempts", "pass_att", 15],
    ["passing_touchdowns", "pass_td", 1], ["rushing_yards", "rush_yds", 25], ["rushing_attempts", "rush_att", 6],
    ["receiving_yards", "rec_yds", 20], ["receiving_receptions", "rec", 2],
  ];
  let n = 0;
  for (const nm of new Set(Object.keys(s.players).map((k) => k.split("|")[0]))) {
    const pid = `PV${n++}`;
    let any = false;
    for (const [sgoStat, simStat, floor] of PICK) {
      const col = s.players[`${nm}|${simStat}`]; if (!col) continue;
      const m = med(col); if (m < floor) continue;
      const line = Math.floor(m) + 0.5;
      odds[`${sgoStat}-${pid}-game-ou-over`] = { playerID: pid, statID: sgoStat, periodID: "game", betTypeID: "ou", sideID: "over",
        byBookmaker: { draftkings: { odds: "-115", overUnder: String(line), available: true } } };
      any = true;
    }
    if (any) players[pid] = { playerID: pid, name: nm };
  }
  return { eventID: "preview", preview: true, status: { started: false, startsAt: g.kickoff }, players, odds };
}

/* --------------------------------------------------------------- markets */
// A LEG is identified by a key string the browser hands back:
//   slug|market|side|line|player|stat
// market: spread (side home/away, line = that side's handicap), total (over/under),
//         ml (home/away), tt (team total: side = home_over/home_under/away_over/away_under),
//         prop (side over/under, player = SGO player id, stat = SGO stat id)
type Leg = {
  key: string; slug: string; market: "spread" | "total" | "ml" | "tt" | "prop";
  side: string; line: number | null; player?: string; stat?: string;
};
type PricedLeg = Leg & {
  label: string; group: string; sub: string; main: boolean; game: string; kickoff: string; sgo_event: string; odd_id: string;
  dk_american: number; dk_dec: number; p_mkt: number;
  q_sim: number; p_win: number; p_push: number; hold: number;
  sim_player?: string;
  american: number; dec: number; house_ev: number; parlay_ok: boolean;
  /** per-seed outcome, 1 win / 0 push / -1 loss (kept server-side only) */
  outcome?: Int8Array;
};

const PROP_STATS: Record<string, { label: string; sim: string[] }> = {
  passing_yards: { label: "Passing yards", sim: ["pass_yds"] },
  passing_touchdowns: { label: "Passing TDs", sim: ["pass_td"] },
  passing_attempts: { label: "Pass attempts", sim: ["pass_att"] },
  passing_completions: { label: "Completions", sim: ["pass_comp"] },
  passing_interceptions: { label: "Interceptions thrown", sim: ["int"] },
  rushing_yards: { label: "Rushing yards", sim: ["rush_yds"] },
  rushing_attempts: { label: "Carries", sim: ["rush_att"] },
  receiving_yards: { label: "Receiving yards", sim: ["rec_yds"] },
  receiving_receptions: { label: "Receptions", sim: ["rec"] },
  "passing+rushing_yards": { label: "Pass + rush yards", sim: ["pass_yds", "rush_yds"] },
  "rushing+receiving_yards": { label: "Rush + rec yards", sim: ["rush_yds", "rec_yds"] },
  touchdowns: { label: "Touchdowns scored", sim: ["rush_td", "rec_td"] },
};

/** Every DK quote we can price for one event, keyed by leg key (no sim yet). */
type Quote = { leg: Leg; label: string; group: string; odd_id: string; dk_american: number; pair_american: number | null; main: boolean; sub: string };
function quotesFromEvent(g: SlateGame, ev: SgoEvent): Quote[] {
  const odds = ev?.odds || {};
  const out: Quote[] = [];
  const dkOf = (oid: string) => {
    const b = odds?.[oid]?.byBookmaker?.draftkings;
    return b && b.available !== false ? b : null;
  };
  const ladder = (b: any, field: "spread" | "overUnder") => {
    const rows: { line: number; am: number; main: boolean }[] = [];
    if (!b) return rows;
    const add = (o: any, main: boolean) => {
      const am = parseAm(o?.odds); const line = Number(String(o?.[field] ?? "").replace("+", ""));
      if (am != null && Number.isFinite(line) && o?.available !== false && !rows.some((r) => r.line === line)) rows.push({ line, am, main });
    };
    add(b, true);
    for (const a of b.altLines || []) add(a, false);
    return rows;
  };
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  // spreads: pair home handicap h with away handicap -h
  {
    const home = ladder(dkOf("points-home-game-sp-home"), "spread");
    const away = ladder(dkOf("points-away-game-sp-away"), "spread");
    const awayBy = new Map(away.map((r) => [r.line, r.am]));
    const homeBy = new Map(home.map((r) => [r.line, r.am]));
    for (const r of home) out.push({ leg: { key: `${g.slug}|spread|home|${r.line}||`, slug: g.slug, market: "spread", side: "home", line: r.line },
      label: `${g.home} ${fmt(r.line)}`, group: "Spread", odd_id: "points-home-game-sp-home", dk_american: r.am, pair_american: awayBy.get(-r.line) ?? null, main: r.main, sub: "Spread" });
    for (const r of away) out.push({ leg: { key: `${g.slug}|spread|away|${r.line}||`, slug: g.slug, market: "spread", side: "away", line: r.line },
      label: `${g.away} ${fmt(r.line)}`, group: "Spread", odd_id: "points-away-game-sp-away", dk_american: r.am, pair_american: homeBy.get(-r.line) ?? null, main: r.main, sub: "Spread" });
  }
  // totals + team totals
  const ou = (overId: string, underId: string, market: "total" | "tt", sidePrefix: string, who: string, group: string) => {
    const over = ladder(dkOf(overId), "overUnder"), under = ladder(dkOf(underId), "overUnder");
    const uBy = new Map(under.map((r) => [r.line, r.am])), oBy = new Map(over.map((r) => [r.line, r.am]));
    for (const r of over) out.push({ leg: { key: `${g.slug}|${market}|${sidePrefix}over|${r.line}||`, slug: g.slug, market, side: `${sidePrefix}over`, line: r.line },
      label: `${who}Over ${r.line}`, group, odd_id: overId, dk_american: r.am, pair_american: uBy.get(r.line) ?? null, main: r.main, sub: who.trim() || "Total" });
    for (const r of under) out.push({ leg: { key: `${g.slug}|${market}|${sidePrefix}under|${r.line}||`, slug: g.slug, market, side: `${sidePrefix}under`, line: r.line },
      label: `${who}Under ${r.line}`, group, odd_id: underId, dk_american: r.am, pair_american: oBy.get(r.line) ?? null, main: r.main, sub: who.trim() || "Total" });
  };
  ou("points-all-game-ou-over", "points-all-game-ou-under", "total", "", "", "Total");
  ou("points-home-game-ou-over", "points-home-game-ou-under", "tt", "home_", `${g.home} `, "Team totals");
  ou("points-away-game-ou-over", "points-away-game-ou-under", "tt", "away_", `${g.away} `, "Team totals");
  // moneyline
  {
    const h = parseAm(dkOf("points-home-game-ml-home")?.odds), a = parseAm(dkOf("points-away-game-ml-away")?.odds);
    if (h != null) out.push({ leg: { key: `${g.slug}|ml|home|||`, slug: g.slug, market: "ml", side: "home", line: null },
      label: `${g.home} to win`, group: "Moneyline", odd_id: "points-home-game-ml-home", dk_american: h, pair_american: a, main: true, sub: "Moneyline" });
    if (a != null) out.push({ leg: { key: `${g.slug}|ml|away|||`, slug: g.slug, market: "ml", side: "away", line: null },
      label: `${g.away} to win`, group: "Moneyline", odd_id: "points-away-game-ml-away", dk_american: a, pair_american: h, main: true, sub: "Moneyline" });
  }
  // player props: DK lists OVERS (main + alt ladder) and anytime-TD yes. We
  // offer the overs only (owner 2026-10-19: no unders, no market without a DK price).
  for (const [oid, o] of Object.entries<any>(odds)) {
    const pid = o?.playerID; if (!pid || o?.periodID !== "game") continue;
    const ps = PROP_STATS[o.statID]; if (!ps) continue;
    const pname = ev?.players?.[pid]?.name || pid;
    const b = dkOf(oid); if (!b) continue;
    if (o.betTypeID === "ou" && o.sideID === "over") {
      for (const r of ladder(b, "overUnder")) {
        const base = { slug: g.slug, market: "prop" as const, line: r.line, player: pid, stat: o.statID };
        out.push({ leg: { ...base, key: `${g.slug}|prop|over|${r.line}|${pid}|${o.statID}`, side: "over" },
          label: `${pname} over ${r.line} ${ps.label.toLowerCase()}`, group: pname, odd_id: oid, dk_american: r.am, pair_american: null, main: r.main, sub: ps.label });
      }
    } else if (o.statID === "touchdowns" && o.betTypeID === "yn" && o.sideID === "yes") {
      const am = parseAm(b.odds); if (am == null) continue;
      out.push({ leg: { key: `${g.slug}|prop|over|0.5|${pid}|touchdowns`, slug: g.slug, market: "prop", side: "over", line: 0.5, player: pid, stat: "touchdowns" },
        label: `${pname} anytime TD`, group: pname, odd_id: oid, dk_american: am, pair_american: null, main: true, sub: "Anytime TD" });
    }
  }
  // de-dup (an anytime-TD yes and a 0.5 over can collide): keep the better DK price for him? no — keep the first.
  const seen = new Set<string>();
  return nearEven(out.filter((q) => (seen.has(q.leg.key) ? false : (seen.add(q.leg.key), true))));
}

/** Owner 2026-10-19: no long ladders. Per market keep only the line(s) DK prices
 *  closest to 50/50: the closest one, plus up to two more within 45-55%.
 *  Moneylines and anytime TDs are one line each and pass through. */
const NEAR_EVEN = 0.05, MAX_LINES_PER_MARKET = 3;
function nearEven(qs: Quote[]): Quote[] {
  // reference side = home (spread) / over (totals, props); its no-vig probability per line
  const ladderOf = (q: Quote): { group: string; line: number; p: number } | null => {
    const l = q.leg;
    if (l.market === "ml" || l.line == null || q.sub === "Anytime TD") return null;
    const imp = 1 / amToDec(q.dk_american);
    const hold = l.market === "prop" ? H_PROPS : H_LINES;
    let p = q.pair_american != null ? imp / (imp + 1 / amToDec(q.pair_american)) : imp / (1 + hold);
    if (l.market === "spread") {
      if (l.side === "away") p = 1 - p;
      return { group: "spread", line: l.side === "home" ? l.line : -l.line, p };
    }
    if (l.market === "prop") return { group: `prop|${l.player}|${l.stat}`, line: l.line, p };
    const prefix = l.side.replace(/(over|under)$/, "");
    if (l.side.endsWith("under")) p = 1 - p;
    return { group: `${l.market}|${prefix}`, line: l.line, p };
  };
  const byGroup = new Map<string, Map<number, number[]>>();
  const info = qs.map(ladderOf);
  info.forEach((x) => {
    if (!x) return;
    const m = byGroup.get(x.group) || new Map<number, number[]>(); byGroup.set(x.group, m);
    m.set(x.line, [...(m.get(x.line) || []), x.p]);
  });
  const keep = new Map<string, Set<number>>();
  for (const [grp, lines] of byGroup) {
    const ranked = [...lines].map(([line, ps]) => ({ line, d: Math.abs(ps.reduce((a, b) => a + b, 0) / ps.length - 0.5) }))
      .sort((a, b) => a.d - b.d);
    const pick = ranked.filter((r, i) => i === 0 || r.d <= NEAR_EVEN).slice(0, MAX_LINES_PER_MARKET);
    keep.set(grp, new Set(pick.map((r) => r.line)));
  }
  return qs.filter((q, i) => { const x = info[i]; return !x || keep.get(x.group)!.has(x.line); });
}

/** Per-seed outcome of a leg (1 win, 0 push, -1 loss), or null when the sim can't price it. */
function legOutcome(leg: Leg, s: Seeds, ev: SgoEvent, g: SlateGame): { out: Int8Array; simPlayer?: string } | null {
  const n = Math.min(s.A.length, s.B.length);
  const out = new Int8Array(n);
  const cmp = (x: number, line: number) => (x > line ? 1 : x < line ? -1 : 0);
  if (leg.market === "spread") {
    for (let i = 0; i < n; i++) { const m = s.A[i] - s.B[i]; out[i] = cmp(leg.side === "home" ? m + leg.line! : -m + leg.line!, 0); }
  } else if (leg.market === "total") {
    for (let i = 0; i < n; i++) { const c = cmp(s.A[i] + s.B[i], leg.line!); out[i] = leg.side === "over" ? c : (-c as any); }
  } else if (leg.market === "tt") {
    const home = leg.side.startsWith("home"); const over = leg.side.endsWith("over");
    for (let i = 0; i < n; i++) { const c = cmp(home ? s.A[i] : s.B[i], leg.line!); out[i] = over ? c : (-c as any); }
  } else if (leg.market === "ml") {
    // a tied seed (rare: the sim plays OT) splits — count it as a push here, weighted out below
    for (let i = 0; i < n; i++) { const m = s.A[i] - s.B[i]; out[i] = leg.side === "home" ? cmp(m, 0) : cmp(-m, 0); }
  } else {
    const ps = PROP_STATS[leg.stat || ""]; if (!ps) return null;
    const pname = ev?.players?.[leg.player || ""]?.name; if (!pname) return null;
    const cands = s.names.get(nameKey(pname)) || [];
    if (cands.length !== 1) return null;           // never guess between two players
    const cols = ps.sim.map((st) => s.players[`${cands[0]}|${st}`]);
    if (cols.some((c) => !c)) return null;
    for (let i = 0; i < n; i++) {
      let v = 0; for (const c of cols) v += c[i] || 0;
      const c = cmp(v, leg.line!); out[i] = leg.side === "over" ? c : (-c as any);
    }
    return { out, simPlayer: cands[0] };
  }
  return { out };
}

function priceLeg(q: Quote, s: Seeds, ev: SgoEvent, g: SlateGame): PricedLeg | null {
  const lo = legOutcome(q.leg, s, ev, g); if (!lo) return null;
  const n = lo.out.length; let w = 0, p = 0;
  for (let i = 0; i < n; i++) { if (lo.out[i] === 1) w++; else if (lo.out[i] === 0) p++; }
  let pWin = w / n, pPush = p / n;
  if (q.leg.market === "ml") { pWin += pPush / 2; pPush = 0; }   // a tie is a coin flip in OT
  const qSim = pPush < 1 ? pWin / (1 - pPush) : 0.5;
  const hold = q.leg.market === "prop" ? H_PROPS : H_LINES;
  // DK's no-vig probability for this side
  if (!Number.isFinite(q.dk_american)) return null;  // no DK price, no market
  const imp = 1 / amToDec(q.dk_american);
  let pMkt = q.pair_american != null ? imp / (imp + 1 / amToDec(q.pair_american)) : imp / (1 + hold);
  const dkDec = amToDec(q.dk_american);
  pMkt = Math.min(0.99, Math.max(0.01, pMkt));
  if (qSim <= 0.003 || qSim >= 0.997) return null;  // the sim says (almost) never/always: no market
  const pHouse = (qSim + pMkt) / 2;
  let dec = Math.min(dkDec, (1 - hold) / pHouse, (1 - H_SIM) / qSim);
  let american = decToAmHouse(dec);
  if (american < AM_MIN || american > AM_MAX_SINGLE) return null;
  dec = amToDec(american);
  const houseEv = 1 - (pWin * dec + pPush);
  const label = q.label;
  return {
    ...q.leg, label, group: q.group, sub: q.sub, main: q.main, game: `${g.away} at ${g.home}`, kickoff: g.kickoff,
    sgo_event: ev.eventID, odd_id: q.odd_id,
    dk_american: q.dk_american, dk_dec: dkDec,
    p_mkt: pMkt, q_sim: qSim, p_win: pWin, p_push: pPush, hold, sim_player: lo.simPlayer,
    american, dec, house_ev: houseEv, parlay_ok: pPush === 0 && (q.leg.line == null || Math.abs(q.leg.line % 1) === 0.5),
    outcome: lo.out,
  };
}

function kickedOff(g: SlateGame, ev: SgoEvent | null): boolean {
  const now = Date.now();
  const ko = Math.min(Date.parse(g.kickoff) || Infinity, Date.parse(ev?.status?.startsAt) || Infinity);
  return Boolean(ev?.status?.started) || now >= ko - 60_000;
}

/** A card's game lines (spread / total / ML / team totals), priced off the
 *  snapshot as it stands: never reads SGO. Re-priced when the snapshot moves. */
type CardLegs = { at: number; legs: PricedLeg[] };
const cardCache = new Map<string, CardLegs>();
async function cardFor(deps: SimbookDeps, g: SlateGame): Promise<CardLegs | null> {
  const ck = `${g.week}/${g.slug}`;
  const hit = eventCache.get(ck);
  if (!hit?.ev) return null;
  const cur = cardCache.get(ck);
  if (cur && cur.at === hit.at) return cur;
  const s = await seedsFor(deps, g);
  const legs: PricedLeg[] = [];
  for (const q of quotesFromEvent(g, hit.ev)) {
    if (q.leg.market === "prop") continue;
    const pl = priceLeg(q, s, hit.ev, g); if (pl) { delete pl.outcome; legs.push(pl); }
  }
  const out = { at: hit.at, legs };
  cardCache.set(ck, out);
  return out;
}

async function boardFor(deps: SimbookDeps, week: number, slug: string, maxAgeMs = EVENT_TTL_MS) {
  const g = await gameOf(deps, week, slug);
  if (!g) { const e: any = new Error("no_game"); e.code = "no_game"; throw e; }
  const ev = PREVIEW ? await previewEvent(deps, g) : await sgoEventFor(g, maxAgeMs);
  if (!ev) return { g, ev: null, legs: [] as PricedLeg[] };
  const s = await seedsFor(deps, g);
  const legs: PricedLeg[] = [];
  for (const q of quotesFromEvent(g, ev)) { const pl = priceLeg(q, s, ev, g); if (pl) legs.push(pl); }
  const at = eventCache.get(`${week}/${slug}`)?.at;
  if (at != null) cardCache.set(`${week}/${slug}`, { at, legs: legs.filter((l) => l.market !== "prop").map(({ outcome, ...l }) => l as PricedLeg) });
  return { g, ev, legs };
}

/** What the bettor may see about a leg: never the sim's or the market's probability. */
function publicLeg(l: PricedLeg, owner: boolean) {
  const base = { key: l.key, label: l.label, group: l.group, sub: l.sub, main: l.main, market: l.market, side: l.side, line: l.line,
                 american: l.american, dec: l.dec, parlay_ok: l.parlay_ok };
  if (!owner) return base;
  return { ...base, dk_american: l.dk_american, q_sim: l.q_sim, p_mkt: l.p_mkt, house_ev: l.house_ev, sim_player: l.sim_player };
}

/* --------------------------------------------------------------- tickets */
async function quoteTicket(deps: SimbookDeps, week: number, keys: string[], fresh: boolean) {
  if (!keys.length || keys.length > MAX_LEGS) throw Object.assign(new Error("bad_legs"), { code: "bad_legs" });
  if (new Set(keys).size !== keys.length) throw Object.assign(new Error("dup_leg"), { code: "dup_leg" });
  const bySlug = new Map<string, string[]>();
  for (const k of keys) { const slug = k.split("|")[0]; bySlug.set(slug, [...(bySlug.get(slug) || []), k]); }
  const legs: PricedLeg[] = [];
  let pSim = 1;
  for (const [slug, ks] of bySlug) {
    const b = await boardFor(deps, week, slug, fresh ? 45_000 : EVENT_TTL_MS);
    if (kickedOff(b.g, b.ev)) throw Object.assign(new Error("started"), { code: "started", slug });
    const mine = ks.map((k) => b.legs.find((l) => l.key === k));
    if (mine.some((l) => !l)) throw Object.assign(new Error("leg_gone"), { code: "leg_gone", slug });
    // one game's legs: the joint comes from the SAME seeds
    if (ks.length > 1) {
      const n = mine[0]!.outcome!.length; let w = 0;
      for (let i = 0; i < n; i++) { if (mine.every((l) => l!.outcome![i] === 1)) w++; }
      pSim *= w / n;
      // two sides of the same market can't both be in a ticket
      const mk = new Set(mine.map((l) => `${l!.market}|${l!.player || ""}|${l!.stat || ""}|${l!.market === "tt" ? l!.side.split("_")[0] : ""}`));
      if (mk.size !== mine.length) throw Object.assign(new Error("same_market"), { code: "same_market" });
    } else {
      pSim *= mine[0]!.p_win;
    }
    legs.push(...(mine as PricedLeg[]));
  }
  if (legs.length === 1) {
    const l = legs[0];
    return { kind: "single" as const, legs, american: l.american, dec: l.dec, p_sim: l.q_sim, p_mkt: l.p_mkt,
             p_house: (l.q_sim + l.p_mkt) / 2, house_ev: l.house_ev, dk_dec: l.dk_dec };
  }
  if (legs.some((l) => !l.parlay_ok)) throw Object.assign(new Error("parlay_push"), { code: "parlay_push" });
  const pMkt = legs.reduce((a, l) => a * l.p_mkt, 1);
  const dkDec = legs.reduce((a, l) => a * l.dk_dec, 1);
  const juice = legs.reduce((a, l) => a * (1 - l.hold), 1);
  if (pSim <= 0.0005) throw Object.assign(new Error("parlay_dead"), { code: "parlay_dead" });
  const pHouse = (pSim + pMkt) / 2;
  let dec = Math.min(dkDec, juice / pHouse, (1 - H_SIM) / pSim);
  let american = decToAmHouse(dec);
  if (american > AM_MAX_PARLAY) american = AM_MAX_PARLAY;
  if (american < AM_MIN) throw Object.assign(new Error("parlay_short"), { code: "parlay_short" });
  dec = amToDec(american);
  return { kind: "parlay" as const, legs, american, dec, p_sim: pSim, p_mkt: pMkt, p_house: pHouse,
           house_ev: 1 - pSim * dec, dk_dec: dkDec };
}

function legRecord(l: PricedLeg) {
  return { key: l.key, slug: l.slug, game: l.game, kickoff: l.kickoff, market: l.market, side: l.side, line: l.line, main: l.main,
           player: l.player || null, stat: l.stat || null, sim_player: l.sim_player || null, label: l.label,
           sgo_event: l.sgo_event, odd_id: l.odd_id, american: l.american, dk_american: l.dk_american,
           p_sim: l.q_sim, p_mkt: l.p_mkt, result: null as string | null, score: null as number | null,
           close_line: null as number | null, close_american: null as number | null };
}

/* ---------------------------------------------------------------- grading */
function gradeLeg(leg: any, ev: SgoEvent): { result: "won" | "lost" | "push" | "void"; score: number | null } | null {
  const R = ev?.results?.game; if (!R) return null;
  const hp = Number(R?.home?.points), ap = Number(R?.away?.points);
  const cmp = (x: number, line: number) => (x > line ? "won" : x < line ? "lost" : "push") as "won" | "lost" | "push";
  const flip = (r: "won" | "lost" | "push") => (r === "won" ? "lost" : r === "lost" ? "won" : "push") as typeof r;
  if (leg.market !== "prop" && !(Number.isFinite(hp) && Number.isFinite(ap))) return null;
  switch (leg.market) {
    case "spread": { const m = hp - ap; const v = leg.side === "home" ? m + leg.line : -m + leg.line; return { result: cmp(v, 0), score: m }; }
    case "total": { const t = hp + ap; const r = cmp(t, leg.line); return { result: leg.side === "over" ? r : flip(r), score: t }; }
    case "tt": { const x = leg.side.startsWith("home") ? hp : ap; const r = cmp(x, leg.line); return { result: leg.side.endsWith("over") ? r : flip(r), score: x }; }
    case "ml": { const m = hp - ap; if (m === 0) return { result: "void", score: 0 }; return { result: (leg.side === "home" ? m > 0 : m < 0) ? "won" : "lost", score: m }; }
    case "prop": {
      const st = R?.[leg.player]; if (!st) return { result: "void", score: null };   // did not play
      let v: number | null = null;
      if (leg.stat === "touchdowns") v = Number(st.rushing_touchdowns || 0) + Number(st.receiving_touchdowns || 0);
      else if (leg.stat.includes("+")) v = leg.stat.split("+").map((p: string) => Number(st[p.endsWith("_yards") ? p : `${p}_yards`] ?? st[p] ?? 0)).reduce((a: number, b: number) => a + b, 0);
      else v = st[leg.stat] != null ? Number(st[leg.stat]) : null;
      if (v == null || !Number.isFinite(v)) return { result: "void", score: null };
      const r = cmp(v, leg.line); return { result: leg.side === "over" ? r : flip(r), score: v };
    }
  }
  return null;
}
function closeOf(leg: any, ev: SgoEvent): { close_line: number | null; close_american: number | null } {
  const o = ev?.odds?.[leg.odd_id]; if (!o) return { close_line: null, close_american: null };
  const line = Number(String(o.closeBookSpread ?? o.closeBookOverUnder ?? "").replace("+", ""));
  return { close_line: Number.isFinite(line) && (o.closeBookSpread != null || o.closeBookOverUnder != null) ? line : null,
           close_american: parseAm(o.closeBookOdds) };
}

let grading = false;
let registered = false;
async function gradeOpenTickets(deps: SimbookDeps): Promise<{ settled: number; checked: number }> {
  if (!deps.supa || !SGO_KEY || grading) return { settled: 0, checked: 0 };
  grading = true;
  try {
    const { data: rows, error } = await deps.supa.from("simbook_tickets").select("*").eq("status", "open").limit(500);
    if (error || !rows?.length) return { settled: 0, checked: 0 };
    const now = Date.now();
    const need = new Set<string>();
    for (const t of rows) for (const l of t.legs || []) {
      if (!l.result && now - Date.parse(l.kickoff) > 3 * 3600_000 && l.sgo_event) need.add(l.sgo_event);
    }
    if (!need.size) return { settled: 0, checked: 0 };
    const evs = new Map<string, SgoEvent>();
    const ids = [...need];
    for (let i = 0; i < ids.length; i += 25) {
      const d = await sgoGet("events", { eventIDs: ids.slice(i, i + 25).join(","), limit: "25" });
      for (const e of d?.data || []) evs.set(e.eventID, e);
    }
    let settled = 0;
    for (const t of rows) {
      let changed = false;
      const legs = (t.legs || []).map((l: any) => {
        if (l.result) return l;
        const ev = evs.get(l.sgo_event);
        if (!ev) return l;
        if (ev?.status?.cancelled) { changed = true; return { ...l, result: "void" }; }
        if (!(ev?.status?.finalized || ev?.status?.completed)) return l;
        const gr = gradeLeg(l, ev); if (!gr) return l;
        changed = true;
        return { ...l, ...gr, ...closeOf(l, ev) };
      });
      if (!changed) continue;
      const res = legs.map((l: any) => l.result);
      let status: string = "open", payout: number | null = null;
      if (res.includes("lost")) { status = "lost"; payout = 0; }
      else if (res.every((r: any) => r)) {
        if (t.kind === "single") {
          status = res[0]; payout = status === "won" ? Number(t.stake) * Number(t.decimal_odds) : Number(t.stake);
        } else if (res.every((r: any) => r === "won")) { status = "won"; payout = Number(t.stake) * Number(t.decimal_odds); }
        else { status = "void"; payout = Number(t.stake); }     // a void leg voids the parlay (refund)
      }
      const patch: any = { legs };
      if (status !== "open") { patch.status = status; patch.payout = Math.round(payout! * 100) / 100; patch.settled_at = new Date().toISOString(); settled++; }
      await deps.supa.from("simbook_tickets").update(patch).eq("id", t.id).eq("status", "open");
    }
    return { settled, checked: rows.length };
  } catch (err: any) {
    console.warn("[simbook] grading failed:", err?.message ?? err);
    return { settled: 0, checked: 0 };
  } finally {
    grading = false;
  }
}

/* ------------------------------------------------------------------ routes */
export function registerSimbook(app: Express, deps: SimbookDeps) {
  if (registered) return;               // once per process: routes + the grading timer
  registered = true;
  snapSupa = deps.supa;
  const playerCache = new Map<string, { at: number; row: any }>();
  async function playerRow(uid: string): Promise<any | null> {
    const hit = playerCache.get(uid);
    if (hit && Date.now() - hit.at < 60_000) return hit.row;
    const { data } = await deps.supa!.from("simbook_players").select("*").eq("user_id", uid).maybeSingle();
    playerCache.set(uid, { at: Date.now(), row: data || null });
    return data || null;
  }
  /** who: owner | player | null (not allowed) */
  async function who(req: Request): Promise<{ uid: string; owner: boolean; player: any | null } | null> {
    if (!deps.supa) return null;
    const u = deps.userOf(req); if (!u) return null;
    const owner = deps.isOwner(u.id);
    const player = await playerRow(u.id);
    if (!owner && !(player && player.active)) return null;
    return { uid: u.id, owner, player };
  }
  const fail = (res: Response, err: any) => {
    const code = err?.code || "error";
    const status = code === "no_game" ? 404 : code === "started" || code === "leg_gone" || code === "price_changed" ? 409
      : code === "budget" || code === "no_lines" || code === "preview" ? 503 : ["bad_legs", "dup_leg", "same_market", "parlay_push", "parlay_dead", "parlay_short", "bad_stake"].includes(code) ? 400 : 500;
    if (status === 500) console.warn("[simbook]", err?.message ?? err);
    res.status(status).json({ error: code, slug: err?.slug });
  };

  app.get("/api/simbook/me", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req).catch(() => null);
    res.json({ allowed: Boolean(w), owner: Boolean(w?.owner), player: w?.player ? { name: w.player.name, max_stake: Number(w.player.max_stake) } : null,
               lines: Boolean(SGO_KEY), preview: PREVIEW });
  });

  app.get("/api/simbook/slate", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req); if (!w) { res.status(403).json({ error: "not_invited" }); return; }
    try {
      const week = Number(req.query.week) || (await currentWeek(deps));
      const games = await slate(deps, week);
      // the card's at-rest line (consensus, from our own lines.json: no SGO read).
      // House prices only come with the game's board, fetched when he opens it.
      const ww = String(week).padStart(2, "0");
      const lines = await hfJson(deps, `${SEASON}/weeks/week${ww}/lines.json`).catch(() => null);
      const num = (x: any) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
      // card prices come from the snapshot; a stale or missing one is re-read in the background
      warmSlate(deps, week);
      await ensureSnapshot(week).catch(() => {});
      const out = [];
      for (const g of games) {
        const L = lines?.games?.[g.slug];
        const started = Date.now() >= Date.parse(g.kickoff) - 60_000;
        const card = started ? null : cardCache.get(`${week}/${g.slug}`) || null;
        out.push({ slug: g.slug, home: g.home, away: g.away, kickoff: g.kickoff, started,
          spread: num(L?.spread?.close ?? L?.spread?.open), total: num(L?.total?.close ?? L?.total?.open),
          offers: card ? card.legs.map((l) => publicLeg(l, w.owner)) : undefined,
          as_of: card ? new Date(card.at).toISOString() : undefined,
          no_lines: !started && eventCache.has(`${week}/${g.slug}`) && !eventCache.get(`${week}/${g.slug}`)!.ev });
      }
      res.json({ season: SEASON, week, warming: warming.has(week), games: out });
    } catch (err) { fail(res, err); }
  });

  app.get("/api/simbook/game/:slug", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req); if (!w) { res.status(403).json({ error: "not_invited" }); return; }
    try {
      const week = Number(req.query.week) || (await currentWeek(deps));
      const b = await boardFor(deps, week, String(req.params.slug), OPEN_TTL_MS);
      res.json({ slug: b.g.slug, home: b.g.home, away: b.g.away, kickoff: b.g.kickoff, started: kickedOff(b.g, b.ev),
                 has_lines: Boolean(b.ev), preview: PREVIEW, as_of: new Date().toISOString(),
                 offers: b.legs.map((l) => publicLeg(l, w.owner)) });
    } catch (err) { fail(res, err); }
  });

  app.post("/api/simbook/quote", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req); if (!w) { res.status(403).json({ error: "not_invited" }); return; }
    try {
      const week = Number(req.body?.week) || (await currentWeek(deps));
      const keys = Array.isArray(req.body?.legs) ? req.body.legs.map(String).slice(0, MAX_LEGS + 1) : [];
      const t = await quoteTicket(deps, week, keys, false);
      res.json({ kind: t.kind, american: t.american, dec: t.dec, legs: t.legs.map((l) => publicLeg(l, w.owner)),
                 ...(w.owner ? { p_sim: t.p_sim, p_mkt: t.p_mkt, house_ev: t.house_ev, dk_dec: t.dk_dec } : {}) });
    } catch (err) { fail(res, err); }
  });

  const betTimes = new Map<string, number[]>();
  app.post("/api/simbook/bet", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req); if (!w || !w.player) { res.status(403).json({ error: w ? "owner_is_the_house" : "not_invited" }); return; }
    const recent = (betTimes.get(w.uid) || []).filter((t) => Date.now() - t < 60_000);
    if (recent.length >= 20) { res.status(429).json({ error: "slow_down" }); return; }
    betTimes.set(w.uid, [...recent, Date.now()]);
    try {
      const week = Number(req.body?.week) || (await currentWeek(deps));
      const keys = Array.isArray(req.body?.legs) ? req.body.legs.map(String).slice(0, MAX_LEGS + 1) : [];
      const stake = Math.round(Number(req.body?.stake) * 100) / 100;
      const maxStake = Number(w.player.max_stake || 5);
      if (!(stake > 0) || stake > maxStake) throw Object.assign(new Error("bad_stake"), { code: "bad_stake" });
      if (PREVIEW) throw Object.assign(new Error("preview"), { code: "preview" });
      const t = await quoteTicket(deps, week, keys, true);
      if (stake * t.dec > MAX_PAYOUT) throw Object.assign(new Error("bad_stake"), { code: "bad_stake" });
      const seen = Number(req.body?.expect_american);
      if (Number.isFinite(seen) && amToDec(seen) > t.dec + 1e-9) {
        res.status(409).json({ error: "price_changed", american: t.american, dec: t.dec, legs: t.legs.map((l) => publicLeg(l, false)) });
        return;
      }
      const row = {
        user_id: w.uid, season: SEASON, week, kind: t.kind, stake, american: t.american, decimal_odds: t.dec,
        p_sim: t.p_sim, p_mkt: t.p_mkt, p_house: t.p_house, house_ev: t.house_ev, dk_decimal: t.dk_dec,
        legs: t.legs.map(legRecord), note: typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : null,
      };
      const { data, error } = await deps.supa!.from("simbook_tickets").insert(row).select("id, created_at").single();
      if (error) throw error;
      res.json({ ok: true, id: data.id, created_at: data.created_at, american: t.american, dec: t.dec, stake, to_win: Math.round(stake * (t.dec - 1) * 100) / 100 });
    } catch (err) { fail(res, err); }
  });

  app.get("/api/simbook/tickets", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req); if (!w) { res.status(403).json({ error: "not_invited" }); return; }
    try {
      let q = deps.supa!.from("simbook_tickets").select("*").order("created_at", { ascending: false }).limit(1000);
      if (!w.owner) q = q.eq("user_id", w.uid);
      const { data, error } = await q;
      if (error) throw error;
      const { data: players } = w.owner ? await deps.supa!.from("simbook_players").select("user_id, name, active, max_stake") : { data: null };
      const strip = (t: any) => w.owner ? t : {
        ...t, p_sim: undefined, p_mkt: undefined, p_house: undefined, house_ev: undefined,
        legs: (t.legs || []).map((l: any) => ({ ...l, p_sim: undefined, p_mkt: undefined, sim_player: undefined })),
      };
      res.json({ owner: w.owner, players: players || undefined, tickets: (data || []).map(strip) });
    } catch (err) { fail(res, err); }
  });

  // owner: invite a player by site username, change his limit, pause him
  app.post("/api/simbook/players", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const w = await who(req); if (!w?.owner) { res.status(403).json({ error: "owner_only" }); return; }
    try {
      const handle = String(req.body?.handle || "").trim().toLowerCase();
      const { data: prof } = await deps.supa!.from("profiles").select("id, handle, display_name").eq("handle", handle).maybeSingle();
      if (!prof) { res.status(404).json({ error: "no_such_user" }); return; }
      const row: any = { user_id: prof.id, name: String(req.body?.name || prof.display_name || prof.handle).slice(0, 40) };
      if (req.body?.max_stake != null) row.max_stake = Math.min(100, Math.max(0.5, Number(req.body.max_stake) || 5));
      if (req.body?.active != null) row.active = Boolean(req.body.active);
      const { error } = await deps.supa!.from("simbook_players").upsert(row, { onConflict: "user_id" });
      if (error) throw error;
      playerCache.delete(prof.id);
      res.json({ ok: true, user_id: prof.id, name: row.name });
    } catch (err) { fail(res, err); }
  });

  // owner: run grading now
  app.post("/api/simbook/grade", async (req, res) => {
    const w = await who(req); if (!w?.owner) { res.status(403).json({ error: "owner_only" }); return; }
    res.json(await gradeOpenTickets(deps));
  });

  // grading: every 15 minutes, only does work when a ticket's game ended 3h+ ago
  if (deps.supa && SGO_KEY) {
    setInterval(() => { gradeOpenTickets(deps).catch(() => {}); }, 15 * 60_000).unref?.();
    setTimeout(() => { gradeOpenTickets(deps).catch(() => {}); }, 60_000).unref?.();
  }
  console.log(`[simbook] routes on; lines ${SGO_KEY ? "ON" : "PREVIEW (SGO_API_KEY not set: sample prices, betting off)"}`);
}

/** Test hooks (scripts/check_simbook.mjs). Not used by the server. */
export const _simbookTest = { boardFor, quoteTicket, gradeLeg, quotesFromEvent, priceLeg, decToAmHouse, amToDec, sgoTeamIds };
