// src/components/blog/LatestPosts.tsx: the homepage's blog strip.
//
// "This week's previews" first when any visible preview's game kicks off in
// the next 7 days (or kicked off in the last day), then the latest 3 posts.
// Renders nothing when there are no visible posts (the blog's empty state
// lives on /blog, not on the homepage).

import { Link } from "react-router-dom";
import { visiblePosts } from "../../lib/blog/posts";
import { PostCard } from "./PostCard";

export function LatestPosts() {
  const all = visiblePosts();
  if (!all.length) return null;
  const now = Date.now();
  const previews = all.filter((p) => {
    if (!p.tags.includes("previews") || !p.game?.kickoff) return false;
    const k = Date.parse(p.game.kickoff);
    return k > now - 24 * 3600e3 && k < now + 7 * 24 * 3600e3;
  });
  const latest = all.filter((p) => !previews.includes(p)).slice(0, 3);
  return (
    <>
      {previews.length > 0 && (
        <section className="home-sec" aria-label="This week's previews">
          <div className="home-sec__head">
            <h2 className="home-sec__title">This week's previews</h2>
            <Link className="link" to="/blog/tag/previews">All previews →</Link>
          </div>
          <div className="pgrid">{previews.slice(0, 3).map((p) => <PostCard key={p.slug} post={p} />)}</div>
        </section>
      )}
      {latest.length > 0 && (
        <section className="home-sec" aria-label="From the blog">
          <div className="home-sec__head">
            <h2 className="home-sec__title">From the blog</h2>
            <Link className="link" to="/blog">All posts →</Link>
          </div>
          <div className="pgrid">{latest.map((p) => <PostCard key={p.slug} post={p} />)}</div>
        </section>
      )}
    </>
  );
}
