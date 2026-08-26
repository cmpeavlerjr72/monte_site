// src/components/TopEdges.tsx
//
// The slate's biggest edges, in three tables: game lines, team & game props
// (Kalshi team-stat/period markets), and player props — in that order, team
// markets ranked above player props as a product priority.
//
// All three rank by SIGNED edge (team markets rank by fee-adjusted EV, the
// only one of the three already priced net of the taker fee) — "where does
// the sim like a bet more than the market" — and every row is a real,
// placeable bet: the market's own line, one side of it, both sources' price
// for that exact bet.
//
// Logo rule: a win or spread row is a bet ON one team, so it badges that team
// alone; a total is a bet on the game, so it shows both. Anything else would
// imply a side the row does not take.

import { useMemo, useState } from "react";
import {
  rankEdges, rankProps, rankTeamMarkets, pricedRowCount, hoursSince,
  type SlateScan, type EdgeEntry,
} from "../lib/edges";
import { americanOdds, pctText, type MarketRow } from "../lib/marketEdge";
import { propLabel, type PropEdge } from "../lib/propEdge";
import { snapHalf, type LegSpec, type TeamRef } from "../lib/parlay";
import type { TeamMarketRow } from "../lib/cfbJson";
import { getTeamLogo } from "../utils/teamLogo";
import { Skeleton } from "./Skeleton";
// Reused, not reimplemented: the site's ONE Kalshi<->slate team-name join.
// team_markets.json's titles carry Kalshi's spelling ("North Carolina St."),
// which is a different string than our own team names ("NC State") for about
// half of a given slate's games. See server/cfbNames.ts's header for why a
// second normalizer here would be exactly the collision bug it exists to
// prevent — this import keeps it a single source of truth instead.
import { cfbNameKey } from "../../server/cfbNames";

type Props = {
  scan: SlateScan | null;
  loading: boolean;
  onPick: (slug: string) => void;
  onClose: () => void;
  /** Quick-add a leg straight from a row, bypassing LegPicker entirely. */
  onAddLeg: (slug: string, spec: LegSpec) => void;
};

/*
 * Row -> LegSpec mapping (the ONLY place this decision is made).
 *
 * - Spread row -> spread leg for the row's own side, at the row's own line.
 *   `row.line` is already oriented to `row.sideTeam` (see marketEdge.ts), the
 *   same convention LegSpec.spread.line uses, so it carries straight over.
 * - Total row -> total leg at the row's side + line.
 * - WIN row -> there is no moneyline LegSpec kind. A win is encoded as a
 *   SPREAD leg at -0.5 for the picked team: game margins are integers, so
 *   "covers a -0.5 line" is exactly "wins outright," and a half-point line
 *   can never push. This is exact, not an approximation.
 *
 * Lines are snapped to the half-point grid with the same `snapHalf` LegPicker
 * uses, so a row added here and the "equivalent" leg built by hand in
 * LegPicker land on the identical LegSpec (and therefore the identical slip
 * dedupe id).
 */
function legSpecForGameRow(row: MarketRow, teamA: string, teamB: string): LegSpec | null {
  if (row.key === "total") {
    if (row.line === undefined || !row.side) return null;
    return { kind: "total", side: row.side, line: snapHalf(row.line) };
  }
  if (!row.sideTeam) return null;
  const team: TeamRef = row.sideTeam === teamA ? "A" : row.sideTeam === teamB ? "B" : "A";
  if (row.key === "win") return { kind: "spread", team, line: -0.5 };
  if (row.key === "spread" && row.line !== undefined) {
    return { kind: "spread", team, line: snapHalf(row.line) };
  }
  return null;
}

function legSpecForPropRow(p: PropEdge): LegSpec {
  return {
    kind: "prop",
    player: p.player,
    stat: p.stat,
    side: p.side,
    line: snapHalf(p.line),
    playerTeam: p.playerTeam,
  };
}

/**
 * Team-market row -> LegSpec, for the ONE series the seeds.json builder can
 * price today: full-game team totals (KXNCAAFTEAMTOTAL). seeds.json publishes
 * A_pts/B_pts per seed and nothing at the half/period level, so 1H/2H
 * spread-total-winner, fulltime and OT markets have no seed column to price a
 * joint against — no LegSpec for those, by design, not an oversight.
 *
 * Team-total titles are always phrased as the YES event, "<Team> scores over
 * <strike> points" (see cfbJson's team_markets note), so side=YES is over and
 * side=NO is under; strike is already a half-point line.
 */
const TEAM_TOTAL_TITLE_RE = /^(.+?) scores over [\d.]+ points$/i;

