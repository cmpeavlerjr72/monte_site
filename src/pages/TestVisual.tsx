// src/pages/TestVisual.tsx
// Hidden sim-test scoreboard — reachable only at /test-visual (no nav link).
// Renders public/data/test-visual.json, regenerated from cfb-props-sim by
// scripts/build_test_visual.py --run <tag>[:"Label"] (repeat for arms).
// Used to eyeball week-1 slate tests during model iteration; the tag +
// generated stamp identify the run.
//
// Multi-arm (2026-08-19): when the payload carries several runs, the header
// gets a toggle and every card shows its delta against the comparison arm.
// Card ORDER is held fixed across arms — both in the builder and in the sort
// below, which always keys off the default arm — so flipping between them
// moves the numbers and nothing else.

import { useEffect, useMemo, useState } from "react";
import { getTeamColors } from "../utils/teamColors";
import { getEspnTeamsMap, lookupEspnLogo, localizeLogoUrl } from "../utils/espnLogos";

type BoxRow = [string, string, string];
type TeamBox = { pass_yds: number; rush_yds: number; rows: BoxRow[] };
type Game = {
  gid?: number;
  date: string; home: string; away: string;
  hs: number; as: number; hw: number;
  spread: number | null; ou: number | null; fpi: number | null;
  hbox: TeamBox; abox: TeamBox;
};
type RunMeta = {
  tag: string; label: string; n_games: number;
  slope_fpi: number; slope_mkt: number; mae_mkt: number; gt14: number;
  mean_total: number; tot_vs_ou: number; overs: number; n_ou: number;
};
type Payload = {
  meta: {
    tag: string; generated: string; season: number; week: number;
    n_games: number; runs?: RunMeta[];
  };
  runs?: Record<string, Game[]>;
  games: Game[];
};

const WIN = "color-mix(in oklab, #16a34a 22%, white)";
const LOSS = "color-mix(in oklab, #ef4444 22%, white)";
const NEUTRAL = "color-mix(in oklab, var(--brand) 12%, white)";

function pillBg(delta: number | null, tight: number, wide: number): string {
  if (delta == null) return NEUTRAL;
  const a = Math.abs(delta);
  if (a <= tight) return WIN;
  if (a >= wide) return LOSS;
  return NEUTRAL;
}

function sgn(x: number): number { return x > 0 ? 1 : x < 0 ? -1 : 0; }
function fmt(x: number, d = 1): string { return `${x >= 0 ? "+" : ""}${x.toFixed(d)}`; }

function TeamRow({ name, proj, mkt, logo, color }: {
  name: string; proj: number; mkt: string; logo?: string; color?: string;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {logo ? (
          <img src={logo} alt={`${name} logo`} width={24} height={24}
               style={{ objectFit: "contain" }} loading="lazy" />
        ) : (
          <div style={{ width: 24, height: 24, borderRadius: 6, flex: "none",
                        background: color ?? "var(--accent)" }} />
        )}
        <div style={{ fontWeight: 800, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1,
                    textAlign: "center", color: color ?? "var(--text)" }}>
        {proj.toFixed(1)}
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
        {mkt}
      </div>
    </>
  );
}

