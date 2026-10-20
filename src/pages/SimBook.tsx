// src/pages/SimBook.tsx — THE SIM BOOK at /simbook (owner 2026-10-19).
//
// A private sportsbook where the sim is the house. An invited friend bets units
// on DraftKings' lines at the house's prices (straights and parlays); the server
// re-prices every bet, locks it at kickoff and grades it from the finals.
// No nav entry: the page answers only for invited players and the owner.
// Server + pricing rules: server/simbook.ts. Tables: 20261019_simbook.sql.
//
// LAYOUT (owner 2026-10-19): the scoreboard's grammar. One card per game (logos,
// away row on top, Spread / Total / ML cells); tapping a card opens a full-width
// drawer with tabs for every bet type and prop stat. The slip is the
// scoreboard's parlay slip: 2+ legs default to a COMBO (the house wants parlays:
// juice compounds per leg), with a Singles toggle and Clear.
//
// The bettor NEVER sees the sim's or the market's probability, only prices.
// The owner additionally sees, per ticket, the sim %, DK's no-vig % and the
// house's expected value, so "did the sim beat him" can be read off one card.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession, getAccessToken, supabaseEnabled } from "../lib/supabase";
import { getTeamLogo } from "../utils/teamLogo";
import { displayTeamColor } from "../utils/teamColors";
import { useIsDark } from "../lib/usePrefs";
import AuthPanel from "../components/AuthPanel";
import "../styles/simbook.css";

type Me = { allowed: boolean; owner: boolean; player: { name: string; max_stake: number } | null; lines: boolean; preview?: boolean;
            /** owner only: SportsGameOdds reads this month */
            sgo?: { used: number; cap: number; guard: number; last_run?: string; status?: string } | null };
type SlateGame = {
  slug: string; home: string; away: string; kickoff: string; started: boolean;
  /** consensus line for the closed card: home handicap, game total */
  spread?: number | null; total?: number | null;
  /** the card's game lines at the house's prices, off the server's snapshot */
  offers?: Offer[]; as_of?: string; no_lines?: boolean;
  /** the snapshot is past its max age: nothing is served until the next refresh */
  stale?: boolean;
  /** client-side: the server is still reading this week's boards */
  warming?: boolean;
};
type Offer = {
  key: string; label: string; group: string; sub: string; main: boolean; market: string; side: string;
  line: number | null; american: number; dec: number; parlay_ok: boolean;
  dk_american?: number; q_sim?: number; p_mkt?: number; house_ev?: number;
  /** props: the player's team */
  team?: "home" | "away";
};
type Board = { slug: string; home: string; away: string; kickoff: string; started: boolean; has_lines: boolean; offers: Offer[]; as_of?: string | null; stale?: boolean };
type BoardState = { board?: Board; err?: string; loading?: boolean };
type SlipLeg = {
  key: string; label: string; american: number; dec: number; parlay_ok: boolean;
  slug: string; home: string; away: string; market: string; side: string;
};
type Ticket = {
  id: string; user_id: string; created_at: string; week: number; kind: "single" | "parlay"; stake: number; american: number;
  decimal_odds: number; status: "open" | "won" | "lost" | "push" | "void"; payout: number | null; settled_at: string | null;
  p_sim?: number; p_mkt?: number; house_ev?: number; dk_decimal?: number;
  legs: { label: string; game: string; kickoff: string; market: string; american: number; dk_american?: number; result: string | null;
          score: number | null; close_line: number | null; close_american: number | null; line: number | null; side: string; main?: boolean; p_sim?: number; p_mkt?: number }[];
};
type Player = { user_id: string; name: string; active: boolean; max_stake: number };

const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const u = (n: number, sign = false) => `${sign && n > 0 ? "+" : ""}${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}u`;
const pct = (p?: number) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
const amToDec = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const kick = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(",", " ·") + " ET";

const ERRORS: Record<string, string> = {
  not_invited: "This book is invite-only.",
  started: "That game has kicked off. Bets are closed.",
  leg_gone: "That line just moved off the board. Reopen the game and pick again.",
  parlay_push: "Whole-number lines can push, so they can't go in a combo. Switch to singles or swap that leg.",
  same_market: "Two sides of the same bet, or two lines of it, can't go in one combo.",
  ml_spread: "A moneyline and a spread from the same game can't go in one combo.",
  stat_overlap: "A player's stat and a combo stat that includes it can't go in one combo.",
  too_many_same_game: "Max 6 legs from one game in a combo.",
  parlay_thin: "Those legs almost never hit together, so the house can't price that combo.",
  too_correlated: "Those legs move together too much to price as a combo. Bet them as singles or swap one.",
  parlay_dead: "The house won't write that combo.",
  parlay_short: "That combo is too short a price to write.",
  bad_stake: "Check the stake: it has to be above 0 and under your limit (max payout 250u).",
  budget: "The line feed is paused for the rest of the month.",
  no_lines: "The line feed isn't connected yet.",
  preview: "Preview mode: these are sample prices, so betting is off until the DraftKings feed is connected.",
  owner_is_the_house: "You're the house. Only players can bet.",
  slow_down: "Easy. Too many bets in a minute.",
  bad_legs: "Pick 1 to 8 legs.",
  dup_leg: "That leg is already on the slip.",
  stale_lines: "Those lines are being updated. Bets on that game reopen after the next refresh.",
};

