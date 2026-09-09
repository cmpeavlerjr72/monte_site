-- A FRIEND NEVER SEES ANOTHER USER'S MONEY (owner decision 2026-09-08).
-- NOT APPLIED BY THIS REPO — run it in the Supabase SQL editor. New file:
-- the 2026-09-08 accounts migration is applied and is never edited.
--
-- THE RULE. Everything one user can see about another user's bets is in UNITS
-- of that user's own unit size, and the unit size itself is PRIVATE. "0.5u at
-- 61¢" says everything a friend needs and nothing about anyone's bankroll.
-- Price is public information — it is the exchange's, not the bettor's — so
-- prices stay. Counts, costs, fills and dollars do not.
--
-- HOW IT IS ENFORCED, in three layers that each hold on their own:
--
--  1. THE THREE SETTINGS COLUMNS ARE UNREADABLE TO CLIENTS. Supabase grants
--     table-level SELECT to `authenticated` by default, and PostgreSQL does
--     NOT let a column-level REVOKE cut a hole in a table-level grant — so the
--     table grant is revoked outright and re-granted COLUMN BY COLUMN, with
--     unit_size / sizing_mode / risk_multiple left out. The explicit column
--     revoke afterwards is belt and braces.
--     CONSEQUENCE, deliberately: `select *` on profiles now fails for a
--     client. Every read in the app names its columns.
--  2. THE OWNER OF THE ROW REACHES THEM ONLY THROUGH TWO SECURITY DEFINER
--     RPCs — my_settings() reads the caller's own three values,
--     set_my_settings() validates and writes them. Neither takes a user id:
--     they act on auth.uid() and cannot be pointed at anyone else.
--  3. THE FEED CARRIES UNITS, NEVER DOLLARS. feed_items is rebuilt to select
--     units/side/market/line/price/note/ticker/time/poster and nothing else —
--     for every row, including the viewer's own, so there is no branch that
--     could ever leak the wrong way. A user's own dollars come from the portal
--     payload on their own dashboard, which is their own Kalshi account.

-- ------------------------------------------------------- the three settings
alter table public.profiles
  add column if not exists unit_size numeric not null default 30
    check (unit_size > 0),
  add column if not exists sizing_mode text not null default 'risk'
    check (sizing_mode in ('risk','to-win','book')),
  add column if not exists risk_multiple numeric not null default 3
    check (risk_multiple between 1 and 5);

comment on column public.profiles.unit_size is
  'PRIVATE. Never granted to a client role; read/written only through my_settings()/set_my_settings().';

-- Table-level SELECT out, explicit column list back in (see layer 1).
revoke select on public.profiles from authenticated;
revoke select on public.profiles from anon;
grant select (id, handle, display_name, avatar_emoji, share_book, is_trader,
              email, created_at, updated_at)
  on public.profiles to authenticated;
-- Belt and braces: even if a table grant is restored by hand later, these
-- three stay named as revoked.
revoke select (unit_size, sizing_mode, risk_multiple) on public.profiles from authenticated;
revoke select (unit_size, sizing_mode, risk_multiple) on public.profiles from anon;

-- ------------------------------------------------------------- the two RPCs
create or replace function public.my_settings()
returns table (unit_size numeric, sizing_mode text, risk_multiple numeric)
language sql stable security definer set search_path = public as $$
  select p.unit_size, p.sizing_mode, p.risk_multiple
  from public.profiles p
  where p.id = auth.uid();
$$;
revoke all on function public.my_settings() from public;
grant execute on function public.my_settings() to authenticated;

create or replace function public.set_my_settings(
  p_unit numeric, p_mode text, p_mult numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  -- The same bounds the client clamps to (ownerPrefs: $1-$500, 1-5x). Stated
  -- here as well because a clamp in a browser is a courtesy, not a rule.
  if p_unit is null or p_unit <= 0 or p_unit > 500 then
    raise exception 'unit_size out of range';
  end if;
  if p_mode is null or p_mode not in ('risk','to-win','book') then
    raise exception 'bad sizing_mode';
  end if;
  if p_mult is null or p_mult < 1 or p_mult > 5 then
    raise exception 'risk_multiple out of range';
  end if;
  update public.profiles
     set unit_size = p_unit, sizing_mode = p_mode, risk_multiple = p_mult
   where id = auth.uid();
end $$;
revoke all on function public.set_my_settings(numeric, text, numeric) from public;
grant execute on function public.set_my_settings(numeric, text, numeric) to authenticated;

-- --------------------------------------------------------- units on the bets
-- app_orders.units is written by the SERVER (cost / the poster's unit size).
-- It is nullable because a row written before this column existed, or by a
-- server that could not read the unit, has no honest value — and a wrong
-- "1u" would be worse than a blank.
alter table public.app_orders
  add column if not exists units numeric;

-- A posted pick states its own size in units, and 1u is the default because
-- "a unit" is what people say when they do not say a size.
alter table public.picks
  add column if not exists units numeric not null default 1
    check (units > 0 and units <= 100);

-- ------------------------------------------------------------- the feed view
-- Rebuilt (dropped, not replaced: the column list changes). Units and price
-- only; no count, no cost, no filled, no dollars — for every row, so there is
-- no branch that could leak the wrong way.
drop view if exists public.feed_items;
create view public.feed_items
with (security_invoker = true) as
  select 'pick'::text as kind, k.id, k.user_id, p.handle, p.display_name, p.avatar_emoji,
         k.season, k.week, k.game_slug, k.market, k.side, k.line, k.price,
         k.units, k.note, k.source::text as source, k.ticker, k.created_at as at
  from public.picks k join public.profiles p on p.id = k.user_id
  union all
  select 'order', o.id, o.user_id, p.handle, p.display_name, p.avatar_emoji,
         o.season, o.week, o.game_slug, 'order', o.side || ' ' || o.ticker, null, o.price,
         o.units, null, 'app_order', o.ticker, o.placed_at
  from public.app_orders o join public.profiles p on p.id = o.user_id;
grant select on public.feed_items to authenticated;
