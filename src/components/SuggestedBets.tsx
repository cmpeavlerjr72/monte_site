// src/components/SuggestedBets.tsx
//
// Owner-only "Suggested bets": the read-only twin of the FBS maker pipeline.
//
// `scripts/fbs_maker_pipeline.py` in cfb-props-sim remains the PLACEMENT
// AUTHORITY — it prices, sizes, records state and is the only thing that ever
// puts an order on the exchange. This card mirrors its selection constants so
// the same conclusions can be read on a phone, at a bar, off prices that are
// already in flight. There are deliberately NO placement controls here.
//
// ---------------------------------------------------------------------------
// Zero new Kalshi load
// ---------------------------------------------------------------------------
// Everything is computed from quotes ALREADY flowing through the page's
// /api/kalshi/cfb poll (45s TTL, bulk series paging). No orderbook-depth
// calls, no per-market fan-out. Because the compute is a pure function of
// that feed, it re-runs whenever the poll delivers — live for free. "Refresh"
// only re-runs the compute against the newest feed the page holds.
//
// ---------------------------------------------------------------------------
// PREGAME ONLY — a correctness rule, not a preference
// ---------------------------------------------------------------------------
// Our sim fairs are pregame distributions. Once a ball is kicked they are
// wrong, and an "edge" against a live book would be an invitation to lose
// money. In-progress and final games are excluded, and so is any game whose
// kick time has passed even if the live feed has not caught up yet.
//
// ---------------------------------------------------------------------------
// Fees are never gross
// ---------------------------------------------------------------------------
// Every displayed edge is NET of the fee that applies to that row's mode, at
// that row's price, using Kalshi's own per-series fee params (see
// suggestedBets.ts — the per-team families charge no maker fee at all). The
// tap popover itemizes it.

import { useEffect, useMemo, useState } from "react";
import { getTeamStatsCached, type TeamStats as TeamStatsDoc } from "../lib/cfbJson";
import type { KalshiGame } from "../lib/kalshi";
import type { PortalPayload } from "../lib/kalshiPortal";
import {
  buildSuggestions, heldTickerSet, statCandidates,
  LADDER_RISK, MIN_MAKER_EDGE, TAKE_THRESHOLD,
  type Candidate, type FeeParams,
} from "../lib/suggestedBets";
import type { Season } from "../lib/cfbData";

/** Our stat key -> the Kalshi series that settles it (server's map, inverted). */
const SERIES_FOR: Record<string, string> = {
  points: "KXNCAAFTEAMTOTAL",
  rec_yards: "KXNCAAFTEAMRECYDS",
  rush_yards: "KXNCAAFTEAMRSHYDS",
  total_yards: "KXNCAAFTEAMYDS",
  receptions: "KXNCAAFTEAMREC",
  rush_att: "KXNCAAFTEAMRSHATT",
  rush_td: "KXNCAAFTEAMRSHTD",
  rec_td: "KXNCAAFTEAMRECTD",
  def_sacks: "KXNCAAFTEAMSACK",
  def_ints: "KXNCAAFTEAMINT",
};

/** Bet-slip wording, not column headings. */
const SHORT: Record<string, string> = {
  points: "points",
  rec_yards: "rec yds",
  rush_yards: "rush yds",
  total_yards: "total yds",
  receptions: "receptions",
  rush_att: "rush att",
  rush_td: "rush TDs",
  rec_td: "rec TDs",
  def_sacks: "sacks",
  def_ints: "INTs",
};

export type SuggestGame = {
  key: string;
  slug: string;
  ns: Season;
  teamA: string;
  teamB: string;
  /** True when the game has kicked, is live, or is final. */
  started: boolean;
};

const cents = (v: number) => `${Math.round(v * 100)}¢`;
const signed = (v: number) =>
  `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}¢`;

