// src/pages/site/Home.tsx: the homepage (2026-10-16, second pass).
//
// Laid out like cbssports.com (owner's call: mirror it, don't reinvent it):
// the score ticker runs across the top (SiteTicker, mounted in App under the
// header), the articles are the page (a lead story plus a stacked headline
// list), then one block per project that has more to read, then the projects
// themselves. No tagline masthead: what the site is lives on /about. The
// site is the owner's projects, not just a picks page, so nothing here leads
// with a record or a price.

import { Link } from "react-router-dom";
import { Pill } from "../../components/ui";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { GATES, isOpen } from "../../lib/seasons";
import { visiblePosts } from "../../lib/blog/posts";
import { TopStories } from "../../components/site/TopStories";
import { PostCard } from "../../components/blog/PostCard";

const TOP_N = 6;

/** One block per project, in nav order. `tag` is the blog tag its posts carry. */
const SECTIONS = [
  { tag: "cfb", title: "College football", home: "/cfb" },
  { tag: "cbb", title: "College basketball", home: "/cbb" },
  { tag: "nfl", title: "NFL", home: "/nfl" },
  { tag: "fantasy-ai", title: "Fantasy AI", home: "/fantasy-ai" },
  { tag: "nhl", title: "NHL", home: "/nhl" },
];

function Projects() {
  const cbbLive = isOpen(GATES.cbbSeason);
  const rows = [
    { name: "College football", to: "/cfb", status: <Pill tone="outline">Live</Pill>,
      body: "Every FBS game and the FCS slate, simulated play by play 10,000 times, with a weekly board and a public record." },
    { name: "College basketball", to: "/cbb", status: <Pill tone="outline">{cbbLive ? "Live" : "Tips Nov 3"}</Pill>,
      body: "Daily game sims through the season. Last season's numbers and the March bracket are in the archive." },
    { name: "Fantasy AI", to: "/fantasy-ai", status: <Pill tone="outline">Experiment</Pill>,
      body: "An AI running a real fantasy football team. What it does, and how it's going, lands on the blog." },
    { name: "NHL", to: "/nhl", status: <Pill tone="outline">In the works</Pill>,
      body: "A hockey sim is being built. Posts about it land here first." },
  ];
  return (
    <section className="home-sec" aria-label="Projects">
      <div className="home-sec__head"><h2 className="home-sec__title">Projects</h2><Link className="link" to="/labs">Labs →</Link></div>
      <div className="proj-list">
        {rows.map((r) => (
          <Link key={r.name} to={r.to} className="proj-row">
            <span className="proj-row__name">{r.name}</span>
            <span className="proj-row__status">{r.status}</span>
            <span className="proj-row__body">{r.body}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  useDocumentMeta({
    title: "MVPEAV | Sims, projects and experiments",
    bare: true,
    description: "MVPeav's projects in one place: play-by-play college football and basketball sims, an AI running a fantasy football team, and the write-ups behind them.",
  });
  const posts = visiblePosts();
  const top = posts.slice(0, TOP_N);
  const shown = new Set(top.map((p) => p.slug));
  const sections = SECTIONS
    .map((s) => ({ ...s, posts: posts.filter((p) => p.tags.includes(s.tag) && !shown.has(p.slug)).slice(0, 3) }))
    .filter((s) => s.posts.length > 0);

  return (
    <div className="home">
      <h1 className="sr-only">MVPEAV</h1>
      <TopStories posts={top} />
      {sections.map((s) => (
        <section key={s.tag} className="home-sec" aria-label={s.title}>
          <div className="home-sec__head">
            <h2 className="home-sec__title">{s.title}</h2>
            <Link className="link" to={s.home}>More {s.title.toLowerCase()} →</Link>
          </div>
          <div className="pgrid">{s.posts.map((p) => <PostCard key={p.slug} post={p} />)}</div>
        </section>
      ))}
      <Projects />
    </div>
  );
}
