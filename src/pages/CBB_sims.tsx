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

// Slightly tweaked label for hoops ("H1/H2" instead of "Q1/Q2")
function mapEspnToLiveGamesCbb(payload: any): LiveGame[] {
  const events = payload?.events ?? [];
  return events.map((e: any) => {
    const type = e?.status?.type ?? e?.competitions?.[0]?.status?.type ?? {};
    const comp = e?.competitions?.[0];
    const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
    const home = comp?.competitors?.find((c: any) => c.homeAway === "home");

    const period = comp?.status?.period ?? e?.status?.period;
    const clock  = comp?.status?.displayClock ?? e?.status?.displayClock;

    let state = String(type.state || "").toLowerCase();
    const name  = String(type.name || "").toUpperCase();
    const done  = Boolean(type.completed);
    if (done || name.includes("FINAL") || state === "post") state = "final";

    let statusText =
      type?.shortDetail || type?.detail || type?.description || "";
    if (state === "in") statusText = `H${period ?? "-"} ${clock ?? ""}`.trim();
    if (state === "final" && !statusText) statusText = "Final";

    // 🔴 CHANGE IS HERE:
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
      awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
      homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
      period: Number.isFinite(Number(period)) ? Number(period) : undefined,
      displayClock: typeof clock === "string" ? clock : undefined,
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
};

/* ---------------- helpers ---------------- */
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
  const livePayload = useLiveScoreboard(date, "cbb");

  useEffect(() => {
  console.log("CBB livePayload", livePayload);
  }, [livePayload]);

  const liveGames: LiveGame[] = useMemo(
    () => (livePayload ? mapEspnToLiveGamesCbb(livePayload) : []),
    [livePayload]
  );

  const liveMap = useMemo(() => {
    const m = new Map<string, LiveGame>();
    for (const g of liveGames) {
      m.set(pairKey(g.awayTeam, g.homeTeam), g);
    }
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

      const lg = liveMap.get(pairKey(r.teamA, r.teamB));
      console.log("JOIN", r.teamA, r.teamB, "=>", !!lg, lg?.awayScore, lg?.homeScore);

      if (lg) {
        liveState = lg.state;
        liveStatusText = lg.statusText;

        // Orient scores to A/B even if ESPN has them home/away
        const aMatchesAway = cleanTeamName(r.teamA) === cleanTeamName(lg.awayTeam);
        const aScore = aMatchesAway ? lg.awayScore : lg.homeScore;
        const bScore = aMatchesAway ? lg.homeScore : lg.awayScore;

        if (Number.isFinite(aScore as number)) liveScoreA = aScore as number;
        if (Number.isFinite(bScore as number)) liveScoreB = bScore as number;

        const elapsed = computeElapsedSecondsCbb(lg);
        if (
          typeof elapsed === "number" &&
          Number.isFinite(liveScoreA as number) &&
          Number.isFinite(liveScoreB as number)
        ) {
          const totalScore = (liveScoreA as number) + (liveScoreB as number);
          if (totalScore > 0) {
            const mult = CBB_REG_SECONDS / Math.max(elapsed, 1);
            liveElapsed = elapsed;
            liveTotalPace = totalScore * mult;
          }
        }
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

    return mapped.sort((a, b) => {
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
  }, [rows, sortKey, liveMap]);

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
          <GameCard key={c.gameId ?? `${c.teamA}__${c.teamB}`} card={c} logoMode={logoMode} />
        ))}
      </div>
    </div>
  );
}

/* =========================
 *  Card + WHY + Distributions
 * ========================= */

