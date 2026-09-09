// src/components/NetworkFeed.tsx
//
// "WHAT YOUR FRIENDS ARE ON" — the feed. AUTOMATIC since 2026-09-09: every
// order placed through the app is mirrored into `app_orders` server-side and
// that row IS the feed item. Nothing here writes to the database.
//
// ────────────────────────────────────────────────────────────────────────────
// ONE GAME, ONE CARD. INSIDE IT, ONE BUCKET PER FRIEND. (owner 2026-09-09 pm)
//
// The first cut of the game-bucket feed showed every bet three times — in the
// card header (rail + PLACED tag), again as a full "latest action" row (logos,
// kind tag, clock), and a third time in a "who's on it" band — and the owner
// called it "cluttered, confusing and hard to follow", and asked for "buckets
// for each friend" rather than lines. This is the second cut. Its rules:
//
//   ┌ [R][BC]  Rutgers at Boston College                    placed · 3h ┐
//   │          FBS Football                                             │
//   ├───────────────────────────────────────────────────────────────────┤
//   │ mvpeav ᴬ                                                2 bets    │
//   │   Rutgers 2+ rec TDs            1.22u at 53¢ · EV +0.35   [Tail]  │
//   │   Rutgers 24+                   0.5u at 60¢ avg · 3 fills [Tail]  │
//   ├───────────────────────────────────────────────────────────────────┤
//   │ roth ᶜ                                                  −0.08u    │
//   │   Florida State −5.5            0.08u at 29¢ · lost      −0.08u   │
//   ├───────────────────────────────────────────────────────────────────┤
//   │ 3 actions ▾                                                       │
//   └───────────────────────────────────────────────────────────────────┘
//
//   • EVERY FACT APPEARS ONCE. The header carries the matchup, the game's
//     state (score + clock when a score update exists, else the league) and
//     ONE clock — the latest action, with its kind as a word. The card's left
//     edge is tinted by that kind only when the kind is news (a tail, a
//     settlement, a score), so a wall of plain placements reads as a list.
//   • THE BODY IS FRIEND BUCKETS: one block per poster, newest activity first,
//     with the handle and flares as the block's header and a summary at its
//     right edge (how many bets, or the net units once something settled).
//     Inside, one line per POSITION (src/lib/feedBuckets.ts, shared with the
//     game card's "friends on this game" strip): the bet, then size at the
//     units-weighted average price, then the one thing to do or know at the
//     right — Tail while it is open, the net units once it has settled.
//   • The tail relation is WORDS ("tail of mvpeav", "2 tails"), not arrows;
//     the sport is a word in the header, not an emoji on every row.
//   • THE SENTENCE IS ON TAP: pressing a bet opens its fills, one plain line
//     each, with the Tail button and the reason it is muted spelled out. That
//     reason lives in the button's tooltip and here — never printed beside
//     every button on the page.
//   • History is a sentence list behind "N actions", newest first.
//
// THE FILTERING IS THE DATABASE'S JOB. `feed_items` is a security_invoker view
// over RLS-protected tables, so what comes back is exactly what this viewer may
// see; there is no client-side "is this mine / are we friends" test here. AND
// THERE ARE NO DOLLARS: the view carries UNITS of the poster's own unit and the
// market price, for every row including the viewer's own (owner rule
// 2026-09-08). The tail link and the "tailed by N" count are resolved INSIDE
// the rows this viewer already has — a parent that is not there is not fetched
// behind the user's back.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import Flares from "./Flares";
import TailButton from "./TailButton";
import {
  supabase, supabaseEnabled, useProfile, useSession,
  type FeedItem, type FeedScorePayload,
} from "../lib/supabase";
import { getTeamLogo } from "../utils/teamLogo";
import { leagueLabel } from "../lib/leagues";
import {
  ago, betText, bucketize, matchupWords, shortTeam, unitsShort, unitsText,
  type FeedBucket, type FeedPosition,
} from "../lib/feedBuckets";

export type NetworkFeedProps = {
  /** Calendar season, for the single-week view. */
  season: number;
  /** Week number, for the single-week view. */
  week: number;
  /** EVERY week, newest first (the feed page reads the feed as a timeline).
   *  Without it the feed is scoped to `season`/`week` plus rows nobody could
   *  date, so an order never silently vanishes. */
  allWeeks?: boolean;
  /** Start expanded. When true there is no Show/Hide toggle at all — the feed
   *  IS the page, and a button to hide the page is a button for nothing. */
  startOpen?: boolean;
};

/** How often the feed re-reads itself when the live channel is NOT up. */
const POLL_MS = 60_000;

