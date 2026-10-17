// src/components/site/TopStories.tsx: the featured-articles block (2026-10-16),
// laid out the way cbssports.com runs its home and sport pages: one lead story
// with its picture, headline and dek, and a stacked list of the next headlines
// beside it. Used on the homepage (every post) and each sport's home (that
// sport's posts).

import { Link } from "react-router-dom";
import { fmtPostDate, tagLine, tagWords, type BlogMeta } from "../../lib/blog/posts";

function Kicker({ post }: { post: BlogMeta }) {
  return (
    <div className="pcard__kicker">
      {post.draft && <span className="pcard__draft">Draft</span>}
      {tagLine(post.tags, 2)}
    </div>
  );
}

export function TopStories({ posts, title, moreTo = "/blog", moreLabel = "All posts" }: {
  posts: BlogMeta[]; title?: string; moreTo?: string; moreLabel?: string;
}) {
  if (!posts.length) return null;
  const [lead, ...rest] = posts;
  const list = rest.slice(0, 5);
  return (
    <section className="ts" aria-label={title ?? "Top stories"}>
      {title && (
        <div className="home-sec__head">
          <h2 className="home-sec__title">{title}</h2>
          <Link className="link" to={moreTo}>{moreLabel} →</Link>
        </div>
      )}
      <div className={`ts__grid${list.length ? "" : " ts__grid--solo"}`}>
        <article className="ts-lead">
          <Link to={`/blog/${lead.slug}`} className="ts-lead__hero" tabIndex={-1} aria-hidden="true">
            {lead.hero
              ? <img src={lead.hero} alt="" decoding="async" />
              : <span className="ts-lead__blank">{lead.tags.slice(0, 1).map(tagWords)}</span>}
          </Link>
          <div className="ts-lead__words">
            <Kicker post={lead} />
            <h2 className="ts-lead__title"><Link to={`/blog/${lead.slug}`}>{lead.title}</Link></h2>
            <p className="pcard__dek">{lead.description}</p>
            <div className="pcard__by"><time dateTime={lead.date}>{fmtPostDate(lead.date)}</time> · {lead.minutes} min read</div>
          </div>
        </article>

        {list.length > 0 && (
          <ol className="ts-list">
            {list.map((p) => (
              <li key={p.slug} className="ts-item">
                <div className="ts-item__words">
                  <Kicker post={p} />
                  <h3 className="ts-item__title"><Link to={`/blog/${p.slug}`}>{p.title}</Link></h3>
                  <div className="pcard__by"><time dateTime={p.date}>{fmtPostDate(p.date)}</time></div>
                </div>
                {p.hero && (
                  <Link to={`/blog/${p.slug}`} className="ts-item__thumb" tabIndex={-1} aria-hidden="true">
                    <img src={p.hero} alt="" loading="lazy" decoding="async" />
                  </Link>
                )}
              </li>
            ))}
            {!title && <li className="ts-item ts-item--more"><Link className="link" to={moreTo}>{moreLabel} →</Link></li>}
          </ol>
        )}
      </div>
    </section>
  );
}
