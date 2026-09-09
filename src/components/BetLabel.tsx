// src/components/BetLabel.tsx
//
// THE BET WITHOUT THE TEAM NAME — one component, every surface that shows one.
//
// Owner, 2026-09-09: "on the scoreboard page, and anywhere else where we show
// the my book bets, mimic the way we use the logos to replace the team
// abbreviation and we don't need the word points or total."
//
// This started life inside NetworkFeed and is now the shared thing the feed
// imports, so the feed and the book cannot drift: a bet reads the same in the
// friends' feed, in the scoreboard's book strip, in the per-game Bets panel,
// in the resting review and on the dashboard.
//
// THE RULE, in one line: when the words OPEN with one of the game's two
// schools, that school becomes its logo and the rest of the words follow it —
// "Rutgers 24+" is [R] 24+, "Memphis +7.5" is [M] +7.5. Everything else is
// left alone, deliberately:
//
//   · A PLAYER is words. "Bo Nix o274.5 pass yds" keeps the man's name — only
//     TEAMS have logos, and a prop's subject is a person.
//   · A school with NO logo file on disk keeps its words rather than
//     vanishing. Losing the team entirely would be worse than an abbreviation.
//   · A bet that names NEITHER team (a game total: "o51.5") gets the words
//     alone — which is right inside the feed, where the card header above it
//     already draws the matchup. A standalone list has no such header, so
//     `pair` draws BOTH logos, dimmed, as the quiet "which game" the row would
//     otherwise be missing. Dimmed because neither team is the bet's side.
//
// THE FULL SENTENCE IS NEVER LOST: it is the element's `title` and its
// accessible name, so a hover or a screen reader gets "Rutgers over 23.5
// points" out of [R] o23.5.

import type { CSSProperties, ReactNode } from "react";
import { compactBetWords, teamPrefixRest } from "../lib/betWords";
import { getTeamLogo } from "../utils/teamLogo";

/** The words that are left after the logo takes the team's place. Ellipsised
 *  rather than wrapped: these sit in fixed-height book rows. */
const WORDS: CSSProperties = {
  minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

export default function BetLabel({
  label, home, away, size = 17, pair = false, className, title, style, wrap = false,
}: {
  /** The bet in full words — a confirmed market title, or `cheerLabelWithGame`
   *  output. Already-compact input is fine: the re-speller is idempotent. */
  label: string;
  /** The game's two schools. HOME and AWAY in the app's usual sense (a
   *  kalshiPortal `BetGameNames` is {teamA: home, teamB: away}). Without them
   *  nothing can be swapped and the words render as they arrived. */
  home?: string | null;
  away?: string | null;
  /** Logo edge, px. 16–18 is the house range: it sits on the text baseline of
   *  an 11.5–13px row without changing the row's height. */
  size?: number;
  /** Draw both schools, dimmed, when the bet names neither of them. For lists
   *  that mix games and carry no matchup header of their own. */
  pair?: boolean;
  className?: string;
  /** Override the tooltip / accessible name. Defaults to `label` in full. */
  title?: string;
  style?: CSSProperties;
  /** Let the words wrap onto a second line (a popover has the room; a 40px
   *  book row does not). */
  wrap?: boolean;
}) {
  const words = compactBetWords(label, home, away);
  const full = title ?? String(label ?? "").trim();
  const wordStyle = wrap
    ? { minWidth: 0, overflowWrap: "anywhere" as const }
    : WORDS;

  const shell = (kids: ReactNode) => (
    <span
      className={className}
      title={full}
      aria-label={full}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0,
        ...style,
      }}
    >
      {kids}
    </span>
  );

  // 1. THE BET'S OWN TEAM, as its logo. Home first: a spread's strike team is
  //    the home side more often than not, and either way only a true prefix
  //    match is taken (see `teamPrefixRest`).
  for (const team of [home, away]) {
    const rest = teamPrefixRest(words, team);
    if (rest === null) continue;
    const src = getTeamLogo(team!);
    if (!src) break;
    return shell(
      <>
        <img src={src} alt="" width={size} height={size} loading="lazy"
             style={{ objectFit: "contain", flex: "none" }} />
        {rest && <span style={wordStyle}>{rest}</span>}
      </>,
    );
  }

  // 2. NEITHER TEAM — a game total. In a mixed list, say which game quietly.
  if (pair && home && away) {
    const a = getTeamLogo(away);
    const h = getTeamLogo(home);
    if (a || h) {
      return shell(
        <>
          <span aria-hidden style={{ display: "inline-flex", gap: 2, flex: "none", opacity: 0.45 }}>
            {a && <img src={a} alt="" width={size} height={size} loading="lazy"
                       style={{ objectFit: "contain" }} />}
            {h && <img src={h} alt="" width={size} height={size} loading="lazy"
                       style={{ objectFit: "contain" }} />}
          </span>
          <span style={wordStyle}>{words}</span>
        </>,
      );
    }
  }

  return shell(<span style={wordStyle}>{words}</span>);
}
