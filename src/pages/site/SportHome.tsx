// src/pages/site/SportHome.tsx: /cfb and /cbb, each sport's home page
// (2026-10-16). Modelled on a cbssports.com sport home: the sport's own
// articles lead (a lead story plus a headline list), with the board one click
// away (the sub-nav's Scoreboard tab, the ticker's "Full board", and the
// button here). The side column carries the sport's quick links and, for
// CFB, the live record.

import { Link } from "react-router-dom";
import { ButtonLink, EmptyState, PageHeader } from "../../components/ui";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { visiblePosts } from "../../lib/blog/posts";
import { GATES, isOpen } from "../../lib/seasons";
import { TopStories } from "../../components/site/TopStories";
import { RecordTile } from "../../components/site/RecordTile";

type Sport = "cfb" | "cbb" | "nfl";

const CFG: Record<Sport, {
  name: string; sub: string; board?: string; links: { to: string; label: string; ext?: boolean }[];
}> = {
  cfb: {
    name: "College football",
    sub: "Every FBS game and the FCS slate, simulated play by play 10,000 times a week.",
    board: "/cfb/scoreboard",
    links: [
      { to: "/cfb/scoreboard", label: "This week's board" },
      { to: "/cfb/record", label: "The 2026 record" },
      { to: "/cfb/quads", label: "Quads" },
      { to: "/about/how-it-works", label: "How to read the board" },
    ],
  },
  cbb: {
    name: "College basketball",
    sub: "Daily game sims through the season, and last season's numbers in the archive.",
    board: "/cbb/scoreboard",
    links: [
      { to: "/cbb/scoreboard", label: "Scoreboard" },
      { to: "/cbb/results", label: "Results" },
    ],
  },
  // No NFL sims (yet): the page is the columns, with the week's games in the
  // ticker on top (NflTicker) instead of a sim board.
  nfl: {
    name: "NFL",
    sub: "Columns and takes from around the league. This week's games run across the top.",
    links: [
      { to: "/blog/tag/nfl", label: "All NFL posts" },
      { to: "https://www.espn.com/nfl/scoreboard", label: "Scores (ESPN)", ext: true },
      { to: "https://www.espn.com/nfl/standings", label: "Standings (ESPN)", ext: true },
    ],
  },
};

export default function SportHome({ sport }: { sport: Sport }) {
  const c = CFG[sport];
  useDocumentMeta({ title: c.name, description: `${c.name} on MVPEAV: ${c.sub}` });
  const posts = visiblePosts(sport);
  const offSeason = sport === "cbb" && !isOpen(GATES.cbbSeason);

  return (
    <div className="stack sport-home">
      <PageHeader kicker={offSeason ? "Season tips Nov 3" : "MVPEAV"} title={c.name} sub={c.sub}
        actions={c.board ? <ButtonLink to={c.board}>{sport === "cfb" ? "Full board" : "Scoreboard"}</ButtonLink> : undefined} />

      <div className="sport-home__grid">
        <div className="sport-home__main">
          {posts.length ? (
            <TopStories posts={posts} moreTo={`/blog/tag/${sport}`} moreLabel={`All ${c.name.toLowerCase()} posts`} />
          ) : (
            <EmptyState kicker={c.name} title="No posts yet"
              action={c.board ? <ButtonLink to={c.board}>{sport === "cfb" ? "This week's board" : "Scoreboard"}</ButtonLink> : undefined}>
              <p>{c.board ? `Write-ups about the ${c.name.toLowerCase()} sims land here. The board is live in the meantime.` : `${c.name} columns land here.`}</p>
            </EmptyState>
          )}
        </div>

        <aside className="sport-home__side">
          {sport === "cfb" && <RecordTile />}
          <div className="ui-card">
            <div className="kicker">{c.name}</div>
            <ul className="about-links">
              {c.links.map((l) => <li key={l.to}>{l.ext
                ? <a href={l.to} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
                : <Link to={l.to}>{l.label} →</Link>}</li>)}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
