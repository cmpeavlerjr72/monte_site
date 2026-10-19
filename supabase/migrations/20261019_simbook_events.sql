-- THE SIM BOOK: last DraftKings board per game (SportsGameOdds event JSON).
-- SGO bills every event read against 2,500/month, so the board is snapshotted
-- here: a redeploy reloads it instead of re-buying it. Server-only (RLS on, no
-- policies). Old weeks are pruned by the server.
create table if not exists public.simbook_events (
  season      int not null,
  week        int not null,
  slug        text not null,
  event_id    text,
  fetched_at  timestamptz not null default now(),
  event       jsonb,
  primary key (season, week, slug)
);
alter table public.simbook_events enable row level security;
revoke all on public.simbook_events from anon, authenticated;
