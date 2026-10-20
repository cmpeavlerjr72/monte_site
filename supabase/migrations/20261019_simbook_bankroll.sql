-- THE SIM BOOK: bankroll + per-kind max bets (owner 2026-10-19: "$250 and max bet
-- is $50 per singles and $25 for combos"). Available = bankroll + settled P&L -
-- open risk; a bet can't exceed it. max_stake (the old single cap) is kept but unused.
alter table public.simbook_players add column if not exists bankroll   numeric not null default 250 check (bankroll >= 0 and bankroll <= 100000);
alter table public.simbook_players add column if not exists max_single numeric not null default 50  check (max_single > 0 and max_single <= 10000);
alter table public.simbook_players add column if not exists max_combo  numeric not null default 25  check (max_combo > 0 and max_combo <= 10000);
-- tickets were capped at 100 units; dollars need room
alter table public.simbook_tickets drop constraint if exists simbook_tickets_stake_check;
alter table public.simbook_tickets add constraint simbook_tickets_stake_check check (stake > 0 and stake <= 10000);
update public.simbook_players set bankroll = 250, max_single = 50, max_combo = 25;
