-- Let a SIGNED-OUT visitor check whether a username is free (2026-09-08).
-- NOT APPLIED BY THIS REPO — run it in the Supabase SQL editor.
--
-- Sign-up is by USERNAME now, and the sign-up form must be able to say "that
-- one is taken" BEFORE an auth user is created — which happens while nobody
-- is signed in. `find_profile` was granted to `authenticated` only, so the
-- check could not run at the one moment it is needed.
--
-- WHAT THIS EXPOSES, stated plainly: an anonymous caller can test whether an
-- EXACT handle exists and, if it does, see its display name and emoji. That
-- is the same surface the sign-up form already leaks by other means — the
-- Auth address is derived from the handle, so a taken handle is a taken
-- address and sign-up would say so anyway. There is still NO directory: the
-- function matches an exact handle and returns at most one row.

grant execute on function public.find_profile(text) to anon;
