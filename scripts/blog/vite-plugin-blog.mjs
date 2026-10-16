// scripts/blog/vite-plugin-blog.mjs: compiles content/blog/*.md into the app.
//
//   import { posts, loadBody } from "virtual:blog-index";
//     posts     metadata for every INCLUDED post (no body), newest first
//     loadBody  slug -> () => Promise<string>, one lazy chunk per post
//
// DRAFTS ARE NOT IN A PRODUCTION BUILD AT ALL. A post with `draft: true` is
// included only when BLOG_DRAFTS=1 is set for the build (the local preview
// harness sets it) or under `vite dev`. Render's build sets neither, so no
// draft's text, title or slug can end up in dist/ where anyone could fetch a
// chunk. Inside a drafts-enabled build the UI still hides drafts unless the
// URL carries ?drafts=1.
//
// Same parser as scripts/build_blog.mjs (frontmatter.mjs), so the app and the
// server's meta tags read identical metadata. Validation (and failing the
// build) is build_blog.mjs's job; this plugin skips a post it cannot parse.

import path from "node:path";
import { loadPosts, metaOf } from "./frontmatter.mjs";

const INDEX_ID = "virtual:blog-index";
const POST_PREFIX = "virtual:blog-post/";

export default function blogPlugin() {
  let root = process.cwd();
  let includeDrafts = false;
  return {
    name: "mvpeav-blog",
    configResolved(cfg) {
      root = cfg.root;
      includeDrafts = cfg.command === "serve" || process.env.BLOG_DRAFTS === "1";
    },
    resolveId(id) {
      if (id === INDEX_ID) return "\0" + INDEX_ID;
      if (id.startsWith(POST_PREFIX)) return "\0" + id;
      return null;
    },
    load(id) {
      // Without drafts the private folder is not even read.
      const posts = loadPosts(root, { includePrivate: includeDrafts })
        .filter((p) => !p.errors.length && p.data.slug && (includeDrafts || metaOf(p).draft !== true));
      if (id === "\0" + INDEX_ID) {
        for (const p of posts) this.addWatchFile(p.full);
        const metas = posts.map(metaOf).sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const loaders = metas.map((m) => `  ${JSON.stringify(m.slug)}: () => import(${JSON.stringify(POST_PREFIX + m.slug)}).then((m) => m.default),`).join("\n");
        return [
          `export const draftsIncluded = ${JSON.stringify(includeDrafts)};`,
          `export const posts = ${JSON.stringify(metas)};`,
          `export const loadBody = {\n${loaders}\n};`,
        ].join("\n");
      }
      if (id.startsWith("\0" + POST_PREFIX)) {
        const slug = id.slice(("\0" + POST_PREFIX).length);
        const post = posts.find((p) => p.data.slug === slug);
        if (!post) return "export default '';";
        this.addWatchFile(post.full);
        return `export default ${JSON.stringify(post.body)};`;
      }
      return null;
    },
    configureServer(server) {
      const dir = path.join(root, "content");
      server.watcher.add(path.join(dir, "blog"));
      server.watcher.add(path.join(dir, "blog-private"));
      const reload = (file) => {
        if (!file.startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById("\0" + INDEX_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", reload);
      server.watcher.on("change", reload);
      server.watcher.on("unlink", reload);
    },
  };
}
