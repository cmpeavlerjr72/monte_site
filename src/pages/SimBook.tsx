// src/pages/SimBook.tsx — THE SIM BOOK at /simbook (owner 2026-10-19).
//
// A private sportsbook where the sim is the house. An invited friend bets units
// on DraftKings' lines at the house's prices (straights and parlays); the server
// re-prices every bet, locks it at kickoff and grades it from the finals.
// No nav entry: the page answers only for invited players and the owner.
// Server + pricing rules: server/simbook.ts. Tables: 20261019_simbook.sql.
//
// The bettor NEVER sees the sim's or the market's probability, only prices.
// The owner additionally sees, per ticket, the sim %, DK's no-vig % and the
// house's expected value, so "did the sim beat him" can be read off one card.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession, getAccessToken, supabaseEnabled } from "../lib/supabase";
import AuthPanel from "../components/AuthPanel";
import "../styles/simbook.css";

type Me = { allowed: boolean; owner: boolean; player: { name: string; max_stake: number } | null; lines: boolean; preview?: boolean };
type SlateGame = { slug: string; home: string; away: string; kickoff: string; started: boolean };
type Offer = {
  key: string; label: string; group: string; sub: string; main: boolean; market: string; side: string;
  line: number | null; american: number; dec: number; parlay_ok: boolean;
  dk_american?: number; q_sim?: number; p_mkt?: number; house_ev?: number;
};
type Board = { slug: string; home: string; away: string; kickoff: string; started: boolean; has_lines: boolean; offers: Offer[] };
type SlipLeg = { key: string; label: string; american: number; game: string; parlay_ok: boolean };
type Ticket = {
  id: string; user_id: string; created_at: string; week: number; kind: "single" | "parlay"; stake: number; american: number;
  decimal_odds: number; status: "open" | "won" | "lost" | "push" | "void"; payout: number | null; settled_at: string | null;
  p_sim?: number; p_mkt?: number; house_ev?: number; dk_decimal?: number;
  legs: { label: string; game: string; kickoff: string; market: string; american: number; dk_american?: number; result: string | null;
          score: number | null; close_line: number | null; close_american: number | null; line: number | null; side: string; main?: boolean; p_sim?: number; p_mkt?: number }[];
};
type Player = { user_id: string; name: string; active: boolean; max_stake: number };

const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const u = (n: number, sign = false) => `${sign && n > 0 ? "+" : ""}${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}u`;
const pct = (p?: number) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
const kick = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";

