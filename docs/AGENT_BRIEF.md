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
`node scripts/check_render_loops.mjs` · SSR words-screenshot for UI
changes · no hardcoded colors · report ≤300 words + gate table unless
findings warrant more.

## Token discipline (mandatory)

- `src/pages/Scoreboard.tsx` is ~2,300 lines (~30k tokens). NEVER read it
  whole more than once. Grep for the symbol first, then read ONLY the
  offset range you need. After an Edit, do NOT re-read the file to verify
  — the edit result already confirms it.
- Same rule for any file >500 lines. Prefer Grep + ranged Read everywhere.
- Build/tsc output: tail it, don't dump it.
