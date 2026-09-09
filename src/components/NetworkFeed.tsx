// src/components/NetworkFeed.tsx
//
// "WHAT YOUR FRIENDS ARE ON" — the feed, and since 2026-09-09 it is
// AUTOMATIC. There is no "post a pick" form any more and nothing here writes
// to the database at all. Every order placed through the app is already
// mirrored into `app_orders` server-side; that row IS the feed item, so a bet
// reaches your friends by being placed, not by being typed twice.
//
// ONE ROW READS AS ONE SENTENCE:
//
//     mvpeav placed 1.5 units on Rutgers over 23.5 points at 59c
//     · sim EV +0.21 per $1
//
// which is why the placement now sends the bet's own words and the two sim
// numbers (supabase/migrations/20260909_feed_detail.sql). A row that predates
// that, or one whose title never arrived, falls back to the ticker rather than
// disappearing.
//
// THE FILTERING IS THE DATABASE'S JOB, not this component's. `feed_items` is a
// security_invoker view over RLS-protected tables, so what comes back is
// already exactly what this viewer may see. There is no client-side "is this
// mine / are we friends" test anywhere in this file, and adding one would be a
// second, weaker copy of a rule the database already enforces.
//
// AND THERE ARE NO DOLLARS. The view carries UNITS of the poster's own unit
// and the market price, for every row including the viewer's own (owner rule
// 2026-09-08). Nothing on this surface can print a count, a cost or a fill,
// because the query it reads does not select one.
//
// GROUPED BY DAY, newest first: the feed is a timeline of what people did, and
// "today / yesterday / Saturday" is how anyone recalls a bet.
//
// FOUR KINDS, ONE CARD LANGUAGE (owner 2026-09-08 11:25 PM). Every row is the
// same sentence with the same matchup logos on its left; what changes is the
// verb and what hangs off the end:
//
//   PLACED    mvpeav placed 0.97 units on Massachusetts 10+ points at 59c
//   TAIL      roth tailed mvpeav · 0.16 units on … at 60c
//   SETTLED   the SAME row, now wearing a WON / LOST / PUSH ribbon and the
//             money in the poster's units (+0.64u) — a settlement is not a
//             new item, it is the item you already saw, finished
//   SCORE     San José State 24 – Eastern Michigan 21, Q4 11:19
//             your San José State ML now 58% (was 34%)
//
// The tail link and the "tailed by N" chip are resolved INSIDE the rows this
// viewer already has: `tailed_from` is an order id and the parent, if the
// viewer may see it at all, is in the same RLS-filtered result set. A parent
// that is not there is not fetched behind the user's back — the row simply
// says "tailed a bet" and names nobody.

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import Flares from "./Flares";
import {
  supabase, supabaseEnabled, useProfile, useSession,
  type FeedItem, type FeedScorePayload,
} from "../lib/supabase";
// The same helper the Top Edges rows badge their teams with — one logo file,
// one mapping, everywhere a school is drawn.
import { getTeamLogo } from "../utils/teamLogo";
// One map from a stored league id to the words a reader sees. The book is
// sport-agnostic — NCAAB lands on the same account next season — so a row says
// which league it is about (src/lib/leagues.ts).
import { leagueLabel } from "../lib/leagues";

export type NetworkFeedProps = {
  /** Calendar season, for the single-week view. */
  season: number;
  /** Week number, for the single-week view. */
  week: number;
  /** EVERY week, newest first (the dashboard reads the feed as a timeline).
   *  Without it the feed is scoped to `season`/`week` plus rows nobody could
   *  date, so an order never silently vanishes. */
  allWeeks?: boolean;
  /** Start expanded. The dashboard's feed IS the section, so a press to see
   *  anything would be a click for nothing. */
  startOpen?: boolean;
};

/** How often the feed re-reads itself when the live channel is NOT up. The
 *  realtime subscription is the fast path; this is the one that has to work
 *  on a locked-down network, a dropped socket, or a project with realtime
 *  switched off. */
const POLL_MS = 60_000;

