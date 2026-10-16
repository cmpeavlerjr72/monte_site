#!/usr/bin/env node
// scripts/build_blog.mjs: the crawler side of the blog, run after `vite build`
// (package.json "build"). Also the blog's GATE: it validates every post, and a
// broken post fails the build here, locally, before a push.
//
// Writes (PUBLIC posts only: not a draft, not private, date arrived):
//   dist/blog/index.json       metadata the Express meta route reads (server/liveScores.ts)
//   dist/blog/<slug>.html      sanitised article HTML the server inlines for crawlers
//   dist/blog/rss.xml          RSS 2.0, newest 20
//   dist/sitemap.xml           site pages + posts + tag pages
//   dist/robots.txt            public/robots.txt + the Sitemap line
// And strips from dist/ what a production build must never serve:
//   dist/blog-private/         (gitignored private posts' images; absent on Render)
//   dist/blog/<slug>/          for every DRAFT post (its images)
// unless BLOG_DRAFTS=1 (the local preview harness), which keeps them so the
// owner can review drafts at /blog/<slug>?drafts=1. index.json, RSS and the
// sitemap stay public-only in every build.
//
// Validation (exit 1): parse errors, missing title/slug/description/date, a
// bad slug or date, a duplicate slug, a description over 200 chars, a missing
// image, a malformed `game` or `pick`, a `hold` post or a private post that is
// not a draft. Warnings: description over 160, empty alt text, a game_id not
// found in that week's sim index (or the index could not be reached).
//
//   node scripts/build_blog.mjs            validate + write into dist/
//   node scripts/build_blog.mjs --check    validate only (no dist needed)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { loadPosts, metaOf, isPublic } from "./blog/frontmatter.mjs";
import remarkMvpeav from "../src/lib/blog/remarkMvpeav.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PUBLIC = path.join(ROOT, "public");
const SITE = "https://www.mvpeav.com";
const CHECK_ONLY = process.argv.includes("--check");
const KEEP_DRAFTS = process.env.BLOG_DRAFTS === "1";

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(s) && !Number.isNaN(Date.parse(s));
const imgExists = (src) => typeof src === "string" && src.startsWith("/") && fs.existsSync(path.join(PUBLIC, src));

