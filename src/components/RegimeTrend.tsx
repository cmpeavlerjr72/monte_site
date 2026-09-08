// src/components/RegimeTrend.tsx
//
// HOW THIS ENGINE'S REGIME CELLS FARED SO FAR — a TREND block, never a rule.
//
// Week 2 (2026) is published by an engine whose only settled record is the
// week-0/1 replay (2,000 seeds, 51 games, ~3,000 acted contracts). The owner
// ruled (2026-09-08): no hard rules on that, but "something telling us
// generally how that regime fared so far". This renders the fixed regime cells
// of cfb-props-sim's `scripts/regime_scorecard.py` — whole board, side, and
// open-spread band × family — for the served engine, with the shipped engine
// on the same board beside it. It reads `weeks/<id>/regime_trend.json`
// (export_regime_trend.py). It labels nothing, stars nothing, filters nothing.
//
// House style (owner, Team Stats v3): verdict first, words on tap, no bare
// number pairs inline. Every cell prints its ROI with its n, and the popover
// carries the level bias and the sim-vs-real share so a reader can see WHY a
// cell paid or lost (biased-and-losing vs unbiased-and-losing, the scorecard's
// own reading guide).

import { useState } from "react";
import type { RegimeTrend, RegimeTrendCell, WeekEngine } from "../lib/cfbJson";

const pct = (v: number | null | undefined, nd = 0): string =>
  v == null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(nd)}%`;
const pts = (v: number | null | undefined): string =>
  v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

function cellOf(cells: RegimeTrendCell[] | undefined, name: string): RegimeTrendCell | undefined {
  return cells?.find((c) => c.cell === name);
}

/** The popover sentence for one cell: the scorecard's own reading. */
function cellWords(c: RegimeTrendCell, ctrl?: RegimeTrendCell): string {
  const parts: string[] = [];
  parts.push(`${c.cell}: ${pct(c.roi, 1)} on ${c.n} contract${c.n === 1 ? "" : "s"}`
    + (c.hit != null ? `, hit ${(c.hit * 100).toFixed(0)}%` : "")
    + (c.mean_p != null ? ` at a mean sim P of ${(c.mean_p * 100).toFixed(0)}%` : "") + ".");
  if (c.bias != null) {
    parts.push(`Level bias on the money ${pts(c.bias)} (spread/ML cells: sim favourite margin `
      + "minus actual; total cells: sim total minus actual; negative = the engine "
      + "gave too little).");
  }
  if (c.share_sim != null && c.share_real != null) {
    parts.push(`The sim called this side ${(c.share_sim * 100).toFixed(0)}% of the time; `
      + `reality ${(c.share_real * 100).toFixed(0)}%.`);
  }
  if (ctrl) parts.push(`Shipped engine, same board: ${pct(ctrl.roi, 1)} on ${ctrl.n}.`);
  if (c.underpowered) parts.push("Under 30 contracts — underpowered, direction only.");
  return parts.join(" ");
}

function RoiCell({ c, ctrl }: { c?: RegimeTrendCell; ctrl?: RegimeTrendCell }) {
  if (!c || !c.n) return <td style={{ color: "var(--muted)", textAlign: "right" }}>–</td>;
  const color = c.roi == null ? "var(--muted)" : c.roi > 0 ? "var(--pos)" : "var(--neg)";
  return (
    <td title={cellWords(c, ctrl)}
      style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
               color, opacity: c.underpowered ? 0.6 : 1, cursor: "help" }}>
      {pct(c.roi)}{c.underpowered ? "*" : ""}
      <span style={{ color: "var(--muted)", fontSize: 9, marginLeft: 4 }}>n{c.n}</span>
    </td>
  );
}

/** One line for a panel header: the board and the four full-game families. */
export function RegimeTrendSummary({ trend }: { trend: RegimeTrend | null | undefined }) {
  if (!trend) return null;
  const c = trend.cells;
  const k = trend.control?.cells;
  const whole = c.find((x) => x.cell.startsWith("ALL tradeable (both"));
  const wholeK = k?.find((x) => x.cell.startsWith("ALL tradeable (both"));
  const fam = (name: string) => {
    const x = cellOf(c, name);
    return x ? `${name.replace(" all", "")} ${pct(x.roi)}` : null;
  };
  const line = [
    whole ? `board ${pct(whole.roi)}${wholeK ? ` (shipped ${pct(wholeK.roi)})` : ""}` : null,
    fam("SPREAD all"), fam("TOTAL all"), fam("TEAMTOTAL all"), fam("GAME/ML all"),
  ].filter(Boolean).join(" · ");
  return (
    <span title={trend.note ?? undefined} style={{ cursor: "help" }}>
      Week 0–1 replay, this engine: {line} · trend only, n small
    </span>
  );
}

/** The full block: side cells and the band × family grid, collapsed by default. */
export function RegimeTrendBlock({ trend, engine }: {
  trend: RegimeTrend | null | undefined;
  engine: WeekEngine | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!trend) return null;
  const c = trend.cells;
  const k = trend.control?.cells;
  const bands = ["pk-3", "3-7", "7-14", "14-24", "24+"];
  const fams = ["SPREAD", "TOTAL", "TEAMTOTAL", "GAME/ML"];
  const sides: [string, string][] = [
    ["SPREAD fav", "favourite"], ["SPREAD dog", "dog"],
    ["TOTAL over", "over"], ["TOTAL under", "under"],
    ["TEAMTOTAL fav-over", "fav TT over"], ["TEAMTOTAL fav-under", "fav TT under"],
    ["TEAMTOTAL dog-over", "dog TT over"], ["TEAMTOTAL dog-under", "dog TT under"],
    ["ML fav", "ML favourite"], ["ML dog", "ML dog"],
  ];
  const th: React.CSSProperties = {
    textAlign: "right", fontWeight: 700, color: "var(--muted)", fontSize: 10, padding: "2px 6px",
  };
  const td0: React.CSSProperties = { padding: "2px 6px", whiteSpace: "nowrap" };
  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 6, fontSize: 11 }}>
      <button type="button" className="ui-btn" onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ padding: "2px 8px", fontSize: 10.5, fontWeight: 800 }}
        title={trend.note ?? undefined}>
        Regime trend {open ? "▾" : "▸"} — how {engine?.model ?? "this engine"} fared on the
        settled week 0–1 board ({trend.replay.contracts ?? "?"} contracts; trend, not rules)
      </button>
      {!open && (
        <div style={{ color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>
          <RegimeTrendSummary trend={trend} />
        </div>
      )}
      {open && (
        <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
          <div style={{ color: "var(--muted)", lineHeight: 1.45 }}>
            {trend.note} Convention: {trend.convention}. Shipped engine on the same board in the
            popover of every cell. * = under 30 contracts.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr><th style={{ ...th, textAlign: "left" }}>side</th><th style={th}>this engine</th><th style={th}>shipped</th></tr></thead>
              <tbody>
                {sides.map(([name, label]) => (
                  <tr key={name}>
                    <td style={td0}>{label}</td>
                    <RoiCell c={cellOf(c, name)} ctrl={cellOf(k, name)} />
                    <RoiCell c={cellOf(k, name)} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>open spread band</th>
                  {fams.map((f) => <th key={f} style={th}>{f}</th>)}
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b}>
                    <td style={td0}>{b}</td>
                    {fams.map((f) => (
                      <RoiCell key={f} c={cellOf(c, `${b} | ${f}`)} ctrl={cellOf(k, `${b} | ${f}`)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
