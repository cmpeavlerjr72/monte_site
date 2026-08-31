# Multi-account roadmap — 5-10 self-directed traders

Owner decision context (2026-08-31): the app should eventually serve 5-10
people making their own Kalshi trades. This doc is the agreed long-term
strategy; the multi-account portal shipped 2026-08-31 (commits 4fbdd4d,
e8d1c31) is Phase 1's foundation.

## The invariant that never changes

**Self-directed, forever.** Every user has their own Kalshi account in their
own name (Kalshi does the KYC), their own API key, their own money, and
presses their own Confirm. No pooled funds, no discretion over anyone else's
account, no charging for access to suggestions. Kalshi is CFTC-regulated:
pooling/discretion/paid-advice each turn this from a tool into a regulated
activity. If it ever becomes a paid product for strangers: lawyer first, and
ask Kalshi about API/partner terms. Bounding fact: the trade API cannot
withdraw funds — a mishandled key can trade, never drain.

Architecture corollary: ONE `portalGate()` choke point, and everything
downstream keyed by account (caches, audit, idempotency, attribution, push).
Cross-account isolation is a review gate (see AGENT_BRIEF §My-Kalshi portal);
worth an automated isolation test once users who don't know each other are on.

## Phase 1 — env registry, to ~5 users (CURRENT)

Onboarding runbook (~10 min/user):
1. User opens their own Kalshi account, generates their own API key.
2. Sends key ID + PEM over a reasonable channel (not SMS/email ideally).
3. Owner adds 4 Render entries: Secret File `kalshi_<name>.pem`,
   `KALSHI_API_KEY_ID_<SFX>`, `KALSHI_PRIVATE_KEY_PATH_<SFX>`,
   `CFB_PORTAL_PASSWORD_<SFX>`. Account lands STAGED (dry-run) by design.
4. First slate: user places dry-runs, owner eyeballs the audit log, then sets
   `CFB_ORDERS_LIVE_<SFX>=1`. Going live is its own deliberate env change.

Hardening owed before ~user #4:
- [ ] Per-password lockout (today 5 misses lock ALL users 60s — one
      fat-fingering friend DoSes everyone).
- [ ] Raise `PUSH_SUBS_MAX` (20 today).
- [ ] Persistent disk (or DB) for the orders audit JSONL + push subs — wiped
      per deploy today; at 10 users that's attribution lying, not a quirk.

## Phase 2 — Supabase registry + admin console (~5+ users)

Supabase is already in the stack (pickem). Move the registry to an
`accounts` table: label, password hash, key ID, PEM encrypted with ONE
master key (the only secret left in Render env), live flag, per-account caps.
Buys three things env vars can't do:
- **Self-service key paste**: portal page where a user pastes their own key
  ID + PEM once; server encrypts at rest. Owner never handles keys again
  (better custody, not just less work).
- **Admin console** (owner-gated): all books/records on one screen,
  per-account stage/live toggles, per-account caps set by the OWNER (not the
  device unit slider — with 10 users of varying sophistication the ceiling is
  assigned, not chosen), and a cross-account kill switch (today cancel-all
  only reaches the session's own account).
- **Hot reload**: add/disable accounts without a service restart.

## Phase 3 — only if it becomes a real product

Real auth (Supabase Auth: per-user sessions, reset flows), rate limiting per
user, legal/compliance pass, Kalshi's blessing for a consumer-facing
third-party front end. Not planned; documented so the line is visible.
