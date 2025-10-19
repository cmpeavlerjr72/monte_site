import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from "recharts";


/** CONFIG */
const DATASET_ROOT = "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026"; // remote season folder, e.g. 2026

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// pretty odds identical in output semantics to Scoreboard
function americanOdds(prob: number): string {
  if (!(prob > 0 && prob < 1)) return "—";
  if (Math.abs(prob - 0.5) < 1e-9) return "+100";
  if (prob > 0.5) return `-${Math.round((prob / (1 - prob)) * 100)}`;
  return `+${Math.round(((1 - prob) / prob) * 100)}`;
}

/* ---------------- helpers mirrored from Scoreboard ---------------- */
type HistBin = { bin: string; count: number; start: number; end: number };
function computeHistogram(values: number[], opts?: { bins?: number; binWidth?: number }): HistBin[] {
  if (!values.length) return [];
  const v = values.slice().sort((a,b)=>a-b);
  const n = v.length, min = v[0], max = v[n-1];
  const q1 = v[Math.floor(0.25*(n-1))], q3 = v[Math.floor(0.75*(n-1))];
  const iqr = Math.max(1e-6, q3-q1);
  let binWidth = opts?.binWidth || (max>min ? Math.max(2*iqr*Math.cbrt(1/n), 0.5) : 1);
  let bins = opts?.bins || Math.max(1, Math.ceil((max-min)/binWidth));
  if (opts?.bins && !opts?.binWidth && max>min) binWidth = (max-min)/bins;
  const start = Math.floor(min/binWidth)*binWidth;
  const end   = Math.ceil(max/binWidth)*binWidth;
  const edges:number[] = []; for (let x=start; x<=end+1e-9; x+=binWidth) edges.push(Number(x.toFixed(8)));
  const counts = new Array(edges.length-1).fill(0);
  for (const x of v) {
    let idx = Math.floor((x-start)/binWidth);
    if (idx<0) idx=0; if (idx>=counts.length) idx=counts.length-1;
    counts[idx]++;
  }
  return counts.map((c,i)=>{
    const s = edges[i], e = edges[i+1];
    return { bin: `${Number(s.toFixed(1))}–${Number(e.toFixed(1))}`, count:c, start:s, end:e };
  });
}
function findBinLabelForValue(hist: HistBin[], value: number | undefined) {
  if (!hist.length || !Number.isFinite(value as number)) return undefined;
  for (const h of hist) if ((value as number) >= h.start && (value as number) <= h.end + 1e-9) return h.bin;
  return undefined;
}
function quantiles(values: number[]) {
  if (!values.length) return null as null | { q1: number; med: number; q3: number };
  const v = values.slice().sort((a,b)=>a-b);
  const n = v.length;
  const at = (p:number) => {
    const idx = (n-1)*p; const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo===hi) return v[lo];
    const w = idx-lo; return v[lo]*(1-w)+v[hi]*w;
  }
  return { q1: at(0.25), med: at(0.5), q3: at(0.75) };
}

/* ---------------- loose pickers ---------------- */
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
type Priors = { game_id?: string; date?: string; A_slug?: string; B_slug?: string; model_version?: string; targets?: Record<string, PriTarget>; };

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
  pA?: number; // P(A wins) 0..1
  medMargin?: number; // A − B
  medTotal?: number;  // A + B
  p25Margin?: number; p75Margin?: number;
  p25Total?: number;  p75Total?: number;
  nsims?: number;
  updated?: string;
  finalA?: number;
  finalB?: number;

  // from priors.json
  priors?: Priors;
};

type Card = GameRow & {
  projA?: number;
  projB?: number;
  mlTeam?: "A" | "B";
  mlProb?: number;
  mlFair?: string;
};

/* ---------------- utilities ---------------- */
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
  // ./games/<gid>/summary.json  ->  ./games/<gid>/priors.json
  return s.replace(/\/summary\.json$/i, "/priors.json");
}
function inferParquetPath(summaryPath?: string) {
  if (!summaryPath) return undefined;
  const s = summaryPath.replace(/\/+$/, "");
  // ./games/<gid>/summary.json -> ./games/<gid>/sims.parquet
  return s.replace(/\/summary\.json$/i, "/sims.parquet");
}

