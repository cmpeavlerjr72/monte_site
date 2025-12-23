import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";

import { useLiveScoreboard } from "../lib/useLiveScoreboard";
import { useEspnScoreboard } from "../lib/useEspnScoreboard";

import SupportButton from "../components/SupportButton";


/** LIVE SCOREBOARD TYPES / HELPERS (CBB) */
type LiveGame = {
  id: string;
  state: "pre" | "in" | "post" | "final" | "unknown";
  awayTeam?: string;
  homeTeam?: string;
  awayScore?: number;
  homeScore?: number;
  statusText: string;
  period?: number;
  displayClock?: string;

  liveTotal?: number;            // over/under line
  liveSpread?: number;           // point spread (home side)
  liveFavTeam?: string;          // team name of favorite (home/away)
  liveBook?: string | null;      // provider name (Caesars, etc.)

  awayId?: string;   // ESPN team.id
  homeId?: string;   // ESPN team.id

};

function cleanTeamName(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bst\.?\b/g, "state")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pairKey(a?: string, b?: string) {
  const aa = cleanTeamName(a);
  const bb = cleanTeamName(b);
  return [aa, bb].sort().join("::");
}

// Build a sorted key from two ESPN team IDs (strings)
function pairIdsKey(a?: string | number, b?: string | number) {
  if (!a || !b) return "";
  const A = String(a), B = String(b);
  return [A, B].sort().join("::");
}


// Slightly tweaked label for hoops ("H1/H2" instead of "Q1/Q2")
function mapEspnToLiveGamesCbb(payload: any): LiveGame[] {
  const events = payload?.events ?? [];
  return events.map((e: any) => {



    const type = e?.status?.type ?? e?.competitions?.[0]?.status?.type ?? {};
    const comp = e?.competitions?.[0];
    const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
    const home = comp?.competitors?.find((c: any) => c.homeAway === "home");

    const awayId = away?.team?.id ? String(away.team.id) : undefined;
    const homeId = home?.team?.id ? String(home.team.id) : undefined;

    const period = comp?.status?.period ?? e?.status?.period;
    const clock  = comp?.status?.displayClock ?? e?.status?.displayClock;

        // 🔹 NEW: odds block from ESPN
    const rawOdds = comp?.odds?.[0] ?? e?.odds?.[0] ?? null;

        // ESPN usually has overUnder + spread, with provider info.
    const liveTotal = rawOdds ? Number(rawOdds.overUnder ?? rawOdds.total) : undefined;
    const liveSpread = rawOdds ? Number(rawOdds.spread ?? rawOdds.pointSpread) : undefined;
    const liveBook = rawOdds?.provider?.name ?? rawOdds?.details ?? null;

    let liveFavTeam: string | undefined;
    if (rawOdds?.favorite) {
      // some payloads include a "favorite" team id or name
      const favId = String(rawOdds.favorite);
      if (home?.team?.id && String(home.team.id) === favId) {
        liveFavTeam = home?.team?.location ?? home?.team?.shortDisplayName ?? home?.team?.name;
      } else if (away?.team?.id && String(away.team.id) === favId) {
        liveFavTeam = away?.team?.location ?? away?.team?.shortDisplayName ?? away?.team?.name;
      }
    } else if (Number.isFinite(liveSpread)) {
      // Fallback heuristic: in ESPN scoreboard, spread is usually from home POV
      // Negative spread means home is favored.
      if ((liveSpread as number) < 0) {
        liveFavTeam = home?.team?.location ?? home?.team?.shortDisplayName ?? home?.team?.name;
      } else if ((liveSpread as number) > 0) {
        liveFavTeam = away?.team?.location ?? away?.team?.shortDisplayName ?? away?.team?.name;
      }
    }


    let state = String(type.state || "").toLowerCase();
    const name  = String(type.name || "").toUpperCase();
    const done  = Boolean(type.completed);
    if (done || name.includes("FINAL") || state === "post") state = "final";

    let statusText =
      type?.shortDetail || type?.detail || type?.description || "";
    if (state === "in") statusText = `H${period ?? "-"} ${clock ?? ""}`.trim();
    if (state === "final" && !statusText) statusText = "Final";

    const awayTeam =
      away?.team?.location ??           // "North Dakota"
      away?.team?.displayName ??        // "North Dakota Fighting Hawks"
      away?.team?.name ??
      away?.team?.shortDisplayName ??
      "";

    const homeTeam =
      home?.team?.location ??           // "Western Illinois"
      home?.team?.displayName ??
      home?.team?.name ??
      home?.team?.shortDisplayName ??
      "";

    const awayScoreRaw =
      away?.score ??
      away?.curScore ??
      (Array.isArray(away?.linescores) && away.linescores.length
        ? away.linescores[away.linescores.length - 1]?.score
        : undefined);
    const homeScoreRaw =
      home?.score ??
      home?.curScore ??
      (Array.isArray(home?.linescores) && home.linescores.length
        ? home.linescores[home.linescores.length - 1]?.score
        : undefined);

    const awayScore = Number(awayScoreRaw);
    const homeScore = Number(homeScoreRaw);

    return {
      id: String(e?.id ?? Math.random()),
      state: state as LiveGame["state"],
      statusText,
      awayTeam,
      homeTeam,
      awayId,            // <-- NEW
      homeId,
      awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
      homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
      period: Number.isFinite(Number(period)) ? Number(period) : undefined,
      displayClock: typeof clock === "string" ? clock : undefined,

      // NEW live odds
      liveTotal: Number.isFinite(liveTotal as number) ? (liveTotal as number) : undefined,
      liveSpread: Number.isFinite(liveSpread as number) ? (liveSpread as number) : undefined,
      liveFavTeam,
      liveBook,
    };
  });
}