export default function NetworkFeed({
  season, week, allWeeks = false, startOpen = true,
}: NetworkFeedProps) {
  const { session, loading } = useSession();
  const { profile } = useProfile(session);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(startOpen);
  /** Whether the postgres_changes channel actually came up. Shown as two
   *  words, because "live" and "checking every minute" are different promises
   *  and the reader should know which one they have. */
  const [live, setLive] = useState(false);
  /** Re-render once a minute so "4 min ago" is not a lie by the fifth. */
  const [, setTick] = useState(0);

  const signedIn = Boolean(session && profile);

  const load = useCallback(async () => {
    if (!supabase || !signedIn) return;
    let q = supabase.from("feed_items").select("*");
    if (!allWeeks) {
      // RLS still decides WHOSE rows come back, so a wider window is never a
      // wider audience — only a longer one.
      q = q.or(`and(season.eq.${season},week.eq.${week}),week.is.null`);
    }
    const { data, error } = await q.order("at", { ascending: false }).limit(200);
    if (error) { setErr(error.message); return; }
    setErr(null);
    setItems((data ?? []) as FeedItem[]);
  }, [signedIn, season, week, allWeeks]);

  useEffect(() => { void load(); }, [load]);

  /**
   * LIVE. A friend places a bet and this feed shows it without a refresh.
   *
   * Two rules hold it together:
   *  1. RLS APPLIES TO REALTIME. A subscriber is handed only rows its own
   *     policies would return, so the broadcast is not a second, wider read
   *     path — the same reason the query above needs no client-side filter.
   *  2. THE EVENT IS A DOORBELL, NOT THE DATA. Every event triggers a REFETCH
   *     of `feed_items`; nothing renders from the payload. The payload is a
   *     raw `app_orders` row (it carries cost and count) and it has not been
   *     through the view that strips them. Refetching keeps one path to the
   *     screen and that path is the RLS-filtered, money-free one.
   *
   * If the channel does not come up — realtime off, a proxy eating the socket
   * — the 60s poll below is the whole feature, a minute late.
   *
   * THREE SUBSCRIPTIONS, because there are three ways the feed changes:
   * a bet is PLACED (app_orders INSERT — a tail is a placement like any
   * other), a bet SETTLES (app_orders UPDATE, which rewrites a row that is
   * already on screen), and a game MOVES (feed_events INSERT). All three are
   * doorbells into the same refetch.
   */
  useEffect(() => {
    if (!supabase || !signedIn) return;
    let alive = true;
    const ring = () => { if (alive) void load(); };
    const ch = supabase
      .channel("feed-app-orders")
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "app_orders" }, ring)
      .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "app_orders" }, ring)
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "feed_events" }, ring)
      .subscribe((status) => {
        if (!alive) return;
        setLive(status === "SUBSCRIBED");
      });
    return () => { alive = false; setLive(false); void supabase!.removeChannel(ch); };
  }, [signedIn, load]);

  /** The fallback, and the clock. It runs whether or not the channel is up:
   *  when it is, a minute-late re-read costs one small query and covers the
   *  case where the socket died without saying so. */
  useEffect(() => {
    if (!signedIn) return;
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [signedIn, load]);

  const days = useMemo(() => groupByDay(items), [items]);

  /** THE TAIL GRAPH, built from what is already loaded. `byOrderId` resolves
   *  a tail to the bet it copied so the row can name the poster it followed;
   *  `tailCounts` is how many of the loaded rows copied each bet. Both are
   *  deliberately scoped to the visible rows — a count that reached past RLS
   *  would be telling the viewer about bets they may not see. */
  const byOrderId = useMemo(() => {
    const m = new Map<string, FeedItem>();
    for (const i of items) if (i.kind === "order" && i.order_id) m.set(i.order_id, i);
    return m;
  }, [items]);
  const tailCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      if (i.tailed_from) m.set(i.tailed_from, (m.get(i.tailed_from) ?? 0) + 1);
    }
    return m;
  }, [items]);

  /** Bets, not rows: a score update is news about a bet, not another bet. */
  const betCount = useMemo(
    () => items.filter((i) => i.kind !== "score").length, [items]);

  if (!supabaseEnabled) return null;
  if (loading) return null;

  if (!signedIn) {
    return (
      <AuthPanel compact
                 prompt="Sign in to see what your friends are on." />
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="ui-btn" onClick={() => setOpen((v) => !v)}
                style={{ padding: "3px 10px", fontSize: 11 }}>
          {open ? "Hide" : "Show"} feed
        </button>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {betCount === 0
            ? "nothing yet"
            : `${betCount} bet${betCount === 1 ? "" : "s"}`}
          {" · "}
          {live ? "updating live" : "checking every minute"}
        </span>
      </div>

      {err && <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{err}</span>}

      {open && items.length === 0 && (
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          No bets from your friends yet — add friends by username above.
        </span>
      )}

      {open && days.map((d) => (
        <div key={d.key} style={{ display: "grid", gap: 2 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
            textTransform: "uppercase", color: "var(--muted)",
            padding: "2px 0",
          }}>
            {d.label}
          </div>
          {d.items.map((it) => (
            <FeedRow key={`${it.kind}:${it.id}`} item={it}
                     tailOf={it.tailed_from ? byOrderId.get(it.tailed_from) : undefined}
                     tailedBy={it.order_id ? (tailCounts.get(it.order_id) ?? 0) : 0} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- one bet ---------------------------------- */

/**
 * ONE ROW, ONE SENTENCE. Two team logos with the posted side lit, the poster's
 * emoji, name and flares, what they are on and for how much, and how long ago.
 *
 * There is deliberately no dollar figure anywhere: the view does not carry
 * one, for anyone's rows, including the viewer's own. `units_net` is the same
 * kind of number as `units` — a count of the poster's own unit — and the unit
 * itself is a private column no client role may select, so "+0.64u" is not a
 * dollar amount in disguise.
 */
function FeedRow({ item, tailOf, tailedBy }: {
  item: FeedItem;
  /** The bet this one copied, when it is among the loaded rows. */
  tailOf?: FeedItem;
  /** How many loaded rows copied THIS bet. */
  tailedBy: number;
}) {
  if (item.kind === "score") return <ScoreRow item={item} />;
  const bet = betText(item);
  const side = postedSide(item);
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "7px 0", borderTop: "1px solid var(--border)",
    }}>
      <MatchupLogos home={item.home_team} away={item.away_team} on={side} />
      <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
          fontSize: 11.5, lineHeight: 1.45,
        }}>
          <span aria-hidden style={{ fontSize: 14 }}>{item.avatar_emoji || "🏈"}</span>
          <span style={{ fontWeight: 800 }} title={`@${item.handle}`}>
            {item.display_name || item.handle}
          </span>
          <Flares flares={item.flares} />
          {/* A TAIL NAMES WHO IT FOLLOWED, when the parent is visible to this
              viewer. It is the whole point of the verb: "tailed" with nobody
              after it is just a bet. */}
          <span style={{ color: "var(--muted)" }}>{verb(item)}</span>
          {item.tailed_from && (
            <span style={{ fontWeight: 800 }} title={tailOf ? `@${tailOf.handle}` : undefined}>
              {tailOf ? (tailOf.display_name || tailOf.handle) : "a bet"}
            </span>
          )}
          {item.tailed_from && <span style={{ color: "var(--muted)" }}>·</span>}
          {(() => {
            const u = unitsText(item.units);
            return u
              ? <span style={{ fontWeight: 800 }}>{u}</span>
              : null;
          })()}
          <span style={{ color: "var(--muted)" }}>on</span>
          <span style={{ fontWeight: 700 }}>{bet}</span>
          {item.price != null && (
            <>
              <span style={{ color: "var(--muted)" }}>at</span>
              <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>
                {Math.round(item.price * 100)}¢
              </span>
            </>
          )}
          {/* THE RIBBON. A settled bet is the same item, finished — so the
              grade rides at the end of the sentence it belongs to rather than
              arriving as a second row nobody asked for. */}
          <Ribbon result={item.result} unitsNet={item.units_net} />
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
          fontSize: 10.5, color: "var(--muted)",
        }}>
          {item.ev_fee != null && Number.isFinite(item.ev_fee) && (
            <span>
              sim EV{" "}
              <span style={{
                fontWeight: 800,
                color: item.ev_fee >= 0 ? "var(--pos)" : "var(--neg)",
              }}>
                {item.ev_fee >= 0 ? "+" : ""}{item.ev_fee.toFixed(2)}
              </span>{" "}
              per $1
            </span>
          )}
          {item.sim_p != null && Number.isFinite(item.sim_p) && (
            <span>sim {Math.round(item.sim_p * 100)}%</span>
          )}
          {/* THE LEAGUE, as a chip. Absent on an unlabelled row rather than
              guessed — an old bet says nothing about its sport and this feed
              does not invent one for it. */}
          {leagueLabel(item.sport) && (
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3,
              textTransform: "uppercase", color: "var(--muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              padding: "0 5px", whiteSpace: "nowrap",
            }}>
              {leagueLabel(item.sport)}
            </span>
          )}
          {/* WHO FOLLOWED THIS ONE. Counted over the rows this viewer can
              already see, so it can never announce a bet they may not. */}
          {tailedBy > 0 && (
            <span style={{ fontWeight: 700 }}>
              tailed by {tailedBy}
            </span>
          )}
          <span>{ago(item.at)}</span>
        </div>
        {item.note && (
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>“{item.note}”</span>
        )}
      </div>
    </div>
  );
}

