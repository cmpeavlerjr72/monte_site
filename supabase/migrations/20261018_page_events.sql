-- FIRST-PARTY TRAFFIC ANALYTICS (owner 2026-10-18). Page views + a few key
-- clicks, so the owner can see which pages/articles get traffic and which
-- sources (reddit, X, tagged posts) send it.
--
-- PRIVACY: no IP address, no name, no email, no user-agent string is stored.
-- `vid` is a random id the browser makes up and keeps in localStorage (one per
-- device); `sid` is a random id per tab session. `country` comes from
-- Cloudflare's CF-IPCountry header (a 2-letter code), read by the server; the
-- IP itself is never written.
--
-- ACCESS: RLS on with NO policies, so anon/authenticated clients can neither
-- read nor write. Rows arrive only through the server (POST /api/t, service
-- role) and are read only by GET /api/me/traffic, which is owner-gated
-- (CFB_PORTAL_OWNERS).

create table if not exists public.page_events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  kind       text not null check (kind in ('view', 'click')),
  path       text not null check (char_length(path) <= 300),
  label      text check (char_length(label) <= 120),          -- click target ('bets', 'kalshi', ...)
  src        text check (char_length(src) <= 60),             -- ?src= tag carried for the session
  ref_host   text check (char_length(ref_host) <= 120),       -- referrer host (reddit.com, t.co, ...)
  vid        text not null check (char_length(vid) <= 40),
  sid        text not null check (char_length(sid) <= 40),
  is_new     boolean not null default false,                  -- first view ever for this vid
  device     text check (device in ('mobile', 'tablet', 'desktop')),
  country    text check (char_length(country) <= 2),
  signed_in  boolean not null default false
);

create index if not exists page_events_ts_idx on public.page_events (ts desc);
create index if not exists page_events_path_ts_idx on public.page_events (path, ts desc);

alter table public.page_events enable row level security;
revoke all on public.page_events from anon, authenticated;

comment on table public.page_events is
  'First-party page views + key clicks (2026-10-18). No IP/PII; written by the server only, read by the owner-gated /api/me/traffic.';
