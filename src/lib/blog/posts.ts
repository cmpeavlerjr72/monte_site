// src/lib/blog/posts.ts: what the app knows about blog posts (2026-10-16).
//
// Metadata only (a few KB, compiled in by scripts/blog/vite-plugin-blog.mjs);
// each post's Markdown body is its own lazy chunk (`loadBody`). Importing this
// module never pulls in the Markdown renderer, so the board can use
// `postForGame` for its "Read the preview →" link at no cost: no fetch, no
// per-card work, and the answer is known on first render (no layout shift).
//
// VISIBILITY. A post shows when it is not a draft and its date has arrived.
// Drafts only exist in a BLOG_DRAFTS=1 build (the preview harness), where they
// show by default so the owner sees the blog as it will look. Held posts (a
// `hold:` line, e.g. Team Tillman until Tillman OKs it) stay hidden unless
// ?drafts=1 is on a URL this session; ?drafts=0 hides every draft.

import { posts, draftsIncluded, loadBody, type BlogMeta } from "virtual:blog-index";

export type { BlogMeta };
export { loadBody };

const DRAFTS_KEY = "mvpeav:drafts";

type DraftMode = "off" | "on" | "all";

/** off: production rules. on (a drafts build's default): drafts and scheduled
 *  posts too. all (?drafts=1 seen this session): held posts as well. */
function draftMode(): DraftMode {
  if (!draftsIncluded || typeof window === "undefined") return "off";
  const q = new URLSearchParams(window.location.search).get("drafts");
  try {
    if (q === "0") sessionStorage.setItem(DRAFTS_KEY, "off");
    if (q === "1") sessionStorage.setItem(DRAFTS_KEY, "all");
    const v = sessionStorage.getItem(DRAFTS_KEY);
    return v === "off" || v === "all" ? v : "on";
  } catch {
    return q === "0" ? "off" : q === "1" ? "all" : "on";
  }
}

/** Drafts are showing (the preview banner reads this). */
export function showDrafts(): boolean {
  return draftMode() !== "off";
}

/** Is this post visible right now? (published, or a draft/scheduled post
 *  while drafts are on; a held one only with ?drafts=1). */
export function isVisible(p: BlogMeta, now = Date.now(), mode: DraftMode = draftMode()): boolean {
  if (p.held) return mode === "all";
  if (mode !== "off") return true;
  return !p.draft && Date.parse(p.date) <= now;
}

/** Visible posts, newest first, optionally one tag. */
export function visiblePosts(tag?: string): BlogMeta[] {
  const mode = draftMode();
  const now = Date.now();
  return posts.filter((p) => isVisible(p, now, mode) && (!tag || p.tags.includes(tag)));
}

export function postBySlug(slug: string): BlogMeta | undefined {
  const p = posts.find((x) => x.slug === slug);
  return p && isVisible(p) ? p : undefined;
}

/** game_id -> the newest visible post about that game. Built once per
 *  drafts-state; posts change only on a deploy. */
let gameMap: { mode: DraftMode; map: Map<string, BlogMeta> } | null = null;
export function postForGame(gameId: string | number | null | undefined): BlogMeta | undefined {
  if (gameId == null || gameId === "") return undefined;
  const mode = draftMode();
  if (!gameMap || gameMap.mode !== mode) {
    const map = new Map<string, BlogMeta>();
    const now = Date.now();
    for (const p of posts) {           // newest first, so the first one wins
      if (!p.game || !isVisible(p, now, mode)) continue;
      const k = String(p.game.game_id);
      if (!map.has(k)) map.set(k, p);
    }
    gameMap = { mode, map };
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

/** A post's tags as words, each said once (cfb and college-football both read "College football"), at most `max`. */
export function tagLine(tags: string[], max = Infinity): string {
  const seen = new Set<string>(), out: string[] = [];
  for (const t of tags) {
    const w = tagWords(t), k = w.toLowerCase();
    if (!seen.has(k) && out.length < max) { seen.add(k); out.push(w); }
  }
  return out.join(" · ");
}

export const fmtPostDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** The board URL that focuses a post's game. */
export function gameCardHref(g: NonNullable<BlogMeta["game"]>): string {
  return `/cfb/scoreboard?week=week${String(g.week).padStart(2, "0")}&game=${g.game_id}`;
}
