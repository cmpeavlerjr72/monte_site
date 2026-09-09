// src/components/NetworkFeed.tsx
//
// "WHAT YOUR NETWORK IS ON" — the accounts-era feed (docs/ACCOUNTS_DESIGN.md).
// It reads ONE view, `feed_items`: the UNION of posted picks and app-placed
// orders, joined to profiles for who posted it.
//
// THE FILTERING IS THE DATABASE'S JOB, not this component's. `feed_items` is
// a security_invoker view over RLS-protected tables, so what comes back is
// already exactly what this viewer may see (own rows, friends' rows, and
// everyone-shared rows per each poster's share_book). There is no client-side
// "is this mine / are we friends" test anywhere in this file, and adding one
// would be a second, weaker copy of a rule the database already enforces.
//
// It sits BESIDE the existing env-paired Friend Feed rather than replacing it
// (that one reads the owner's Kalshi accounts through the server and stays
// working through the cutover). Same slot in the My Book console, new source.
//
// Grouping is BY GAME within the current week, newest first — the same shape
// the Bets panel uses, because "who else is on this game" is the question the
// feed answers. Rows whose week is null (an order placed before the client
// started sending it) fall into one trailing group rather than disappearing.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import AuthPanel from "./AuthPanel";
import {
  supabase, supabaseEnabled, useProfile, useSession, type FeedItem,
} from "../lib/supabase";
import type { BetGameNames } from "../lib/kalshiPortal";

/** The markets a posted pick can name — the CHECK constraint on picks.market,
 *  in the words a bettor uses. */
const MARKETS: { value: string; label: string }[] = [
  { value: "spread", label: "Spread" },
  { value: "total", label: "Total" },
  { value: "team_total", label: "Team total" },
  { value: "ml", label: "Moneyline" },
  { value: "prop", label: "Player prop" },
  { value: "other", label: "Other" },
];

export type NetworkFeedProps = {
  /** Calendar season as an integer (picks.season is `int not null`). */
  season: number;
  /** Week number as an integer (picks.week is `int not null`). */
  week: number;
  /** slug -> the card's real team names, for naming a game group and the
   *  post form's game picker. teamA is HOME (data contract). */
  slugTeams: Map<string, BetGameNames>;
  /** EVERY week, newest first, instead of this board's week (the dashboard
   *  reads the feed as a timeline, the scoreboard read it as "who else is on
   *  these games"). `season`/`week` still say what a NEW pick is filed under. */
  allWeeks?: boolean;
  /** Start expanded. The dashboard's feed IS the section, so a "Show network"
   *  press to see anything would be a click for nothing. */
  startOpen?: boolean;
};

