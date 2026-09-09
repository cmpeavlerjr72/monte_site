# Accounts, profiles, friends — the Supabase design (2026-09-08)

Owner decisions (2026-09-08 evening):

1. **New Supabase project** for monte-site (not pickem's). Own identity, own data.
2. **Phase 1 feed = app-placed orders + posted picks.** No user Kalshi keys are
   stored. Each user sets who may see their book: nobody / friends / everyone.
3. **Scoreboard public; features behind sign-in.** Sims, edges and props stay
   readable by anyone; Bets, My Book, profile, friends and the feed require an
   account. New accounts see the feed and can post picks at once; *trading* stays
   with the owner-configured Kalshi accounts until phase 2.

## Security posture

- **Auth = Supabase Auth, email + password** (what pickem ships). Email
  confirmation is OFF (owner 2026-09-08: no custom SMTP sender to maintain) —
  an account is live on sign-up, so the strong-password rule (>= 10 chars) in
  the sign-up form is the bar, and the trading allowlist (`CFB_PORTAL_OWNERS`)
  is what guards money. Magic-link and Google can be added in the dashboard
  later without code changes.
- **The browser holds only the anon key + the user's JWT.** The service-role key
  lives in Render env (`SUPABASE_SERVICE_ROLE_KEY`) and is used by the Express
  server ONLY to (a) verify JWTs, (b) write `app_orders` rows after a placement,
  (c) read allowlists. Never shipped to the client, never logged.
- **Row-level security on every table.** Reads of another user's rows go through
  `friendships` (accepted, either direction) AND that user's `share_book`
  setting. There is no "public list of users": profile search is by exact handle
  through a SECURITY DEFINER function that returns id + display name only.
- **Trading authority is unchanged.** Orders are still placed by the server with
  the owner's env-configured Kalshi accounts. A signed-in user may trade only if
  their `auth.uid()` is named in `CFB_PORTAL_OWNERS` (`mp:<uuid>,roth:<uuid>`) —
  the old password login keeps working for the owner during the cutover and is
  removed once every trading user has an account.
- **Server writes are attributable.** Every `app_orders` row carries `user_id`
  and the portal account id; the JSONL audit stays as the on-box backup.
- **Rate limits** on sign-in are Supabase's; the server keeps its own on
  `/api/portfolio/*` (the existing 5-miss lockout applies per user id now).
- **Deletion**: `delete_own_account()` RPC cascades profile, friendships, picks
  and app_orders rows (Kalshi orders are the exchange's record and are untouched).

## Schema (supabase/migrations/20260908_accounts.sql)

| table | purpose | who can read |
|---|---|---|
| `profiles` | id = auth.users.id, `handle` (unique, 3–20 `[a-z0-9_]`), `display_name`, `avatar_emoji`, `share_book` enum('nobody','friends','everyone'), `is_trader` (server-set), timestamps | own row; friends (accepted); anyone by exact handle via `find_profile(handle)` |
| `friendships` | `requester_id`, `addressee_id`, `status` enum('pending','accepted','blocked'), unique pair | either party |
| `picks` | a posted pick: `user_id`, `game_slug`, `season`, `week`, `market` (spread/total/team_total/ml/prop), `side` text, `line` numeric, `price` numeric (cents as dollars), `note` (<=140), `source` enum('posted','app_order'), `ticker` nullable, `order_id` nullable, `created_at` | own; friends when share_book='friends'; all signed-in when 'everyone' |
| `app_orders` | server-written mirror of every placed order: `user_id`, `account_id`, `ticker`, `side`, `mode`, `price`, `count`, `filled`, `cost`, `order_id`, `state jsonb`, `placed_at` | own; friends/everyone per share_book (via a view `feed_orders` that strips `state`) |

Feed = `feed_items` view: UNION of visible `picks` and `app_orders` for the
viewer, ordered by time, joined to `profiles` for handle/display name. One
query, RLS-filtered.

## Server (server/liveScores.ts)

- `supabaseAuth` middleware: reads `Authorization: Bearer <jwt>`, verifies with
  `@supabase/supabase-js` `auth.getUser(jwt)` (service client), sets `req.user`.
  Cached 60 s per token hash so a busy page does not hammer Auth.
- `/api/portfolio/cfb*` accepts EITHER the legacy `x-cfb-token` password (owner
  cutover) OR a verified user whose uid is in `CFB_PORTAL_OWNERS` for that
  account. Both resolve to the same `PortalAccount`.
- After every successful placement, `ordersAudit` ALSO upserts an `app_orders`
  row (service client). Failure to write Supabase never fails the placement —
  logged, retried once, audit line still written.
- New: `POST /api/me/picks` is NOT needed — picks are written by the client
  directly to Supabase under RLS. The server only writes `app_orders`.

## Client (src/)

- `src/lib/supabase.ts` — anon client (env `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`), `useSession()` hook.
- `src/components/AuthPanel.tsx` — sign in / sign up / reset; handle + display
  name on first sign-in (profile row insert).
- `src/pages/Profile.tsx` (`/me`) — edit profile, share_book, delete account.
- `src/pages/Friends.tsx` (`/friends`) — search by handle, request, accept,
  block; pending list.
- `src/components/NetworkFeed.tsx` — "What your network is on": friends' picks
  and app orders, grouped by game, newest first; a "Post a pick" form on every
  game card (prefilled from the row the user is looking at).
- Gating: Bets panel / My Book / feed render an AuthPanel prompt when signed
  out; Scoreboard, Top Edges, props stay public.
- The existing Friend Feed (env-paired Kalshi books) is retired once the owner's
  accounts are linked to user ids — same UI slot, new source.

## Env

Render (server): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CFB_PORTAL_OWNERS`.
Build (client): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Phase 2 — BUILT 2026-09-08 (per-user Kalshi linking)

Shipped as described, with node crypto rather than pgsodium: the PEM is
AES-256-GCM under `KALSHI_CRED_SECRET` in `kalshi_credentials`, a table with
RLS on and no policies (service role only). `POST /api/me/kalshi` proves the
pair against `/portfolio/balance` before storing anything and sets
`is_trader`; the portal gate resolves a linked user to `u:<uid>` with every
existing rail, and `CFB_ORDERS_LIVE_USERS` is the one switch that takes those
users off dry run. `CFB_PORTAL_OWNERS` still wins for the owner's uids.

The feed does NOT show a linked user's real book, and that is now a rule
rather than a phase: see below.

## Owner rules added 2026-09-08 (evening)

1. **Login is a username.** The auth address is derived from the handle
   (`<handle>@mvpeav.com`); a real email is optional, lives on
   `profiles.email`, and is never a credential. No reset UI — no sender exists.
2. **One ribbon control** is the entry point to accounts on every page.
3. **The scoreboard is a bets menu**; everything about the person lives on the
   `/cfb/mybook` dashboard (positions, Kalshi linking, friends, feed,
   settings). `/cfb/friends` redirects there.
4. **A friend never sees another user's money.** Units of the poster's own
   unit, plus the market price — never counts, costs, fills or dollars. The
   unit size itself is a private column reachable only through
   `my_settings()` / `set_my_settings()`.

## Owner changes 2026-09-09

1. **The feed is AUTOMATIC.** The "post a pick" form is removed. Every order
   placed through the app appears in the poster's friends' feeds, because
   `app_orders` is already written server-side on placement. `picks` is left
   alone (no new writes; existing rows still render).
2. **A feed line is a sentence**: "{username} placed {x} units on {bet} at
   {price}¢ · sim EV {ev} per $1". To print it, `app_orders` gained
   `title`, `home_team`, `away_team`, `sim_p`, `ev_fee` and `sport`
   (`supabase/migrations/20260909_feed_detail.sql`), threaded from ConfirmSlip
   through `placeOrders` to `appOrdersRecord` as optional, sanitised
   attribution that never reaches Kalshi. The money rule is unchanged: units
   and the market price, never a count, a cost or a fill.
3. **Live updates** via Realtime `postgres_changes` on `public.app_orders`
   INSERT, 60s poll fallback. RLS applies to realtime; the client refetches
   `feed_items` on each event rather than trusting the payload.
4. **Flares** (`20260909_flares.sql`): up to three school logos beside a
   username, `profiles.flares text[]`, `team:<school>` for any FBS or FCS
   school. Cosmetic and public within the friend graph — a flare says nothing
   about money. Editor on `/me`; rendered in the feed and the friends list.
5. **Three account destinations, at the TOP level** (an account is
   sport-agnostic — NCAAB lands on the same login, book and friends):
   `/mybook` = the book only, `/feed` = the social feed, `/me` = everything
   about the person. `/cfb/mybook`, `/cfb/feed`, `/cfb/me` and `/cfb/friends`
   redirect up. Ribbon menu: My Book · Feed · Profile · Log out. Scoreboards
   stay under `/cfb` and `/cbb`, and the scoreboard's slim book strip is
   unchanged.
