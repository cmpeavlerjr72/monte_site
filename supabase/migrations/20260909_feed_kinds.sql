-- ONE OF EVERY ITEM KIND (owner 2026-09-08, 11:25 PM).
-- APPLIED to the live project by scripts/backfill_feed_wk1.py's sibling run
-- (psycopg, service credentials) on the day it was written. New file: the
-- 2026-09-08 and earlier 2026-09-09 migrations are applied and are never
-- edited.
--
-- WHAT THIS ADDS. The feed until now had one sentence: "@mvpeav placed 1.5
-- units on Rutgers over 23.5 points at 59c". The owner wants to see the whole
-- vocabulary before any of it goes live with real money, so the feed learns
-- three more:
--
--   TAIL      roth tailed mvpeav · 1 unit on Rutgers over 23.5 at 61c
--   SETTLED   (the original item gains a ribbon) WON  +0.7u
--   SCORE     San Jose St. 27 - Eastern Michigan 21, Q4 3:12
--             your San Jose St. ML now 88% (was 59%)
--
-- The first two are FACTS ABOUT AN ORDER and belong on the order row: a tail
-- is an order with a parent, a settlement is an order with an outcome. So they
-- are four columns on `app_orders`, not a second table — one bet stays one
-- row, and the feed item a friend already saw is the one that changes, which
-- is exactly what "the original item gains a ribbon" means.
--
-- The third is NOT a fact about an order. A score update is a fact about a
-- GAME that happens to be interesting to whoever is on it, it can happen many
-- times per bet, and it has no place in a table whose primary key is a
-- placement. That is `feed_events`.
--
-- THE MONEY RULE IS UNCHANGED, and every column below was checked against it
-- (20260908_units.sql for the full argument). What is added:
--   * units_net -- a count of the poster's OWN units, exactly like `units`.
--     Not dollars, and unreadable as dollars without unit_size, which no
--     client role may select.
--   * result / settled_at -- an outcome and a time. Neither is a quantity.
--   * tailed_from -- an order id. An opaque identifier, not an amount; it
--     grants nothing (the exchange authenticates every read of its own
--     orders) and it is the only honest way to draw the line between a bet
--     and the bet it copied.
--   * payload -- score, period, clock, the bet's side in words, two
--     probabilities, and a unit count. Probabilities are rates, the score is
--     public, the units are units.
-- Still NO count, NO cost, NO filled, NO dollars, for every row including the
-- viewer's own.

-- ------------------------------------------------- the four order columns
-- All nullable. A row that predates them is still a real bet: it simply has
-- no parent and no outcome yet, which is the truth about an open bet placed
-- before this file existed.
alter table public.app_orders
  -- THE TAIL EDGE. Points at the order that was copied, by its exchange order
  -- id (`order_id` is already unique, which is what makes it referenceable).
  -- Nullable = this bet is nobody's copy. Self-referencing on a text key
  -- rather than the surrogate `id` because the placement path knows the
  -- source's order id -- it is what the tail button carries -- and would
  -- otherwise have to look the row up to write the link.
  add column if not exists tailed_from text,
  -- WHEN THE MONEY LANDED, from the exchange's own settled_time. Null while
  -- the bet is open; it is also the "has this been graded" flag, so a job may
  -- re-run without regrading (`where settled_at is null`).
  add column if not exists settled_at timestamptz,
  -- THE GRADE. From the SIGN OF THE MONEY (revenue - cost), never Kalshi's
  -- `market_result`: a scalar settlement pays an intermediate value and its
  -- "yes" is not a win. Same rule, same PUSH epsilon (half a cent) as
  -- `computeSettlementRecord` in src/lib/kalshiPortal.ts, so the ribbon in the
  -- feed and the record in My Book can never disagree about one bet.
  add column if not exists result text
    check (result is null or result in ('won','lost','push')),
  -- THE MONEY, IN THE POSTER'S OWN UNITS AND NET OF FEES. Fee-inclusive
  -- because every ROI on this site is (revenue - cost - fees) / stake
  -- (standing rule 2026-08-28); `result` above is graded pre-fee because that
  -- is what My Book's record does, and the two answer different questions --
  -- "did the bet win" and "what did it pay".
  add column if not exists units_net numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_orders_tailed_from_fkey') then
    alter table public.app_orders
      add constraint app_orders_tailed_from_fkey
      foreign key (tailed_from) references public.app_orders (order_id)
      on delete set null;
  end if;
end $$;

create index if not exists app_orders_tailed_from_idx
  on public.app_orders (tailed_from) where tailed_from is not null;

comment on column public.app_orders.tailed_from is
  'app_orders.order_id of the bet this one copied. Null = not a tail.';