function parseClockToSeconds(clock?: string): number | undefined {
  if (!clock) return;
  const m = clock.match(/(\d+):(\d{2})/);
  if (!m) return;
  const minutes = parseInt(m[1], 10);
  const seconds = parseInt(m[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return;
  return minutes * 60 + seconds;
}

const CBB_REG_SECONDS = 40 * 60; // 40-minute game

function computeElapsedSecondsCbb(lg: LiveGame): number | undefined {
  if (lg.state !== "in") return;
  const period = lg.period ?? 1;
  const remaining = parseClockToSeconds(lg.displayClock);
  if (remaining == null) return;

  const HALF = 20 * 60;
  let elapsed: number;

  if (period <= 1) {
    elapsed = HALF - remaining;
  } else if (period === 2) {
    elapsed = HALF + (HALF - remaining);
  } else {
    // OT – for pace we just treat as completed regulation
    elapsed = CBB_REG_SECONDS;
  }

  return Math.max(0, Math.min(elapsed, CBB_REG_SECONDS - 1));
}

/** CONFIG */
const DATASET_ROOT = "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026"; // e.g., 2026

/* ---------------- utils ---------------- */
function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function americanOdds(prob: number): string {
  if (!(prob > 0 && prob < 1)) return "—";
  if (Math.abs(prob - 0.5) < 1e-9) return "+100";
  if (prob > 0.5) return `-${Math.round((prob / (1 - prob)) * 100)}`;
  return `+${Math.round(((1 - prob) / prob) * 100)}`;
}
function pickStrLoose(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}
function pickNumLoose(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ---------------- types ---------------- */
type PriModel = { family?: string; link?: string; solver?: string; converged?: boolean; nobs?: number; rsq?: number; aic?: number; bic?: number };
type PriTeam = { mu?: number; sd?: number; exog?: Record<string, any>; imputed_from_train_median?: boolean };
type PriTarget = { A?: PriTeam; B?: PriTeam; model?: PriModel; model_file_sha1?: string; medians_file_sha1?: string };
type Priors = {
  game_id?: string;
  date?: string;
  A_slug?: string;
  B_slug?: string;
  model_version?: string;
  targets?: Record<string, PriTarget>;
};

type MarketEval = {
  moneyline?: {
    A?: { wins?: number; prob?: number; fair_american?: number };
    B?: { wins?: number; prob?: number; fair_american?: number };
    ties?: number;
  };
  spread?: {
    A?: { line?: number; covers?: number; pushes?: number; prob_cover?: number; fair_american?: number };
    B?: { line?: number; covers?: number; pushes?: number; prob_cover?: number; fair_american?: number };
  };
  total?: {
    line?: number;
    over?: { wins?: number; pushes?: number; prob?: number; fair_american?: number };
    under?: { wins?: number; pushes?: number; prob?: number; fair_american?: number };
  };
};

type OddsBlock = {
  book?: string | null;
  source?: string | null;
  start_utc?: string | null;
  matched_home_side?: "A" | "B" | "a" | "b" | null;

  home_ml?: number | null;
  away_ml?: number | null;

  home_spread?: number | null;
  home_spread_price?: number | null;
  away_spread?: number | null;
  away_spread_price?: number | null;

  total?: number | null;
  over_price?: number | null;
  under_price?: number | null;
};

type FairBlock = {
  A_ml?: number;
  B_ml?: number;
  A_spread?: { line: number; odds: number } | null;
  B_spread?: { line: number; odds: number } | null;
  total?: { line: number; over: number; under: number } | null;
};

type GameRow = {
  aLogoPrimary?: string | null;
  aLogoAlt?: string | null;
  bLogoPrimary?: string | null;
  bLogoAlt?: string | null;

  gameId?: string;
  teamA: string;
  teamB: string;
  summaryPath?: string;
  priorsPath?: string;

  // from summary.json
  pA?: number; // P(A wins)
  medMargin?: number; // A − B
  medTotal?: number; // A + B
  p25Margin?: number;
  p75Margin?: number;
  p25Total?: number;
  p75Total?: number;
  nsims?: number;
  updated?: string;
  finalA?: number;
  finalB?: number;

  // from priors.json
  priors?: Priors;

  compactPath?: string;

  startUtc?: string;
  odds?: OddsBlock | null;
  fair?: FairBlock | null;

  marketEval?: MarketEval | null;

  whySummary?: string;

  A_espn_id?: string | null;
  B_espn_id?: string | null;

};

type Card = GameRow & {
  projA?: number;
  projB?: number;
  mlTeam?: "A" | "B";
  mlProb?: number;
  mlFair?: string;

  tipEtLabel?: string;
  tipUnix?: number;

  // show pills (from sims)
  pickSpread?: { teamSide: "A" | "B"; teamName: string; line: number; fairAm?: number; prob?: number };
  pickTotal?: { side: "Over" | "Under"; line: number; fairAm?: number; prob?: number };
  pickML?: { teamSide: "A" | "B"; teamName: string; fairAm?: number; prob?: number };

  // EVs used for sorting
  evSpread?: number;
  evTotal?: number;
  evML?: number;

  whySummary?: string;

  // live info (for scores + pace)
  liveState?: "pre" | "in" | "post" | "final" | "unknown";
  liveStatusText?: string;
  liveScoreA?: number;
  liveScoreB?: number;
  liveElapsed?: number;
  liveTotalPace?: number;

  liveTotalLine?: number;
  liveSpreadLine?: number;
  liveSpreadFavName?: string;
  liveOddsBook?: string | null;
};

/* ---------------- helpers ---------------- */

function getVenueBroadcast(card: Card, livePayload: any): {
  broadcast?: string;
  venue?: string;
} {
  const out: { broadcast?: string; venue?: string } = {};
  const events = livePayload?.events ?? livePayload?.items ?? [];
  if (!Array.isArray(events) || !events.length) return out;

  const AID = card.A_espn_id ? String(card.A_espn_id) : undefined;
  const BID = card.B_espn_id ? String(card.B_espn_id) : undefined;
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const bestName = (o: any) =>
    o?.team?.displayName ?? o?.team?.shortDisplayName ?? o?.team?.name ?? o?.displayName ?? o?.abbreviation ?? "";

  let ev: any =
    events.find((e: any) => {
      const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
      const ids = comp.map((c: any) => String(c?.team?.id ?? ""));
      const hasA = AID ? ids.includes(AID) : true;
      const hasB = BID ? ids.includes(BID) : true;
      return hasA && hasB;
    }) ??
    events.find((e: any) => {
      const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
      const names = comp.flatMap((c: any) => [norm(bestName(c)), norm(c?.team?.abbreviation)]);
      const A = norm(card.teamA), B = norm(card.teamB);
      const joined = names.join("|");
      return joined.includes(A) && joined.includes(B);
    });

  if (!ev) return out;

  const comp0 = ev?.competitions?.[0] ?? ev;

  const bc =
    comp0?.broadcasts?.[0]?.names?.[0] ??
    comp0?.geoBroadcasts?.[0]?.media?.shortName ??
    ev?.broadcast;
  if (typeof bc === "string" && bc.trim()) out.broadcast = bc.trim();

  const venueName = comp0?.venue?.fullName;
  const neutral = comp0?.neutralSite ? " (Neutral)" : "";
  if (typeof venueName === "string" && venueName.trim()) out.venue = venueName.trim();

  return out;
}

// Get per-team rank + record for this card from livePayload
function getLiveRankRecord(card: Card, livePayload: any): {
  A: { rank?: number; record?: string };
  B: { rank?: number; record?: string };
} {
  const result = { A: {} as any, B: {} as any };
  const events = livePayload?.events ?? livePayload?.items ?? [];
  if (!Array.isArray(events) || !events.length) return result;

  const AID = card.A_espn_id ? String(card.A_espn_id) : undefined;
  const BID = card.B_espn_id ? String(card.B_espn_id) : undefined;

  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const bestName = (o: any) =>
    o?.team?.displayName ?? o?.team?.shortDisplayName ?? o?.team?.name ?? o?.displayName ?? o?.abbreviation ?? "";

  // locate event (IDs first, then names)
  let ev: any =
    events.find((e: any) => {
      const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
      const ids = comp.map((c: any) => String(c?.team?.id ?? ""));
      const hasA = AID ? ids.includes(AID) : true;
      const hasB = BID ? ids.includes(BID) : true;
      return hasA && hasB;
    }) ??
    events.find((e: any) => {
      const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
      const names = comp.flatMap((c: any) => [norm(bestName(c)), norm(c?.team?.abbreviation)]);
      const A = norm(card.teamA), B = norm(card.teamB);
      const joined = names.join("|");
      return joined.includes(A) && joined.includes(B);
    });

  const comp = ev?.competitions?.[0]?.competitors ?? ev?.competitors ?? [];
  if (!Array.isArray(comp) || comp.length < 2) return result;

  // Align to (teamA, teamB)
  let iA = 0, iB = 1;
  const name0 = norm(bestName(comp[0]));
  const name1 = norm(bestName(comp[1]));
  if (name0.includes(norm(card.teamB)) || name1.includes(norm(card.teamA))) { iA = 1; iB = 0; }

  function pickRecord(recs: any[] = []) {
    const hit =
      recs.find(r => (r?.name ?? "").toLowerCase() === "overall" || (r?.type ?? "").toLowerCase() === "total") ??
      recs[0];
    return hit?.summary as string | undefined;
  }

  const cA = comp[iA], cB = comp[iB];

  const rA = Number(cA?.curatedRank?.current);
  const rB = Number(cB?.curatedRank?.current);

  result.A.rank = Number.isFinite(rA) && rA > 0 && rA < 99 ? rA : undefined;
  result.B.rank = Number.isFinite(rB) && rB > 0 && rB < 99 ? rB : undefined;

  result.A.record = pickRecord(cA?.records);
  result.B.record = pickRecord(cB?.records);

  return result;
}

// --- Drop-in live spread estimator (A − B final margin) ---
type LiveSpreadInput = {
  scoreA: number;           // current
  scoreB: number;           // current
  elapsedSec: number;       // 0..2400
  // If you already computed a projected total, pass it; otherwise we’ll infer a multiplier.
  projectedTotal?: number;
  priorTotal?: number;      // for inferring projectedTotal when missing
  p25Total?: number;
  p75Total?: number;

  // Pregame/prior margin from sims (A − B), plus optional IQR band for clamps
  priorMargin?: number;     // e.g., medMargin
  p25Margin?: number;
  p75Margin?: number;
};

export function projectLiveSpread({
  scoreA, scoreB, elapsedSec,
  projectedTotal, priorTotal, p25Total, p75Total,
  priorMargin, p25Margin, p75Margin,
}: LiveSpreadInput): number {
  const REG = 40 * 60;
  const t = Math.max(0, Math.min(REG, elapsedSec));
  const liveA = scoreA || 0, liveB = scoreB || 0;
  const liveTotalNow = Math.max(1, liveA + liveB); // avoid div/0
  const liveMarginNow = liveA - liveB;

  // 1) Get a sensible total multiplier to scale current margin to game-end.
  //    Prefer caller's projected total; otherwise infer using the same total projector.
  const projTotal =
    Number.isFinite(projectedTotal as number)
      ? (projectedTotal as number)
      : projectLiveTotal({
          scoreA, scoreB, elapsedSec: t,
          priorTotal, p25Total, p75Total,
        });
  const multRaw = projTotal / liveTotalNow;
  // Keep multiplier in a sane band to avoid explosive early-game swings.
  const mult = Math.max(0.6, Math.min(2.2, multRaw));

  // 2) Live-rate margin projection
  const liveProj = liveMarginNow * mult;

  // 3) Time-based blend with prior margin (same ramp as totals)
  const minStart = 4 * 60;
  const frac = t / REG;
  const baseW = Math.max(0, frac - (minStart / REG)) / (1 - (minStart / REG));
  const liveW = Math.min(0.82, 0.15 + 0.95 * baseW);

  const prior = Number.isFinite(priorMargin as number) ? (priorMargin as number) : liveProj;
  let proj = (1 - liveW) * prior + liveW * liveProj;

  // 4) End-game nudges (very small, just to mimic ATS behavior)
  const remaining = REG - t;
  const leadSign = Math.sign(liveMarginNow || prior);
  if (remaining <= 180) {
    const absNow = Math.abs(liveMarginNow);
    if (absNow <= 3) {
      // ultra-tight late: late possessions & intentional fouls add volatility -> tiny pull toward 0
      proj -= 0.4 * leadSign;
    } else if (absNow >= 12) {
      // comfy lead late: FT parade/empty possessions can stretch a bit
      proj += 0.6 * leadSign;
    }
  } else if (remaining <= 360) {
    const absNow = Math.abs(liveMarginNow);
    if (absNow >= 14) proj += 0.3 * leadSign;
    if (absNow <= 2)  proj -= 0.2 * leadSign;
  }

  // 5) Soft clamp to prior IQR (loosens as time passes)
  const lo = Number.isFinite(p25Margin as number) ? (p25Margin as number) : (prior - 6);
  const hi = Number.isFinite(p75Margin as number) ? (p75Margin as number) : (prior + 6);
  const slack = 5 * frac;
  proj = Math.max(lo - slack, Math.min(hi + slack, proj));

  // Margins are effectively integers; keep one decimal for display smoothness
  return Math.round(proj * 10) / 10;
}


// --- Drop-in live total estimator (college hoops, 40:00 reg) ---
type LiveTotalInput = {
  scoreA: number;      // current
  scoreB: number;      // current
  elapsedSec: number;  // seconds played in regulation (0..2400)
  priorTotal?: number; // e.g., medTotal from sims
  p25Total?: number;   // optional, from sims
  p75Total?: number;   // optional, from sims
};

export function projectLiveTotal({
  scoreA, scoreB, elapsedSec,
  priorTotal, p25Total, p75Total,
}: LiveTotalInput): number {
  const REG = 40 * 60;                                   // 2400s regulation
  const t = Math.max(0, Math.min(REG, elapsedSec));
  const liveScore = (scoreA || 0) + (scoreB || 0);

  // 1) Naive pace extrapolation (guard rails for very early game)
  const minStart = 4 * 60;                                // ignore first 4:00 noise
  const livePace = t > 15 ? (liveScore * (REG / t)) : (priorTotal ?? liveScore * (REG / Math.max(t, 1)));

  // 2) Time-based blend weight: ramps up as game progresses, but caps < 1
  //    -> slow ramp pre-4:00, ~50/50 by halftime, ~80% live by 36:00
  const frac = t / REG;
  const baseW = Math.max(0, frac - (minStart / REG)) / (1 - (minStart / REG)); // 0 until 4:00
  const blendW = Math.min(0.82, 0.15 + 0.95 * baseW);     // cap live weight ~82%

  // 3) Prior (pregame sims) fallback
  const prior = Number.isFinite(priorTotal as number) ? (priorTotal as number) : livePace;

  // 4) Late-game adjustment for fouls/garbage time
  const remaining = REG - t;
  const margin = Math.abs((scoreA || 0) - (scoreB || 0));
  let endgameAdj = 0;
  if (remaining <= 3 * 60) {
    // Close game → more fouls + FT → small upward bias
    if (margin <= 6) endgameAdj += 1.5;           // ~1–2 pts
    // Blowout → running clock/subs → tiny downward bias
    if (margin >= 15) endgameAdj -= 1.0;
  } else if (remaining <= 6 * 60) {
    if (margin <= 6) endgameAdj += 0.7;
    if (margin >= 18) endgameAdj -= 0.7;
  }

  // 5) Simple OT tail: if very tight late, add a fraction of one OT
  //    One college OT ≈ 5:00, typical combined points ~10–12
  let otAdj = 0;
  if (remaining <= 60) {
    // crude OT probability proxy
    const tight = margin <= 3 ? 0.15 : margin <= 5 ? 0.08 : 0.03;
    otAdj = tight * 11; // 11 points expected in OT
  } else if (remaining <= 120 && margin <= 4) {
    otAdj = 0.05 * 11;
  }

  // 6) Blend + adjust
  let proj = (1 - blendW) * prior + blendW * livePace;
  proj += endgameAdj + otAdj;

  // 7) Soft clamp to interquartile band (if provided) to avoid wild swings
  const lo = p25Total ?? (prior - 8);
  const hi = p75Total ?? (prior + 8);
  // allow some leakage beyond band as game advances
  const slack = 6 * frac; // grows from 0 to ~6
  proj = Math.max(lo - slack, Math.min(hi + slack, proj));

  // 8) Round to half-points like books frequently quote
  return Math.round(proj * 2) / 2;
}

const fmtEV = (x?: number) => (x == null ? "" : ` · EV ${(x >= 0 ? "+" : "")}${x.toFixed(2)}u`);

const toNum = (x: unknown): number | undefined => {
  const n = typeof x === "string" ? Number(x) : (x as number);
  return Number.isFinite(n) ? n : undefined;
};
const clamp01 = (p?: number | null) =>
  Number.isFinite(p as number) ? Math.min(1, Math.max(0, p as number)) : undefined;
const americanToNet = (odds: number) => (odds >= 0 ? odds / 100 : 100 / Math.abs(odds));
// EV per 1u risk; default 0 on missing prob/price
const expectedValue = (p?: number | null, american?: number | null | undefined) => {
  const pp = clamp01(p);
  const aa = toNum(american as any);
  if (pp == null || aa == null) return 0;
  const net = americanToNet(aa);
  return pp * net - (1 - pp);
};

const fmtAmerican = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
const fmtPct = (p?: number) => (p == null || !Number.isFinite(p) ? "—" : `${Math.round(p * 100)}%`);

function computeAB(total?: number, margin?: number) {
  if (!Number.isFinite(total as number) || !Number.isFinite(margin as number)) return { A: undefined, B: undefined };
  const T = total as number, M = margin as number;
  const A = (T + M) / 2;
  const B = T - A;
  return { A, B };
}
function inferPriorsPath(summaryPath?: string) {
  if (!summaryPath) return undefined;
  const s = summaryPath.replace(/\/+$/, "");
  return s.replace(/\/summary\.json$/i, "/priors.json");
}
function inferCompactPath(summaryPath?: string) {
  if (!summaryPath) return undefined;
  const s = summaryPath.replace(/\/+$/, "");
  return s.replace(/\/summary\.json$/i, "/sims_compact.json");
}
function inferFinalPath(summaryPath?: string) {
  if (!summaryPath) return undefined;
  const s = summaryPath.replace(/\/+$/, "");
  return s.replace(/\/summary\.json$/i, "/final.json");
}
function toEtLabel(iso?: string | null) {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d) + " ET"
  );
}
function toEpoch(iso?: string | null) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

// --- ESPN helpers (event id + summary fetch) ---
type LiveEventItem = {
  id?: string | number;
  status?: { type?: { state?: string } } | any;
  shortName?: string;
  competitions?: any[];
  competitors?: Array<{ team?: { displayName?: string; abbreviation?: string } }>;
  // our server often returns extra fields (canon slugs etc) — we don't rely on them here
};

function yyyymmddFromUTC(iso?: string | null): string | undefined {
  if (!iso) return;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function normName(x?: string) {
  return (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Try to read an espn event id from our summary.json payload if present */
async function tryEventIdFromSummary(url?: string): Promise<string | undefined> {
  if (!url) return;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const J = await res.json();
    const cand = J?.espn_event_id ?? J?.espnId ?? J?.eventId ?? J?.espn_event ?? J?.event_id;
    if (cand != null) return String(cand);
  } catch {}
  return;
}

/**
 * Fallback: query our own live endpoint for the date and match by team names.
 * This works for both in-progress and final games on the day.
 */
async function tryEventIdFromLiveMap(teamA: string, teamB: string, startUtc?: string | null): Promise<{id?: string, state?: string}> {
  const dateStr = yyyymmddFromUTC(startUtc);
  if (!dateStr) return {};
  try {
    const url = `/api/live?sport=cbb&date=${dateStr}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    const live = await res.json();
    const items: LiveEventItem[] =
      (Array.isArray(live) ? live : (live?.events ?? live?.games ?? live?.items ?? [])) as any[];

    const A = normName(teamA), B = normName(teamB);
    for (const it of items) {
      // build candidate set of names
      const names: string[] = [];
      const comp = (it?.competitions?.[0]?.competitors ?? it?.competitors ?? []) as any[];
      for (const c of comp) {
        const dn = c?.team?.displayName ?? c?.team?.name ?? c?.displayName ?? c?.name;
        const ab = c?.team?.abbreviation ?? c?.abbreviation;
        if (dn) names.push(normName(dn));
        if (ab) names.push(normName(ab));
      }
      const joined = names.join(" | ");
      if (joined && joined.includes(A) && joined.includes(B)) {
        const id = it?.id != null ? String(it.id) :
                   it?.competitions?.[0]?.id != null ? String(it.competitions[0].id) : undefined;
        const state = it?.status?.type?.state ?? it?.status?.state ?? undefined;
        return { id, state };
      }
    }
  } catch {}
  return {};
}

type HistBin = { bin: string; start: number; end: number; count: number };
function computeHistogram(values: number[], bins?: number): HistBin[] {
  if (!values?.length) return [];
  const v = values.slice().sort((a, b) => a - b);
  const min = v[0], max = v[v.length - 1];
  if (min === max) {
    const start = min - 0.5, end = min + 0.5;
    return [{ bin: `${start.toFixed(1)}–${end.toFixed(1)}`, start, end, count: v.length }];
  }
  const B = Math.max(1, bins ?? 41);
  const width = (max - min) / B || 1;
  const edges: number[] = [];
  for (let i = 0; i <= B; i++) edges.push(min + i * width);
  const counts = new Array(B).fill(0);
  for (const x of v) {
    let idx = Math.floor((x - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= B) idx = B - 1;
    counts[idx]++;
  }
  return counts.map((c, i) => {
    const start = edges[i], end = edges[i + 1];
    return { bin: `${start.toFixed(1)}–${end.toFixed(1)}`, start, end, count: c };
  });
}
function quantiles(values: number[]) {
  if (!values?.length) return { q1: undefined, med: undefined, q3: undefined } as any;
  const v = values.slice().sort((a, b) => a - b);
  const at = (p: number) => {
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return v[lo];
    const w = idx - lo;
    return v[lo] * (1 - w) + v[hi] * w;
  };
  return { q1: at(0.25), med: at(0.5), q3: at(0.75) };
}
function findBinLabel(hist: HistBin[], value: number | undefined) {
  if (!hist.length || !Number.isFinite(value as number)) return undefined;
  for (const h of hist) {
    if ((value as number) >= h.start && (value as number) <= h.end + 1e-9) return h.bin;
  }
  return undefined;
}

/* =========================================================
 *  Page
 * =======================================================*/
export default function CBBSims() {
  const [date, setDate] = useState(() => toYMD(new Date()));
  const [debug] = useState(false);
  const [logoMode, setLogoMode] = useState<"primary" | "alt">("primary");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<GameRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  type SortKey = "time" | "ev_spread" | "ev_total" | "ev_ml";
  const [sortKey, setSortKey] = useState<SortKey>("time");

  // ----- LIVE SCOREBOARD (CBB) -----
  // ESPN expects YYYYMMDD but our helper on the server strips hyphens,
  // so both "2025-11-23" and "20251123" are fine.
  const livePayload = useEspnScoreboard(date, { sport: "cbb", groups: "50", limit: 357, pollMs: 20000 });

  useEffect(() => {
  console.log("CBB livePayload", livePayload);
  }, [livePayload]);

  const liveGames: LiveGame[] = useMemo(
    () => (livePayload ? mapEspnToLiveGamesCbb(livePayload) : []),
    [livePayload]
  );

  // const liveMap = useMemo(() => {
  //   const m = new Map<string, LiveGame>();
  //   for (const g of liveGames) {
  //     const byIds = pairIdsKey(g.awayId, g.homeId);
  //     if (byIds) m.set(byIds, g);
  //     // Fallback (legacy name key) – only used if no IDs on this event
  //     else m.set(pairKey(g.awayTeam, g.homeTeam), g);
  //   }
  //   return m;
  // }, [liveGames]);

  const livePairMap = useMemo(() => {
    const m = new Map<string, LiveGame>();
    for (const g of liveGames) {
      const k = pairIdsKey(g.awayId, g.homeId);
      if (k) m.set(k, g);
    }
    return m;
  }, [liveGames]);

  const liveIdMap = useMemo(() => {
    // single-id -> list of events (tournaments can create dupes)
    const m = new Map<string, LiveGame[]>();
    for (const g of liveGames) {
      for (const id of [g.awayId, g.homeId]) {
        if (!id) continue;
        const key = String(id);
        const arr = m.get(key);
        if (arr) arr.push(g);
        else m.set(key, [g]);
      }
    }
    return m;
  }, [liveGames]);

  // Optional: keep legacy name key as a last resort
  const liveNameMap = useMemo(() => {
    const m = new Map<string, LiveGame>();
    for (const g of liveGames) m.set(pairKey(g.awayTeam, g.homeTeam), g);
    return m;
  }, [liveGames]);



  const indexUrls = useMemo(() => {
    const base = DATASET_ROOT.replace(/\/+$/, "");
    const pref = SEASON_PREFIX.replace(/^\/+|\/+$/g, "");
    const d = date;
    return [
      `${base}/${pref}/days/${d}/index.json`,
      `${base}/${pref}/days/${d}/games/index.json`,
    ];
  }, [date]);

  // Load index
  useEffect(() => {
    let aborted = false;
    async function loadIndex() {
      setLoading(true);
      setError(null);
      setRows([]);
      for (const url of indexUrls) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const json = await res.json();

          const tidy = (Array.isArray(json) ? json : (json?.games ?? []))
            .map((r: any) => {
              const teamA =
                pickStrLoose(r, ["A_kp_name", "A_name", "kp_name_A", "A_name_kp", "teamA", "teama", "team_a", "A", "home", "A_slug", "a_slug"]) ?? "";
              const teamB =
                pickStrLoose(r, ["B_kp_name", "B_name", "kp_name_B", "B_name_kp", "teamB", "teamb", "team_b", "B", "away", "B_slug", "b_slug"]) ?? "";
              if (!teamA || !teamB) return null;

              const aEspnId =
                pickStrLoose(r, ["A_espn_id", "A_espn?.espn_id", "A_espn_id_str"]) ??
                (r?.A_espn?.espn_id != null ? String(r.A_espn.espn_id) : undefined) ??
                null;

              const bEspnId =
                pickStrLoose(r, ["B_espn_id", "B_espn?.espn_id", "B_espn_id_str"]) ??
                (r?.B_espn?.espn_id != null ? String(r.B_espn.espn_id) : undefined) ??
                null;

              const summaryPath = pickStrLoose(r, ["summary_path", "summary", "summaryurl"]);
              const priorsPath = pickStrLoose(r, ["priors_path"]) ?? inferPriorsPath(summaryPath);
              const compactPath = pickStrLoose(r, ["compact_path"]);
              const gameId = pickStrLoose(r, ["game_id", "id"]);

              const Aname = pickStrLoose(r, ["A_kp_name", "A_name", "kp_name_A", "A_name_kp"]) ?? teamA;
              const Bname = pickStrLoose(r, ["B_kp_name", "B_name", "kp_name_B", "B_name_kp"]) ?? teamB;
              const aLogoPrimary = pickStrLoose(r, ["A_logo_primary", "a_logo_primary"]) ?? null;
              const aLogoAlt = pickStrLoose(r, ["A_logo_alt", "a_logo_alt"]) ?? null;
              const bLogoPrimary = pickStrLoose(r, ["B_logo_primary", "b_logo_primary"]) ?? null;
              const bLogoAlt = pickStrLoose(r, ["B_logo_alt", "b_logo_alt"]) ?? null;

              return {
                teamA: Aname,
                teamB: Bname,
                summaryPath,
                priorsPath,
                gameId,
                aLogoPrimary,
                aLogoAlt,
                bLogoPrimary,
                bLogoAlt,
                compactPath,
                A_espn_id: aEspnId,     // <-- NEW
                B_espn_id: bEspnId,     // <-- NEW
              } as GameRow;
            })
            .filter(Boolean) as GameRow[];

          setRows(tidy);
          setLoading(false);
          return;
        } catch (e) {
          if (debug) console.warn("Index fetch failed:", url, e);
        }
      }
      if (!aborted) {
        setLoading(false);
        setError("No scores yet for this date, try another date (Season starts 11/3)");
      }
    }
    loadIndex();
    return () => {
      aborted = true;
    };
  }, [indexUrls, debug]);

  // Hydrate each row with summary + priors
  useEffect(() => {
    let aborted = false;
    async function hydrate() {
      if (!rows.length) return;
      const base = DATASET_ROOT.replace(/\/+$/, "");

      const enriched = await Promise.all(
        rows.map(async (r) => {
          let out: GameRow = { ...r };

          // summary
          if (r.summaryPath) {
            try {
              const sUrl = `${base}/${r.summaryPath.replace(/^\/+/, "")}`;
              const res = await fetch(sUrl, { cache: "no-store" });
              if (res.ok) {
                const s = await res.json();

                const whySummary =
                  (typeof s?.why_summary === "string" && s.why_summary.trim()) ||
                  (typeof s?.why === "string" && s.why.trim()) ||
                  null;

                const startUtc = pickStrLoose(s, ["start_utc", "startUtc"]);
                const odds: OddsBlock | null = s?.odds ?? null;
                const fair: FairBlock | null = s?.fair ?? null;
                const marketEval: MarketEval | null = s?.market_eval ?? null;

                out = {
                  ...out,
                  pA: pickNumLoose(s, ["A_win_prob", "win_prob_A", "pA", "p_a", "P_A", "probA", "prob_a", "pawin"]),
                  medMargin: pickNumLoose(s, ["median_margin", "med_margin", "medMargin", "p50_margin", "margin_p50"]),
                  medTotal: pickNumLoose(s, ["median_total", "med_total", "medTotal", "p50_total", "total_p50"]),
                  p25Margin: pickNumLoose(s, ["p25_margin", "margin_p25"]),
                  p75Margin: pickNumLoose(s, ["p75_margin", "margin_p75"]),
                  p25Total: pickNumLoose(s, ["p25_total", "total_p25"]),
                  p75Total: pickNumLoose(s, ["p75_total", "total_p75"]),
                  nsims: pickNumLoose(s, ["nsims", "n_sims", "n"]),
                  updated: pickStrLoose(s, ["updated", "timestamp", "ts"]),
                  finalA: pickNumLoose(s, ["finalA", "final_a", "final_home"]),
                  finalB: pickNumLoose(s, ["finalB", "final_b", "final_away"]),
                  startUtc,
                  odds,
                  fair,
                  marketEval,
                  whySummary,
                };
              }
            } catch {}
          }

          // finals (optional)
          try {
            const finPath = r.summaryPath ? inferFinalPath(r.summaryPath) : undefined;
            if (finPath) {
              const fUrl = `${base}/${finPath.replace(/^\/+/, "")}`;
              const fres = await fetch(fUrl, { cache: "no-store" });
              if (fres.ok) {
                const F = await fres.json();

                const isFinal = F?.status === 1 || F?.status === "1" || F?.state === "final";
                if (isFinal) {
                  let A_final: number | undefined, B_final: number | undefined;

                  const mh = (F?.odds?.matched_home_side ?? F?.matched_home_side ?? "").toString().toUpperCase();
                  const homeScore = Number(
                    F?.scores?.home ??
                      F?.game?.home?.score ??
                      F?.home_score ??
                      F?.final_home
                  );
                  const awayScore = Number(
                    F?.scores?.away ??
                      F?.game?.away?.score ??
                      F?.away_score ??
                      F?.final_away
                  );
                  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
                    if (mh === "A") {
                      A_final = homeScore; B_final = awayScore;
                    } else if (mh === "B") {
                      A_final = awayScore; B_final = homeScore;
                    } else {
                      const Aname = r.teamA?.toLowerCase?.() ?? "";
                      const homeName = String(
                        F?.matched_with?.home ??
                          F?.home_team ??
                          (typeof F?.game?.home === "string" ? F.game.home : F?.game?.home?.name) ??
                          ""
                      ).toLowerCase();
                      if (homeName && Aname && homeName.includes(Aname)) {
                        A_final = homeScore; B_final = awayScore;
                      } else {
                        A_final = awayScore; B_final = homeScore;
                      }
                    }
                  }
                  if (Number.isFinite(A_final as number) && Number.isFinite(B_final as number)) {
                    out = { ...out, finalA: A_final as number, finalB: B_final as number };
                  }
                }
              }
            }
          } catch {}

          // priors
          if (r.priorsPath) {
            try {
              const pUrl = `${base}/${r.priorsPath.replace(/^\/+/, "")}`;
              const res = await fetch(pUrl, { cache: "no-store" });
              if (res.ok) {
                const pri: Priors = await res.json();
                out = { ...out, priors: pri };
              }
            } catch {}
          }

          return out;
        })
      );

      if (!aborted) setRows(enriched);
    }
    hydrate();
    return () => {
      aborted = true;
    };
  }, [rows.length]);

  // ---- records + profit helpers (top-level, reused in GameCard)
  type PickKind = "spread" | "total" | "ml";
  function gradeOutcome(card: any, kind: PickKind): "W" | "L" | "P" | null {
    const aF = card.finalA, bF = card.finalB;
    if (!Number.isFinite(aF as number) || !Number.isFinite(bF as number)) return null;

    if (kind === "ml" && card.pickML) {
      const pickA = card.pickML.teamSide === "A";
      const aWon = (aF as number) > (bF as number);
      const bWon = (bF as number) > (aF as number);
      if (!aWon && !bWon) return "P";
      return pickA ? (aWon ? "W" : "L") : (bWon ? "W" : "L");
    }

    if (kind === "spread" && card.pickSpread) {
      const line = Number(card.pickSpread.line);
      if (!Number.isFinite(line)) return null;
      if (card.pickSpread.teamSide === "A") {
        const adjA = (aF as number) + line;
        if (adjA === (bF as number)) return "P";
        return adjA > (bF as number) ? "W" : "L";
      } else {
        const adjB = (bF as number) + line;
        if (adjB === (aF as number)) return "P";
        return adjB > (aF as number) ? "W" : "L";
      }
    }

    if (kind === "total" && card.pickTotal) {
      const t = (aF as number) + (bF as number);
      const line = Number(card.pickTotal.line);
      if (!Number.isFinite(line)) return null;
      if (t === line) return "P";
      return card.pickTotal.side === "Over" ? (t > line ? "W" : "L") : (t < line ? "W" : "L");
    }
    return null;
  }
  function mlProfit(american: number | null | undefined, won: boolean): number {
    if (!Number.isFinite(american as number)) return 0;
    const A = american as number;
    if (A < 0) { // favorite: risk |A|/100 to win 1u
      const risk = Math.abs(A) / 100;
      return won ? +1 : -risk;
    } else {     // dog: risk 1u to win A/100
      const payout = A / 100;
      return won ? +payout : -1;
    }
  }

  const cards: Card[] = useMemo(() => {
    const mapped = rows.map((r) => {
      const { A, B } = computeAB(r.medTotal, r.medMargin);
      const projA = Number.isFinite(A as number) ? Math.round(A as number) : undefined;
      const projB = Number.isFinite(B as number) ? Math.round(B as number) : undefined;

      // baseline ML pick from pA (only for displays, EV uses market_eval probs)
      let mlTeam: "A" | "B" | undefined;
      let mlProb: number | undefined;
      if (Number.isFinite(r.pA as number)) {
        const pA = r.pA as number;
        mlTeam = pA >= 0.5 ? "A" : "B";
        mlProb = mlTeam === "A" ? pA : 1 - pA;
      }
      const mlFair = Number.isFinite(mlProb as number) ? americanOdds(mlProb as number) : "—";

      const tipEtLabel = toEtLabel(r.startUtc ?? r.odds?.start_utc ?? null);
      const tipUnix = toEpoch(r.startUtc ?? r.odds?.start_utc ?? null);

      // picks from market_eval (which we’ll also use to select EV side)
      let pickSpread: Card["pickSpread"] | undefined;
      let pickTotal: Card["pickTotal"] | undefined;
      let pickML: Card["pickML"] | undefined;

      const me = (r as any).market_eval ?? (r as any).marketEval;

      if (me) {
        // ML pick
        const pAml = me?.moneyline?.A?.prob;
        const pBml = me?.moneyline?.B?.prob;
        if (Number.isFinite(pAml as number) || Number.isFinite(pBml as number)) {
          const aProb = (pAml as number) ?? 0;
          const bProb = (pBml as number) ?? 0;
          if (aProb >= bProb) {
            pickML = { teamSide: "A", teamName: r.teamA, fairAm: me?.moneyline?.A?.fair_american, prob: aProb };
          } else {
            pickML = { teamSide: "B", teamName: r.teamB, fairAm: me?.moneyline?.B?.fair_american, prob: bProb };
          }
        }

        // Spread pick (higher prob_cover)
        const aCover = me?.spread?.A?.prob_cover;
        const bCover = me?.spread?.B?.prob_cover;
        const aLine0 = me?.spread?.A?.line;
        const bLine0 = me?.spread?.B?.line;
        if ((Number.isFinite(aCover as number) && Number.isFinite(aLine0 as number)) ||
            (Number.isFinite(bCover as number) && Number.isFinite(bLine0 as number))) {
          const aC = (aCover as number) ?? 0;
          const bC = (bCover as number) ?? 0;
          if (aC >= bC && Number.isFinite(aLine0 as number)) {
            pickSpread = { teamSide: "A", teamName: r.teamA, line: aLine0 as number, fairAm: me?.spread?.A?.fair_american, prob: aC };
          } else if (Number.isFinite(bLine0 as number)) {
            pickSpread = { teamSide: "B", teamName: r.teamB, line: bLine0 as number, fairAm: me?.spread?.B?.fair_american, prob: bC };
          }
        }

        // Total pick
        const overP = me?.total?.over?.prob;
        const underP = me?.total?.under?.prob;
        const tLine = me?.total?.line;
        if (Number.isFinite(tLine as number) && (Number.isFinite(overP as number) || Number.isFinite(underP as number))) {
          const o = (overP as number) ?? 0;
          const u = (underP as number) ?? 0;
          if (o >= u) {
            pickTotal = { side: "Over", line: tLine as number, fairAm: me?.total?.over?.fair_american, prob: o };
          } else {
            pickTotal = { side: "Under", line: tLine as number, fairAm: me?.total?.under?.fair_american, prob: u };
          }
        }
      }

      // offered prices (A/B alignment uses matched_home_side)
      const od = r.odds ?? {};
      const matched = (od.matched_home_side || "A").toString().toUpperCase() as "A" | "B";
      const homeIsA = matched === "A";

      const mlA = toNum(homeIsA ? od.home_ml : od.away_ml);
      const mlB = toNum(homeIsA ? od.away_ml : od.home_ml);

      const spA = toNum(homeIsA ? od.home_spread_price : od.away_spread_price);
      const spB = toNum(homeIsA ? od.away_spread_price : od.home_spread_price);

      const bookOver = toNum(od.over_price);
      const bookUnder = toNum(od.under_price);

      // probs from market_eval
      const pMlA = clamp01(me?.moneyline?.A?.prob);
      const pMlB = clamp01(me?.moneyline?.B?.prob);
      const pSpA = clamp01(me?.spread?.A?.prob_cover);
      const pSpB = clamp01(me?.spread?.B?.prob_cover);
      const pOver = clamp01(me?.total?.over?.prob);
      const pUnder = clamp01(me?.total?.under?.prob);

      // side-specific EVs (default 0 when missing)
      const evMlA = expectedValue(pMlA, mlA);
      const evMlB = expectedValue(pMlB, mlB);
      const evSpA = expectedValue(pSpA, spA);
      const evSpB = expectedValue(pSpB, spB);
      const evOver = expectedValue(pOver, bookOver);
      const evUnder = expectedValue(pUnder, bookUnder);

      // final EVs for the selected side (default 0)
      const evML = pickML ? (pickML.teamSide === "A" ? evMlA : evMlB) : 0;
      const evSpread = pickSpread ? (pickSpread.teamSide === "A" ? evSpA : evSpB) : 0;
      const evTotal = pickTotal ? (pickTotal.side === "Over" ? evOver : evUnder) : 0;

      // ------- LIVE + PACE -------
      let liveState: Card["liveState"];
      let liveStatusText: string | undefined;
      let liveScoreA: number | undefined;
      let liveScoreB: number | undefined;
      let liveElapsed: number | undefined;
      let liveTotalPace: number | undefined;

      let liveTotalLine: number | undefined;
      let liveSpreadLine: number | undefined;
      let liveSpreadFavName: string | undefined;
      let liveOddsBook: string | null | undefined;


      // const idKey = pairIdsKey(r.A_espn_id ?? undefined, r.B_espn_id ?? undefined);
      // const lg = (idKey && liveMap.get(idKey)) || liveMap.get(pairKey(r.teamA, r.teamB));

      const AID = r.A_espn_id ? String(r.A_espn_id) : undefined;
      const BID = r.B_espn_id ? String(r.B_espn_id) : undefined;

      // 1) exact pair match
      let lg: LiveGame | undefined;
      const pairKeyIds = pairIdsKey(AID, BID);
      if (pairKeyIds) lg = livePairMap.get(pairKeyIds);

      // 2) single-ID match (use closest tip if multiple)
      if (!lg && (AID || BID)) {
        const candidates: LiveGame[] = [];
        if (AID && liveIdMap.get(AID)) candidates.push(...(liveIdMap.get(AID) as LiveGame[]));
        if (BID && liveIdMap.get(BID)) candidates.push(...(liveIdMap.get(BID) as LiveGame[]));

        if (candidates.length) {
          const targetTs = Date.parse(r.startUtc ?? r.odds?.start_utc ?? "");
          if (Number.isFinite(targetTs)) {
            candidates.sort((a, b) =>
              Math.abs(Date.parse(((a as any)?.date) ?? "") - targetTs) -
              Math.abs(Date.parse(((b as any)?.date) ?? "") - targetTs)
            );
          }
          lg = candidates[0];
        }
      }


      // 3) final fallback to name-key
      if (!lg) lg = liveNameMap.get(pairKey(r.teamA, r.teamB));

      // DEBUG (while you test one-off cases)
      if (r.teamA.toLowerCase().includes("army") || r.teamB.toLowerCase().includes("fdu")) {
        console.log("JOIN", r.teamA, AID, r.teamB, BID, "=>", !!lg, lg?.awayId, lg?.homeId, lg?.awayScore, lg?.homeScore);
      }


      // const lg = liveMap.get(pairKey(r.teamA, r.teamB));
      console.log("JOIN", r.teamA,r.A_espn_id, r.teamB,r.B_espn_id, "=>", !!lg, lg?.awayScore, lg?.homeScore);

      if (lg) {
        liveState = lg.state;
        liveStatusText = lg.statusText;

        // Orient scores to A/B even if ESPN has them home/away
        // const aMatchesAway = cleanTeamName(r.teamA) === cleanTeamName(lg.awayTeam);
        // const aScore = aMatchesAway ? lg.awayScore : lg.homeScore;
        // const bScore = aMatchesAway ? lg.homeScore : lg.awayScore;

        let aMatchesAway: boolean | undefined;

        // Prefer ID orientation when we have IDs on both sides
        if (r.A_espn_id && r.B_espn_id && lg.awayId && lg.homeId) {
          const A = String(r.A_espn_id), B = String(r.B_espn_id);
          aMatchesAway = (A === lg.awayId && B === lg.homeId)
                      || (A === lg.awayId && !B)          // partial safety
                      || (!A && B === lg.homeId);
        }

        // Fallback to name compare if we couldn't decide by ID
        if (aMatchesAway == null) {
          aMatchesAway = cleanTeamName(r.teamA) === cleanTeamName(lg.awayTeam);
        }

        const aScore = aMatchesAway ? lg.awayScore : lg.homeScore;
        const bScore = aMatchesAway ? lg.homeScore : lg.awayScore;


        if (Number.isFinite(aScore as number)) liveScoreA = aScore as number;
        if (Number.isFinite(bScore as number)) liveScoreB = bScore as number;

        const elapsed = computeElapsedSecondsCbb(lg);
        if (
          typeof elapsed === "number" &&
          Number.isFinite(aScore as number) &&
          Number.isFinite(bScore as number)
        ) {
          liveElapsed = elapsed;

          // 🔁 NEW: blended live total forecast (replaces naive extrapolation)
          liveTotalPace = projectLiveTotal({
            scoreA: aScore as number,
            scoreB: bScore as number,
            elapsedSec: elapsed,
            priorTotal: r.medTotal,     // from sims summary
            p25Total:  r.p25Total,      // optional guard rails
            p75Total:  r.p75Total,
          });
        }


        // NEW: copy over live lines from ESPN
        liveTotalLine = lg.liveTotal;
        liveSpreadLine = lg.liveSpread;
        liveSpreadFavName = lg.liveFavTeam;
        liveOddsBook = lg.liveBook ?? r.odds?.book ?? null;

      }

      return {
        ...r,
        projA, projB, mlTeam, mlProb, mlFair,
        tipEtLabel,
        tipUnix,
        pickSpread,
        pickTotal,
        pickML,
        evSpread,
        evTotal,
        evML,

        liveState,
        liveStatusText,
        liveScoreA,
        liveScoreB,
        liveElapsed,
        liveTotalPace,

        liveTotalLine,
        liveSpreadLine,
        liveSpreadFavName,
        liveOddsBook,
      } as Card;
    });

    // sorting
    const getStartTs = (c: Card) => c.tipUnix ?? Number.POSITIVE_INFINITY;
    const valueForSort = (c: Card) => {
      switch (sortKey) {
        case "ev_ml":     return c.evML ?? 0;
        case "ev_spread": return c.evSpread ?? 0;
        case "ev_total":  return c.evTotal ?? 0;
        default:          return 0;
      }
    };

    const stateRank = (c: Card) => {
      switch (c.liveState) {
        case "in":
          return 0;
        case "pre":
          return 1;
        case "post":
          return 2;
        case "final":
          return 3;
        default:
          return 4;
      }
    };

    return mapped.sort((a, b) => {

      const ra = stateRank(a);
      const rb = stateRank(b);
      if (ra !== rb) return ra-rb;

      switch (sortKey) {
        case "ev_spread":
        case "ev_total":
        case "ev_ml": {
          const va = valueForSort(a);
          const vb = valueForSort(b);
          if (vb !== va) return vb - va; // desc EV
          const ta = getStartTs(a), tb = getStartTs(b);
          if (ta !== tb) return ta - tb;
          return a.teamA.localeCompare(b.teamA);
        }
        case "time":
        default: {
          const ta = getStartTs(a), tb = getStartTs(b);
          if (ta !== tb) return ta - tb;
          return a.teamA.localeCompare(b.teamA);
        }
      }
    });
  }, [rows, sortKey, livePairMap, liveIdMap, liveNameMap]);

  // compute daily records + profit
  function computeRecord(kind: "spread" | "total" | "ml") {
    let w = 0, l = 0, p = 0, n = 0;
    let profit = 0;

    for (const c of cards) {
      const g = gradeOutcome(c, kind);
      if (!g) continue;
      n++;

      if (kind === "ml") {
        if (c.pickML) {
          const matched = (c.odds?.matched_home_side || "A").toString().toUpperCase() as "A" | "B";
          const homeIsA = matched === "A";
          const offeredMlA = homeIsA ? c.odds?.home_ml : c.odds?.away_ml;
          const offeredMlB = homeIsA ? c.odds?.away_ml : c.odds?.home_ml;
          const chosenOdds = c.pickML.teamSide === "A" ? offeredMlA : offeredMlB;
          if (g === "W") { w++; profit += mlProfit(chosenOdds, true); }
          else if (g === "L") { l++; profit += mlProfit(chosenOdds, false); }
          else { p++; }
        }
      } else {
        if (g === "W") { w++; profit += 1; }
        else if (g === "L") { l++; profit -= 1.1; }
        else { p++; }
      }
    }

    const pct = n ? (w + 0.5 * p) / n : 0;
    return { w, l, p, n, pct, profit };
  }

  const recSpread = computeRecord("spread");
  const recTotal  = computeRecord("total");
  const recML     = computeRecord("ml");
  const fmtPct1 = (x: number) => (x * 100).toFixed(1) + "%";
  const fmtUnits = (u: number) => `${u >= 0 ? "+" : ""}${u.toFixed(1)}u`;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 12, background: "var(--card)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          />

          <button
            onClick={() => setLogoMode((m) => (m === "primary" ? "alt" : "primary"))}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            Logo: {logoMode === "primary" ? "Primary" : "Alt"}
          </button>

          <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 4 }}>
            {loading ? "Loading…" : error ? error : `Showing ${cards.length} game${cards.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Sort:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as any)}
            style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }}
          >
            <option value="time">Tip Time</option>
            <option value="ev_spread">Spread EV</option>
            <option value="ev_total">Total EV</option>
            <option value="ev_ml">ML EV</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ opacity: 0.75 }}>Record:</span>

          <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--muted-bg, #f1f5f9)", border: "1px solid var(--border)" }}>
            <strong style={{ marginRight: 6 }}>Spread</strong>
            {recSpread.w}-{recSpread.l}-{recSpread.p}
            {recSpread.n ? ` (${fmtPct1(recSpread.pct)} · ${fmtUnits(recSpread.profit)})` : ""}
          </span>

          <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--muted-bg, #f1f5f9)", border: "1px solid var(--border)" }}>
            <strong style={{ marginRight: 6 }}>Total</strong>
            {recTotal.w}-{recTotal.l}-{recTotal.p}
            {recTotal.n ? ` (${fmtPct1(recTotal.pct)} · ${fmtUnits(recTotal.profit)})` : ""}
          </span>

          <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--muted-bg, #f1f5f9)", border: "1px solid var(--border)" }}>
            <strong style={{ marginRight: 6 }}>ML</strong>
            {recML.w}-{recML.l}-{recML.p}
            {recML.n ? ` (${fmtPct1(recML.pct)} · ${fmtUnits(recML.profit)})` : ""}
          </span> 

          <SupportButton 
          venmoHandle="Mitchell-Peavler"
          label='Donate'
          triggerVariant="venmo" />

        </div>

      </section>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "stretch",
        }}
      >
        {cards.map((c) => (
          <GameCard key={c.gameId ?? `${c.teamA}__${c.teamB}`} card={c} logoMode={logoMode} livePayload={livePayload}/>
        ))}
      </div>
    </div>
  );
}

