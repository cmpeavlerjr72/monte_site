// src/pages/blog/BlogPost.tsx: /blog/:slug (2026-10-16).
//
// Layout follows BLOG_SCOPE §5: tag kicker, headline, byline, hero, a
// 700px reading column, sign-off, a Receipts box, the responsible-gambling
// line on betting posts, related posts. A post tied to a game links to that
// game's live board card in its header and under its sim card, and once the
// game is final, grades the post's `pick` in one line.
//
// Crawlers never run this: X/Slack/Google get the post's tags and article HTML
// from the Express server (server/liveScores.ts, /blog routes). This sets the
// same title/description for in-app navigation.

import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ButtonLink, EmptyState, Pill } from "../../components/ui";
import { PostCard } from "../../components/blog/PostCard";
import { ShareBar } from "../../components/blog/ShareBar";
import { loadFinal } from "../../components/blog/SimGameEmbed";
import { Skeleton, SkeletonLines } from "../../components/Skeleton";
import {
  fmtPostDate, gameCardHref, loadBody, postBySlug, tagLine, visiblePosts, type BlogMeta,
} from "../../lib/blog/posts";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { trackClick } from "../../lib/track";
import type { BlockEdit } from "../../components/blog/Markdown";

const Markdown = lazy(() => import("../../components/blog/Markdown"));

/** How far readers get (owner 2026-10-21, the desk's Metrics): one "read:50" when the middle of the article has been on
 *  screen and one "read:100" when its end has, once per post per page view. Live posts only (never a draft preview). */
function useReadDepth(slug: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const sent = new Set<string>();
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = document.querySelector("article.post .post-body") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.height < 50) return;
      const seen = (window.innerHeight - r.top) / r.height;      // share of the article that has reached the screen
      for (const [mark, at] of [["read:50", 0.5], ["read:100", 0.97]] as const) {
        if (seen >= at && !sent.has(mark)) { sent.add(mark); trackClick(mark); }
      }
      if (sent.size === 2) window.removeEventListener("scroll", onScroll);
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(check); };
    window.addEventListener("scroll", onScroll, { passive: true });
    const t = window.setTimeout(check, 1500);                 // a short post can be fully on screen without scrolling
    return () => { window.removeEventListener("scroll", onScroll); window.clearTimeout(t); if (raf) window.cancelAnimationFrame(raf); };
  }, [slug, ready]);
}

/** Did the post's pick hit? Spread/ML sides are away/home; totals over/under. */
function grade(pick: NonNullable<BlogMeta["pick"]>, f: { home: number; away: number }): "hit" | "miss" | "push" {
  const margin = pick.side === "away" ? f.away - f.home : f.home - f.away;
  if (pick.market === "ml") return margin > 0 ? "hit" : margin < 0 ? "miss" : "push";
  if (pick.market === "spread") {
    const v = margin + (pick.line ?? 0);
    return v > 0 ? "hit" : v < 0 ? "miss" : "push";
  }
  const total = f.home + f.away;
  const v = pick.side === "over" ? total - (pick.line ?? 0) : (pick.line ?? 0) - total;
  return v > 0 ? "hit" : v < 0 ? "miss" : "push";
}

function PickResult({ post }: { post: BlogMeta }) {
  const [fin, setFin] = useState<{ home: number; away: number } | null>(null);
  const g = post.game, pick = post.pick;
  useEffect(() => {
    if (!g || !pick) return;
    let alive = true;
    loadFinal(g.season, g.week, String(g.game_id)).then((f) => { if (alive) setFin(f); });
    return () => { alive = false; };
  }, [g, pick]);
  if (!g || !pick || !fin) return null;
  const r = grade(pick, fin);
  return (
    <div className={`pick-result pick-result--${r}`}>
      <span className="kicker">Result</span>
      <span>Final: {g.away} {fin.away}, {g.home} {fin.home}</span>
      <span>{pick.label}</span>
      <Pill tone={r === "hit" ? "pos" : r === "miss" ? "neg" : "neutral"}>{r === "hit" ? "Hit" : r === "miss" ? "Miss" : "Push"}</Pill>
    </div>
  );
}

export default function BlogPost() {
  const { slug = "" } = useParams();
  const post = postBySlug(slug);
  const [body, setBody] = useState<string | null>(null);
  const related = post ? visiblePosts().filter((p) => p.slug !== post.slug && p.tags.some((t) => post.tags.includes(t))).slice(0, 3) : [];

  useEffect(() => {
    setBody(null);
    if (!post) return;
    let alive = true;
    loadBody[post.slug]?.().then((b) => { if (alive) setBody(b); });
    return () => { alive = false; };
  }, [post?.slug]);
  useReadDepth(post?.slug || "", Boolean(post && !post.draft && body != null));

  useDocumentMeta(post ? {
    title: post.title, description: post.description, type: "article",
    image: post.og_image ?? `/blog/${post.slug}/og.png`,
    noindex: post.draft,
  } : { title: "Post not found", noindex: true });

  if (!post) {
    return (
      <EmptyState kicker="Blog" title="That post isn't here"
        action={<><ButtonLink to="/blog">All posts</ButtonLink><ButtonLink to="/" variant="quiet">Home</ButtonLink></>}>
        <p>It may have moved, or it isn't published yet.</p>
      </EmptyState>
    );
  }

  return <PostArticle post={post} body={body} related={related} />;
}