export default function NetworkFeed({
  season, week, slugTeams, allWeeks = false, startOpen = false,
}: NetworkFeedProps) {
  const { session, loading } = useSession();
  const { profile } = useProfile(session);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [posting, setPosting] = useState(false);

  const signedIn = Boolean(session && profile);

  const load = useCallback(async () => {
    if (!supabase || !signedIn) return;
    // Current week, plus rows the writer could not date (null week) so an
    // order never silently vanishes from the feed. In `allWeeks` the filter
    // is simply absent — RLS still decides WHOSE rows come back, so a wider
    // window is never a wider audience.
    let q = supabase.from("feed_items").select("*");
    if (!allWeeks) {
      q = q.or(`and(season.eq.${season},week.eq.${week}),week.is.null`);
    }
    const { data, error } = await q.order("at", { ascending: false }).limit(200);
    if (error) { setErr(error.message); return; }
    setErr(null);
    setItems((data ?? []) as FeedItem[]);
  }, [signedIn, season, week, allWeeks]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupByGame(items, slugTeams), [items, slugTeams]);

  if (!supabaseEnabled) return null;
  if (loading) return null;

  if (!signedIn) {
    return (
      <AuthPanel compact
                 prompt="Sign in to see what your friends are on — and post your own." />
    );
  }

  return (
    <div style={{ display: "grid", gap: 6, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="ui-btn" onClick={() => setOpen((v) => !v)}
                style={{ padding: "3px 10px", fontSize: 11 }}>
          {open ? "Hide" : "Show"} network
        </button>
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {items.length === 0
            ? (allWeeks
                ? "nothing from your network yet — add a friend, or post the first pick"
                : "nothing from your network on this week yet")
            : `${items.length} from your network · ${groups.length} game${groups.length === 1 ? "" : "s"}`}
        </span>
        <button type="button" className="ui-btn" onClick={() => setPosting((v) => !v)}
                style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}>
          {posting ? "Cancel" : "Post a pick"}
        </button>
      </div>

      {err && <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{err}</span>}

      {posting && profile && (
        <PostPick
          userId={profile.id} season={season} week={week} slugTeams={slugTeams}
          onPosted={() => { setPosting(false); setOpen(true); void load(); }}
        />
      )}

      {open && groups.map((g) => (
        <div key={g.slug} style={{
          border: "1px solid var(--border)", borderRadius: 8,
          background: "var(--fill)", padding: "5px 8px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
            textTransform: "uppercase", color: "var(--muted)", paddingBottom: 2,
          }}>
            {g.label}
          </div>
          {g.items.map((it) => <FeedRow key={`${it.kind}:${it.id}`} item={it} />)}
        </div>
      ))}
    </div>
  );
}

/** One line: who, what they are on, at what price, and where it came from. */
function FeedRow({ item }: { item: FeedItem }) {
  const posted = item.source === "posted";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7, minHeight: 34,
      padding: "3px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap",
    }}>
      <span aria-hidden style={{ fontSize: 14 }}>{item.avatar_emoji || "🏈"}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700 }} title={`@${item.handle}`}>
        {item.display_name}
      </span>
      <span style={{ fontSize: 11.5, minWidth: 0, flex: "1 1 120px" }}>
        {pickText(item)}
      </span>
      {item.price != null && (
        <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
          {Math.round(item.price * 100)}¢
        </span>
      )}
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
        color: "var(--muted)", border: "1px solid var(--border)",
        borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap",
      }}>
        {posted ? "posted" : "placed"}
      </span>
      {item.note && (
        <span style={{ fontSize: 10.5, color: "var(--muted)", flexBasis: "100%" }}>
          “{item.note}”
        </span>
      )}
    </div>
  );
}

/** The bet in words. A posted pick spells out side + line; an order row
 *  carries the exchange's own side+ticker string from the view. */
function pickText(item: FeedItem): string {
  if (item.kind === "order") return item.side;
  const line = item.line == null ? "" : ` ${item.line > 0 ? "+" : ""}${item.line}`;
  return `${item.side}${line}`;
}

type Group = { slug: string; label: string; items: FeedItem[] };

/** Group by game, newest group first (the view is already time-ordered, so
 *  first appearance IS newest). Undated rows trail in one group. */
function groupByGame(items: FeedItem[], slugTeams: Map<string, BetGameNames>): Group[] {
  const out: Group[] = [];
  const byId = new Map<string, Group>();
  for (const it of items) {
    const slug = it.game_slug || "";
    const key = slug || "__other";
    let g = byId.get(key);
    if (!g) {
      const names = slug ? slugTeams.get(slug) : undefined;
      g = {
        slug: key,
        label: names ? `${names.teamB} @ ${names.teamA}` : (slug || "Other bets"),
        items: [],
      };
      byId.set(key, g);
      out.push(g);
    }
    g.items.push(it);
  }
  // The undated bucket never outranks a real game.
  return out.sort((a, b) => Number(a.slug === "__other") - Number(b.slug === "__other"));
}

/**
 * POST A PICK. Writes straight to `picks` under RLS with source='posted' —
 * there is no server endpoint for this (the server only ever writes
 * app_orders). The insert policy already pins user_id = auth.uid() and the
 * source, so a hand-crafted request cannot post as someone else.
 *
 * Price is entered in CENTS, the way the exchange quotes, and stored as the
 * dollars the column checks (0 < price < 1).
 */
