-- Per-user Kalshi API credentials (owner decision 2026-09-08).
-- NOT APPLIED BY THIS REPO — run it in the Supabase SQL editor. New file:
-- 20260908_accounts.sql is applied and is never edited.
--
-- THIS TABLE IS THE MOST SENSITIVE THING ON THE SITE. It holds the private
-- key that signs orders on a user's own money. Three rules build it:
--
--  1. THE ROW IS UNREADABLE TO EVERY CLIENT. RLS is ON and there are NO
--     policies for `authenticated` or `anon` — RLS with zero policies denies
--     everything, and the grants are revoked as well, belt and braces. Only
--     the service role (the Express server) touches this table. Not even the
--     owner of the row can select it from the browser.
--  2. THE PEM IS NEVER STORED IN THE CLEAR. `pem_ct` is AES-256-GCM
--     ciphertext under KALSHI_CRED_SECRET (server env, base64, 32 bytes),
--     with a random 12-byte `iv` per write and the GCM `tag` beside it. All
--     three are base64. A database dump without that env var is inert.
--  3. `key_id` IS NOT SECRET but is still never returned in full — the API
--     answers with the last 4 characters only, and the PEM is never returned
--     at all, in any form, to anyone.
--
-- Deleting the profile deletes the credential (cascade), which is what
-- `delete_own_account()` already relies on. Revoking the key on Kalshi is the
-- user's own second lever and is stated in the UI.

create table if not exists public.kalshi_credentials (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  key_id     text not null,
  pem_ct     text not null,   -- base64 AES-256-GCM ciphertext of the PEM
  iv         text not null,   -- base64, 12 random bytes, one per write
  tag        text not null,   -- base64 GCM auth tag
  label      text,            -- optional human name for the key
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kalshi_credentials enable row level security;

-- No policies, and no grants either. The service role bypasses RLS; every
-- other role is refused twice.
revoke all on public.kalshi_credentials from anon;
revoke all on public.kalshi_credentials from authenticated;

drop trigger if exists kalshi_credentials_touch on public.kalshi_credentials;
create trigger kalshi_credentials_touch before update on public.kalshi_credentials
  for each row execute function public.touch_updated_at();

comment on table public.kalshi_credentials is
  'Server-only. AES-256-GCM encrypted Kalshi private keys; RLS denies every client role.';