/** "tailed" for a copy, "placed" for an app order, "posted" for a legacy
 *  hand-typed pick. The form is gone; the rows people already wrote stay, and
 *  stay honest about which they are. */
const verb = (item: FeedItem) =>
  item.tailed_from ? "tailed" : (item.source === "posted" ? "posted" : "placed");

/* ------------------------------ settled ----------------------------------- */

/**
 * WON / LOST / PUSH, and what it paid in the poster's own units.
 *
 * Renders NOTHING for an open bet, which is why a settlement needs no second
 * feed item: the row a friend already scrolled past simply grows a ribbon
 * when the game finishes.
 *
 * The colour follows the MONEY (`units_net`), not the word: they agree in
 * every ordinary case, and where they can differ — a win so thin the fees ate
 * it, which is exactly the case a bettor wants to see — the sign is the truth
 * and the word is the record. A push is neither, so it stays muted.
 */
function Ribbon({ result, unitsNet }: {
  result: FeedItem["result"]; unitsNet: number | null;
}) {
  if (!result) return null;
  const net = unitsNet != null && Number.isFinite(unitsNet) ? unitsNet : null;
  const tone = result === "push" || net === 0 || net == null
    ? "var(--muted)"
    : (net > 0 ? "var(--pos)" : "var(--neg)");
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
    }}>
      <span style={{
        fontSize: 9.5, fontWeight: 900, letterSpacing: 0.5,
        textTransform: "uppercase", color: tone,
        border: `1px solid ${tone}`, borderRadius: 5, padding: "0 5px",
      }}>
        {result}
      </span>
      {net != null && (
        <span style={{ fontWeight: 900, color: tone }}>
          {net > 0 ? "+" : net < 0 ? "−" : "±"}{Math.abs(net).toFixed(2)}u
        </span>
      )}
    </span>
  );
}

