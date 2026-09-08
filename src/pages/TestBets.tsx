// src/pages/TestBets.tsx
//
// HIDDEN HARNESS — the per-game Bets panel, rendered against a REAL published
// week and a DECLARED FIXTURE BOOK.  `/test-bets` (no nav link).
//
//   /test-bets                                  the two default games
//   /test-bets?week=week01&games=a_b,c_d        any published slugs
//   /test-bets?rules=off                        the kill switch, side by side
//   /test-bets?size=to-win|book                 the unit sizing MODE (2026-09-08)
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The week-2 decision rules (src/lib/edgeRules.ts) can only be SEEN on a
// pregame game with a live Kalshi book. Both halves of that expire: a slate
// goes final and the exchange delists its markets, so within days of shipping
// a rule there is no way left to look at what it does — and this is a surface
// that decides which rows the owner is told not to bet.
//
// So the harness fixes the two perishable inputs and NOTHING else:
//
//   * THE CLOCK is pinned 3 days before the game's real kickoff, which is the
//     frame the week-1 grade measured (bets go in Mon/Tue/Wed) and the band
//     the take bar is 6¢ in.
//   * THE BOOK is synthetic and SAYS SO, loudly, on the page. Kalshi does not
//     keep a settled market's quotes and this app never snapshots them, so
//     there is nothing honest to replay. Prices are derived from the published
//     sim rungs by a stated offset (see `fixtureBook`) — chosen to put rows on
//     both sides of every bar, not to flatter anything.
//
// EVERYTHING ELSE IS THE SHIPPED PATH: the real `team_stats.json` for the week,
// the real `summary.json` open spreads, the real `useSuggestions` compute, the
// real `gameCandidates` / `buildSuggestions` / `starFor`, and the real
// `GameBetsPanel`. If a label is wrong here it is wrong in production.
//
// NOT A TEST OF PRICES. Read this page for LABELS — which rows are muted, what
// the tags say, which rows keep a star. The cents are fixture cents.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import GameBetsPanel from "../components/SuggestedBets";
import { useSuggestions, type SuggestGame } from "../lib/useSuggestions";
import { getJsonWeekIndex, getJsonWeekGames, getTeamStats,
  type TeamStats } from "../lib/cfbJson";
import type { KalshiGame, KalshiRung, KalshiStatQuote } from "../lib/kalshi";
import {
  sizeContracts, MAX_RISK_MULTIPLE_DEFAULT,
  type FeeParams, type Sizing, type UnitMode,
} from "../lib/suggestedBets";
import { regimeWords } from "../lib/edgeRules";
import UnitModeControl from "../components/UnitModeControl";

/** Ball State @ Ohio State is the mismatch (open −50.5, P4 host v MAC — the
 *  Python's own worked example); Clemson @ LSU is the peer game whose open
 *  −10.5 sits in the 7–14 band that returned +16% (n=279). */
const DEFAULT_GAMES = ["ohiostate_ballstate", "lsu_clemson"];
const SEASON = "2026";
const DEFAULT_WEEK = "week01";
const DAY = 24 * 60 * 60 * 1000;

/** The fee params Kalshi actually publishes for these families (checked
 *  2026-08-28): per-team markets charge takers only; game lines charge both. */
const FEES: Record<string, FeeParams> = {
  KXNCAAFGAME: { fee_type: "quadratic_with_maker_fees", fee_multiplier: 1 },
  KXNCAAFSPREAD: { fee_type: "quadratic_with_maker_fees", fee_multiplier: 1 },
  KXNCAAFTOTAL: { fee_type: "quadratic_with_maker_fees", fee_multiplier: 1 },
  KXNCAAFTEAMTOTAL: { fee_type: "quadratic", fee_multiplier: 1 },
};

const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
const c2 = (v: number) => Math.round(clamp(v) * 100) / 100;

/**
 * A book for one game, derived from that game's PUBLISHED sim rungs.
 *
 * The rule, stated so the reader can undo it in their head: the market is
 * placed `skew` BELOW the sim on every rung, with a 3¢ wide book around it.
 * A positive skew therefore hands every contract a positive raw edge, and the
 * SIZE of it walks with the strike (the offset is scaled by how far the rung
 * sits from 50¢), so a ladder ends up with rows above and below the 10¢ star
 * bar and above and below the 15–90¢ price band. That is the point: a fixture
 * where everything stars proves nothing about a rule that decides what does
 * not star.
 */
