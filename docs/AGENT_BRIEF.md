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
  MOBILE: the chart FITS its container at every width and never scrolls
  horizontally (the table view keeps the scroll box). Layout is
  MEASURED — a callback ref + ResizeObserver feeding `layoutFor(width)`
  — deliberately NOT a scaling viewBox, which at 375px in a 900px design
  is a 0.42 factor that would render 9px labels at 3.8px. Fonts are
  fixed; DENSITY is what gives: under 560px the gutter shrinks, and each
  team keeps at most 4 chips per stat, ranked by |edge| so the markets
  that survive are the ones worth acting on. Everything else stays a
  bare tappable stub (>=40px hit rect, strike text suppressed at narrow
  widths because 25-yard strikes land ~16px apart there); the popover
  still carries its full verdict. Use a CALLBACK ref, never
  `useLayoutEffect` + `[]`: the chart container does not exist on first
  render (the panel is showing "Loading…"), so a one-shot effect finds
  null and silently leaves the layout at the desktop default — that was
  the actual bug.

## Server health and Kalshi resilience

`/api/health` reports the DEPLOYED commit (`RENDER_GIT_COMMIT`), branch,
service and process start. Added 2026-08-28 after identifying the live
build took rebuilding candidate commits and diffing minified bundle
hashes — and still only narrowed it to two. Check this route first when
asking "did my deploy land?"; a stale `started` also exposes a stalled
deploy.

The Kalshi stat-series fan-out (13 series, was 3) uses
`Promise.allSettled`, NOT `Promise.all`: one series that 429s or times
out costs only its own stat family, is logged, and is named in the
payload's `degraded_series`. `/api/kalshi/cfb` is also STALE-IF-ERROR —
on a build failure it serves the last good payload flagged `stale`
rather than blanking every price on the page. Never revert either to a
plain `Promise.all` / empty-on-error: the 2026-08-26 incident was
expensive because the failure was invisible.

## Suggested bets (owner-only) — and the app's order entry

`src/components/SuggestedBets.tsx` + `src/lib/suggestedBets.ts` +
`src/lib/placeOrders.ts`. Rendered only while the portal session is `ok` —
the same state that powers MyBookStrip.

The FBS maker pipeline (`scripts/fbs_maker_pipeline.py` in cfb-props-sim)
remains the AUTOMATED placement authority and stays POST-ONLY-ONLY. This
card mirrors its SELECTION constants by name (take 0.06, rest 0.03, margin
0.05, min price 0.03, max spread 0.30, sim 0.05–0.95, prefer 0.35–0.65, 2
rungs per ladder / 1 per winner, $30 per ladder). If the two disagree on
selection the pipeline is right and this file is the bug.

Since 2026-08-28 the card also PLACES, via the endpoints below. The card
starts COLLAPSED (header = "Suggested bets (N) · computed HH:MM:SS" +
chevron; the state persists in try/catch'd localStorage under
`cfb.suggestedBets.open`). Every row gets a **Place** button — a grouped
ladder places all its rungs as ONE request behind ONE confirm — and the
kill switch sits in the card header in BOTH states, on purpose: a control
that pulls resting money must not hide behind a collapsed panel.

The confirm popup is the bar-test pattern: the bet in words, a mode chip,
contracts, stake + fee + total, net edge, "prices as of HH:MM:SS ·
re-verified against the live book at placement", then Confirm/Cancel. It
wears an unmissable DRY RUN badge in `--accent` — never `--pos`/`--neg`,
which on this card mean one thing only (the sign of an edge); a staged
order must not read as a bad bet. The badge is known BEFORE the press
because the portal payload carries `orders_live`.

- ZERO new Kalshi load: the compute is a pure function of the quotes
  already flowing through the page's 45s `/api/kalshi/cfb` poll, so it is
  live for free. "Refresh" re-runs the compute only — never a fetch, never
  orderbook depth, never a per-market fan-out.
- PREGAME ONLY, a correctness rule: sim fairs are pregame distributions,
  so a live or final game must never yield a suggestion. Gated on the live
  state AND the kick time, because the feed can lag a kickoff by a poll
  and that is exactly when a stale edge looks best.
