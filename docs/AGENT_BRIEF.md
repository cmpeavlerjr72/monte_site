# Agent brief — cfb-sim-explorer

Read this before touching the scoreboard. It replaces inheriting a prior
agent's transcript. Keep it current: if you change a contract below, update
this file in the same commit.

## Architecture

React 19 + Vite + TS SPA (`src/`), Express data/live server (`server/
liveScores.ts`, PORT 8080, compiled `server/dist/liveScores.js` is TRACKED —
the Render host runs the committed JS; rebuild `npx tsc` in server/ and
commit it or server changes are inert). Deploys on push to main (Render).
Data lives on HuggingFace datasets, fetched at runtime through
`/api/data/<repo>/<path>` (allowlists in liveScores.ts) with a direct-Hub
fallback. NOTHING bundles data into the frontend.

## Divisions (FBS + FCS)

FCS is a **separate dataset with an identical layout**, addressed by the
namespace `fcs-<year>` (repo `cfb-sims-fcs-2026`, root dir `fcs-2026`). The
fetch layer needed no changes: `Season` is a string NAMESPACE, so
`repoForSeason`/`dataUrl`/`getJsonWeek*` all resolve from it.

- FCS is **not a season**. It is never in `SEASONS` (that array feeds the
  season picker AND `resolveLatestSeason`). Division is its own axis and
  travels with each CARD (`CardGame.ns` / `.division`).
- Every per-card fetch uses **`card.ns`, not the page's `season`** — a merged
  "Both" slate holds cards from two datasets at once.
- FCS card keys are prefixed (`fcs:<slug>`); FBS keeps the bare slug so
  slug-keyed joins (props_odds.json) are untouched. The Kalshi map is re-keyed
  to match. Nothing promises the two slug spaces are disjoint.
- FCS is game-level only: `has_players:false`, no players/props files. UI
  branches on the FLAG, not on the 404.
- A missing FCS week/dataset is the EXPECTED pre-publish state → quiet empty
  state, never `setWeekError`. "Both" degrades to FBS-only.
- Kalshi joins by normalized team-name pair via `server/cfbNames.ts` (pure, so
  it is unit-checked). Kalshi's "Youngstown St." already matched our
  "Youngstown State" via the existing `\bst\.?\b` rule. Parentheticals are
  deliberately NOT stripped — that would merge "Miami (OH)" into "Miami".

## Data contracts (HF: mvpeav/cfb-sims-2026, mirrored shape for 2025)

`<season>/season_index.json` → weeks list. Per week `weeks/weekNN/`:
- `index.json` (2026) or `games/index.json` (2025) — game rows w/ slug,
  teamA=HOME, teamB=AWAY, and per-game paths (summary/compact/players/
  players_dist/seeds). Dual-probe both index locations (`cfbJson.ts`).
- `summary.json` — medians/means (margin = home−away), win prob, nsims,
  odds block (spread home-perspective, negative = home favored).
- `compact.json` — per-seed A_pts/B_pts arrays + quantiles.
- `players_dist.json` — per player per stat sparse PMF {int→count},
  mass == nsims (DNP seeds zero-filled). Player keys VERBATIM sim strings.
- `seeds.json` — seed-aligned columnar arrays ("player|stat" keys) for
  parlay joints; index i = same simulated game across ALL arrays.
- `props_odds.json` — single-book (top-level "book"), one row per
  (player, stat): line, fair_over (de-vig), best_over/under prices.
- `team_markets.json` — Kalshi NCAAF team-stat/period markets (team
  totals, 1H/2H winner-spread-total, half/fulltime, OT), one flat
  `records[]` sorted ev_fee desc; `slug` is already OUR game slug,
  `title` states the YES event, `side` names the favored contract,
  `sim_p` = P(YES) (flip when side=NO). FBS-only: the FCS namespace
  404s forever = expected "missing" state (`TeamMarketsNotPublished`).
  Published by cfb-props-sim `kalshi_team_edges.py --publish`.
  SITE RULE (user 2026-08-26): rows flagged THIN/TAIL/NOISE are never
  surfaced as edges — filtered in `edges.ts` (math layer, like rule 5);
  the column footer reports the hidden count. Rows render compact
  bet-style titles ("USC 1H ML", "UNLV u19.5 TT"), oriented to the
  recommended side where the complement is exact (totals/spreads/OT).