/* =========================
 *  Card + WHY + Distributions
 * ========================= */

function GameCard({
  card,
  logoMode,
  livePayload,             // ⬅️ add
}: {
  card: Card;
  logoMode: "primary" | "alt";
  livePayload: any;        // ⬅️ add
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [showDist, setShowDist] = useState(false);
  const [loadingDist, setLoadingDist] = useState(false);
  const [errDist, setErrDist] = useState<string | null>(null);

  const [showLive, setShowLive] = useState(false);

  // consider a game "eligible" if we already have finals OR (fallback quick check via date vs now)
  const nowMs = Date.now();
  const tipMs = toEpoch(card.startUtc);
  const afterTip = Number.isFinite(tipMs) ? nowMs >= tipMs : false;
  const isFinal = Number.isFinite(card.finalA as number) && Number.isFinite(card.finalB as number);
  const liveEligible = card.liveState === "in" || card.liveState === "final";


// helper: find last play text + team logo + live win % (or fallback to pregame)
function getLastPlayInfo(
  card: Card,
  livePayload: any
): { text?: string; logo?: string; winPct?: number; winLogo?: string } {
  const events = livePayload?.events ?? livePayload?.items ?? [];
  if (!Array.isArray(events) || !events.length) return {};

  const AID = card.A_espn_id ? String(card.A_espn_id) : undefined;
  const BID = card.B_espn_id ? String(card.B_espn_id) : undefined;

  const norm = (s?: string) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const bestName = (o: any) =>
    o?.team?.displayName ??
    o?.team?.shortDisplayName ??
    o?.team?.name ??
    o?.displayName ??
    o?.abbreviation ??
    "";
  const firstLogo = (t: any) =>
    t?.logo ?? t?.logos?.[0]?.href ?? t?.logos?.[0]?.url ?? undefined;

  // locate event (IDs first, then names)
  let ev: any =
    events.find((e: any) => {
      const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
      const ids = comp.map((c: any) => String(c?.team?.id ?? ""));
      const hasA = AID ? ids.includes(AID) : true;
      const hasB = BID ? ids.includes(BID) : true;
      return hasA && hasB;
    }) ??
    events.find((e: any) => {
      const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
      const names = comp.flatMap((c: any) => [
        norm(bestName(c)),
        norm(c?.team?.abbreviation),
      ]);
      const A = norm(card.teamA), B = norm(card.teamB);
      const joined = names.join("|");
      return joined.includes(A) && joined.includes(B);
    });

  if (!ev) return {};

  // only show during live play
  const state = ev?.competitions?.[0]?.status?.type?.state ?? ev?.status?.type?.state;
  if (state !== "in") return {};

  const last = ev?.competitions?.[0]?.situation?.lastPlay ?? ev?.situation?.lastPlay;
  const text: string | undefined = last?.text ?? last?.description ?? last?.detail;
  if (!text || !text.trim()) return {};

  // competitor + logo lookup
  const comp = ev?.competitions?.[0]?.competitors ?? ev?.competitors ?? [];
  const byRole: Record<"home" | "away", { id?: string; logo?: string }> = {
    home: {
      id: String(comp.find((c: any) => c?.homeAway === "home")?.team?.id ?? ""),
      logo: firstLogo(comp.find((c: any) => c?.homeAway === "home")?.team),
    },
    away: {
      id: String(comp.find((c: any) => c?.homeAway === "away")?.team?.id ?? ""),
      logo: firstLogo(comp.find((c: any) => c?.homeAway === "away")?.team),
    },
  };

  // logo for the team that made the play (optional)
  const tid = last?.team?.id ? String(last.team.id) : "";
  const idToLogo: Record<string, string | undefined> = {
    [byRole.home.id || ""]: byRole.home.logo,
    [byRole.away.id || ""]: byRole.away.logo,
  };
  const logo = tid && idToLogo[tid] ? idToLogo[tid] : undefined;

  // live win% if provided
  const hp = Number(last?.probability?.homeWinPercentage);
  const ap = Number(last?.probability?.awayWinPercentage);
  let winPct: number | undefined;
  let winLogo: string | undefined;

  if (Number.isFinite(hp) || Number.isFinite(ap)) {
    const h = Number.isFinite(hp) ? hp : 0;
    const a = Number.isFinite(ap) ? ap : 0;
    if (h >= a) {
      winPct = h * 100;
      winLogo = byRole.home.logo;
    } else {
      winPct = a * 100;
      winLogo = byRole.away.logo;
    }
  } else if (Number.isFinite(card.mlProb as number)) {
    // fallback to pregame ML pick/prob
    winPct = (card.mlProb as number) * 100;
    // map A/B to logos shown on the card
    const aLogo =
      (card as any).aLogoPrimary || (card as any).aLogoAlt || undefined;
    const bLogo =
      (card as any).bLogoPrimary || (card as any).bLogoAlt || undefined;
    winLogo = card.mlTeam === "A" ? aLogo : bLogo;
  }

  return { text: text.trim(), logo, winPct, winLogo };
}



  const lastPlay = getLastPlayInfo(card, livePayload);
  const rr = getLiveRankRecord(card, livePayload);
  const vb = getVenueBroadcast(card, livePayload);


  const hasFinalA = Number.isFinite(card.finalA as number);
  const hasFinalB = Number.isFinite(card.finalB as number);
  const pillBg = "color-mix(in oklab, var(--brand) 12%, white)";

  const liveInProgress = card.liveState === "in";
  const hasLiveA = Number.isFinite(card.liveScoreA as number);
  const hasLiveB = Number.isFinite(card.liveScoreB as number);

  const displayScoreA = hasFinalA
    ? (card.finalA as number)
    : hasLiveA
    ? (card.liveScoreA as number)
    : undefined;
  const displayScoreB = hasFinalB
    ? (card.finalB as number)
    : hasLiveB
    ? (card.liveScoreB as number)
    : undefined;

  const hasPace =
    card.pickTotal &&
    Number.isFinite(card.liveTotalPace as number) &&
    card.liveState === "in";


  const hasLiveTotal = Number.isFinite(card.liveTotalLine as number) && card.liveState === "in";
  const hasLiveSpread = Number.isFinite(card.liveSpreadLine as number) && card.liveState === "in";

  const liveSpreadSigned = card.liveSpreadLine as number | undefined;
  const liveSpreadLabel =
    liveSpreadSigned != null && Number.isFinite(liveSpreadSigned)
      ? (liveSpreadSigned > 0 ? `+${liveSpreadSigned}` : `${liveSpreadSigned}`)
      : undefined;


  // pill color based on result
  function pillColor(kind: "spread" | "total" | "ml"): string | undefined {
    const aF = card.finalA,
      bF = card.finalB;
    if (!Number.isFinite(aF as number) || !Number.isFinite(bF as number)) return undefined;

    const gray = "var(--muted-bg, #f1f5f9)";
    const green = "rgba(16,185,129,0.18)";
    const red = "rgba(239,68,68,0.18)";

    if (kind === "ml" && card.pickML) {
      const pickA = card.pickML.teamSide === "A";
      const won = pickA ? (aF as number) > (bF as number) : (bF as number) > (aF as number);
      return won ? green : red;
    }
    if (kind === "spread" && card.pickSpread) {
      const line = Number(card.pickSpread.line);
      if (!Number.isFinite(line)) return undefined;
      if (card.pickSpread.teamSide === "A") {
        const adjA = (aF as number) + line;
        if (adjA === (bF as number)) return gray;
        return adjA > (bF as number) ? green : red;
      } else {
        const adjB = (bF as number) + line;
        if (adjB === (aF as number)) return gray;
        return adjB > (aF as number) ? green : red;
      }
    }
    if (kind === "total" && card.pickTotal) {
      const t = (aF as number) + (bF as number);
      const line = Number(card.pickTotal.line);
      if (!Number.isFinite(line)) return undefined;
      if (t === line) return gray;
      return card.pickTotal.side === "Over"
        ? t > line
          ? green
          : red
        : t < line
        ? green
        : red;
    }
    return undefined;
  }

  // background for the Pace pill (stronger color as it gets further from the line)
  function pacePillBg(signedDelta: number | undefined): string {
    if (!Number.isFinite(signedDelta as number)) {
      return "color-mix(in oklab, var(--muted-bg, #f1f5f9) 40%, white)";
    }
    const d = signedDelta as number;
    const NEUTRAL_BAND = 2; // points within which we treat as neutral
    if (Math.abs(d) <= NEUTRAL_BAND) {
      return "color-mix(in oklab, var(--muted-bg, #f1f5f9) 40%, white)";
    }

    const MAX_DELTA = 30;
    const t = Math.min(Math.abs(d) / MAX_DELTA, 1); // 0..1

    const good = "#16a34a";
    const bad = "#ef4444";
    const base = d >= 0 ? good : bad;
    const strength = 25 + 50 * t; // 25% → 75% as we move away from the line

    return `color-mix(in oklab, ${base} ${strength}%, white)`;
  }

    // Spread pace: projected final margin for the spread side, and how far
  // that is from the "cover threshold" (positive = good for our bet).
  function getSpreadPaceInfo() {
    if (!card.pickSpread || card.liveState !== "in") return null;
    if (
      !Number.isFinite(card.liveScoreA as number) ||
      !Number.isFinite(card.liveScoreB as number) ||
      !Number.isFinite(card.liveElapsed as number)
    ) {
      return null;
    }

    // 🔁 NEW: projected final margin (A − B)
    const projMarginA = projectLiveSpread({
      scoreA: card.liveScoreA as number,
      scoreB: card.liveScoreB as number,
      elapsedSec: card.liveElapsed as number,
      projectedTotal: card.liveTotalPace, // already computed total projection
      priorTotal: card.medTotal,
      p25Total: card.p25Total,
      p75Total: card.p75Total,

      priorMargin: card.medMargin,
      p25Margin: card.p25Margin,
      p75Margin: card.p75Margin,
    });

    const betIsA = card.pickSpread.teamSide === "A";
    const paceMarginBet = betIsA ? projMarginA : -projMarginA;

    const line = card.pickSpread.line;
    if (!Number.isFinite(line as number)) return null;

    // For the bet side, covering means (paceMarginBet + line) > 0
    const coverDelta = paceMarginBet + (line as number);

    return { paceMarginBet, coverDelta };
  }


  const spreadPace = getSpreadPaceInfo();


  const whyText = buildWhyParagraph(card);

  // --- distributions state
  const [Apts, setApts] = useState<number[]>([]);
  const [Bpts, setBpts] = useState<number[]>([]);
  const [Totals, setTotals] = useState<number[]>([]);
  const [Spreads, setSpreads] = useState<number[]>([]); // B - A (Right − Left)

  // team stats
  const [statColumns, setStatColumns] = useState<string[]>([]);
  const [AStats, setAStats] = useState<Record<string, number[]>>({});
  const [BStats, setBStats] = useState<Record<string, number[]>>({});
  // const [statKey, setStatKey] = useState<string>("");

  // UI controls
  type Metric = "spread" | "total" | "teamA" | "teamB";
  const [metric, setMetric] = useState<Metric>("spread");
  const [bins, setBins] = useState<number | "auto">("auto");
  // const [enteredSpread, setEnteredSpread] = useState<string>("");
  // const [spreadSide, setSpreadSide] = useState<"A" | "B">("A");
  const [enteredTotal, setEnteredTotal] = useState<string>("");

  const [statKey, setStatKey] = useState<string>("");

  // Which side we're evaluating from for spread cover math
  const [spreadSide, setSpreadSide] = useState<"A" | "B">("A");

  // User-picked value (string from <select>)
  const [enteredSpread, setEnteredSpread] = useState<string>("");

  // Build half-point options –40.0 … +40.0
  const spreadOptions = useMemo<string[]>(() => {
    const opts: string[] = [];
    for (let v = -40; v <= 40.0001; v += 0.5) opts.push(v.toFixed(1));
    return opts;
  }, []);

  // Default to the card’s listed spread (flipped if user picks the other side)
  const defaultSpread = useMemo<number>(() => {
    const ps = card.pickSpread;
    if (!ps) return 0;
    const raw = ps.teamSide === spreadSide ? ps.line : -ps.line;
    return Number((Math.round(raw * 2) / 2).toFixed(1)); // snap to .5
  }, [card.pickSpread, spreadSide]);

  // The actual value shown in the select; always matches an <option>
  const spreadSelectValue = useMemo<string>(() => {
    return enteredSpread !== "" ? enteredSpread : defaultSpread.toFixed(1);
  }, [enteredSpread, defaultSpread]);

  // Parsed numeric line used by cover% math / chart line
  const lineValSpread = useMemo<number | undefined>(() => {
    const n = parseFloat(spreadSelectValue);
    return Number.isFinite(n) ? n : undefined;
  }, [spreadSelectValue]);

  // lazy-load compact json on first open
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!showDist || loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        setLoadingDist(true);
        setErrDist(null);

        const base = DATASET_ROOT.replace(/\/+$/, "");
        const compactFromIndex = card.compactPath
          ? `${base}/${card.compactPath.replace(/^\/+/, "")}`
          : undefined;
        const compactFromSummary = card.summaryPath
          ? `${base}/${inferCompactPath(card.summaryPath)!.replace(/^\/+/, "")}`
          : undefined;
        const url = compactFromIndex || compactFromSummary;
        if (!url) {
          setErrDist("No sims_compact.json path.");
          setLoadingDist(false);
          return;
        }

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const J = await res.json();

        const a = (J.A_pts || []) as number[];
        const b = (J.B_pts || []) as number[];
        setApts(a);
        setBpts(b);
        setTotals((J.totals as number[]) || a.map((x, i) => x + (b[i] ?? 0)));
        setSpreads((J.spreads as number[]) || a.map((x, i) => (b[i] ?? 0) - x)); // B - A

        const aStats = (J.A_stats as Record<string, number[]>) || {};
        const bStats = (J.B_stats as Record<string, number[]>) || {};
        const cols = Object.keys(aStats).filter(
          (k) => Array.isArray(aStats[k]) && Array.isArray(bStats[k])
        );
        setAStats(aStats);
        setBStats(bStats);
        setStatColumns(cols);
        if (!statKey && cols.length) setStatKey(cols[0]);

        setLoadingDist(false);
      } catch (e: any) {
        setErrDist(e?.message || "Failed to load compact sims.");
        setLoadingDist(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDist]);

  // series selector for charts
  const series = useMemo(() => {
    if (metric === "spread") return Spreads;
    if (metric === "total") return Totals;
    if (metric === "teamA") return Apts;
    return Bpts;
  }, [metric, Spreads, Totals, Apts, Bpts]);

  // chart histogram (client-side binning)
  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin[];
    const B = bins === "auto" ? undefined : Math.max(1, Number(bins));
    return computeHistogram(series, B);
  }, [series, bins]);

  const q = useMemo(() => quantiles(series), [series]);

  // Distributions(): replace qTickInfo with a median-only version
  const qTickInfo = useMemo(() => {
    if (!series.length || !hist.length) return { ticks: [] as string[], fmt: (_: string) => "" };
    const medLabel = findBinLabel(hist, q?.med as number);
    const ticks = medLabel ? [medLabel] : [];
    const fmt = (label: string) => (label === medLabel ? (q?.med ?? 0).toFixed(1) : "");
    return { ticks, fmt };
  }, [hist, q, series]);


  const lineValTotal = useMemo(() => {
    const t = parseFloat(enteredTotal);
    return Number.isFinite(t) ? t : undefined;
  }, [enteredTotal]);

  const N = useMemo(
    () => Math.max(Apts.length, Bpts.length),
    [Apts, Bpts]
  );
  function pct(x: number) {
    return (100 * x) / Math.max(1, N);
  }

  const spreadResult = useMemo(() => {
    if (!Number.isFinite(lineValSpread as number) || !N) return null;
    const line = lineValSpread as number;
    let cover = 0,
      push = 0;
    for (let i = 0; i < N; i++) {
      const a = Apts[i],
        b = Bpts[i];
      if (a == null || b == null) continue;
      const margin = spreadSide === "A" ? a - b : b - a;
      if (margin > line) cover++;
      else if (Math.abs(margin - line) < 1e-9) push++;
    }
    return { cover: pct(cover), push: pct(push), lose: pct(N - cover - push) };
  }, [lineValSpread, spreadSide, N, Apts, Bpts]);

  const totalResult = useMemo(() => {
    if (!Number.isFinite(lineValTotal as number) || !N) return null;
    const line = lineValTotal as number;
    let over = 0,
      push = 0;
    for (let i = 0; i < N; i++) {
      const t = (Apts[i] ?? 0) + (Bpts[i] ?? 0);
      if (t > line) over++;
      else if (Math.abs(t - line) < 1e-9) push++;
    }
    return { over: pct(over), push: pct(push), under: pct(N - over - push) };
  }, [lineValTotal, N, Apts, Bpts]);

  const leftColor = "var(--brand)";
  const rightColor = "var(--accent)";

  const aLogo =
    logoMode === "primary"
      ? card.aLogoPrimary || card.aLogoAlt
      : card.aLogoAlt || card.aLogoPrimary;
  const bLogo =
    logoMode === "primary"
      ? card.bLogoPrimary || card.bLogoAlt
      : card.bLogoAlt || card.bLogoPrimary;

  /* ---------- Team Stats histograms + quartile ticks ---------- */
  const statHistLeft = useMemo(
    () => computeHistogram(AStats[statKey] || [], 20),
    [AStats, statKey]
  );
  const statHistRight = useMemo(
    () => computeHistogram(BStats[statKey] || [], 20),
    [BStats, statKey]
  );

  const statQLeft = useMemo(
    () => quantiles(AStats[statKey] || []),
    [AStats, statKey]
  );
  const statQRight = useMemo(
    () => quantiles(BStats[statKey] || []),
    [BStats, statKey]
  );

  const statTicksLeft = useMemo(() => {
    if (!statHistLeft.length)
      return { ticks: [] as string[], fmt: (_: string) => "" };
    const q1 = findBinLabel(statHistLeft, statQLeft?.q1 as number);
    const me = findBinLabel(statHistLeft, statQLeft?.med as number);
    const q3 = findBinLabel(statHistLeft, statQLeft?.q3 as number);
    const ticks = [q1, me, q3].filter(Boolean) as string[];
    const fmt = (label: string) => {
      if (label === q1) return (statQLeft?.q1 ?? 0).toFixed(2);
      if (label === me) return (statQLeft?.med ?? 0).toFixed(2);
      if (label === q3) return (statQLeft?.q3 ?? 0).toFixed(2);
      return "";
    };
    return { ticks, fmt };
  }, [statHistLeft, statQLeft]);

  const statTicksRight = useMemo(() => {
    if (!statHistRight.length)
      return { ticks: [] as string[], fmt: (_: string) => "" };
    const q1 = findBinLabel(statHistRight, statQRight?.q1 as number);
    const me = findBinLabel(statHistRight, statQRight?.med as number);
    const q3 = findBinLabel(statHistRight, statQRight?.q3 as number);
    const ticks = [q1, me, q3].filter(Boolean) as string[];
    const fmt = (label: string) => {
      if (label === q1) return (statQRight?.q1 ?? 0).toFixed(2);
      if (label === me) return (statQRight?.med ?? 0).toFixed(2);
      if (label === q3) return (statQRight?.q3 ?? 0).toFixed(2);
      return "";
    };
    return { ticks, fmt };
  }, [statHistRight, statQRight]);

  return (
    <article
      className="card"
      style={{
        padding: 12,
        borderRadius: 12,
        border: liveInProgress ? "2px solid #0b63f6" : "1px solid var(--border)",
        background: "var(--surface)",
        display: "grid",
        gridTemplateRows: "auto auto auto",
        gap: 8,
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        boxShadow: liveInProgress
          ? "0 0 0 1px rgba(239,68,68,0.2)"
          : "none",
        overflow: "hidden"
      }}
    >
      {/* header: tip time + live status + Pace pill */}
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          minWidth: 0
        }}
      >
        <span>{card.tipEtLabel ?? "TBD"}</span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {card.liveStatusText && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: liveInProgress ? "#b91c1c" : "var(--muted)",
              }}
            >
              {card.liveStatusText}
            </span>
          )}

          {hasPace && (
            <span
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                background: (() => {
                  const pace = card.liveTotalPace as number;
                  const line = card.pickTotal?.line;
                  if (!Number.isFinite(pace) || !Number.isFinite(line)) {
                    return pacePillBg(undefined);
                  }
                  const isOver = card.pickTotal!.side === "Over";
                  const deltaRaw = pace - (line as number);
                  const signed = isOver ? deltaRaw : -deltaRaw;
                  return pacePillBg(signed);
                })(),
                border: "1px solid var(--border)",
              }}
            >
              Pace: {Number(card.liveTotalPace).toFixed(1)}{" "}
              {(() => {
                const pace = card.liveTotalPace as number;
                const line = card.pickTotal?.line;
                if (!Number.isFinite(pace) || !Number.isFinite(line)) return "";
                const delta = pace - (line as number);
                const sign = delta >= 0 ? "+" : "";
                return `(${sign}${delta.toFixed(1)} vs ${line})`;
              })()}
            </span>
          )}
          {spreadPace && card.pickSpread && (
            <span
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                background: pacePillBg(spreadPace.coverDelta), // same green/gray/red logic
                border: "1px solid var(--border)",
              }}
            >
              Spread pace: {card.pickSpread.teamName}{" "}
              {spreadPace.paceMarginBet >= 0 ? "+" : ""}
              {spreadPace.paceMarginBet.toFixed(1)}{" "}
              {(() => {
                const d = spreadPace.coverDelta;
                const sign = d >= 0 ? "+" : "";
                return `(${sign}${d.toFixed(1)} vs cover)`;
              })()}
            </span>
          )}

        </div>
      </div>

      {/* projected vs actual scores */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 90px 90px",
          rowGap: 6,
          columnGap: 8,
          alignItems: "center",
        }}
      >
        <div />
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Projected
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Actual
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <img
            alt=""
            src={(logoMode === "primary"
              ? aLogo || undefined
              : aLogo || undefined) as any as string}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              objectFit: "contain",
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            {rr.A.rank && (
              <sup
                style={{
                  fontSize: 10,         // smaller
                  fontWeight: 700,
                  color: "#5b677a",     // same muted color as record
                  verticalAlign: "super",
                  lineHeight: 1,
                  marginRight: 2,
                }}
              >
                {rr.A.rank}
              </sup>
            )}
            <span style={{ fontWeight: 700 }}>{card.teamA}</span>
            {rr.A.record && (
              <span style={{ fontSize: 12, color: "#5b677a" }}>
                &nbsp;{rr.A.record}
              </span>
            )}
          </div>

        </div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 22,
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          {Number.isFinite(card.projA as number) ? card.projA : "—"}
        </div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 22,
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          {typeof displayScoreA === "number" ? displayScoreA : "—"}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <img
            alt=""
            src={(logoMode === "primary"
              ? bLogo || undefined
              : bLogo || undefined) as any as string}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              objectFit: "contain",
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {rr.B.rank && (
              <sup
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#5b677a",
                  verticalAlign: "super",
                  lineHeight: 1,
                  marginRight: 2,
                }}
              >
                {rr.B.rank}
              </sup>
            )}
            <span style={{ fontWeight: 700 }}>{card.teamB}</span>
            {rr.B.record && (
              <span style={{ fontSize: 12, color: "#5b677a" }}>
                &nbsp;{rr.B.record}
              </span>
            )}
          </div>

        </div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 22,
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          {Number.isFinite(card.projB as number) ? card.projB : "—"}
        </div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 22,
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          {typeof displayScoreB === "number" ? displayScoreB : "—"}
        </div>
      </div>

      
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {(vb.broadcast || vb.venue) && (
            <div style={{ marginLeft: "auto", textAlign: "right", lineHeight: 1 }}>
              {vb.broadcast && (
                <div style={{ fontSize: 12, color: "#5b677a" }}>{vb.broadcast}</div>
              )}
              {vb.venue && (
                <div style={{ fontSize: 12, color: "#5b677a" }}>{vb.venue}</div>
              )}
            </div>
          )}
        </div>

      {lastPlay?.text && (
        <div
          style={{
            margin: "6px 0 10px",
            padding: "6px 10px",
            background: "#f5f7fb",
            border: "1px solid #e6ebf5",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.3,
            color: "#24324a",
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
            minWidth: 0
          }}
        >
          {/* left: team logo that made the play + text */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {lastPlay.logo && (
              <img
                src={lastPlay.logo}
                alt=""
                style={{ width: 16, height: 16, objectFit: "contain", flex: "0 0 auto" }}
              />
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {lastPlay.text}
            </span>
          </div>

          {/* right: current win % + tiny logo of the side favored right now */}
          {(Number.isFinite(lastPlay.winPct as number) || lastPlay.winLogo) && (
            <div
              title="Live win probability"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#0b1f4a",
                whiteSpace: "nowrap",
                flex: "0 0 auto",
              }}
            >
              {lastPlay.winLogo && (
                <img
                  src={lastPlay.winLogo}
                  alt=""
                  style={{ width: 14, height: 14, objectFit: "contain" }}
                />
              )}
              {Number.isFinite(lastPlay.winPct as number) && (
                <strong>{(lastPlay.winPct as number).toFixed(1)}%</strong>
              )}
            </div>
          )}
        </div>
      )}


      {/* betting pills (spread / total / ML) – PACE pill has been moved to header */}
      {(card.pickSpread || card.pickTotal || card.pickML) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 4,
          }}
        >
          {card.pickSpread && (
            <span
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                background: pillColor("spread") ?? pillBg,
                border: "1px solid var(--border)",
              }}
            >
              Spread: {card.pickSpread.teamName}{" "}
              {card.pickSpread.line > 0
                ? `+${card.pickSpread.line}`
                : `${card.pickSpread.line}`}{" "}
              ({fmtAmerican(card.pickSpread.fairAm)} ·{" "}
              {fmtPct(card.pickSpread.prob)})
              {fmtEV(card.evSpread)}
            </span>
          )}

          {card.pickTotal && (
            <span
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                background: pillColor("total") ?? pillBg,
                border: "1px solid var(--border)",
              }}
            >
              Total: {card.pickTotal.side} {card.pickTotal.line}{" "}
              ({fmtAmerican(card.pickTotal.fairAm)} ·{" "}
              {fmtPct(card.pickTotal.prob)})
              {fmtEV(card.evTotal)}
            </span>
          )}

          {card.pickML && (
            <span
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                background: pillColor("ml") ?? pillBg,
                border: "1px solid var(--border)",
              }}
            >
              ML: {card.pickML.teamName} (
              {fmtAmerican(card.pickML.fairAm)} ·{" "}
              {fmtPct(card.pickML.prob)})
              {fmtEV(card.evML)}
            </span>
          )}
        </div>
      )}

      {/* WHY / Distributions buttons and content remain unchanged */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 4,
        }}
      >
        <button
          onClick={() => setShowWhy((s) => !s)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: showWhy ? "var(--brand)" : "var(--card)",
            color: showWhy ? "var(--brand-contrast)" : "var(--text)",
          }}
        >
          {showWhy ? "Hide WHY" : "Show WHY"}
        </button>

        {liveEligible && (
          <button
            onClick={() => setShowLive(true)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #0b63f6", // same blue as live outline
              background: "#0b63f6",
              color: "white",
              fontWeight: 800,
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.05,
            }}
            title="ESPN live team shooting percentages"
          >
            <span>GAME</span>
            <span>STATS</span>
          </button>
        )}

        <button
          onClick={() => setShowDist((s) => !s)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: showDist ? "var(--brand)" : "var(--card)",
            color: showDist ? "var(--brand-contrast)" : "var(--text)",
          }}
        >
          {showDist ? "Hide Distributions" : "Show Distributions"}
        </button>



      </div>

      {showWhy && (
        <div
          style={{
            marginTop: 8,
            borderTop: "1px dashed var(--border)",
            paddingTop: 8,
            fontSize: 13,
            lineHeight: 1.3,
          }}
        >
          {whyText.map((w, idx) => (
            <div key={w.key ?? idx} style={{ marginBottom: 6 }}>
              {w.phrase}
            </div>
          ))}
        </div>
      )}

      {showLive && (
        <LiveStatsModal
          card={card}
          livePayload={livePayload}   // ⬅️ pass in
          onClose={() => setShowLive(false)}
        />
      )}


      {showDist && (
        <Distributions
          card={card}
          loadingDist={loadingDist}
          errDist={errDist}
          setLoadingDist={setLoadingDist}
          setErrDist={setErrDist}
          Apts={Apts}
          Bpts={Bpts}
          Totals={Totals}
          Spreads={Spreads}
          setApts={setApts}
          setBpts={setBpts}
          setTotals={setTotals}
          setSpreads={setSpreads}
          statColumns={statColumns}
          setStatColumns={setStatColumns}
          AStats={AStats}
          setAStats={setAStats}
          BStats={BStats}
          setBStats={setBStats}
        />
      )}
    </article>
  );
}