/* ---------------------------- score update -------------------------------- */

/**
 * A GAME MOVED AND IT MOVED SOMEBODY'S BET.
 *
 * Same card language as a placement — the two logos, the person, one sentence
 * — but the verb is the scoreboard's, not the bettor's, so the score itself is
 * the loudest thing on the row and the bet hangs off it:
 *
 *     🏈 mvpeav · San José State 24 – Eastern Michigan 21 · Q4 11:19
 *        San José State ML now 58% (was 34%) · 0.95 units
 *
 * The two probabilities are the LIVE probability of the side that was taken,
 * before and after the play. They are rates about a public game, never a
 * quantity of anyone's money, which is the same test `sim_p` passes.
 */
function ScoreRow({ item }: { item: FeedItem }) {
  const p: FeedScorePayload = item.payload ?? {};
  const s = p.score ?? {};
  const home = s.home_team ?? item.home_team;
  const away = s.away_team ?? item.away_team;
  const before = typeof p.prob_before === "number" ? p.prob_before : null;
  const after = typeof p.prob_after === "number" ? p.prob_after : null;
  const moved = before != null && after != null ? after - before : null;
  const tone = moved == null || Math.abs(moved) < 0.005
    ? "var(--muted)" : (moved > 0 ? "var(--pos)" : "var(--neg)");
  const when = [
    p.period ? `Q${p.period}` : null,
    p.clock || null,
  ].filter(Boolean).join(" ");

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "7px 0", borderTop: "1px solid var(--border)",
    }}>
      <MatchupLogos home={home} away={away} on={null} />
      <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
          fontSize: 11.5, lineHeight: 1.45,
        }}>
          <span aria-hidden style={{ fontSize: 14 }}>{item.avatar_emoji || "🏈"}</span>
          <span style={{ fontWeight: 800 }} title={`@${item.handle}`}>
            {item.display_name || item.handle}
          </span>
          <Flares flares={item.flares} />
          <span style={{ color: "var(--muted)" }}>·</span>
          <span style={{ fontWeight: 800 }}>
            {away} {s.away ?? "–"} – {home} {s.home ?? "–"}
          </span>
          {when && <span style={{ color: "var(--muted)" }}>{when}</span>}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
          fontSize: 10.5, color: "var(--muted)",
        }}>
          {p.side && <span style={{ fontWeight: 700, color: "var(--text)" }}>{p.side}</span>}
          {after != null && (
            <span>
              now{" "}
              <span style={{ fontWeight: 900, color: tone }}>
                {Math.round(after * 100)}%
              </span>
              {before != null && ` (was ${Math.round(before * 100)}%)`}
            </span>
          )}
          {(() => {
            const u = unitsText(typeof p.units === "number" ? p.units : null);
            return u ? <span>{u}</span> : null;
          })()}
          {leagueLabel(item.sport) && (
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3,
              textTransform: "uppercase", color: "var(--muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              padding: "0 5px", whiteSpace: "nowrap",
            }}>
              {leagueLabel(item.sport)}
            </span>
          )}
          <span>{ago(item.at)}</span>
        </div>
      </div>
    </div>
  );
}