- Markets the account already holds or is resting on are skipped, joined
  by ticker against the portal payload (the payload now carries `ticker`
  on stat quotes and ladder rungs for this).
- FEES ARE NEVER GROSS. Every displayed edge is net of the fee for that
  row's mode at that row's price, and the tap popover itemizes it. Fee
  params come from KALSHI'S OWN per-series metadata (`fee_params` in the
  proxy payload, 6h TTL), never hardcoded: checked 2026-08-28, every
  per-team family is `fee_type: "quadratic"` — TAKER FEES ONLY, resting is
  FREE — while the game lines are `quadratic_with_maker_fees`. A blanket
  maker = taker/4 overstates the cost of exactly the markets this site
  quotes. The constants are the fallback for a failed lookup, and the
  fallback assumes maker-charging because an overstated fee costs a
  marginal bet while an understated one invents an edge.
- Sizing spends the fee: $30 per ladder is TOTAL OUTLAY
  (price x count + fee), with the fee rounded UP to the cent per order the
  way the exchange charges it. The pipeline was corrected to match in the
  same change — one convention, both places.
- Sim fairs are the published `team_stats.json` rungs read VERBATIM; a
  strike off the grid simply has no bet. The client never recomputes a
  distribution, only subtracts and compares.

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
amended 2026-08-26 (env-only, never code). The gate is `portalGate()` —
ONE implementation, called first by every route in this family, reads and
writes alike. It was extracted from the read route when order entry landed
so a mutating endpoint could not drift away from it. The auth gate must
ALWAYS predate any mutating endpoint.

### Order entry (2026-08-28) — the family's first MUTATING routes

    POST /api/portfolio/cfb/orders          place 1..N limit orders
    POST /api/portfolio/cfb/orders/cancel   {order_id} | {all:true}

Body: `{idempotency_key, orders:[{ticker, side:"yes"|"no",
mode:"rest"|"take", price_dollars, count_fp}]}`.

**Execution policy (user decision 2026-08-28).** AUTOMATED flows remain
post-only-only — the maker pipeline and `kalshi_client_min.py` have no
taker code path and must not grow one. HUMAN-CONFIRMED app orders MAY
take, bounded by the confirmed limit price. The client sends INTENT
(`mode`) and the SERVER derives the mechanics:

| mode   | post_only | time_in_force        | meaning |
|--------|-----------|----------------------|---------|
| `rest` | true      | good_till_canceled   | cannot cross; exchange kills it rather than filling taker |
| `take` | false     | immediate_or_cancel  | LIMIT order at the confirmed price — fills at that price or better, never worse |

There is NO market-order path and there must never be one. `post_only`,
`type`, `time_in_force`, `buy_max_cost` &c. are REJECTED if sent, so taker
semantics are reachable only through the declared mode.
`immediate_or_cancel` is documented on Kalshi's order-create surface, but
the V2 endpoint we post to has silently ignored a field before
(`expiration_ts`, probed 2026-08-26) — so a take order is READ BACK after
placement and the response reports what actually happened, including a
remainder that rested. A 400 that names the TIF downgrades to GTC once and
flags `tif_downgraded` (a 400 is a validation rejection, so nothing was
placed and the retry cannot double up).

**Rails, all server-side, all in `server/liveScores.ts`:**

1. `portalGate` (timing-safe password, 5 misses = 60s lockout).
2. NCAAF tickers only (`ORDERS_TICKER_RE`) — the app cannot reach any
   other market.
3. Mode-derived post_only/TIF + a strict field allowlist; never a market
   order.
4. Per-order cost cap **$40** (price x count + fee).
5. Per-request cap **$80**, at most 8 orders.
6. Rolling 24h cap **$400** — IN-MEMORY, so a Render restart resets it.
   Stated honestly rather than hidden: it throttles a runaway loop within
   one process lifetime, it is not an accounting system.
7. Live orderbook re-read per ticker immediately before signing. `rest`
   rejects if the price would CROSS; `take` rejects if the ask is WORSE
   than the confirmed price. Either returns the FRESH book so the client
   can say "book moved: ask now 0.52" and the human reconfirms.