/** Cards before the "older" divider, and how many more each press adds. */
const FIRST_BUCKETS = 10;

export default function NetworkFeed({
  season, week, allWeeks = false, startOpen = true,
}: NetworkFeedProps) {
  const { session, loading } = useSession();
  const { profile } = useProfile(session);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [live, setLive] = useState(false);
  /** Re-render once a minute so "4m" is not a lie by the fifth. */
  const [, setTick] = useState(0);
  /** Which position has its details open — ONE at a time. */
  const [pop, setPop] = useState<string | null>(null);
  /** Which cards are showing their history. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
   * LIVE. RLS applies to realtime, and the event is a DOORBELL, not the data:
   * every event triggers a refetch of `feed_items`; nothing renders from the
   * payload (a raw `app_orders` row carries cost and count and has not been
   * through the view that strips them). Three subscriptions: a bet PLACED
   * (insert), a bet SETTLED (update), a game MOVED (feed_events insert).
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

  /** The fallback, and the clock. */
  useEffect(() => {
    if (!signedIn) return;
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [signedIn, load]);

  /** THE TAIL GRAPH, built from what is already loaded — scoped to the visible
   *  rows so a count can never announce a bet the viewer may not see. */
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

  /** ONE GAME PER CARD, latest action first (src/lib/feedBuckets.ts). */
  const buckets = useMemo(
    () => bucketize(items, tailCounts), [items, tailCounts]);

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
  const left = buckets.length - shown;

  return (
    <div className="fd">
      <div className="fd__meta">
        {!startOpen && (
          <button type="button" className="ui-btn" onClick={() => setOpen((v) => !v)}
                  style={{ padding: "3px 10px", fontSize: 11 }}>
            {open ? "Hide" : "Show"} feed
          </button>
        )}
        <span>
          {betCount === 0
            ? "Nothing yet"
            : `${betCount} bet${betCount === 1 ? "" : "s"} on `
              + `${buckets.length} game${buckets.length === 1 ? "" : "s"}`}
        </span>
        <span className="fd__dot" aria-hidden>·</span>
        <span title={live
          ? "New bets appear as they are placed."
          : "The live channel is down; the feed re-reads itself every minute."}>
          {live ? "live" : "refreshes every minute"}
        </span>
      </div>

      {err && <span style={{ fontSize: 12, color: "var(--neg)" }}>{err}</span>}

      {open && items.length === 0 && (
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          No bets from your friends yet — add friends by username on your profile.
        </span>
      )}

      {open && visible.map((b, i) => (
        <Fragment key={b.key}>
          {i === FIRST_BUCKETS && <div className="fd__older">Older</div>}
          <GameCard
            bucket={b}
            byOrderId={byOrderId}
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

      {open && left > 0 && (
        <button type="button" className="ui-btn"
                onClick={() => setShown((n) => n + FIRST_BUCKETS)}
                style={{ padding: "5px 14px", fontSize: 12, justifySelf: "start" }}>
          Show {Math.min(FIRST_BUCKETS, left)} more game
          {Math.min(FIRST_BUCKETS, left) === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

/* --------------------------------- a card --------------------------------- */

/** One poster's bucket inside a game card: their positions, newest first. */
type FriendBlock = {
  user_id: string;
  handle: string;
  display_name: string;
  flares: string[] | null;
  positions: FeedPosition[];
  /** Newest activity in the block — the sort key between blocks. */
  lastMs: number;
  /** Summed over the settled positions; null while none has settled. */
  net: number | null;
};

/** Positions arrive newest first, so the first block seen is the freshest. */
function friendBlocks(positions: FeedPosition[]): FriendBlock[] {
  const by = new Map<string, FriendBlock>();
  for (const p of positions) {
    let b = by.get(p.user_id);
    if (!b) {
      b = {
        user_id: p.user_id, handle: p.handle, display_name: p.display_name,
        flares: p.flares, positions: [], lastMs: p.lastMs, net: null,
      };
      by.set(p.user_id, b);
    }
    b.positions.push(p);
    b.lastMs = Math.max(b.lastMs, p.lastMs);
    if (p.net != null) b.net = (b.net ?? 0) + p.net;
  }
  return [...by.values()].sort((a, b) => b.lastMs - a.lastMs);
}

function GameCard({
  bucket, byOrderId, expanded, onToggleExpand, pop, onPop,
}: {
  bucket: FeedBucket;
  byOrderId: Map<string, FeedItem>;
  expanded: boolean;
  onToggleExpand: () => void;
  pop: string | null;
  onPop: (key: string) => void;
}) {
  const k = kindOf(bucket.latest);
  const league = leagueLabel(bucket.sport);
  const actions = bucket.items.length;
  const blocks = friendBlocks(bucket.positions);

  return (
    <section className="fdc" style={{ borderLeftColor: k.rail ?? "var(--border)" }}>
      <header className="fdc__head">
        <MatchupLogos home={bucket.home} away={bucket.away} size={22} />
        <div className="fdc__title">
          <div className="fdc__game">{matchupWords(bucket)}</div>
          <div className="fdc__state">
            {bucket.score
              ? <ScoreLine item={bucket.score} />
              : <span>{league ?? " "}</span>}
          </div>
        </div>
        <div className="fdc__latest" title={sentenceOf(bucket.latest, byOrderId)}>
          <span style={{ color: k.tone, fontWeight: 800 }}>{k.word}</span>
          <span className="fd__dot" aria-hidden>·</span>
          <span>{ago(bucket.atMs)}</span>
        </div>
      </header>

      {blocks.map((b) => (
        <FriendBucket key={b.user_id} block={b} byOrderId={byOrderId}
                      pop={pop} onPop={onPop} />
      ))}

      {actions > 1 && (
        <>
          <button type="button" className="fdc__more" onClick={onToggleExpand}
                  aria-expanded={expanded}>
            {expanded ? "Hide history" : `${actions} actions`}
            <span aria-hidden style={{ marginLeft: 5, opacity: 0.7 }}>
              {expanded ? "▴" : "▾"}
            </span>
          </button>
          {expanded && (
            <ol className="fdc__hist">
              {bucket.items.map((it) => {
                const kk = kindOf(it);
                return (
                  <li key={`${it.kind}:${it.id}`}>
                    <span className="fdc__histDot" style={{ background: kk.tone }} aria-hidden />
                    <span className="fdc__histWhen">{ago(it.at)}</span>
                    <span>{sentenceOf(it, byOrderId)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

/* ----------------------------- a friend bucket ---------------------------- */

/**
 * ONE FRIEND ON ONE GAME. The handle and flares head the block; the right edge
 * of that header is the block's summary — the net units once anything has
 * settled, else how many bets are in it. Underneath, one line per position.
 */
function FriendBucket({ block, byOrderId, pop, onPop }: {
  block: FriendBlock;
  byOrderId: Map<string, FeedItem>;
  pop: string | null;
  onPop: (key: string) => void;
}) {
  const n = block.positions.length;
  const settledAll = block.positions.every((p) => p.net != null);
  // ONE BET NEEDS NO SUMMARY: the row underneath already carries its number,
  // and printing it twice was the first cut's mistake.
  const summary = n === 1 ? null : block.net != null
    ? (
      <span className="fdf__net" style={{ color: toneOf(block.net) }}
            title={settledAll
              ? "Net units across this friend's settled bets on this game"
              : "Net units so far — some of their bets are still open"}>
        {sign(block.net)}{Math.abs(block.net).toFixed(2)}u{settledAll ? "" : " so far"}
      </span>
    )
    : <span className="fdf__count">{n} bet{n === 1 ? "" : "s"}</span>;

  return (
    <div className="fdf">
      <div className="fdf__head">
        <span className="fdf__handle" title={block.display_name || block.handle}>
          {block.handle}
        </span>
        {/* Flares at rest here, not raised: a bucket header has the room, and
            three superscript logos jammed against the handle read as noise. */}
        <Flares flares={block.flares} size={14} />
        {summary}
      </div>
      {block.positions.map((p) => (
        <PositionRow key={p.key} pos={p} byOrderId={byOrderId}
                     open={pop === p.key} onToggle={() => onPop(p.key)} />
      ))}
    </div>
  );
}

/* ------------------------------- a position ------------------------------- */

/**
 * ONE BET. The label on the first line with its tail words; the size at the
 * average price, the fill count and the sim's EV on the second; and at the
 * right edge the one thing to do or know: Tail while open, net units once
 * settled. The whole left side is a button — the sentence is on tap.
 */
function PositionRow({ pos, byOrderId, open, onToggle }: {
  pos: FeedPosition;
  byOrderId: Map<string, FeedItem>;
  open: boolean;
  onToggle: () => void;
}) {
  const settled = pos.net != null;
  const partly = settled && pos.settledFills < pos.fills;
  const latest = pos.items[0];
  const tailOf = latest?.tailed_from ? byOrderId.get(latest.tailed_from) : undefined;
  const isTail = Boolean(latest?.tailed_from);
  const u = unitsShort(pos.units);
  const price = pos.avgPrice != null ? `${Math.round(pos.avgPrice * 100)}¢` : null;
  const resultWord = settled
    ? (pos.net! > 0 ? "won" : pos.net! < 0 ? "lost" : "push") : null;

  const meta: string[] = [];
  const avg = pos.fills > 1 ? " avg" : "";
  if (u && price) meta.push(`${u} at ${price}${avg}`);
  else if (u) meta.push(u);
  else if (price) meta.push(`at ${price}${avg}`);
  if (pos.fills > 1) meta.push(`${pos.fills} fills`);
  if (resultWord) meta.push(partly ? `${resultWord} so far` : resultWord);

  return (
    <div className={`fdp${open ? " fdp--open" : ""}`}>
      <button type="button" className="fdp__main" onClick={onToggle}
              aria-expanded={open} title="Tap for the details">
        <span className="fdp__bet">
          <span>{pos.label}</span>
          {isTail && (
            <span className="fdp__chip"
                  title={tailOf
                    ? `A copy of ${tailOf.display_name || tailOf.handle}'s bet`
                    : "A copy of a bet you cannot see"}>
              tail of {tailOf ? tailOf.handle : "a friend"}
            </span>
          )}
          {pos.tails > 0 && (
            <span className="fdp__chip"
                  title={`Tailed by ${pos.tails} of the people you can see`}>
              {pos.tails} tail{pos.tails === 1 ? "" : "s"}
            </span>
          )}
        </span>
        <span className="fdp__meta">
          {meta.join(" · ")}
          {pos.ev != null && !settled && (
            <>
              {meta.length > 0 && " · "}
              <span style={{ color: toneOf(pos.ev), fontWeight: 700 }}
                    title="The sim's edge per $1 staked, after the fee, at the price paid">
                EV {sign(pos.ev)}{Math.abs(pos.ev).toFixed(2)}
              </span>
            </>
          )}
        </span>
      </button>

      <div className="fdp__edge">
        {settled ? (
          <span className="fdp__net" style={{ color: toneOf(pos.net!) }}
                title={partly
                  ? `${pos.settledFills} of ${pos.fills} fills settled so far`
                  : "Settled, net of fees, in their own units"}>
            {sign(pos.net!)}{Math.abs(pos.net!).toFixed(2)}u
          </span>
        ) : (
          <TailButton compact quiet target={tailTarget(pos)} />
        )}
      </div>

      {open && (
        <div className="fdp__pop" role="status">
          {pos.items.map((it) => (
            <div key={`${it.kind}:${it.id}`} className="fdp__fill">
              {words(it, it.tailed_from ? byOrderId.get(it.tailed_from) : undefined)
                .map((l, i) => <div key={i} className={i ? "fdp__popMuted" : undefined}>{l}</div>)}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {!settled && <TailButton target={tailTarget(pos)} />}
            <button type="button" className="ui-btn" onClick={onToggle}
                    style={{ padding: "2px 9px", fontSize: 11 }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const tailTarget = (pos: FeedPosition) => ({
  ticker: pos.ticker, side: pos.side, orderId: pos.orderId,
  userId: pos.user_id, units: pos.units,
  title: pos.title, home_team: pos.home_team,
  away_team: pos.away_team, sport: pos.sport,
});

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±");
const toneOf = (v: number) =>
  v > 0 ? "var(--pos)" : v < 0 ? "var(--neg)" : "var(--muted)";

/* ------------------------------- the score -------------------------------- */

/** The game's state, in the header: "SJS 24 – 21 EM · Q4 11:19", then which
 *  way the poster's bet moved, as a number in the colour of the move. */
function ScoreLine({ item }: { item: FeedItem }) {
  const p: FeedScorePayload = item.payload ?? {};
  const s = p.score ?? {};
  const when = [p.period ? `Q${p.period}` : null, p.clock || null]
    .filter(Boolean).join(" ");
  const before = typeof p.prob_before === "number" ? p.prob_before : null;
  const after = typeof p.prob_after === "number" ? p.prob_after : null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{ fontWeight: 800, color: "var(--text)" }}>
        {shortTeam(s.away_team ?? item.away_team)} {s.away ?? "–"} – {s.home ?? "–"} {shortTeam(s.home_team ?? item.home_team)}
      </span>
      {when && <span>{when}</span>}
      {after !== null && <ProbMove before={before} after={after} side={p.side ?? null} />}
    </span>
  );
}

function ProbMove({ before, after, side }: {
  before: number | null; after: number; side: string | null;
}) {
  const moved = before === null ? null : after - before;
  const up = moved !== null && moved > 0.005;
  const down = moved !== null && moved < -0.005;
  const tone = up ? "var(--pos)" : down ? "var(--neg)" : "var(--muted)";
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const what = side ? `"${side}"` : "the bet";
  const label = moved === null
    ? `${what} is ${pct(after)} right now`
    : up ? `${what} got better: ${pct(before!)} → ${pct(after)}`
    : down ? `${what} got worse: ${pct(before!)} → ${pct(after)}`
    : `${what} is unchanged at ${pct(after)}`;
  return (
    <span title={label} style={{ whiteSpace: "nowrap" }}>
      {before !== null && <span>{pct(before)} → </span>}
      <span style={{ color: tone, fontWeight: 800 }}>
        {pct(after)}{up ? " ▲" : down ? " ▼" : ""}
      </span>
    </span>
  );
}

/* ------------------------------- the kinds -------------------------------- */

type Kind = {
  /** One word for the header's latest-action line and the history dots. */
  word: string;
  /** The colour that word is drawn in. */
  tone: string;
  /** The card's edge tint — only when the kind is news. Null = plain border. */
  rail: string | null;
};

/** On a settlement the colour follows the MONEY (`units_net`), not the word. */
function kindOf(item: FeedItem): Kind {
  if (item.kind === "score") return { word: "score", tone: "var(--info)", rail: "var(--info)" };
  if (item.result) {
    const net = item.units_net != null && Number.isFinite(item.units_net)
      ? item.units_net : null;
    const tone = item.result === "push" || net === 0 || net == null
      ? "var(--muted)"
      : (net > 0 ? "var(--pos)" : "var(--neg)");
    return { word: item.result, tone, rail: tone };
  }
  if (item.tailed_from) return { word: "tailed", tone: "var(--accent)", rail: "var(--accent)" };
  return {
    word: item.source === "posted" ? "posted" : "placed",
    tone: "var(--brand-text)",
    rail: null,
  };
}

/* ------------------------------- the words -------------------------------- */

const verb = (item: FeedItem) =>
  item.tailed_from ? "tailed" : (item.source === "posted" ? "posted" : "placed");

/** One sentence for one action — the history list and the header tooltip. */
function sentenceOf(item: FeedItem, byOrderId: Map<string, FeedItem>): string {
  return words(item, item.tailed_from ? byOrderId.get(item.tailed_from) : undefined)[0] ?? "";
}

/**
 * THE SENTENCES — one fact per line, the same register as My Book's popover.
 * Everything the line abbreviates is spelled out here.
 */
function words(item: FeedItem, tailOf: FeedItem | undefined): string[] {
  const who = item.display_name || item.handle;
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
    return out;
  }

  const u = unitsText(item.units);
  const at = item.price != null ? ` at ${Math.round(item.price * 100)}¢` : "";
  if (item.tailed_from) {
    const parent = tailOf ? (tailOf.display_name || tailOf.handle) : "a friend";
    out.push(`${who} tailed ${parent}${u ? ` for ${u}` : ""} on ${betText(item)}${at}.`);
  } else {
    out.push(`${who} ${verb(item)}${u ? ` ${u}` : ""} on ${betText(item)}${at}.`);
  }
  if (item.ev_fee != null && Number.isFinite(item.ev_fee)) {
    out.push(`Sim EV ${sign(item.ev_fee)}${Math.abs(item.ev_fee).toFixed(2)}`
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
      ? `${word}: ${sign(net)}${Math.abs(net).toFixed(2)} units, net of fees.`
      : `${word}.`);
  }
  if (item.note) out.push(`“${item.note}”`);
  const tail = [leagueLabel(item.sport), ago(item.at)].filter(Boolean).join(" · ");
  if (tail) out.push(tail);
  return out;
}

/* -------------------------------- the logos ------------------------------- */

/** The two schools, away then home, at the head of a game card. */
function MatchupLogos({ home, away, size = 16 }: {
  home: string | null; away: string | null; size?: number;
}) {
  const pair = [
    { name: away ?? "", src: getTeamLogo(away), key: "away" },
    { name: home ?? "", src: getTeamLogo(home), key: "home" },
  ].filter((x) => x.src);
  if (!pair.length) {
    return <span aria-hidden style={{ width: size * 2 + 4, flex: "none" }} />;
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, flex: "none",
      width: size * 2 + 4, justifyContent: "flex-start",
    }}>
      {pair.map((p) => (
        <img key={p.key} src={p.src} alt="" title={p.name}
             width={size} height={size} loading="lazy"
             style={{ objectFit: "contain" }} />
      ))}
    </span>
  );
}