async function weekIndexIds(season, week) {
  const url = `https://huggingface.co/datasets/mvpeav/cfb-sims-${season}/resolve/main/${season}/weeks/week${String(week).padStart(2, "0")}/index.json`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, ids: new Set((j.games || []).map((g) => String(g.game_id))) };
  } catch (e) {
    return { ok: false, why: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------- validate -- */
const posts = loadPosts(ROOT);
const seen = new Map();
const weekCache = new Map();
for (const p of posts) {
  const d = p.data;
  const f = `content/${p.file}`;
  for (const e of p.errors) err(f, `frontmatter ${e}`);
  for (const k of ["title", "slug", "description", "date"]) if (!d[k]) err(f, `missing ${k}`);
  if (d.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) err(f, `slug "${d.slug}" must be lowercase words joined by hyphens`);
  if (d.slug) {
    if (seen.has(d.slug)) err(f, `duplicate slug "${d.slug}" (also ${seen.get(d.slug)})`);
    seen.set(d.slug, f);
  }
  if (d.date && !isIso(String(d.date))) err(f, `date "${d.date}" is not ISO 8601`);
  if (d.updated && !isIso(String(d.updated))) err(f, `updated "${d.updated}" is not ISO 8601`);
  if (d.description && String(d.description).length > 200) err(f, `description is ${String(d.description).length} chars (max 200)`);
  else if (d.description && String(d.description).length > 160) warn(f, `description is ${String(d.description).length} chars; X and Google cut around 160`);
  if (d.tags !== undefined && !Array.isArray(d.tags)) err(f, "tags must be a list, e.g. [cfb, previews]");
  if (d.hold && d.draft !== true) err(f, `has a hold ("${d.hold}") but is not a draft: remove the hold line deliberately once cleared`);
  if (p.private && d.draft !== true) err(f, "is in content/blog-private/ (never published from there) but says draft: false: move it to content/blog/ to publish");
  if (d.hero && !imgExists(d.hero)) err(f, `hero ${d.hero} is missing from public/`);
  if (d.og_image && !imgExists(d.og_image)) err(f, `og_image ${d.og_image} is missing from public/`);
  for (const m of p.body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (!m[1].trim()) warn(f, `image ${m[2]} has no alt text`);
    if (m[2].startsWith("/") && !imgExists(m[2])) err(f, `image ${m[2]} is missing from public/`);
  }
  for (const m of p.body.matchAll(/::x-post\{[^}]*img="([^"]+)"/g)) if (!imgExists(m[1])) err(f, `x-post image ${m[1]} is missing from public/`);

  if (d.game !== undefined) {
    const g = d.game;
    const bad = (why) => err(f, `game: ${why}`);
    if (!g || typeof g !== "object" || Array.isArray(g)) bad("must be a map (season, week, game_id, away, home, kickoff)");
    else {
      if (!Number.isInteger(g.season) || g.season < 2000) bad(`season "${g.season}" must be a year`);
      if (!Number.isInteger(g.week) || g.week < 0 || g.week > 20) bad(`week "${g.week}" must be 0-20`);
      if (!/^\d{5,}$/.test(String(g.game_id ?? ""))) bad(`game_id "${g.game_id}" must be the numeric ESPN/CFBD id`);
      for (const k of ["away", "home"]) if (typeof g[k] !== "string" || !g[k].trim()) bad(`${k} is required`);
      if (g.kickoff !== undefined && !isIso(String(g.kickoff))) bad(`kickoff "${g.kickoff}" is not ISO 8601`);
      if (Number.isInteger(g.season) && Number.isInteger(g.week) && /^\d+$/.test(String(g.game_id ?? ""))) {
        const key = `${g.season}/${g.week}`;
        if (!weekCache.has(key)) weekCache.set(key, await weekIndexIds(g.season, g.week));
        const wk = weekCache.get(key);
        if (!wk.ok) warn(f, `game_id ${g.game_id}: could not reach the ${key} sim index (${wk.why}); not verified`);
        else if (!wk.ids.has(String(g.game_id))) warn(f, `game_id ${g.game_id} is not in the ${key} sim index`);
      }
    }
  }
  if (d.pick !== undefined) {
    const k = d.pick;
    const sides = { spread: ["away", "home"], ml: ["away", "home"], total: ["over", "under"] };
    if (!k || typeof k !== "object") err(f, "pick: must be a map (market, side, line, label)");
    else {
      if (!sides[k.market]) err(f, `pick: market "${k.market}" must be spread, total or ml`);
      else if (!sides[k.market].includes(k.side)) err(f, `pick: side "${k.side}" must be ${sides[k.market].join(" or ")} for ${k.market}`);
      if ((k.market === "spread" || k.market === "total") && typeof k.line !== "number") err(f, "pick: line must be a number");
      if (typeof k.label !== "string" || !k.label.trim()) err(f, "pick: label is required");
      if (!d.game) err(f, "pick: needs a game");
    }
  }
}

for (const w of warnings) console.warn(`[blog] warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`[blog] ERROR ${e}`);
  console.error(`[blog] ${errors.length} error(s): fix the post(s) above. The build stops here so a broken post never deploys.`);
  process.exit(1);
}
const metas = posts.map((p) => ({ ...metaOf(p), _private: p.private, _body: p.body }));
const pub = metas.filter((m) => !m._private && isPublic(m)).sort((a, b) => b.date.localeCompare(a.date));
console.log(`[blog] ${posts.length} post(s) valid; ${pub.length} public, ${metas.length - pub.length} draft/scheduled/private`);
if (CHECK_ONLY) process.exit(0);

if (!fs.existsSync(DIST)) { console.error("[blog] dist/ is missing: run vite build first"); process.exit(1); }

/* --------------------------------------------------------------- render -- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Custom embed elements -> plain crawler HTML (no scripts, no order UI). */
function rehypeCrawlerEmbeds() {
  const walk = (node) => {
    if (!node.children) return;
    node.children = node.children.flatMap((c) => {
      if (c.type !== "element") { walk(c); return [c]; }
      const p = c.properties || {};
      if (c.tagName === "owner-beat") return [];
      if (c.tagName === "sim-game") {
        const href = `/cfb/scoreboard?week=week${String(p.week ?? "").padStart(2, "0")}&game=${p.game ?? ""}`;
        return [{ type: "element", tagName: "p", properties: {}, children: [
          { type: "element", tagName: "a", properties: { href }, children: [{ type: "text", value: "See the live game card" }] }] }];
      }
      if (c.tagName === "record-card") {
        return [{ type: "element", tagName: "p", properties: {}, children: [
          { type: "element", tagName: "a", properties: { href: "/cfb/record" }, children: [{ type: "text", value: "The full record" }] }] }];
      }
      if (c.tagName === "x-post") {
        const kids = p.img ? [{ type: "element", tagName: "img", properties: { src: p.img, alt: "Post on X" }, children: [] }] : [{ type: "text", value: "Post on X" }];
        return [{ type: "element", tagName: "p", properties: {}, children: [{ type: "element", tagName: "a", properties: { href: p.url || "#" }, children: kids }] }];
      }
      walk(c);
      return [c];
    });
  };
  return (tree) => walk(tree);
}

const processor = unified()
  .use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkMvpeav)
  .use(remarkRehype).use(rehypeCrawlerEmbeds).use(rehypeStringify);

const ogOf = (m) => {
  if (m.og_image) return m.og_image;
  const card = `/blog/${m.slug}/og.png`;
  return fs.existsSync(path.join(PUBLIC, card)) ? card : "/og-default.png";
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

const outDir = path.join(DIST, "blog");
fs.mkdirSync(outDir, { recursive: true });
const index = [];
for (const m of pub) {
  const body = String(await processor.process(m._body));
  const article = `<article class="post-ssr"><p>${esc(m.tags.join(" · ").toUpperCase())}</p><h1>${esc(m.title)}</h1>` +
    `<p>By ${esc(m.author)} · <a href="https://x.com/${esc(m.author_x)}">@${esc(m.author_x)}</a> · <time datetime="${esc(m.date)}">${esc(fmtDate(m.date))}</time></p>` +
    (m.hero ? `<figure><img src="${esc(m.hero)}" alt="${esc(m.hero_alt)}"></figure>` : "") + body + `</article>`;
  fs.writeFileSync(path.join(outDir, `${m.slug}.html`), article);
  const { _private, _body, ...meta } = m;
  index.push({ ...meta, og_image: ogOf(m), url: `${SITE}/blog/${m.slug}` });
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));

/* -------------------------------------------------------- feeds + robots -- */
const tagsUsed = [...new Set(pub.flatMap((m) => m.tags))].sort();
const staticPages = ["/", "/blog", "/cfb/scoreboard", "/cfb/record", "/cfb/quads", "/cbb/scoreboard", "/cbb/results", "/about", "/about/how-it-works", "/labs"];
const urls = [
  ...staticPages.map((u) => `<url><loc>${SITE}${u}</loc></url>`),
  ...tagsUsed.map((t) => `<url><loc>${SITE}/blog/tag/${encodeURIComponent(t)}</loc></url>`),
  ...pub.map((m) => `<url><loc>${SITE}/blog/${m.slug}</loc><lastmod>${new Date(m.updated || m.date).toISOString()}</lastmod></url>`),
];
fs.writeFileSync(path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);

const items = pub.slice(0, 20).map((m) => `  <item>
    <title>${esc(m.title)}</title>
    <link>${SITE}/blog/${m.slug}</link>
    <guid isPermaLink="true">${SITE}/blog/${m.slug}</guid>
    <pubDate>${new Date(m.date).toUTCString()}</pubDate>
    <description>${esc(m.description)}</description>
${m.tags.map((t) => `    <category>${esc(t)}</category>`).join("\n")}
  </item>`).join("\n");
fs.writeFileSync(path.join(outDir, "rss.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>MVPEAV blog</title>
  <link>${SITE}/blog</link>
  <atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml" />
  <description>Write-ups from MVPeav's projects: sports sims, the fantasy AI experiment, and whatever's next.</description>
  <language>en-us</language>
${items}
</channel>
</rss>
`);

const robotsSrc = path.join(PUBLIC, "robots.txt");
const robots = (fs.existsSync(robotsSrc) ? fs.readFileSync(robotsSrc, "utf8").trimEnd() : "User-agent: *\nAllow: /")
  .split("\n").filter((l) => !/^Sitemap:/i.test(l)).join("\n");
fs.writeFileSync(path.join(DIST, "robots.txt"), `${robots}\n\nSitemap: ${SITE}/sitemap.xml\n`);

/* ------------------------------------------------- strip draft-only files -- */
if (!KEEP_DRAFTS) {
  const gone = [];
  const priv = path.join(DIST, "blog-private");
  if (fs.existsSync(priv)) { fs.rmSync(priv, { recursive: true, force: true }); gone.push("blog-private/"); }
  for (const m of metas.filter((x) => x.draft)) {
    const dir = path.join(outDir, m.slug);
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); gone.push(`blog/${m.slug}/`); }
  }
  if (gone.length) console.log(`[blog] removed draft-only files from dist: ${gone.join(", ")}`);
}
console.log(`[blog] wrote dist/blog/index.json (${index.length}), ${index.length} article fragment(s), rss.xml, sitemap.xml (${urls.length} urls), robots.txt`);
