# MVPEAV design system

One visual dialect for the whole site, based on the two strongest pages, the
2026 Record and the V2 scoreboard. Think box score, betting board and
newspaper agate, not a startup landing page.

Source of truth: tokens in `src/theme.css` (`:root` and the two dark blocks),
primitives in `src/components/ui/index.tsx` with styles in `src/styles/ui.css`.

## Rules

1. **Tokens only.** No hex literals in TSX (`scripts/check_no_new_hex.mjs`
   enforces it against a baseline of legacy files). Team-identity colours from
   `src/utils/teamColors.ts` are the one allowed literal.
2. **Navy and ONE gold.** Navy `#0b2d4b` (`--navy`) and gold `#c2a35a`
   (`--gold`), the same pair as the X banner and the bot's cards.
   - Gold marks *ours / active / starred*: the active nav underline, starred
     picks, blog callouts, "our pick" highlights, the gold rule under the header.
   - Gold on white is about 2.4:1, so use it for fills, rules, underlines,
     borders and badges. **Gold text on a light surface uses `--accent-ink`**
     (`#80661b`, 5.5:1 on white, 4.9:1 on `--bg`). On navy or a dark surface,
     gold text is fine.
   - Text on a gold fill is navy (`--accent-contrast`).
3. **Green and red mean money won and lost.** Nothing else is green or red.
4. **The header is navy in both themes**, with a 2px gold rule under it.
5. **Team colours carry data visuals** (bars, win-prob strips). Brand colours
   do not compete with them.
6. **Charts:** the series line is `--chart-line` (navy; a steel `#8fb4dc` in
   dark), highlight points are `--chart-point` (gold), grid is `--chart-grid`.
7. **Empty cells read "—" or "No line yet".** Never a skeleton that never
   resolves, never a raw `0-0-0` while loading. Skeletons are for loading only.

## Colour roles

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f3ef` warm paper | `#0c131b` | page |
| `--card` | `#ffffff` | `#131c26` | panels |
| `--border` | `#dedcd4` | `#273444` | 1px rules |
| `--text` | `#121820` | `#e8edf2` | body |
| `--muted` | `#5f6670` (5.2:1 on bg) | `#9aa7b6` | secondary text |
| `--brand` | navy | `#3a6ea5` steel | button and toggle surfaces |
| `--brand-text` | navy | `#8fb4dc` | links, brand-coloured text |
| `--accent` | gold | gold | fills, rules, badges |
| `--accent-ink` | `#80661b` | gold | gold-coloured text |
| `--pos` / `--neg` | `#15803d` / `#c81e1e` | `#3fb950` / `#f85149` | money |
| `--header-bg` | navy | navy | site header |
| `--target-star` | accent-ink | gold | the ★ on a starred pick |
| `--info`, `--mode-rest`, `--mode-take` | unchanged channels | | feed news, maker/taker |

Retired: the bright blues (`#3178c6` dark brand and dark header, `#2a78d6` /
`#4d97e6` chart marks, the `#0b63f6` fallbacks in `index.css`, the Donate
pill), the amber star `#f0b429`, `--accent: #c59b2b`, and the unused
`theme-crimson-white` / `theme-blue-gold` classes.

## Type

- **Display:** Barlow Condensed 600/700/800, self-hosted
  (`src/assets/fonts/`, SIL OFL). Headlines (`h1`–`h3`), the wordmark, nav,
  tabs, section kickers, buttons, and big numbers.
- **Body:** the system sans stack (`--font-body`).
- **Numbers:** `font-variant-numeric: tabular-nums` on every stat (`.num`,
  `td`, `th`, `time`, `Stat`, `DataTable`).
- Scale: `--fs-xs` 12 (the floor for any label), `--fs-sm` 13, `--fs-base` 15,
  `--fs-md` 17, `--fs-lg` 20, `--fs-xl` 26, `--fs-2xl` 36, `--fs-3xl` 52.
- Kicker: `.kicker`, display 700, 13px, uppercase, 0.08em tracking, accent-ink.

## Shape and space

- Radius: `--r-sm` 3px (pills), `--r` 4px (buttons, inputs), `--r-lg` 6px
  (cards). Nothing rounder except avatars and the legacy 999px chips.
- Rules: `--rule` (1px `--border`). Table heads get a 1px `--text` rule.
- Shadows: menus and popovers only.
- Space: a 4px grid, `--sp-1`..`--sp-7` (4, 8, 12, 16, 24, 32, 48).
- Widths: `--content-max` 1200px, `--read-max` 700px (blog and about prose).

## Primitives (`src/components/ui`)

| Component | What it is |
|---|---|
| `PageHeader` | kicker, display headline, one-line dek, actions, rule under |
| `Card` | ruled panel with optional title row and action link; `flush` for edge-to-edge tables |
| `Stat` | uppercase label + display-face number; `tone` colours the value (money only) |
| `Pill` | small square tag; neutral, outline, gold, navy, pos, neg |
| `Tabs` | text tabs with a gold underline; route tabs (`to`) or local `role="tablist"` |
| `DataTable` | agate table, scrolls in its own box, `empty` cell defaults to "—" |
| `EmptyState` | gold-ruled panel that says what is happening and where to go |
| `TeamCell` | logo + school name (decorative logo, name read once). Import from `components/ui/TeamCell`: it carries the team table, so it is kept out of the shared index |
| `ButtonLink` | primary (navy), gold, or quiet link-button |

## Avoid (the AI-site tells)

Purple or indigo gradients, glassmorphism, emoji as icons, a hero tagline over
three icon cards, big rounded corners with soft shadows on everything, Inter
on everything. Lead with data: a game strip, a record, the latest posts.