async function api(path: string, init?: RequestInit) {
  const jwt = await getAccessToken();
  const r = await fetch(path, {
    ...init, cache: "no-store",
    headers: { ...(init?.headers || {}), authorization: `Bearer ${jwt}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
  let body: any = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { ok: r.ok, status: r.status, body };
}

/** Logo, or a team-colored square when we have no logo. */
function Logo({ team, px = 22 }: { team: string; px?: number }) {
  const isDark = useIsDark();
  const src = getTeamLogo(team);
  return src
    ? <img src={src} alt="" width={px} height={px} loading="lazy" className="sbx-logo" />
    : <span className="sbx-logo sbx-logo--blank" style={{ width: px, height: px, background: displayTeamColor(team, isDark) ?? "var(--brand)" }} aria-hidden />;
}

/** Which teams a leg is about, for the slip's logos. */
function legTeams(l: SlipLeg): string[] {
  if (l.market === "total" || l.market === "prop") return [l.away, l.home];
  return [l.side.startsWith("home") ? l.home : l.away];
}

/* ----------------------------------------------------------------- board */
/** Prop tabs (owner 2026-10-19): one tab per category, one row per player,
 *  one column per stat. The first column sorts the rows (QB1 / RB1 / WR1 on top). */
const PROP_GROUPS: { id: string; cols: [sub: string, head: string][] }[] = [
  { id: "Passing", cols: [["Passing yards", "Yards"], ["Passing TDs", "TDs"], ["Pass attempts", "Att"], ["Completions", "Comp"], ["Interceptions thrown", "INT"]] },
  { id: "Rushing", cols: [["Rushing yards", "Yards"], ["Carries", "Carries"]] },
  { id: "Receiving", cols: [["Receiving yards", "Yards"], ["Receptions", "Rec"]] },
  { id: "Touchdowns", cols: [["Anytime TD", "Anytime"], ["Touchdowns scored", "TDs"]] },
  { id: "Combos", cols: [["Pass + rush yards", "Pass+Rush"], ["Rush + rec yards", "Rush+Rec"]] },
];

/** One price cell: the line on top, the house price under it. Same footprint as the scoreboard's market cell. */
function Cell({ o, top, slipKeys, toggle, owner, wide = false }: {
  o?: Offer; top?: string; slipKeys: Set<string>; toggle: (o: Offer) => void; owner: boolean; wide?: boolean;
}) {
  if (!o) return <div className="sbx-cell sbx-cell--empty" aria-hidden />;
  const on = slipKeys.has(o.key);
  return (
    <button type="button" className={wide ? "sbx-cell sbx-cell--wide" : "sbx-cell"} data-on={on ? "true" : undefined}
            onClick={() => toggle(o)} aria-pressed={on} aria-label={`${o.label} ${am(o.american)}`}
            title={owner ? `sim ${pct(o.q_sim)} · DK no-vig ${pct(o.p_mkt)} · DK ${o.dk_american != null ? am(o.dk_american) : "—"} · house EV ${pct(o.house_ev)}` : undefined}>
      {top ? <span className="sbx-cell__line">{top}</span> : null}
      <span className="sbx-cell__price">{am(o.american)}</span>
      {owner && <span className="sbx-cell__own">sim {pct(o.q_sim)}</span>}
    </button>
  );
}

/** A muted line with no price yet (the card at rest, before the board loads). */
function RestCell({ text }: { text?: string }) {
  return <div className="sbx-cell sbx-cell--rest">{text ? <span className="sbx-cell__line">{text}</span> : null}</div>;
}

/** Distinct lines of a two-sided market, DK's main line first. */
function linesOf(os: Offer[], refSide: (o: Offer) => boolean, refLine: (o: Offer) => number) {
  const seen: number[] = [];
  const refs = os.filter(refSide).sort((x, y) => Number(y.main) - Number(x.main));
  for (const o of [...refs, ...os]) { const l = refLine(o); if (!seen.includes(l)) seen.push(l); }
  return seen;
}

/** Spread / total / ML pickers off a board, shared by the card and the drawer. */
function gameMarkets(offers: Offer[]) {
  const sp = offers.filter((o) => o.market === "spread");
  const to = offers.filter((o) => o.market === "total");
  const ml = offers.filter((o) => o.market === "ml");
  const spLines = linesOf(sp, (o) => o.side === "away", (o) => (o.side === "away" ? o.line! : -o.line!)); // keyed by AWAY handicap
  const toLines = linesOf(to, (o) => o.side === "over", (o) => o.line!);
  const spAt = (side: "away" | "home", awayLine?: number) =>
    awayLine == null ? undefined : sp.find((o) => o.side === side && o.line === (side === "away" ? awayLine : -awayLine));
  const toAt = (side: "over" | "under", line?: number) => (line == null ? undefined : to.find((o) => o.side === side && o.line === line));
  const mlAt = (side: "away" | "home") => ml.find((o) => o.side === side);
  return { sp, to, ml, spLines, toLines, spAt, toAt, mlAt };
}

function GameCard({ g, st, open, onOpen, slipKeys, toggle, owner }: {
  g: SlateGame; st?: BoardState; open: boolean; onOpen: () => void;
  slipKeys: Set<string>; toggle: (o: Offer, g: SlateGame) => void; owner: boolean;
}) {
  // a freshly opened board beats the slate's snapshot
  const fresh = st?.board && !st.board.started && st.board.has_lines && !st.board.stale ? st.board.offers : null;
  const offers = g.started ? null : fresh ?? (g.offers?.length ? g.offers : null);
  const board = offers ? { offers } : null;
  const m = board ? gameMarkets(board.offers) : null;
  const t = (o: Offer) => toggle(o, g);
  const onArea = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    if (!g.started) onOpen();
  };
  const inSlip = board ? board.offers.filter((o) => slipKeys.has(o.key)).length : 0;
  const row = (side: "away" | "home") => {
    const team = side === "away" ? g.away : g.home;
    if (m) {
      const s0 = m.spAt(side, m.spLines[0]);
      const t0 = m.toAt(side === "away" ? "over" : "under", m.toLines[0]);
      return (
        <>
          <div className="sbx-team"><Logo team={team} /><span className="sbx-team__name" title={team}>{team}</span></div>
          <Cell o={s0} top={s0 ? sgn(s0.line!) : undefined} slipKeys={slipKeys} toggle={t} owner={owner} />
          <Cell o={t0} top={t0 ? `${side === "away" ? "O" : "U"} ${t0.line}` : undefined} slipKeys={slipKeys} toggle={t} owner={owner} />
          <Cell o={m.mlAt(side)} slipKeys={slipKeys} toggle={t} owner={owner} />
        </>
      );
    }
    const hs = g.spread;
    const spText = hs == null ? undefined : sgn(side === "home" ? hs : -hs);
    const toText = g.total == null ? undefined : `${side === "away" ? "O" : "U"} ${g.total}`;
    return (
      <>
        <div className="sbx-team"><Logo team={team} /><span className="sbx-team__name" title={team}>{team}</span></div>
        <RestCell text={spText} /><RestCell text={toText} /><RestCell />
      </>
    );
  };
  return (
    <article className="card sbx-card" data-open={open ? "true" : undefined} id={`sb-${g.slug}`}>
      <div onClick={onArea} className="sbx-card__tap">
        <div className="sbx-context">
          <span className="sbx-context__when">{g.started ? "Closed" : kick(g.kickoff)}</span>
          {inSlip > 0 && <span className="parlay-chip">{inSlip} on slip</span>}
          {(st?.loading || (!board && g.warming && !g.no_lines && !g.started)) && <span className="sbx-dim">loading prices…</span>}
          {!g.started && (
            <button type="button" className="sbx-chev" onClick={onOpen} aria-expanded={open} aria-label={`Open ${g.away} at ${g.home}`}
                    data-open={open ? "true" : undefined}>›</button>
          )}
        </div>
        <div className="sbx-grid">
          <div />
          <div className="sbx-cap">Spread</div><div className="sbx-cap">Total</div><div className="sbx-cap">ML</div>
          {row("away")}
          {row("home")}
        </div>
        {!board && !g.started && !st?.loading && (st?.err || g.stale || g.no_lines || !g.warming) && (
          <div className="sbx-dim sbx-card__hint">{st?.err ? st.err : g.stale ? "Updating lines. Prices are back after the next refresh." : g.no_lines ? "No DraftKings lines on this game yet." : "Prices aren't in yet. Tap to load them."}</div>
        )}
      </div>
    </article>
  );
}

type Tab = { id: string; label: string };

function Drawer({ g, st, onClose, onRetry, slipKeys, toggle, owner }: {
  g: SlateGame; st?: BoardState; onClose: () => void; onRetry: () => void;
  slipKeys: Set<string>; toggle: (o: Offer, g: SlateGame) => void; owner: boolean;
}) {
  const [tab, setTab] = useState("lines");
  const [q, setQ] = useState("");
  const board = st?.board;
  const offers = board?.offers || [];
  const props = offers.filter((o) => o.market === "prop");
  const tt = offers.filter((o) => o.market === "tt");
  const subs = new Set(props.map((o) => o.sub));
  const qbSet = new Set(props.filter((o) => /^Pass|^Completions|^Interceptions/.test(o.sub)).map((o) => o.group));
  const tabs: Tab[] = [
    { id: "lines", label: "Game Lines" },
    ...(tt.length ? [{ id: "tt", label: "Team Totals" }] : []),
    ...PROP_GROUPS.filter((pg) => props.some((o) => pg.cols.some(([sub]) => sub === o.sub) && !(pg.id === "Rushing" && qbSet.has(o.group))))
      .map((pg) => ({ id: `p:${pg.id}`, label: pg.id })),
  ];
  const active = tabs.some((x) => x.id === tab) ? tab : "lines";
  const t = (o: Offer) => toggle(o, g);
  const c = (o: Offer | undefined, top?: string) => <Cell o={o} top={top} slipKeys={slipKeys} toggle={t} owner={owner} wide />;

  let body: React.ReactNode;
  if (st?.err) body = <div className="sbx-empty"><p className="sb-note sb-note--neg">{st.err}</p><button type="button" className="ui-btn" onClick={onRetry}>Try again</button></div>;
  else if (!board) body = <p className="sb-note">Loading DraftKings' board…</p>;
  else if (board.started) body = <p className="sb-note">This game has kicked off. Bets are closed.</p>;
  else if (board.stale) body = <p className="sb-note">These lines are being updated. Prices come back after the next refresh.</p>;
  else if (!board.has_lines || !offers.length) body = <p className="sb-note">No DraftKings lines on this game yet. They usually post by midweek.</p>;
  else if (active === "lines") {
    const m = gameMarkets(offers);
    body = (
      <div className="sbx-sections">
        {m.ml.length > 0 && (
          <section className="sbx-section">
            <h4>Moneyline</h4>
            <div className="sbx-pairs">
              <div className="sbx-pair">
                <div className="sbx-pair__who"><Logo team={g.away} px={18} />{g.away}</div>{c(m.mlAt("away"))}
              </div>
              <div className="sbx-pair">
                <div className="sbx-pair__who"><Logo team={g.home} px={18} />{g.home}</div>{c(m.mlAt("home"))}
              </div>
            </div>
          </section>
        )}
        {m.spLines.length > 0 && (
          <section className="sbx-section">
            <h4>Spread</h4>
            <div className="sbx-two sbx-two--head"><span><Logo team={g.away} px={16} />{g.away}</span><span><Logo team={g.home} px={16} />{g.home}</span></div>
            {m.spLines.map((l) => {
              const a = m.spAt("away", l), h = m.spAt("home", l);
              return <div key={l} className="sbx-two">{c(a, a ? sgn(a.line!) : undefined)}{c(h, h ? sgn(h.line!) : undefined)}</div>;
            })}
          </section>
        )}
        {m.toLines.length > 0 && (
          <section className="sbx-section">
            <h4>Total points</h4>
            <div className="sbx-two sbx-two--head"><span>Over</span><span>Under</span></div>
            {m.toLines.map((l) => <div key={l} className="sbx-two">{c(m.toAt("over", l), `O ${l}`)}{c(m.toAt("under", l), `U ${l}`)}</div>)}
          </section>
        )}
      </div>
    );
  } else if (active === "tt") {
    body = (
      <div className="sbx-sections">
        {(["away", "home"] as const).map((who) => {
          const team = who === "away" ? g.away : g.home;
          const os = tt.filter((o) => o.side.startsWith(who));
          if (!os.length) return null;
          const lines = linesOf(os, (o) => o.side.endsWith("over"), (o) => o.line!);
          return (
            <section key={who} className="sbx-section">
              <h4><Logo team={team} px={18} />{team}</h4>
              <div className="sbx-two sbx-two--head"><span>Over</span><span>Under</span></div>
              {lines.map((l) => (
                <div key={l} className="sbx-two">
                  {c(os.find((o) => o.side.endsWith("over") && o.line === l), `O ${l}`)}
                  {c(os.find((o) => o.side.endsWith("under") && o.line === l), `U ${l}`)}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    );
  } else {
    const pg = PROP_GROUPS.find((x) => x.id === active.slice(2))!;
    const cols = pg.cols.filter(([sub]) => subs.has(sub));
    const needle = q.trim().toLowerCase();
    // player -> stat -> the offer we show (DK's main line, else the first near-even one)
    const byPlayer = new Map<string, Map<string, Offer>>();
    const teamOfPlayer = new Map<string, "home" | "away">();
    // owner 2026-10-19: no QB rushing on the Rushing tab (qbSet: anyone with a
    // passing prop, or pass + rush yards, in this game).
    const qbs = qbSet;
    for (const o of props) {
      if (!cols.some(([sub]) => sub === o.sub)) continue;
      if (pg.id === "Rushing" && qbs.has(o.group)) continue;
      const m = byPlayer.get(o.group) || new Map<string, Offer>(); byPlayer.set(o.group, m);
      if (o.team) teamOfPlayer.set(o.group, o.team);
      const cur = m.get(o.sub);
      if (!cur || (o.main && !cur.main)) m.set(o.sub, o);
    }
    const leadOf = (m: Map<string, Offer>) => {
      for (const [sub] of cols) { const o = m.get(sub); if (o) return sub === "Anytime TD" ? -o.american : (o.line ?? 0); }
      return -Infinity;
    };
    const firstCol = (m: Map<string, Offer>) => cols.findIndex(([sub]) => m.has(sub));
    // owner 2026-10-19: each team's players together (away first), most to least yards
    const rows = [...byPlayer.entries()].filter(([n]) => !needle || n.toLowerCase().includes(needle))
      .sort((x, y) => firstCol(x[1]) - firstCol(y[1]) || leadOf(y[1]) - leadOf(x[1]) || x[0].localeCompare(y[0]));
    const sections = [
      { team: g.away, rows: rows.filter(([n]) => teamOfPlayer.get(n) === "away") },
      { team: g.home, rows: rows.filter(([n]) => teamOfPlayer.get(n) === "home") },
      { team: "", rows: rows.filter(([n]) => !teamOfPlayer.has(n)) },
    ].filter((x) => x.rows.length);
    const grid = { gridTemplateColumns: `minmax(var(--sbx-name), 1fr) repeat(${cols.length}, var(--sbx-col))` };
    body = (
      <div className="sbx-sections">
        <input className="sb-search" placeholder="Find a player" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a player" />
        {rows.length ? (
          <div className="sbx-statgrid-wrap">
            <div className="sbx-statgrid" role="table" aria-label={`${pg.id} props`}>
              <div className="sbx-statrow sbx-statrow--head" role="row" style={grid}>
                <span role="columnheader">Player</span>
                {cols.map(([sub, head]) => <span key={sub} role="columnheader" title={sub}>{head}</span>)}
              </div>
              {sections.map((sec) => (
                <Fragment key={sec.team || "other"}>
                  {sections.length > 1 && (
                    <div className="sbx-statteam" role="row">
                      <span role="rowheader">{sec.team ? <><Logo team={sec.team} px={18} />{sec.team}</> : "Other"}</span>
                    </div>
                  )}
                  {sec.rows.map(([name, m]) => (
                    <div key={name} className="sbx-statrow" role="row" style={grid}>
                      <span className="sbx-statrow__name" role="rowheader">
                        {sec.team && <Logo team={sec.team} px={16} />}<span>{name}</span>
                      </span>
                      {cols.map(([sub]) => {
                        const o = m.get(sub);
                        return <Cell key={sub} o={o} top={o && sub !== "Anytime TD" ? `O ${o.line}` : undefined} slipKeys={slipKeys} toggle={t} owner={owner} wide />;
                      })}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        ) : <p className="sb-note">{needle ? "No player by that name here." : "Nothing posted."}</p>}
      </div>
    );
  }

  return (
    <section className="sbx-drawer" aria-label={`${g.away} at ${g.home}`}>
      <div className="sbx-drawer__head">
        <span className="sbx-drawer__teams"><Logo team={g.away} px={20} />{g.away}<span className="sbx-at">@</span><Logo team={g.home} px={20} />{g.home}</span>
        <span className="sbx-dim sbx-drawer__when">{kick(g.kickoff)}</span>
        <button type="button" className="ui-btn sbx-close" onClick={onClose}>Close</button>
      </div>
      {board && board.has_lines && !board.started && tabs.length > 1 && (
        <div className="sbx-tabs" role="tablist" aria-label="Bet types">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === active} data-on={x.id === active ? "true" : undefined}
                    onClick={() => setTab(x.id)}>{x.label}</button>
          ))}
        </div>
      )}
      {body}
      <p className="sb-note sbx-foot">
        DraftKings lines{board?.as_of ? ` as of ${new Date(board.as_of).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : ""}, updated through the week and more often near kickoff. Bets lock at kickoff.
      </p>
    </section>
  );
}

/** Columns the auto-fit card grid is drawing right now (so the drawer lands after the open card's row). */
const CARD_MIN = 320, CARD_GAP = 16;
function useCols(ref: React.RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + CARD_GAP) / (CARD_MIN + CARD_GAP))));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

