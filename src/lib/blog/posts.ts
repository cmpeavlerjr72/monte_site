// src/lib/blog/posts.ts: what the app knows about blog posts (2026-10-16).
//
// Metadata only (a few KB, compiled in by scripts/blog/vite-plugin-blog.mjs);
// each post's Markdown body is its own lazy chunk (`loadBody`). Importing this
// module never pulls in the Markdown renderer, so the board can use
// `postForGame` for its "Read the preview →" link at no cost: no fetch, no
// per-card work, and the answer is known on first render (no layout shift).
//
// VISIBILITY. A post shows when it is not a draft and its date has arrived.
// Drafts only exist in a BLOG_DRAFTS=1 build (the preview harness), and even
// there they show only after ?drafts=1 has been on a URL this session.

import { posts, draftsIncluded, loadBody, type BlogMeta } from "virtual:blog-index";

export type { BlogMeta };
export { loadBody };

const DRAFTS_KEY = "mvpeav:drafts";

/** Drafts are visible: a drafts build AND ?drafts=1 seen this session. */
export function showDrafts(): boolean {
  if (!draftsIncluded || typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("drafts");
    if (q === "1") sessionStorage.setItem(DRAFTS_KEY, "1");
    if (q === "0") sessionStorage.removeItem(DRAFTS_KEY);
    return sessionStorage.getItem(DRAFTS_KEY) === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("drafts") === "1";
  }
}

/** Is this post visible right now? (published, or a draft/scheduled post
 *  while drafts are on). */
export function isVisible(p: BlogMeta, now = Date.now(), drafts = showDrafts()): boolean {
  if (drafts) return true;
  return !p.draft && Date.parse(p.date) <= now;
}

/** Visible posts, newest first, optionally one tag. */
export function visiblePosts(tag?: string): BlogMeta[] {
  const drafts = showDrafts();
  const now = Date.now();
  return posts.filter((p) => isVisible(p, now, drafts) && (!tag || p.tags.includes(tag)));
}

export function postBySlug(slug: string): BlogMeta | undefined {
  const p = posts.find((x) => x.slug === slug);
  return p && isVisible(p) ? p : undefined;
}

/** game_id -> the newest visible post about that game. Built once per
 *  drafts-state; posts change only on a deploy. */
let gameMap: { drafts: boolean; map: Map<string, BlogMeta> } | null = null;
export function postForGame(gameId: string | number | null | undefined): BlogMeta | undefined {
  if (gameId == null || gameId === "") return undefined;
  const drafts = showDrafts();
  if (!gameMap || gameMap.drafts !== drafts) {
    const map = new Map<string, BlogMeta>();
    const now = Date.now();
    for (const p of posts) {           // newest first, so the first one wins
      if (!p.game || !isVisible(p, now, drafts)) continue;
      const k = String(p.game.game_id);
      if (!map.has(k)) map.set(k, p);
    }
    gameMap = { drafts, map };
  }
  return gameMap.map.get(String(gameId));
}

export const TAG_WORDS: Record<string, string> = {
  cfb: "College football",
  cbb: "College basketball",
  nhl: "NHL",
  "fantasy-ai": "Fantasy AI",
  previews: "Previews",
  receipts: "Receipts",
};
export const tagWords = (t: string) => TAG_WORDS[t] ?? t.replace(/-/g, " ");

export const fmtPostDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** The board URL that focuses a post's game. */
export function gameCardHref(g: NonNullable<BlogMeta["game"]>): string {
  return `/cfb/scoreboard?week=week${String(g.week).padStart(2, "0")}&game=${g.game_id}`;
}
export function gameSimsHref(g: NonNullable<BlogMeta["game"]>): string {
  return `/cfb/game?week=week${String(g.week).padStart(2, "0")}&game=${g.game_id}`;
}
