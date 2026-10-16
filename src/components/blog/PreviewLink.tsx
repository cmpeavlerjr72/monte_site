// src/components/blog/PreviewLink.tsx: "Read the preview →" on a game that has
// a visible blog post (the V2 board's cards, Game sims).
//
// Synchronous: the post map is compiled-in metadata (src/lib/blog/posts.ts),
// so the link is decided on first render. A game with no post renders null:
// no element, no reserved space, the card exactly as it was.

import { Link } from "react-router-dom";
import { postForGame } from "../../lib/blog/posts";

export function PreviewLink({ gameId, compact = false }: { gameId: string; compact?: boolean }) {
  const post = postForGame(gameId);
  if (!post) return null;
  const isPreview = post.tags.includes("previews");
  return (
    <Link
      to={`/blog/${post.slug}`}
      className={`preview-link${compact ? " preview-link--compact" : ""}`}
      title={post.title}
      onClick={(e) => e.stopPropagation()}
    >
      {post.draft && <span className="preview-link__draft">Draft</span>}
      {isPreview ? "Read the preview" : "Read the post"} →
    </Link>
  );
}
