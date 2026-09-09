// src/components/BookTree.tsx
//
// THE SETTLED TREE, on /mybook. The cuts and every number are computed in
// src/lib/bookTree.ts; this file only draws them.
//
// THE BAR TEST (house style, docs/AGENT_BRIEF.md). Every node is ONE row and
// the verdict is ONE shape:
//
//     ▸ Spread          ▁▁▁█████       −$54.02   n 37
//                       └ shared axis   −1.08u    54%
//       ^                    ^             ^        ^
//       the cut          ROI, every row    the money and the
//                        on the SAME       same money in the
//                        scale, zero in    owner's units
//                        the middle
//
// Five rules carried in from MarketEdge and the settled record:
//
//  1. THE BAR IS THE VERDICT and it is on ONE axis for the whole tree, so two
//     rows are comparable by length alone. Number-pairs never sit inline: the
//     units figure is UNDER the dollars, labelled by position, not beside it.
//  2. n < 10 IS MUTED, NEVER HIDDEN — an absent cell reads as "no signal" when
//     it is really "no sample". The row dims and the popover says so.
//  3. WORDS ON TAP. Every node and every group carries a sentence explaining
//     what the cut is asking; nothing on the row itself explains itself.
//  4. THE TOP BRANCH IS THE DIVISION (owner 2026-09-09). FBS / FCS / "no
//     published game" open by default because they are the frame, not a
//     finding; every family under them starts collapsed, as before.
//  5. THE BETS ARE NOT IN THE TREE. Tapping a node SELECTS it; the "Show bets"
//     pull-up (a bottom sheet on a phone, a side panel on a desktop) lists
//     that node's settled markets. A tree that inlines its leaves is a
//     statement, not a cut.

import { Fragment, useMemo, useState } from "react";
import {
  buildBookTree, checkTree, familyLabel, nodeLines, DIVISION_NODE_KEYS,
  type SettledBet, type TreeGroup, type TreeNode,
} from "../lib/bookTree";
import { cheerLabelWithGame } from "../lib/kalshiPortal";
import { getTeamLogo } from "../utils/teamLogo";
import BetLabel from "./BetLabel";

/* ------------------------------------------------------------- money ------ */

