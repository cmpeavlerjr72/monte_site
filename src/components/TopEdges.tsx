// src/components/TopEdges.tsx
//
// The slate's biggest edges, in three tables: game lines, team & game props
// (Kalshi team-stat/period markets), and player props — in that order, team
// markets ranked above player props as a product priority. Team-market rows
// flagged THIN/TAIL/NOISE are never shown (site rule, filtered in edges.ts);
// the column footer reports how many the rule hid.
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
  rankEdges, rankProps, propOversBelowEv, rankTeamMarkets, isTradeableTeamMarket,
  pricedRowCount, hoursSince,
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
// The week-2 decision rules — LABELS ONLY (src/lib/edgeRules.ts). Nothing
// here filters: a labelled row keeps its rank, its numbers and its "+".
import { RegimeTrendBlock } from "./RegimeTrend";
import {
  ABSTAIN_WORDS, CELL_TAG, abstainTag, labelFor, starWords, starFor,
  UNKNOWN_REGIME, NO_LABEL, engineWords,
  type AbstainReason, type CellName, type GameRegime,
} from "../lib/edgeRules";

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

/**
 * The verdict number for a row.
 *
 * `title` exists because the pill carries different quantities in different
 * columns and the number alone cannot say which: a two-sided row's verdict is
 * the probability gap in points, while an over-only binary's verdict is EV per
 * $1 staked (there is no other side to compare a gap against, and EV is what
 * decides the bet). Same pill, same sign colouring, one hover that names it.
 */