function legSpecForTeamMarketRow(r: TeamMarketRow, teamA: string, teamB: string): LegSpec | null {
  if (r.series !== "KXNCAAFTEAMTOTAL" || r.strike === null) return null;
  const m = TEAM_TOTAL_TITLE_RE.exec(r.title);
  if (!m) return null;

  const key = cfbNameKey(m[1]);
  let team: TeamRef;
  if (key === cfbNameKey(teamA)) team = "A";
  else if (key === cfbNameKey(teamB)) team = "B";
  else return null; // unresolved name -> no button; never guess which side

  return {
    kind: "teamTotal",
    team,
    side: r.side === "YES" ? "over" : "under",
    line: snapHalf(r.strike),
  };
}

/** sim_p is P(YES); orient it to the side the row actually recommends. */
const sideProb = (r: TeamMarketRow) => (r.side === "YES" ? r.sim_p : 1 - r.sim_p);

/**
 * Executable price for the recommended side, in cents.
 *
 * yes_bid/yes_ask price the YES contract; a NO contract at this same strike
 * costs 1 - the YES side's opposing price (buying NO = selling YES), so the
 * NO side's bid/ask are the complements taken in the opposite order.
 */
function sidePriceCents(r: TeamMarketRow): { bid: number; ask: number } {
  if (r.side === "YES") return { bid: Math.round(r.yes_bid * 100), ask: Math.round(r.yes_ask * 100) };
  return { bid: Math.round((1 - r.yes_ask) * 100), ask: Math.round((1 - r.yes_bid) * 100) };
}

/** Small "+" quick-add, right-aligned, from the shared .ui-btn family. */
function AddLegButton({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <button
      type="button"
      className="ui-btn edge-row__add"
      aria-label={`Add ${label} to parlay slip`}
      title={`Add ${label} to parlay slip`}
      onClick={(ev) => { ev.stopPropagation(); onAdd(); }}
      onKeyDown={(ev) => ev.stopPropagation()}
    >
      +
    </button>
  );
}

/** One badge per team; an overlapped pair when a row covers both. */
function Logos({ teams, size = 18 }: { teams: string[]; size?: number }) {
  const found = teams.map((t) => getTeamLogo(t)).filter(Boolean) as string[];
  if (!found.length) return <span style={{ width: size + 8, flexShrink: 0 }} aria-hidden />;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      {found.map((src, i) => (
        <img key={i} src={src} alt="" width={size} height={size} loading="lazy"
          style={{ objectFit: "contain", marginLeft: i ? -7 : 0, zIndex: found.length - i }} />
      ))}
    </span>
  );
}

const shortTeam = (s: string) => (s.length > 13 ? `${s.slice(0, 12)}…` : s);

/** Marks an FCS row on a merged ranking. FBS rows stay unbadged — the default
 *  slate should not grow a label just because a second division exists. */
function DivisionTag({ division }: { division?: string }) {
  if (division !== "fcs") return null;
  return <span className="division-badge" data-division="fcs">FCS</span>;
}

function EdgePill({ edge }: { edge: number }) {
  return (
    <span className="top-edges__edge" data-sign={edge >= 0 ? "pos" : "neg"}>
      {edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1)}
    </span>
  );
}

function Column({
  title, count, loading, footer, children,
}: {
  title: string; count?: string; loading: boolean;
  footer?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <section className="edge-col">
      <header className="edge-col__head">
        <span className="edge-col__title">{title}</span>
        {count && <span className="parlay-chip" style={{ fontSize: 10 }}>{count}</span>}
      </header>
      <div className="edge-col__body">
        {loading
          ? <div style={{ display: "grid", gap: 5 }}>
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={30} radius={7} />)}
            </div>
          : children}
      </div>
      {footer && <div className="edge-col__foot">{footer}</div>}
    </section>
  );
}

