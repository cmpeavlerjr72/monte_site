-- THE FEED IS AUTOMATIC, AND IT SPEAKS IN SENTENCES (owner 2026-09-09).
-- NOT APPLIED BY THIS REPO — run it in the Supabase SQL editor. New file: the
-- 2026-09-08 migrations are applied and are never edited.
--
-- WHAT CHANGED. The "post a pick" form is gone. Every order placed through the
-- app already lands in `app_orders`; that row IS the feed item, and a friend's
-- feed line reads:
--
--     mvpeav placed 1.5 units on Rutgers over 23.5 points at 59c
--     · sim EV +0.21 per $1
--
-- To print that sentence the row has to CARRY it. `ticker` + `side` is a
-- machine string ("KXNCAAFGAME-25SEP06RUTG-RUTG yes"), not something anyone
-- reads, and the two sim numbers were never stored at all. So five nullable
-- attribution columns are added, written by the server from the confirm slip
-- that already holds them, and the feed view is rebuilt to expose them.
--
-- THE MONEY RULE IS UNCHANGED AND IS THE REASON THIS FILE IS SHORT ON COLUMNS.
-- feed_items still selects units + the market price and NOTHING that is a
-- quantity of anyone's money: no count, no cost, no filled, for every row
-- including the viewer's own, so there is no branch that could leak the wrong
-- way (see 20260908_units.sql for the full argument). `sim_p` and `ev_fee` are
-- OUR model's opinion of the market, not a fact about the bettor's bankroll —
-- a rate per $1, never an amount — so they are publishable by the same test.

-- ---------------------------------------------------- the attribution columns
-- All NULLABLE, all written by the server after the exchange has already
-- accepted the order. A row that arrives without them is still a real bet and
-- still appears in the feed; it simply says less (the renderer falls back to
-- the ticker). Attribution must never be able to block, delay or un-place
-- money — the same rule season/week/game_slug were added under.
alter table public.app_orders
  add column if not exists title      text,
  add column if not exists home_team  text,
  add column if not exists away_team  text,
  add column if not exists sim_p      numeric,
  add column if not exists ev_fee     numeric,
  -- WHICH LEAGUE (owner 2026-09-08): the account, the book and the friend
  -- graph are sport-agnostic — NCAAB is next season on the same account — so
  -- the feed row says which league it is about. Stored values are the league
  -- ids in src/lib/leagues.ts: "fbs", "fcs", "ncaab", "ncaaw". NULL on every
  -- row placed before now, and null means NO CHIP — an unlabelled bet is not
  -- relabelled by a guess.
  add column if not exists sport      text;

comment on column public.app_orders.sport is
  'League id: fbs | fcs | ncaab | ncaaw (src/lib/leagues.ts). Null = unlabelled, shown without a chip.';
comment on column public.app_orders.title is
  'The bet in the words the bettor confirmed ("Rutgers over 23.5 points"). Display only.';
comment on column public.app_orders.sim_p is
  'Our sim P(YES) at placement, 0..1. Model opinion, never anyone''s money.';
comment on column public.app_orders.ev_fee is
  'Sim EV per $1 staked, net of the Kalshi fee, at placement. A RATE, not an amount.';

-- ------------------------------------------------------------- the feed view
-- Rebuilt (dropped, not replaced: the column list grows). security_invoker, so
-- RLS on picks/app_orders is still the only thing deciding whose rows come
-- back — the view widens what a VISIBLE row says, never who can see one.
--
-- The picks half stays exactly as it was. `picks` is untouched by this change
-- and nothing writes to it any more, but rows already posted are somebody's
-- record and keep appearing; the new columns are simply null for them.
drop view if exists public.feed_items;
create view public.feed_items
with (security_invoker = true) as
  select 'pick'::text as kind, k.id, k.user_id,
         p.handle, p.display_name, p.avatar_emoji,
         k.season, k.week, k.game_slug, k.market, k.side, k.line, k.price,
         k.units, k.note, k.source::text as source, k.ticker,
         null::text    as title,
         null::text    as home_team,
         null::text    as away_team,
         null::numeric as sim_p,
         null::numeric as ev_fee,
         null::text    as sport,
         k.created_at as at
  from public.picks k join public.profiles p on p.id = k.user_id
  union all
  select 'order', o.id, o.user_id,
         p.handle, p.display_name, p.avatar_emoji,
         o.season, o.week, o.game_slug, 'order', o.side || ' ' || o.ticker, null, o.price,
         o.units, null, 'app_order', o.ticker,
         o.title, o.home_team, o.away_team, o.sim_p, o.ev_fee,
         o.sport,
         o.placed_at
  from public.app_orders o join public.profiles p on p.id = o.user_id;
grant select on public.feed_items to authenticated;

-- ------------------------------------------------------------ live updates
-- The feed refreshes when a friend places a bet. RLS APPLIES TO REALTIME, so a
-- subscriber is only handed rows its policies already let it select — the
-- broadcast is not a second, wider read path. The client still REFETCHES the
-- view on each event rather than trusting the payload, so what renders has
-- been through `feed_items` (and its RLS) exactly like a page load.
--
-- Guarded: adding a table twice is an error, and this file may be re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'app_orders'
  ) then
    alter publication supabase_realtime add table public.app_orders;
  end if;
end $$;
