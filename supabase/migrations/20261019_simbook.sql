-- THE SIM BOOK (owner 2026-10-19). A private sportsbook where the sim is the
-- house: an invited friend bets units against our prices, the server grades
-- every ticket, and the owner can see whether "ball knowledge" beats the sim.
--
-- ACCESS: RLS on with NO policies and no client grants, so anon/authenticated
-- roles can neither read nor write. Everything goes through the server's
-- service role (server/simbook.ts), which re-prices every bet itself, so a
-- price can never be forged from the browser. Readers: the bettor sees his own
-- tickets, the owner (CFB_PORTAL_OWNERS) sees everything.

create table if not exists public.simbook_players (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  active      boolean not null default true,
  max_stake   numeric not null default 5 check (max_stake > 0 and max_stake <= 100),
  added_at    timestamptz not null default now()
);

create table if not exists public.simbook_tickets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  season        int not null,
  week          int not null,
  kind          text not null check (kind in ('single', 'parlay')),
  stake         numeric not null check (stake > 0 and stake <= 100),   -- units risked
  american      int not null,                                          -- price he got
  decimal_odds  numeric not null check (decimal_odds > 1),
  -- the house's view at the moment of the bet (never shown to the bettor)
  p_sim         numeric,          -- sim probability his ticket wins (push-free)
  p_mkt         numeric,          -- DraftKings no-vig probability
  p_house       numeric,          -- the blend the price was built from
  house_ev      numeric,          -- house EV per unit staked, by the sim
  dk_decimal    numeric,          -- DK's own price for the same ticket (product for parlays)
  legs          jsonb not null,   -- [{slug, game, kickoff, market, side, line, player, stat, label, sgo_event, odd_id, dk_american, p_sim, p_mkt, result, score, close_line, close_american}]
  status        text not null default 'open' check (status in ('open', 'won', 'lost', 'push', 'void')),
  payout        numeric,          -- units back to him INCLUDING stake (0 on a loss)
  settled_at    timestamptz,
  note          text check (char_length(note) <= 200)
);

create index if not exists simbook_tickets_user_idx on public.simbook_tickets (user_id, created_at desc);
create index if not exists simbook_tickets_open_idx on public.simbook_tickets (status) where status = 'open';

alter table public.simbook_players enable row level security;
alter table public.simbook_tickets enable row level security;
revoke all on public.simbook_players from anon, authenticated;
revoke all on public.simbook_tickets from anon, authenticated;