function fixtureBook(
  slug: string,
  lines: { marginRungs: Record<string, number> | null;
           totalRungs: Record<string, number> | null;
           winProbHome: number | null; winProbAway: number | null },
  teams: { A: string; B: string },
  pointsRungs: { team: string; side: "A" | "B"; strike: number; p: number }[],
  skew: number,
): KalshiGame {
  const half = 0.015;
  /**
   * `dir` alternates the sign of the disagreement down each ladder, which is
   * the whole reason this fixture can show an abstention at all: a book placed
   * uniformly BELOW the sim hands the favourite's side of every spread market
   * the better edge, `buildSuggestions` keeps one contract per ticker, and the
   * dog side — the side R1 is about — never survives to be labelled. A real
   * board disagrees in both directions; so does this one.
   */
  const mk = (p: number, dir: number): { bid: number; ask: number } => {
    // Offset shrinks toward the tails so a deep rung is not handed an
    // implausible 30¢ edge on top of an already extreme price.
    const off = dir * skew * (1 - Math.abs(p - 0.5) * 1.2);
    const mid = clamp(p - off);
    return { bid: c2(mid - half), ask: c2(mid + half) };
  };
  const code = slug.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8);

  // A real Kalshi board lists a handful of strikes AROUND THE NUMBER, not the
  // exporter's whole ±29.5 grid — so the fixture keeps the rungs whose sim
  // probability is nearest 50¢ and orders them by line, which is what the
  // exchange does.
  const nearest = <T,>(xs: T[], p: (x: T) => number, n: number) =>
    [...xs].sort((a, b) => Math.abs(p(a) - 0.5) - Math.abs(p(b) - 0.5)).slice(0, n);

  const spread_ladder: KalshiRung[] = nearest(
    Object.entries(lines.marginRungs ?? {})
      .map(([k, p]) => ({ key: Number(k), p }))
      .filter((r) => Number.isFinite(r.key)),
    (r) => r.p, 7)
    .sort((a, b) => a.key - b.key)
    .map(({ key, p }, i) => {
      const line = -key;                       // rung YES = P(margin > −line)
      const { bid, ask } = mk(p, i % 2 === 0 ? 1 : -1);
      return {
        line, yes_price: (bid + ask) / 2, yes_bid: bid, yes_ask: ask,
        ticker: `KXNCAAFSPREAD-${code}-S${i}`,
        mirrored: false,
      };
    });

  const total_ladder: KalshiRung[] = nearest(
    Object.entries(lines.totalRungs ?? {})
      .map(([k, p]) => ({ line: Number(k), p }))
      .filter((r) => Number.isFinite(r.line)),
    (r) => r.p, 6)
    .sort((a, b) => a.line - b.line)
    .map(({ line, p }, i) => {
      const { bid, ask } = mk(p, i % 2 === 0 ? 1 : -1);
      return {
        line, yes_price: (bid + ask) / 2, yes_bid: bid, yes_ask: ask,
        ticker: `KXNCAAFTOTAL-${code}-T${i}`,
      };
    });

  const wh = lines.winProbHome ?? 0.5;
  const win = mk(wh, 1);
  const stat_quotes: KalshiStatQuote[] = pointsRungs.map((r, i) => {
    const { bid, ask } = mk(r.p, 1);
    return {
      stat: "points", side: r.side, strike: r.strike,
      yes_bid: bid, yes_ask: ask,
      ticker: `KXNCAAFTEAMTOTAL-${code}-P${i}`,
    };
  });

  return {
    slug,
    event_ticker: `FIXTURE-${code}`,
    winner: { teamA_price: (win.bid + win.ask) / 2,
              teamB_price: 1 - (win.bid + win.ask) / 2 },
    winner_quotes: [{
      side: "A", ticker: `KXNCAAFGAME-${code}-A`,
      yes_bid: win.bid, yes_ask: win.ask,
    }],
    total: { line: total_ladder[0]?.line ?? null, yes_price: null },
    spread: { line: spread_ladder[0]?.line ?? null, yes_price: null },
    total_ladder, spread_ladder, stat_quotes,
    __teams: teams,
  } as unknown as KalshiGame;
}

