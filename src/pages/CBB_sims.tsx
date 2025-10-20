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

  // optional compact sims path (added by index)
  compactPath?: string;
};

type Card = GameRow & {
  projA?: number;
  projB?: number;
  mlTeam?: "A" | "B";
  mlProb?: number;
  mlFair?: string;
};

/* ---------------- helpers ---------------- */
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
  const width = (max - min) / B || 1; // avoid zero
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
  const [debug, setDebug] = useState(false);
  const [logoMode, setLogoMode] = useState<"primary" | "alt">("primary");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<GameRow[]>([]);
  const [error, setError] = useState<string | null>(null);

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
                };
              }
            } catch {}
          }

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

  const cards: Card[] = useMemo(() => {
    return rows
      .map((r) => {
        const { A, B } = computeAB(r.medTotal, r.medMargin);
        const projA = Number.isFinite(A as number) ? Math.round(A as number) : undefined;
        const projB = Number.isFinite(B as number) ? Math.round(B as number) : undefined;

        let mlTeam: "A" | "B" | undefined;
        let mlProb: number | undefined;
        if (Number.isFinite(r.pA as number)) {
          const pA = r.pA as number;
          mlTeam = pA >= 0.5 ? "A" : "B";
          mlProb = mlTeam === "A" ? pA : 1 - pA;
        }
        const mlFair = Number.isFinite(mlProb as number) ? americanOdds(mlProb as number) : "—";

        return { ...r, projA, projB, mlTeam, mlProb, mlFair };
      })
      .sort((x, y) => x.teamA.localeCompare(y.teamA));
  }, [rows]);

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
          {/* <button
            onClick={() => setDebug((d) => !d)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: debug ? "var(--brand)" : "var(--card)",
              color: debug ? "var(--brand-contrast)" : "var(--text)",
            }}
          >
            {debug ? "Debug: On" : "Debug: Off"}
          </button> */}

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

        {debug && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <b>Index URL (tries in order):</b>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              {indexUrls.map((u) => (
                <code key={u} style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: 6 }}>
                  {u}
                </code>
              ))}
            </div>
          </div>
        )}
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
  const mlTeamName = card.mlTeam === "A" ? card.teamA : card.mlTeam === "B" ? card.teamB : "—";
  const pillBg = "color-mix(in oklab, var(--brand) 12%, white)";

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

        // resolve compact URL
        const base = DATASET_ROOT.replace(/\/+$/, "");
        const compactFromIndex = card.compactPath ? `${base}/${card.compactPath.replace(/^\/+/, "")}` : undefined;
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
        const cols = Object.keys(aStats).filter((k) => Array.isArray(aStats[k]) && Array.isArray(bStats[k]));
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

  // line inputs
  const lineValSpread = useMemo(() => {
    const s = parseFloat(enteredSpread);
    return Number.isFinite(s) ? s : undefined;
  }, [enteredSpread]);
  const lineValTotal = useMemo(() => {
    const t = parseFloat(enteredTotal);
    return Number.isFinite(t) ? t : undefined;
  }, [enteredTotal]);

  // cover/total math from raw arrays
  const N = useMemo(() => Math.max(Apts.length, Bpts.length), [Apts, Bpts]);
  function pct(x: number) {
    return (100 * x) / Math.max(1, N);
  }
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

  // colors
  const leftColor = "var(--brand)";
  const rightColor = "var(--accent)";

  // logos
  const aLogo = logoMode === "primary" ? (card.aLogoPrimary || card.aLogoAlt) : (card.aLogoAlt || card.aLogoPrimary);
  const bLogo = logoMode === "primary" ? (card.bLogoPrimary || card.bLogoAlt) : (card.bLogoAlt || card.bLogoPrimary);

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
    <article
      className="card"
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        display: "grid",
        gridTemplateRows: "auto auto auto",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
        <span>sim day</span>
        <span>{card.updated ? new Date(card.updated).toLocaleString() : ""}</span>
      </div>

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
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Projected</div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Actual</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <img
            alt=""
            src={(logoMode === "primary" ? (aLogo || undefined) : (aLogo || undefined)) as any as string}
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: "contain", background: "var(--card)", border: "1px solid var(--border)" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.teamA}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>{Number.isFinite(card.projA as number) ? card.projA : "—"}</div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>{hasFinalA ? card.finalA : "—"}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <img
            alt=""
            src={(logoMode === "primary" ? (bLogo || undefined) : (bLogo || undefined)) as any as string}
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: "contain", background: "var(--card)", border: "1px solid var(--border)" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.teamB}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>{Number.isFinite(card.projB as number) ? card.projB : "—"}</div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>{hasFinalB ? card.finalB : "—"}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span
          style={{
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 999,
            background: pillBg,
            border: "1px solid var(--border)",
          }}
        >
          ML: Pick • {mlTeamName} {Number.isFinite(card.mlProb as number) ? `(${(card.mlProb as number * 100).toFixed(1)}%)` : ""} • Fair {card.mlFair}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
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
        <div style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8, fontSize: 13, lineHeight: 1.3 }}>
          {whyText.map((w, idx) => (
            <div key={w.key ?? idx} style={{ marginBottom: 6 }}>
              {w.phrase}
            </div>
          ))}
        </div>
      )}

      {showDist && (
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
                              metric === "teamA" ? leftColor :
                              metric === "teamB" ? rightColor :
                              metric === "total"
                                ? ((h.start + h.end) / 2) < (q?.med ?? 0) ? leftColor : rightColor
                                : ((h.start + h.end) / 2) < 0 ? leftColor : rightColor
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
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
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
                          <BarChart data={statHistLeft} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                            <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                            <XAxis
                              dataKey="bin"
                              interval={0}
                              height={20}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fontSize: 11 }}
                              ticks={statTicksLeft.ticks}
                              tickFormatter={statTicksLeft.fmt}
                            />
                            <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
                              labelStyle={{ color: "var(--muted)" }}
                              itemStyle={{ color: "var(--text)" }}
                              formatter={(v: any) => [v, "Count"]}
                            />
                            <Bar dataKey="count" name={`${card.teamA} • ${statKey}`}>
                              {statHistLeft.map((_, i) => <Cell key={i} fill={leftColor} />)}
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
                          <BarChart data={statHistRight} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                            <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                            <XAxis
                              dataKey="bin"
                              interval={0}
                              height={20}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fontSize: 11 }}
                              ticks={statTicksRight.ticks}
                              tickFormatter={statTicksRight.fmt}
                            />
                            <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
                              labelStyle={{ color: "var(--muted)" }}
                              itemStyle={{ color: "var(--text)" }}
                              formatter={(v: any) => [v, "Count"]}
                            />
                            <Bar dataKey="count" name={`${card.teamB} • ${statKey}`}>
                              {statHistRight.map((_, i) => <Cell key={i} fill={rightColor} />)}
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
      )}
    </article>
  );
}

function buildWhyParagraph(L: Card): Array<{ key?: string; phrase: string; z?: number; sign?: number }> {
  const out: Array<{ key?: string; phrase: string; z?: number; sign?: number }> = [];

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
    const phrase =
      `Model projects ${sign >= 0 ? L.teamA : L.teamB} with ${magTxt} edge on the scoreboard (median margin ${Number(L.medMargin ?? 0).toFixed(1)}).`;
    out.push({ key: "margin", z: Math.abs(z), sign, phrase });
  }

  out.sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  return out;
}