/* ------------------------------- game rows -------------------------------- */
function GameRow({ e, rank, onPick, onAddLeg }: {
  e: EdgeEntry; rank: number; onPick: (slug: string) => void;
  onAddLeg: (slug: string, spec: LegSpec) => void;
}) {
  // A total is a bet on the game (both logos); win/spread take one side.
  const teams = e.row.sideTeam ? [e.row.sideTeam] : [e.teamB, e.teamA];
  const spec = legSpecForGameRow(e.row, e.teamA, e.teamB);
  return (
    // A row body click scrolls to the card; the "+" is a separate control, so
    // this is a div (a <button> cannot nest a <button>), not the original
    // <button>. role="button" + tabIndex + onKeyDown keep it keyboard-operable.
    <div
      className="edge-row" role="button" tabIndex={0}
      onClick={() => onPick(e.slug)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick(e.slug); }
      }}
      title={`Go to ${e.teamB} @ ${e.teamA}`}
    >
      <span className="edge-row__rank">{rank}</span>
      <Logos teams={teams} />
      <span className="edge-row__main">
        <span className="edge-row__t1">{e.row.market}</span>
        <span className="edge-row__t2">
          <DivisionTag division={e.division} />
          {shortTeam(e.teamB)} @ {shortTeam(e.teamA)}
          {e.row.approxNote ? ` · ${e.row.approxNote}` : ""}
        </span>
      </span>
      <span className="edge-row__num">
        <b>{pctText(e.row.simP!)}</b><i>{americanOdds(e.row.simP!)}</i>
      </span>
      <span className="edge-row__num">
        <b>{pctText(e.row.mktP!)}</b><i>{americanOdds(e.row.mktP!)}</i>
      </span>
      <EdgePill edge={e.edge} />
      {spec
        ? <AddLegButton label={`${e.row.market} (${e.teamB} @ ${e.teamA})`} onAdd={() => onAddLeg(e.slug, spec)} />
        : <span aria-hidden />}
    </div>
  );
}

/* ------------------------------- prop rows -------------------------------- */
function PropRow({ p, rank, onPick, onAddLeg }: {
  p: PropEdge; rank: number; onPick: (slug: string) => void;
  onAddLeg: (slug: string, spec: LegSpec) => void;
}) {
  return (
    <div
      className="edge-row" role="button" tabIndex={0}
      onClick={() => onPick(p.slug)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick(p.slug); }
      }}
      title={`Go to ${p.teamB} @ ${p.teamA}`}
    >
      <span className="edge-row__rank">{rank}</span>
      <Logos teams={[p.playerTeam]} />
      <span className="edge-row__main">
        <span className="edge-row__t1">
          {propLabel(p)}
          {p.flagged && (
            <span
              className="edge-flag"
              title="high-usage over — sim tends to over-project these; see props caveats"
            >
              T3
            </span>
          )}
        </span>
        <span className="edge-row__t2">
          {/* The book is named once in the column footer, not per row. */}
          {p.price !== undefined
            ? `${p.price > 0 ? "+" : ""}${p.price}`
            : shortTeam(p.playerTeam)}
        </span>
      </span>
      <span className="edge-row__num">
        <b>{pctText(p.simP)}</b><i>{americanOdds(p.simP)}</i>
      </span>
      <span className="edge-row__num">
        <b>{pctText(p.fairP)}</b><i>{americanOdds(p.fairP)}</i>
      </span>
      <EdgePill edge={p.edge} />
      <AddLegButton label={propLabel(p)} onAdd={() => onAddLeg(p.slug, legSpecForPropRow(p))} />
    </div>
  );
}

/* ---------------------------- team-market rows ---------------------------- */
/** Human tooltip text for the toolkit's flags — the same three every row on
 *  this table can carry, so spelling them out once beats repeating a title
 *  string per flag per row. */
const TEAM_MKT_FLAG_TITLE: Record<string, string> = {
  THIN: "thin book — wide bid/ask, the binding filter at 10k sims",
  TAIL: "tail strike — far from the median, priced but low-volume",
  NOISE: "edge is within the sim's own noise band at this sample size",
};

/** Human names for the Kalshi series tickers. An unknown new family — Kalshi
 *  is still adding them — falls back to the ticker minus the exchange prefix,
 *  so nothing the toolkit starts pricing later renders blank here. */
const SERIES_LABEL: Record<string, string> = {
  KXNCAAFTEAMTOTAL: "Team total",
  KXNCAAF1H: "1H winner",
  KXNCAAF1HWINNER: "1H winner",
  KXNCAAF1HSPREAD: "1H spread",
  KXNCAAF1HTOTAL: "1H total",
  KXNCAAF1HFT: "Half/full",
  KXNCAAF2H: "2H winner",
  KXNCAAF2HSPREAD: "2H spread",
  KXNCAAF2HTOTAL: "2H total",
  KXNCAAFOT: "Overtime",
};
const seriesLabel = (s: string) => SERIES_LABEL[s] ?? s.replace(/^KXNCAAF/, "");

/** Chip order: team totals first (the one family the parlay slip can add),
 *  then game-clock order 1H → half/full → 2H → OT; families the map doesn't
 *  know yet follow, A–Z. */
