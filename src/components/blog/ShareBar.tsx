// src/components/blog/ShareBar.tsx: share a published post (2026-10-17).
//
// Text, Facebook and X get the post's link, and each app draws its own preview card from the page's og: tags.
// Instagram Stories ignores og: tags (a link there is only a sticker), so "IG Story" hands Instagram a finished
// 1080x1920 picture instead: the hero photo, the headline in the display face, the description, the shield and
// mvpeav.com, drawn here on a canvas from same-origin images (nothing uploaded, nothing stored). The link is copied at
// the same tap, so the story's link sticker is one paste. Where a phone can't share files (desktop), the picture
// downloads instead. Never shown on drafts: a preview link must not go anywhere.

import { useEffect, useRef, useState } from "react";
import shieldUrl from "../../assets/mv-shield.png";
import type { BlogMeta } from "../../lib/blog/posts";

const SITE = "https://www.mvpeav.com";
const W = 1080, H = 1920;
const NAVY = "#0b2d4b", GOLD = "#c2a35a";
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const postUrl = (slug: string) => `${SITE}/blog/${slug}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}

/** Greedy word wrap at `size`; null when it needs more than `maxLines`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] | null {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

/** The headline as big as it can be in five lines (ellipsized description in three). */
async function drawStory(post: BlogMeta): Promise<Blob | null> {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  try { await Promise.all([document.fonts.load(`800 100px ${DISPLAY}`), document.fonts.load(`700 40px ${DISPLAY}`)]); } catch { /* falls back */ }
  const [hero, shield] = await Promise.all([loadImage(post.hero || post.og_image || ""), loadImage(shieldUrl)]);

  // Layout first, then paint. The text block sits under the photo; a long headline pushes it up into the photo's
  // fade (the photo band shrinks with it) before the headline itself gets smaller. It always ends above the footer.
  const X = 72, MW = W - 2 * X;
  const FOOT = H - 300;                                    // footer baseline, clear of Instagram's reply bar
  const MAX_BOTTOM = FOOT - 150, MIN_TOP = hero ? 560 : 300, NATURAL_TOP = hero ? 1020 : 360;
  const title = post.title.toUpperCase();
  ctx.font = `400 40px ${SANS}`;
  let desc = wrap(ctx, post.description, MW, 3);
  if (!desc) {
    const words = post.description.split(/\s+/);
    while (words.length && !(desc = wrap(ctx, words.join(" ") + "…", MW, 3))) words.pop();
  }
  const descH = Math.max(0, (desc?.length || 0) - 1) * 54 + 12;
  let size = 112, lines: string[] = [title], top = NATURAL_TOP;
  for (; size >= 60; size -= 4) {
    ctx.font = `800 ${size}px ${DISPLAY}`;
    const l = wrap(ctx, title, MW, 5);
    if (!l) continue;
    const blockH = 100 + l.length * size * 0.98 + 70 + descH;
    lines = l;
    top = Math.min(NATURAL_TOP, MAX_BOTTOM - blockH);
    if (top >= MIN_TOP) break;
  }
  top = Math.max(top, MIN_TOP);

  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  const PH = top + 40;                                     // photo band ends where the text starts
  if (hero) {
    const s = Math.max(W / hero.naturalWidth, PH / hero.naturalHeight);
    const dw = hero.naturalWidth * s, dh = hero.naturalHeight * s;
    ctx.drawImage(hero, (W - dw) / 2, (PH - dh) / 2, dw, dh);
    const g = ctx.createLinearGradient(0, PH - 420, 0, PH);
    g.addColorStop(0, "rgba(11,45,75,0)");
    g.addColorStop(1, NAVY);
    ctx.fillStyle = g;
    ctx.fillRect(0, PH - 420, W, 421);
  }

  let y = top;
  ctx.fillStyle = GOLD;
  ctx.fillRect(X, y, 120, 8);
  y += 70;
  ctx.font = `700 40px ${DISPLAY}`;
  const kicker = (post.game ? `${post.game.away} at ${post.game.home}` : post.tags.slice(0, 2).join(" · ")).toUpperCase();
  ctx.fillText(kicker, X, y);
  y += 30;
  ctx.font = `800 ${size}px ${DISPLAY}`;
  ctx.fillStyle = "#fff";
  for (const l of lines) { y += size * 0.98; ctx.fillText(l, X, y); }
  y += 70;
  ctx.font = `400 40px ${SANS}`;
  ctx.fillStyle = "#d6dee8";
  for (const l of desc || []) { ctx.fillText(l, X, y); y += 54; }

  // Footer, clear of Instagram's reply bar: shield + mvpeav.com
  const fy = FOOT;
  if (shield) ctx.drawImage(shield, X, fy - 74, 92, 92 * (shield.naturalHeight / shield.naturalWidth));
  ctx.font = `700 52px ${DISPLAY}`;
  ctx.fillStyle = GOLD;
  ctx.fillText("MVPEAV.COM", X + 116, fy);
  return new Promise((ok) => c.toBlob((b) => ok(b), "image/png"));
}

const storyCache = new Map<string, Promise<File | null>>();
function storyFile(post: BlogMeta): Promise<File | null> {
  let p = storyCache.get(post.slug);
  if (!p) {
    p = drawStory(post).then((b) => (b ? new File([b], `mvpeav-${post.slug}.png`, { type: "image/png" }) : null)).catch(() => null);
    storyCache.set(post.slug, p);
  }
  return p;
}

const Icon = {
  text: <path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  ig: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </g>
  ),
  fb: <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21z" fill="currentColor" />,
  x: <path d="M17.5 3.5h3l-6.6 7.6 7.8 9.4h-6.1l-4.8-5.9-5.5 5.9h-3l7.1-7.9L2 3.5h6.2l4.3 5.3zm-1 15.3h1.7L7.6 5.1H5.8z" fill="currentColor" />,
  more: <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
};
const Svg = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{children}</svg>;

export function ShareBar({ post }: { post: BlogMeta }) {
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const url = postUrl(post.slug);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Draw the story picture as soon as the bar is on screen, so the IG tap can hand it over at once (a share sheet
  // must open inside the tap; waiting on a canvas first would lose it on iPhones).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { void storyFile(post); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { void storyFile(post); io.disconnect(); } }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [post]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const copy = () => navigator.clipboard?.writeText(url).catch(() => undefined);

  const igStory = async () => {
    void copy();
    const file = await storyFile(post);
    if (!file) { setToast("Couldn't make the story image. The link is copied."); return; }
    if (canShare && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        setToast("Link copied. In Instagram: Story, then the link sticker, then paste.");
      } catch { /* closed the sheet */ }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    setToast("Story image saved and link copied. Post the image to your story and add the link sticker.");
  };

  const more = async () => {
    try { await navigator.share({ title: post.title, text: post.description, url }); } catch { /* closed */ }
  };

  const enc = encodeURIComponent;
  return (
    <div className="share-bar" ref={ref} aria-label="Share this post">
      <a className="share-btn" href={`sms:?&body=${enc(`${post.title} ${url}`)}`}><Svg>{Icon.text}</Svg>Text</a>
      <button type="button" className="share-btn" onClick={igStory}><Svg>{Icon.ig}</Svg>IG Story</button>
      <a className="share-btn" href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`} target="_blank" rel="noopener noreferrer"><Svg>{Icon.fb}</Svg>Facebook</a>
      <a className="share-btn" href={`https://x.com/intent/post?text=${enc(post.title)}&url=${enc(url)}&via=${enc(post.author_x || "MVPeav")}`} target="_blank" rel="noopener noreferrer"><Svg>{Icon.x}</Svg>X</a>
      {canShare
        ? <button type="button" className="share-btn" onClick={more}><Svg>{Icon.more}</Svg>More</button>
        : <button type="button" className="share-btn" onClick={() => { void copy(); setToast("Link copied."); }}><Svg>{Icon.link}</Svg>Copy link</button>}
      {toast && <div className="share-toast" role="status">{toast}</div>}
    </div>
  );
}
