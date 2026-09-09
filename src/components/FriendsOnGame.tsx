// src/components/FriendsOnGame.tsx
//
// WHO ELSE IS ON THIS GAME — the feed's summary, read back on the game card.
//
// The owner asked for the Tail button on BOTH surfaces "so the user can pick
// whichever is easier" (2026-09-09): the feed, when you are reading what your
// friends did, and the Bets panel, when you are already looking at the game
// and deciding. This is the second one, and it is the FIRST thing in the
// panel, above our own suggestions — a friend's position is context for the
// rows underneath it, not a footnote to them.
//
// IT IS THE SAME FOLD, FROM THE SAME VIEW. `positionsOf` (src/lib/feedBuckets)
// is what the feed's buckets use, so a position reads identically in both
// places: one line per (poster, contract), total units, units-weighted average
// price. Two summaries of the same rows that could disagree would be a bug
// waiting for a Saturday.
//
// AND THE SAME PERMISSION MODEL: it reads `feed_items`, a security_invoker
// view, filtered only by `game_slug`. WHOSE rows come back is RLS's answer and
// this file does not have a second opinion about it — signed out, it is
// nobody's, and the strip does not render at all.

import { useEffect, useState } from "react";
import Flares from "./Flares";
import TailButton from "./TailButton";
import { supabase, supabaseEnabled, type FeedItem } from "../lib/supabase";
import { positionsOf, unitsShort, ago, type FeedPosition } from "../lib/feedBuckets";

/** One game's worth of rows is small; the cap is a guard, not a page size. */
const MAX_ROWS = 120;

export default function FriendsOnGame({ slug }: { slug: string | undefined }) {
  const [positions, setPositions] = useState<FeedPosition[]>([]);

  useEffect(() => {
    if (!supabase || !supabaseEnabled || !slug) { setPositions([]); return; }
    let alive = true;
    void (async () => {
      const { data, error } = await supabase!
        .from("feed_items")
        .select("*")
        .eq("game_slug", slug)
        .order("at", { ascending: false })
        .limit(MAX_ROWS);
      if (!alive) return;
      // A read that fails is silence, never an error box on a betting panel:
      // this strip is context, and the rows underneath it are the page.
      if (error) { setPositions([]); return; }
      const rows = (data ?? []) as FeedItem[];
      const tails = new Map<string, number>();
      for (const r of rows) {
        if (r.tailed_from) tails.set(r.tailed_from, (tails.get(r.tailed_from) ?? 0) + 1);
      }
      setPositions(positionsOf(rows, tails));
    })();
    return () => { alive = false; };
  }, [slug]);

  if (!positions.length) return null;

  return (
    <div className="bkt__who" style={{ borderTop: 0, borderRadius: 8 }}>
      <div className="bkt__whoLabel">friends on this game</div>
      {positions.map((p) => (
        <div key={p.key} className="bkt__pos">
          <span className="bkt__posWho" title={p.display_name || p.handle}>
            {p.handle}
            <Flares flares={p.flares} raised />
          </span>
          <span className="bkt__posBet">{p.label}</span>
          {p.avgPrice != null && (
            <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}
                  title={p.fills > 1 ? `${p.fills} fills, averaged by units` : "the price paid"}>
              {Math.round(p.avgPrice * 100)}¢{p.fills > 1 ? " avg" : ""}
            </span>
          )}
          {unitsShort(p.units) && (
            <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>
              {unitsShort(p.units)}
            </span>
          )}
          <span style={{ fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {ago(p.lastMs)}
          </span>
          <span className="bkt__posAct">
            <TailButton
              compact
              target={{
                ticker: p.ticker, side: p.side, orderId: p.orderId,
                userId: p.user_id, units: p.units, title: p.title,
                home_team: p.home_team, away_team: p.away_team, sport: p.sport,
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