const SERIES_ORDER = Object.keys(SERIES_LABEL);
function orderedSeries(present: Iterable<string>): string[] {
  const set = new Set(present);
  const known = SERIES_ORDER.filter((s) => set.has(s));
  const unknown = [...set].filter((s) => !SERIES_ORDER.includes(s)).sort();
  return [...known, ...unknown];
}

function TeamMktRow({ r, teamA, teamB, rank, onPick, onAddLeg }: {
  r: TeamMarketRow; teamA: string; teamB: string; rank: number;
  onPick: (slug: string) => void;
  onAddLeg: (slug: string, spec: LegSpec) => void;
}) {
  const spec = legSpecForTeamMarketRow(r, teamA, teamB);
  const p = sideProb(r);
  const { bid, ask } = sidePriceCents(r);
  return (
    <div
      className="edge-row" role="button" tabIndex={0}
      onClick={() => onPick(r.slug)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick(r.slug); }
      }}
      title={`Go to ${teamB} @ ${teamA}`}
    >
      <span className="edge-row__rank">{rank}</span>
      <Logos teams={[teamB, teamA]} />
      <span className="edge-row__main">
        {/* Full-sentence Kalshi title gets two lines; the flags live on the
            meta row below so an ellipsis can never swallow a THIN warning. */}
        <span className="edge-row__t1 edge-row__t1--wrap">{r.title}</span>
        <span className="edge-row__t2">
          <span className="division-badge">{r.side}</span>
          {r.flags.map((f) => (
            <span key={f} className="edge-flag" title={TEAM_MKT_FLAG_TITLE[f] ?? f}>{f}</span>
          ))}
          {shortTeam(teamB)} @ {shortTeam(teamA)}
        </span>
      </span>
      <span className="edge-row__num">
        <b>{pctText(p)}</b><i>{americanOdds(p)}</i>
      </span>
      <span className="edge-row__num">
        <b>{ask}¢</b><i>bid {bid}¢</i>
      </span>
      <EdgePill edge={r.ev_fee} />
      {spec
        ? <AddLegButton label={r.title} onAdd={() => onAddLeg(r.slug, spec)} />
        : <span aria-hidden />}
    </div>
  );
}

