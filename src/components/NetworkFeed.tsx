// src/components/NetworkFeed.tsx
//
// "WHAT YOUR FRIENDS ARE ON" — the feed, and since 2026-09-09 it is
// AUTOMATIC. There is no "post a pick" form any more and nothing here writes
// to the database at all. Every order placed through the app is already
// mirrored into `app_orders` server-side; that row IS the feed item, so a bet
// reaches your friends by being placed, not by being typed twice.
//
// ────────────────────────────────────────────────────────────────────────────
// THE UNIT OF THE FEED IS THE GAME (owner 2026-09-09, ~12:55 AM)
//
// It used to be a chronological list of rows under day headings. Nobody
// watching football asks "what happened next"; they ask "who is on this game".
// So the feed is a list of GAME BUCKETS, ordered by the time of the latest
// action in each — a new bet on an old game bumps that game back to the top —
// and each bucket answers both questions at once:
//
//   ▎🏈 [logo][logo] Rutgers at Ohio State                    TAIL · 2m
//     ▎roth ᵃ   🏈 [logos] ↳ mvpeav  Rutgers o23.5 · 61¢ · 1u   TAIL 2m
//     ── who's on it ─────────────────────────────────────────────────
//     mvpeav ᵃᵇ  Rutgers o23.5    2.5u @ 39¢ avg  ↳1   4m   [Tail]
//     roth       Rutgers o23.5    1u   @ 61¢          2m
//     Show all 6
//
// THE HEADER SAYS WHAT JUST HAPPENED — the kind rail and the kind tag are the
// LATEST action's, not the bucket's — and the latest action is then repeated
// underneath as its own full glanceable row, in the row style shipped
// tonight. Everything else in the bucket is one press away ("Show all"), in
// the same rows, chronologically.
//
// A POSITION, NOT A FILL. The summary folds a poster's rows on one contract
// into one line: total units, and the UNITS-WEIGHTED AVERAGE PRICE across them
// (owner: "when there are multiple at different prices show the average"). A
// ladder placed as two rungs, a partial fill chased at the next price and a
// re-offer taken a cent higher are one bet in a bettor's head; the fold is in
// src/lib/feedBuckets.ts, shared with the scoreboard's "friends on this game"
// strip so the two surfaces can never tell different stories.
//
// ────────────────────────────────────────────────────────────────────────────
// THE FACE OF A ROW IS GLYPHS AND NUMBERS. THE SENTENCE IS ON TAP.
// (owner 2026-09-09, the "drunk at a bar" rule + the Team Stats v3 house style)
//
//   ▎mvpeav ᵃᵇ   🏈 [logo][logo] Rutgers o23.5 · 59¢ · 1.5u · EV +0.21  PLACED 4m
//
// FOUR RULES HOLD THE ROW TOGETHER:
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
// THE ARROWS ARE READ AT ARM'S LENGTH (owner 2026-09-09). ↳ and ↑ ↓ → carry
// the two facts a glance is FOR — this is a copy of someone's bet, this bet
// just got better or worse — and at row size they were decoration. They are
// 1.35× the row's font, heavy, coloured (tail = --accent, a move = --pos /
// --neg / --muted), and each one carries its own one-line tooltip, because a
// glyph that means something must be able to say what.
//
// HANDLES ARE BARE (owner 2026-09-09). No "@" anywhere on this surface: the
// handle is the person's name here, not a mention, and the sigil was one more
// mark to read on every single line.
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
// The tail link and the "tailed by N" count are resolved INSIDE the rows this
// viewer already has: `tailed_from` is an order id and the parent, if the
// viewer may see it at all, is in the same RLS-filtered result set. A parent
// that is not there is not fetched behind the user's back — the row simply
// says it tailed a bet and names nobody.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import Flares from "./Flares";
import TailButton from "./TailButton";
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
// The grouping, the fold and the formatting — shared with the game card's
// "friends on this game" strip (src/lib/feedBuckets.ts).
import {
  ago, betText, bucketize, compactBet, matchupWords, orderSide, shortTeam,
  unitsShort, unitsText,
  type FeedBucket, type FeedPosition,
} from "../lib/feedBuckets";

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

/** Buckets before the "older" divider, and how many more each press adds.
 *  Ten games is a slate's worth of what is happening now; everything past it
 *  is history and says so. */