/* ---------------- DuckDB-WASM singleton for Parquet ---------------- */
// at top of CBB_sims.tsx (or wherever getDuck lives)
import * as duckdb from "@duckdb/duckdb-wasm";
// ✅ use the bundle entrypoints (exported by the package)
import duckdbBundle from "@duckdb/duckdb-wasm/dist/bundles/duckdb.wasm";
import duckdbEhBundle from "@duckdb/duckdb-wasm/dist/bundles/duckdb-eh.wasm";

type Duck = { db: any; conn: any };
let duckSingleton: Duck | null = null;

async function getDuck(): Promise<Duck> {
  if (duckSingleton) return duckSingleton;

  // If you later enable COOP/COEP in Vite, this flips to the threaded (-eh) bundle automatically
  const useThreads = (self as any).crossOriginIsolated === true;
  const bundle = useThreads ? duckdbEhBundle : duckdbBundle;

  // Vite rewrites these relative URLs to same-origin assets
  const workerUrl = new URL(bundle.mainWorker, import.meta.url).toString();
  const mainModuleUrl = new URL(bundle.mainModule, import.meta.url).toString();
  const pthreadUrl = bundle.pthreadWorker
    ? new URL(bundle.pthreadWorker, import.meta.url).toString()
    : undefined;

  const worker = new Worker(workerUrl, { type: "module" });
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);

  await db.instantiate(mainModuleUrl, pthreadUrl);

  const conn = await db.connect();
  await conn.query(`
    INSTALL httpfs;
    LOAD httpfs;
    SET enable_http_metadata_cache = true;
    SET enable_http_parquet_cache = true;
  `);

  duckSingleton = { db, conn };
  return duckSingleton;
}


/* =========================================================
 *  Page
 * =======================================================*/
