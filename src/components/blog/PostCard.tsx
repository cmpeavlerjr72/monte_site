// src/components/blog/PostCard.tsx: one post in a list (index, tag pages,
// homepage strip, related posts). Text-led like a sports page: tag kicker,
// display headline, dek, byline. The hero image shows only on `lead`.

import { Link } from "react-router-dom";
import type { BlogMeta } from "../../lib/blog/posts";
import { fmtPostDate, tagWords } from "../../lib/blog/posts";

export function PostCard({ post, lead = false }: { post: BlogMeta; lead?: boolean }) {
  return (
    <article className={`pcard${lead ? " pcard--lead" : ""}`}>
      {lead && post.hero && (
        <Link to={`/blog/${post.slug}`} className="pcard__hero" tabIndex={-1} aria-hidden="true">
          <img src={post.hero} alt="" loading="lazy" decoding="async" />
        </Link>
      )}
      <div className="pcard__words">
        <div className="pcard__kicker">
          {post.draft && <span className="pcard__draft">Draft</span>}
          {post.tags.slice(0, 2).map(tagWords).join(" · ")}
        </div>
        <h3 className="pcard__title"><Link to={`/blog/${post.slug}`}>{post.title}</Link></h3>
        {lead && <p className="pcard__dek">{post.description}</p>}
        <div className="pcard__by">
          <time dateTime={post.date}>{fmtPostDate(post.date)}</time> · {post.minutes} min read
        </div>
      </div>
    </article>
  );
}
