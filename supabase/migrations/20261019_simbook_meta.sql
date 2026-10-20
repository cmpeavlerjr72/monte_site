-- THE SIM BOOK: status the PC refresh job writes for the site to read
-- (key 'sgo': SportsGameOdds reads used this month + the job's last run).
-- The site never calls SGO itself. Server-only (RLS on, no policies).
create table if not exists public.simbook_meta (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.simbook_meta enable row level security;
revoke all on public.simbook_meta from anon, authenticated;
