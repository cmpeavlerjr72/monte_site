// src/components/TopEdges.tsx
//
// The slate's biggest edges, in three lists: game lines, everything merged,
// and player props.
//
// All three rank by SIGNED edge — "where does the sim like a bet more than the
// market" — and every row is a real, placeable bet: the market's own line, one
// side of it, both sources' price for that exact bet.
//
// One asymmetry worth knowing when reading the OVERALL column: a prop's side
// is CHOSEN as whichever way the sim leans, so prop edges are non-negative by
// construction, while a game edge is pinned to the book's line and can be
// negative. Props therefore crowd the merged list. That is a property of the
// definitions, not a bug.

import { useMemo } from "react";
import {
  rankEdges, rankProps, rankOverall, pricedRowCount, hoursSince,
  type SlateScan, type EdgeEntry, type OverallEntry,
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

/** Overlapped pair for a game, single badge for a player. */
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
              {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={30} radius={7} />)}
            </div>
          : children}
      </div>
      {footer && <div className="edge-col__foot">{footer}</div>}
    </section>
  );
}

/* ------------------------------- game rows -------------------------------- */
function GameRow({ e, rank, onPick, tag }: {
  e: EdgeEntry; rank: number; onPick: (slug: string) => void; tag?: boolean;
}) {
  return (
    <button type="button" className="edge-row" onClick={() => onPick(e.slug)}
      title={`Go to ${e.teamB} @ ${e.teamA}`}>
      <span className="edge-row__rank">{rank}</span>
      <Logos teams={[e.teamB, e.teamA]} />
      <span className="edge-row__main">
        <span className="edge-row__t1">
          {tag && <span className="edge-tag" data-kind="game">LINE</span>}
          {e.row.market}
        </span>
        <span className="edge-row__t2">
          {shortTeam(e.teamB)} @ {shortTeam(e.teamA)}
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
function PropRow({ p, rank, onPick, tag }: {
  p: PropEdge; rank: number; onPick: (slug: string) => void; tag?: boolean;
}) {
  return (
    <button type="button" className="edge-row" onClick={() => onPick(p.slug)}
      title={`Go to ${p.teamB} @ ${p.teamA}`}>
      <span className="edge-row__rank">{rank}</span>
      <Logos teams={[p.playerTeam]} />
      <span className="edge-row__main">
        <span className="edge-row__t1">
          {tag && <span className="edge-tag" data-kind="prop">PROP</span>}
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
          {p.price !== undefined
            ? <>{p.price > 0 ? `+${p.price}` : p.price}{p.book ? ` · ${p.book}` : ""}</>
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
  const overall = useMemo(
    () => (scan ? rankOverall(scan.byGame, scan.props, 10) : []),
    [scan]
  );
  const counts = useMemo(() => (scan ? pricedRowCount(scan.byGame) : null), [scan]);

  /** Props footer: missing file, staleness, or a short count. */
  const propsFooter = useMemo(() => {
    if (!scan) return null;
    if (scan.propsStatus === "missing") return "Props odds not published for this week yet.";
    if (scan.propsStatus === "error") return "Props odds unavailable right now.";
    const age = hoursSince(scan.propsUpdated);
    const stale = age !== null && age > 36 && scan.propsUpdated
      ? `Odds as of ${new Date(scan.propsUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
      : null;
    const short = props.length < 10 ? `Only ${props.length} prop edge${props.length === 1 ? "" : "s"} priced.` : null;
    return [short, stale].filter(Boolean).join(" ") || null;
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

        <Column title="Overall" count={overall.length ? `${overall.length}` : undefined}
          loading={loading}
          footer={scan?.propsStatus !== "ok" ? "Game lines only until props publish." : null}>
          {overall.length
            ? overall.map((o: OverallEntry, i) =>
                o.kind === "game"
                  ? <GameRow key={`o-g-${o.game.slug}:${o.game.row.key}`} e={o.game} rank={i + 1} onPick={onPick} tag />
                  : <PropRow key={`o-p-${o.prop.slug}:${o.prop.player}:${o.prop.stat}`} p={o.prop} rank={i + 1} onPick={onPick} tag />
              )
            : <div className="edge-col__empty">Nothing priced yet.</div>}
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
