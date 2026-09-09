-- monte-site accounts / profiles / friends / feed  (docs/ACCOUNTS_DESIGN.md)
-- New Supabase project (owner decision 2026-09-08). Everything under RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type public.share_scope as enum ('nobody', 'friends', 'everyone');
create type public.friend_status as enum ('pending', 'accepted', 'blocked');
create type public.pick_source as enum ('posted', 'app_order');

-- ------------------------------------------------------------- profiles
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  handle        text not null unique
                check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name  text not null check (char_length(display_name) between 1 and 40),
  avatar_emoji  text check (avatar_emoji is null or char_length(avatar_emoji) <= 8),
  share_book    public.share_scope not null default 'friends',
  -- Server-set (service role) when the account may trade through the app.
  is_trader     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A user may not flip their own is_trader flag.
create or replace function public.profiles_guard_trader() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and new.is_trader is distinct from old.is_trader then
    raise exception 'is_trader is server-managed';
  end if;
  return new;
end $$;
create trigger profiles_guard_trader before update on public.profiles
  for each row execute function public.profiles_guard_trader();

-- ----------------------------------------------------------- friendships
create table public.friendships (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        public.friend_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
-- one row per unordered pair
create unique index friendships_pair_uq on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
alter table public.friendships enable row level security;
create trigger friendships_touch before update on public.friendships
  for each row execute function public.touch_updated_at();

-- Are a and b accepted friends? (SECURITY DEFINER so policies can call it
-- without recursing into friendships' own RLS.)
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a)));
$$;

-- Is `viewer` allowed to see `owner`'s book, per owner's share_book?
create or replace function public.can_view_book(viewer uuid, owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when viewer = owner then true
    when (select share_book from public.profiles where id = owner) = 'everyone' then viewer is not null
    when (select share_book from public.profiles where id = owner) = 'friends' then public.are_friends(viewer, owner)
    else false end;
$$;

-- --------------------------------------------------------------- picks
create table public.picks (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  season      int  not null,
  week        int  not null,
  game_slug   text not null,
  market      text not null check (market in ('spread','total','team_total','ml','prop','other')),
  side        text not null check (char_length(side) between 1 and 80),
  line        numeric,
  price       numeric check (price is null or (price > 0 and price < 1)),
  note        text check (note is null or char_length(note) <= 140),
  source      public.pick_source not null default 'posted',
  ticker      text,
  order_id    text,
  created_at  timestamptz not null default now()
);
create index picks_user_idx on public.picks (user_id, created_at desc);
create index picks_week_idx on public.picks (season, week, created_at desc);
alter table public.picks enable row level security;

-- ------------------------------------------------------------ app_orders
-- Written by the SERVER (service role) after every placement. The feed reads
-- it through `feed_orders`, which strips the exchange state blob.
create table public.app_orders (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  account_id  text not null,
  season      int,
  week        int,
  game_slug   text,
  ticker      text not null,
  side        text not null,
  mode        text not null,
  price       numeric not null,
  count       numeric not null,
  filled      numeric,
  cost        numeric,
  order_id    text unique,
  state       jsonb,
  placed_at   timestamptz not null default now()
);
create index app_orders_user_idx on public.app_orders (user_id, placed_at desc);
alter table public.app_orders enable row level security;

-- --------------------------------------------------------------- policies
-- profiles: own row full; others only via friendship or the handle lookup RPC.
create policy "profiles: read own" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "profiles: read friends" on public.profiles for select to authenticated
  using (public.are_friends(auth.uid(), id));
create policy "profiles: read any pending counterpart" on public.profiles for select to authenticated
  using (exists (select 1 from public.friendships f
                 where f.status = 'pending'
                   and ((f.requester_id = auth.uid() and f.addressee_id = profiles.id)
                     or (f.addressee_id = auth.uid() and f.requester_id = profiles.id))));
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check (id = auth.uid() and is_trader = false);
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- friendships: either party reads; requester creates pending; addressee
-- accepts/blocks; either party deletes (unfriend / cancel request).
create policy "friendships: read own" on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "friendships: request" on public.friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');
create policy "friendships: addressee decides" on public.friendships for update to authenticated
  using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid() and status in ('accepted','blocked'));
create policy "friendships: either deletes" on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- picks: own full; others per share_book.
create policy "picks: read visible" on public.picks for select to authenticated
  using (public.can_view_book(auth.uid(), user_id));
create policy "picks: insert own posted" on public.picks for insert to authenticated
  with check (user_id = auth.uid() and source = 'posted');
create policy "picks: delete own" on public.picks for delete to authenticated
  using (user_id = auth.uid());

-- app_orders: read only, per share_book; writes are service-role only.
create policy "app_orders: read visible" on public.app_orders for select to authenticated
  using (public.can_view_book(auth.uid(), user_id));

-- ----------------------------------------------------------------- RPCs
-- Exact-handle lookup: the ONLY way to find a stranger. Returns the minimum.
create or replace function public.find_profile(p_handle text)
returns table (id uuid, handle text, display_name text, avatar_emoji text)
language sql stable security definer set search_path = public as $$
  select p.id, p.handle, p.display_name, p.avatar_emoji
  from public.profiles p where p.handle = lower(p_handle) limit 1;
$$;
revoke all on function public.find_profile(text) from public;
grant execute on function public.find_profile(text) to authenticated;

-- The feed: everything the viewer may see, newest first, with who posted it.
create or replace view public.feed_items
with (security_invoker = true) as
  select 'pick'::text as kind, k.id, k.user_id, p.handle, p.display_name, p.avatar_emoji,
         k.season, k.week, k.game_slug, k.market, k.side, k.line, k.price,
         k.note, k.source::text as source, k.ticker, k.created_at as at
  from public.picks k join public.profiles p on p.id = k.user_id
  union all
  select 'order', o.id, o.user_id, p.handle, p.display_name, p.avatar_emoji,
         o.season, o.week, o.game_slug, 'order', o.side || ' ' || o.ticker, null, o.price,
         null, 'app_order', o.ticker, o.placed_at
  from public.app_orders o join public.profiles p on p.id = o.user_id;
grant select on public.feed_items to authenticated;

-- Account deletion: the user's own rows cascade from auth.users; this RPC
-- deletes the auth user (needs the service role in practice — exposed for the
-- server to call on the user's behalf after re-authentication).
create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