function DayGrid({ games, openSlug, setOpen, boards, loadBoard, slipKeys, toggle, owner }: {
  games: SlateGame[]; openSlug: string | null; setOpen: (s: string | null) => void;
  boards: Record<string, BoardState>; loadBoard: (slug: string, force?: boolean) => void;
  slipKeys: Set<string>; toggle: (o: Offer, g: SlateGame) => void; owner: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cols = Math.min(useCols(ref), games.length);
  const openIdx = games.findIndex((g) => g.slug === openSlug);
  const rowEnd = openIdx < 0 ? -1 : Math.min(games.length - 1, Math.floor(openIdx / cols) * cols + cols - 1);
  return (
    <div ref={ref} className="sbx-cards">
      {games.map((g, i) => (
        <Fragment key={g.slug}>
          <GameCard g={g} st={boards[g.slug]} open={openSlug === g.slug} slipKeys={slipKeys} toggle={toggle} owner={owner}
                    onOpen={() => { if (openSlug === g.slug) setOpen(null); else { setOpen(g.slug); loadBoard(g.slug); } }} />
          {i === rowEnd && openIdx >= 0 && (
            <div className="sbx-drawer-slot">
              <Drawer g={games[openIdx]} st={boards[games[openIdx].slug]} onClose={() => setOpen(null)}
                      onRetry={() => loadBoard(games[openIdx].slug, true)} slipKeys={slipKeys} toggle={toggle} owner={owner} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ slip */
// The scoreboard's parlay slip, as a betting slip. 2+ legs open as a COMBO;
// he can flip to Singles (one bet per leg, same stake each) or clear it.
function Slip({ week, legs, remove, clear, maxStake, owner, onPlaced, onHeight }: {
  week: number; legs: SlipLeg[]; remove: (k: string) => void; clear: () => void; maxStake: number; owner: boolean;
  onPlaced: (placedKeys: string[], note?: string) => void; onHeight: (h: number) => void;
}) {
  const [mode, setMode] = useState<"combo" | "singles">("combo");
  const [picked, setPicked] = useState(false);           // he chose a mode himself
  const [stake, setStake] = useState("1");
  const [quote, setQuote] = useState<{ american: number; dec: number; corr?: "none" | "some" | "high" } | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "neg" | "pos" | "muted"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => onHeight(el.getBoundingClientRect().height));
    ro.observe(el); onHeight(el.getBoundingClientRect().height);
    return () => { ro.disconnect(); onHeight(0); };
  }, [onHeight, legs.length > 0]);

  // default: combo whenever there are 2+ legs, until he picks for himself; an emptied slip forgets the pick
  useEffect(() => { if (!legs.length) { setPicked(false); setMode("combo"); } }, [legs.length]);
  const combo = legs.length >= 2 && mode === "combo";

  const keysSig = legs.map((l) => l.key).join(",");
  useEffect(() => {
    setQuote(null); setQuoteErr(null);
    if (!combo) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await api("/api/simbook/quote", { method: "POST", body: JSON.stringify({ week, legs: legs.map((l) => l.key) }) });
      if (!alive) return;
      if (r.ok) setQuote({ american: r.body.american, dec: r.body.dec, corr: r.body.corr });
      else setQuoteErr(ERRORS[r.body?.error] || `Couldn't price that (${r.status}).`);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig, week, combo]);

  if (!legs.length) return null;
  const s = Number(stake);
  const okStake = s > 0 && s <= maxStake;
  const singleDec = legs.length === 1 ? legs[0].dec : null;
  const toWin = combo
    ? (quote && s > 0 ? s * (quote.dec - 1) : null)
    : s > 0 ? legs.reduce((a, l) => a + s * (l.dec - 1), 0) : null;
  const risk = combo || legs.length === 1 ? s : s * legs.length;
  const choose = (m: "combo" | "singles") => { setMode(m); setPicked(true); setMsg(null); };

  async function placeCombo(expect?: number) {
    if (!quote) return;
    setBusy(true); setMsg(null);
    const r = await api("/api/simbook/bet", { method: "POST", body: JSON.stringify({ week, legs: legs.map((l) => l.key), stake: s, expect_american: expect ?? quote.american }) });
    setBusy(false);
    if (r.ok) { onPlaced(legs.map((l) => l.key), `Combo placed: ${u(r.body.stake)} at ${am(r.body.american)} to win ${u(r.body.to_win)}.`); return; }
    if (r.body?.error === "price_changed") {
      setQuote({ american: r.body.american, dec: r.body.dec });
      setMsg({ tone: "muted", text: `The price moved to ${am(r.body.american)}. Tap Place again to take it.` });
      return;
    }
    setMsg({ tone: "neg", text: ERRORS[r.body?.error] || `Couldn't place it (${r.status}).` });
  }
  async function placeSingles() {
    setBusy(true); setMsg(null);
    const placed: string[] = []; let won = 0;
    for (const l of legs) {
      const r = await api("/api/simbook/bet", { method: "POST", body: JSON.stringify({ week, legs: [l.key], stake: s, expect_american: l.american }) });
      if (r.ok) { placed.push(l.key); won += r.body.to_win; continue; }
      const why = r.body?.error === "price_changed"
        ? `${l.label} moved to ${am(r.body.american)}. Reopen the game to take the new price.`
        : `${l.label}: ${ERRORS[r.body?.error] || `couldn't place it (${r.status})`}`;
      setMsg({ tone: placed.length ? "muted" : "neg", text: `${placed.length ? `Placed ${placed.length} of ${legs.length}. ` : ""}${why}` });
      break;
    }
    setBusy(false);
    if (placed.length === legs.length) onPlaced(placed, `${placed.length === 1 ? "Bet" : `${placed.length} bets`} placed: ${u(s * placed.length)} risked to win ${u(won)}.`);
    else if (placed.length) onPlaced(placed);
  }

  // legs grouped by game, as the scoreboard's slip does
  const games = new Map<string, SlipLeg[]>();
  for (const l of legs) games.set(l.slug, [...(games.get(l.slug) || []), l]);
  const title = legs.length === 1 ? "Single" : combo ? `${legs.length}-leg combo` : `${legs.length} singles`;
  const price = combo ? (quote ? am(quote.american) : quoteErr ? "—" : "…") : singleDec ? am(legs[0].american) : "";

  return (
    <aside ref={rootRef} className="parlay-slip sbx-slip" aria-label="Bet slip">
      <div className="parlay-slip__head">
        <button type="button" className="sbx-slip__title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span style={{ fontWeight: 800, color: "var(--brand-text)" }}>Bet slip</span>
          <span className="parlay-chip" style={{ fontSize: 11 }}>{legs.length} leg{legs.length === 1 ? "" : "s"}</span>
          {price && <b className="sbx-slip__price">{price}</b>}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="ui-btn" onClick={clear} style={{ padding: "4px 10px", fontSize: 12 }}>Clear</button>
          <button type="button" className="ui-btn" onClick={() => setOpen((o) => !o)} style={{ padding: "4px 10px", fontSize: 12 }}>{open ? "Hide" : "Show"}</button>
        </div>
      </div>
      {open && (
        <div className="sbx-slip__body">
          {legs.length >= 2 && (
            <div className="sbx-mode" role="radiogroup" aria-label="Bet type">
              <button type="button" role="radio" aria-checked={combo} data-on={combo ? "true" : undefined} onClick={() => choose("combo")}>Combo</button>
              <button type="button" role="radio" aria-checked={!combo} data-on={!combo ? "true" : undefined} onClick={() => choose("singles")}>Singles</button>
            </div>
          )}
          {[...games.entries()].map(([slug, ls]) => (
            <section key={slug} className="parlay-group">
              <header className="parlay-group__head">
                <span className="sbx-pairlogos"><Logo team={ls[0].away} px={16} /><Logo team={ls[0].home} px={16} /></span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{ls[0].away} @ {ls[0].home}</span>
                {combo && ls.length > 1 && <span className="parlay-chip" style={{ marginLeft: "auto", fontSize: 10 }}>same game</span>}
              </header>
              {ls.map((l) => (
                <div key={l.key} className="parlay-leg">
                  <span className="sbx-pairlogos">{legTeams(l).map((tm) => <Logo key={tm} team={tm} px={16} />)}</span>
                  <span className="parlay-leg__text">{l.label}</span>
                  <span className="sbx-slip__legpx">{am(l.american)}</span>
                  <button type="button" className="parlay-leg__x" onClick={() => remove(l.key)} aria-label={`Remove ${l.label}`}>×</button>
                </div>
              ))}
            </section>
          ))}
          {combo && quote?.corr && quote.corr !== "none" && (
            <div className="sbx-dim">{quote.corr === "high"
              ? "These legs tend to hit together, so this combo pays less than the legs multiplied, plus extra juice."
              : "Some of these legs tend to hit together, so the combo pays a bit less than the legs multiplied."}</div>
          )}
          {combo && quoteErr && (
            <div className="parlay-notice sbx-slip__err">
              <span>{quoteErr}</span>
              <button type="button" className="ui-btn" onClick={() => choose("singles")}>Bet as singles</button>
            </div>
          )}
          <div className="sbx-slip__stake">
            <label>{combo || legs.length === 1 ? "Stake (units)" : "Stake per bet (units)"}
              <input type="number" inputMode="decimal" min={0.5} max={maxStake} step={0.5} value={stake} onChange={(e) => setStake(e.target.value)} />
            </label>
            <div className="sbx-slip__win">
              {toWin != null && <>To win <b>{u(toWin)}</b></>}
              {!combo && legs.length > 1 && s > 0 && <div className="sbx-dim">{u(risk)} total risk</div>}
            </div>
          </div>
          <button type="button" className="ui-btn primary sbx-place"
                  disabled={owner || busy || !okStake || (combo ? !quote : false)}
                  onClick={() => (combo ? placeCombo() : placeSingles())}>
            {owner ? "You're the house" : busy ? "Placing…" : combo ? `Place combo${quote ? ` ${am(quote.american)}` : ""}` : legs.length === 1 ? `Place bet ${am(legs[0].american)}` : `Place ${legs.length} bets`}
          </button>
          <div className="sbx-dim">Max {u(maxStake)} per bet.{!picked && legs.length >= 2 ? " Combos pay more; one miss loses it." : ""}</div>
          {msg && <p className={`sb-note sb-note--${msg.tone}`} role="status">{msg.text}</p>}
        </div>
      )}
    </aside>
  );
}

/* --------------------------------------------------------------- tickets */
function net(t: Ticket) { return t.status === "open" ? 0 : (t.payout ?? 0) - Number(t.stake); }

function Summary({ tickets, owner }: { tickets: Ticket[]; owner: boolean }) {
  const settled = tickets.filter((t) => t.status !== "open");
  const w = settled.filter((t) => t.status === "won").length, l = settled.filter((t) => t.status === "lost").length;
  const p = settled.filter((t) => t.status === "push" || t.status === "void").length;
  const risked = settled.filter((t) => t.status === "won" || t.status === "lost").reduce((a, t) => a + Number(t.stake), 0);
  const won = settled.reduce((a, t) => a + net(t), 0);
  const open = tickets.filter((t) => t.status === "open");
  const houseExp = settled.reduce((a, t) => a + Number(t.stake) * Number(t.house_ev ?? 0), 0);
  const closeBeat = settled.filter((t) => t.kind === "single").map((t) => clvPts(t)).filter((x): x is number => x != null);
  return (
    <section className="ui-card sb-summary">
      <div className="sb-big" data-tone={won > 0 ? "pos" : won < 0 ? "neg" : undefined}>{u(won, true)}</div>
      <div className="sb-dim">{owner ? "Players' net" : "Your net"} · {w}-{l}{p ? `-${p}` : ""} · ROI {risked ? `${((won / risked) * 100).toFixed(1)}%` : "—"}
        {" · "}{open.length} open ({u(open.reduce((a, t) => a + Number(t.stake), 0))} at risk)</div>
      {owner && settled.length > 0 && (
        <div className="sb-dim">House: sim expected {u(houseExp, true)}, actually {u(-won, true)}.
          {closeBeat.length ? ` Line moved toward his side on ${closeBeat.filter((x) => x > 0).length} of ${closeBeat.length} straight bets.` : ""}</div>
      )}
    </section>
  );
}

/** Points the consensus close moved TOWARD the bettor on a straight main-line spread/total bet, or null.
 *  Spread: he holds his side's handicap, so a lower close (+10.5 -> +9.5, -3 -> -4) means he beat it. */
function clvPts(t: Ticket): number | null {
  const l = t.legs[0];
  if (!l || !l.main || l.close_line == null || l.line == null) return null;
  if (l.market === "spread") return l.line - l.close_line;
  if (l.market === "total") return l.side === "over" ? l.close_line - l.line : l.line - l.close_line;
  return null;
}

function TicketList({ tickets, owner, players }: { tickets: Ticket[]; owner: boolean; players: Map<string, string> }) {
  if (!tickets.length) return <section className="ui-card"><p className="sb-note">No bets yet.</p></section>;
  return (
    <section className="sb-tickets">
      {tickets.map((t) => (
        <article key={t.id} className="ui-card sb-ticket" data-status={t.status}>
          <header>
            <b>{t.kind === "single" ? "Single" : `${t.legs.length}-leg parlay`} · {am(t.american)}</b>
            <span className={`sb-status sb-status--${t.status}`}>
              {t.status === "open" ? "Open" : t.status === "won" ? `Won ${u(net(t), true)}` : t.status === "lost" ? `Lost ${u(net(t), true)}` : t.status === "push" ? "Push" : "Void"}
            </span>
          </header>
          <ul>
            {t.legs.map((l, i) => (
              <li key={i}>
                <span className={`sb-dot sb-dot--${l.result ?? "open"}`} aria-hidden />
                <span>{l.label}{l.score != null ? <span className="sb-dim"> · final {l.score}</span> : null}</span>
                {owner && <span className="sb-dim sb-own">sim {pct(l.p_sim)} · DK {pct(l.p_mkt)}</span>}
              </li>
            ))}
          </ul>
          <footer className="sb-dim">
            {u(Number(t.stake))} to win {u(Number(t.stake) * (Number(t.decimal_odds) - 1))} · {new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {owner && players.size > 1 ? ` · ${players.get(t.user_id) ?? "?"}` : ""}
            {owner && t.house_ev != null ? ` · house EV ${pct(t.house_ev)} (sim ${pct(t.p_sim)}, DK ${pct(t.p_mkt)})` : ""}
          </footer>
        </article>
      ))}
    </section>
  );
}

function Players({ players, reload }: { players: Player[]; reload: () => void }) {
  const [handle, setHandle] = useState(""); const [name, setName] = useState(""); const [max, setMax] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    setMsg(null);
    const r = await api("/api/simbook/players", { method: "POST", body: JSON.stringify({ handle, name: name || undefined, max_stake: Number(max) }) });
    if (r.ok) { setMsg(`${r.body.name} is in.`); setHandle(""); setName(""); reload(); }
    else setMsg(r.body?.error === "no_such_user" ? "No site account with that username. He signs up first, then you add him." : `Error ${r.status}`);
  }
  async function grade() {
    const r = await api("/api/simbook/grade", { method: "POST" });
    setMsg(r.ok ? `Graded: ${r.body.settled} settled of ${r.body.checked} open.` : `Error ${r.status}`); reload();
  }
  return (
    <section className="ui-card sb-players">
      <h2>Players</h2>
      {players.length ? <ul>{players.map((p) => <li key={p.user_id}>{p.name} · max {u(Number(p.max_stake))}{p.active ? "" : " · paused"}</li>)}</ul> : <p className="sb-note">Nobody invited yet.</p>}
      <div className="sb-form">
        <input placeholder="Site username" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Site username" />
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
        <input type="number" min={0.5} max={100} step={0.5} value={max} onChange={(e) => setMax(e.target.value)} aria-label="Max stake (units)" />
        <button type="button" className="ui-btn" onClick={add} disabled={!handle.trim()}>Add / update</button>
        <button type="button" className="ui-btn" onClick={grade}>Grade now</button>
      </div>
      {msg && <p className="sb-note">{msg}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ page */
export default function SimBook() {
  const { session, loading } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"board" | "bets">("board");
  const [week, setWeek] = useState<number>(0);
  const [games, setGames] = useState<SlateGame[] | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [boards, setBoards] = useState<Record<string, BoardState>>({});
  const [slip, setSlip] = useState<SlipLeg[]>([]);
  const [slipH, setSlipH] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    api("/api/simbook/me").then((r) => setMe(r.ok ? r.body : { allowed: false, owner: false, player: null, lines: false }));
  }, [session]);

  // The slate carries every card's prices. While the server is still reading
  // the week's boards (a fresh snapshot), poll until they're all in.
  useEffect(() => {
    if (!me?.allowed) return;
    setBoards({});
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, tries = 0;
    const load = () => api(`/api/simbook/slate${week ? `?week=${week}` : ""}`).then((r) => {
      if (!alive) return;
      if (!r.ok) { setErr(ERRORS[r.body?.error] || `Couldn't load the slate (${r.status}).`); return; }
      setErr(null);
      const warming = Boolean(r.body.warming);
      setGames(r.body.games.map((g: SlateGame) => ({ ...g, warming })));
      if (!week) setWeek(r.body.week);
      if (warming && ++tries < 40) timer = setTimeout(load, 10_000);
    });
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [me?.allowed, week]);

  /** A game's board (DK lines at the house's prices). Read once per open; the
   *  server caches DK for 2 minutes, and the SGO plan is metered per game. */
  const boardsRef = useRef(boards); boardsRef.current = boards;
  const loadBoard = useCallback(async (slug: string, force = false) => {
    const cur = boardsRef.current[slug];
    if (!force && (cur?.loading || cur?.board)) return;
    setBoards((b) => ({ ...b, [slug]: { ...b[slug], loading: true, err: undefined } }));
    const r = await api(`/api/simbook/game/${encodeURIComponent(slug)}?week=${week}`);
    setBoards((b) => ({ ...b, [slug]: r.ok ? { board: r.body } : { err: ERRORS[r.body?.error] || `Couldn't load lines (${r.status}).` } }));
  }, [week]);

  const loadTickets = useCallback(() => {
    api("/api/simbook/tickets").then((r) => {
      if (r.ok) { setTickets(r.body.tickets); if (r.body.players) setPlayers(r.body.players); }
    });
  }, []);
  useEffect(() => { if (me?.allowed) loadTickets(); }, [me?.allowed, loadTickets]);

  const slipKeys = useMemo(() => new Set(slip.map((l) => l.key)), [slip]);
  const toggle = useCallback((o: Offer, g: SlateGame) => {
    setNote(null);
    setSlip((s) => s.some((l) => l.key === o.key) ? s.filter((l) => l.key !== o.key)
      : s.length >= 8 ? s : [...s, { key: o.key, label: o.label, american: o.american, dec: o.dec || amToDec(o.american), parlay_ok: o.parlay_ok,
                                     slug: g.slug, home: g.home, away: g.away, market: o.market, side: o.side }]);
  }, []);
  const playerNames = useMemo(() => new Map(players.map((p) => [p.user_id, p.name])), [players]);

  if (!supabaseEnabled) return <div className="ui-card">The Sim Book needs accounts enabled on this build.</div>;
  if (loading) return <div className="ui-card">Loading…</div>;
  if (!session) return (
    <div className="sb-page">
      <h1>The Sim Book</h1>
      <p className="sb-note">Invite-only. Sign in with the account you were invited on.</p>
      <AuthPanel prompt="Sign in to the Sim Book" />
    </div>
  );
  if (!me) return <div className="ui-card">Loading…</div>;
  if (!me.allowed) return (
    <div className="sb-page">
      <h1>The Sim Book</h1>
      <p className="sb-note">This book is invite-only, and this account isn't on the list. <Link to="/">Back to the site</Link></p>
    </div>
  );

  const byDay = new Map<string, SlateGame[]>();
  for (const g of [...(games || [])].sort((a, b) => a.kickoff.localeCompare(b.kickoff))) {
    const d = new Date(g.kickoff).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
    byDay.set(d, [...(byDay.get(d) || []), g]);
  }

  return (
    <div className="sb-page" style={slip.length ? { paddingBottom: slipH + 24 } : undefined}>
      <header className="sb-head">
        <div>
          <div className="sb-kicker">{me.owner ? "The house" : `${me.player?.name ?? "Player"} vs the sim`}</div>
          <h1>The Sim Book</h1>
        </div>
        <div role="tablist" className="sb-tabs">
          <button type="button" role="tab" className="ui-btn" data-on={tab === "board" ? "true" : undefined} aria-selected={tab === "board"} onClick={() => setTab("board")}>Board</button>
          <button type="button" role="tab" className="ui-btn" data-on={tab === "bets" ? "true" : undefined} aria-selected={tab === "bets"} onClick={() => { setTab("bets"); loadTickets(); }}>
            {me.owner ? "All bets" : "My bets"}
          </button>
        </div>
      </header>

      {me.preview && (
        <p className="sb-preview" role="status"><b>Preview.</b> Sample lines built from our consensus numbers, not live DraftKings. Betting is off until the DraftKings feed (SGO_API_KEY) is connected.</p>
      )}
      {err && <p className="sb-note sb-note--neg">{err}</p>}
      {note && <p className="sb-note sb-note--pos" role="status">{note}</p>}

      {tab === "board" && (
        <>
          <div className="sb-week">
            <button type="button" className="ui-btn" onClick={() => { setWeek((w) => Math.max(1, w - 1)); setOpenSlug(null); }} aria-label="Previous week">‹</button>
            <b>Week {week || "…"}</b>
            <button type="button" className="ui-btn" onClick={() => { setWeek((w) => w + 1); setOpenSlug(null); }} aria-label="Next week">›</button>
          </div>
          {!games ? <p className="sb-note">Loading the slate…</p> : null}
          {[...byDay.entries()].map(([day, gs]) => (
            <section key={day} className="sb-day">
              <h2>{day}</h2>
              <DayGrid games={gs} openSlug={openSlug} setOpen={setOpenSlug} boards={boards} loadBoard={loadBoard}
                       slipKeys={slipKeys} toggle={toggle} owner={me.owner} />
            </section>
          ))}
        </>
      )}

      {tab === "bets" && (
        <>
          {tickets ? <Summary tickets={tickets} owner={me.owner} /> : <p className="sb-note">Loading…</p>}
          {me.owner && me.sgo && (
            <p className="sb-note">Line feed: {me.sgo.used.toLocaleString()} of {me.sgo.cap.toLocaleString()} reads used this month
              {me.sgo.last_run ? `, last update ${new Date(me.sgo.last_run).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : ""}
              {me.sgo.status && me.sgo.status !== "ok" ? ` (last run failed: ${me.sgo.status})` : ""}
              {me.sgo.used >= me.sgo.guard ? ". Refreshes are paused; games past their max age stop showing." : "."}</p>
          )}
          {me.owner && <Players players={players} reload={loadTickets} />}
          {tickets ? <TicketList tickets={tickets} owner={me.owner} players={playerNames} /> : null}
        </>
      )}

      <Slip week={week} legs={slip} owner={me.owner} maxStake={me.player?.max_stake ?? 5} onHeight={setSlipH}
            remove={(k) => setSlip((s) => s.filter((l) => l.key !== k))} clear={() => setSlip([])}
            onPlaced={(keys, text) => { setSlip((s) => s.filter((l) => !keys.includes(l.key))); if (text) setNote(text); loadTickets(); }} />
    </div>
  );
}