/** The article itself, shared by /blog/:slug and the private draft preview (/preview/:token). `banner` replaces the
 *  draft note; `related` is left out of previews. */
export function PostArticle({ post, body, related = [], banner, edit, onHero, before }: {
  post: BlogMeta; body: string | null; related?: BlogMeta[]; banner?: React.ReactNode; edit?: BlockEdit;
  /** The draft workspace: an options button on the hero. */
  onHero?: () => void;
  /** The draft workspace: panels between the header and the hero. */
  before?: React.ReactNode;
}) {
  // Barstool format: most posts OPEN with an embed. When the body's first
  // block is the hero image itself, the hero is not drawn twice.
  const firstImage = body == null ? null : /^\s*(?:<!--[\s\S]*?-->\s*)*!\[[^\]]*\]\(([^)\s]+)/.exec(body)?.[1] ?? null;
  const showHero = !!post.hero && (body == null || firstImage !== post.hero);
  const g = post.game;

  return (
    <article className="post">
      {banner ?? (post.draft && (
        <div className="post-draft" role="note">
          <b>Draft preview.</b> Not public: drafts are left out of production builds, the sitemap and RSS. Owner-beat notes show only here.
        </div>
      ))}
      <header className="post-head">
        <div className="kicker">{tagLine(post.tags)}</div>
        <h1 className="post-title">{post.title}</h1>
        <div className="post-by">
          By <b>{post.author}</b> · <a href={`https://x.com/${post.author_x}`} target="_blank" rel="noopener noreferrer">@{post.author_x}</a>
          {" · "}<time dateTime={post.date}>{fmtPostDate(post.date)}</time> · {post.minutes} min read
        </div>
        {g && (
          <div className="post-game">
            <span>{g.away} at {g.home}{g.kickoff ? ` · ${new Date(g.kickoff).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</span>
            <Link className="simcard__link" to={gameCardHref(g)}>See the live game card →</Link>
          </div>
        )}
        <PickResult post={post} />
        {!post.draft && <ShareBar post={post} />}
      </header>

      {before}

      {showHero && (
        <figure className={onHero ? "post-hero ws-media" : "post-hero"}>
          <img src={post.hero ?? undefined} alt={post.hero_alt} decoding="async" />
          {/* A Commons hero's license asks for a credit line (e.g. "Photo: X / Wikimedia Commons, CC BY-SA 4.0"). */}
          {post.hero_credit && <figcaption><span className="post-photo__credit">{post.hero_credit}</span></figcaption>}
          {onHero && <button type="button" className="ws-media__btn" onClick={onHero}>✎ Hero options</button>}
        </figure>
      )}

      {body == null ? (
        <div className="post-body" aria-busy="true"><SkeletonLines rows={6} height={16} /><Skeleton height={200} style={{ marginTop: 16 }} /></div>
      ) : (
        <Suspense fallback={<div className="post-body"><SkeletonLines rows={6} height={16} /></div>}>
          <Markdown body={body} draft={post.draft} edit={edit} />
        </Suspense>
      )}

      <footer className="post-foot">
        {!post.draft && body != null && <ShareBar post={post} />}
        <a className="btn-link btn-link--primary" href={`https://x.com/${post.author_x}`} target="_blank" rel="noopener noreferrer">Follow @{post.author_x}</a>
        {post.sources.length > 0 && (
          <section className="receipts" aria-label="Receipts">
            <div className="kicker">Receipts</div>
            <ul>{post.sources.map((s) => <li key={s}>{s}</li>)}</ul>
            <p className="receipts__note">Numbers are as of publish unless a card says "live". Every pick is graded on the <Link to="/cfb/record">record page</Link>.</p>
          </section>
        )}
        {post.disclaimer === "betting" && (
          <p className="post-disclaimer">For entertainment and research. Not betting advice. 21+. Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a>. Bet responsibly.</p>
        )}
      </footer>

      {related.length > 0 && (
        <section className="home-sec post-related" aria-label="Related posts">
          <div className="home-sec__head"><h2 className="home-sec__title">More like this</h2><Link className="link" to="/blog">All posts →</Link></div>
          <div className="pgrid">{related.map((p) => <PostCard key={p.slug} post={p} />)}</div>
        </section>
      )}
    </article>
  );
}
