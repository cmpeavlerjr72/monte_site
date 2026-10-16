// scripts/blog/frontmatter.mjs: THE ONE frontmatter parser for the blog.
//
// Used by the Vite plugin (scripts/blog/vite-plugin-blog.mjs, which compiles
// posts into the app) AND by scripts/build_blog.mjs (crawler HTML, index.json,
// sitemap, RSS), so the client and the server's meta tags can never disagree
// about a post. Node-only; the browser never parses YAML.
//
// A deliberate YAML SUBSET, enough for BLOG_SCOPE §3 and nothing clever:
//   key: value                 strings (quoted or bare), numbers, true/false
//   key: [a, b, "c d"]         inline lists
//   key:                       block list of "- item" lines, or
//     sub: value               a one-level nested map (game:, pick:)
//   # comments, blank lines
// Anything it does not understand is a parse ERROR, never a silent guess:
// build_blog.mjs turns errors into a failed build before a push.

import fs from "node:fs";
import path from "node:path";

function scalar(raw) {
  let v = raw.trim();
  if (v === "") return "";
  // Strip a trailing comment on unquoted values.
  if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, "");
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    const inner = v.slice(1, -1);
    return v.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const body = v.slice(1, -1).trim();
    if (!body) return [];
    const out = [];
    let cur = "", q = null;
    for (const ch of body) {
      if (q) { if (ch === q) q = null; cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === ",") { out.push(scalar(cur)); cur = ""; continue; }
      cur += ch;
    }
    out.push(scalar(cur));
    return out;
  }
  if (v.startsWith("{")) throw new Error(`inline maps are not supported: ${v}`);
  return v;
}

/** Split a Markdown file into { data, body, errors }. */
export function parseFrontmatter(text) {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return { data: {}, body: src, errors: ["missing --- frontmatter block"] };
  const lines = m[1].split("\n");
  const data = {};
  const errors = [];
  let parentKey = null;   // key whose value is a block (list or map)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indented = /^\s+/.test(line);
    try {
      if (indented) {
        if (!parentKey) throw new Error("indented line with no parent key");
        const t = line.trim();
        if (t.startsWith("- ")) {
          if (!Array.isArray(data[parentKey])) {
            if (data[parentKey] && Object.keys(data[parentKey]).length) throw new Error(`${parentKey}: mixes a list and a map`);
            data[parentKey] = [];
          }
          data[parentKey].push(scalar(t.slice(2)));
        } else {
          const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(t);
          if (!kv) throw new Error(`cannot parse: ${t}`);
          if (Array.isArray(data[parentKey])) throw new Error(`${parentKey}: mixes a list and a map`);
          data[parentKey] ??= {};
          data[parentKey][kv[1]] = scalar(kv[2]);
        }
        continue;
      }
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (!kv) throw new Error(`cannot parse: ${line}`);
      const [, key, rest] = kv;
      if (key in data) throw new Error(`duplicate key: ${key}`);
      if (rest.trim() === "") { data[key] = null; parentKey = key; continue; }
      data[key] = scalar(rest);
      parentKey = null;
    } catch (e) {
      errors.push(`line ${i + 2}: ${e.message}`);
    }
  }
  // A block key that never got children stays null.
  for (const k of Object.keys(data)) if (data[k] === null) data[k] = undefined;
  return { data, body: m[2], errors };
}

/** Words-per-minute estimate on the prose only (no comments, no directives). */
export function readMinutes(body) {
  const words = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^:{2,3}.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** Every post, parsed. Never filters drafts: callers do.
 *
 *  content/blog/          committed posts (the GitHub repo is PUBLIC, so a
 *                         committed draft is readable there; fine for the
 *                         owner's own unpublished posts)
 *  content/blog-private/  GITIGNORED posts that must never reach GitHub at all
 *                         (the Team Tillman reveal). Always treated as drafts;
 *                         build_blog.mjs fails if one says draft: false. Their
 *                         images live in the equally ignored public/blog-private/.
 *  Pass { includePrivate: false } to skip the private folder entirely. */
export function loadPosts(rootDir, { includePrivate = true } = {}) {
  const dirs = [["blog", false], ...(includePrivate ? [["blog-private", true]] : [])];
  const out = [];
  for (const [sub, isPrivate] of dirs) {
    const dir = path.join(rootDir, "content", sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const full = path.join(dir, file);
      const { data, body, errors } = parseFrontmatter(fs.readFileSync(full, "utf8"));
      out.push({ file: `${sub}/${file}`, full, data, body, errors, minutes: readMinutes(body), private: isPrivate });
    }
  }
  return out;
}

/** The metadata the client and the server both see (no body). */
export function metaOf(post) {
  const d = post.data;
  return {
    slug: d.slug, title: d.title, description: d.description,
    date: d.date, updated: d.updated ?? null,
    author: d.author ?? "MVPeav", author_x: d.author_x ?? "MVPeav",
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    hero: d.hero ?? null, hero_alt: d.hero_alt ?? "",
    og_image: d.og_image ?? null,
    // A private post is a draft whatever its frontmatter says.
    draft: d.draft === true || post.private === true,
    disclaimer: d.disclaimer ?? "none",
    sources: Array.isArray(d.sources) ? d.sources.map(String) : [],
    game: d.game ?? null,
    pick: d.pick ?? null,
    minutes: post.minutes,
  };
}

/** A post is PUBLIC when it is not a draft and its date has arrived. */
export function isPublic(meta, now = Date.now()) {
  return !meta.draft && Date.parse(meta.date) <= now;
}
