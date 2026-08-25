# Season data pipeline

Sim data does **not** live in the frontend. `src/data` used to hold the 2025 season
(882 MB), which Vite pulled into the bundle and made `dist` ~900 MB. It now lives in a
compressed local archive plus a Hugging Face dataset, fetched at runtime.

## End-of-season: archive a finished season

```bash
# 1. Restage: messy week folders -> gzipped archive + clean upload staging tree
python archive_season.py --src ../src/data --sport cfb --season 2025

# 2. Prove nothing was lost (hashes every source file against the archive)
python archive_season.py --sport cfb --season 2025 --verify

# 3. Publish, then verify the upload is complete
python upload_dataset.py --sport cfb --season 2025

# 4. Only after 2 and 3 both pass, delete the source and the staging tree.
#    NOTE: the staging tree is hardlinked to the source, so you must delete BOTH
#    to actually reclaim disk space.
```

Layout produced:

```
<datastorage>/cfb/2025/weekNN/scores/<slug>.csv.gz     # ~10x smaller than raw
<datastorage>/cfb/2025/weekNN/players/<slug>.csv.gz
<datastorage>/cfb/2025/weekNN/{games,open}.csv, index.json
<datastorage>/cfb/2025/season_index.json
```

The Hub copy adds `scores_bundle.csv` per week — every game's score sims in one file,
so season-wide pages make ~17 requests instead of ~800. Player sims stay per-game and
are fetched only when someone opens a specific matchup.

**Do not pre-gzip files for upload.** Hugging Face already serves them gzipped
(a 1.35 MB bundle transfers as ~151 KB); double-compressing just breaks caching.

## Recovering data

```bash
python restore_from_archive.py --season 2025 --week 5 --out C:\tmp\wk5   # one week
python restore_from_archive.py --season 2025 --as-stage                  # rebuild upload tree
```

Restored files are byte-identical to the originals.

## Logos

```bash
python fetch_logos.py
```

Downloads ESPN team logos once into `public/logos/<espnId>.webp` (+ `-dark`, plus
`mlb/`) and snapshots ESPN's teams list to `public/logos/teams-cbb.json`. Re-run when
teams change (new FBS members, rebrands). Self-hosting matters because many school and
office networks block `espncdn.com` and `huggingface.co`.

## Serving

`server/liveScores.ts` exposes `/api/data/<repo>/<path>` which proxies
`huggingface.co/datasets/mvpeav/<repo>/resolve/main/<path>`. Repos are allowlisted in
`HF_ARCHIVE_REPOS` (cached forever) and `HF_LIVE_REPOS` (5 min). **Add new season repos
to one of those sets**, or the frontend gets a 404.

### Running locally

Vite proxies `/api` to `localhost:8080`, so the data server must be running in dev:

```bash
cd server && npx tsc && node dist/liveScores.js   # terminal 1
npm run dev                                       # terminal 2
```

The CFB archive pages fall back to fetching the Hub directly if the proxy is
unreachable (see `resolveBase` in `src/lib/cfbData.ts`), but the CBB / MLB / NASCAR /
tennis pages do not — without the server their data requests 404 in dev.

## Known data-quality issues (2025 season)

13 rows in `games.csv` files never join to their sims because the schedule spells team
names differently from the sim output. The join is exact-string on `Team A`/`Team B`,
so these games silently show no projection:

- `Umass` / `UMass` / `Massachusetts` vs the sims' spelling (weeks 1, 6, 8)
- Typos: `Middle Tennesse` (wk13), `Missisppi State` (wk14), `San Deigo State` (wk16)
- Week 14 has 68 scheduled games but only 60 simulated

This predates the migration. Fix the spellings in the source `games.csv` (or add
normalization to the join) when preparing 2026.

## Pre-commit check: render loops on the scoreboard

```bash
node scripts/check_render_loops.mjs
```

Run this before committing any change to the effects/memos in
`src/pages/Scoreboard.tsx` or `src/lib/useSlateEdges.ts`. No dependencies, no build,
no test runner — plain node, exits non-zero on failure.

It guards the bug that froze the browser when "Top Edges" was clicked: the slate-edge
scan wrote state that fed a memo chain back into its own effect dependencies
(`setSlateEdges` → `cards` → `edgeInputs` → the effect), which re-ran the scan forever
— 399 scans per game before the render cap tripped. The check runs the broken graph as
a fixture (it must still be detected as looping, which is what proves the check has
teeth), runs the shipped graph (must settle), and then asserts statically that the real
source still obeys the two rules that make the loop impossible: the scan effect depends
on exactly one primitive `signature`, and `edgeInputs` is derived from the unsorted card
list rather than from `cards`.
