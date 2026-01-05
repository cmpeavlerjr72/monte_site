// ResultsCBB_alt.tsx
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Bar,
  Cell,
} from "recharts";

/* ---------- DATASET CONFIG ---------- */
const DATASET_ROOT =
  "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026";

/* ---------- TYPES ---------- */
type Market = "ml" | "spread" | "total";

/** Base win/loss/push container */
type Counts = { wins: number; losses: number; pushes: number; graded: number };

type ProfitMap = { spread: number; total: number; ml: number };
type RecordMap = { spread: Counts; total: Counts; ml: Counts };

type DailyAgg = {
  date: string;
  profit_units: ProfitMap;
  record: RecordMap;

  // Home/Away/Neutral per-day aggregates (optional; used for summary only)
  han_ml_all?: Record<SiteRoleKey, SiteBucket>;
  han_ml_pos_ev?: Record<SiteRoleKey, SiteBucket>;
  han_spread_all?: Record<SiteRoleKey, SiteBucket>;
  han_spread_pos_ev?: Record<SiteRoleKey, SiteBucket>;
};

type Bucket = {
  wins?: number;
  losses?: number;
  pushes?: number;
  bets_graded?: number;
  win_share?: number;
  profit_units?: number;
};

type FavDogML = {
  favorite?: Bucket;
  underdog?: Bucket;
  pos_ev_favorite?: Bucket;
  pos_ev_underdog?: Bucket;
};

type OverUnderTotals = {
  over?: Bucket;
  under?: Bucket;
  pos_ev_over?: Bucket;
  pos_ev_under?: Bucket;
};

type FavoriteUnderdogAgg = {
  ml?: FavDogML;
  spread?: FavDogML;
  total?: OverUnderTotals;
};

type SiteRoleKey =
  | "home_favorite"
  | "home_underdog"
  | "away_favorite"
  | "away_underdog"
  | "neutral_favorite"
  | "neutral_underdog";

type SiteBucket = {
  count?: number;
  W?: number;
  L?: number;
  P?: number;
  profit?: number;
  risk_units?: number;
  win_pct?: number | null;
  roi_per_bet?: number | null;
  roi_units?: number | null;
};

type HomeAwayNeutralByMarket = {
  all?: Record<SiteRoleKey, SiteBucket>;
  pos_ev?: Record<SiteRoleKey, SiteBucket>;
};

type HomeAwayNeutralAgg = {
  meta?: {
    season?: number;
    source?: string;
    skipped_games?: number;
    matched_games?: number;
  };
  by_market?: {
    ml?: HomeAwayNeutralByMarket;
    spread?: HomeAwayNeutralByMarket;
  };
};

type DailyJson = {
  date: string;
  counts?: { games_total?: number };

  /* Classic aggregates */
  aggregate?: {
    spread?: Bucket;
    total?: Bucket;
    ml?: Bucket;
  };

  /* +EV fallbacks by market (existing results behavior) */
  aggregate_pos_ev_any?: Bucket;
  aggregate_pos_ev_by_market?: {
    spread?: Record<string, Bucket>;
    total?: Record<string, Bucket>;
    ml?: Record<string, Bucket>;
  };

  /* Favorite/Underdog split aggregates */
  aggregate_favorite_underdog?: FavoriteUnderdogAgg;

  /* --------- TEAM TOTALS (NEW) --------- */
  team_totals_meta?: {
    default_price?: number;
    push_rule?: string;
  };

  // Per-game diagnostic info (optional)
  team_totals_per_game?: Record<
    string,
    {
      favorite_side?: "A" | "B";
      predicted_cover_side?: "favorite" | "underdog";
      implied_lines?: Record<"A" | "B", number>;
      sim_over_prob?: Record<"A" | "B", number>;
      nsims?: number;
    }
  >;

  // Overall aggregate
  aggregate_team_totals_overall?: Bucket;

  // By role+side (no correlation)
  aggregate_team_totals_by_role?: Record<
    "favorite_over" | "favorite_under" | "underdog_over" | "underdog_under",
    Bucket
  >;

  // Correlated splits based on predicted cover
  aggregate_team_totals_correlated?: {
    predicted_underdog_cover?: Record<
      "fav_under" | "fav_over" | "dog_under" | "dog_over",
      Bucket
    >;
    predicted_favorite_cover?: Record<
      "fav_under" | "fav_over" | "dog_under" | "dog_over",
      Bucket
    >;
  };

  /* Home/Away/Neutral splits */
  aggregate_home_away_neutral?: HomeAwayNeutralAgg;
};