function EdgePill({ edge, title }: { edge: number; title?: string }) {
  return (
    <span className="top-edges__edge" data-sign={edge >= 0 ? "pos" : "neg"}
      title={title ?? "sim probability minus market, in points"}>
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

/* --------------------- week-2 decision-rule marks -------------------------- */
/**
 * "NOT A TARGET · <reason>" and the star's cell name, in the same words and
 * the same colourless channel the Bets panel uses (see SuggestedBets.tsx).
 * A labelled row is still ranked, still priced, still addable to a parlay —
 * owner rule 2026-08-30: stars and abstentions are labels, never a filter.
 */
function RuleMark({ abstain, cell, starred }: {
  abstain: AbstainReason | null;
  cell: CellName | null;
  starred: boolean;
}) {
  if (abstain) {
    return (
      <span className="edge-flag" style={{ marginLeft: 5 }}
            title={ABSTAIN_WORDS[abstain]}>
        NO · {abstainTag(abstain)}
      </span>
    );
  }
  if (starred && cell) {
    return (
      <span className="edge-flag" style={{ marginLeft: 5 }} title={starWords(cell)}>
        {CELL_TAG[cell]}
      </span>
    );
  }
  return null;
}

/**
 * The team a published team-market row's YES event NAMES, off Kalshi's own
 * sentence. Only the team-total wording is parsed, because that is the ONLY
 * family in team_markets.json an R1 rule can bite: full-game SPREAD is not
 * published there (the site prices it itself), and every half family is
 * abstained or star-suppressed by series alone.
 *
 * Names come from Kalshi's title verbatim and are compared through
 * `cfbNameKey` downstream — never retyped (hard-won rule 1).
 */
function teamTotalTeam(title: string): string | undefined {
  // ONE regex for this wording — the same constant the parlay LegSpec maps
  // off, declared above. A second copy is a second thing to drift.
  return TEAM_TOTAL_TITLE_RE.exec(title.trim())?.[1];
}

/* ------------------------------- game rows -------------------------------- */
function GameRow({ e, rank, regime, rulesApply, onPick, onAddLeg }: {
  e: EdgeEntry; rank: number; regime: GameRegime;
  /** Do the week-1 labels describe this week's ENGINE? False = no label at
   *  all (edgeRules.ts `rulesApplyFor`). */
  rulesApply: boolean;
  onPick: (slug: string) => void;
  onAddLeg: (slug: string, spec: LegSpec) => void;
}) {
  // A total is a bet on the game (both logos); win/spread take one side.
  const teams = e.row.sideTeam ? [e.row.sideTeam] : [e.teamB, e.teamA];
  const spec = legSpecForGameRow(e.row, e.teamA, e.teamB);
  // WEEK-2 LABEL. `sideTeam` is already the team this row's bet BACKS
  // (marketEdge.ts picks the side the sim leans and mirrors the price), which
  // is exactly what R1's dog-side test needs.
  //
  // NO STAR IS DRAWN IN THIS TABLE, and that is deliberate: `e.edge` here is
  // sim − market, GROSS of the fee. The ★ is a claim about a fee-adjusted
  // net edge, so awarding one off a gross number would be a new and weaker
  // claim wearing the same mark. The Bets panel, which prices net, owns it.
  const rule = rulesApply ? labelFor({
    series: e.row.key === "win" ? "KXNCAAFGAME"
      : e.row.key === "spread" ? "KXNCAAFSPREAD" : "KXNCAAFTOTAL",
    side: "yes",
    backsTeam: e.row.sideTeam,
    homeTeam: e.teamA,
  }, regime) : NO_LABEL;
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
        <span className="edge-row__t1">
          {e.row.market}
          <RuleMark abstain={rule.abstain} cell={rule.cell} starred={false} />
        </span>
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
/**
 * The rung list of a ladder candidate.
 *
 * House bar-test grammar (Team Stats v3): every rung's price and sim
 * probability sit on ONE shared 0-100% axis so the SHAPE of the disagreement
 * is what you see, and exactly ONE number per rung is printed at rest — the
 * fee-inclusive EV, which is the number that decides the bet. The price is a
 * tick on the axis, the sim is the fill; how far the fill runs past the tick
 * IS the edge, so there is no number-pair to read.
 */
function LadderRungs({ p }: { p: PropEdge }) {
  const rungs = p.ladderRungs ?? [];
  if (!rungs.length) return null;
  return (
    <div className="prop-ladder">
      <div className="prop-ladder__note">
        {rungs.length} rungs on one player — perfectly correlated. This is a
        shape bet on {p.player}&rsquo;s distribution, <b>not</b> diversification:
        size the whole set as one position.
        {p.ladderBoardAdjacent === false && (
          <> Rungs are not neighbours on the venue&rsquo;s full listed ladder,
          so the strikes between them never traded.</>
        )}
      </div>
      {rungs.map((r) => {
        const sim = Math.max(0, Math.min(1, r.sim_over));
        const px = Math.max(0, Math.min(1, r.px_cents / 100));
        return (
          <div className="prop-rung" key={r.line}>
            <span className="prop-rung__k">{r.line}+</span>
            <span className="prop-rung__axis" aria-hidden="true">
              <span className="prop-rung__fill" style={{ width: `${sim * 100}%` }} />
              <span className="prop-rung__tick" style={{ left: `${px * 100}%` }} />
            </span>
            <span className="prop-rung__ev" data-sign={r.ev_fee2 >= 0 ? "pos" : "neg"}>
              {r.ev_fee2 >= 0 ? "+" : ""}{(r.ev_fee2 * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
      {p.ladderCombinedEv !== undefined && (
        <div className="prop-ladder__foot">
          equal stake per rung ·{" "}
          <b>{p.ladderCombinedEv >= 0 ? "+" : ""}
            {(p.ladderCombinedEv * 100).toFixed(0)}%</b> EV on the position
        </div>
      )}
    </div>
  );
}

function PropRow({ p, rank, onPick, onAddLeg }: {
  p: PropEdge; rank: number; onPick: (slug: string) => void;
  onAddLeg: (slug: string, spec: LegSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  // An over-only venue has no under to bet, so the decision number is EV per
  // $1 staked, not the probability gap — and there is no second side button
  // anywhere on this row by construction.
  const verdict = p.overOnly ? (p.evFee ?? p.edge) : p.edge;
  return (
    <>
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
            {p.ladder && (
              <button
                type="button"
                className="edge-flag edge-flag--ladder"
                data-primary={open ? "true" : undefined}
                aria-expanded={open}
                title="ladder candidate — two or more consecutive rungs clear the EV floor; tap for the rungs"
                onClick={(ev) => { ev.stopPropagation(); setOpen((v) => !v); }}
                onKeyDown={(ev) => ev.stopPropagation()}
              >
                Ladder {open ? "▾" : "▸"}
              </button>
            )}
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
            {/* The venue is named once in the column footer, not per row. */}
            {p.priceCents !== undefined
              ? `${p.priceCents}¢${p.nTrades !== undefined ? ` · ${p.nTrades} trade${p.nTrades === 1 ? "" : "s"}` : ""}`
              : p.price !== undefined
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
        <EdgePill
          edge={verdict}
          title={p.overOnly
            ? "EV per $1 staked, after a flat 2¢ round trip"
            : "sim probability minus market, in points"}
        />
        <AddLegButton label={propLabel(p)} onAdd={() => onAddLeg(p.slug, legSpecForPropRow(p))} />
      </div>
      {p.ladder && open && <LadderRungs p={p} />}
    </>
  );
}

/* ---------------------------- team-market rows ---------------------------- */

/**
 * Compact bet-style label for a Kalshi team-market row (user rule
 * 2026-08-26: "USC wins the 1st half" reads as "USC 1H ML", "UNLV scores
 * over 19.5 points" as "UNLV u19.5 TT", etc.).
 *
 * Orientation: where the NO contract has an exact book-notation complement
 * (totals -> u, spreads -> opponent +line, OT -> "No OT") the label states
 * the bet the row actually recommends. Winner and half/full-time markets
 * have no clean complement, so they keep the YES phrasing and the side
 * badge names the contract. A title no pattern recognizes falls back to
 * Kalshi's own sentence — new families render honestly, never blank.
 */
function shortTeamMarketTitle(r: TeamMarketRow, teamA: string, teamB: string): string {
  const t = r.title.trim();
  const no = r.side === "NO";
  let m: RegExpExecArray | null;

  // "UNLV scores over 19.5 points" -> "UNLV o19.5 TT" / "UNLV u19.5 TT"
  if ((m = /^(.+?) scores over ([\d.]+) points$/i.exec(t)))
    return `${shortTeam(m[1])} ${no ? "u" : "o"}${m[2]} TT`;

  // "USC wins 1H by over 20.5 points" -> "USC 1H -20.5";
  // NO is the exact complement bet: opponent +20.5 (half-point line).
  if ((m = /^(.+?) wins (1H|2H) by over ([\d.]+) points$/i.exec(t))) {
    const [, team, half, pts] = m;
    if (no) {
      const key = cfbNameKey(team);
      const opp = key === cfbNameKey(teamA) ? teamB
        : key === cfbNameKey(teamB) ? teamA : null;
      if (opp) return `${shortTeam(opp)} ${half} +${pts}`;
      // Unresolved name: keep the YES bet, the badge still names the side.
    }
    return `${shortTeam(team)} ${half} -${pts}`;
  }

  // "Over 47.5 1H points scored" -> "1H o47.5" / "1H u47.5"
  if ((m = /^Over ([\d.]+) (1H|2H) points scored$/i.exec(t)))
    return `${m[2]} ${no ? "u" : "o"}${m[1]}`;

  // "Stanford wins the 1st half" -> "Stanford 1H ML"; "Tie in the 2nd half"
  if ((m = /^(.+?) wins the (1st|2nd) half$/i.exec(t)))
    return `${shortTeam(m[1])} ${m[2] === "1st" ? "1H" : "2H"} ML`;
  if ((m = /^Tie in the (1st|2nd) half$/i.exec(t)))
    return `${m[1] === "1st" ? "1H" : "2H"} Tie`;

  // "TCU wins 1st Half / TCU wins game" -> "HT/FT TCU / TCU"
  if ((m = /^(.+?) wins 1st Half \/ (.+?) wins game$/i.exec(t)))
    return `HT/FT ${shortTeam(m[1])} / ${shortTeam(m[2])}`;
  if ((m = /^Tie in 1st Half \/ (.+?) wins game$/i.exec(t)))
    return `HT/FT Tie / ${shortTeam(m[1])}`;

  // "1+ overtime periods" -> "OT" / "No OT"
  if ((m = /^(\d)\+ overtime periods$/i.exec(t)))
    return m[1] === "1" ? (no ? "No OT" : "OT") : `OT ${m[1]}+`;

  return t;
}

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

function TeamMktRow({ r, teamA, teamB, rank, regime, publisherRules, rulesApply, onPick, onAddLeg }: {
  r: TeamMarketRow; teamA: string; teamB: string; rank: number;
  /** This game's week-2 regime, for the rows the publisher did not label. */
  regime: GameRegime;
  /** Which rule set the PUBLISHER ran ("wk2" or null). */
  publisherRules: string | null;
  /** Do the week-1 labels describe this week's ENGINE? False = no label,
   *  and the star is the plain bar (edgeRules.ts `rulesApplyFor`). */
  rulesApply: boolean;
  onPick: (slug: string) => void;
  onAddLeg: (slug: string, spec: LegSpec) => void;
}) {
  const spec = legSpecForTeamMarketRow(r, teamA, teamB);
  const p = sideProb(r);
  const { bid, ask } = sidePriceCents(r);
  // WEEK-2 LABEL.
  //
  // THE PUBLISHER WINS WHERE IT SPOKE. When team_markets.json was written
  // with `--rules wk2` every row already carries `abstain` and `cell`,
  // computed in cfb-props-sim off the lines parquet and the CFBD conference
  // columns — a strictly better regime source than anything reachable here.
  // The site only labels these rows itself when that column does not exist,
  // which is the state of every export before 2026-09-07.
  const published = publisherRules === "wk2";
  const rule = !rulesApply
    ? NO_LABEL
    : published
    ? {
        abstain: (r.abstain || null) as AbstainReason | null,
        cell: (r.cell || null) as CellName | null,
      }
    : labelFor({
        series: r.series,
        side: r.side === "NO" ? "no" : "yes",
        // Only the team-total wording names a team here; every other
        // published family is decided by series alone.
        backsTeam: teamTotalTeam(r.title),
        homeTeam: teamA,
      }, regime);
  // R3+R4 on top of the publisher's own `target`. `ask` is in cents; the
  // rules band is in dollars. Flagged rows never reach this component, so
  // `tail` is already false by construction (site rule, edges.ts).
  const starred = r.target === true && starFor(
    { cell: rule.cell, abstain: rule.abstain, tail: false,
      price: ask / 100, edge: r.ev_fee, series: r.series },
    rulesApply ? regime.axis : "off",
  );
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
        {/* Compact bet-style label; Kalshi's full sentence stays reachable on
            hover. Flagged rows never reach this component (site rule). */}
        <span className="edge-row__t1 edge-row__t1--wrap" title={r.title}>
          {starred ? (
            <span
              className="edge-row__target-star"
              title={starWords(rule.cell)}
              aria-label="target bet"
            >★ </span>
          ) : null}
          {shortTeamMarketTitle(r, teamA, teamB)}
          <RuleMark abstain={rule.abstain} cell={rule.cell} starred={starred} />
        </span>
        <span className="edge-row__t2">
          <span className="division-badge">{r.side}</span>
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
  /** Tradeable = unflagged (the site rule lives in edges.ts). Chips only
   *  offer families that still have rows after the filter, so no chip ever
   *  opens an empty top 10. */
  const tradeableTeamMkts = useMemo(
    () => (scan ? scan.teamMarkets.filter(isTradeableTeamMarket) : []),
    [scan]
  );
  const seriesChips = useMemo(
    () => orderedSeries(tradeableTeamMkts.map((r) => r.series)),
    [tradeableTeamMkts]
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
    // An over-only venue lists no under contract at all, so the reader has to
    // be told that the missing side is the market's shape and not a filter we
    // applied — and how many of its overs the sim priced but did not rank.
    if (scan.propsSideOnly === "over") {
      parts.push("overs only — this venue lists no under contract");
      const below = propOversBelowEv(scan.props);
      if (below) parts.push(`${below} more priced, none at positive EV`);
    }
    if (scan.propsFeeModel === "none_published_flat2") {
      parts.push("EV after a flat 2¢ round trip (venue publishes no fee schedule)");
    }
    if (props.length < 10) parts.push(`only ${props.length} prop edge${props.length === 1 ? "" : "s"} priced`);
    return parts.join(" · ") || null;
  }, [scan, props.length]);

  const gamesFooterCount = counts && counts.priced < counts.total
    ? `${counts.priced} of ${counts.total} game markets priced — the rest have no matching Kalshi line.`
    : null;
  // The engine line. Only worth a footer when it CHANGES what the marks mean:
  // a week whose engine has no measured rulebook prints nothing "not a
  // target", so the reader is told why the labels they saw last week are gone.
  const engineFooter = scan && !scan.rulesApply ? engineWords(scan.engine) : null;
  const gamesFooter = [gamesFooterCount, engineFooter].filter(Boolean).join(" · ") || null;

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
    // The site rule's receipt: how many priced rows the flag filter hid.
    const hidden = scan.teamMarkets.length - tradeableTeamMkts.length;
    if (hidden > 0) parts.push(`${hidden} hidden (thin/tail/noise)`);
    if (scan.teamMarketsWithheld > 0) {
      parts.push(`${scan.teamMarketsWithheld} withheld (book too thin to price)`);
    }
    // "shown of pool" counts the tradeable family being viewed.
    const pool = teamSeries
      ? tradeableTeamMkts.filter((r) => r.series === teamSeries).length
      : tradeableTeamMkts.length;
    if (pool > teamMkts.length) {
      parts.push(`${teamMkts.length} of ${pool}${teamSeries ? ` ${seriesLabel(teamSeries)}` : ""} shown`);
    }
    return parts.join(" · ") || null;
  }, [scan, teamMkts.length, teamSeries, tradeableTeamMkts]);

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
                <GameRow
                  key={`${e.slug}:${e.row.key}`} e={e} rank={i + 1}
                  regime={scan?.regimeBySlug.get(e.slug) ?? UNKNOWN_REGIME}
                  rulesApply={scan?.rulesApply ?? false}
                  onPick={onPick} onAddLeg={onAddLeg}
                />
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
                  regime={scan?.regimeBySlug.get(r.slug) ?? UNKNOWN_REGIME}
                  publisherRules={scan?.teamMarketsRules ?? null}
                  rulesApply={scan?.rulesApply ?? false}
                  onPick={onPick} onAddLeg={onAddLeg}
                />
              ))
            : <div className="edge-col__empty">
                {scan?.teamMarketsStatus === "missing"
                  ? "Team markets not published for this week yet."
                  : scan && scan.teamMarkets.length > 0
                    ? "No tradeable team-market edges — every current quote is thin, tail, or noise."
                    : "No team-market edges could be priced."}
              </div>}
        </Column>

        {/* Title says which bet this column is offering. On an over-only venue
            "Player props" would imply both sides exist; "Top prop overs" is
            what the reader can actually place. */}
        <Column
          title={scan?.propsSideOnly === "over" ? "Top prop overs" : "Player props"}
          count={props.length ? `${props.length}` : undefined}
          loading={loading} footer={propsFooter}>
          {props.length
            ? props.map((p, i) => (
                <PropRow key={`${p.slug}:${p.player}:${p.stat}:${p.line}`} p={p} rank={i + 1} onPick={onPick} onAddLeg={onAddLeg} />
              ))
            : <div className="edge-col__empty">
                {scan?.propsStatus === "missing"
                  ? "Props odds not published for this week yet."
                  : scan?.propsSideOnly === "over" && scan.props.length > 0
                    ? "Every priced over on this venue is at negative EV after fees — nothing to buy, and there is no under to sell."
                    : "No prop edges could be priced."}
              </div>}
        </Column>
      </div>
      {/* The served engine's settled-replay regime cells. Only drawn when the
          week-1 rulebook does NOT describe this engine — that is exactly when
          the reader has lost the labels and needs to see how the regime has
          fared instead. Trend, never a rule (owner, 2026-09-08). */}
      {scan && !scan.rulesApply && scan.trend
        ? <RegimeTrendBlock trend={scan.trend} engine={scan.engine} />
        : null}
    </section>
  );
}