function BoxTable({ name, box }: { name: string; box: TeamBox }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 12, margin: "6px 0 2px" }}>
        {name}
        <span style={{ color: "var(--muted)", fontWeight: 600, marginLeft: 8 }}>
          {box.pass_yds} pass yds · {box.rush_yds} rush yds
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {box.rows.map((r, i) => (
            <tr key={i}>
              <td style={{ textAlign: "left", padding: "2px 0", color: "var(--muted)",
                           fontWeight: 700, width: 44 }}>{r[0]}</td>
              <td style={{ textAlign: "left", padding: "2px 0", fontWeight: 600 }}>{r[1]}</td>
              <td style={{ textAlign: "right", padding: "2px 0" }}>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameCard({ g, other, otherLabel, logos }: {
  g: Game; other?: Game; otherLabel?: string;
  logos: Map<string, { id: string; logo: string }>;
}) {
  const [open, setOpen] = useState(false);
  const hc = getTeamColors(g.home)?.primary;
  const ac = getTeamColors(g.away)?.primary;
  const hLogo = localizeLogoUrl(lookupEspnLogo(logos as any, g.home)?.logo);
  const aLogo = localizeLogoUrl(lookupEspnLogo(logos as any, g.away)?.logo);

  const simMargin = g.hs - g.as;
  const mktMargin = g.spread == null ? null : -g.spread;
  const spreadDelta = mktMargin == null ? null : simMargin - mktMargin;
  const simTotal = g.hs + g.as;
  const totalDelta = g.ou == null ? null : simTotal - g.ou;
  const mktScore = (side: "h" | "a"): string => {
    if (mktMargin == null || g.ou == null) return "–";
    const v = side === "h" ? (g.ou + mktMargin) / 2 : (g.ou - mktMargin) / 2;
    return v.toFixed(1);
  };
  const favName = mktMargin == null ? "" : (mktMargin >= 0 ? g.home : g.away);

  // ---- comparison against the other arm -------------------------------
  const dMargin = other ? simMargin - (other.hs - other.as) : null;
  const dTotal = other ? simTotal - (other.hs + other.as) : null;
  const sideFlip = other && mktMargin != null
    && sgn(simMargin - mktMargin) !== sgn((other.hs - other.as) - mktMargin);
  const totalFlip = other && g.ou != null
    && sgn(simTotal - g.ou) !== sgn((other.hs + other.as) - g.ou);

  return (
    <article className="card" style={{ padding: 12, borderRadius: 12,
        border: sideFlip ? "1px solid #f59e0b" : "1px solid var(--border)",
        background: "var(--card)",
        display: "grid", gridTemplateRows: "auto auto auto", gap: 8,
        contentVisibility: "auto", containIntrinsicSize: "300px" } as any}>
      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex",
                    justifyContent: "space-between" }}>
        <span>{g.date}</span>
        <span>{g.fpi == null ? "" : `FPI ${g.fpi > 0 ? "+" : ""}${g.fpi}`}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 90px",
                    rowGap: 6, columnGap: 8, alignItems: "center" }}>
        <div />
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Projected</div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Market</div>
        <TeamRow name={g.away} proj={g.as} mkt={mktScore("a")} logo={aLogo} color={ac} />
        <TeamRow name={g.home} proj={g.hs} mkt={mktScore("h")} logo={hLogo} color={hc} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)",
                       background: pillBg(spreadDelta, 3, 10) }}>
          {g.spread == null ? "Spread: —"
            : `Spread: ${favName} ${(-Math.abs(g.spread)).toFixed(1)} · sim Δ ${
                spreadDelta! >= 0 ? "+" : ""}${spreadDelta!.toFixed(1)}`}
        </span>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)",
                       background: pillBg(totalDelta, 3, 8) }}>
          {g.ou == null ? "Total: —"
            : `O/U ${g.ou.toFixed(1)} · sim ${simTotal.toFixed(1)} (${
                totalDelta! >= 0 ? "+" : ""}${totalDelta!.toFixed(1)})`}
        </span>
        <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999,
                       border: "1px solid var(--border)", background: NEUTRAL }}>
          {g.home} win {(g.hw * 100).toFixed(0)}%
        </span>
      </div>

      {other && (
        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex",
                      gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span>vs {otherLabel}: margin <b style={{ color: "var(--text)" }}>
            {fmt(dMargin!)}</b> · total <b style={{ color: "var(--text)" }}>
            {fmt(dTotal!)}</b></span>
          {sideFlip && (
            <span style={{ padding: "2px 8px", borderRadius: 999, fontWeight: 700,
                           background: "color-mix(in oklab, #f59e0b 25%, white)",
                           color: "#7c2d12" }}>spread pick flips</span>
          )}
          {totalFlip && (
            <span style={{ padding: "2px 8px", borderRadius: 999, fontWeight: 700,
                           background: "color-mix(in oklab, #6366f1 22%, white)",
                           color: "#312e81" }}>total pick flips</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ font: "inherit", fontSize: 13, padding: "6px 10px", borderRadius: 8,
                   border: "1px solid var(--border)", cursor: "pointer",
                   background: open ? "var(--brand)" : "var(--card)",
                   color: open ? "var(--brand-contrast)" : "var(--text)" }}>
          {open ? "Hide Box Score" : "Box Score"}
        </button>
      </div>

      {open && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <BoxTable name={g.away} box={g.abox} />
          <BoxTable name={g.home} box={g.hbox} />
        </div>
      )}
    </article>
  );
}