/* --- split distributions UI for readability (no logic changes) --- */
function Distributions(props: {
  card: Card;
  loadingDist: boolean; errDist: string | null;
  setLoadingDist: (v: boolean) => void; setErrDist: (v: string | null) => void;
  Apts: number[]; Bpts: number[]; Totals: number[]; Spreads: number[];
  setApts: (v: number[]) => void; setBpts: (v: number[]) => void;
  setTotals: (v: number[]) => void; setSpreads: (v: number[]) => void;
  statColumns: string[]; setStatColumns: (v: string[]) => void;
  AStats: Record<string, number[]>; setAStats: (v: Record<string, number[]>) => void;
  BStats: Record<string, number[]>; setBStats: (v: Record<string, number[]>) => void;
}) {
  const {
    card, loadingDist, errDist,
    Apts, Bpts, Totals, Spreads,
    statColumns, AStats, BStats,
  } = props;

  const [metric, setMetric] = useState<"spread" | "total" | "teamA" | "teamB">("spread");
  const [bins, setBins] = useState<number | "auto">("auto");
  const [enteredSpread, setEnteredSpread] = useState<string>("");
  const [spreadSide, setSpreadSide] = useState<"A" | "B">("A");
  const [enteredTotal, setEnteredTotal] = useState<string>("");
  const [statKey, setStatKey] = useState<string>("");

    // Build half-point options –40.0 … +40.0
  const spreadOptions = useMemo<string[]>(() => {
    const opts: string[] = [];
    for (let v = -100; v <= 100.0001; v += 0.5) opts.push(v.toFixed(1));
    return opts;
  }, []);

  // Default to the card’s listed spread (flipped if user picks the other side)
  const defaultSpread = useMemo<number>(() => {
    const ps = card.pickSpread;
    if (!ps) return 0;
    const raw = ps.teamSide === spreadSide ? ps.line : -ps.line;
    return Number((Math.round(raw * 2) / 2).toFixed(1)); // snap to .5
  }, [card.pickSpread, spreadSide]);

  // The actual value shown in the select; always matches an <option>
  const spreadSelectValue = useMemo<string>(() => {
    return enteredSpread !== "" ? enteredSpread : defaultSpread.toFixed(1);
  }, [enteredSpread, defaultSpread]);


  const series = useMemo(() => {
    if (metric === "spread") return Spreads;
    if (metric === "total") return Totals;
    if (metric === "teamA") return Apts;
    return Bpts;
  }, [metric, Spreads, Totals, Apts, Bpts]);

  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin[];
    const B = bins === "auto" ? undefined : Math.max(1, Number(bins));
    return computeHistogram(series, B);
  }, [series, bins]);

  const q = useMemo(() => quantiles(series), [series]);

  const qTickInfo = useMemo(() => {
    if (!series.length || !hist.length) return { ticks: [] as string[], fmt: (_: string) => "" };
    const q1Label = findBinLabel(hist, q?.q1 as number);
    const medLabel = findBinLabel(hist, q?.med as number);
    const q3Label = findBinLabel(hist, q?.q3 as number);
    const ticks = [q1Label, medLabel, q3Label].filter(Boolean) as string[];
    const fmt = (label: string) => {
      if (label === q1Label) return (q?.q1 ?? 0).toFixed(1);
      if (label === medLabel) return (q?.med ?? 0).toFixed(1);
      if (label === q3Label) return (q?.q3 ?? 0).toFixed(1);
      return "";
    };
    return { ticks, fmt };
  }, [hist, q, series]);

  const lineValSpread = useMemo(() => {
    const s = parseFloat(spreadSelectValue);
    return Number.isFinite(s) ? s : undefined;
  }, [spreadSelectValue]);
  const lineValTotal = useMemo(() => {
    const t = parseFloat(enteredTotal);
    return Number.isFinite(t) ? t : undefined;
  }, [enteredTotal]);

  const N = useMemo(() => Math.max(Apts.length, Bpts.length), [Apts, Bpts]);
  function pct(x: number) { return (100 * x) / Math.max(1, N); }

  const spreadResult = useMemo(() => {
    if (!Number.isFinite(lineValSpread as number) || !N) return null;
    const line = lineValSpread as number;
    let cover = 0, push = 0;
    for (let i = 0; i < N; i++) {
      const a = Apts[i], b = Bpts[i];
      if (a == null || b == null) continue;

      // Margin from the selected team’s POV
      const margin = spreadSide === "A" ? a - b : b - a;

      // Apply the handicap (e.g. +2, -4.5)
      const adj = margin + line;

      if (adj > 0) cover++;
      else if (Math.abs(adj) < 1e-9) push++;
    }
    return { cover: pct(cover), push: pct(push), lose: pct(N - cover - push) };
  }, [lineValSpread, spreadSide, N, Apts, Bpts]);


  const totalResult = useMemo(() => {
    if (!Number.isFinite(lineValTotal as number) || !N) return null;
    const line = lineValTotal as number;
    let over = 0, push = 0;
    for (let i = 0; i < N; i++) {
      const t = (Apts[i] ?? 0) + (Bpts[i] ?? 0);
      if (t > line) over++;
      else if (Math.abs(t - line) < 1e-9) push++;
    }
    return { over: pct(over), push: pct(push), under: pct(N - over - push) };
  }, [lineValTotal, N, Apts, Bpts]);

  const leftColor = "var(--brand)";
  const rightColor = "var(--accent)";

  /* ---------- Team Stats histograms + quartile ticks ---------- */
  const statHistLeft = useMemo(() => computeHistogram(AStats[statKey] || [], 20), [AStats, statKey]);
  const statHistRight = useMemo(() => computeHistogram(BStats[statKey] || [], 20), [BStats, statKey]);

  const statQLeft = useMemo(() => quantiles(AStats[statKey] || []), [AStats, statKey]);
  const statQRight = useMemo(() => quantiles(BStats[statKey] || []), [BStats, statKey]);

  const statTicksLeft = useMemo(() => {
    if (!statHistLeft.length) return { ticks: [] as string[], fmt: (_: string) => "" };
    const q1 = findBinLabel(statHistLeft, statQLeft?.q1 as number);
    const me = findBinLabel(statHistLeft, statQLeft?.med as number);
    const q3 = findBinLabel(statHistLeft, statQLeft?.q3 as number);
    const ticks = [q1, me, q3].filter(Boolean) as string[];
    const fmt = (label: string) => {
      if (label === q1) return (statQLeft?.q1 ?? 0).toFixed(2);
      if (label === me) return (statQLeft?.med ?? 0).toFixed(2);
      if (label === q3) return (statQLeft?.q3 ?? 0).toFixed(2);
      return "";
    };
    return { ticks, fmt };
  }, [statHistLeft, statQLeft]);

  const statTicksRight = useMemo(() => {
    if (!statHistRight.length) return { ticks: [] as string[], fmt: (_: string) => "" };
    const q1 = findBinLabel(statHistRight, statQRight?.q1 as number);
    const me = findBinLabel(statHistRight, statQRight?.med as number);
    const q3 = findBinLabel(statHistRight, statQRight?.q3 as number);
    const ticks = [q1, me, q3].filter(Boolean) as string[];
    const fmt = (label: string) => {
      if (label === q1) return (statQRight?.q1 ?? 0).toFixed(2);
      if (label === me) return (statQRight?.med ?? 0).toFixed(2);
      if (label === q3) return (statQRight?.q3 ?? 0).toFixed(2);
      return "";
    };
    return { ticks, fmt };
  }, [statHistRight, statQRight]);

  return (
    <div style={{ marginTop: 10 }}>
      {loadingDist && <div style={{ opacity: 0.8 }}>Loading sims…</div>}
      {errDist && <div style={{ color: "var(--accent)" }}>{errDist}</div>}

      {!loadingDist && !errDist && !!(Apts.length && Bpts.length) && (
        <>
          {/* Score distributions */}
          <div className="card" style={{ padding: 8 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as any)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
              >
                <option value="spread">Spread (Right − Left)</option>
                <option value="total">Total</option>
                <option value="teamA">{card.teamA} points</option>
                <option value="teamB">{card.teamB} points</option>
              </select>

              <span style={{ fontSize: 12, color: "var(--muted)" }}>Bins:</span>
              <input
                type="number"
                value={bins === "auto" ? "" : String(bins)}
                placeholder="auto"
                onChange={(e) => setBins(e.target.value === "" ? "auto" : Math.max(1, Number(e.target.value)))}
                style={{ width: 72, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
              />
            </div>

            <div style={{ height: 220, marginTop: 6 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                  <XAxis
                    dataKey="bin"
                    interval={0}
                    height={20}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    ticks={qTickInfo.ticks}
                    tickFormatter={qTickInfo.fmt}
                  />
                  <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
                    labelStyle={{ color: "var(--muted)" }}
                    itemStyle={{ color: "var(--text)" }}
                    formatter={(v: any) => [v, "Count"]}
                  />
                  <Bar
                    dataKey="count"
                    name={
                      metric === "spread" ? "Spread (R−L)" :
                      metric === "total" ? "Total" :
                      metric === "teamA" ? `${card.teamA} points` :
                      `${card.teamB} points`
                    }
                  >
                    {hist.map((h, i) => (
                      <Cell
                        key={i}
                        fill={
                          metric === "teamA" ? "var(--brand)" :
                          metric === "teamB" ? "var(--accent)" :
                          metric === "total"
                            ? ((h.start + h.end) / 2) < (q?.med ?? 0) ? "var(--brand)" : "var(--accent)"
                            : ((h.start + h.end) / 2) < 0 ? "var(--brand)" : "var(--accent)"
                        }
                      />
                    ))}
                  </Bar>
                  {metric === "spread" && Number.isFinite(parseFloat(enteredSpread)) && (
                    <ReferenceLine
                      x={findBinLabel(hist, parseFloat(enteredSpread))}
                      ifOverflow="extendDomain"
                      stroke="var(--accent)"
                      strokeDasharray="4 4"
                      label={{ value: `Line ${enteredSpread}`, position: "top", fontSize: 11, fill: "var(--accent)" }}
                    />
                  )}
                  {metric === "total" && Number.isFinite(parseFloat(enteredTotal)) && (
                    <ReferenceLine
                      x={findBinLabel(hist, parseFloat(enteredTotal))}
                      ifOverflow="extendDomain"
                      stroke="var(--accent)"
                      strokeDasharray="4 4"
                      label={{ value: `Line ${enteredTotal}`, position: "top", fontSize: 11, fill: "var(--accent)" }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Inputs for spread/total calculations */}
            <div className="card" style={{ marginTop: 8, padding: 8, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <b>Spread Cover %</b>
                <select
                  value={spreadSide}
                  onChange={(e) => setSpreadSide(e.target.value as "A" | "B")}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                >
                  <option value="A">{card.teamA}</option>
                  <option value="B">{card.teamB}</option>
                </select>
                <select
                  value={spreadSelectValue}
                  onChange={(e) => setEnteredSpread(e.target.value)}
                  style={{ width: 100, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                >
                  {spreadOptions.map((opt: string) => {
                    const v = parseFloat(opt);
                    const label = v > 0 ? `+${opt}` : opt; // show "+" for positive
                    return (
                      <option key={opt} value={opt}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                {spreadResult && (
                  <div style={{ display: "flex", gap: 10, fontSize: 13 }}>
                    <span><b>Cover</b>: {spreadResult.cover.toFixed(1)}%</span>
                    <span><b>Push</b>: {spreadResult.push.toFixed(1)}%</span>
                    <span><b>Lose</b>: {spreadResult.lose.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <b>Total Over/Under %</b>
                <input
                  type="number"
                  step={0.5}
                  placeholder="145.5"
                  value={enteredTotal}
                  onChange={(e) => setEnteredTotal(e.target.value)}
                  style={{ width: 100, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                />
                {totalResult && (
                  <div style={{ display: "flex", gap: 10, fontSize: 13 }}>
                    <span><b>Over</b>: {totalResult.over.toFixed(1)}%</span>
                    <span><b>Push</b>: {totalResult.push.toFixed(1)}%</span>
                    <span><b>Under</b>: {totalResult.under.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Team Stats distributions */}
          <div className="card" style={{ padding: 8, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b>Team Stats</b>
              <select
                value={statKey}
                onChange={(e) => setStatKey(e.target.value)}
                style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)" }}
              >
                {statColumns.length ? statColumns.map((k) => <option key={k} value={k}>{k}</option>) : <option>—</option>}
              </select>
            </div>

            {!statKey || (!(AStats[statKey]?.length) && !(BStats[statKey]?.length)) ? (
              <div style={{ height: 160, display: "grid", placeItems: "center", opacity: 0.7, marginTop: 6 }}>
                No team stats detected.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 6 }}>
                {/* A side */}
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{card.teamA}</div>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={computeHistogram(AStats[statKey] || [], 20)} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                        <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                        <XAxis dataKey="bin" interval={0} height={20} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
                          labelStyle={{ color: "var(--muted)" }}
                          itemStyle={{ color: "var(--text)" }}
                          formatter={(v: any) => [v, "Count"]}
                        />
                        <Bar dataKey="count" name={`${card.teamA} • ${statKey}`}>
                          {Array.from({ length: 20 }).map((_, i) => <Cell key={i} fill="var(--brand)" />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* B side */}
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{card.teamB}</div>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={computeHistogram(BStats[statKey] || [], 20)} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                        <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                        <XAxis dataKey="bin" interval={0} height={20} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
                          labelStyle={{ color: "var(--muted)" }}
                          itemStyle={{ color: "var(--text)" }}
                          formatter={(v: any) => [v, "Count"]}
                        />
                        <Bar dataKey="count" name={`${card.teamB} • ${statKey}`}>
                          {Array.from({ length: 20 }).map((_, i) => <Cell key={i} fill="var(--accent)" />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LiveStatsModal(props: {
  card: Card;
  livePayload: any;
  onClose: () => void;
}) {

  const [teamStats, setTeamStats] = useState<{
  A: { reb?: number; ast?: number; to?: number; stl?: number; blk?: number };
  B: { reb?: number; ast?: number; to?: number; stl?: number; blk?: number };
  }>({ A: {}, B: {} });


  const [leaders, setLeaders] = useState<{
  A: { pts?: {v:number; n:string}, reb?: {v:number; n:string}, ast?: {v:number; n:string} };
  B: { pts?: {v:number; n:string}, reb?: {v:number; n:string}, ast?: {v:number; n:string} };
  }>({ A: {}, B: {} });


  const { card, livePayload, onClose } = props;
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [meta, setMeta] = useState<{
    Aname: string; Bname: string;
    Alogo?: string; Blogo?: string;
  } | null>(null);

  const [rows, setRows] = useState<
    {
      label: string;
      A_pct: number; B_pct: number;
      A_m: number;  A_a: number;
      B_m: number;  B_a: number;
      Acolor?: string; Bcolor?: string;
    }[]
  >([]);

  // helpers
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const bestName = (o: any) =>
    o?.team?.displayName ??
    o?.team?.shortDisplayName ??
    o?.team?.name ??
    o?.displayName ??
    o?.abbreviation ??
    "";
  const firstLogo = (t: any) =>
    t?.logo ?? t?.logos?.[0]?.href ?? t?.logos?.[0]?.url ?? undefined;

  const toPct = (stats: any[], want: string, abbr: string) => {
    const s = (stats ?? []).find(
      (x: any) =>
        (x?.name ?? "").toLowerCase() === want.toLowerCase() ||
        (x?.abbreviation ?? "").toLowerCase() === abbr.toLowerCase()
    );
    const raw = (s?.displayValue ?? s?.value ?? "").toString();
    const num = Number(raw.replace(/[^\d.]/g, ""));
    return Number.isFinite(num) ? num : 0;
  };

  const toInt = (stats: any[], want: string, abbr: string) => {
    const s = (stats ?? []).find(
      (x: any) =>
        (x?.name ?? "").toLowerCase() === want.toLowerCase() ||
        (x?.abbreviation ?? "").toLowerCase() === abbr.toLowerCase()
    );
    const raw = (s?.displayValue ?? s?.value ?? "0").toString();
    const num = Math.round(Number(raw.replace(/[^\d.-]/g, "")));
    return Number.isFinite(num) ? num : 0;
  };

  useEffect(() => {
    setErr(null);
    setLoading(true);
    try {
      const events = livePayload?.events ?? livePayload?.items ?? [];
      if (!Array.isArray(events) || !events.length) throw new Error("No live events loaded.");

      const AID = card.A_espn_id ? String(card.A_espn_id) : undefined;
      const BID = card.B_espn_id ? String(card.B_espn_id) : undefined;

      let ev: any | undefined;

      if (AID || BID) {
        ev = events.find((e: any) => {
          const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
          const ids = comp.map((c: any) => String(c?.team?.id ?? ""));
          const hasA = AID ? ids.includes(AID) : true;
          const hasB = BID ? ids.includes(BID) : true;
          return hasA && hasB;
        });
      }
      if (!ev) {
        const Aname = norm(card.teamA);
        const Bname = norm(card.teamB);
        ev = events.find((e: any) => {
          const comp = e?.competitions?.[0]?.competitors ?? e?.competitors ?? [];
          const names = comp.flatMap((c: any) => [norm(bestName(c)), norm(c?.team?.abbreviation)]);
          const joined = names.join("|");
          return joined.includes(Aname) && joined.includes(Bname);
        });
      }
      if (!ev) throw new Error("Could not locate this game in live payload.");

      const comp = ev?.competitions?.[0]?.competitors ?? ev?.competitors ?? [];
      if (!Array.isArray(comp) || comp.length < 2) throw new Error("Missing competitor stats.");

      // Align to (teamA, teamB)
      let iA = 0, iB = 1;
      const name0 = norm(bestName(comp[0]));
      const name1 = norm(bestName(comp[1]));
      const Aname0 = norm(card.teamA);
      const Bname0 = norm(card.teamB);
      if (name0.includes(Bname0) || name1.includes(Aname0)) { iA = 1; iB = 0; }

      const cA = comp[iA], cB = comp[iB];

      // ---- Leaders (Pts/Reb/Ast) from competitors[*].leaders ----
      function pickLeader(team: any, key: string) {
        const L = team?.leaders ?? [];
        const bucket = L.find((x: any) => (x?.name ?? "").toLowerCase() === key);
        const top = bucket?.leaders?.[0];
        if (!top) return undefined;
        const v = Number(top.value ?? (top.displayValue ?? "").toString().replace(/[^\d.-]/g, ""));
        const n = top?.athlete?.shortName ?? top?.athlete?.displayName ?? "";
        return Number.isFinite(v) ? { v, n } : undefined;
      }

      const A_pts = pickLeader(cA, "points");
      const Ap_reb = pickLeader(cA, "rebounds");
      const Ap_ast = pickLeader(cA, "assists");

      const B_pts = pickLeader(cB, "points");
      const Bp_reb = pickLeader(cB, "rebounds");
      const Bp_ast = pickLeader(cB, "assists");

      setLeaders({
        A: { pts: A_pts, reb: Ap_reb, ast: Ap_ast },
        B: { pts: B_pts, reb: Bp_reb, ast: Bp_ast },
      });


      const Acolor = cA?.team?.color ? `#${cA.team.color}` : undefined;
      const Bcolor = cB?.team?.color ? `#${cB.team.color}` : undefined;

      const Astats = cA?.statistics ?? [];
      const Bstats = cB?.statistics ?? [];

      // ---- Team totals (Reb/Ast/TO/Stl/Blk) from competitors[*].statistics ----
      const A_reb = toInt(Astats, "rebounds", "REB");
      const B_reb = toInt(Bstats, "rebounds", "REB");

      const A_ast = toInt(Astats, "assists", "AST");
      const B_ast = toInt(Bstats, "assists", "AST");

      // const A_to  = toInt(Astats, "turnovers", "TO");
      // const B_to  = toInt(Bstats, "turnovers", "TO");

      // const A_stl = toInt(Astats, "steals", "STL");
      // const B_stl = toInt(Bstats, "steals", "STL");

      // const A_blk = toInt(Astats, "blocks", "BLK");
      // const B_blk = toInt(Bstats, "blocks", "BLK");

      setTeamStats({
        A: { reb: A_reb, ast: A_ast },
        B: { reb: B_reb, ast: B_ast },

      // setTeamStats({
      //   A: { reb: A_reb, ast: A_ast, to: A_to, stl: A_stl, blk: A_blk },
      //   B: { reb: B_reb, ast: B_ast, to: B_to, stl: B_stl, blk: B_blk },
      });


      // FG
      const A_fg_pct = toPct(Astats, "fieldGoalPct", "FG%");
      const B_fg_pct = toPct(Bstats, "fieldGoalPct", "FG%");
      const A_fgm = toInt(Astats, "fieldGoalsMade", "FGM");
      const A_fga = toInt(Astats, "fieldGoalsAttempted", "FGA");
      const B_fgm = toInt(Bstats, "fieldGoalsMade", "FGM");
      const B_fga = toInt(Bstats, "fieldGoalsAttempted", "FGA");

      // 3P
      const A_3p_pct = toPct(Astats, "threePointFieldGoalPct", "3P%");
      const B_3p_pct = toPct(Bstats, "threePointFieldGoalPct", "3P%");
      const A_3pm = toInt(Astats, "threePointFieldGoalsMade", "3PM");
      const A_3pa = toInt(Astats, "threePointFieldGoalsAttempted", "3PA");
      const B_3pm = toInt(Bstats, "threePointFieldGoalsMade", "3PM");
      const B_3pa = toInt(Bstats, "threePointFieldGoalsAttempted", "3PA");

      // FT
      const A_ft_pct = toPct(Astats, "freeThrowPct", "FT%");
      const B_ft_pct = toPct(Bstats, "freeThrowPct", "FT%");
      const A_ftm = toInt(Astats, "freeThrowsMade", "FTM");
      const A_fta = toInt(Astats, "freeThrowsAttempted", "FTA");
      const B_ftm = toInt(Bstats, "freeThrowsMade", "FTM");
      const B_fta = toInt(Bstats, "freeThrowsAttempted", "FTA");

      setMeta({
        Aname: card.teamA,
        Bname: card.teamB,
        Alogo: firstLogo(cA?.team),
        Blogo: firstLogo(cB?.team),
      });

      setRows([
        { label: "Field Goal %",  A_pct: A_fg_pct, B_pct: B_fg_pct, A_m: A_fgm, A_a: A_fga, B_m: B_fgm, B_a: B_fga, Acolor, Bcolor },
        { label: "Three Point %", A_pct: A_3p_pct, B_pct: B_3p_pct, A_m: A_3pm, A_a: A_3pa, B_m: B_3pm, B_a: B_3pa, Acolor, Bcolor },
        { label: "Free Throw %",  A_pct: A_ft_pct, B_pct: B_ft_pct, A_m: A_ftm, A_a: A_fta, B_m: B_ftm, B_a: B_fta, Acolor, Bcolor },
      ]);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [card, livePayload]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 560, maxWidth: "94vw", background: "white", borderRadius: 12, padding: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Live Team Shooting</div>
          <button onClick={onClose} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px" }}>
            Close
          </button>
        </div>

        {/* Team headers with logo + name */}
        {meta && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {meta.Alogo && <img src={meta.Alogo} alt={meta.Aname} style={{ width: 22, height: 22, objectFit: "contain" }} />}
              <div style={{ fontWeight: 700 }}>{meta.Aname}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
              <div style={{ fontWeight: 700, textAlign: "right" }}>{meta.Bname}</div>
              {meta.Blogo && <img src={meta.Blogo} alt={meta.Bname} style={{ width: 22, height: 22, objectFit: "contain" }} />}
            </div>
          </div>
        )}

        {loading && <div style={{ padding: 12, color: "var(--muted)" }}>Loading live stats…</div>}
        {err && <div style={{ padding: 12, color: "crimson" }}>{err}</div>}

        {!loading && !err && (
          <div style={{ display: "grid", gap: 16 }}>
            {rows.map((r) => (
              <div key={r.label}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{r.label}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Team A bar */}
                  <div>
                    <div style={{ height: 18, background: "#f1f5f9", borderRadius: 9999, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, r.A_pct)}%`, height: "100%", background: r.Acolor ?? "var(--brand)" }} />
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {r.A_pct.toFixed(1)}% &nbsp;–&nbsp; {r.A_m}/{r.A_a}
                    </div>
                  </div>

                  {/* Team B bar */}
                  <div>
                    <div style={{ height: 18, background: "#f1f5f9", borderRadius: 9999, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, r.B_pct)}%`, height: "100%", background: r.Bcolor ?? "var(--accent)" }} />
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, textAlign: "right" }}>
                      {r.B_pct.toFixed(1)}% &nbsp;–&nbsp; {r.B_m}/{r.B_a}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Team Leaders */}
            <div style={{ marginTop: 4, borderTop: "1px solid #eef2f7", paddingTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Team Leaders</div>

              {[
                { key: "pts", label: "Pts" },
                { key: "reb", label: "Reb" },
                { key: "ast", label: "Ast" },
              ].map(({ key, label }) => {
                const a = (leaders.A as any)?.[key];
                const b = (leaders.B as any)?.[key];
                return (
                  <div
                    key={key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      columnGap: 12,
                      rowGap: 6,
                      fontSize: 12,
                      color: "#334155",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ textAlign: "left" }}>
                      {a && (<span>{a.n} — <strong>{a.v}</strong> </span>)}
                    </div>

                    <div style={{ textAlign: "center", minWidth: 40, fontWeight: 600 }}>
                      {label}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      {b && (<span><strong>{b.v}</strong> — {b.n}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Team Stats */}
            <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Team Stats</div>

              {[
                { k: "reb", label: "Reb" },
                { k: "ast", label: "Ast" },
                // { k: "to",  label: "TO"  },
                // { k: "stl", label: "Stl" },
                // { k: "blk", label: "Blk" },
              ].map(({ k, label }) => {
                const a = (teamStats.A as any)?.[k];
                const b = (teamStats.B as any)?.[k];
                return (
                  <div
                    key={k}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      columnGap: 12,
                      rowGap: 6,
                      fontSize: 12,
                      color: "#334155",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ textAlign: "left" }}>{Number.isFinite(a) ? <strong>{a}</strong> : null}</div>
                    <div style={{ textAlign: "center", minWidth: 40, fontWeight: 600 }}>{label}</div>
                    <div style={{ textAlign: "right" }}>{Number.isFinite(b) ? <strong>{b}</strong> : null}</div>
                  </div>
                );
              })}
            </div>



          </div>
        )}
      </div>
    </div>
  );

}

/* --- WHY text --- */
function buildWhyParagraph(L: Card): Array<{ key?: string; phrase: string; z?: number; sign?: number }> {
  const out: Array<{ key?: string; phrase: string; z?: number; sign?: number }> = [];

  if (typeof L.whySummary === "string" && L.whySummary.trim()) {
    return [{ key: "why", phrase: L.whySummary.trim() }];
  }

  if (L.priors?.targets) {
    for (const [k, t] of Object.entries(L.priors.targets)) {
      const A = t.A?.mu, B = t.B?.mu;
      if (!Number.isFinite(A as number) || !Number.isFinite(B as number)) continue;
      const z = ((A as number) - (B as number)) / Math.max(1e-9, Math.sqrt((t.A?.sd ?? 0) ** 2 + (t.B?.sd ?? 0) ** 2));
      const sign = Math.sign(z);
      const noun = k.replace(/^y_/, "").replace(/_/g, " ").toUpperCase();
      const mag = Math.abs(z);
      const magTxt = mag >= 2 ? "a strong" : mag >= 1 ? "a clear" : "a slight";
      const phrase = `On ${noun}, model gives ${sign >= 0 ? L.teamA : L.teamB} ${magTxt} edge (z=${Math.abs(z).toFixed(2)}).`;
      out.push({ key: k, z: Math.abs(z), sign, phrase });
    }
  }

  if (Number.isFinite(L.medMargin as number) || Number.isFinite(L.medTotal as number)) {
    const z = Number.isFinite(L.medMargin as number) ? (L.medMargin as number) / 10 : 0;
    const sign = Math.sign(z);
    const mag = Math.abs(z);
    const magTxt = mag >= 2 ? "a strong" : mag >= 1 ? "a clear" : "a slight";
    const phrase = `Model projects ${sign >= 0 ? L.teamA : L.teamB} with ${magTxt} scoreboard edge (median margin ${Number(L.medMargin ?? 0).toFixed(1)}).`;
    out.push({ key: "margin", z: Math.abs(z), sign, phrase });
  }

  out.sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  return out;
}
