import { useEffect, useMemo, useState } from "react";

/** CONFIG */
const DATASET_ROOT = "https://huggingface.co/datasets/mvpeav/cbb-sims-2026/resolve/main";
const SEASON_PREFIX = "2026"; // remote season folder, e.g. 2026

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// replace the whole function
function americanOdds(prob: number): string {
  if (!(prob > 0 && prob < 1)) return "—";
  if (Math.abs(prob - 0.5) < 1e-9) return "+100";
  if (prob > 0.5) {
    // favorite: negative odds
    return `-${Math.round((prob / (1 - prob)) * 100)}`;
  }
  // dog: positive odds
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
  pA?: number; // P(A wins) 0..1
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
};

type Card = GameRow & {
  projA?: number;
  projB?: number;
  mlTeam?: "A" | "B";
  mlProb?: number;
  mlFair?: string;
};

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
  // .../games/<gid>/summary.json  ->  .../games/<gid>/priors.json
  return s.replace(/\/summary\.json$/i, "/priors.json");
}

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
                pickStrLoose(r, ["A_kp_name","A_name","kp_name_A","A_name_kp","teamA","teama","team_a","A","home","A_slug","a_slug"]) ?? "";
              const teamB =
                pickStrLoose(r, ["B_kp_name","B_name","kp_name_B","B_name_kp","teamB","teamb","team_b","B","away","B_slug","b_slug"]) ?? "";
              if (!teamA || !teamB) return null;

              const summaryPath = pickStrLoose(r, ["summary_path", "summary", "summaryurl"]);
              const priorsPath = pickStrLoose(r, ["priors_path"]) ?? inferPriorsPath(summaryPath);
              const gameId = pickStrLoose(r, ["game_id", "id"]);

              const Aname = pickStrLoose(r, ["A_kp_name","A_name","kp_name_A","A_name_kp"]) ?? teamA;
              const Bname = pickStrLoose(r, ["B_kp_name","B_name","kp_name_B","B_name_kp"]) ?? teamB;
              const aLogoPrimary = pickStrLoose(r, ["A_logo_primary","a_logo_primary"]) ?? null;
              const aLogoAlt     = pickStrLoose(r, ["A_logo_alt","a_logo_alt"]) ?? null;
              const bLogoPrimary = pickStrLoose(r, ["B_logo_primary","b_logo_primary"]) ?? null;
              const bLogoAlt     = pickStrLoose(r, ["B_logo_alt","b_logo_alt"]) ?? null;

              return { teamA: Aname, teamB: Bname, summaryPath, priorsPath, gameId, aLogoPrimary, aLogoAlt, bLogoPrimary, bLogoAlt } as GameRow;
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
        setError("Could not load index.json for that date.");
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
                  nsims: pickNumLoose(s, ["nsims","n_sims","n"]),
                  updated: pickStrLoose(s, ["updated","timestamp","ts"]),
                  finalA: pickNumLoose(s, ["finalA","final_a","final_home"]),
                  finalB: pickNumLoose(s, ["finalB","final_b","final_away"]),
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
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--card)",
            }}
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

/** =========================
 *  Card + Why builder
 *  ========================= */
function GameCard({ card, logoMode }: { card: Card; logoMode: "primary"|"alt" }) {
  const [showWhy, setShowWhy] = useState(false);
  const hasFinalA = Number.isFinite(card.finalA as number);
  const hasFinalB = Number.isFinite(card.finalB as number);
  const mlTeamName = card.mlTeam === "A" ? card.teamA : card.mlTeam === "B" ? card.teamB : "—";
  const pillBg = "color-mix(in oklab, var(--brand) 12%, white)";

  const whyText = buildWhyParagraph(card);

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
            src={(logoMode==="primary" ? (card.aLogoPrimary||undefined) : (card.aLogoAlt||undefined)) || undefined as any as string}
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: "contain", background: "var(--card)", border: "1px solid var(--border)" }}
            onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display="none"; }}
          />
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.teamA}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
          {Number.isFinite(card.projA as number) ? card.projA : "—"}
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
          {hasFinalA ? card.finalA : "—"}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <img
            alt=""
            src={(logoMode==="primary" ? (card.bLogoPrimary||undefined) : (card.bLogoAlt||undefined)) || undefined as any as string}
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: "contain", background: "var(--card)", border: "1px solid var(--border)" }}
            onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display="none"; }}
          />
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.teamB}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
          {Number.isFinite(card.projB as number) ? card.projB : "—"}
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
          {hasFinalB ? card.finalB : "—"}
        </div>
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
    </article>
  );
}

function buildWhyParagraph(L: Card): Array<{ key?: string; phrase: string; z?: number; sign?: number }> {
  const out: Array<{ key?: string; phrase: string; z?: number; sign?: number }> = [];

  // Examples: we can derive why from priors if present (simple illustrative copy using available fields)
  if (L.priors?.targets) {
    for (const [k, t] of Object.entries(L.priors.targets)) {
      const A = t.A?.mu, B = t.B?.mu;
      if (!Number.isFinite(A as number) || !Number.isFinite(B as number)) continue;
      const z = ((A as number) - (B as number)) / Math.max(1e-9, Math.sqrt((t.A?.sd ?? 0) ** 2 + (t.B?.sd ?? 0) ** 2));
      const sign = Math.sign(z);
      const noun = k.replace(/^y_/, "").replace(/_/g, " ").toUpperCase();
      const mag = Math.abs(z);
      const magTxt = mag >= 2 ? "a strong" : mag >= 1 ? "a clear" : "a slight";
      const phrase =
        `On ${noun}, model gives ${sign >= 0 ? L.teamA : L.teamB} ${magTxt} edge (z=${Math.abs(z).toFixed(2)}).`;
      out.push({ key: k, z: Math.abs(z), sign, phrase });
    }
  }

  // Fallback: margin/total anchors
  if (Number.isFinite(L.medMargin as number) || Number.isFinite(L.medTotal as number)) {
    const z = Number.isFinite(L.medMargin as number) ? (L.medMargin as number) / 10 : 0;
    const sign = Math.sign(z);
    const mag = Math.abs(z);
    const magTxt = mag >= 2 ? "a strong" : mag >= 1 ? "a clear" : "a slight";
    const phrase =
      `Model projects ${sign >= 0 ? L.teamA : L.teamB} with ${magTxt} edge on the scoreboard (median margin ${Number(L.medMargin ?? 0).toFixed(1)}).`;
    out.push({ key: "margin", z: Math.abs(z), sign, phrase });
  }

  out.sort((a, b) => (b.z ?? 0 )- (a.z ?? 0));
  return out;
}
