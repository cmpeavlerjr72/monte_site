// Render a Markdown body the way the site's post page does (remark-gfm + remark-directive + remarkMvpeav), print the HTML.
// Used to check that a guest writer's converted text displays exactly as typed (writers' desk stress test, 2026-10-21).
//   node scripts/blog/render_check.mjs <file.md>
import { readFileSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import remarkMvpeav from "../../src/lib/blog/remarkMvpeav.mjs";

const md = readFileSync(process.argv[2], "utf8");
const html = await unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkMvpeav)
  .use(remarkRehype).use(rehypeStringify).process(md);
process.stdout.write(String(html));