export default function SuggestedBets({
  games, kalshiBySlug, feeParams, portal, weekId, onJump,
}: {
  games: SuggestGame[];
  kalshiBySlug: Map<string, KalshiGame>;
  feeParams: Record<string, FeeParams>;
  portal: PortalPayload | null;
  weekId: string;
  onJump?: (cardKey: string) => void;
}) {
  const [docs, setDocs] = useState<Record<string, TeamStatsDoc>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // team_stats per namespace on the slate; the loader is memoized per
  // (ns, week) so this costs nothing beyond what the panel already fetched.
  const namespaces = useMemo(
    () => Array.from(new Set(games.map((g) => String(g.ns)))).sort().join(","),
    [games]
  );
  useEffect(() => {
    let alive = true;
    const list = namespaces ? namespaces.split(",") : [];
    for (const ns of list) {
      getTeamStatsCached(ns as Season, weekId)
        .then((d) => { if (alive) setDocs((prev) => (prev[ns] ? prev : { ...prev, [ns]: d })); })
        .catch(() => { /* not published for this namespace: no suggestions */ });
    }
    return () => { alive = false; };
  }, [namespaces, weekId]);

  const { rows, suppressed, computedAt } = useMemo(() => {
    const held = heldTickerSet(portal?.positions, portal?.orders);
    const candidates: Candidate[] = [];
    for (const g of games) {
      // PREGAME ONLY.
      if (g.started) continue;
      const kg = kalshiBySlug.get(g.key);
      if (!kg) continue;
      const doc = docs[String(g.ns)];
      const stats = doc?.games?.[g.slug]?.stats;
      if (!stats) continue;
      candidates.push(...statCandidates(
        // `key` is what the scoreboard scrolls to; `slug` only indexes the
        // published stats above.
        kg, g.key, g.teamA, g.teamB,
        (stat) => SHORT[stat] ?? stat,
        (team, stat, strike) => {
          // Published rung, read verbatim. No interpolation, no client-side
          // distribution math — a strike off the grid simply has no bet.
          const r = stats[team]?.[stat]?.rungs;
          const v = r?.[String(strike)];
          return typeof v === "number" ? v : null;
        },
        (stat) => SERIES_FOR[stat] ?? "",
      ));
    }
    const built = buildSuggestions(candidates, feeParams, held);
    return { ...built, computedAt: new Date() };
    // `nonce` is the manual refresh: it re-runs the compute against whatever
    // feed the page currently holds, and never triggers a fetch of its own.
  }, [games, kalshiBySlug, feeParams, portal, docs, nonce]);

  const pregameCount = games.filter((g) => !g.started).length;

  return (
    <section style={{
      border: "1px solid var(--brand)", borderRadius: 12,
      background: "var(--card)", padding: 10, display: "grid", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>
          Suggested bets
        </span>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {pregameCount} pregame game{pregameCount === 1 ? "" : "s"} · $
          {LADDER_RISK} per ladder · rest at {Math.round(MIN_MAKER_EDGE * 100)}¢+,
          take at {Math.round(TAKE_THRESHOLD * 100)}¢+ (both after fee)
        </span>
        <button type="button" className="ui-btn" onClick={() => setNonce((n) => n + 1)}
                style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 11 }}>
          Refresh
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--muted)" }}>
        <span aria-hidden="true" style={{
          width: 6, height: 6, borderRadius: 999, background: "var(--pos)",
          display: "inline-block", flex: "none",
        }} />
        Computed at {computedAt.toLocaleTimeString()} · live. Edges are NET of
        fee. Read-only — the maker pipeline places.
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Nothing clears the thresholds right now.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 3 }}>
          {rows.map((r) => {
            const on = r.key === sel;
            return (
              <div key={r.key}>
                <button
                  type="button"
                  onClick={() => { setSel(on ? null : r.key); onJump?.(r.slug); }}
                  style={{
                    width: "100%", textAlign: "left", cursor: "pointer",
                    display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
                    padding: "5px 7px", borderRadius: 7,
                    border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                    background: "var(--card)", color: "var(--text)",
                    font: "inherit", fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{r.label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: "1px 6px",
                    borderRadius: 999, border: "1px solid var(--border)",
                    color: "var(--muted)", whiteSpace: "nowrap",
                  }}>
                    {r.mode} @{cents(r.price)}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    ${LADDER_RISK} → {r.count} @ {cents(r.price)}
                  </span>
                  <span style={{
                    marginLeft: "auto", fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    color: r.edge > 0 ? "var(--pos)" : "var(--neg)",
                  }}>
                    {signed(r.edge)}
                  </span>
                </button>
                {on && (
                  <div style={{
                    margin: "3px 0 5px", padding: "6px 8px", fontSize: 11.5,
                    lineHeight: 1.5, color: "var(--text)",
                    background: "var(--card)", border: "1px solid var(--brand)",
                    borderRadius: 7,
                  }}>
                    Sim {Math.round(r.simP * 100)}% · price {cents(r.price)} ·
                    fee {(r.fee * 100 / Math.max(r.count, 1)).toFixed(1)}¢/contract
                    {" "}({r.fee.toFixed(2)} total) · net edge {signed(r.edge)}
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>
                      {r.count} contracts, outlay ${r.outlay.toFixed(2)} of ${LADDER_RISK}
                      {" · "}fee type {r.feeType}
                      {" · "}{r.ticker}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {suppressed.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>
          {suppressed.length} candidate{suppressed.length === 1 ? "" : "s"} suppressed
          (thin or one-sided book, sim in its own tail, ladder cap, penny quote,
          or already held).
        </div>
      )}
    </section>
  );
}