const ERRORS: Record<string, string> = {
  not_invited: "This book is invite-only.",
  started: "That game has kicked off. Bets are closed.",
  leg_gone: "That line just moved off the board. The menu refreshed, pick again.",
  parlay_push: "Whole-number lines can push, so they can't go in a parlay.",
  same_market: "Two sides of the same bet can't go in one parlay.",
  parlay_dead: "The house won't write that parlay.",
  parlay_short: "That parlay is too short a price to write.",
  bad_stake: "Check the stake: it has to be above 0 and under your limit (max payout 250u).",
  budget: "The line feed is paused for the rest of the month.",
  no_lines: "The line feed isn't connected yet.",
  preview: "Preview mode: these are sample prices, so betting is off until the DraftKings feed is connected.",
  owner_is_the_house: "You're the house. Only players can bet.",
  slow_down: "Easy. Too many bets in a minute.",
  bad_legs: "Pick 1 to 8 legs.",
  dup_leg: "That leg is already on the slip.",
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

/* ----------------------------------------------------------------- board */
// DraftKings-style board (owner 2026-10-19): a Spread / Total / Moneyline grid
// with the away team on top, category pills for props, one row per player.
// The server already trims each market to the line(s) nearest 50/50.

const PROP_ORDER = ["Anytime TD", "Passing yards", "Passing TDs", "Completions", "Pass attempts", "Interceptions thrown",
  "Rushing yards", "Carries", "Receiving yards", "Receptions", "Pass + rush yards", "Rush + rec yards", "Touchdowns scored"];
const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function Cell({ o, top, slipKeys, toggle, owner }: {
  o?: Offer; top?: string; slipKeys: Set<string>; toggle: (o: Offer) => void; owner: boolean;
}) {
  if (!o) return <div className="sb-cell sb-cell--empty" aria-hidden>—</div>;
  const on = slipKeys.has(o.key);
  return (
    <button type="button" className="sb-cell" data-on={on ? "true" : undefined} onClick={() => toggle(o)} aria-pressed={on}
            aria-label={`${o.label} ${am(o.american)}`}
            title={owner ? `sim ${pct(o.q_sim)} · DK no-vig ${pct(o.p_mkt)} · DK ${o.dk_american != null ? am(o.dk_american) : "—"} · house EV ${pct(o.house_ev)}` : undefined}>
      {top ? <span className="sb-cell__line">{top}</span> : null}
      <span className="sb-cell__price">{am(o.american)}</span>
      {owner && <span className="sb-cell__own">sim {pct(o.q_sim)} · DK {o.dk_american != null ? am(o.dk_american) : "—"}</span>}
    </button>
  );
}

/** Distinct lines of one two-sided market, DK's main line first. */
function linesOf(os: Offer[], refSide: (o: Offer) => boolean, refLine: (o: Offer) => number) {
  const seen: number[] = [];
  const refs = os.filter(refSide).sort((x, y) => Number(y.main) - Number(x.main));
  for (const o of [...refs, ...os]) { const l = refLine(o); if (!seen.includes(l)) seen.push(l); }
  return seen;
}

function GameLines({ game, offers, slipKeys, toggle, owner }: {
  game: SlateGame; offers: Offer[]; slipKeys: Set<string>; toggle: (o: Offer) => void; owner: boolean;
}) {
  const [alts, setAlts] = useState(false);
  const sp = offers.filter((o) => o.market === "spread");
  const to = offers.filter((o) => o.market === "total");
  const ml = offers.filter((o) => o.market === "ml");
  // spread lines keyed by the AWAY handicap; totals by the number
  const spLines = linesOf(sp, (o) => o.side === "away", (o) => (o.side === "away" ? o.line! : -o.line!));
  const toLines = linesOf(to, (o) => o.side === "over", (o) => o.line!);
  const spAt = (side: "away" | "home", awayLine?: number) =>
    awayLine == null ? undefined : sp.find((o) => o.side === side && o.line === (side === "away" ? awayLine : -awayLine));
  const toAt = (side: "over" | "under", line?: number) => (line == null ? undefined : to.find((o) => o.side === side && o.line === line));
  const c = (o: Offer | undefined, top?: string) => <Cell o={o} top={top} slipKeys={slipKeys} toggle={toggle} owner={owner} />;
  const spTop = (o?: Offer) => (o ? sgn(o.line!) : undefined);
  const altCount = Math.max(0, spLines.length - 1) + Math.max(0, toLines.length - 1);

  const tt = offers.filter((o) => o.market === "tt");
  const ttTeam = (who: "home" | "away") => {
    const os = tt.filter((o) => o.side.startsWith(who));
    return linesOf(os, (o) => o.side.endsWith("over"), (o) => o.line!).map((line) => ({
      line, over: os.find((o) => o.side.endsWith("over") && o.line === line), under: os.find((o) => o.side.endsWith("under") && o.line === line),
    }));
  };
  const ttRows = [{ team: game.away, rows: ttTeam("away") }, { team: game.home, rows: ttTeam("home") }].filter((r) => r.rows.length);

  if (!sp.length && !to.length && !ml.length && !ttRows.length) return <p className="sb-note">No game lines posted yet.</p>;
  return (
    <div className="sb-lines">
      {sp.length || to.length || ml.length ? (
        <div className="sb-table" role="table" aria-label="Game lines">
          <div className="sb-table__head" role="row">
            <span role="columnheader">Game</span><span role="columnheader">Spread</span><span role="columnheader">Total</span><span role="columnheader">Moneyline</span>
          </div>
          {(["away", "home"] as const).map((side) => {
            const s0 = spAt(side, spLines[0]);
            const t0 = toAt(side === "away" ? "over" : "under", toLines[0]);
            return (
              <div key={side} className="sb-table__row" role="row">
                <span className="sb-table__team" role="rowheader">{side === "away" ? game.away : game.home}</span>
                {c(s0, spTop(s0))}
                {c(t0, t0 ? `${side === "away" ? "O" : "U"} ${t0.line}` : undefined)}
                {c(ml.find((o) => o.side === side))}
              </div>
            );
          })}
        </div>
      ) : null}
      {altCount > 0 && (
        <div className="sb-alts">
          <button type="button" className="sb-more" onClick={() => setAlts((v) => !v)} aria-expanded={alts}>
            {alts ? "Hide other lines" : `Other lines near even (${altCount})`}
          </button>
          {alts && (
            <div className="sb-table sb-table--two" role="table" aria-label="Other lines">
              <div className="sb-table__head" role="row"><span role="columnheader" /><span role="columnheader">{game.away} / Over</span><span role="columnheader">{game.home} / Under</span></div>
              {spLines.slice(1).map((l) => {
                const a = spAt("away", l), h = spAt("home", l);
                return <div key={`s${l}`} className="sb-table__row" role="row"><span className="sb-table__team" role="rowheader">Spread</span>{c(a, spTop(a))}{c(h, spTop(h))}</div>;
              })}
              {toLines.slice(1).map((l) => (
                <div key={`t${l}`} className="sb-table__row" role="row"><span className="sb-table__team" role="rowheader">Total</span>
                  {c(toAt("over", l), `O ${l}`)}{c(toAt("under", l), `U ${l}`)}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {ttRows.length > 0 && (
        <div className="sb-table sb-table--two" role="table" aria-label="Team totals">
          <div className="sb-table__head" role="row"><span role="columnheader">Team total</span><span role="columnheader">Over</span><span role="columnheader">Under</span></div>
          {ttRows.flatMap(({ team, rows }) => rows.map((r) => (
            <div key={`${team}${r.line}`} className="sb-table__row" role="row">
              <span className="sb-table__team" role="rowheader">{team}</span>
              {c(r.over, `O ${r.line}`)}{c(r.under, `U ${r.line}`)}
            </div>
          )))}
        </div>
      )}
    </div>
  );
}

function PropList({ sub, offers, slipKeys, toggle, owner, needle }: {
  sub: string; offers: Offer[]; slipKeys: Set<string>; toggle: (o: Offer) => void; owner: boolean; needle: string;
}) {
  const byPlayer = new Map<string, Offer[]>();
  for (const o of offers) if (o.sub === sub) byPlayer.set(o.group, [...(byPlayer.get(o.group) || []), o]);
  const atd = sub === "Anytime TD";
  // DK order: biggest line first (the QB1 / RB1 / WR1 up top); anytime TD by shortest price
  const lead = (os: Offer[]) => (atd ? -Math.min(...os.map((o) => o.american)) : Math.max(...os.map((o) => o.line ?? 0)));
  const rows = [...byPlayer.entries()].filter(([n]) => !needle || n.toLowerCase().includes(needle))
    .sort((x, y) => lead(y[1]) - lead(x[1]) || x[0].localeCompare(y[0]));
  if (!rows.length) return <p className="sb-note">{needle ? "No player by that name here." : "Nothing posted."}</p>;
  return (
    <div className="sb-table sb-table--props" role="table" aria-label={sub}>
      <div className="sb-table__head" role="row"><span role="columnheader">Player</span><span role="columnheader">{atd ? "Anytime" : "Over"}</span></div>
      {rows.map(([name, os]) => (
        <div key={name} className="sb-table__row" role="row">
          <span className="sb-table__team" role="rowheader">{name}</span>
          <div className="sb-prop-cells">
            {[...os].sort((x, y) => (x.line ?? 0) - (y.line ?? 0)).map((o) => (
              <Cell key={o.key} o={o} top={atd ? undefined : `O ${o.line}`} slipKeys={slipKeys} toggle={toggle} owner={owner} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GameMenu({ week, game, slipKeys, toggle, owner }: {
  week: number; game: SlateGame; slipKeys: Set<string>; toggle: (o: Offer, g: SlateGame) => void; owner: boolean;
}) {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Game lines");
  const load = useCallback(async () => {
    setErr(null);
    const r = await api(`/api/simbook/game/${encodeURIComponent(game.slug)}?week=${week}`);
    if (!r.ok) { setErr(ERRORS[r.body?.error] || `Couldn't load lines (${r.status}).`); return; }
    setB(r.body);
  }, [game.slug, week]);
  useEffect(() => { load(); }, [load]);

  const props = useMemo(() => (b?.offers || []).filter((o) => o.market === "prop"), [b]);
  const cats = useMemo(() => {
    const rank = (x: string) => (PROP_ORDER.indexOf(x) < 0 ? 99 : PROP_ORDER.indexOf(x));
    return ["Game lines", ...[...new Set(props.map((o) => o.sub))].sort((x, y) => rank(x) - rank(y))];
  }, [props]);
  const needle = q.trim().toLowerCase();

  if (err) return <div className="sb-menu"><p className="sb-note sb-note--neg">{err}</p><button type="button" className="ui-btn" onClick={load}>Try again</button></div>;
  if (!b) return <div className="sb-menu"><p className="sb-note">Loading DraftKings' board…</p></div>;
  if (b.started) return <div className="sb-menu"><p className="sb-note">This game has kicked off. Bets are closed.</p></div>;
  if (!b.has_lines || !b.offers.length) return <div className="sb-menu"><p className="sb-note">No DraftKings lines on this game yet. They usually post by midweek.</p></div>;
  const t = (o: Offer) => toggle(o, game);
  const active = cats.includes(cat) ? cat : "Game lines";
  return (
    <div className="sb-menu">
      {cats.length > 1 && (
        <div className="sb-pills" role="tablist" aria-label="Markets">
          {cats.map((c) => (
            <button key={c} type="button" role="tab" className="sb-pill" data-on={c === active ? "true" : undefined} aria-selected={c === active} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      )}
      {active === "Game lines"
        ? <GameLines game={game} offers={b.offers.filter((o) => o.market !== "prop")} slipKeys={slipKeys} toggle={t} owner={owner} />
        : (
          <>
            <input className="sb-search" placeholder="Find a player" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a player" />
            <PropList sub={active} offers={props} slipKeys={slipKeys} toggle={t} owner={owner} needle={needle} />
          </>
        )}
      <p className="sb-note">Lines are DraftKings'. Prices are the house's, refreshed when you open a game. Bets lock at kickoff.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ slip */
function Slip({ week, legs, remove, clear, maxStake, onPlaced }: {
  week: number; legs: SlipLeg[]; remove: (k: string) => void; clear: () => void; maxStake: number; onPlaced: () => void;
}) {
  const [stake, setStake] = useState("1");
  const [quote, setQuote] = useState<{ american: number; dec: number } | null>(null);
  const [msg, setMsg] = useState<{ tone: "neg" | "pos" | "muted"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const keysSig = legs.map((l) => l.key).join(",");
  useEffect(() => {
    setQuote(null); setMsg(null);
    if (!legs.length) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await api("/api/simbook/quote", { method: "POST", body: JSON.stringify({ week, legs: legs.map((l) => l.key) }) });
      if (!alive) return;
      if (r.ok) setQuote({ american: r.body.american, dec: r.body.dec });
      else setMsg({ tone: "neg", text: ERRORS[r.body?.error] || `Couldn't price that (${r.status}).` });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig, week]);

  if (!legs.length) return null;
  const s = Number(stake);
  const toWin = quote && s > 0 ? s * (quote.dec - 1) : null;
  async function place(expect?: number) {
    if (!quote) return;
    setBusy(true); setMsg(null);
    const r = await api("/api/simbook/bet", { method: "POST", body: JSON.stringify({ week, legs: legs.map((l) => l.key), stake: s, expect_american: expect ?? quote.american }) });
    setBusy(false);
    if (r.ok) {
      setMsg({ tone: "pos", text: `Bet placed: ${u(r.body.stake)} at ${am(r.body.american)} to win ${u(r.body.to_win)}.` });
      clear(); onPlaced();
      return;
    }
    if (r.body?.error === "price_changed") {
      setQuote({ american: r.body.american, dec: r.body.dec });
      setMsg({ tone: "muted", text: `The price moved to ${am(r.body.american)}. Tap Place bet again to take it.` });
      return;
    }
    setMsg({ tone: "neg", text: ERRORS[r.body?.error] || `Couldn't place it (${r.status}).` });
  }
  return (
    <aside className="sb-slip" aria-label="Bet slip">
      <button type="button" className="sb-slip__bar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <b>{legs.length === 1 ? "Single" : `${legs.length}-leg parlay`}</b>
        <span>{quote ? am(quote.american) : "…"}</span>
      </button>
      {open && (
        <div className="sb-slip__body">
          <ul className="sb-slip__legs">
            {legs.map((l) => (
              <li key={l.key}>
                <div><div>{l.label}</div><div className="sb-dim">{l.game}</div></div>
                <span className="sb-slip__px">{legs.length === 1 && quote ? am(quote.american) : am(l.american)}</span>
                <button type="button" className="sb-x" onClick={() => remove(l.key)} aria-label={`Remove ${l.label}`}>×</button>
              </li>
            ))}
          </ul>
          <div className="sb-slip__row">
            <label>Stake (units)
              <input type="number" inputMode="decimal" min={0.5} max={maxStake} step={0.5} value={stake} onChange={(e) => setStake(e.target.value)} />
            </label>
            <div className="sb-slip__win">{toWin != null ? <>To win <b>{u(toWin)}</b></> : null}</div>
          </div>
          <div className="sb-slip__row">
            <button type="button" className="sb-more" onClick={clear}>Clear</button>
            <button type="button" className="ui-btn sb-place" disabled={!quote || busy || !(s > 0) || s > maxStake} onClick={() => place()}>
              {busy ? "Placing…" : `Place bet${quote ? ` ${am(quote.american)}` : ""}`}
            </button>
          </div>
          <div className="sb-dim">Max {u(maxStake)} per bet.</div>
        </div>
      )}
      {msg && <p className={`sb-note sb-note--${msg.tone}`} role="status">{msg.text}</p>}
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
  const [slip, setSlip] = useState<SlipLeg[]>([]);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    api("/api/simbook/me").then((r) => setMe(r.ok ? r.body : { allowed: false, owner: false, player: null, lines: false }));
  }, [session]);

  useEffect(() => {
    if (!me?.allowed) return;
    api(`/api/simbook/slate${week ? `?week=${week}` : ""}`).then((r) => {
      if (!r.ok) { setErr(ERRORS[r.body?.error] || `Couldn't load the slate (${r.status}).`); return; }
      setGames(r.body.games); if (!week) setWeek(r.body.week);
    });
  }, [me?.allowed, week]);

  const loadTickets = useCallback(() => {
    api("/api/simbook/tickets").then((r) => {
      if (r.ok) { setTickets(r.body.tickets); if (r.body.players) setPlayers(r.body.players); }
    });
  }, []);
  useEffect(() => { if (me?.allowed) loadTickets(); }, [me?.allowed, loadTickets]);

  const slipKeys = useMemo(() => new Set(slip.map((l) => l.key)), [slip]);
  const toggle = useCallback((o: Offer, g: SlateGame) => {
    setSlip((s) => s.some((l) => l.key === o.key) ? s.filter((l) => l.key !== o.key)
      : s.length >= 8 ? s : [...s, { key: o.key, label: o.label, american: o.american, game: `${g.away} at ${g.home}`, parlay_ok: o.parlay_ok }]);
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
    <div className="sb-page" data-slip={slip.length ? "true" : undefined}>
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
              {gs.map((g) => (
                <div key={g.slug} className="ui-card sb-game" data-open={openSlug === g.slug ? "true" : undefined}>
                  <button type="button" className="sb-game__row" aria-expanded={openSlug === g.slug}
                          onClick={() => setOpenSlug((s) => (s === g.slug ? null : g.slug))} disabled={g.started}>
                    <span className="sb-game__teams"><span>{g.away}</span><span>{g.home}</span></span>
                    <span className="sb-game__time">{g.started ? "Closed" : kick(g.kickoff)}<span className="sb-chev" aria-hidden>{openSlug === g.slug ? "▴" : "▾"}</span></span>
                  </button>
                  {openSlug === g.slug && (
                    <div ref={menuRef}>
                      <GameMenu week={week} game={g} slipKeys={slipKeys} toggle={toggle} owner={me.owner} />
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {tab === "bets" && (
        <>
          {tickets ? <Summary tickets={tickets} owner={me.owner} /> : <p className="sb-note">Loading…</p>}
          {me.owner && <Players players={players} reload={loadTickets} />}
          {tickets ? <TicketList tickets={tickets} owner={me.owner} players={playerNames} /> : null}
        </>
      )}

      {me.player && (
        <Slip week={week} legs={slip} remove={(k) => setSlip((s) => s.filter((l) => l.key !== k))} clear={() => setSlip([])}
              maxStake={me.player.max_stake} onPlaced={loadTickets} />
      )}
    </div>
  );
}