## My-Kalshi portal (owner-only)

`/api/portfolio/cfb` (server) — token-gated (`x-cfb-token` vs
`CFB_PORTFOLIO_TOKEN` env, timing-safe; 503 when unconfigured), signed
Kalshi portfolio reads via env creds (`KALSHI_API_KEY_ID` +
`KALSHI_PRIVATE_KEY` inline or `KALSHI_PRIVATE_KEY_PATH`). Returns NCAAF
resting orders, fills, and positions (positions = ground truth for held
contracts; fills CANNOT be signed-summed — a NO buy logs as a YES-book
"sell"). This API tier speaks fp/dollar STRINGS (count_fp,
yes_price_dollars, fee_cost). Client: `src/lib/kalshiPortal.ts` (poll
30s keyed on token only), ticker→card join via the event-ticker game-code
segment against kalshiBySlug — never a second name join. Scoreboard pins
games with a book and badges them (`MyBookStrip`). Historical note: the
old "no credentials anywhere in this repo" stance was deliberately
amended 2026-08-26 (env-only, never code). This route family is where
order entry would live; the auth gate must ALWAYS predate any mutating
endpoint.

## Hard-won rules (each cost a real incident)

1. NEVER retype player/team names — build keys from the data verbatim
   ("Billy Edwards Jr." has a period). Team joins via nameKey
   (ascii/lower/strip) + alias maps only where designed.
2. median(A)+median(B) ≠ median(total): header/team numbers come from
   summary.json fields, never from summing component medians.
3. Fetches of week data use `cache: "no-store"` (browser held stale files
   15 min without it).
4. Effects must not depend on object identities that their own setState
   recreates — run `node scripts/check_render_loops.mjs` (MANDATORY gate)
   before committing effect/memo changes; it documents the freeze bug.
5. Zero-stat PMFs (all mass at 0) are filtered in the MATH layer
   (`propEdge.ts`) — never surface them as edges.
6. Panels open as full-width break-out rows (cards never resize);
   `useSlateEdges` signature rules are enforced by the loop guard.
7. Theme: tokens only (`--pos/--neg/--brand/--brand-text/...`), AA in both
   themes; team-identity hex is the only allowed literal color.
8. Kalshi: `/api/kalshi/cfb` (no credentials, public endpoints, bulk
   series paging, 25-75c rung filter picks the LINE, ladders for
   at-book-line pricing, 45s TTL).

## Gates for every change

`npx tsc` (app AND server if touched) · `npm run build` ·
`node scripts/check_render_loops.mjs` (effects/memos) ·
`node scripts/check_fcs_names.mjs` (server/cfbNames.ts or team_info.csv;
needs a fresh server/dist) · `node scripts/check_fcs_slate.mjs` (FCS wiring,
namespaces, empty states, logo assets) · SSR words-screenshot for UI
changes · no hardcoded colors · report ≤300 words + gate table unless
findings warrant more.

The two `check_fcs_*` scripts run the SHIPPED code (compiled server module /
the real `.ts` loaders under node's type stripping) against fixtures, so they
fail if you skip the `server/` dist rebuild.

## Token discipline (mandatory)

- `src/pages/Scoreboard.tsx` is ~2,300 lines (~30k tokens). NEVER read it
  whole more than once. Grep for the symbol first, then read ONLY the
  offset range you need. After an Edit, do NOT re-read the file to verify
  — the edit result already confirms it.
- Same rule for any file >500 lines. Prefer Grep + ranged Read everywhere.
- Build/tsc output: tail it, don't dump it.