export default function CBBSims() {
  const [date, setDate] = useState(() => toYMD(new Date()));
  const [debug, setDebug] = useState(false);
  const [logoMode, setLogoMode] = useState<"primary"|"alt">("primary");
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

  // Load index (same behavior as before)
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
                pickStrLoose(r, ["A_kp_name","A_name","kp_name_A","A_name_kp","teamA","teama","team_a","A","home","A_slug","a_slug"]) ?? "";
              const teamB =
                pickStrLoose(r, ["B_kp_name","B_name","kp_name_B","B_name_kp","teamB","teamb","team_b","B","away","B_slug","b_slug"]) ?? "";
              if (!teamA || !teamB) return null;

              const summaryPath = pickStrLoose(r, ["summary_path", "summary", "summaryurl"]);
              const priorsPath = pickStrLoose(r, ["priors_path"]) ?? inferPriorsPath(summaryPath);
              const parquetPath = inferParquetPath(summaryPath);
              const gameId = pickStrLoose(r, ["game_id", "id"]);

              const Aname = pickStrLoose(r, ["A_kp_name","A_name","kp_name_A","A_name_kp"]) ?? teamA;
              const Bname = pickStrLoose(r, ["B_kp_name","B_name","kp_name_B","B_name_kp"]) ?? teamB;
              const aLogoPrimary = pickStrLoose(r, ["A_logo_primary","a_logo_primary"]) ?? null;
              const aLogoAlt     = pickStrLoose(r, ["A_logo_alt","a_logo_alt"]) ?? null;
              const bLogoPrimary = pickStrLoose(r, ["B_logo_primary","b_logo_primary"]) ?? null;
              const bLogoAlt     = pickStrLoose(r, ["B_logo_alt","b_logo_alt"]) ?? null;

              // summary fields
              const pA = pickNumLoose(r, ["pA","p_a","pA_win"]);
              const medMargin = pickNumLoose(r, ["median_margin","med_margin","medMargin"]);
              const medTotal  = pickNumLoose(r,  ["median_total","med_total","medTotal"]);
              const p25Margin = pickNumLoose(r, ["p25_margin"]) ?? undefined;
              const p75Margin = pickNumLoose(r, ["p75_margin"]) ?? undefined;
              const p25Total  = pickNumLoose(r,  ["p25_total"])  ?? undefined;
              const p75Total  = pickNumLoose(r,  ["p75_total"])  ?? undefined;
              const nsims     = pickNumLoose(r,  ["nsims","n_sims","count"]);
              const updated   = pickStrLoose(r,  ["updated","ts","timestamp"]);
              const finalA    = pickNumLoose(r,  ["finalA","final_a","A_final","a_final"]);
              const finalB    = pickNumLoose(r,  ["finalB","final_b","B_final","b_final"]);

              const out: GameRow & { parquetPath?: string } = {
                teamA: Aname, teamB: Bname, aLogoPrimary, aLogoAlt, bLogoPrimary, bLogoAlt,
                gameId, summaryPath, priorsPath,
                pA, medMargin, medTotal, p25Margin, p75Margin, p25Total, p75Total, nsims, updated, finalA, finalB,
                parquetPath,
              };
              return out;
            })
            .filter(Boolean) as GameRow[];

          if (!aborted) { setRows(tidy); setLoading(false); return; }
        } catch (err: any) {
          // try next url
        }
      }
      if (!aborted) { setLoading(false); setError("No index.json found for that date."); }
    }
    loadIndex();
    return () => { aborted = true; };
  }, [indexUrls]);

  const cards: Card[] = useMemo(() => {
    return rows.map((r) => {
      const { A, B } = computeAB(r.medTotal, r.medMargin);
      const mlTeam: "A" | "B" | undefined = Number.isFinite(r.pA as number) ? ((r.pA as number) >= 0.5 ? "A" : "B") : undefined;
      const mlProb = Number.isFinite(r.pA as number) ? (r.pA as number) : undefined;
      const mlFair = Number.isFinite(mlProb as number) ? americanOdds(mlProb as number) : undefined;
      return {
        ...r,
        projA: A, projB: B,
        mlTeam, mlProb, mlFair,
      };
    });
  }, [rows]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      {/* Header */}
      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28 }}>CBB Sims</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="date"
              value={date}
              onChange={(e)=>setDate(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
            />
            <button
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
            </button>

            <button
              onClick={() => setLogoMode(m => m === "primary" ? "alt" : "primary")}
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
        </div>
      </section>

      {/* Cards grid */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "stretch" }}>
        {cards.map((c) => (
          <GameCard key={c.gameId ?? `${c.teamA}__${c.teamB}`} card={c} logoMode={logoMode} />
        ))}
      </div>
    </div>
  );
}

/* =========================================================
 *  Card with WHY + new Distributions (parquet)
 * =======================================================*/
