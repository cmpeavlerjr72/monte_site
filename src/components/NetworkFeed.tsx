// src/components/NetworkFeed.tsx
//
// "WHAT YOUR FRIENDS ARE ON" — the feed, and since 2026-09-09 it is
// AUTOMATIC. There is no "post a pick" form any more and nothing here writes
// to the database at all. Every order placed through the app is already
// mirrored into `app_orders` server-side; that row IS the feed item, so a bet
// reaches your friends by being placed, not by being typed twice.
//
// ────────────────────────────────────────────────────────────────────────────
// THE FACE OF A ROW IS GLYPHS AND NUMBERS. THE SENTENCE IS ON TAP.
// (owner 2026-09-09, the "drunk at a bar" rule + the Team Stats v3 house style)
//
// This surface used to render one English sentence per row:
//
//     🏈 mvpeav placed 1.5 units on Rutgers over 23.5 points at 59¢
//        sim EV +0.21 per $1 · sim 63% · FBS FOOTBALL · 4 min ago
//
// which is a good sentence and a bad glance. Nothing in it is lost — it is now
// what a tap on the row reveals — but the FACE of the card is the four things
// a reader wants at arm's length: WHO, WHICH GAME, WHAT BET, HOW IT IS GOING.
//
//   ▎@mvpeav ᵃᵇ   🏈 [logo][logo] Rutgers o23.5 · 59¢ · 1.5u · EV +0.21  PLACED 4m
//
// FOUR RULES HOLD THE LAYOUT TOGETHER:
//
//  1. HANGING INDENT. Two columns: a fixed overhang carrying ONLY the handle
//     and its flares, and a content block that starts at the end of it and
//     stays left-aligned to that edge on every wrapped line. A reader runs
//     down one edge to read the bets. On a phone the overhang narrows and the
//     bet wraps to a second line UNDER the logos, never back under the handle.
//     (Geometry lives in theme.css `.feed__*`; the widths are a media query,
//     which is why that part is CSS and not inline style like the rest.)
//
//  2. THE KIND IS A COLOUR RAIL PLUS A WORD. 4px at the far left edge —
//     placed = --brand, tailed = --accent, score = --info, settled =
//     --pos/--neg/--muted — and the same fact spelled as a one-word tag at the
//     right edge of the content block (PLACED / TAIL / SCORE / WON / LOST /
//     PUSH). Colour never carries an identity alone, the same rule the
//     execution-mode chips follow.
//
//  3. THE SPORT IS AN EMOJI, THE LEAGUE IS ITS TOOLTIP (src/lib/leagues.ts).
//     "FCS FOOTBALL" in small caps beside a bet out-shouts the bet.
//
//  4. A SETTLEMENT'S UNITS FIGURE IS THE BIGGEST THING ON ITS ROW. When a bet
//     is done the answer is the money, so "+1.45u" in the result's colour
//     outweighs everything else on the line it belongs to.
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
// "today / yesterday / Saturday" is how anyone recalls a bet. Consecutive rows
// from the SAME poster inside one day leave the overhang blank, the way a
// thread does — the rail, the tag, the popover and the row's accessible label
// all still say whose it is, so nothing is withheld, only un-repeated.
//
// The tail link and the "tailed by N" count are resolved INSIDE the rows this
// viewer already has: `tailed_from` is an order id and the parent, if the
// viewer may see it at all, is in the same RLS-filtered result set. A parent
// that is not there is not fetched behind the user's back — the row simply
// says it tailed a bet and names nobody.

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
// One map from a stored league id to what a reader sees: the emoji on the face
// of the card, the words in its tooltip and in the popover (src/lib/leagues.ts).
import { leagueEmoji, leagueLabel } from "../lib/leagues";

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
  /** Re-render once a minute so "4m" is not a lie by the fifth. */
  const [, setTick] = useState(0);
  /** Which row has its words open. ONE at a time: the popover is the reading
   *  of one row, and two open at once is a paragraph again. */
  const [pop, setPop] = useState<string | null>(null);

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
          {" · "}
          tap a row for the words
        </span>
      </div>

      {err && <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{err}</span>}

      {open && items.length === 0 && (
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          No bets from your friends yet — add friends by username above.
        </span>
      )}

      {open && days.map((d) => (
        <div key={d.key} style={{ display: "grid", gap: 0 }}>
          <div style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4,
            textTransform: "uppercase", color: "var(--muted)",
            padding: "4px 0 1px",
          }}>
            {d.label}
          </div>
          {d.items.map((it, i) => {
            const key = `${it.kind}:${it.id}`;
            return (
              <FeedRow
                key={key} item={it} rowKey={key}
                tailOf={it.tailed_from ? byOrderId.get(it.tailed_from) : undefined}
                tailedBy={it.order_id ? (tailCounts.get(it.order_id) ?? 0) : 0}
                // A THREAD, not a repetition: the same person twice in a row
                // inside one day keeps the overhang blank.
                threaded={i > 0 && d.items[i - 1].user_id === it.user_id}
                open={pop === key}
                onToggle={() => setPop((p) => (p === key ? null : key))}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- a row ---------------------------------- */

/**
 * ONE ROW: rail, overhang, content block, kind tag + clock at the right edge —
 * and, underneath when tapped, the sentence it used to be.
 *
 * There is deliberately no dollar figure anywhere: the view does not carry
 * one, for anyone's rows, including the viewer's own. `units_net` is the same
 * kind of number as `units` — a count of the poster's own unit — and the unit
 * itself is a private column no client role may select, so "+0.64u" is not a
 * dollar amount in disguise.
 */
function FeedRow({ item, rowKey, tailOf, tailedBy, threaded, open, onToggle }: {
  item: FeedItem;
  rowKey: string;
  /** The bet this one copied, when it is among the loaded rows. */
  tailOf?: FeedItem;
  /** How many loaded rows copied THIS bet. */
  tailedBy: number;
  /** Previous row in this day is the same poster — blank the overhang. */
  threaded: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const k = kindOf(item);
  const lines = words(item, tailOf, tailedBy);
  return (
    <div className="feed__item">
      <button type="button" className="feed__row" onClick={onToggle}
              aria-expanded={open} aria-controls={`${rowKey}-words`}
              // The sentence is the row's accessible name and its hover text,
              // so the words are never further away than a pointer rest —
              // the tap is for the phone.
              aria-label={lines.join(" ")} title={lines.join("\n")}>
        <span aria-hidden className="feed__rail" style={{ background: k.tone }} />

        <span className="feed__hang">
          {!threaded && (
            <span className="feed__handle" title={`@${item.handle}`}>
              @{item.handle}
              <Flares flares={item.flares} raised />
            </span>
          )}
          {/* WHO FOLLOWED THIS ONE, counted over rows this viewer can already
              see, so it can never announce a bet they may not. Gold, on the
              rail side, because a tail is the gold channel. */}
          {tailedBy > 0 && (
            <span style={{
              fontSize: 9.5, fontWeight: 800, color: "var(--accent)",
              whiteSpace: "nowrap",
            }}>
              ↳{tailedBy}
            </span>
          )}
        </span>

        <span className="feed__body">
          {item.kind === "score"
            ? <ScoreFace item={item} />
            : <BetFace item={item} tailOf={tailOf} tone={k.tone} />}
        </span>
      </button>

      {open && (
        <div id={`${rowKey}-words`} role="status" className="feed__pop">
          {lines.map((l, i) => <div key={i}>{l}</div>)}
          <button type="button" className="ui-btn" onClick={onToggle}
                  style={{ padding: "2px 9px", fontSize: 10.5, marginTop: 3 }}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- the faces -------------------------------- */

/**
 * A PLACEMENT, A TAIL, OR A SETTLED BET — one line of glyphs and numbers.
 *
 * A settlement is not a new item, it is THIS item finished, so it is the same
 * face with the money added and made the loudest thing on it.
 */
function BetFace({ item, tailOf, tone }: {
  item: FeedItem; tailOf?: FeedItem; tone: string;
}) {
  const net = item.units_net != null && Number.isFinite(item.units_net)
    ? item.units_net : null;
  const u = unitsShort(item.units);
  return (
    <span className="feed__line" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
      <SportChip sport={item.sport} />
      <MatchupLogos home={item.home_team} away={item.away_team}
                    on={postedSide(item)} />
      {/* A TAIL POINTS AT WHO IT FOLLOWED, when the parent is visible to this
          viewer. The arrow is the whole verb. */}
      {item.tailed_from && (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
          ↳ {tailOf ? `@${tailOf.handle}` : "a bet"}
        </span>
      )}
      <span style={{ fontWeight: 700, minWidth: 0 }}>{compactBet(item)}</span>
      {item.price != null && (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
          {Math.round(item.price * 100)}¢
        </span>
      )}
      {u && <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{u}</span>}
      <EvChip ev={item.ev_fee} />
      {/* THE ANSWER, when there is one. Bigger than everything else on the row
          because a finished bet is about exactly one number. */}
      {item.result && net != null && (
        <span style={{
          fontSize: 15, fontWeight: 900, color: tone, whiteSpace: "nowrap",
          letterSpacing: -0.2,
        }}>
          {net > 0 ? "+" : net < 0 ? "−" : "±"}{Math.abs(net).toFixed(2)}u
        </span>
      )}
      <RightEdge item={item} tone={tone} />
    </span>
  );
}

/**
 * A GAME MOVED AND IT MOVED SOMEBODY'S BET.
 *
 *   🏈 [logo][logo] SJS 10 – 14 EM · Q3 11:52 · 56% ↓32% · 0.95u    SCORE 2m
 *
 * The two probabilities are the LIVE probability of the side that was taken,
 * before and after the play, and the arrow between them is coloured by which
 * way it went FOR THE POSTER. They are rates about a public game, never a
 * quantity of anyone's money, which is the same test `sim_p` passes.
 *
 * The teams are their logos plus a derived three-letter abbreviation; the full
 * names sit in the logo tooltips and are spelled out in the popover. On a row
 * whose subject IS the scoreboard, the score has to be the legible thing.
 */
function ScoreFace({ item }: { item: FeedItem }) {
  const p: FeedScorePayload = item.payload ?? {};
  const s = p.score ?? {};
  const home = s.home_team ?? item.home_team;
  const away = s.away_team ?? item.away_team;
  const before = typeof p.prob_before === "number" ? p.prob_before : null;
  const after = typeof p.prob_after === "number" ? p.prob_after : null;
  const moved = before != null && after != null ? after - before : null;
  const tone = moved == null || Math.abs(moved) < 0.005
    ? "var(--muted)" : (moved > 0 ? "var(--pos)" : "var(--neg)");
  const when = [p.period ? `Q${p.period}` : null, p.clock || null]
    .filter(Boolean).join(" ");
  const u = unitsShort(typeof p.units === "number" ? p.units : null);

  return (
    <span className="feed__line" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
      <SportChip sport={item.sport} />
      <MatchupLogos home={home} away={away} on={null} />
      <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--muted)" }} title={away ?? undefined}>
          {shortTeam(away)}
        </span>{" "}
        {s.away ?? "–"} – {s.home ?? "–"}{" "}
        <span style={{ color: "var(--muted)" }} title={home ?? undefined}>
          {shortTeam(home)}
        </span>
      </span>
      {when && (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{when}</span>
      )}
      {after != null && (
        <span style={{ whiteSpace: "nowrap" }} title={p.side ?? undefined}>
          {before != null && (
            <span style={{ color: "var(--muted)" }}>
              {Math.round(before * 100)}%{" "}
            </span>
          )}
          <span style={{ color: tone, fontWeight: 900 }}>
            {moved != null && moved < -0.005
              ? "↓"
              : moved != null && moved > 0.005 ? "↑" : "→"}
            {Math.round(after * 100)}%
          </span>
        </span>
      )}
      {u && (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{u}</span>
      )}
      <RightEdge item={item} tone="var(--info)" />
    </span>
  );
}

/** The kind, in one word, and the clock — pinned to the right edge of the
 *  CONTENT BLOCK by `marginLeft: auto`, so on a narrow screen it wraps with
 *  the block instead of escaping it. */
function RightEdge({ item, tone }: { item: FeedItem; tone: string }) {
  const k = kindOf(item);
  return (
    <span style={{
      marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 5,
      whiteSpace: "nowrap", paddingLeft: 6,
    }}>
      <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.5, color: tone }}>
        {k.tag}
      </span>
      <span style={{ fontSize: 9.5, color: "var(--muted)" }}>{ago(item.at)}</span>
    </span>
  );
}

/** THE SIM'S VERDICT on the price, as a chip: green when it liked it, red when
 *  it did not. It is a rate per $1 staked after the fee — the popover says so
 *  in words, because "+0.21" on its own is not a claim anyone can check. */
function EvChip({ ev }: { ev: number | null }) {
  if (ev == null || !Number.isFinite(ev)) return null;
  const tone = ev >= 0 ? "var(--pos)" : "var(--neg)";
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 800, whiteSpace: "nowrap", color: tone,
      border: `1px solid ${tone}`, borderRadius: 5, padding: "0 4px",
      lineHeight: 1.5,
    }}>
      EV {ev >= 0 ? "+" : "−"}{Math.abs(ev).toFixed(2)}
    </span>
  );
}

/** WHICH SPORT, as one glyph with the league in its tooltip. Absent on an
 *  unlabelled row rather than guessed — an old bet says nothing about its
 *  sport and this feed does not invent one for it. */
function SportChip({ sport }: { sport: string | null }) {
  const e = leagueEmoji(sport);
  if (!e) return null;
  const label = leagueLabel(sport) ?? undefined;
  return (
    <span role="img" aria-label={label} title={label}
          style={{ fontSize: 12, lineHeight: 1, flex: "none" }}>
      {e}
    </span>
  );
}

/* ------------------------------- the kinds -------------------------------- */

type Kind = { tag: string; tone: string };

/**
 * WHAT KIND OF ROW THIS IS — the rail's colour and the right edge's word, from
 * ONE place so they can never disagree.
 *
 * On a settlement the colour follows the MONEY (`units_net`), not the word:
 * they agree in every ordinary case, and where they can differ — a win so thin
 * the fees ate it, which is exactly the case a bettor wants to see — the sign
 * is the truth and the word is the record. A push is neither, so it stays
 * muted.
 *
 * PLACED uses `--brand-text` rather than `--brand`: on dark the surface brand
 * is a mid blue that reads fine as a button fill and poorly as a 4px hairline.
 */
function kindOf(item: FeedItem): Kind {
  if (item.kind === "score") return { tag: "SCORE", tone: "var(--info)" };
  if (item.result) {
    const net = item.units_net != null && Number.isFinite(item.units_net)
      ? item.units_net : null;
    const tone = item.result === "push" || net === 0 || net == null
      ? "var(--muted)"
      : (net > 0 ? "var(--pos)" : "var(--neg)");
    return { tag: item.result.toUpperCase(), tone };
  }
  if (item.tailed_from) return { tag: "TAIL", tone: "var(--accent)" };
  return {
    tag: item.source === "posted" ? "POSTED" : "PLACED",
    tone: "var(--brand-text)",
  };
}

/** "tailed" for a copy, "placed" for an app order, "posted" for a legacy
 *  hand-typed pick. The form is gone; the rows people already wrote stay, and
 *  stay honest about which they are. */
const verb = (item: FeedItem) =>
  item.tailed_from ? "tailed" : (item.source === "posted" ? "posted" : "placed");

/* ------------------------------- the words -------------------------------- */

/**
 * THE SENTENCE THE FACE REPLACED — one fact per line, the same register as My
 * Book's popover. Everything the face abbreviates is spelled out here, and
 * every number here is named, so the card can be all glyphs without any of
 * them being unexplained.
 */
function words(item: FeedItem, tailOf: FeedItem | undefined, tailedBy: number): string[] {
  const who = item.display_name || item.handle;
  const league = leagueLabel(item.sport);
  const out: string[] = [];

  if (item.kind === "score") {
    const p: FeedScorePayload = item.payload ?? {};
    const s = p.score ?? {};
    const home = s.home_team ?? item.home_team ?? "home";
    const away = s.away_team ?? item.away_team ?? "away";
    const when = [p.period ? `Q${p.period}` : null, p.clock || null]
      .filter(Boolean).join(" ");
    out.push(`${away} ${s.away ?? "–"} – ${home} ${s.home ?? "–"}${when ? `, ${when}` : ""}.`);
    if (typeof p.prob_after === "number") {
      out.push(`${p.side ? `${who}'s ${p.side}` : `${who}'s bet`}`
        + ` is now ${Math.round(p.prob_after * 100)}%`
        + (typeof p.prob_before === "number"
            ? ` (was ${Math.round(p.prob_before * 100)}%).` : "."));
    }
    const u = unitsText(typeof p.units === "number" ? p.units : null);
    if (u) out.push(`${u} at risk, in ${who}'s own unit.`);
    const tail = [league, ago(item.at)].filter(Boolean).join(" · ");
    if (tail) out.push(tail);
    return out;
  }

  const u = unitsText(item.units);
  const at = item.price != null ? ` at ${Math.round(item.price * 100)}¢` : "";
  if (item.tailed_from) {
    const parent = tailOf ? (tailOf.display_name || tailOf.handle) : "a bet";
    out.push(`${who} tailed ${parent}${u ? ` for ${u}` : ""} on ${betText(item)}${at}.`);
  } else {
    out.push(`${who} ${verb(item)}${u ? ` ${u}` : ""} on ${betText(item)}${at}.`);
  }
  if (item.home_team && item.away_team) {
    out.push(`${item.away_team} at ${item.home_team}.`);
  }
  if (item.ev_fee != null && Number.isFinite(item.ev_fee)) {
    out.push(`Sim EV ${item.ev_fee >= 0 ? "+" : "−"}${Math.abs(item.ev_fee).toFixed(2)}`
      + " per $1 staked, after the fee"
      + (item.sim_p != null && Number.isFinite(item.sim_p)
          ? `; the sim gives it ${Math.round(item.sim_p * 100)}%.` : "."));
  } else if (item.sim_p != null && Number.isFinite(item.sim_p)) {
    out.push(`The sim gives it ${Math.round(item.sim_p * 100)}%.`);
  }
  if (item.result) {
    const net = item.units_net != null && Number.isFinite(item.units_net)
      ? item.units_net : null;
    const word = item.result === "won" ? "Won"
      : item.result === "lost" ? "Lost" : "Push";
    out.push(net != null
      ? `${word}: ${net > 0 ? "+" : net < 0 ? "−" : "±"}`
        + `${Math.abs(net).toFixed(2)} units, net of fees.`
      : `${word}.`);
  }
  if (tailedBy > 0) out.push(`Tailed by ${tailedBy} of the people you can see.`);
  if (item.note) out.push(`“${item.note}”`);
  const tail = [league, ago(item.at)].filter(Boolean).join(" · ");
  if (tail) out.push(tail);
  return out;
}

/* ------------------------------- formatting -------------------------------- */

/** A size in units, in the words people use: "1.5 units", "0.5 units", and
 *  "1 unit" when it is exactly one. Null renders as nothing at all — never as
 *  a guessed unit. This is the POPOVER's spelling; the face uses
 *  `unitsShort`. */
function unitsText(u: number | null): string | null {
  if (u == null || !Number.isFinite(u) || u <= 0) return null;
  const r = Math.round(u * 100) / 100;
  const n = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
  return `${n} unit${r === 1 ? "" : "s"}`;
}

/** The same number for the FACE: "1.5u", "0.16u", "1u". */
function unitsShort(u: number | null): string | null {
  if (u == null || !Number.isFinite(u) || u <= 0) return null;
  const r = Math.round(u * 100) / 100;
  return `${r.toFixed(2).replace(/\.?0+$/, "")}u`;
}

/** THE BET IN WORDS. The confirmed title when the row carries one; a posted
 *  pick spells out side + line; otherwise the exchange's own string, which is
 *  ugly but true. The POPOVER's version — full, unabbreviated. */
function betText(item: FeedItem): string {
  if (item.title) return item.title;
  if (item.kind === "order") return item.ticker || item.side;
  const line = item.line == null ? "" : ` ${item.line > 0 ? "+" : ""}${item.line}`;
  return `${item.side}${line}`;
}

/**
 * THE BET AS A GLYPH STRING, for the face: "Rutgers over 23.5 points" becomes
 * "Rutgers o23.5", "Memphis -20.5" becomes "Memphis −20.5", a moneyline
 * becomes ML.
 *
 * Purely a RE-SPELLING of the row's own confirmed title — no fact is added,
 * dropped or rounded, and the untouched sentence is one tap away — so a title
 * this does not recognise passes through exactly as written rather than being
 * mangled into a shape it does not have.
 */
function compactBet(item: FeedItem): string {
  return betText(item)
    .replace(/\s+/g, " ")
    .replace(/\bover\s+/gi, "o")
    .replace(/\bunder\s+/gi, "u")
    .replace(/\s*\bpoints?\b/gi, "")
    .replace(/\bmoneyline\b/gi, "ML")
    .replace(/\bto win\b/gi, "ML")
    .replace(/(^|\s)-(?=\d)/g, "$1−")
    .trim();
}

/** A team in a few characters, beside its own logo and under its own tooltip:
 *  initials for a multi-word school, the first three letters for a one-word
 *  one. A DISPLAY abbreviation, never an identity — the logo carries that and
 *  the popover spells the name out. */
function shortTeam(name: string | null | undefined): string {
  const n = String(name ?? "").trim();
  if (!n) return "";
  const w = n.split(/\s+/).filter((x) => !/^(of|the|at|and|&)$/i.test(x));
  if (w.length >= 2) return w.map((x) => x[0]).join("").toUpperCase().slice(0, 4);
  return n.slice(0, 3).toUpperCase();
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
 *  other faded. A row with no matchup shows a fixed-width blank so every bet
 *  still starts on the same column. */
function MatchupLogos({ home, away, on }: {
  home: string | null; away: string | null; on: "home" | "away" | null;
}) {
  const size = 16;
  const pair: { name: string; src: string | undefined; which: "home" | "away" }[] = [
    { name: away ?? "", src: getTeamLogo(away), which: "away" },
    { name: home ?? "", src: getTeamLogo(home), which: "home" },
  ].filter((x) => x.src) as any;
  if (!pair.length) {
    return <span aria-hidden style={{ width: size * 2 + 2, flex: "none" }} />;
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 2, flex: "none",
      width: size * 2 + 2, justifyContent: "flex-start",
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

/** "now" / "4m" / "3h" / "2d" — the clock is a corner mark on a card, not a
 *  phrase, so it is spelled the way a corner mark is. The popover repeats it
 *  unchanged; it just has the room. */
function ago(at: string): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
