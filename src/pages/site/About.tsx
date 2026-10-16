// src/pages/site/About.tsx: /about (2026-10-16). Who, what the sims are, how
// the picks are graded, and the disclaimer. Plain English; the technical
// detail lives on the Record page's own "?" and on /about/how-it-works.

import { Link } from "react-router-dom";
import { ButtonLink, PageHeader } from "../../components/ui";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

export default function About() {
  useDocumentMeta({
    title: "About",
    description: "Who runs MVPEAV, what the sims are, and how every pick is graded in public, losses included.",
  });
  return (
    <div className="stack about">
      <PageHeader kicker="About" title="A sim nerd who posts the receipts"
        sub="MVPEAV is one person, a lot of simulations, and a public record that includes the bad weeks." />

      <div className="about-grid">
        <div className="prose">
          <h2>Who</h2>
          <p>
            I'm <a href="https://x.com/MVPeav" target="_blank" rel="noopener noreferrer">@MVPeav</a>. Yes, I'm the guy with the
            spreadsheet. I build computer models that play out college football and basketball games
            thousands of times, and I post what they think before the games start.
          </p>

          <h2>What the sims are</h2>
          <p>
            For college football, every FBS game (and the FCS slate) is simulated play by play, 10,000 times.
            Each run produces a final score and a stat line for every player, so the sim doesn't hand you one
            number: it hands you the whole range of what could happen. From that range come the win
            probabilities, the spread and total numbers, team totals and player props you see on the{" "}
            <Link to="/cfb/scoreboard">board</Link>, and the full distributions on{" "}
            <Link to="/cfb/game">Game sims</Link>.
          </p>
          <p>
            College basketball runs a daily version during the season. The side projects (MLB, NASCAR,
            tennis, college baseball) live in <Link to="/labs">Labs</Link>.
          </p>

          <h2>How the picks are graded</h2>
          <p>
            A pick is only worth something if you could have actually made it. So every pick is posted
            before kickoff and graded at the price on the market when it was posted, with the exchange's
            fees taken out. Not the closing line, not a price I wish I'd gotten.
          </p>
          <p>
            The <Link to="/cfb/record">Record</Link> shows every one of them: wins, losses, the running total,
            whether the market moved our way after we posted, and whether we were right as often as we said
            we'd be. Nothing gets deleted. When a week goes 119-252, it stays up, and I'll probably write a
            blog about it.
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
              <li><Link to="/about/how-it-works">How to read the board →</Link></li>
              <li><Link to="/cfb/record">The 2026 record →</Link></li>
              <li><Link to="/blog">The blog →</Link></li>
              <li><a href="https://x.com/MVPeav" target="_blank" rel="noopener noreferrer">@MVPeav on X →</a></li>
            </ul>
          </div>
          <ButtonLink to="/cfb/scoreboard">This week's board</ButtonLink>
        </aside>
      </div>
    </div>
  );
}