export default function TopEdges({ scan, loading, onPick, onClose, onAddLeg }: Props) {
  const games = useMemo(() => (scan ? rankEdges(scan.byGame, 10) : []), [scan]);
  const props = useMemo(() => (scan ? rankProps(scan.props, 10) : []), [scan]);
  /** Market-family filter for the team-markets column: null = all families,
   *  otherwise one series ticker. A selection the current scan no longer
   *  carries (week change) falls back to All by derivation — no state write
   *  during render, nothing for an effect to chase. */
  const [teamSeriesRaw, setTeamSeriesRaw] = useState<string | null>(null);
  const seriesChips = useMemo(
    () => (scan ? orderedSeries(scan.teamMarkets.map((r) => r.series)) : []),
    [scan]
  );
  const teamSeries = teamSeriesRaw !== null && seriesChips.includes(teamSeriesRaw)
    ? teamSeriesRaw : null;

  /** Ranked rows joined to their matchup via slug (same join every other
   *  table uses against the week index). A row whose slug is not in byGame —
   *  should not happen once a week is fully published, but never render an
   *  "undefined @ undefined" if it somehow does — is dropped rather than
   *  guessed at. */
  const teamMkts = useMemo(() => {
    if (!scan) return [];
    return rankTeamMarkets(scan.teamMarkets, 10, teamSeries ?? undefined)
      .map((r) => {
        const g = scan.byGame.get(r.slug);
        return g ? { r, teamA: g.teamA, teamB: g.teamB } : null;
      })
      .filter((x): x is { r: TeamMarketRow; teamA: string; teamB: string } => x !== null);
  }, [scan, teamSeries]);
  const counts = useMemo(() => (scan ? pricedRowCount(scan.byGame) : null), [scan]);

  /** Props footer: which book, how old, and whether the list came up short. */
  const propsFooter = useMemo(() => {
    if (!scan) return null;
    if (scan.propsStatus === "missing") return "Props odds not published for this week yet.";
    if (scan.propsStatus === "error") return "Props odds unavailable right now.";

    const when = scan.propsUpdated
      ? new Date(scan.propsUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const age = hoursSince(scan.propsUpdated);
    const parts: string[] = [];

    if (scan.propsBook) parts.push(`odds: ${scan.propsBook}${when ? `, as of ${when}` : ""}`);
    else if (when) parts.push(`odds as of ${when}`);

    // Anything older than a day and a half is worth calling out explicitly.
    if (age !== null && age > 36) parts.push("(stale)");
    if (props.length < 10) parts.push(`only ${props.length} prop edge${props.length === 1 ? "" : "s"} priced`);
    return parts.join(" · ") || null;
  }, [scan, props.length]);

  const gamesFooter = counts && counts.priced < counts.total
    ? `${counts.priced} of ${counts.total} game markets priced — the rest have no matching Kalshi line.`
    : null;

  /** Team-markets footer: source note, staleness, and how many the toolkit
   *  withheld outright (book too thin to price at all). */
  const teamMktsFooter = useMemo(() => {
    if (!scan) return null;
    if (scan.teamMarketsStatus === "missing") return "Team markets not published for this week yet.";
    if (scan.teamMarketsStatus === "error") return "Team markets unavailable right now.";

    const when = scan.teamMarketsUpdated
      ? new Date(scan.teamMarketsUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const age = hoursSince(scan.teamMarketsUpdated);
    const parts: string[] = [];

    parts.push(`Kalshi${when ? `, as of ${when}` : ""}`);
    if (age !== null && age > 36) parts.push("(stale)");
    if (scan.teamMarketsWithheld > 0) {
      parts.push(`${scan.teamMarketsWithheld} withheld (book too thin to price)`);
    }
    // "shown of pool" counts the family being viewed, not the whole file.
    const pool = teamSeries
      ? scan.teamMarkets.filter((r) => r.series === teamSeries).length
      : scan.teamMarkets.length;
    if (pool > teamMkts.length) {
      parts.push(`${teamMkts.length} of ${pool}${teamSeries ? ` ${seriesLabel(teamSeries)}` : ""} shown`);
    }
    return parts.join(" · ") || null;
  }, [scan, teamMkts.length, teamSeries]);

  return (
    <section className="top-edges" role="dialog" aria-label="Top edges on this slate">
      <header className="top-edges__head">
        <span style={{ fontWeight: 800, color: "var(--brand-text)", letterSpacing: 0.2 }}>
          Top edges
        </span>
        <span className="parlay-chip" style={{ fontSize: 11 }}>
          {loading ? "computing…" : `${games.length + props.length + teamMkts.length} priced`}
        </span>
        <button type="button" className="ui-btn" onClick={onClose}
          style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}>
          Close
        </button>
      </header>

      <div className="edge-cols">
        <Column title="Game lines" count={games.length ? `${games.length}` : undefined}
          loading={loading} footer={gamesFooter}>
          {games.length
            ? games.map((e, i) => (
                <GameRow key={`${e.slug}:${e.row.key}`} e={e} rank={i + 1} onPick={onPick} onAddLeg={onAddLeg} />
              ))
            : <div className="edge-col__empty">No game-line edges could be priced.</div>}
        </Column>

        <Column title="Team & game props" count={teamMkts.length ? `${teamMkts.length}` : undefined}
          loading={loading} footer={teamMktsFooter}>
          {seriesChips.length > 1 && (
            <div className="edge-serieschips" aria-label="Market family">
              <button type="button" className="ui-btn"
                data-on={teamSeries === null ? "true" : "false"}
                aria-pressed={teamSeries === null}
                onClick={() => setTeamSeriesRaw(null)}>
                All
              </button>
              {seriesChips.map((s) => (
                <button key={s} type="button" className="ui-btn"
                  data-on={teamSeries === s ? "true" : "false"}
                  aria-pressed={teamSeries === s}
                  onClick={() => setTeamSeriesRaw(s)}>
                  {seriesLabel(s)}
                </button>
              ))}
            </div>
          )}
          {teamMkts.length
            ? teamMkts.map(({ r, teamA, teamB }, i) => (
                <TeamMktRow
                  key={`${r.slug}:${r.market_ticker}`}
                  r={r} teamA={teamA} teamB={teamB} rank={i + 1}
                  onPick={onPick} onAddLeg={onAddLeg}
                />
              ))
            : <div className="edge-col__empty">
                {scan?.teamMarketsStatus === "missing"
                  ? "Team markets not published for this week yet."
                  : "No team-market edges could be priced."}
              </div>}
        </Column>

        <Column title="Player props" count={props.length ? `${props.length}` : undefined}
          loading={loading} footer={propsFooter}>
          {props.length
            ? props.map((p, i) => (
                <PropRow key={`${p.slug}:${p.player}:${p.stat}:${p.line}`} p={p} rank={i + 1} onPick={onPick} onAddLeg={onAddLeg} />
              ))
            : <div className="edge-col__empty">
                {scan?.propsStatus === "missing"
                  ? "Props odds not published for this week yet."
                  : "No prop edges could be priced."}
              </div>}
        </Column>
      </div>
    </section>
  );
}