comment on column public.app_orders.result is
  'won | lost | push, from the sign of revenue-cost (PUSH within half a cent). Never Kalshi market_result.';
comment on column public.app_orders.units_net is
  'Realised (revenue - cost - fees) in the poster''s OWN units. A unit count, never dollars.';

-- ---------------------------------------------------------- feed_events
-- FACTS ABOUT A GAME that are worth telling someone who is on it. One kind
-- today ('score'); the check constraint is the list, so adding 'lineup' or
-- 'injury' later is a one-line alter and not a new table.
--
-- WRITES ARE SERVICE-ROLE ONLY, like app_orders: these rows are produced by
-- the server watching the gamecast, never by a browser. There is no insert,
-- update or delete policy below, and RLS is on, so `authenticated` cannot
-- write one at all.
create table if not exists public.feed_events (
  id         bigint generated always as identity primary key,
  -- WHOSE BET this is about. The event is addressed to a person -- "your
  -- Rutgers over 23.5" -- so it is owned like a bet is, and it cascades with
  -- the profile for the same reason.
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('score')),
  game_slug  text,
  sport      text,
  -- The bet it is about (app_orders.order_id). Not a foreign key: a score
  -- update is still true if the order row is later removed, and this table
  -- must never be the reason a deletion fails.
  order_id   text,
  -- score {home_team, away_team, home, away}, period, clock, side (the bet in
  -- words), prob_before, prob_after, units. Nothing else -- see the money
  -- rule at the top of this file.
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists feed_events_user_idx
  on public.feed_events (user_id, created_at desc);
create index if not exists feed_events_order_idx
  on public.feed_events (order_id) where order_id is not null;

alter table public.feed_events enable row level security;

-- READ: the owner of the row, and anyone that user's share_book already lets
-- see their book. A score update about a friend's bet is fine to show a
-- friend -- there is no money in it, only a public score and two rates -- and
-- it must obey the SAME gate as the bet it is about, or the feed would leak
-- the existence of a position the book setting hides.
drop policy if exists "feed_events: read visible" on public.feed_events;
create policy "feed_events: read visible" on public.feed_events for select to authenticated
  using (public.can_view_book(auth.uid(), user_id));

grant select on public.feed_events to authenticated;

-- ------------------------------------------------------------- the view
-- Rebuilt (dropped, not replaced: the column list grows and a third branch
-- joins the union). security_invoker, so RLS on picks / app_orders /
-- feed_events is still the only thing deciding whose rows come back.
--
-- `order_id` is newly exposed on the order branch. It is what lets the
-- renderer resolve `tailed_from` to the row it copied -- "roth tailed
-- mvpeav" needs the parent's poster, and the parent is already in the same
-- RLS-filtered result set. It is an opaque exchange identifier and not a
-- quantity of anyone's money; see the money-rule note at the top.
drop view if exists public.feed_items;
create view public.feed_items
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
         k.created_at as at
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
         o.placed_at
  from public.app_orders o join public.profiles p on p.id = o.user_id
  union all
  -- SCORE UPDATES. Season and week are null on purpose: an event is dated by
  -- when it happened, and the feed's single-week filter already keeps
  -- `week is null` rows, so a score update never disappears from a week view
  -- because nobody stamped a week on it.
  --
  -- The two teams are LIFTED OUT OF THE PAYLOAD into the view's own
  -- home_team / away_team columns so one renderer draws the matchup logos on
  -- every kind of row. They are inside `score` in the payload because that is
  -- what a score is: two teams and two numbers.
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
         e.created_at as at
  from public.feed_events e join public.profiles p on p.id = e.user_id;
grant select on public.feed_items to authenticated;

-- ---------------------------------------------------------- live updates
-- A score update has to arrive without a refresh or it is not a score update.
-- Same two rules as app_orders (20260909_feed_detail.sql): RLS applies to
-- realtime, so the broadcast is not a wider read path; and the client treats
-- the event as a doorbell and refetches `feed_items`, so nothing renders from
-- a payload that has not been through the view.
--
-- Guarded: adding a table twice is an error, and this file may be re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'feed_events'
  ) then
    alter publication supabase_realtime add table public.feed_events;
  end if;
end $$;

-- app_orders is already in the publication for INSERT (a friend placed a
-- bet). A SETTLEMENT is an UPDATE of that same row, and the subscription in
-- NetworkFeed.tsx now listens for both -- no publication change is needed,
-- but REPLICA IDENTITY is: without it an UPDATE broadcasts no old row and,
-- more to the point, Supabase filters updates it cannot key. DEFAULT (the
-- primary key) is enough here because the client only needs the doorbell.
alter table public.app_orders replica identity default;