const FIRST_BUCKETS = 10;

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
  /** Which buckets are showing their whole history. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** How many buckets are rendered at all. */
  const [shown, setShown] = useState(FIRST_BUCKETS);

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
   * doorbells into the same refetch, and any of them can re-sort the buckets:
   * a new action on an old game pulls that game to the top by itself, because
   * the order is a function of the rows and not of a list this file keeps.
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

  /** ONE GAME PER BUCKET, latest action first (src/lib/feedBuckets.ts). */
  const buckets = useMemo(
    () => bucketize(items, tailCounts), [items, tailCounts]);

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

  const visible = buckets.slice(0, shown);

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
            : `${betCount} bet${betCount === 1 ? "" : "s"} on `
              + `${buckets.length} game${buckets.length === 1 ? "" : "s"}`}
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

      {open && visible.map((b, i) => (
        <Fragment key={b.key}>
          {/* THE ONLY DIVIDER LEFT. Day headings are gone — every bucket wears
              its own clock — but "this is where now stops" is still worth
              one line. */}
          {i === FIRST_BUCKETS && (
            <div style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4,
              textTransform: "uppercase", color: "var(--muted)",
              borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 2,
            }}>
              Older
            </div>
          )}
          <Bucket
            bucket={b}
            byOrderId={byOrderId}
            tailCounts={tailCounts}
            expanded={expanded.has(b.key)}
            onToggleExpand={() => setExpanded((s) => {
              const next = new Set(s);
              if (next.has(b.key)) next.delete(b.key); else next.add(b.key);
              return next;
            })}
            pop={pop}
            onPop={(k) => setPop((p) => (p === k ? null : k))}
          />
        </Fragment>
      ))}

      {open && shown < buckets.length && (
        <button type="button" className="ui-btn"
                onClick={() => setShown((n) => n + FIRST_BUCKETS)}
                style={{ padding: "4px 12px", fontSize: 11, justifySelf: "start" }}>
          Load more ({buckets.length - shown} more game
          {buckets.length - shown === 1 ? "" : "s"})
        </button>
      )}
    </div>
  );
}

/* -------------------------------- a bucket -------------------------------- */

/**
 * ONE GAME. Header (what just happened), the latest score line when there is
 * one, the latest action as a full row, who is on it, and the whole history on
 * demand.
 */