/* ===================== THE THREE MODES, SIDE BY SIDE ======================= *
 *
 * A favourite rung and a dog rung, priced through the SHIPPED kernel
 * (`sizeContracts`) under all three modes at once. This is the whole feature
 * in one block: the same $30 unit buying three different bets, and the guard
 * biting on the favourite.
 *
 * BOTH ARE TAKES, because that is where the fee is real: 7% x P x (1−P) per
 * contract, rounded up per order. A rest on a per-team family pays nothing and
 * the to-win arithmetic collapses to unit / (1−P).
 */
const MODE_ROWS: { mode: UnitMode; label: string }[] = [
  { mode: "risk", label: "Risk" },
  { mode: "to-win", label: "To win" },
  { mode: "book", label: "Book" },
];

function SizingTable({ unit, multiple }: { unit: number; multiple: number }) {
  const rungs = [
    { name: "favourite", price: 0.7 },
    { name: "heavy favourite", price: 0.86 },
    { name: "dog", price: 0.3 },
  ];
  const th: React.CSSProperties = {
    textAlign: "right", padding: "3px 7px", fontWeight: 800,
    color: "var(--muted)", fontSize: 10.5, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    textAlign: "right", padding: "3px 7px",
    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
  };
  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 10, padding: 10,
      background: "var(--card)", display: "grid", gap: 6, minWidth: 0,
    }}>
      <b style={{ fontSize: 13 }}>
        Unit sizing — ${unit} unit, cap {multiple}× , taker fee
      </b>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>rung</th>
              <th style={{ ...th, textAlign: "left" }}>mode</th>
              <th style={th}>contracts</th>
              <th style={th}>risk</th>
              <th style={th}>fee</th>
              <th style={th}>net win</th>
              <th style={{ ...th, textAlign: "left" }}>capped</th>
            </tr>
          </thead>
          <tbody>
            {rungs.flatMap((r) => MODE_ROWS.map((m, i) => {
              const s = sizeContracts({
                price: r.price, maker: false, unit,
                sizing: { mode: m.mode, maxRiskMultiple: multiple },
                ceiling: unit * multiple,
              });
              return (
                <tr key={`${r.name}-${m.mode}`} style={{
                  borderTop: i === 0 ? "1px solid var(--border)" : "none",
                }}>
                  <td style={{ padding: "3px 7px", fontWeight: 700 }}>
                    {i === 0 ? `${r.name} @ ${Math.round(r.price * 100)}¢` : ""}
                  </td>
                  <td style={{ padding: "3px 7px", color: "var(--muted)" }}>{m.label}</td>
                  <td style={td}>{s.count}</td>
                  <td style={td}>${s.risk.toFixed(2)}</td>
                  <td style={td}>${s.fee.toFixed(2)}</td>
                  <td style={{ ...td, fontWeight: 800 }}>${s.netWin.toFixed(2)}</td>
                  <td style={{ padding: "3px 7px", color: "var(--muted)" }}>
                    {s.capped ? `yes — ${(s.outlay / unit).toFixed(1)}× unit` : ""}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Risk stakes the unit; to-win stakes enough to NET it; book takes to-win
        on the two favourites and risk on the dog — which is why the dog's three
        rows are two. The 86¢ row is the guard: a full $30 of profit there would
        risk $186.
      </div>
    </div>
  );
}

type Loaded = {
  games: SuggestGame[];
  kalshi: Map<string, KalshiGame>;
  docs: Record<string, TeamStats>;
  note: string;
};

export default function TestBets() {
  const [params, setParams] = useSearchParams();
  const weekId = params.get("week") || DEFAULT_WEEK;
  const slugs = (params.get("games") || DEFAULT_GAMES.join(",")).split(",")
    .map((s) => s.trim()).filter(Boolean);
  const rulesOn = params.get("rules") !== "off";
  // THE UNIT SIZING MODE. Same reason the rules switch is a URL: the modes
  // differ only on a live book, and a settled slate has none — so the harness
  // is where "what does Book mode do to an 86¢ favourite" stays answerable.
  const sizeParam = params.get("size");
  const sizing: Sizing = {
    mode: sizeParam === "to-win" || sizeParam === "book" ? sizeParam : "risk",
    maxRiskMultiple: MAX_RISK_MULTIPLE_DEFAULT,
  };
  const setSizeMode = (m: UnitMode) => {
    const q = new URLSearchParams(params);
    if (m === "risk") q.delete("size"); else q.set("size", m);
    setParams(q, { replace: true });
  };
  const skew = Number(params.get("skew") ?? 0.16);

  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const index = await getJsonWeekIndex(weekId, SEASON);
        if (!index) throw new Error(`no index for ${weekId}`);
        const wanted = index.filter((r) => slugs.includes(r.slug));
        if (!wanted.length) throw new Error(`no such slugs in ${weekId}`);
        const [ts, all] = await Promise.all([
          getTeamStats(SEASON, weekId),
          getJsonWeekGames(weekId, SEASON),
        ]);
        if (dead) return;
        const keep = new Set(wanted.map((r) => r.slug));
        const joined = (all ?? []).filter((j) => keep.has(j.row.slug));

        const kalshi = new Map<string, KalshiGame>();
        const games: SuggestGame[] = [];
        for (const jg of joined) {
          const row = jg.row;
          const pub = ts.games[row.slug];
          if (!pub?.game) continue;
          const teamA = jg.summary?.teamA || row.teamA;
          const teamB = jg.summary?.teamB || row.teamB;
          // Real kickoff, then the clock is pinned 3 days before it below.
          const kick = row.time_utc ? Date.parse(row.time_utc) : NaN;
          const points: { team: string; side: "A" | "B"; strike: number; p: number }[] = [];
          for (const [team, byStat] of Object.entries(pub.stats ?? {})) {
            const rungs = byStat?.points?.rungs;
            if (!rungs) continue;
            const side: "A" | "B" = team === teamA ? "A" : "B";
            Object.entries(rungs)
              .map(([k, p]) => ({ k: Number(k), p }))
              .filter((x) => Number.isFinite(x.k))
              // Nearest the number, same as the ladders above.
              .sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5))
              .slice(0, 3)
              .sort((a, b) => a.k - b.k)
              // Kalshi words the market at the integer above the half-point
              // floor, which is what statCandidates re-floors: 20.5 -> "21+".
              .forEach((x) => points.push({ team, side, strike: Math.ceil(x.k), p: x.p }));
          }
          kalshi.set(row.slug, fixtureBook(
            row.slug, pub.game, { A: teamA, B: teamB }, points, skew));
          games.push({
            key: row.slug, slug: row.slug, ns: SEASON,
            teamA, teamB, started: false, liveState: "pre",
            kickoffMs: Number.isFinite(kick) ? kick : undefined,
            openSpread: jg.summary?.odds?.spread_open ?? undefined,
            division: "fbs",
          });
        }
        setData({
          games, kalshi, docs: { [SEASON]: ts },
          note: `${weekId} · team_stats tag ${ts.tag ?? "?"} · sim rungs and open spreads are REAL`,
        });
      } catch (e: any) {
        if (!dead) setErr(String(e?.message ?? e));
      }
    })();
    return () => { dead = true; };
  }, [weekId, slugs.join(","), skew]);

  // THE PINNED CLOCK: 3 days before the earliest kickoff in the set — the
  // frame the week-1 grade calls the realistic early-week entry, and the band
  // where the take bar is 6¢ and resting is on the table.
  const nowMs = useMemo(() => {
    const kicks = (data?.games ?? []).map((g) => g.kickoffMs)
      .filter((k): k is number => typeof k === "number");
    return kicks.length ? Math.min(...kicks) - 3 * DAY : Date.now();
  }, [data]);

  const suggestions = useSuggestions({
    games: data?.games ?? [],
    kalshiBySlug: data?.kalshi ?? new Map(),
    feeParams: FEES,
    portal: null,
    docs: data?.docs ?? {},
    unit: 30,
    sizing,
    nowMs,
    nonce: 0,
    modeFilter: "all",
    typeFilter: "all",
    showTails: true,
    sort: "edge",
    edgeRules: rulesOn,
  });

  return (
    // `minWidth: 0` on the grid and on every section below: a grid item's
    // automatic minimum size is min-content, which at 375px is wider than the
    // viewport once a ladder headline is in it — the same trap the card header
    // hit in 2026-08-29. Without it the harness itself would report an
    // overflow that the panel does not have.
    <div style={{
      padding: 14, display: "grid", gap: 14, maxWidth: 760, margin: "0 auto",
      minWidth: 0,
    }}>
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 18, color: "var(--brand-text)" }}>
          Bets panel harness — week-2 decision rules
        </h1>
        <div style={{
          border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 10px",
          background: "var(--fill)", color: "var(--muted)", fontSize: 11.5, lineHeight: 1.55,
        }}>
          <b style={{ color: "var(--accent)" }}>FIXTURE BOOK.</b>{" "}
          Sim rungs, team names and open spreads are the REAL published
          {" "}{data?.note ?? "week"}. The Kalshi PRICES are synthetic — every
          rung is placed {Math.round(skew * 100)}¢ under the sim (tapering into
          the tails), because the exchange keeps no quotes for a settled market.
          The clock is pinned 3 days before kickoff, the frame the week-1 grade
          measured. Read this page for the LABELS, never for the cents.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
          <button
            type="button" className="ui-btn"
            data-on={rulesOn ? "true" : "false"}
            onClick={() => {
              const p = new URLSearchParams(params);
              if (rulesOn) p.set("rules", "off"); else p.delete("rules");
              setParams(p, { replace: true });
            }}
            style={{ padding: "2px 10px", fontWeight: 800 }}
          >
            rules {rulesOn ? "on" : "off"}
          </button>
          <span style={{ color: "var(--muted)" }}>
            the kill switch, as a URL — compare the two
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, flexWrap: "wrap" }}>
          <UnitModeControl
            mode={sizing.mode} onMode={setSizeMode}
            multiple={sizing.maxRiskMultiple} compact
          />
          <span style={{ color: "var(--muted)" }}>
            the sizing mode — every panel below re-sizes with it
          </span>
        </div>
      </header>

      {err && <div style={{ color: "var(--neg)", fontSize: 12 }}>{err}</div>}

      <SizingTable unit={30} multiple={sizing.maxRiskMultiple} />

      {(data?.games ?? []).map((g) => {
        const regime = suggestions.regimeBySlug.get(g.key);
        return (
          <section key={g.key} style={{
            border: "1px solid var(--border)", borderRadius: 10, padding: 10,
            background: "var(--card)", display: "grid", gap: 8, minWidth: 0,
          }}>
            <div style={{ display: "grid", gap: 2 }}>
              <b style={{ fontSize: 14 }}>{g.teamB} @ {g.teamA}</b>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {/* With the rules OFF no regime is computed at all, so print
                    the switch state rather than an "unknown regime" sentence
                    that would read as a data problem. */}
                {!rulesOn ? "week-2 rules OFF — the pre-2026-09-07 star"
                  : regime ? regimeWords(regime) : "regime not computed"}
              </span>
            </div>
            <GameBetsPanel
              section={suggestions.bySlug.get(g.key)}
              browse={suggestions.browseBySlug.get(g.key) ?? []}
              verdict={suggestions.pregameBySlug.get(g.key)}
              hiddenByFilter={suggestions.hiddenBySlug.get(g.key) ?? 0}
              tailCount={suggestions.tailCountBySlug.get(g.key) ?? 0}
              unit={30}
              sizing={sizing}
              onSizingMode={setSizeMode}
              token=""
              feeParams={FEES}
              quotedAt={suggestions.computedAt}
              ordersLive={false}
              modeFilter="all" onModeFilter={() => {}}
              typeFilter="all" onTypeFilter={() => {}}
              showTails onShowTails={() => {}}
              regime={regime}
              edgeRules={rulesOn}
              onEdgeRules={() => {}}
              onProject={() => {}}
            />
          </section>
        );
      })}
    </div>
  );
}