const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
const signedUsd = (v: number) =>
  Math.abs(v) < 0.005 ? "$0.00" : `${v > 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
const signedUnits = (v: number) =>
  Math.abs(v) < 0.005 ? "0.00u" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}u`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) =>
  Math.abs(v) < 0.0005 ? "0.0%" : `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;

type Tone = "pos" | "neg" | "flat";
const toneOf = (v: number | null): Tone =>
  v === null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "pos" : "neg";

/* -------------------------------------------------------------- the tree -- */

export default function BookTree({ bets, unit, teamsOf }: {
  bets: SettledBet[];
  /** The profile's unit size (settings RPC). 0 = not known; units are then
   *  simply not printed rather than divided by a guess. */
  unit: number;
  /** slug key -> real team names, for the sheet's wording and logos. */
  teamsOf?: (b: SettledBet) => { teamA: string; teamB: string } | undefined;
}) {
  const root = useMemo(() => {
    const t = buildBookTree(bets);
    // RULE 1 of bookTree.ts, checked at runtime: no test runner here, so a
    // tree whose parts do not add up warns in the console rather than
    // quietly rendering a wrong breakdown.
    checkTree(t);
    return t;
  }, [bets]);

  /** ONE axis for the whole tree: the widest |ROI| any node reached, so bar
   *  length is comparable between two rows at any depth. Floored at 25% so a
   *  flat book does not render as five full-width bars. */
  const axis = useMemo(() => {
    let max = 0.25;
    const walk = (n: TreeNode) => {
      if (n.stats.roi !== null) max = Math.max(max, Math.abs(n.stats.roi));
      for (const g of n.groups) for (const c of g.nodes) walk(c);
    };
    walk(root);
    return max;
  }, [root]);

  // Root and the DIVISIONS start open; families start collapsed. The keys are
  // the fixed level-1 keys rather than a walk of `root`, because this
  // initializer runs once and the first render can precede the settlements.
  // A key for a division this book has no bets on is simply inert.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(["root", ...DIVISION_NODE_KEYS]),
  );
  const [selected, setSelected] = useState<string>("root");
  const [words, setWords] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const find = (key: string): TreeNode | null => {
    const walk = (n: TreeNode): TreeNode | null => {
      if (n.key === key) return n;
      for (const g of n.groups) for (const c of g.nodes) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(root);
  };
  const sel = find(selected) ?? root;

  if (!bets.length) return null;

  return (
    <div className="booktree">
      <Row
        node={root} axis={axis} unit={unit}
        expanded={open.has(root.key)} selected={selected === root.key}
        onToggle={() => toggle(root.key)}
        onSelect={() => setSelected(root.key)}
        onWords={() => setWords(nodeLines(root, unit).join(" "))}
      />
      {open.has(root.key) && (
        <Groups
          groups={root.groups} axis={axis} unit={unit} open={open} selected={selected}
          onToggle={toggle} onSelect={setSelected} onWords={setWords}
        />
      )}

      {words && (
        <div role="status" className="booktree__pop">
          <span>{words}</span>
          <button type="button" className="ui-btn booktree__close" onClick={() => setWords(null)}>
            Close
          </button>
        </div>
      )}

      {/* THE SELECTION BAR. It is the one place the tree says what "Show bets"
          would show, so a tap never opens a sheet whose contents are a
          surprise. */}
      <div className="booktree__actions">
        <span className="booktree__selname">
          {sel.key === "root" ? "All settled" : sel.label}
          <span className="booktree__seln">{sel.stats.n} {sel.stats.n === 1 ? "bet" : "bets"}</span>
        </span>
        <button
          type="button" className="ui-btn" data-primary="true"
          onClick={() => setSheet(true)}
          disabled={!sel.stats.n}
        >
          Show bets
        </button>
      </div>

      {sheet && (
        <BetsSheet node={sel} unit={unit} teamsOf={teamsOf} onClose={() => setSheet(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- one group -- */

function Groups({ groups, axis, unit, open, selected, onToggle, onSelect, onWords }: {
  groups: TreeGroup[];
  axis: number; unit: number;
  open: Set<string>; selected: string;
  onToggle: (k: string) => void;
  onSelect: (k: string) => void;
  onWords: (w: string) => void;
}) {
  return (
    <div className="booktree__groups">
      {groups.map((g) => (
        <div className="booktree__group" key={g.key}>
          <button
            type="button" className="booktree__grouphead"
            onClick={() => onWords(g.words)}
            aria-label={`${g.label}. ${g.words}`}
          >
            {g.label}
            <span className="booktree__info" aria-hidden="true">?</span>
          </button>
          {g.nodes.map((n) => (
            <Fragment key={n.key}>
              <Row
                node={n} axis={axis} unit={unit}
                expanded={open.has(n.key)} selected={selected === n.key}
                onToggle={() => onToggle(n.key)}
                onSelect={() => onSelect(n.key)}
                onWords={() => onWords(nodeLines(n, unit).join(" "))}
              />
              {open.has(n.key) && n.groups.length > 0 && (
                <Groups
                  groups={n.groups} axis={axis} unit={unit} open={open} selected={selected}
                  onToggle={onToggle} onSelect={onSelect} onWords={onWords}
                />
              )}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- one row -- */

function Row({ node, axis, unit, expanded, selected, onToggle, onSelect, onWords }: {
  node: TreeNode;
  axis: number; unit: number;
  expanded: boolean; selected: boolean;
  onToggle: () => void; onSelect: () => void; onWords: () => void;
}) {
  const s = node.stats;
  const tone = toneOf(s.net);
  const roi = s.roi;
  // Half-width bar off a centre line: sign is POSITION as well as colour, so
  // the row is never colour-alone (the deutan rule at the top of theme.css).
  const w = roi === null ? 0 : Math.min(1, Math.abs(roi) / axis) * 50;

  return (
    <div
      className="booktree__row"
      data-depth={Math.min(node.depth, 3)}
      data-sel={selected ? "true" : undefined}
      data-weak={node.underpowered ? "true" : undefined}
    >
      {node.groups.length > 0 ? (
        <button
          type="button" className="booktree__twist" onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="booktree__twist booktree__twist--leaf" aria-hidden="true" />
      )}

      <button
        type="button" className="booktree__main" onClick={onSelect}
        aria-pressed={selected}
        aria-label={nodeLines(node, unit).join(" ")}
      >
        <span className="booktree__label">{node.label}</span>

        <span className="booktree__bar" aria-hidden="true">
          <span className="booktree__axis" />
          {roi !== null && (
            <span
              className="booktree__fill" data-tone={tone}
              style={roi >= 0
                ? { left: "50%", width: `${w}%` }
                : { right: "50%", width: `${w}%` }}
            />
          )}
        </span>

        <span className="booktree__money">
          <span className="booktree__net" data-tone={tone}>{signedUsd(s.net)}</span>
          <span className="booktree__units">
            {unit > 0 ? signedUnits(s.net / unit) : roi === null ? "" : signedPct(roi)}
          </span>
        </span>

        <span className="booktree__sample">
          <span className="booktree__n">n {s.n}</span>
          <span className="booktree__hit">{s.hit === null ? "—" : pct(s.hit)}</span>
        </span>
      </button>

      <button
        type="button" className="booktree__info booktree__info--btn"
        onClick={onWords} aria-label={`What ${node.label} means`}
      >
        ?
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- the sheet -- */

/**
 * The selected node's settled bets. A bottom sheet on a phone and a right-hand
 * panel on a desktop — one component, the difference is CSS, because the
 * content is identical and two components would drift.
 */
function BetsSheet({ node, unit, teamsOf, onClose }: {
  node: TreeNode;
  unit: number;
  teamsOf?: (b: SettledBet) => { teamA: string; teamB: string } | undefined;
  onClose: () => void;
}) {
  const s = node.stats;
  return (
    <div className="booktree__sheet" role="dialog" aria-modal="false"
         aria-label={`Settled bets in ${node.label}`}>
      <div className="booktree__sheethead">
        <span className="booktree__sheettitle">{node.label}</span>
        <span className="booktree__sheetsum">
          {s.n} {s.n === 1 ? "bet" : "bets"} · {signedUsd(s.net)}
          {unit > 0 ? ` · ${signedUnits(s.net / unit)}` : ""}
          {s.roi === null ? "" : ` · ${signedPct(s.roi)}`}
        </span>
        <button type="button" className="ui-btn booktree__sheetx" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="booktree__sheetbody">
        {node.bets.map((b) => <BetRow key={b.key} bet={b} teamsOf={teamsOf} />)}
      </div>
    </div>
  );
}

function BetRow({ bet, teamsOf }: {
  bet: SettledBet;
  teamsOf?: (b: SettledBet) => { teamA: string; teamB: string } | undefined;
}) {
  const game = teamsOf?.(bet) ?? (bet.game ? { teamA: bet.game.home, teamB: bet.game.away } : undefined);
  const tone: Tone = bet.result === "won" ? "pos" : bet.result === "lost" ? "neg" : "flat";
  const when = bet.settledMs
    ? new Date(bet.settledMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";
  const matchup = game ? `${game.teamB} @ ${game.teamA}` : "not on a published week";
  const away = game ? getTeamLogo(game.teamB) : undefined;
  const home = game ? getTeamLogo(game.teamA) : undefined;
  return (
    <div className="booktree__bet">
      <span className="booktree__betwhen">{when}</span>
      <span className="booktree__betmain">
        {/* THE MATCHUP IS ITS LOGOS (owner 2026-09-09, the feed's rule): the
            two marks with a small "at" between them ARE "Rutgers at Ohio
            State", and the spelt-out names are the tooltip and the accessible
            name. A bet that joined no published game has no logos to draw and
            keeps its words. */}
        <span className="booktree__betmatch" role="img" aria-label={matchup} title={matchup}>
          {(away || home) ? (
            <span className="booktree__betlogos" style={{ gap: 3, alignItems: "center" }}>
              {away && <img src={away} alt="" width={14} height={14} loading="lazy" />}
              <span aria-hidden style={{ fontSize: 9, fontWeight: 800, color: "var(--muted)" }}>
                at
              </span>
              {home && <img src={home} alt="" width={14} height={14} loading="lazy" />}
            </span>
          ) : matchup}
        </span>
        <span className="booktree__betside">
          <span className="booktree__betfam">{familyLabel(bet.fam)}</span>
          {/* Same words as the feed and the book strip: the bet's own team as
              its logo, "points" and the bare "total" dropped. The matchup line
              above already says which game, so no dim pair here. */}
          <BetLabel label={cheerLabelWithGame(bet.ticker, bet.side, game)}
                    home={game?.teamA} away={game?.teamB} size={16} />
        </span>
      </span>
      <span className="booktree__betprice">
        <span>{bet.avgPrice === null ? "—" : `${Math.round(bet.avgPrice * 100)}¢`}</span>
        <span className="booktree__betcost">{usd(bet.cost)}</span>
      </span>
      <span className="booktree__betmark" data-tone={tone} aria-hidden="true" />
      <span className="booktree__betnet" data-tone={tone}>{signedUsd(bet.net)}</span>
    </div>
  );
}
