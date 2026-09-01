// src/components/MyBookPanel.tsx
//
// The OWNER CONSOLE. Everything that is "mine" rather than "the slate's" lives
// here, in one block of labelled rows:
//
//   Account    login / logged-in state, disconnect
//   Unit size  dollars of risk per ladder — the number the whole site sizes on
//   Orders     the kill switch for orders this app placed
//   Book       the cumulative risk/EV bar, when there is a book
//   Record     REAL settled W/L + PnL on this slate, broken out by bet type
//   (children) the Suggested bets card
//
// It replaces a one-off "My Kalshi" toolbar button plus a floating login
// popover plus a detached totals bar. Structured as ROWS on purpose: the next
// owner feature is a row, not another button somewhere else on the page.

import { useEffect, useState } from "react";
import DryRunBadge from "./DryRunBadge";
import { cancelAppOrders, placeErrorText, type PlaceResponse } from "../lib/placeOrders";
import { clampUnit, UNIT_MAX, UNIT_MIN } from "../lib/ownerPrefs";
import { KalshiRecordBlock, MyBookBar } from "./MyBook";
import {
  cheerLabelWithGame, portalGameCode, useFriendBooks,
} from "../lib/kalshiPortal";
import type {
  BetGameNames, FriendBook, PortalFill, PortalPosition, PortalTotals,
  SettlementRecord,
} from "../lib/kalshiPortal";
import {
  newIdempotencyKey, placeOrders, type PlaceOrder,
} from "../lib/placeOrders";
import { getTeamLogo } from "../utils/teamLogo";
import {
  enablePushAlerts, getPushState, resyncPushSubscription, sendTestPush,
  type PushState,
} from "../lib/push";

/**
 * FILL ALERTS — Web Push when a resting order fills (owner ask 2026-08-29:
 * "notifications as resting stuff fills so that I don't miss anything").
 * The server half polls Kalshi fills each minute and pushes maker fills to
 * every subscribed device; this row is enable + test for THIS device. The
 * worker behind it is push-only by rule (src/sw.ts — no fetch handler).
 */
function FillAlertsRow({ token }: { token: string }) {
  const [state, setState] = useState<PushState | "checking">("checking");
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getPushState().then((s) => { if (alive) setState(s); });
    // Deploy-wipe healing: a subscribed device re-registers itself on every
    // owner session, so the server's ephemeral store refills without help.
    void resyncPushSubscription(token);
    return () => { alive = false; };
  }, [token]);

  const run = (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true); setMsg("");
    fn()
      .then(async () => { setMsg(okMsg); setState(await getPushState()); })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (state === "checking") return null;
  if (state === "unsupported") {
    return (
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        This browser has no push support (iPhone: install to the home screen first).
      </span>
    );
  }
  if (state === "denied") {
    return (
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
        Notifications are blocked for this site in the browser settings.
      </span>
    );
  }
  return (
    <>
      {state === "enabled" ? (
        <>
          <span style={{ fontSize: 12, color: "var(--pos)" }}>On for this device</span>
          <button type="button" className="ui-btn" disabled={busy}
                  onClick={() => run(() => sendTestPush(token), "Test sent — it should arrive within seconds.")}
                  style={{ padding: "3px 10px", fontSize: 11 }}>
            Send test
          </button>
        </>
      ) : (
        <button type="button" className="ui-btn" disabled={busy}
                onClick={() => run(() => enablePushAlerts(token), "Enabled — this device gets fill alerts.")}
                style={{ padding: "3px 10px", fontSize: 11 }}>
          {busy ? "Enabling…" : "Enable fill alerts"}
        </button>
      )}
      <span style={{ fontSize: 10.5, color: msg.includes("Enabled") || msg.includes("Test sent") ? "var(--pos)" : "var(--muted)" }}>
        {msg || "Pushes when a resting order fills and when bets settle, even with the site closed."}
      </span>
    </>
  );
}

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
function FriendJoin({ token, ticker, side, price, unit }: {
  token: string; ticker: string; side: "yes" | "no"; price: number;
  unit: number;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const count = Math.max(1, Math.floor(unit / price));
  const cost = count * price;

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
function FriendBookBlock({ book, token, unit, slugTeams, codeToSlug, yesP }: {
  book: FriendBook; token: string; unit: number;
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
                  {p.count} × {cheerLabelWithGame(p.ticker, p.side, g.names)}
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
                              price={join} unit={unit} />
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
              {when(f.created_time)} · filled {f.count ?? "?"} × {cheerLabelWithGame(f.ticker, f.side, g.names)}
            </div>
          ))}
        </div>
        );
      })}
    </div>
  );
}