function PostPick({ userId, season, week, slugTeams, onPosted }: {
  userId: string; season: number; week: number;
  slugTeams: Map<string, BetGameNames>;
  onPosted: () => void;
}) {
  const games = useMemo(
    () => [...slugTeams.entries()]
      .map(([slug, n]) => ({ slug, label: `${n.teamB} @ ${n.teamA}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [slugTeams],
  );
  const [slug, setSlug] = useState(games[0]?.slug ?? "");
  const [market, setMarket] = useState("spread");
  const [side, setSide] = useState("");
  const [line, setLine] = useState("");
  const [cents, setCents] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const centsNum = Number(cents);
  const priceOk = cents === "" ||
    (Number.isInteger(centsNum) && centsNum >= 1 && centsNum <= 99);
  const lineOk = line === "" || Number.isFinite(Number(line));
  const canPost = Boolean(slug) && side.trim().length > 0 && priceOk && lineOk && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !canPost) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("picks").insert({
      user_id: userId, season, week, game_slug: slug, market,
      side: side.trim().slice(0, 80),
      line: line === "" ? null : Number(line),
      price: cents === "" ? null : centsNum / 100,
      note: note.trim() ? note.trim().slice(0, 140) : null,
      source: "posted",
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSide(""); setLine(""); setCents(""); setNote("");
    onPosted();
  };

  return (
    <form onSubmit={submit} style={{
      display: "grid", gap: 6, border: "1px solid var(--border)",
      borderRadius: 8, padding: 8, background: "var(--fill)",
    }}>
      {games.length === 0 && (
        // A pick belongs to a game (`picks.game_slug` is not null) and this
        // browser has not seen a slate to choose from. Say where the games
        // are rather than showing an empty picker.
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          No games to choose from yet — open the scoreboard once and the
          week's games become postable here.
        </span>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select className="ui-sel" value={slug} onChange={(e) => setSlug(e.target.value)}
                aria-label="Game" style={{ fontSize: 11.5, flex: "1 1 170px", minWidth: 0 }}>
          {games.length === 0 && <option value="">no games on this board</option>}
          {games.map((g) => <option key={g.slug} value={g.slug}>{g.label}</option>)}
        </select>
        <select className="ui-sel" value={market} onChange={(e) => setMarket(e.target.value)}
                aria-label="Market" style={{ fontSize: 11.5 }}>
          {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="ui-sel" value={side} maxLength={80}
               onChange={(e) => setSide(e.target.value)}
               placeholder="the bet (e.g. Texas Tech)"
               style={{ fontSize: 11.5, flex: "2 1 150px", minWidth: 0 }} />
        <input className="ui-sel" value={line} inputMode="decimal"
               onChange={(e) => setLine(e.target.value)}
               placeholder="line" aria-label="Line"
               style={{ fontSize: 11.5, width: 74 }} />
        <input className="ui-sel" value={cents} inputMode="numeric"
               onChange={(e) => setCents(e.target.value)}
               placeholder="¢" aria-label="Price in cents"
               style={{ fontSize: 11.5, width: 56 }} />
      </div>
      <input className="ui-sel" value={note} maxLength={140}
             onChange={(e) => setNote(e.target.value)}
             placeholder="why (optional, 140 characters)"
             style={{ fontSize: 11.5 }} />
      {!priceOk && (
        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Price is whole cents, 1–99. Leave it blank if you did not take a price.
        </span>
      )}
      {err && <span style={{ fontSize: 10.5, color: "var(--neg)" }}>{err}</span>}
      <button type="submit" className="ui-btn" disabled={!canPost}
              style={{ padding: "4px 12px", fontSize: 11.5, fontWeight: 700, width: "fit-content" }}>
        {busy ? "Posting…" : "Post pick"}
      </button>
    </form>
  );
}