8. Idempotency: a replayed key returns the ORIGINAL result, never a second
   placement; a key in flight gets 409. The client mints one key per
   confirm press, so a phone double-tap cannot place twice.
9. `client_order_id = "cfbapp-<key>-<i>"` — attributable, and the maker
   pipeline's status tools skip these.
10. Every request/response appended to a JSONL audit log AND
    `console.log`'d (Render's disk is ephemeral; the log stream is not).
    Path: `CFB_ORDERS_AUDIT_PATH`, default `os.tmpdir()`.
11. **DRY-RUN STAGED.** Unless `CFB_ORDERS_LIVE === "1"` the endpoint does
    everything — auth, validation, caps, live book re-check, idempotency,
    audit log — and submits NOTHING, answering `{dry_run:true,
    would_place:[…]}`. Going live is ONE env var in Render, no code
    change and no deploy. **No agent ever sets that variable, anywhere,
    including local tests.**

The cancel route is deliberately NOT gated on `CFB_ORDERS_LIVE`:
cancelling only ever REDUCES exposure, and a kill switch staged off is not
a kill switch. It can still only reach `cfbapp-`-tagged resting orders, so
the maker pipeline's own book is untouchable from here.

Testing this family: run the server on a FREE port (never 8080) with
`CFB_PORTAL_PASSWORD` set locally and Kalshi creds ABSENT. The dry-run path
is then fully exercisable — the live-book re-check uses the PUBLIC
orderbook GET, so it works credential-free, while the signing path is
simply never reached. NEVER place a live order.

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

## Installable app (PWA)

The site installs to a phone home screen: `public/manifest.webmanifest`
(name MVPEAV, `start_url` /cfb/scoreboard, standalone, navy `#0b2d4b`),
`public/icons/*` (192/512/512-maskable/180 apple-touch, regenerate with
`node scripts/make_pwa_icons.mjs` if the brand asset changes), and the iOS
meta + `viewport-fit=cover` in `index.html`. Because the status bar is
`black-translucent`, the header's `env(safe-area-inset-*)` padding in
`src/index.css` is load-bearing — drop it and the notch eats the nav.

`src/sw.ts` (vite-plugin-pwa, `injectManifest`) is an APP-SHELL worker and
must stay one. Rule 3 above has to hold in EFFECT, not just at the call
site, so:

- The ONLY registered routes are workbox's precache route (hashed
  `assets/*` + `index.html`, 4 entries) and a network-first navigation
  route. Everything else — `/api/*`, ESPN, HuggingFace, Kalshi — matches
  nothing, so the router never calls `respondWith` and the browser fetches
  normally. NEVER add `setDefaultHandler` or runtime caching for any
  origin, and never precache `public/logos|data|duckdb` (8MB of it, and it
  is DATA).
- `skipWaiting` + `clientsClaim` + network-first navigations: a Render
  deploy must be live on the next launch. A pinned worker serving last
  week's numbers is a data bug, not a cosmetic one. Registration is
  hand-written in `src/lib/pwa.ts` (`injectRegister: false`) and reloads
  only on a REPLACEMENT controller, never on the first claim.
- `src/components/InstallPrompt.tsx` shows an install bar only where an
  install can happen: Chromium's `beforeinstallprompt`, or iOS (which has
  no install API in ANY browser — every engine there is WebKit — so it
  gets the Share → Add to Home Screen guide instead). Hidden when already
  standalone, and a dismissal sticks in localStorage.
- The `beforeinstallprompt` listener MUST stay at module scope in
  `src/lib/pwa.ts`, never in a component effect. Chrome fires it once,
  before React mounts (measured here: listener 77ms, mount 110ms, event
  262ms) — an effect-registered listener misses it, the button never
  appears, and Chrome's mini-infobar shows instead. The component
  subscribes to the stash via `useSyncExternalStore`.

Verifying a SW change means serving `dist` and checking, in a real browser:
the page is controlled on second load, `/api` appears in no cache, the
shell renders with the data hosts blackholed, and a rebuild flips the
precached bundle hash on the controlled client.

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