function GameCard({ card, logoMode }: { card: Card; logoMode: "primary" | "alt" }) {
  const [showWhy, setShowWhy] = useState(false);
  const [showDist, setShowDist] = useState(false);
  const [loadingDist, setLoadingDist] = useState(false);
  const [errDist, setErrDist] = useState<string | null>(null);

  const hasFinalA = Number.isFinite(card.finalA as number);
  const hasFinalB = Number.isFinite(card.finalB as number);
  const pillBg = "color-mix(in oklab, var(--brand) 12%, white)";

  const liveInProgress = card.liveState === "in";
  const showLiveA = liveInProgress && Number.isFinite(card.liveScoreA as number);
  const showLiveB = liveInProgress && Number.isFinite(card.liveScoreB as number);

  const displayScoreA = showLiveA
    ? (card.liveScoreA as number)
    : hasFinalA
    ? (card.finalA as number)
    : undefined;
  const displayScoreB = showLiveB
    ? (card.liveScoreB as number)
    : hasFinalB
    ? (card.finalB as number)
    : undefined;

  const hasPace =
    card.pickTotal &&
    Number.isFinite(card.liveTotalPace as number) &&
    card.liveState === "in";

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
      !Number.isFinite(card.liveTotalPace as number) ||
      !Number.isFinite(card.liveScoreA as number) ||
      !Number.isFinite(card.liveScoreB as number)
    ) {
      return null;
    }

    const scoreA = card.liveScoreA as number;
    const scoreB = card.liveScoreB as number;
    const totalNow = scoreA + scoreB;
    if (totalNow <= 0) return null;

    // This is the same multiplier we used to get total pace:
    // paceTotal = (scoreA + scoreB) * mult
    const mult = (card.liveTotalPace as number) / totalNow;

    // Projected final margin from team A's perspective
    const paceMarginA = (scoreA - scoreB) * mult; // A − B at end

    const betIsA = card.pickSpread.teamSide === "A";
    const paceMarginBet = betIsA ? paceMarginA : -paceMarginA; // margin from bet side POV

    const line = card.pickSpread.line;
    if (!Number.isFinite(line as number)) return null;

    // For the bet-side team, they cover if (marginBet > -line)
    const coverThreshold = -line;
    const coverDelta = paceMarginBet - coverThreshold; // >0 = ahead of cover, <0 = behind

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
  const [statKey, setStatKey] = useState<string>("");

  // UI controls
  type Metric = "spread" | "total" | "teamA" | "teamB";
  const [metric, setMetric] = useState<Metric>("spread");
  const [bins, setBins] = useState<number | "auto">("auto");
  const [enteredSpread, setEnteredSpread] = useState<string>("");
  const [spreadSide, setSpreadSide] = useState<"A" | "B">("A");
  const [enteredTotal, setEnteredTotal] = useState<string>("");

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

  // Only show Q1 / Median / Q3 labels on the X axis (main chart)
  const qTickInfo = useMemo(() => {
    if (!series.length || !hist.length)
      return { ticks: [] as string[], fmt: (_: string) => "" };
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
    const s = parseFloat(enteredSpread);
    return Number.isFinite(s) ? s : undefined;
  }, [enteredSpread]);
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
        border: liveInProgress ? "2px solid #ef4444" : "1px solid var(--border)",
        background: "var(--surface)",
        display: "grid",
        gridTemplateRows: "auto auto auto",
        gap: 8,
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        boxShadow: liveInProgress
          ? "0 0 0 1px rgba(239,68,68,0.2)"
          : "none",
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
          <div
            style={{
              fontWeight: 800,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.teamA}
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
          <div
            style={{
              fontWeight: 800,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.teamB}
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
    const s = parseFloat(enteredSpread);
    return Number.isFinite(s) ? s : undefined;
  }, [enteredSpread]);
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
      const margin = spreadSide === "A" ? (a - b) : (b - a);
      if (margin > line) cover++;
      else if (Math.abs(margin - line) < 1e-9) push++;
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
                <input
                  type="number"
                  step={0.5}
                  placeholder={spreadSide === "A" ? "-4.0" : "+4.0"}
                  value={enteredSpread}
                  onChange={(e) => setEnteredSpread(e.target.value)}
                  style={{ width: 100, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                />
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
