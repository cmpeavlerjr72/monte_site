// src/pages/Home.tsx
import { Link } from "react-router-dom";

// ⬇️ Put these three files in src/assets/ with these names (or update paths)
//   - cfb_pills.png            (first screenshot)
//   - cfb_scores_hist.png      (second screenshot)
//   - cfb_player_props.png     (third screenshot)
import imgPills from "../assets/cfb_pills.png";
import imgScores from "../assets/cfb_scores_hist.png";
import imgProps from "../assets/cfb_player_props.png";

export default function Home() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, display: "grid", gap: 24 }}>
      {/* Intro */}
      <header className="card" style={{ padding: 20, borderRadius: 16 }}>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800 }}>College Football Sim Explorer</h1>
        <p style={{ marginTop: 8, maxWidth: 900, opacity: 0.9 }}>
          This site runs thousands of simulations per game to estimate distributions for
          spreads, totals, moneylines, and player props. Use the guide below to interpret
          the UI and find actionable edges.
        </p>
        <div style={{ marginTop: 12 }}>
          <Link
            to="/scoreboard"
            style={{
              padding: "10px 16px",
              border: "1px solid var(--border)",
              borderRadius: 12,
              background: "var(--card)",
              fontWeight: 700,
            }}
          >
            Jump to Game Center →
          </Link>
        </div>
      </header>

      {/* How it works */}
      <section
        className="card"
        style={{ padding: 22, borderRadius: 16, lineHeight: 1.65, display: "grid", gap: 18 }}
      >
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>How it works</h2>
        <p style={{ margin: 0 }}>
          Every matchup is simulated using team efficiency, pace, and matchup adjustments.
          The output is a distribution of final scores and player stat lines. From that, we compute:
        </p>
        <ul style={{ marginTop: 0 }}>
          <li><b>Spread/Total probabilities</b> (cover/over/under rates at any line)</li>
          <li><b>Moneyline win probabilities</b> and a <i>fair price</i></li>
          <li><b>Player prop distributions</b> with probability vs any posted line</li>
        </ul>
      </section>

      {/* Interpreting the pills */}
      <section className="card" style={{ padding: 22, borderRadius: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 20, fontWeight: 800 }}>Reading the “pills”</h3>
        <figure style={{ margin: 0 }}>
          <img
            src={imgPills}
            alt="Spread/Total/ML pills showing model pick, line, and probability"
            style={{
              width: "100%",
              height: "auto",
              borderRadius: 12,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <figcaption style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            Pills summarize the model’s current pick, the line used, and the model’s probability.
          </figcaption>
        </figure>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div><b>Spread pill</b> — “Pick • UNLV -5.5 (58.8%)” means at -5.5 the model covers 58.8% → edge vs -110 (breakeven ~52.4%).</div>
          <div><b>Total pill</b> — “Pick • Under 53.5 (73.6%)” shows under probability at that number. greater than 60% is typically strong.</div>
          <div><b>ML pill</b> — “UNLV (73.3%) • Fair -275” gives win prob and the convert-to-American fair price. Compare your book price to fair.</div>
          <div style={{ fontStyle: "italic" }}>
            Quick rule: if model probability &gt; implied probability of the posted odds, it’s +EV.
          </div>
        </div>
      </section>

      {/* Scores chart */}
      <section className="card" style={{ padding: 22, borderRadius: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 20, fontWeight: 800 }}>Using the Scores chart to size edges</h3>
        <figure style={{ margin: 0 }}>
          <img
            src={imgScores}
            alt="Scores histogram with adjustable line showing cover probability"
            style={{
              width: "100%",
              height: "auto",
              borderRadius: 12,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <figcaption style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            Histogram of simulated margins; dashed line is the active spread. Panel below shows
            cover/not-cover probabilities and their implied break-even odds.
          </figcaption>
        </figure>
        <ul style={{ marginTop: 10 }}>
          <li>
            Use the <b>Line +/-</b> controls to mirror your book number. The chart and probabilities
            update immediately from the underlying sims.
          </li>
          <li>
            <b>Probability vs Line</b> converts the model’s probability to equivalent American odds
            (e.g., 58.8% ≈ -143). If your book is better than fair, that’s value.
          </li>
          <li>
            The <b>peak &amp; tail weight</b> show how confident the distribution is around the line;
            sharper peaks near the line mean more sensitivity to half-points.
          </li>
        </ul>
      </section>

      {/* Player props */}
      <section className="card" style={{ padding: 22, borderRadius: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 20, fontWeight: 800 }}>Player props: finding market misprices</h3>
        <figure style={{ margin: 0 }}>
          <img
            src={imgProps}
            alt="Player prop histogram with line and Under/Over probabilities"
            style={{
              width: "100%",
              height: "auto",
              borderRadius: 12,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <figcaption style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            Pick team/position/player and stat. Set the prop line to your book number; the chart shows
            the simulated distribution and Over/Under probabilities.
          </figcaption>
        </figure>
        <ul style={{ marginTop: 10 }}>
          <li>
            Example shows <b>Pass Yds 225.5</b> with <b>Over 64%</b>. 64% ≈ -178 fair. If your book offers
            -150 or better, that’s +EV.
          </li>
          <li>
            Distributions with <b>long right tails</b> are great for overs; left-skew favors unders. Watch
            how the probability changes when you nudge the line by 0.5/1.0.
          </li>
        </ul>
      </section>

      {/* Putting it together */}
      <section className="card" style={{ padding: 22, borderRadius: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 20, fontWeight: 800 }}>Playbook: turning sims into bets</h3>
        <ol style={{ marginTop: 8 }}>
          <li>Start on a game card: note the pills for quick “model lean” and rough confidence.</li>
          <li>Open <b>Detailed Simulated Scores</b>; set the line to your book. Log model % and fair odds.</li>
          <li>Check <b>player props</b> for correlated value (e.g., QB under if pace/defense drags total).</li>
          <li>Only tag as a “best bet” if model % exceeds implied odds by a healthy margin and the distribution isn’t razor-thin near the line.</li>
        </ol>
        <p style={{ marginTop: 8, opacity: 0.9 }}>
          Want historical context? See <Link to="/results">Results</Link> and <Link to="/trends-clv">Trends (CLV)</Link> for
          how similar spots have performed and whether you consistently beat the close.
        </p>
      </section>
    </div>
  );
}