function GameCard({ card, logoMode }: { card: Card; logoMode: "primary"|"alt" }) {
  const [showWhy, setShowWhy] = useState(false);
  const hasFinalA = Number.isFinite(card.finalA as number);
  const hasFinalB = Number.isFinite(card.finalB as number);
  const mlTeamName = card.mlTeam === "A" ? card.teamA : card.mlTeam === "B" ? card.teamB : undefined;

  // ---------- NEW: sims.parquet distributions ----------
  const [showDist, setShowDist] = useState(false);
  const [loadingDist, setLoadingDist] = useState(false);
  const [errDist, setErrDist] = useState<string | null>(null);

  // series derived from parquet
  const [ptsLeft, setPtsLeft] = useState<number[]>([]);
  const [ptsRight, setPtsRight] = useState<number[]>([]);
  const [totals, setTotals] = useState<number[]>([]);
  const [spreads, setSpreads] = useState<number[]>([]);
  const [statColumns, setStatColumns] = useState<string[]>([]);
  const [statLeftMap, setStatLeftMap] = useState<Record<string, number[]>>({});
  const [statRightMap, setStatRightMap] = useState<Record<string, number[]>>({});

  // chart controls (mirrors Scoreboard’s UI)
  type Metric = "spread" | "total" | "teamLeft" | "teamRight";
  const [metric, setMetric] = useState<Metric>("spread");
  const [bins, setBins] = useState<number|"auto">("auto");
  const [teamLine, setTeamLine] = useState<string>("");
  const [statKey, setStatKey] = useState<string>("");

  const series = useMemo(() => {
    if (!ptsLeft.length) return [] as number[];
    if (metric === "teamLeft")  return ptsLeft;
    if (metric === "teamRight") return ptsRight;
    if (metric === "total")     return totals;
    return spreads; // spread = right-left (same convention as Scoreboard)【turn1file3†L41-L45】
  }, [metric, ptsLeft, ptsRight, totals, spreads]);

  const qScore = useMemo(() => quantiles(series), [series]);
  const hist = useMemo(() => {
    if (!series.length) return [] as HistBin[];
    const opts:any = {}; if (bins!=="auto") opts.bins = Math.max(1, Number(bins));
    return computeHistogram(series, opts); //【turn1file2†L9-L13】
  }, [series, bins]);

  const scoreTickLabels = useMemo(()=>{
    if (!hist.length || !qScore) return {q1Label:undefined, medLabel:undefined, q3Label:undefined};
    return {
      q1Label: findBinLabelForValue(hist, qScore.q1),
      medLabel: findBinLabelForValue(hist, qScore.med),
      q3Label: findBinLabelForValue(hist, qScore.q3),
    };
  }, [hist, qScore]);

  const teamProb = useMemo(() => {
    if (!series.length) return null as null | { under:number; at:number; over:number; line:number };
    const L = Number(teamLine); if (!Number.isFinite(L)) return null;
    let u=0,a=0,o=0; for (const x of series) { if (Math.abs(x-L)<1e-9) a++; else if (x<L) u++; else o++; }
    const n = series.length;
    return { under:u/n, at:a/n, over:o/n, line:L };
  }, [series, teamLine]);

  const lineBinLabel = useMemo(() => (teamProb && hist.length ? findBinLabelForValue(hist, teamProb.line) : undefined), [teamProb, hist]);

  // bar colors r.e. metric (mirrors Scoreboard’s color logic)【turn1file4†L18-L37】
  const leftColor  = "var(--brand)";    // you can wire team colors here if desired
  const rightColor = "var(--accent)";
  const binColors = useMemo(() => {
    if (!hist.length) return [] as string[];
    if (metric === "spread") {
      return hist.map(h => {
        const mid = (h.start + h.end) / 2;
        if (mid < 0) return leftColor;
        if (mid > 0) return rightColor;
        return "var(--border)";
      });
    }
    if (metric === "total") {
      const med = qScore?.med ?? 0;
      return hist.map(h => ((h.start + h.end) / 2) < med ? leftColor : rightColor);
    }
    if (metric === "teamLeft")  return hist.map(() => leftColor);
    if (metric === "teamRight") return hist.map(() => rightColor);
    return hist.map(() => "var(--brand)");
  }, [hist, metric, qScore?.med]);

  // Team Stats panel series
  const statLeft = statKey && statLeftMap[statKey] ? statLeftMap[statKey] : [];
  const statRight = statKey && statRightMap[statKey] ? statRightMap[statKey] : [];
  const statHistLeft = useMemo(() => computeHistogram(statLeft, { bins: 20 }), [statLeft]);
  const statHistRight = useMemo(() => computeHistogram(statRight, { bins: 20 }), [statRight]);

  // lazy-load parquet when the panel is first opened
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!showDist || loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        setLoadingDist(true);
        setErrDist(null);

        // figure URL to sims.parquet
        const base = DATASET_ROOT.replace(/\/+$/, "");
        const pref = SEASON_PREFIX.replace(/^\/+|\/+$/g, "");
        // prefer summaryPath-based inference; else build from gameId if provided
        const parquetUrl =
          (card as any).parquetPath
            ? `${base}/${(card as any).parquetPath!.replace(/^\/+/, "").replace(/^\.\//, "")}`
            : (card.summaryPath
                ? `${base}/${inferParquetPath(card.summaryPath)!.replace(/^\/+/, "").replace(/^\.\//, "")}`
                : (card.gameId ? `${base}/${pref}/days/${toYMD(new Date(card.updated ?? ""))}/games/${card.gameId}/sims.parquet` : undefined));

        if (!parquetUrl) { setErrDist("No sims.parquet path available."); setLoadingDist(false); return; }

        const duck = await getDuck();
        // read remote parquet directly
        // Expect columns similar to your CSV sims: team, opp, pts, opp_pts, and optional numeric team stats
        const tbl = await duck.conn.query(`
          SELECT *
          FROM read_parquet('${parquetUrl}')
        `);

        const cols: string[] = tbl.schema.fields.map((f:any)=>f.name);
        const haveTeam = cols.includes("team") && cols.includes("opp");
        const havePts  = cols.includes("pts") && cols.includes("opp_pts");
        if (!haveTeam || !havePts) {
          setErrDist("sims.parquet missing expected columns (team, opp, pts, opp_pts).");
          setLoadingDist(false);
          return;
        }

        const rows: { team:string; opp:string; pts:number; opp_pts:number }[] = [];
        for (let i=0;i<tbl.numRows;i++){
          const r:any = {};
          for (let j=0;j<tbl.schema.fields.length;j++){
            r[tbl.schema.fields[j].name] = tbl.get(i, j);
          }
          if (r.team!=null && r.opp!=null && Number.isFinite(r.pts) && Number.isFinite(r.opp_pts)) {
            rows.push({ team:String(r.team), opp:String(r.opp), pts:Number(r.pts), opp_pts:Number(r.opp_pts) });
          }
        }

        // Normalize to (Left=A, Right=B) orientation just like Scoreboard
        const A = card.teamA, B = card.teamB;
        const Apts: number[] = [];
        const Bpts: number[] = [];
        for (const r of rows) {
          if (r.team === A && r.opp === B) { Apts.push(r.pts); Bpts.push(r.opp_pts); }
          else if (r.team === B && r.opp === A) { Apts.push(r.opp_pts); Bpts.push(r.pts); }
        }
        const totalsV = Apts.map((x,i)=>x + Bpts[i]);
        const spreadsV = Bpts.map((x,i)=>x - Apts[i]); // (Right − Left), matches Scoreboard【turn1file3†L43-L45】

        setPtsLeft(Apts);
        setPtsRight(Bpts);
        setTotals(totalsV);
        setSpreads(spreadsV);

        // Discover numeric team-level stat columns (exclude pts/opp_pts and ids)
        const numericCols = cols.filter(c => !["team","opp","pts","opp_pts"].includes(c));
        const sampleRow = (i:number) => {
          const r:any = {};
          for (let j=0;j<tbl.schema.fields.length;j++){
            r[tbl.schema.fields[j].name] = tbl.get(i, j);
          }
          return r;
        };
        const numericGuess = numericCols.filter(c => {
          for (let i=0;i<Math.min(50, tbl.numRows); i++) {
            const v = sampleRow(i)[c];
            if (v == null) continue;
            if (typeof v === "number" && Number.isFinite(v)) return true;
          }
          return false;
        });

        // split per team orientation for each numeric stat
        const leftStatMap: Record<string, number[]> = {};
        const rightStatMap: Record<string, number[]> = {};
        for (const k of numericGuess) { leftStatMap[k] = []; rightStatMap[k] = []; }

        for (let i=0;i<tbl.numRows;i++){
          const r = sampleRow(i);
          const isAB = r.team === A && r.opp === B;
          const isBA = r.team === B && r.opp === A;
          if (!isAB && !isBA) continue;
          for (const k of numericGuess) {
            const v = r[k];
            if (typeof v !== "number" || !Number.isFinite(v)) continue;
            if (isAB) { leftStatMap[k].push(v); }
            else { rightStatMap[k].push(v); } // BA row belongs to team B on the right
          }
        }

        setStatColumns(numericGuess.sort());
        setStatLeftMap(leftStatMap);
        setStatRightMap(rightStatMap);
        if (numericGuess.length && !statKey) setStatKey(numericGuess[0]);

        setLoadingDist(false);
      } catch (e:any) {
        setErrDist(e?.message || "Failed to load sims.parquet.");
        setLoadingDist(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDist]);

  // WHY text (unchanged, uses priors if present)
  const whyText = useMemo(() => buildWhyParagraph(card), [card]);

  // logos
  const aLogo = logoMode==="primary" ? (card.aLogoPrimary || card.aLogoAlt) : (card.aLogoAlt || card.aLogoPrimary);
  const bLogo = logoMode==="primary" ? (card.bLogoPrimary || card.bLogoAlt) : (card.bLogoAlt || card.bLogoPrimary);

  return (
    <article className="card" style={{ padding: 12 }}>
      {/* header line */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth:0 }}>
          {aLogo && <img src={aLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />}
          <b style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{card.teamA}</b>
          <span style={{ opacity: .6 }}>vs</span>
          <b style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{card.teamB}</b>
          {bLogo && <img src={bLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />}
        </div>

        <span style={{ marginLeft: "auto", fontSize: 12, opacity: .8 }}>
          {Number.isFinite(card.projA as number) && Number.isFinite(card.projB as number)
            ? <>Projected: {Math.round(card.projA!)}–{Math.round(card.projB!)}</>
            : <>Projected: —</>}
          {mlTeamName && typeof card.mlProb === "number" && typeof card.mlFair === "string" && (
            <> • {mlTeamName} ML {(card.mlProb*100).toFixed(1)}% • Fair {card.mlFair}</>
          )}
        </span>
      </div>

      {/* actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button
          onClick={() => setShowWhy((s) => !s)}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background: showWhy ? "var(--brand)" : "var(--card)", color: showWhy ? "var(--brand-contrast)" : "var(--text)" }}
        >
          {showWhy ? "Hide WHY" : "Show WHY"}
        </button>

        <button
          onClick={() => setShowDist((s)=>!s)}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background: showDist ? "var(--brand)" : "var(--card)", color: showDist ? "var(--brand-contrast)" : "var(--text)" }}
        >
          {showDist ? "Hide Distributions" : "Show Distributions"}
        </button>
      </div>

      {/* WHY panel */}
      {showWhy && (
        <div style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8, fontSize: 13, lineHeight: 1.3 }}>
          {whyText.map((w, idx) => (
            <div key={w.key ?? idx} style={{ marginBottom: 6 }}>{w.phrase}</div>
          ))}
        </div>
      )}

      {/* Distributions panel */}
      {showDist && (
        <div style={{ marginTop: 10 }}>
          {loadingDist && <div style={{ opacity:.8 }}>Loading sims.parquet…</div>}
          {errDist && <div style={{ color:"var(--accent)" }}>{errDist}</div>}

          {!loadingDist && !errDist && !!ptsLeft.length && (
            <>
              {/* Score distributions (Spread/Total/Team) — mirrors Scoreboard hist panel */}
              <div className="card" style={{ padding: 8 }}>
                <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
                  <select value={metric} onChange={e=>setMetric(e.target.value as any)}
                          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                    <option value="spread">Spread (Right − Left)</option>
                    <option value="total">Total</option>
                    <option value="teamLeft">{card.teamA} points</option>
                    <option value="teamRight">{card.teamB} points</option>
                  </select>
                  <span style={{ fontSize:12, color:"var(--muted)" }}>Bins:</span>
                  <input type="number" value={bins==="auto" ? "" : String(bins)} placeholder="auto"
                         onChange={e=>setBins(e.target.value==="" ? "auto" : Math.max(1, Number(e.target.value)))}
                         style={{ width:70, padding:"6px 8px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }} />
                  <span style={{ fontSize:12, color:"var(--muted)" }}>Line:</span>
                  <input type="number" step={0.5} value={teamLine} onChange={e=>setTeamLine(e.target.value)}
                         style={{ width:90, padding:"6px 8px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }} />
                </div>

                {/* Histogram */}
                <div style={{ height: 200, marginTop: 6 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hist} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                      <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                      <XAxis
                        dataKey="bin" interval={0} height={20} tickLine={false} axisLine={false} tick={{ fontSize: 11 }}
                        tickFormatter={(label: string) => {
                          if (!qScore) return "";
                          const { q1Label, medLabel, q3Label } = scoreTickLabels;
                          if (label === q1Label) return qScore.q1.toFixed(1);
                          if (label === medLabel) return qScore.med.toFixed(1);
                          if (label === q3Label) return qScore.q3.toFixed(1);
                          return "";
                        }}
                      />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                        labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                        formatter={(v:any)=>[v,"Count"]}
                      />
                      {teamProb && lineBinLabel && (
                        <ReferenceLine x={lineBinLabel} ifOverflow="extendDomain" stroke="var(--accent)" strokeDasharray="4 4"
                          label={{ value:`Line ${teamProb.line}`, position:"top", fontSize:11, fill:"var(--accent)" }} />
                      )}
                      <Bar dataKey="count" name={
                        metric==="spread" ? "Spread (R−L)"
                        : metric==="total" ? "Total"
                        : metric==="teamLeft" ? `${card.teamA} points`
                        : `${card.teamB} points`
                      }>
                        {hist.map((_,i)=><Cell key={i} fill={binColors[i] || "var(--brand)"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Probabilities vs Line */}
                {teamProb && (
                  <div className="card" style={{ marginTop:6, padding:8, fontSize:13 }}>
                    <b>Probability vs Line</b>
                    <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                      <span><b>Under</b>: {(teamProb.under*100).toFixed(1)}% ({americanOdds(teamProb.under)})</span>
                      <span><b>At</b>: {(teamProb.at*100).toFixed(1)}%</span>
                      <span><b>Over</b>: {(teamProb.over*100).toFixed(1)}% ({americanOdds(teamProb.over)})</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Team stats distributions (mirrors Scoreboard player layout but team-level) */}
              <div className="card" style={{ padding: 8, marginTop: 10 }}>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                  <b>Team Stats</b>
                  <select value={statKey} onChange={e=>setStatKey(e.target.value)}
                          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--card)" }}>
                    {statColumns.length ? statColumns.map(k => <option key={k} value={k}>{k}</option>) : <option>—</option>}
                  </select>
                </div>

                {!statKey || (!statLeft.length && !statRight.length) ? (
                  <div style={{ height:160, display:"grid", placeItems:"center", opacity:.7, marginTop:6 }}>
                    No team stats detected in sims.parquet.
                  </div>
                ) : (
                  <>
                    <div style={{ display:"grid", gap:10, gridTemplateColumns:"1fr 1fr", marginTop:6 }}>
                      {/* Left team */}
                      <div>
                        <div style={{ fontSize:12, opacity:.8, marginBottom:4 }}>{card.teamA}</div>
                        <div style={{ height: 180 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={statHistLeft} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                              <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                              <XAxis dataKey="bin" interval={0} height={20} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                              <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                              <Tooltip
                                contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                                labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                                formatter={(v:any)=>[v,"Count"]}
                              />
                              <Bar dataKey="count" name={`${card.teamA} • ${statKey}`}>
                                {statHistLeft.map((_,i)=><Cell key={i} fill={"var(--brand)"} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Right team */}
                      <div>
                        <div style={{ fontSize:12, opacity:.8, marginBottom:4 }}>{card.teamB}</div>
                        <div style={{ height: 180 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={statHistRight} margin={{ top: 6, right: 12, left: 0, bottom: 12 }}>
                              <CartesianGrid stroke="var(--border)" strokeOpacity={0.25} />
                              <XAxis dataKey="bin" interval={0} height={20} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                              <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                              <Tooltip
                                contentStyle={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}
                                labelStyle={{ color:"var(--muted)" }} itemStyle={{ color:"var(--text)" }}
                                formatter={(v:any)=>[v,"Count"]}
                              />
                              <Bar dataKey="count" name={`${card.teamB} • ${statKey}`}>
                                {statHistRight.map((_,i)=><Cell key={i} fill={"var(--accent)"} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/* ---------------- WHY/priors explainer ---------------- */
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

  return out.sort((a,b) => (b.z ?? 0) - (a.z ?? 0));
}
