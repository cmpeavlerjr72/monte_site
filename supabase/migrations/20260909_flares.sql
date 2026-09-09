-- PROFILE FLARES (owner 2026-09-09). Cosmetic badges beside a username.
-- NOT APPLIED BY THIS REPO — run it in the Supabase SQL editor, AFTER
-- 20260909_feed_detail.sql (it re-creates that file's view; see below).
-- Applied migrations are never edited.
--
-- A flare is a school you ride with (`team:Texas Tech`) or a self-applied
-- label (`badge:dog`). At most three. The catalog that turns a string into a
-- logo or an emoji is client-side (src/lib/flares.ts) — the database stores
-- taste, not a picture, and adding a badge must not need a migration.
--
-- WHY THIS IS PUBLIC-WITHIN-THE-FRIEND-GRAPH, unlike unit_size. The money rule
-- (20260908_units.sql) is about a bettor's dollars: counts, costs, fills, the
-- unit itself. A flare says "I bet dogs" — it is the same class of fact as a
-- handle or an avatar emoji, which is why it is granted like one.

alter table public.profiles
  add column if not exists flares text[] not null default '{}'
    check (cardinality(flares) <= 3);

comment on column public.profiles.flares is
  'Cosmetic school flares, max 3, each `team:<school>` (FBS or FCS); resolved for display by src/lib/flares.ts.';

-- The units migration revoked the table-level SELECT and re-granted column by
-- column, so a NEW column is unreadable to clients until it is named here.
-- Own-row UPDATE already exists as a policy ("profiles: update own"), which is
-- how a user sets their own flares — no RPC, nothing new to authorise.
grant select (flares) on public.profiles to authenticated;

-- --------------------------------- the feed view carries the poster's flares
-- Rebuilt (dropped, not replaced: the column list grows) on top of
-- 20260909_feed_detail.sql. The feed names a person on every row and the
-- flares belong beside that name, so they ride the same RLS-filtered join the
-- handle and the avatar do — rather than a second per-poster profile lookup
-- from the client, which would be the same read spelled twice.
--
-- Unchanged, and the reason this is safe to keep re-cutting: units + the
-- market price and NOTHING that is a quantity of anyone's money — no count,
-- no cost, no filled, for every row including the viewer's own.
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
         k.created_at as at
  from public.picks k join public.profiles p on p.id = k.user_id
  union all
  select 'order', o.id, o.user_id,
         p.handle, p.display_name, p.avatar_emoji, p.flares,
         o.season, o.week, o.game_slug, 'order', o.side || ' ' || o.ticker, null, o.price,
         o.units, null, 'app_order', o.ticker,
         o.title, o.home_team, o.away_team, o.sim_p, o.ev_fee,
         o.sport,
         o.placed_at
  from public.app_orders o join public.profiles p on p.id = o.user_id;
grant select on public.feed_items to authenticated;

-- NOT TOUCHED, deliberately: `find_profile`. It is the exact-handle stranger
-- lookup and its return type is part of its contract; a flare is something you
-- see once someone is in your feed or your friends list, not a thing that
-- helps you find them. The friends list reads `profiles` directly (embedded
-- select) and simply names the new column.