/* ---------- UTILS ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYMD = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
};
const rangeYMD = (start: string, end: string) => {
  const out: string[] = [];
  let cur = fromYMD(start);
  const stop = fromYMD(end);
  while (cur <= stop) {
    out.push(toYMD(cur));
    cur = addDays(cur, 1);
  }
  return out;
};
const fmtUnits = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const fmtX = (ymd: string) =>
  fromYMD(ymd).toLocaleDateString(undefined, { month: "short", day: "2-digit" });

const siteRoleKeys: SiteRoleKey[] = [
  "home_favorite",
  "home_underdog",
  "away_favorite",
  "away_underdog",
  "neutral_favorite",
  "neutral_underdog",
];

const siteRoleLabels: Record<SiteRoleKey, string> = {
  home_favorite: "Home Fav",
  home_underdog: "Home Dog",
  away_favorite: "Away Fav",
  away_underdog: "Away Dog",
  neutral_favorite: "Neutral Fav",
  neutral_underdog: "Neutral Dog",
};

/* ---- Counts helpers ---- */
const toCounts = (c?: Partial<Counts>): Counts => ({
  wins: c?.wins ?? 0,
  losses: c?.losses ?? 0,
  pushes: c?.pushes ?? 0,
  graded: c?.graded ?? 0,
});
const emptyC: Counts = { wins: 0, losses: 0, pushes: 0, graded: 0 };
const addCounts = (a: Counts, b: Counts): Counts => ({
  wins: a.wins + b.wins,
  losses: a.losses + b.losses,
  pushes: a.pushes + b.pushes,
  graded: a.graded + b.graded,
});
const countsFromBucket = (b?: Bucket | null): Counts =>
  toCounts({
    wins: b?.wins ?? 0,
    losses: b?.losses ?? 0,
    pushes: b?.pushes ?? 0,
    graded: b?.bets_graded ?? 0,
  });

/* ---------- FAVORITE/UNDERDOG split helpers (classic markets) ---------- */
type Side3 = "all" | "favorite" | "underdog";
type TotSide3 = "all" | "over" | "under";

function profitAggregate(J: DailyJson, m: Market): number {
  return J.aggregate?.[m]?.profit_units ?? 0;
}
function recordAggregate(J: DailyJson, m: Market): Counts {
  return countsFromBucket(J.aggregate?.[m]);
}

function evFallbackProfit(J: DailyJson, m: Market): number {
  const inner = J.aggregate_pos_ev_by_market?.[m];
  if (!inner) return 0;
  return Object.values(inner).reduce((acc, v) => acc + (v?.profit_units ?? 0), 0);
}
function evFallbackRecord(J: DailyJson, m: Market): Counts {
  const inner = J.aggregate_pos_ev_by_market?.[m];
  if (!inner) return emptyC;
  return Object.values(inner).reduce(
    (acc, v) => addCounts(acc, countsFromBucket(v)),
    emptyC
  );
}

function mlProfitRecord(
  J: DailyJson,
  side: Side3,
  ev: boolean
): { profit: number | null; rec: Counts | null } {
  const src = J.aggregate_favorite_underdog?.ml;
  if (!src) return { profit: null, rec: null };
  if (side === "all") {
    if (!ev) return { profit: null, rec: null };
    return {
      profit:
        (src.pos_ev_favorite?.profit_units ?? 0) +
        (src.pos_ev_underdog?.profit_units ?? 0),
      rec: addCounts(
        countsFromBucket(src.pos_ev_favorite),
        countsFromBucket(src.pos_ev_underdog)
      ),
    };
  }
  if (side === "favorite")
    return {
      profit: (ev ? src.pos_ev_favorite : src.favorite)?.profit_units ?? 0,
      rec: countsFromBucket(ev ? src.pos_ev_favorite : src.favorite),
    };
  // underdog
  return {
    profit: (ev ? src.pos_ev_underdog : src.underdog)?.profit_units ?? 0,
    rec: countsFromBucket(ev ? src.pos_ev_underdog : src.underdog),
  };
}

