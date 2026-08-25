// src/components/TopEdges.tsx
//
// The slate's biggest edges, in two tables: game lines and player props.
//
// Both rank by SIGNED edge — "where does the sim like a bet more than the
// market" — and every row is a real, placeable bet: the market's own line, one
// side of it, both sources' price for that exact bet.
//
// Logo rule: a win or spread row is a bet ON one team, so it badges that team
// alone; a total is a bet on the game, so it shows both. Anything else would
// imply a side the row does not take.

import { useMemo } from "react";
import {
  rankEdges, rankProps, pricedRowCount, hoursSince,
  type SlateScan, type EdgeEntry,
} from "../lib/edges";
import { americanOdds, pctText } from "../lib/marketEdge";
import { propLabel, type PropEdge } from "../lib/propEdge";
import { getTeamLogo } from "../utils/teamLogo";
import { Skeleton } from "./Skeleton";

type Props = {
  scan: SlateScan | null;
  loading: boolean;
  onPick: (slug: string) => void;
  onClose: () => void;
};

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
function GameRow({ e, rank, onPick }: {
  e: EdgeEntry; rank: number; onPick: (slug: string) => void;
}) {
  // A total is a bet on the game (both logos); win/spread take one side.
  const teams = e.row.sideTeam ? [e.row.sideTeam] : [e.teamB, e.teamA];
  return (
    <button type="button" className="edge-row" onClick={() => onPick(e.slug)}
      title={`Go to ${e.teamB} @ ${e.teamA}`}>
      <span className="edge-row__rank">{rank}</span>
      <Logos teams={teams} />
      <span className="edge-row__main">
        <span className="edge-row__t1">{e.row.market}</span>
        <span className="edge-row__t2">
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
    </button>
  );
}

/* ------------------------------- prop rows -------------------------------- */
function PropRow({ p, rank, onPick }: {
  p: PropEdge; rank: number; onPick: (slug: string) => void;
}) {
  return (
    <button type="button" className="edge-row" onClick={() => onPick(p.slug)}
      title={`Go to ${p.teamB} @ ${p.teamA}`}>
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
    </button>
  );
}

export default function TopEdges({ scan, loading, onPick, onClose }: Props) {
  const games = useMemo(() => (scan ? rankEdges(scan.byGame, 10) : []), [scan]);
  const props = useMemo(() => (scan ? rankProps(scan.props, 10) : []), [scan]);
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

  return (
    <section className="top-edges" role="dialog" aria-label="Top edges on this slate">
      <header className="top-edges__head">
        <span style={{ fontWeight: 800, color: "var(--brand-text)", letterSpacing: 0.2 }}>
          Top edges
        </span>
        <span className="parlay-chip" style={{ fontSize: 11 }}>
          {loading ? "computing…" : `${games.length + props.length} priced`}
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
                <GameRow key={`${e.slug}:${e.row.key}`} e={e} rank={i + 1} onPick={onPick} />
              ))
            : <div className="edge-col__empty">No game-line edges could be priced.</div>}
        </Column>

        <Column title="Player props" count={props.length ? `${props.length}` : undefined}
          loading={loading} footer={propsFooter}>
          {props.length
            ? props.map((p, i) => (
                <PropRow key={`${p.slug}:${p.player}:${p.stat}:${p.line}`} p={p} rank={i + 1} onPick={onPick} />
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
