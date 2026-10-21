/// <reference types="vite/client" />

/* The blog, compiled in by scripts/blog/vite-plugin-blog.mjs. */
declare module "virtual:blog-index" {
  export type BlogGame = {
    season: number; week: number; game_id: number | string;
    away: string; home: string; kickoff?: string;
  };
  export type BlogPick = {
    market: "spread" | "total" | "ml"; side: "away" | "home" | "over" | "under";
    line?: number; label: string;
  };
  export type BlogMeta = {
    slug: string; title: string; description: string;
    date: string; updated: string | null;
    author: string; author_x: string;
    tags: string[];
    hero: string | null; hero_alt: string; hero_credit?: string | null;
    og_image: string | null;
    draft: boolean;
    /** Has a `hold:` line: in a preview it shows only with ?drafts=1, never by default. */
    held?: boolean;
    disclaimer: "betting" | "none" | string;
    sources: string[];
    game: BlogGame | null;
    pick: BlogPick | null;
    minutes: number;
  };
  /** True only in a BLOG_DRAFTS=1 build (the preview harness) or vite dev. */
  export const draftsIncluded: boolean;
  /** Every included post, newest first. Drafts appear only when draftsIncluded. */
  export const posts: BlogMeta[];
  /** slug -> lazy loader for the post's Markdown body. */
  export const loadBody: Record<string, () => Promise<string>>;
}