function Bucket({
  bucket, byOrderId, tailCounts, expanded, onToggleExpand, pop, onPop,
}: {
  bucket: FeedBucket;
  byOrderId: Map<string, FeedItem>;
  tailCounts: Map<string, number>;
  expanded: boolean;
  onToggleExpand: () => void;
  pop: string | null;
  onPop: (key: string) => void;
}) {
  const k = kindOf(bucket.latest);
  const rowsShown = expanded ? bucket.items : [bucket.latest];
  // The score belongs in the header — UNLESS the score IS the latest action,
  // in which case it is already about to be rendered as its own row.
  const headScore = bucket.score && bucket.score !== bucket.latest
    ? bucket.score : null;

  return (
    <section className="bkt">
      <header className="bkt__head">
        <span aria-hidden className="bkt__rail" style={{ background: k.tone }} />
        <span className="bkt__title">
          <SportChip sport={bucket.sport} />
          <MatchupLogos home={bucket.home} away={bucket.away} on={null} />
          <span className="bkt__words">{matchupWords(bucket)}</span>
        </span>
        <span className="bkt__when">
          {/* THE NEWEST THING, AT A GLANCE: the tag and the rail above are the
              LATEST action's kind, not a summary of the bucket. */}
          <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.5, color: k.tone }}>
            {k.tag}
          </span>
          <span style={{ fontSize: 9.5, color: "var(--muted)" }}>{ago(bucket.atMs)}</span>
        </span>
      </header>

      {headScore && <ScoreStrip item={headScore} />}

      {rowsShown.map((it, i) => {
        const key = `${it.kind}:${it.id}`;
        return (
          <FeedRow
            key={key} item={it} rowKey={key}
            tailOf={it.tailed_from ? byOrderId.get(it.tailed_from) : undefined}
            tailedBy={it.order_id ? (tailCounts.get(it.order_id) ?? 0) : 0}
            // A THREAD, not a repetition: the same person twice in a row
            // inside one bucket keeps the overhang blank.
            threaded={i > 0 && rowsShown[i - 1].user_id === it.user_id}
            open={pop === key}
            onToggle={() => onPop(key)}
          />
        );
      })}

      {bucket.positions.length > 0 && (
        <div className="bkt__who">
          <div className="bkt__whoLabel">who's on it</div>
          {bucket.positions.map((p) => (
            <PositionLine key={p.key} pos={p} />
          ))}
        </div>
      )}

      {bucket.items.length > 1 && (
        <button type="button" className="bkt__more" onClick={onToggleExpand}
                aria-expanded={expanded}>
          {expanded
            ? "Show less"
            : `Show all ${bucket.items.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * ONE LINE PER (POSTER, POSITION) — the answer to "who is on this game".
 *
 * The price is the UNITS-WEIGHTED AVERAGE across every fill of that position,
 * and it says "avg" whenever there is more than one, because an average price
 * and a price paid are different claims and the reader must not have to guess
 * which one is on screen.
 */
function PositionLine({ pos }: { pos: FeedPosition }) {
  const u = unitsShort(pos.units);
  const settled = pos.net != null;
  return (
    <div className="bkt__pos">
      <span className="bkt__posWho" title={pos.display_name || pos.handle}>
        {pos.handle}
        <Flares flares={pos.flares} raised />
      </span>
      <span className="bkt__posBet">{pos.label}</span>
      {pos.avgPrice != null && (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}
              title={pos.fills > 1
                ? `${pos.fills} fills, averaged by units`
                : "the price paid"}>
          {Math.round(pos.avgPrice * 100)}¢{pos.fills > 1 ? " avg" : ""}
        </span>
      )}
      {u && <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{u}</span>}
      {pos.tails > 0 && (
        <span style={{ whiteSpace: "nowrap" }}>
          <Arrow glyph="↳" tone="var(--accent)"
                 label={`Tailed by ${pos.tails} of the people you can see`} />
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--accent)" }}>
            {pos.tails}
          </span>
        </span>
      )}
      <span style={{ fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap" }}
            title="last update on this position">
        {ago(pos.lastMs)}
      </span>
      {/* THE ANSWER, once there is one. Same rule as a settled row: when a bet
          is done, the units are the loudest thing on its line. */}
      {settled && (
        <span style={{
          fontWeight: 900, fontSize: 13, whiteSpace: "nowrap",
          color: pos.net! > 0 ? "var(--pos)" : pos.net! < 0 ? "var(--neg)" : "var(--muted)",
        }} title={pos.settledFills < pos.fills
          ? `${pos.settledFills} of ${pos.fills} fills settled so far`
          : "settled, net of fees, in their own units"}>
          {pos.net! > 0 ? "+" : pos.net! < 0 ? "−" : "±"}{Math.abs(pos.net!).toFixed(2)}u
        </span>
      )}
      <span className="bkt__posAct">
        <TailButton
          compact
          target={{
            ticker: pos.ticker, side: pos.side, orderId: pos.orderId,
            userId: pos.user_id, units: pos.units,
            title: pos.title, home_team: pos.home_team,
            away_team: pos.away_team, sport: pos.sport,
          }}
        />
      </span>
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
  /** Previous row in this bucket is the same poster — blank the overhang. */
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
            <span className="feed__handle" title={item.display_name || item.handle}>
              {item.handle}
              <Flares flares={item.flares} raised />
            </span>
          )}
          {/* WHO FOLLOWED THIS ONE, counted over rows this viewer can already
              see, so it can never announce a bet they may not. Gold, on the
              rail side, because a tail is the gold channel. */}
          {tailedBy > 0 && (
            <span style={{ whiteSpace: "nowrap" }}>
              <Arrow glyph="↳" tone="var(--accent)"
                     label={`Tailed by ${tailedBy} of the people you can see`} />
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--accent)" }}>
                {tailedBy}
              </span>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            {/* THE ACTION, where the words are: a reader who opened a row to
                understand it is exactly the reader deciding whether to copy
                it. Muted with its reason when the sim says no. */}
            {item.kind !== "score" && (
              <TailButton
                target={{
                  ticker: item.ticker, side: orderSide(item),
                  orderId: item.order_id, userId: item.user_id,
                  units: item.units, title: item.title,
                  home_team: item.home_team, away_team: item.away_team,
                  sport: item.sport,
                }}
              />
            )}
            <button type="button" className="ui-btn" onClick={onToggle}
                    style={{ padding: "2px 9px", fontSize: 10.5 }}>
              Close
            </button>
          </div>
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
          viewer. The arrow is the whole verb, so it is drawn like one. */}
      {item.tailed_from && (
        <span style={{ whiteSpace: "nowrap" }}>
          <Arrow glyph="↳" tone="var(--accent)"
                 label={tailOf
                   ? `A copy of ${tailOf.display_name || tailOf.handle}'s bet`
                   : "A copy of a bet you cannot see"} />
          <span style={{ color: "var(--muted)" }}>
            {tailOf ? tailOf.handle : "a bet"}
          </span>
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
      <ProbMove before={before} after={after} side={p.side ?? null} />
      {u && (
        <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{u}</span>
      )}
      <RightEdge item={item} tone="var(--info)" />
    </span>
  );
}

