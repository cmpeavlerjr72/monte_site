-- A SALE IS NOT A SETTLEMENT (owner, 2026-09-09 evening).
--
-- THE BUG THE OWNER SAW. /feed showed his own `mvpeav` Auburn -6.5 settled as
-- a LOSS sitting directly beside `beatty`'s Auburn -6.5 reading "+0.16u won".
-- Both sentences were true of their own row and the pair was a lie: beatty
-- bought that contract at 55c and SOLD it at 85c before kickoff. It never
-- reached settlement. Auburn did not cover for anybody. He asked for it to be
-- "categorized specifically as a flip sale".
--
-- WHY THE FEED COULD NOT SAY SO. scripts/sync_feed_account.py already KNOWS:
-- it matches sells to buys FIFO, prices the close off the sell's own proceeds
-- (a "sell yes" is booked as a NO buy and nets on the spot, so the market's
-- settlement row reads revenue 0 with the count on BOTH sides -- grading that
-- by rule 1 turns a winner into a total loss), and it writes
-- `closed_by: "sell"` into the row's `state` JSON. But `state` is a private
-- column: `feed_items` does not select it and no client role may. So the fact
-- existed in the database and could not reach a reader.
--
-- Two columns, promoted out of `state` into the view.
--
--   closed_by   'settlement' | 'sell' | null(open). WHICH ENDING this was.
--   exit_price  the price per contract the position LEFT at, in dollars.
--               Null unless closed_by = 'sell' -- a settlement has no exit
--               price, it has a payout, and that payout is already in
--               units_net.
--
-- THE MONEY RULE IS UNCHANGED (20260908_units.sql). `exit_price` is a MARKET
-- PRICE, the same kind of number as `price`, which the feed has published
-- since the day it existed: it is what one contract traded at, not how many
-- anybody held and not what anybody paid. Multiplying it by a count would
-- give dollars, and no client role can select a count. `closed_by` is a word.
-- Still NO count, NO cost, NO filled, NO dollars, for every row including the
-- viewer's own.

alter table public.app_orders
  -- HOW THE BET ENDED. Null while it is open (or partly closed -- a partly
  -- sold position is still a position; sync_feed_account.py leaves it open on
  -- purpose and reports it, because a settlement row for a ticker that has
  -- had sells on it cannot be divided per-contract honestly).
  add column if not exists closed_by text
    check (closed_by is null or closed_by in ('settlement','sell')),
  -- WHAT IT LEFT AT, per contract, in dollars on the POSITION's side. For a
  -- position closed by several sells this is the contract-weighted mean of
  -- them -- the same weighting `price` uses on the way in, so "55c -> 85c"
  -- compares two numbers built the same way.
  add column if not exists exit_price numeric;

comment on column public.app_orders.closed_by is
  'settlement | sell | null(open). A sell-closed row is a FLIP: it never reached settlement.';
comment on column public.app_orders.exit_price is
  'Per-contract price the position was sold at, in dollars on the position''s own side. Null unless closed_by = sell.';

-- ------------------------------------------------------------- the view
-- APPENDED, not rebuilt: `create or replace view` may only add columns at the
-- end, and every column above keeps its name, type and position so nothing
-- already reading this view can break. The order branch selects the two new
-- columns; the pick and score branches select null for both, because neither
-- a hand-posted pick nor a score update is a position that can be sold.
create or replace view public.feed_items
with (security_invoker = true) as
  select 'pick'::text as kind, k.id, k.user_id,
         p.handle, p.display_name, p.avatar_emoji, p.flares,
         k.season, k.week, k.game_slug, k.market, k.side, k.line, k.price,
         k.units, k.note, k.source::text as source, k.ticker,
         null::text    as title,
         null::text    as home_team,
         null::text    as away_team,
         null::numeric as sim_p,
         null::numeric as ev_fee,
         null::text    as sport,
         k.order_id,
         null::text        as tailed_from,
         null::timestamptz as settled_at,
         null::text        as result,
         null::numeric     as units_net,
         null::jsonb       as payload,
         k.created_at as at,
         null::text    as closed_by,
         null::numeric as exit_price
  from public.picks k join public.profiles p on p.id = k.user_id
  union all
  select 'order', o.id, o.user_id,
         p.handle, p.display_name, p.avatar_emoji, p.flares,
         o.season, o.week, o.game_slug, 'order', o.side || ' ' || o.ticker, null, o.price,
         o.units, null, 'app_order', o.ticker,
         o.title, o.home_team, o.away_team, o.sim_p, o.ev_fee,
         o.sport,
         o.order_id, o.tailed_from, o.settled_at, o.result, o.units_net,
         null::jsonb as payload,
         o.placed_at,
         o.closed_by, o.exit_price
  from public.app_orders o join public.profiles p on p.id = o.user_id
  union all
  select 'score', e.id, e.user_id,
         p.handle, p.display_name, p.avatar_emoji, p.flares,
         null::int as season, null::int as week, e.game_slug, 'score',
         e.payload ->> 'side'  as side,
         null::numeric as line, null::numeric as price,
         null::numeric as units, null::text as note, 'event' as source,
         null::text as ticker,
         null::text as title,
         e.payload -> 'score' ->> 'home_team' as home_team,
         e.payload -> 'score' ->> 'away_team' as away_team,
         null::numeric as sim_p, null::numeric as ev_fee,
         e.sport,
         e.order_id,
         null::text        as tailed_from,
         null::timestamptz as settled_at,
         null::text        as result,
         null::numeric     as units_net,
         e.payload,
         e.created_at as at,
         null::text    as closed_by,
         null::numeric as exit_price
  from public.feed_events e join public.profiles p on p.id = e.user_id;
grant select on public.feed_items to authenticated;
