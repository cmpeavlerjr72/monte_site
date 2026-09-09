// src/components/FriendBooks.tsx
//
// THE LEGACY (env-paired) FRIEND FEED: the declared friend pair's Kalshi books,
// read-only, straight from the server's own payload builders. It is the ONE
// sanctioned crossing of the portal's account isolation (docs/AGENT_BRIEF.md).
//
// It moved out of the scoreboard console with the 2026-09-08 restructure. The
// NETWORK feed (posted picks + app orders, Supabase) is the new source for
// "what my friends are on" and lives in its own dashboard section; this block
// stays because it is a different thing — the owner's own paired Kalshi
// accounts, with a LIVE join price on every held bet — and retiring it would
// silently remove a working money feature. It sits under the positions section
// of the dashboard, collapsed, exactly as it sat in the console.
//
// The server route it reads (/api/portfolio/cfb/friends) is unchanged.

import { useState } from "react";
import { placeErrorText, type PlaceResponse } from "../lib/placeOrders";
import { sizeContracts, type Sizing } from "../lib/suggestedBets";
import {
  cheerLabelWithGame, portalGameCode, useFriendBooks,
} from "../lib/kalshiPortal";
import type {
  BetGameNames, FriendBook, PortalFill, PortalPosition,
} from "../lib/kalshiPortal";
import {
  newIdempotencyKey, placeOrders, type PlaceOrder,
} from "../lib/placeOrders";
import { getTeamLogo } from "../utils/teamLogo";
import BetLabel from "./BetLabel";

/**
 * FRIEND FEED — the declared friend pair's books, read-only ("see what your
 * friend takes", owner ask 2026-09-01; full stakes and P&L shown by owner
 * decision). The SERVER declares who is paired with whom (CFB_FRIENDS); a
 * session with no pairs, or no login, renders nothing at all. One line per
 * held bet, in the same cheer-side words the owner's own book uses; recent
 * fills underneath carry the time, because the feed's job is "what did they
 * just take", not accounting.
 */
/** The price at which the SESSION's account could take the same side right
 *  now, off the live book the server stamped on the friend's position.
 *  null = not available (no offer, or a 1¢/99¢ shell). */
function joinPriceOf(p: PortalPosition): number | null {
  const px = p.side === "no"
    ? (p.mkt_yes_bid == null ? null : 1 - p.mkt_yes_bid)
    : (p.mkt_yes_ask ?? null);
  return px != null && px > 0.01 && px < 0.99 ? Math.round(px * 100) / 100 : null;
}

/** Fee-inclusive edge of joining at `price`, against the sim's own fair for
 *  this market (the SAME pricing the owner's held book uses). null = the
 *  family is unpriceable, so value cannot be certified. A join is only
 *  OFFERED when this is positive — a bet that has since been bid past fair
 *  gets its price shown, not a button (owner ask 2026-09-01). */
function joinEdgeOf(price: number, ticker: string, side: string,
                    yesP: (t: string) => number | null): number | null {
  const p = yesP(ticker);
  if (p === null) return null;
  const fair = side === "no" ? 1 - p : p;
  const fee = Math.ceil(7 * price * (1 - price)) / 100;
  return Math.round((fair - price - fee) * 1000) / 1000;
}

/**
 * Two-tap join: "Join @ 54¢" arms into "Confirm 46× ≈ $25" and only the
 * second tap places — a TAKE on the session's OWN account, sized by the
 * owner's unit. The friend's account is never touched; this is the same
 * self-directed order entry as everywhere else, staged (dry-run) until this
 * session's account is live.
 */
