// src/pages/TestVisual.tsx
// Hidden sim-test scoreboard — reachable only at /test-visual (no nav link).
// Renders public/data/test-visual.json, regenerated from cfb-props-sim by
// scripts/build_test_visual.py --tag <run>. Used to eyeball week-1 slate
// tests during model iteration; the tag + generated stamp identify the run.

import { useEffect, useMemo, useState } from "react";
import { getTeamColors } from "../utils/teamColors";
import { getEspnTeamsMap, lookupEspnLogo, localizeLogoUrl } from "../utils/espnLogos";

type BoxRow = [string, string, string];
type TeamBox = { pass_yds: number; rush_yds: number; rows: BoxRow[] };
type Game = {
  date: string; home: string; away: string;
  hs: number; as: number; hw: number;
  spread: number | null; ou: number | null; fpi: number | null;
  hbox: TeamBox; abox: TeamBox;
};
type Payload = {
  meta: { tag: string; generated: string; season: number; week: number; n_games: number };
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

function GameCard({ g, logos }: { g: Game; logos: Map<string, { id: string; logo: string }> }) {
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

  return (
    <article className="card" style={{ padding: 12, borderRadius: 12,
        border: "1px solid var(--border)", background: "var(--card)",
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

export default function TestVisual() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logos, setLogos] = useState<Map<string, any> | null>(null);
  const [sort, setSort] = useState<"kick" | "spread" | "disagree">("kick");

  useEffect(() => {
    fetch("/data/test-visual.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setErr(String(e)));
    getEspnTeamsMap().then(setLogos).catch(() => setLogos(new Map()));
  }, []);

  const games = useMemo(() => {
    if (!data) return [];
    const gs = [...data.games];
    if (sort === "spread") {
      gs.sort((a, b) => Math.abs(b.spread ?? 0) - Math.abs(a.spread ?? 0));
    } else if (sort === "disagree") {
      const d = (g: Game) => g.spread == null ? -1
        : Math.abs((g.hs - g.as) - (-g.spread));
      gs.sort((a, b) => d(b) - d(a));
    }
    return gs;
  }, [data, sort]);

  if (err) return <div className="card" style={{ padding: 16 }}>
    No test data published yet ({err}).</div>;
  if (!data || !logos) return <div style={{ color: "var(--muted)" }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <section className="card" style={{ padding: 12, marginBottom: 16,
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand)" }}>
          Sim Test — {data.meta.season} Week {data.meta.week}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          run <b>{data.meta.tag}</b> · {data.meta.generated} · {data.meta.n_games} games
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
      </section>

      <div style={{ display: "grid", gap: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    alignItems: "start" }}>
        {games.map((g, i) => <GameCard key={i} g={g} logos={logos} />)}
      </div>
    </div>
  );
}
