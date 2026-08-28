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

LIVE data (2026-08-27): the live scoreboard is BROWSER-DIRECT from ESPN
(`useLiveScoreboard` polls per group — 80 and 81 separately, merged by event
id — because ESPN's multi-group query returns id-less stub events whenever
one group has no games, and ESPN's Akamai edge blocks the Render egress IP
outright: every server-mediated path 502s while browsers are fine). The
server /api/scoreboard is fallback only. The poll is keyed on the SLATE's
kick dates, never the wall-clock date (2026-08-28: polling "today" made
every finished slate — finals, provisional grading, gamecasts — vanish at
midnight ET; ESPN serves past scoreboard dates indefinitely, verified back
through 2025). Multi-day slates use ESPN's range syntax, whose END is
EXCLUSIVE (the hook pads +1 day — dropping that pad silently kills the last
slate day's live coverage). Cadence is adaptive: 20s in-game, 60s pregame,
a single fetch once every event is final. LAST-RESORT tier for networks
that block espn.com (many offices/schools): published ESPN snapshots on the
season dataset — `espn/scoreboard/<date>.json` (merged 80+81) and
`espn/gamecast/<eventId>.json` ({summary, probabilities}, FINAL games only)
— written by the sim repo's `publish_espn_snapshots.py` and served
SAME-ORIGIN via /api/data. `useLiveScoreboard` and the espnGame hooks fall
back to them; tier rule: an answer with zero id-bearing events never masks
a later tier that has real events (a stale server proxy taught us that).
Run the publisher one-shot after every slate (finals are immutable) or with
--loop on game day for delayed-live on blocked networks. Per-game gamecast (field strip on
live cards, Live panel: drive field, win/cover/over% chart, drive log) lives
in `src/components/LiveGamecast.tsx` + `src/lib/espnGame.ts`; the sim↔live
join indexes EVERY ESPN name form (shortDisplayName alone matched 27/46 FCS
games). Harness: hidden route `/test-gamecast?event=<espn id>`. ESPN yard
lines are ABSOLUTE 0–100, home goal line = 0.

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
- `team_stats.json` — per-game TEAM box-stat distributions, keyed by our
  game slug then by team name (both VERBATIM from that week's index).
  Each stat carries `{mean, median, q10, q90, rungs:{K: P(stat>K)}}`; a
  stat the sim cannot produce (`fg_made`, `turnovers_forced`) is null
  with a `reason`. File-level `definitions` + `caveats` carry the
  settlement fine print (team receiving yards == GROSS passing yards;
  sack yardage is negative QB rushing and a rush attempt;
  `td_offensive` is rush+rec only and is a FLOOR for Kalshi's team-TD
  market, whose wording does not exclude defensive/return TDs; Kalshi
  counts OT1/OT2 only and never 2-pt conversions). Published by
  cfb-props-sim `export_team_stats.py`; built from the PLAYER sweep, so
  the FCS namespace 404s forever = expected "not published" state
  (`TeamStatsNotPublished`). The "Team Stats" panel draws each stat as a
  MIRRORED DENSITY on ONE continuous axis — teamA's distribution above
  the line, teamB's below — with live Kalshi markets as flags on the
  line. This shape was chosen against a stated bar: readable "to
  someone who has had a beer or two at a bar". Three rules follow from
  it and must not be undone: (1) NO number pairs at rest anywhere — no
  bid–ask, no q10–q90; a flag shows only the strike in Kalshi's own
  wording ("150+", `Math.ceil` of the half-integer floor) and the
  VERDICT, the edge in cents. Everything else lives in the tap popover,
  written in words ("TCU 225+ receiving yards — Sim: 63% · Kalshi: 52¢
  · Edge: +11¢"), tap targets >=40px. (2) ONE axis per stat, drawn
  unbroken and last so it sits on top. (3) A words legend at the top
  says which numbers are whose, once. Flag labels sit entirely OUTSIDE
  the silhouette (only the stem crosses it), chips stagger into up to 3
  rows when strikes crowd, and a chip-less flag (no actionable edge)
  keeps a short stub and claims no stagger row. Density is
  adjacent-rung SUBTRACTION — P(>K_i) − P(>K_i+1) over bin width — never
  a kernel; small-integer counts (TDs, sacks, INTs) draw as discrete
  bars on an axis starting at −0.5, because a smooth curve over 0,1,2,3
  would misstate what the sim produced.
  PRICES ARE LIVE, never a published snapshot: the panel is meant to
  become a trading surface, so it reads `/api/kalshi/cfb` (45s TTL,
  bulk series paging — `KALSHI_STAT_SERIES` in `server/liveScores.ts`
  adds the KXNCAAFTEAM* families, one `/markets` call per series per
  window; NEVER add per-market calls, that is what the 2026-08-26
  shared-IP 429 punished). The server resolves each quote to our stat
  key and to this game's A/B side, so the client does no name join. SIM
  values stay from the published weekly file — weekly by design, not
  staleness — so there is no "as of" stamp, only a live dot. The
  client's ONLY arithmetic is the midpoint and `sim − mid`; quality
  suppression is the live equivalent of THIN/TAIL/NOISE and lives in
  `src/lib/kalshi.ts` (`statBookQuality`): no edge badge when the book
  is one-sided, wider than 30c, or the sim sits outside 5–95%. Price
  may still show; the edge may not. `KXNCAAFTEAMTD`/`FG`/`TO` are
  excluded server-side AND in the sim repo's publisher — team-TD counts
  defensive/return scores we do not simulate (ours is a FLOOR), FG and
  turnovers are not simulated at all. `team_markets.json` is now only
  the RANKED Top Edges feed (daily republish is sufficient; it no
  longer feeds this panel). School brand hexes FAIL
  `validate_palette.js` as marks (UNC #7bafd4 is 2.29:1 on light, TCU
  #4d1979 is 1.44:1 on dark), so brand color fills the silhouette only
  — every stroke, label and the axis wear theme tokens, `--pos`/`--neg`
  appear only on a signed edge chip, and the numeric table view is one
  toggle away as the relief the validator requires.

## My-Kalshi portal (owner-only)

`/api/portfolio/cfb` (server) — password-gated (`x-cfb-token` header vs
`CFB_PORTAL_PASSWORD` env — owner-chosen password, `CFB_PORTFOLIO_TOKEN`
alias kept; timing-safe; 5 consecutive misses = 60s lockout (429) because
a human password is guessable where a token was not; 503 when
unconfigured), signed
Kalshi portfolio reads via env creds (`KALSHI_API_KEY_ID` +
`KALSHI_PRIVATE_KEY_PATH` — production pattern is a host Secret File,
`KALSHI_PRIVATE_KEY_PATH=/etc/secrets/kalshi.pem`; inline
`KALSHI_PRIVATE_KEY` is a fallback that mangles newlines on some hosts).
Returns NCAAF
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
