// src/components/TeamStats.tsx
//
// DISPLAY-ONLY team box-stat distributions for one simulated game.
//
// Everything shown here is precomputed by the sim repo's
// scripts/export_team_stats.py and published as weeks/<weekId>/team_stats.json:
// mean / median / q10 / q90 and a grid of P(stat > K) rungs, all built per
// simulated game FIRST and then aggregated across seeds. This component does
// NO arithmetic on distributions — it formats numbers and filters which rungs
// are worth showing. There are deliberately no market prices and no edge math
// in this panel; the point is to read every team stat Kalshi lists without a
// QB1 stand-in and without doing mental math.
//
// A stat the sim cannot produce (made field goals, total forced turnovers)
// arrives with nulls and a `reason`, and renders as an explicit
// "n/a (not simulated)" row. Never approximated, never hidden.
//
// A missing file (FCS namespace, or a week the exporter has not reached) is
// the expected pre-publish state: quiet muted line, never an error banner.

import { useEffect, useState } from "react";
import {
  getTeamStatsCached, TeamStatsNotPublished,
  type TeamStats as TeamStatsDoc, type TeamStatDist,
} from "../lib/cfbJson";
import type { Season } from "../lib/cfbData";

type Props = {
  /** Our game slug — the key team_stats.json is indexed by. */
  slug: string;
  /** Dataset namespace of THIS CARD ("2026"), never the page's season. */
  ns: Season;
  weekId: string;
  /** Home / away, used only to order the two columns. */
  teamA: string;
  teamB: string;
  colorFor?: (team: string) => string | undefined;
};

/** Display order + labels. Keys must match the exporter's stat keys. */
const ROWS: { key: string; label: string; unit?: string }[] = [
  { key: "points", label: "Points" },
  { key: "rec_yards", label: "Receiving yards", unit: "= gross passing" },
  { key: "rush_yards", label: "Rushing yards" },
  { key: "total_yards", label: "Total yards" },
  { key: "receptions", label: "Receptions" },
  { key: "rush_att", label: "Rush attempts" },
  { key: "rush_td", label: "Rushing TDs" },
  { key: "rec_td", label: "Receiving TDs" },
  { key: "td_offensive", label: "Offensive TDs", unit: "rush + rec only" },
  { key: "def_sacks", label: "Sacks (defense)" },
  { key: "def_ints", label: "Interceptions (defense)" },
  { key: "fg_made", label: "Field goals made" },
  { key: "turnovers_forced", label: "Turnovers forced" },
];

/** Rungs worth showing: drop the degenerate tails nobody can trade. */
const RUNG_LO = 0.05;
const RUNG_HI = 0.95;

const fmt = (v: number | null, dp = 1): string =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(dp);

/** Counts read better as integers-with-a-decimal; yards as whole numbers. */
const dpFor = (key: string): number =>
  key.endsWith("_yards") || key === "points" ? 0 : 1;

function rungChips(d: TeamStatDist): { k: string; pct: number }[] {
  if (!d.rungs) return [];
  return Object.entries(d.rungs)
    .map(([k, p]) => ({ k, pct: Math.round(p * 100), p }))
    .filter((r) => r.p >= RUNG_LO && r.p <= RUNG_HI)
    .sort((a, b) => Number(a.k) - Number(b.k))
    .map(({ k, pct }) => ({ k, pct }));
}

function StatCell({ d, dp }: { d: TeamStatDist | undefined; dp: number }) {
  if (!d) {
    return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
  }
  if (d.median === null) {
    return (
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        n/a (not simulated)
        {d.reason ? <span style={{ opacity: 0.85 }}> — {d.reason}</span> : null}
      </span>
    );
  }
  const chips = rungChips(d);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
          {fmt(d.median, dp)}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {fmt(d.q10, dp)}–{fmt(d.q90, dp)} (80%)
        </span>
      </div>
      {chips.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {chips.map((c) => (
            <span
              key={c.k}
              title={`P(> ${c.k}) = ${c.pct}%`}
              style={{
                fontSize: 10.5, fontWeight: 700, lineHeight: 1.5,
                padding: "1px 6px", borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--fill)", color: "var(--text)",
                whiteSpace: "nowrap",
              }}
            >
              {c.k}+ <span style={{ color: "var(--muted)", fontWeight: 600 }}>{c.pct}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamStats({
  slug, ns, weekId, teamA, teamB, colorFor,
}: Props) {
  const [doc, setDoc] = useState<TeamStatsDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy: this component only mounts when the panel is open, and the loader is
  // memoized per (namespace, week) in module state, so re-opening any card in
  // the week is free. Deps are PRIMITIVES only (AGENT_BRIEF rule 4).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMissing(false);
    setError(null);
    getTeamStatsCached(ns, weekId)
      .then((d) => { if (alive) setDoc(d); })
      .catch((e: any) => {
        if (!alive) return;
        // A 404 is the expected pre-publish / FCS state, not a failure.
        if (e instanceof TeamStatsNotPublished || e?.name === "TeamStatsNotPublished") {
          setMissing(true);
        } else {
          setError(String(e?.message ?? e));
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ns, weekId]);

  const game = doc?.games?.[slug];

  if (loading && !doc) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading team stats…</div>;
  }
  if (missing || (doc && !game)) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Team stats not published yet for this week.
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Team stats unavailable ({error}).
      </div>
    );
  }
  if (!doc || !game) return null;

  // Column order follows the card (home first), but the KEYS come from the
  // published file verbatim — never re-typed (AGENT_BRIEF rule 1).
  const keys = Object.keys(game.stats);
  const cols = [teamA, teamB].filter((t) => keys.includes(t));
  for (const k of keys) if (!cols.includes(k)) cols.push(k);

  const shown = ROWS.filter((r) => cols.some((t) => game.stats[t]?.[r.key]));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        Median with the 10th–90th percentile range, then P(over K) rungs from
        the simulated distribution. Display only — no prices, no edges.
        {doc.nsims ? ` ${doc.nsims.toLocaleString()} sims.` : ""}
      </div>

      {/* Wide content scrolls inside its own container; the page never does. */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%", minWidth: 620, borderCollapse: "collapse",
            fontSize: 12, color: "var(--text)",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left", padding: "4px 8px", fontSize: 11,
                  color: "var(--muted)", fontWeight: 700,
                  borderBottom: "1px solid var(--border)", width: "22%",
                }}
              >
                Stat
              </th>
              {cols.map((t) => (
                <th
                  key={t}
                  style={{
                    textAlign: "left", padding: "4px 8px", fontSize: 12,
                    fontWeight: 800,
                    color: colorFor?.(t) ?? "var(--brand-text)",
                    borderBottom: `2px solid ${colorFor?.(t) ?? "var(--brand)"}`,
                  }}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  title={doc.definitions?.[r.key] ?? undefined}
                  style={{
                    textAlign: "left", padding: "6px 8px", fontWeight: 600,
                    verticalAlign: "top",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                >
                  {r.label}
                  {r.unit && (
                    <div style={{ fontSize: 10, fontWeight: 400, color: "var(--muted)" }}>
                      {r.unit}
                    </div>
                  )}
                </th>
                {cols.map((t) => (
                  <td
                    key={t}
                    style={{
                      padding: "6px 8px", verticalAlign: "top",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <StatCell d={game.stats[t]?.[r.key]} dp={dpFor(r.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {doc.caveats?.length > 0 && (
        <ul
          style={{
            margin: 0, paddingLeft: 16, fontSize: 10.5, color: "var(--muted)",
            display: "grid", gap: 2,
          }}
        >
          {doc.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}
