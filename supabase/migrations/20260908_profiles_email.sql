-- Optional real contact email on the profile (owner decision 2026-09-08).
-- NOT APPLIED BY THIS REPO — run it in the Supabase SQL editor. It is a new
-- file on purpose: 20260908_accounts.sql is applied and is never edited.
--
-- WHY THE COLUMN EXISTS. Login is by USERNAME now. The Supabase Auth address
-- is DERIVED from the handle (`<handle>@users.mvpeav.com`, lower-case) and is
-- a routing artefact, not a mailbox: this project has no SMTP sender, email
-- confirmation is OFF, and no password-reset mail can be sent. So a REAL
-- address is optional, lives here, and is only for the owner to reach a user
-- (or reset a password by hand). Nothing signs in with it, nothing is sent to
-- it by the app, and it is never required.
--
-- VISIBILITY, stated plainly: the policies in 20260908_accounts.sql are
-- ROW-level, so a profile row readable by an accepted friend carries this
-- column too. That is why the field is optional and why the form says it is
-- optional.

alter table public.profiles
  add column if not exists email text
  check (
    email is null
    or (char_length(email) between 3 and 254 and email like '%@%')
  );

comment on column public.profiles.email is
  'Optional real contact address. NOT the auth login (that is derived from the handle) and never a credential.';
