// src/pages/site/About.tsx: /about (2026-10-16, second pass). What the site is:
// the owner's projects in one place, of which the CFB sims are the most
// developed today. The site is not pitched as a picks or betting site; the
// grading detail is here for the people who want it, and the fine print stays
// because the boards show market prices. Plain English, no invented
// first-person colour: the owner adds his own voice.

import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export default function About() {
  useDocumentMeta({
    title: "About",
    description: "What MVPEAV is: MVPeav's projects in one place, from play-by-play college football sims to an AI running a fantasy football team.",
  });
  return (
    <div className="stack about">
      <PageHeader kicker="About" title="Projects, sims and experiments"
        sub="MVPEAV is where I put the things I'm building, and write about how they're going." />

      <div className="about-grid">
        <div className="prose">
          <h2>What's here</h2>
          <p>
            I'm <a href="https://x.com/MVPeav" target="_blank" rel="noopener noreferrer">@MVPeav</a>. This site collects my
            projects. Right now that's:
          </p>
          <ul>
            <li><Link to="/cfb">College football sims</Link>: every game simulated play by play, with a weekly board and a public record.</li>
            <li><Link to="/cbb">College basketball sims</Link>: daily game sims during the season.</li>
            <li><Link to="/fantasy-ai">Fantasy AI</Link>: an AI running a real fantasy football team.</li>
            <li><Link to="/nhl">NHL</Link>: a hockey sim that's in the works.</li>
            <li><Link to="/labs">Labs</Link>: smaller side projects (MLB, NASCAR, tennis, college baseball).</li>
          </ul>
          <p>New projects get added as they're ready, and the <Link to="/blog">blog</Link> is where I write them up.</p>

          <h2>How the college football sims work</h2>
          <p>
            Every FBS game (and the FCS slate) is simulated play by play, 10,000 times. Each run produces a
            final score and a stat line for every player, so the sim doesn't hand you one number: it hands you
            the whole range of what could happen. From that range come the win probabilities, the projected
            scores, team totals and player stat lines you see on the <Link to="/cfb/scoreboard">board</Link>.
            Open any game card for the full distributions, or read <Link to="/about/how-it-works">how to read
            the board</Link>.
          </p>

          <h2>Keeping score</h2>
          <p>
            A model is only worth something if you can check it. So the sims' picks are posted before kickoff
            and graded in public at the price available when they were posted, fees taken out. The{" "}
            <Link to="/cfb/record">Record</Link> shows every one of them, and nothing gets deleted, including the
            bad weeks.
          </p>

          <h2>The fine print</h2>
          <p>
            This is research and entertainment. It is not financial or betting advice, and nothing here is
            an offer to bet. Models miss; the record proves it. If you bet, bet what you can afford to lose.
            You must be 21 or older. Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a>.
          </p>
        </div>

        <aside className="about-side">
          <div className="ui-card">
            <div className="kicker">Start here</div>
            <ul className="about-links">
              <li><Link to="/cfb">College football →</Link></li>
              <li><Link to="/fantasy-ai">Fantasy AI →</Link></li>
              <li><Link to="/blog">The blog →</Link></li>
              <li><a href="https://x.com/MVPeav" target="_blank" rel="noopener noreferrer">@MVPeav on X →</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