/** The bucket header's score line — the same face, without the row chrome, so
 *  a reader sees the state of the game before reading who is on it. */
function ScoreStrip({ item }: { item: FeedItem }) {
  const p: FeedScorePayload = item.payload ?? {};
  const s = p.score ?? {};
  const when = [p.period ? `Q${p.period}` : null, p.clock || null]
    .filter(Boolean).join(" ");
  return (
    <div className="bkt__score">
      <span style={{ fontWeight: 800 }}>
        <span style={{ color: "var(--muted)" }}>{shortTeam(s.away_team ?? item.away_team)}</span>{" "}
        {s.away ?? "–"} – {s.home ?? "–"}{" "}
        <span style={{ color: "var(--muted)" }}>{shortTeam(s.home_team ?? item.home_team)}</span>
      </span>
      {when && <span style={{ color: "var(--muted)" }}>{when}</span>}
      <ProbMove
        before={typeof p.prob_before === "number" ? p.prob_before : null}
        after={typeof p.prob_after === "number" ? p.prob_after : null}
        side={p.side ?? null}
      />
      <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--muted)" }}>
        {ago(item.at)}
      </span>
    </div>
  );
}

/**
 * WHICH WAY A BET JUST MOVED. The arrow is the fact — up, down, or nowhere —
 * so it is drawn at 1.35× the row and carries the whole sentence in its
 * tooltip. Colour follows the poster's interest, never the home team's.
 */
function ProbMove({ before, after, side }: {
  before: number | null; after: number | null; side: string | null;
}) {
  if (after === null) return null;
  const moved = before === null ? null : after - before;
  const up = moved !== null && moved > 0.005;
  const down = moved !== null && moved < -0.005;
  const tone = up ? "var(--pos)" : down ? "var(--neg)" : "var(--muted)";
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const what = side ? `"${side}"` : "this bet";
  const label = moved === null
    ? `${what} is ${pct(after)} right now`
    : up
      ? `${what} got better: ${pct(before!)} → ${pct(after)}`
      : down
        ? `${what} got worse: ${pct(before!)} → ${pct(after)}`
        : `${what} is unchanged at ${pct(after)}`;
  return (
    <span style={{ whiteSpace: "nowrap" }} title={label}>
      {before !== null && (
        <span style={{ color: "var(--muted)" }}>{pct(before)} </span>
      )}
      <Arrow glyph={up ? "↑" : down ? "↓" : "→"} tone={tone} label={label} />
      <span style={{ color: tone, fontWeight: 900 }}>{pct(after)}</span>
    </span>
  );
}

/**
 * AN ARROW THAT CAN BE READ ACROSS A BAR (owner 2026-09-09).
 *
 * 1.35× the row's 11.5px font, heavy, coloured by its meaning, and never
 * silent: the same sentence is its tooltip and its accessible label, because a
 * glyph carrying a fact has to be able to say the fact. Sized in px rather
 * than em on purpose — these sit inside spans as small as 9.5px, and the point
 * is that the arrow is bigger than its surroundings, not proportional to them.
 */
function Arrow({ glyph, tone, label }: {
  glyph: string; tone: string; label: string;
}) {
  return (
    <span role="img" aria-label={label} title={label}
          style={{
            fontSize: 15.5, fontWeight: 900, color: tone, lineHeight: 1,
            verticalAlign: "-0.09em", padding: "0 1px",
          }}>
      {glyph}
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