function FriendFeedRow({ token, unit, slugTeams, codeToSlug, yesP }: {
  token: string; unit: number;
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
    <Row label="Friends" top={open}>
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
                           unit={unit} slugTeams={slugTeams}
                           codeToSlug={codeToSlug} yesP={yesP} />
        ))}
      </div>
    </Row>
  );
}

function Row({ label, children, top = false }: {
  label: string;
  children: React.ReactNode;
  /** A row whose content is a STACK (the settled record) pins its label to the
   *  first line instead of floating it beside the middle of the block. */
  top?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: top ? "flex-start" : "center", gap: 10,
      flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid var(--border)",
    }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.4, minWidth: 66,
        textTransform: "uppercase", color: "var(--muted)",
        ...(top ? { paddingTop: 13 } : null),
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function MyBookPanel({
  token, onToken, note, connected, ordersLive, accountLabel, unit, onUnit,
  totals, unmatched, record, slugTeams, codeToSlug, portalYesP, children,
}: {
  token: string;
  /** "" disconnects. Persisting is the caller's job (writePortalToken). */
  onToken: (t: string) => void;
  /** One-line status from the page ("3 bets · 2 games on this board", …). */
  note: string;
  /** Portal session is live (status === "ok"). */
  connected: boolean;
  /** Server's CFB_ORDERS_LIVE for THIS account. False => placements are
   *  staged, not sent. */
  ordersLive: boolean;
  /** Which Kalshi account the password logged into (multi-account server).
   *  Undefined until the first payload, or on a pre-multi-account server —
   *  the row then just says "Connected" with no name. */
  accountLabel?: string;
  unit: number;
  onUnit: (v: number) => void;
  totals: PortalTotals;
  unmatched: number;
  /** REAL settled results on the games this board is showing. The row renders
   *  only when something has actually settled on them — an empty record is not
   *  a 0-0 line, it is no line. */
  record: SettlementRecord;
  /** slug -> the card's real team names, passed straight through to
   *  `KalshiRecordBlock` — see that component's doc for what it is used for. */
  slugTeams: Map<string, BetGameNames>;
  /** ticker game-code -> slug, for naming the Friend Feed's game groups. */
  codeToSlug: Map<string, string>;
  /** ticker -> sim P(YES) — the same pricer the held book uses. The Friend
   *  Feed's Join gate: a friend's bet is only joinable while the CURRENT
   *  price is still +EV against this fair, fees included. */
  portalYesP: (t: string) => number | null;
  /** The Suggested bets card — rendered inside the console it belongs to. */
  children?: React.ReactNode;
}) {
  // Local text state so a half-typed "1" is not clamped to 1 mid-keystroke;
  // the committed value is clamped on blur / Enter.
  const [unitText, setUnitText] = useState<string>(String(unit));
  const [kill, setKill] = useState<{ busy: boolean; msg: string } | null>(null);

  const commitUnit = () => {
    const v = clampUnit(unitText);
    onUnit(v);
    setUnitText(String(v));
  };

  const runKill = async () => {
    setKill({ busy: true, msg: "" });
    try {
      const r = await cancelAppOrders(token);
      const n = Array.isArray(r.body?.cancelled) ? r.body.cancelled.length : 0;
      setKill({
        busy: false,
        msg: r.status === 200
          ? (n ? `Cancelled ${n} app order${n === 1 ? "" : "s"}.`
               : "No resting app orders to cancel.")
          : placeErrorText(r.body as PlaceResponse),
      });
    } catch {
      setKill({ busy: false, msg: "Cancel failed — network." });
    }
  };

  return (
    <section className="card" style={{
      padding: "8px 12px 10px", marginBottom: 16, display: "grid", gap: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", paddingBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>
          My Book
        </span>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{note}</span>
        {token && !ordersLive && (
          <span style={{ marginLeft: "auto" }}>
            <DryRunBadge title="Order entry is staged for this account: the server validates, caps, re-checks the book and logs — and submits nothing." />
          </span>
        )}
      </div>

      <Row label="Account">
        {token ? (
          <>
            <span style={{ fontSize: 12, color: connected ? "var(--pos)" : "var(--muted)" }}>
              {/* The password IS the account (multi-account server), so the
                  connected line names WHOSE book this is — a trader must never
                  have to infer whose money is on screen. */}
              {connected
                ? accountLabel ? `Connected — ${accountLabel}` : "Connected"
                : "Connecting…"}
            </span>
            <button type="button" className="ui-btn" onClick={() => onToken("")}
                    style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}>
              Disconnect
            </button>
          </>
        ) : (
          <form
            style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              const t = String(new FormData(e.currentTarget).get("tok") || "").trim();
              if (t) onToken(t);
            }}
          >
            <input name="tok" type="password" placeholder="portal password"
                   className="ui-sel" autoComplete="current-password"
                   style={{ fontSize: 12 }} />
            <button type="submit" className="ui-btn" style={{ padding: "3px 10px", fontSize: 11 }}>
              Connect
            </button>
          </form>
        )}
      </Row>

      <Row label="Unit size">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>$</span>
          <input
            type="number" inputMode="numeric"
            min={UNIT_MIN} max={UNIT_MAX} step={1}
            value={unitText}
            onChange={(e) => setUnitText(e.target.value)}
            onBlur={commitUnit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitUnit(); } }}
            className="ui-sel"
            aria-label="Unit size in dollars per ladder"
            style={{ width: 76, fontSize: 13, fontWeight: 800, textAlign: "right" }}
          />
        </label>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          per ladder (${UNIT_MIN}–${UNIT_MAX}) — sizes every suggestion and slip
        </span>
      </Row>

      {token && (
        <Row label="Orders">
          <button type="button" className="ui-btn" onClick={runKill} disabled={kill?.busy}
                  title="Cancel every resting order this app placed (cfbapp-tagged only — the maker pipeline's book is untouched)"
                  style={{ padding: "3px 10px", fontSize: 11 }}>
            {kill?.busy ? "Cancelling…" : "Cancel my app orders"}
          </button>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
            {kill?.msg || "Pulls only orders placed from this app."}
          </span>
        </Row>
      )}

      {token && (
        <Row label="Alerts">
          <FillAlertsRow token={token} />
        </Row>
      )}

      {token && totals.n > 0 && (
        <Row label="Book">
          {/* Same compression as one bet on a card: what is at stake, then the
              ONE verdict. Risk → payout, fees, both sources' EV and how many
              bets each could price are behind the tap. */}
          <MyBookBar totals={totals} unmatched={unmatched} />
        </Row>
      )}

      {/* The REALISED half, directly under the open book: what these games
          have already settled for. Nothing settled on this board yet (or no
          settlement joins it) => no row at all, rather than an honest-looking
          0-0 that is really "we have no data". */}
      {token && record.slate.n > 0 && (
        <Row label="Record" top>
          <KalshiRecordBlock record={record} slugTeams={slugTeams} />
        </Row>
      )}

      {/* The friend pair's books, when the server declares one — renders
          nothing at all otherwise (no empty "Friends" shell). */}
      {token && (
        <FriendFeedRow token={token} unit={unit}
                       slugTeams={slugTeams} codeToSlug={codeToSlug}
                       yesP={portalYesP} />
      )}

      {children && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 1 }}>
          {children}
        </div>
      )}
    </section>
  );
}