function spProfitRecord(
  J: DailyJson,
  side: Side3,
  ev: boolean
): { profit: number | null; rec: Counts | null } {
  const src = J.aggregate_favorite_underdog?.spread;
  if (!src) return { profit: null, rec: null };
  if (side === "all") {
    if (!ev) return { profit: null, rec: null };
    return {
      profit:
        (src.pos_ev_favorite?.profit_units ?? 0) +
        (src.pos_ev_underdog?.profit_units ?? 0),
      rec: addCounts(
        countsFromBucket(src.pos_ev_favorite),
        countsFromBucket(src.pos_ev_underdog)
      ),
    };
  }
  if (side === "favorite")
    return {
      profit: (ev ? src.pos_ev_favorite : src.favorite)?.profit_units ?? 0,
      rec: countsFromBucket(ev ? src.pos_ev_favorite : src.favorite),
    };
  // underdog
  return {
    profit: (ev ? src.pos_ev_underdog : src.underdog)?.profit_units ?? 0,
    rec: countsFromBucket(ev ? src.pos_ev_underdog : src.underdog),
  };
}

function totProfitRecord(
  J: DailyJson,
  side: TotSide3,
  ev: boolean
): { profit: number | null; rec: Counts | null } {
  const src = J.aggregate_favorite_underdog?.total;
  if (!src) return { profit: null, rec: null };
  if (side === "all") {
    if (!ev) return { profit: null, rec: null };
    return {
      profit:
        (src.pos_ev_over?.profit_units ?? 0) +
        (src.pos_ev_under?.profit_units ?? 0),
      rec: addCounts(
        countsFromBucket(src.pos_ev_over),
        countsFromBucket(src.pos_ev_under)
      ),
    };
  }
  if (side === "over")
    return {
      profit: (ev ? src.pos_ev_over : src.over)?.profit_units ?? 0,
      rec: countsFromBucket(ev ? src.pos_ev_over : src.over),
    };
  // under
  return {
    profit: (ev ? src.pos_ev_under : src.under)?.profit_units ?? 0,
    rec: countsFromBucket(ev ? src.pos_ev_under : src.under),
  };
}

/* ---------- TEAM TOTALS helpers (Role/Side + Correlation) ---------- */
type TTCorrelation = "none" | "predicted_underdog_cover" | "predicted_favorite_cover";
type TTRole = "all" | "favorite" | "underdog";
type TTOUSide = "all" | "over" | "under";

function ttProfitRecord(
  J: DailyJson,
  role: TTRole,
  ou: TTOUSide,
  correlation: TTCorrelation
): { profit: number; rec: Counts } {
  const zero = { profit: 0, rec: emptyC };

  // Correlated branch: map Role+O/U to fav_over/fav_under/dog_over/dog_under
  if (correlation !== "none") {
    const src = J.aggregate_team_totals_correlated?.[correlation];
    if (!src) return zero;

    const keyFor = (
      r: TTRole,
      s: TTOUSide
    ): Array<"fav_under" | "fav_over" | "dog_under" | "dog_over"> => {
      if (r === "all" && s === "all")
        return ["fav_over", "fav_under", "dog_over", "dog_under"];
      if (r === "all" && s === "over") return ["fav_over", "dog_over"];
      if (r === "all" && s === "under") return ["fav_under", "dog_under"];
      if (r === "favorite" && s === "all") return ["fav_over", "fav_under"];
      if (r === "underdog" && s === "all") return ["dog_over", "dog_under"];
      const single =
        r === "favorite"
          ? s === "over"
            ? "fav_over"
            : "fav_under"
          : s === "over"
          ? "dog_over"
          : "dog_under";
      return [single];
    };

    const keys = keyFor(role, ou);
    const profit = keys.reduce(
      (acc, k) => acc + (src[k]?.profit_units ?? 0),
      0
    );
    const rec = keys
      .map((k) => countsFromBucket(src[k]))
      .reduce((acc, c) => addCounts(acc, c), emptyC);
    return { profit, rec };
  }

  // Non-correlated branch
  if (role === "all" && ou === "all") {
    const b = J.aggregate_team_totals_overall;
    return { profit: b?.profit_units ?? 0, rec: countsFromBucket(b) };
  }

  const byRole = J.aggregate_team_totals_by_role;
  if (!byRole) return zero;

  const keyMap: Record<
    string,
    Array<
      "favorite_over" | "favorite_under" | "underdog_over" | "underdog_under"
    >
  > = {
    all_over: ["favorite_over", "underdog_over"],
    all_under: ["favorite_under", "underdog_under"],
    favorite_all: ["favorite_over", "favorite_under"],
    underdog_all: ["underdog_over", "underdog_under"],
    favorite_over: ["favorite_over"],
    favorite_under: ["favorite_under"],
    underdog_over: ["underdog_over"],
    underdog_under: ["underdog_under"],
  };

  const key =
    role === "all" && ou !== "all"
      ? `all_${ou}`
      : role !== "all" && ou === "all"
      ? `${role}_all`
      : `${role}_${ou}`;

  const keys = keyMap[key] ?? [];
  const profit = keys.reduce(
    (acc, k) => acc + (byRole[k]?.profit_units ?? 0),
    0
  );
  const rec = keys
    .map((k) => countsFromBucket(byRole[k]))
    .reduce((acc, c) => addCounts(acc, c), emptyC);
  return { profit, rec };
}

