-- monte-site accounts — FOLLOW-UP to 20260908_accounts.sql. NOT YET APPLIED.
--
-- WHY THIS EXISTS. `feed_items` is a security_invoker view that JOINS picks /
-- app_orders to `profiles` for the handle, display name and avatar. The base
-- tables let a viewer read another user's rows per that user's `share_book`
-- (via can_view_book), but the profiles policy set in the first migration only
-- exposes a profile to (a) itself, (b) an accepted friend, (c) a pending
-- counterpart. So for share_book = 'everyone' the picks row IS readable and the
-- profile row is NOT, the join drops it, and the feed shows nothing.
--
-- MEASURED 2026-09-08 against the live project, two fresh users, not friends,
-- poster on share_book='everyone':
--     B reads A's picks row .............. 1
--     B reads A's profiles row ........... 0
--     B sees it in feed_items ............ 0     <- the bug
-- The friends path is unaffected and already works end to end (request →
-- accept → the pick appears in the friend's feed → unfriend → it disappears).
--
-- THE FIX is one ADDITIVE policy. RLS policies are OR'd, so this widens
-- nothing that can_view_book does not already permit on the picks themselves:
-- a viewer who may read your bets may also read the name printed beside them,
-- which is the whole point of the feed. It does NOT create a user directory —
-- can_view_book returns false for a stranger unless that user deliberately
-- chose 'everyone', and finding someone by name is still find_profile() on an
-- exact handle.
--
-- Owner: review, then run. Nothing in the app breaks without it; the
-- 'everyone' share setting simply behaves like 'friends' until it is applied.

create policy "profiles: read book-visible" on public.profiles
  for select to authenticated
  using (public.can_view_book(auth.uid(), id));