function FriendJoin({ token, ticker, side, price, unit, sizing }: {
  token: string; ticker: string; side: "yes" | "no"; price: number;
  unit: number; sizing: Sizing;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // THE ONE SIZING KERNEL. A join is a TAKE at `price`, so it sizes exactly
  // the way a suggested take does — including the unit mode (owner ask
  // 2026-09-08). This used to be its own floor(unit / price), which is the
  // second copy that made the modes impossible to ship in one place.
  const sized = sizeContracts({
    price, maker: false, unit, sizing,
    ceiling: unit * sizing.maxRiskMultiple,
  });
  const count = sized.count;
  const cost = sized.outlay;

  const place = async () => {
    setBusy(true); setMsg("");
    try {
      const order: PlaceOrder = {
        ticker, side, mode: "take", price_dollars: price, count_fp: count,
      };
      const r = await placeOrders(token, newIdempotencyKey(), [order]);
      const b = r.body as PlaceResponse;
      if (r.status >= 400) setMsg(placeErrorText(b));
      else setMsg(b.dry_run ? "dry run — nothing sent" : "joined ✓");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setArmed(false);
    }
  };

  if (msg) {
    return <span style={{ fontSize: 10, color: "var(--muted)" }}>{msg}</span>;
  }
  return (
    <button
      type="button"
      className="ui-btn"
      data-on="true"
      data-tone={armed ? "accent" : undefined}
      disabled={busy}
      onClick={() => (armed ? place() : setArmed(true))}
      onBlur={() => setArmed(false)}
      style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px" }}>
      {armed ? `confirm ${count}× ≈ $${cost.toFixed(0)}` : `join @ ${Math.round(price * 100)}¢`}
    </button>
  );
}

type FriendGame = {
  code: string; names?: BetGameNames;
  positions: PortalPosition[]; fills: PortalFill[]; last: number;
};

/** A friend's book grouped BY GAME (owner ask 2026-09-01): each game gets its
 *  real matchup name, the held bets one line each with a live JOIN price, and
 *  that game's recent fills as a muted timeline underneath. */
function FriendBookBlock({ book, token, unit, sizing, slugTeams, codeToSlug, yesP }: {
  book: FriendBook; token: string; unit: number; sizing: Sizing;
  slugTeams: Map<string, BetGameNames>; codeToSlug: Map<string, string>;
  yesP: (t: string) => number | null;
}) {
  const net = (s: { revenue: number; cost: number; fees: number }) =>
    s.revenue - s.cost - s.fees; // fee-inclusive, standing rule
  const settledNet = book.settlements.reduce((a, s) => a + net(s), 0);
  const wins = book.settlements.filter((s) => net(s) > 0).length;
  const losses = book.settlements.filter((s) => net(s) < 0).length;
  const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`;
  const when = (iso: string) => {
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? "" :
      t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const games = new Map<string, FriendGame>();
  const gameOf = (ticker: string, at: number): FriendGame | null => {
    const code = portalGameCode(ticker);
    if (!code) return null;
    let g = games.get(code);
    if (!g) {
      const slug = codeToSlug.get(code);
      g = { code, names: slug ? slugTeams.get(slug) : undefined,
            positions: [], fills: [], last: 0 };
      games.set(code, g);
    }
    if (at > g.last) g.last = at;
    return g;
  };
  for (const p of book.positions) gameOf(p.ticker, 0)?.positions.push(p);
  const recentFills = [...book.fills]
    .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time))
    .slice(0, 12);
  for (const f of recentFills) {
    gameOf(f.ticker, Date.parse(f.created_time) || 0)?.fills.push(f);
  }
  const ordered = [...games.values()].sort((a, b) => b.last - a.last);

  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800 }}>{book.account_label}</span>
        {wins + losses > 0 && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {wins}W–{losses}L settled ·{" "}
            <b style={{ color: settledNet >= 0 ? "var(--pos)" : "var(--neg)" }}>
              {money(settledNet)}
            </b>
          </span>
        )}
        {!ordered.length && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>nothing held</span>
        )}
      </div>
      {ordered.map((g) => {
        const away = g.names && getTeamLogo(g.names.teamB);
        const home = g.names && getTeamLogo(g.names.teamA);
        return (
        <div key={g.code} style={{
          marginTop: 6, padding: "6px 9px", borderRadius: 8,
          border: "1px solid var(--border)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3,
            textTransform: "uppercase", color: "var(--muted)",
            paddingBottom: 4, marginBottom: 2,
            borderBottom: "1px solid var(--border)",
          }}>
            {(away || home) && (
              <span aria-hidden="true" style={{ display: "inline-flex", gap: 2 }}>
                {away && <img src={away} alt="" width={16} height={16} loading="lazy" />}
                {home && <img src={home} alt="" width={16} height={16} loading="lazy" />}
              </span>
            )}
            {g.names ? `${g.names.teamB} @ ${g.names.teamA}` : g.code}
          </div>
          {g.positions.map((p) => {
            const join = joinPriceOf(p);
            const edge = join !== null
              ? joinEdgeOf(join, p.ticker, p.side, yesP) : null;
            return (
              <div key={`${p.ticker}|${p.side}`} style={{
                display: "flex", alignItems: "center", gap: 8,
                flexWrap: "wrap", fontSize: 11, padding: "2px 0",
              }}>
                <span style={{ minWidth: 0 }}>
                  {p.count} ×{" "}
                  {/* The team as its LOGO, "points"/"total" dropped — the same
                      words the feed and the owner's own book now use. The game
                      header above already names the matchup, so a total needs
                      no dim pair here. */}
                  <BetLabel label={cheerLabelWithGame(p.ticker, p.side, g.names)}
                            home={g.names?.teamA} away={g.names?.teamB} size={16}
                            style={{ verticalAlign: "middle" }} />
                  {p.avg_price !== null && (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}@ {Math.round(p.avg_price * 100)}¢
                    </span>
                  )}
                </span>
                {join === null ? (
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>no offer now</span>
                ) : edge !== null && edge > 0 ? (
                  <FriendJoin token={token} ticker={p.ticker}
                              side={p.side === "no" ? "no" : "yes"}
                              price={join} unit={unit} sizing={sizing} />
                ) : (
                  <span style={{ fontSize: 10, color: "var(--muted)" }}
                        title={edge === null
                          ? "The sim cannot price this family, so value can't be certified."
                          : "Priced past sim fair now — joining would be -EV."}>
                    {edge === null
                      ? `@ ${Math.round(join * 100)}¢ — unpriced`
                      : `overpriced now @ ${Math.round(join * 100)}¢`}
                  </span>
                )}
              </div>
            );
          })}
          {g.fills.map((f, i) => (
            <div key={`${f.ticker}|${f.created_time}|${i}`}
                 style={{ fontSize: 10, color: "var(--muted)", padding: "1px 0" }}>
              {when(f.created_time)} · filled {f.count ?? "?"} ×{" "}
              {/* 14px, not the house 16–18: this is a 10px footnote line and a
                  full-size mark would set the row's height, not sit in it. */}
              <BetLabel label={cheerLabelWithGame(f.ticker, f.side, g.names)}
                        home={g.names?.teamA} away={g.names?.teamB} size={14}
                        style={{ verticalAlign: "middle" }} />
            </div>
          ))}
        </div>
        );
      })}
    </div>
  );
}

export default function FriendBooks({ token, unit, sizing, slugTeams, codeToSlug, yesP }: {
  token: string; unit: number; sizing: Sizing;
  slugTeams: Map<string, BetGameNames>; codeToSlug: Map<string, string>;
  yesP: (t: string) => number | null;
}) {
  const friends = useFriendBooks(token);
  // Collapsed TRAY by default (owner ask 2026-09-01: "so they aren't
  // required to look at it") — the summary line still carries the news.
  // Choice persists per device, storage guarded the usePrefs way.
  const [open, setOpen] = useState<boolean>(() => {
    try { return window.localStorage.getItem("cfb.friendsOpen") === "1"; }
    catch { return false; }
  });
  if (!friends.length) return null;
  const toggle = () => setOpen((o) => {
    try { window.localStorage.setItem("cfb.friendsOpen", o ? "0" : "1"); }
    catch { /* preference simply will not persist */ }
    return !o;
  });
  const summary = friends.map((f) => {
    const net = f.settlements.reduce((a, s) => a + s.revenue - s.cost - s.fees, 0);
    const money = `${net < 0 ? "−" : "+"}$${Math.abs(net).toFixed(0)}`;
    return `${f.account_label} · holding ${f.positions.length}` +
      (f.settlements.length ? ` · ${money}` : "");
  }).join("  |  ");
  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0, flex: 1 }}>
        <button
          type="button" className="ui-btn" onClick={toggle}
          aria-expanded={open}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            fontSize: 10.5, fontWeight: 700, padding: "3px 9px",
            justifyContent: "flex-start", textAlign: "left",
          }}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {summary}
          </span>
        </button>
      {open && friends.map((f) => (
        <FriendBookBlock key={f.account_id} book={f} token={token}
                         unit={unit} sizing={sizing} slugTeams={slugTeams}
                         codeToSlug={codeToSlug} yesP={yesP} />
      ))}
    </div>
  );
}