function MetricStrip({ r, base }: { r: RunMeta; base?: RunMeta }) {
  const cells: [string, string, string | null][] = [
    ["slope vs FPI", r.slope_fpi.toFixed(3), base ? fmt(r.slope_fpi - base.slope_fpi, 3) : null],
    ["slope vs mkt", r.slope_mkt.toFixed(3), base ? fmt(r.slope_mkt - base.slope_mkt, 3) : null],
    ["MAE vs mkt", r.mae_mkt.toFixed(2), base ? fmt(r.mae_mkt - base.mae_mkt, 2) : null],
    [">14 off mkt", `${(r.gt14 * 100).toFixed(1)}%`,
      base ? fmt((r.gt14 - base.gt14) * 100, 1) : null],
    ["mean total", r.mean_total.toFixed(1), base ? fmt(r.mean_total - base.mean_total) : null],
    ["total − o/u", r.tot_vs_ou.toFixed(2), base ? fmt(r.tot_vs_ou - base.tot_vs_ou, 2) : null],
    ["OVER picks", `${r.overs}/${r.n_ou}`, null],
  ];
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
      {cells.map(([lab, v, d]) => (
        <div key={lab}>
          <div style={{ color: "var(--muted)" }}>{lab}</div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {v}
            {d && <span style={{ color: "var(--muted)", fontWeight: 600,
                                 marginLeft: 5 }}>{d}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TestVisual() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logos, setLogos] = useState<Map<string, any> | null>(null);
  const [sort, setSort] = useState<"kick" | "spread" | "disagree">("kick");
  const [run, setRun] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);

  useEffect(() => {
    fetch("/data/test-visual.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d: Payload) => { setData(d); setRun(d.meta.tag); })
      .catch(e => setErr(String(e)));
    getEspnTeamsMap().then(setLogos).catch(() => setLogos(new Map()));
  }, []);

  const runsMeta: RunMeta[] = data?.meta.runs ?? [];
  const runMap: Record<string, Game[]> =
    data?.runs ?? (data ? { [data.meta.tag]: data.games } : {});
  const active = (run && runMap[run]) ? run : (data?.meta.tag ?? "");
  const baseTag = data?.meta.tag ?? "";
  // The other arm: whichever run is not active (two-arm case), else none.
  const otherTag = runsMeta.length > 1
    ? (runsMeta.find(r => r.tag !== active)?.tag ?? null) : null;
  const otherLabel = runsMeta.find(r => r.tag === otherTag)?.label ?? otherTag ?? "";

  // Sort keys always come from the DEFAULT arm, so toggling never reshuffles.
  const games = useMemo(() => {
    if (!data) return [];
    const gs = [...(runMap[active] ?? [])];
    const baseline = runMap[baseTag] ?? gs;
    const keyOf = (g: Game) => {
      const b = baseline.find(x => (x.gid ?? -1) === (g.gid ?? -2)) ?? g;
      if (sort === "spread") return -Math.abs(b.spread ?? 0);
      if (sort === "disagree") {
        return b.spread == null ? 1 : -Math.abs((b.hs - b.as) - (-b.spread));
      }
      return 0;
    };
    if (sort !== "kick") gs.sort((a, b) => keyOf(a) - keyOf(b));
    return gs;
  }, [data, sort, active, baseTag]);

  const otherByGid = useMemo(() => {
    const m = new Map<number, Game>();
    if (otherTag && compare) for (const g of runMap[otherTag] ?? []) {
      if (g.gid != null) m.set(g.gid, g);
    }
    return m;
  }, [data, otherTag, compare]);

  if (err) return <div className="card" style={{ padding: 16 }}>
    No test data published yet ({err}).</div>;
  if (!data || !logos) return <div style={{ color: "var(--muted)" }}>Loading…</div>;

  const activeMeta = runsMeta.find(r => r.tag === active);
  const otherMeta = runsMeta.find(r => r.tag === otherTag);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 16,
          display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>
            Sim Test — {data.meta.season} Week {data.meta.week}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {data.meta.generated} · {data.meta.n_games} games
            · scores are sim means · Δ = sim minus market
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Sort by</label>
            <select value={sort} onChange={e => setSort(e.target.value as any)}
              style={{ padding: "6px 10px", borderRadius: 8,
                       border: "1px solid #e2e8f0", background: "#fff" }}>
              <option value="kick">Kickoff</option>
              <option value="spread">Biggest spread</option>
              <option value="disagree">Sim vs market disagreement</option>
            </select>
          </div>
        </div>

        {runsMeta.length > 1 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Run</span>
            {runsMeta.map(r => (
              <button key={r.tag} onClick={() => setRun(r.tag)}
                style={{ font: "inherit", fontSize: 13, fontWeight: 700,
                         padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                         border: "1px solid var(--border)",
                         background: r.tag === active ? "var(--brand)" : "var(--card)",
                         color: r.tag === active ? "var(--brand-contrast)" : "var(--text)" }}>
                {r.label}
              </button>
            ))}
            <label style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8,
                            display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={compare}
                     onChange={e => setCompare(e.target.checked)} />
              show delta vs other run
            </label>
          </div>
        )}

        {activeMeta && (
          <MetricStrip r={activeMeta} base={compare ? otherMeta : undefined} />
        )}
      </section>

      <div style={{ display: "grid", gap: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    alignItems: "start" }}>
        {games.map((g, i) => (
          <GameCard key={g.gid ?? i} g={g} logos={logos}
                    other={g.gid != null ? otherByGid.get(g.gid) : undefined}
                    otherLabel={otherLabel} />
        ))}
      </div>
    </div>
  );
}