/* ---------- FILTER STATE ---------- */
type FilterState = {
  // classic markets toggles
  useML: boolean;
  useSpread: boolean;
  useTotal: boolean;

  // favorite/underdog filters
  mlSide: Side3;
  mlEV: boolean;

  spSide: Side3;
  spEV: boolean;

  totSide: TotSide3;
  totEV: boolean;

  // team totals
  useTeamTotals: boolean;
  ttRole: TTRole;
  ttSide: TTOUSide;
  ttCorrelation: TTCorrelation;
};

const defaultFS: FilterState = {
  useML: true,
  useSpread: true,
  useTotal: true,

  mlSide: "all",
  mlEV: false,

  spSide: "all",
  spEV: false,

  totSide: "all",
  totEV: false,

  useTeamTotals: true, // on by default; toggle off if you prefer
  ttRole: "all",
  ttSide: "all",
  ttCorrelation: "none",
};

/* ---------- COMPONENT ---------- */
export default function ResultsCBB_alt() {
  /* dates */
  const today = useMemo(() => toYMD(new Date()), []);
  const thirtyAgo = useMemo(() => toYMD(addDays(new Date(), -30)), []);
  const [startDate, setStartDate] = useState(thirtyAgo);
  const [endDate, setEndDate] = useState(today);

  /* filters */
  const [fs, setFs] = useState<FilterState>(defaultFS);

  /* data */
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<
    (DailyAgg & { _sumProfit: number; _ttRec: Counts })[]
  >([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const dates = rangeYMD(startDate, endDate);
        const base = DATASET_ROOT.replace(/\/+$/, "");
        const pref = SEASON_PREFIX.replace(/^\/+|\/+$/g, "");

        const fetched = await Promise.all(
          dates.map(async (d) => {
            const url = `${base}/${pref}/days/${d}/daily_results.json`;
            try {
              const res = await fetch(url, { cache: "no-store" });
              if (!res.ok) throw new Error(String(res.status));
              const J: DailyJson = await res.json();

              const han = J.aggregate_home_away_neutral?.by_market;
              const han_ml_all = han?.ml?.all;
              const han_ml_pos_ev = han?.ml?.pos_ev;
              const han_spread_all = han?.spread?.all;
              const han_spread_pos_ev = han?.spread?.pos_ev;

              // --- Build profit + records for this day based on filters ---
              let profit_ml = 0;
              let profit_sp = 0;
              let profit_tot = 0;
              let profit_tt = 0;

              // ML
              if (fs.useML) {
                const result = mlProfitRecord(J, fs.mlSide, fs.mlEV);
                if (result.profit === null) {
                  // fallback to aggregate or +EV-any fallback
                  profit_ml = fs.mlEV
                    ? evFallbackProfit(J, "ml")
                    : profitAggregate(J, "ml");
                } else {
                  profit_ml = result.profit ?? 0;
                }
              }

              // Spread
              if (fs.useSpread) {
                const result = spProfitRecord(J, fs.spSide, fs.spEV);
                if (result.profit === null) {
                  profit_sp = fs.spEV
                    ? evFallbackProfit(J, "spread")
                    : profitAggregate(J, "spread");
                } else {
                  profit_sp = result.profit ?? 0;
                }
              }

              // Total
              if (fs.useTotal) {
                const result = totProfitRecord(J, fs.totSide, fs.totEV);
                if (result.profit === null) {
                  profit_tot = fs.totEV
                    ? evFallbackProfit(J, "total")
                    : profitAggregate(J, "total");
                } else {
                  profit_tot = result.profit ?? 0;
                }
              }

              // Team Totals
              let ttRec = emptyC;
              if (fs.useTeamTotals) {
                const t = ttProfitRecord(
                  J,
                  fs.ttRole,
                  fs.ttSide,
                  fs.ttCorrelation
                );
                profit_tt = t.profit;
                ttRec = t.rec;
              }

              const profit_units: ProfitMap = {
                spread: profit_sp,
                total: profit_tot,
                ml: profit_ml,
              };

              // Records for classic markets (for summary)
              const mlRecResolved = (() => {
                const r = mlProfitRecord(J, fs.mlSide, fs.mlEV).rec;
                if (r) return r;
                return fs.mlEV
                  ? evFallbackRecord(J, "ml")
                  : recordAggregate(J, "ml");
              })();

              const spRecResolved = (() => {
                const r = spProfitRecord(J, fs.spSide, fs.spEV).rec;
                if (r) return r;
                return fs.spEV
                  ? evFallbackRecord(J, "spread")
                  : recordAggregate(J, "spread");
              })();

              const totRecResolved = (() => {
                const r = totProfitRecord(J, fs.totSide, fs.totEV).rec;
                if (r) return r;
                return fs.totEV
                  ? evFallbackRecord(J, "total")
                  : recordAggregate(J, "total");
              })();

              const record: RecordMap = {
                spread: spRecResolved,
                total: totRecResolved,
                ml: mlRecResolved,
              };

              const totalProfitForDay =
                (fs.useML ? profit_ml : 0) +
                (fs.useSpread ? profit_sp : 0) +
                (fs.useTotal ? profit_tot : 0) +
                (fs.useTeamTotals ? profit_tt : 0);

              return {
                date: J.date || d,
                profit_units,
                record,
                han_ml_all,
                han_ml_pos_ev,
                han_spread_all,
                han_spread_pos_ev,
                _sumProfit: totalProfitForDay,
                _ttRec: ttRec,
              } as DailyAgg & { _sumProfit: number; _ttRec: Counts };
            } catch {
              // <-- swallow missing/non-OK day and ignore it
              return null;
            }
          })
        );

        const tidy = (
          fetched.filter(Boolean) as (DailyAgg & {
            _sumProfit: number;
            _ttRec: Counts;
          })[]
        ).sort((a, b) => a.date.localeCompare(b.date));

        if (alive) setDays(tidy);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to load daily results.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startDate, endDate, fs]);

  /* ----- Build candles (alt visual style) and summary ----- */
  const candles = useMemo(() => {
    let running = 0;
    return days.map((d) => {
      const dayProfit = d._sumProfit;

      const open = running;
      const close = running + dayProfit;
      running = close;

      const up = close >= open;
      const base = Math.min(open, close);
      const body = Math.abs(close - open);

      return { date: d.date, open, close, up, base, body, change: dayProfit };
    });
  }, [days]);

  const finalPnL = candles.length ? candles[candles.length - 1].close : 0;

  // Per-market + overall records (includes TT when enabled)
  const perMarket = useMemo(() => {
    const sum = (picker: (d: (typeof days)[number]) => Counts) =>
      days.reduce<Counts>((acc, d) => addCounts(acc, picker(d)), emptyC);

    const ml = fs.useML ? sum((d) => d.record.ml) : emptyC;
    const sp = fs.useSpread ? sum((d) => d.record.spread) : emptyC;
    const tot = fs.useTotal ? sum((d) => d.record.total) : emptyC;
    const tt = fs.useTeamTotals ? sum((d) => d._ttRec) : emptyC;

    const winPct = (c: Counts) => {
      const denom = c.wins + c.losses;
      return denom ? (c.wins / denom) * 100 : 0;
    };

    const overall = toCounts({
      wins: ml.wins + sp.wins + tot.wins + tt.wins,
      losses: ml.losses + sp.losses + tot.losses + tt.losses,
      pushes: ml.pushes + sp.pushes + tot.pushes + tt.pushes,
      graded: ml.graded + sp.graded + tot.graded + tt.graded,
    });

    return {
      ml: { counts: ml, pct: winPct(ml) },
      spread: { counts: sp, pct: winPct(sp) },
      total: { counts: tot, pct: winPct(tot) },
      teamTotals: { counts: tt, pct: winPct(tt) },
      overall: { counts: overall, pct: winPct(overall) },
    };
  }, [days, fs]);

  const hanSummary = useMemo(() => {
    const initAgg = () => ({
      bets: 0,
      W: 0,
      L: 0,
      P: 0,
      profit: 0,
      risk: 0,
    });

    type HanAgg = {
      bets: number;
      W: number;
      L: number;
      P: number;
      profit: number;
      risk: number;
    };

    type HanRow = {
      all: HanAgg;
      posEv: HanAgg;
    };

    const makeRow = (): HanRow => ({
      all: initAgg(),
      posEv: initAgg(),
    });

    const acc = (dest: HanAgg, src?: SiteBucket) => {
      if (!src) return;
      dest.bets += src.count ?? 0;
      dest.W += src.W ?? 0;
      dest.L += src.L ?? 0;
      dest.P += src.P ?? 0;
      dest.profit += src.profit ?? 0;
      dest.risk += src.risk_units ?? 0;
    };

    const base = {
      ml: {
        home_favorite: makeRow(),
        home_underdog: makeRow(),
        away_favorite: makeRow(),
        away_underdog: makeRow(),
        neutral_favorite: makeRow(),
        neutral_underdog: makeRow(),
      } as Record<SiteRoleKey, HanRow>,
      spread: {
        home_favorite: makeRow(),
        home_underdog: makeRow(),
        away_favorite: makeRow(),
        away_underdog: makeRow(),
        neutral_favorite: makeRow(),
        neutral_underdog: makeRow(),
      } as Record<SiteRoleKey, HanRow>,
    };

    for (const d of days) {
      const mlAll = d.han_ml_all;
      const mlPos = d.han_ml_pos_ev;
      const spAll = d.han_spread_all;
      const spPos = d.han_spread_pos_ev;

      for (const key of siteRoleKeys) {
        if (mlAll?.[key]) acc(base.ml[key].all, mlAll[key]);
        if (mlPos?.[key]) acc(base.ml[key].posEv, mlPos[key]);
        if (spAll?.[key]) acc(base.spread[key].all, spAll[key]);
        if (spPos?.[key]) acc(base.spread[key].posEv, spPos[key]);
      }
    }

    const roiPct = (a: HanAgg) =>
      a.risk > 0 ? (a.profit / a.risk) * 100 : 0;

    return {
      ml: base.ml,
      spread: base.spread,
      roiPct,
    };
  }, [days]);

  /* y domain (alt style) */
  const yStats = useMemo(() => {
    const vals = candles.flatMap((c) => [c.open, c.close]);
    const min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    const pad = Math.max(1, (max - min) * 0.08);
    return { min: min - pad, max: max + pad };
  }, [candles]);

  const recLine = (label: string, c: Counts, pct: number) =>
    `${label}: ${c.wins}-${c.losses}-${c.pushes} (Win%: ${fmtUnits(pct)}%)`;

  /* ---------- RENDER ---------- */
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28 }}>
          CBB Results — Candlestick
        </h1>
        <div style={{ marginTop: 6, color: "var(--muted)" }}>
          Each candle is daily profit (close − open). Green = positive; red =
          negative.
        </div>

        {/* Controls */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto 1fr",
            rowGap: 10,
            columnGap: 16,
            alignItems: "center",
            marginTop: 10,
          }}
        >
          {/* Dates */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Start</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>End</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Summary (now with Team Totals) */}
          <div
            style={{
              marginLeft: "auto",
              fontSize: 12,
              opacity: 0.9,
              textAlign: "right",
            }}
          >
            {loading ? (
              "Loading…"
            ) : err ? (
              <span style={{ color: "var(--accent)" }}>{err}</span>
            ) : (
              <>
                <div>{`Days: ${candles.length} · Final P&L: ${fmtUnits(
                  finalPnL
                )}u`}</div>
                <div style={{ marginTop: 2 }}>
                  {recLine(
                    "Overall",
                    perMarket.overall.counts,
                    perMarket.overall.pct
                  )}
                </div>
                <div style={{ marginTop: 2, opacity: fs.useML ? 1 : 0.5 }}>
                  {recLine(
                    "ML",
                    perMarket.ml.counts,
                    perMarket.ml.pct
                  )}
                </div>
                <div style={{ marginTop: 2, opacity: fs.useSpread ? 1 : 0.5 }}>
                  {recLine(
                    "Spread",
                    perMarket.spread.counts,
                    perMarket.spread.pct
                  )}
                </div>
                <div style={{ marginTop: 2, opacity: fs.useTotal ? 1 : 0.5 }}>
                  {recLine(
                    "Total",
                    perMarket.total.counts,
                    perMarket.total.pct
                  )}
                </div>
                <div
                  style={{ marginTop: 2, opacity: fs.useTeamTotals ? 1 : 0.5 }}
                >
                  {recLine(
                    "Team Totals",
                    perMarket.teamTotals.counts,
                    perMarket.teamTotals.pct
                  )}
                </div>
              </>
            )}
          </div>

          {/* Market toggles */}
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useML}
                onChange={(e) =>
                  setFs((p) => ({ ...p, useML: e.target.checked }))
                }
              />
              ML
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useSpread}
                onChange={(e) =>
                  setFs((p) => ({ ...p, useSpread: e.target.checked }))
                }
              />
              Spread
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useTotal}
                onChange={(e) =>
                  setFs((p) => ({ ...p, useTotal: e.target.checked }))
                }
              />
              Total
            </label>

            {/* Team Totals toggle */}
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.useTeamTotals}
                onChange={(e) =>
                  setFs((p) => ({ ...p, useTeamTotals: e.target.checked }))
                }
              />
              Team Totals
            </label>
          </div>
          <div />

          {/* ML dropdown + EV */}
          <div
            style={{
              gridColumn: "1 / span 3",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            <strong style={{ width: 52 }}>ML:</strong>
            <select
              value={fs.mlSide}
              onChange={(e) =>
                setFs((p) => ({ ...p, mlSide: e.target.value as Side3 }))
              }
            >
              <option value="all">All</option>
              <option value="favorite">Favorites</option>
              <option value="underdog">Underdog</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.mlEV}
                onChange={(e) =>
                  setFs((p) => ({ ...p, mlEV: e.target.checked }))
                }
              />
              +EV
            </label>
          </div>

          {/* Spread dropdown + EV */}
          <div
            style={{
              gridColumn: "1 / span 3",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            <strong style={{ width: 52 }}>Spread:</strong>
            <select
              value={fs.spSide}
              onChange={(e) =>
                setFs((p) => ({ ...p, spSide: e.target.value as Side3 }))
              }
            >
              <option value="all">All</option>
              <option value="favorite">Favorites</option>
              <option value="underdog">Underdog</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.spEV}
                onChange={(e) =>
                  setFs((p) => ({ ...p, spEV: e.target.checked }))
                }
              />
              +EV
            </label>
          </div>

          {/* Totals dropdown + EV */}
          <div
            style={{
              gridColumn: "1 / span 3",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
            }}
          >
            <strong style={{ width: 52 }}>Total:</strong>
            <select
              value={fs.totSide}
              onChange={(e) =>
                setFs((p) => ({ ...p, totSide: e.target.value as TotSide3 }))
              }
            >
              <option value="all">All</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={fs.totEV}
                onChange={(e) =>
                  setFs((p) => ({ ...p, totEV: e.target.checked }))
                }
              />
              +EV
            </label>
          </div>

          {/* Team Totals filters */}
          {fs.useTeamTotals && (
            <div
              style={{
                gridColumn: "1 / span 3",
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <strong style={{ width: 110 }}>Team Totals:</strong>

              {/* Role */}
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Role:
                <select
                  value={fs.ttRole}
                  onChange={(e) =>
                    setFs((p) => ({
                      ...p,
                      ttRole: e.target.value as TTRole,
                    }))
                  }
                >
                  <option value="all">All</option>
                  <option value="favorite">Favorite</option>
                  <option value="underdog">Underdog</option>
                </select>
              </label>

              {/* Side */}
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Side:
                <select
                  value={fs.ttSide}
                  onChange={(e) =>
                    setFs((p) => ({
                      ...p,
                      ttSide: e.target.value as TTOUSide,
                    }))
                  }
                >
                  <option value="all">All</option>
                  <option value="over">Over</option>
                  <option value="under">Under</option>
                </select>
              </label>

              {/* Correlation */}
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Correlation:
                <select
                  value={fs.ttCorrelation}
                  onChange={(e) =>
                    setFs((p) => ({
                      ...p,
                      ttCorrelation: e.target.value as TTCorrelation,
                    }))
                  }
                  title="When not 'None', Role & Side map to correlated keys: fav_over / fav_under / dog_over / dog_under"
                >
                  <option value="none">None</option>
                  <option value="predicted_underdog_cover">
                    Predicted Underdog Cover
                  </option>
                  <option value="predicted_favorite_cover">
                    Predicted Favorite Cover
                  </option>
                </select>
              </label>
            </div>
          )}
        </div>
      </section>

      {/* Chart (alt visual style) */}
      <section className="card" style={{ padding: 12 }}>
        {!candles.length && !loading && <div>No daily results in range.</div>}
        {err && <div style={{ color: "crimson" }}>{err}</div>}

        {!!candles.length && !err && (
          <div style={{ width: "100%", height: 480 }}>
            <ResponsiveContainer>
              <ComposedChart
                data={candles}
                margin={{ top: 10, right: 16, bottom: 4, left: 0 }}
                barCategoryGap="55%"
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                  tickFormatter={fmtX}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={66}
                  domain={[yStats.min, yStats.max]}
                  tickFormatter={(v) => fmtUnits(v)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 10 }}
                  formatter={(value: any, name: any) =>
                    name === "change"
                      ? [fmtUnits(value), "Day P&L"]
                      : [fmtUnits(value), name]
                  }
                  labelFormatter={(label: string, payload: any) => {
                    const r = payload?.[0]?.payload;
                    return r
                      ? `${fmtX(label)}  |  Open ${fmtUnits(
                          r.open
                        )} → Close ${fmtUnits(
                          r.close
                        )}  (Δ ${fmtUnits(r.change)})`
                      : label;
                  }}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                />

                {/* Candles: stacked base + body (no wicks) */}
                <Bar
                  dataKey="base"
                  stackId="body"
                  fill="transparent"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="body"
                  stackId="body"
                  barSize={14}
                  isAnimationActive={false}
                >
                  {candles.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.up ? "#16a34a" : "#ef4444"}
                      stroke={d.up ? "#0f7a33" : "#b92a2a"}
                      strokeWidth={0.6}
                      rx={3}
                      ry={3}
                    />
                  ))}
                </Bar>

                {/* Invisible “change” for tooltip */}
                <Bar dataKey="change" fill="transparent" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Home/Away/Neutral summary */}
      <section className="card" style={{ padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>
          Home / Away / Neutral breakdown
        </h2>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            marginBottom: 8,
          }}
        >
          Aggregated over the selected date range. Shows moneyline and spread
          results split by home/away/neutral and favorite/underdog.
        </div>

        {!candles.length && !loading && (
          <div style={{ fontSize: 12 }}>
            Select a date range with results to see this breakdown.
          </div>
        )}

        {!!candles.length && !loading && !err && (
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 24 }}
          >
            {/* Moneyline table */}
            <div
              style={{ flex: "1 1 260px", minWidth: 260 }}
            >
              <h3
                style={{ fontSize: 14, marginTop: 0, marginBottom: 6 }}
              >
                Moneyline
              </h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        paddingBottom: 4,
                      }}
                    >
                      Segment
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      Bets
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      W-L-P
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      Profit (u)
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      ROI%
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      +EV Bets
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      +EV Profit
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      +EV ROI%
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {siteRoleKeys.map((key) => {
                    const row = hanSummary.ml[key];
                    const all = row.all;
                    const pos = row.posEv;
                    const allRoi = hanSummary.roiPct(all);
                    const posRoi = hanSummary.roiPct(pos);

                    return (
                      <tr key={key}>
                        <td style={{ padding: "2px 4px" }}>
                          {siteRoleLabels[key]}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {all.bets}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {all.W}-{all.L}-{all.P}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(all.profit)}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(allRoi)}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {pos.bets}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(pos.profit)}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(posRoi)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Spread table */}
            <div
              style={{ flex: "1 1 260px", minWidth: 260 }}
            >
              <h3
                style={{ fontSize: 14, marginTop: 0, marginBottom: 6 }}
              >
                Spread
              </h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        paddingBottom: 4,
                      }}
                    >
                      Segment
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      Bets
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      W-L-P
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      Profit (u)
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      ROI%
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      +EV Bets
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      +EV Profit
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        paddingBottom: 4,
                      }}
                    >
                      +EV ROI%
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {siteRoleKeys.map((key) => {
                    const row = hanSummary.spread[key];
                    const all = row.all;
                    const pos = row.posEv;
                    const allRoi = hanSummary.roiPct(all);
                    const posRoi = hanSummary.roiPct(pos);

                    return (
                      <tr key={key}>
                        <td style={{ padding: "2px 4px" }}>
                          {siteRoleLabels[key]}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {all.bets}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {all.W}-{all.L}-{all.P}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(all.profit)}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(allRoi)}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {pos.bets}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(pos.profit)}
                        </td>
                        <td
                          style={{
                            padding: "2px 4px",
                            textAlign: "right",
                          }}
                        >
                          {fmtUnits(posRoi)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
