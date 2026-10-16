// src/pages/blog/BlogIndex.tsx: /blog, /blog/tag/:tag, and the tag landing
// pages /nhl and /fantasy-ai (2026-10-16). Newest first; the newest post
// leads with its hero image, the rest are a text list.

import { useParams } from "react-router-dom";
import { ButtonLink, EmptyState, PageHeader, Tabs } from "../../components/ui";
import { PostCard } from "../../components/blog/PostCard";
import { showDrafts, tagWords, visiblePosts } from "../../lib/blog/posts";
import { useDocumentMeta } from "../../lib/useDocumentMeta";

const TAB_TAGS = ["cfb", "previews", "cbb", "nhl", "fantasy-ai"];

const LANDING: Record<string, { title: string; sub: string }> = {
  nhl: { title: "NHL", sub: "A hockey sim is in the shop. Until it has a board of its own, everything about it lands here first." },
  "fantasy-ai": { title: "Fantasy AI", sub: "An AI running a real fantasy football team, quietly. The reports land here." },
  previews: { title: "Game previews", sub: "One game, 10,000 sims: the pick, why, and how the sims get there. Every preview links to its live game card." },
};

export default function BlogIndex({ tag: fixedTag }: { tag?: string }) {
  const params = useParams();
  const tag = fixedTag ?? params.tag;
  const posts = visiblePosts(tag);
  const drafts = showDrafts();
  const landing = tag ? LANDING[tag] : undefined;
  const title = landing?.title ?? (tag ? tagWords(tag) : "The blog");

  useDocumentMeta({
    title: tag ? `${title} posts` : "Blog",
    description: landing?.sub ?? "Write-ups from MVPeav's projects: sim-driven game previews, the fantasy AI experiment, and whatever's next.",
  });

  return (
    <div className="stack blog-index">
      <PageHeader kicker="Blog" title={title}
        sub={landing?.sub ?? "Write-ups from the projects: sim-driven game previews, the fantasy AI experiment, and whatever's next."}
        actions={<a className="link" href="/blog/rss.xml">RSS</a>} />
      {!fixedTag && (
        <Tabs label="Blog sections"
          items={[{ id: "all", label: "All", to: "/blog", end: true },
            ...TAB_TAGS.map((t) => ({ id: t, label: tagWords(t), to: `/blog/tag/${t}` }))]} />
      )}
      {drafts && <p className="blog-drafts-note">Preview mode: drafts and scheduled posts are showing. They are never public. Add ?drafts=0 to hide them, or ?drafts=1 to include private posts.</p>}

      {posts.length === 0 ? (
        <EmptyState kicker={tag ? tagWords(tag) : "Blog"} title={tag ? "Nothing here yet" : "The first posts land soon"}
          action={<><ButtonLink to="/cfb">College football</ButtonLink><ButtonLink to="/about" variant="quiet">What's here</ButtonLink></>}>
          <p>{tag ? "No posts under this tag yet." : "Write-ups from the projects start here."} In the meantime, the college football sims are live on the board.</p>
        </EmptyState>
      ) : (
        <>
          <PostCard post={posts[0]} lead />
          {posts.length > 1 && <div className="plist">{posts.slice(1).map((p) => <PostCard key={p.slug} post={p} />)}</div>}
        </>
      )}
    </div>
  );
}