/** A size in units, in the words people use: "1.5 units", "0.5 units", and
 *  "1 unit" when it is exactly one. Null renders as nothing at all — never as
 *  a guessed unit. */
function unitsText(u: number | null): string | null {
  if (u == null || !Number.isFinite(u) || u <= 0) return null;
  const r = Math.round(u * 100) / 100;
  const n = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
  return `${n} unit${r === 1 ? "" : "s"}`;
}

/** THE BET IN WORDS. The confirmed title when the row carries one; a posted
 *  pick spells out side + line; otherwise the exchange's own string, which is
 *  ugly but true. */
function betText(item: FeedItem): string {
  if (item.title) return item.title;
  if (item.kind === "order") return item.ticker || item.side;
  const line = item.line == null ? "" : ` ${item.line > 0 ? "+" : ""}${item.line}`;
  return `${item.side}${line}`;
}

/** WHICH TEAM WAS BACKED, for the logo highlight — read off the bet's own
 *  words, because that is the only place the answer honestly lives (a total
 *  names neither team, and "yes"/"no" is about a contract, not a side). Null
 *  means light both equally rather than guess. */
function postedSide(item: FeedItem): "home" | "away" | null {
  const t = (item.title || "").toLowerCase();
  if (!t) return null;
  const home = (item.home_team || "").toLowerCase();
  const away = (item.away_team || "").toLowerCase();
  const inHome = home.length > 2 && t.includes(home);
  const inAway = away.length > 2 && t.includes(away);
  if (inHome === inAway) return null;
  return inHome ? "home" : "away";
}

/** The two schools, away then home, the backed one at full strength and the
 *  other faded. A row with no matchup shows a fixed-width blank so every
 *  sentence still starts on the same column. */
function MatchupLogos({ home, away, on }: {
  home: string | null; away: string | null; on: "home" | "away" | null;
}) {
  const size = 18;
  const pair: { name: string; src: string | undefined; which: "home" | "away" }[] = [
    { name: away ?? "", src: getTeamLogo(away), which: "away" },
    { name: home ?? "", src: getTeamLogo(home), which: "home" },
  ].filter((x) => x.src) as any;
  if (!pair.length) {
    return <span aria-hidden style={{ width: size * 2 + 3, flex: "none" }} />;
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, flex: "none",
      width: size * 2 + 3, justifyContent: "flex-start",
    }}>
      {pair.map((p) => (
        <img key={p.which} src={p.src} alt="" title={p.name}
             width={size} height={size} loading="lazy"
             style={{
               objectFit: "contain",
               // The backed side is the one the row is ABOUT; the other is
               // context. Opacity says so without adding a word.
               opacity: on === null || on === p.which ? 1 : 0.3,
             }} />
      ))}
    </span>
  );
}

/* ------------------------------ day grouping ------------------------------ */

type Day = { key: string; label: string; items: FeedItem[] };

const DAY_MS = 86_400_000;

/** Group by LOCAL calendar day, newest first. The view is already time-ordered
 *  descending, so first appearance is newest and no re-sort is needed. */
function groupByDay(items: FeedItem[]): Day[] {
  const out: Day[] = [];
  const byKey = new Map<string, Day>();
  for (const it of items) {
    const d = new Date(it.at);
    const key = Number.isNaN(d.getTime())
      ? "unknown"
      : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: key === "unknown" ? "Earlier" : dayLabel(d), items: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

const midnight = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayLabel(d: Date): string {
  const diff = Math.round((midnight(new Date()) - midnight(d)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "just now" / "4 min ago" / "3 h ago" / "2 d ago". */
function ago(at: string): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
