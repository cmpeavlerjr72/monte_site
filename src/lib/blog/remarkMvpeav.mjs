// src/lib/blog/remarkMvpeav.mjs: the blog's Markdown extensions, as ONE remark
// plugin shared by the app (react-markdown, src/components/blog/Markdown.tsx)
// and the crawler-HTML build (scripts/build_blog.mjs). Plain JS on purpose: the
// build script runs on Render's Node, which may not strip TypeScript.
//
// Runs after remark-directive. What it does to the Markdown tree:
//
//   :::callout{kind=hand-up} ... :::   -> <aside class="callout callout--hand-up">
//   ::sim-game{season week game}       -> <sim-game>     (read-only game card)
//   ::record-card{frozen}              -> <record-card>  (record tile)
//   ::x-post{url img}                  -> <x-post>       (tweet screenshot, linked)
//   any other ::directive              -> a visible "unknown embed" note, never a crash
//   an unknown :text directive         -> put back as the literal text it was
//                                         ("Note:this" must not vanish)
//   a paragraph holding ONE image      -> <figure> + <figcaption> from its title
//   <!-- OWNER BEAT: ... -->           -> <owner-beat> (drafts show it, published hides it)
//   any other raw HTML                 -> dropped (posts never render raw HTML)

const KNOWN_LEAF = new Set(["sim-game", "record-card", "x-post"]);

function textOf(node) {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children || []).map(textOf).join("");
}

function attrs(node) {
  const out = {};
  for (const [k, v] of Object.entries(node.attributes || {})) out[k] = v == null ? "" : String(v);
  return out;
}

function transform(parent) {
  const kids = parent.children;
  if (!Array.isArray(kids)) return;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];

    if (node.type === "html") {
      const m = /^<!--\s*OWNER BEAT:?\s*([\s\S]*?)\s*-->\s*$/.exec(node.value || "");
      if (m) {
        kids[i] = { type: "ownerBeat", data: { hName: "owner-beat", hProperties: { note: m[1] } }, children: [] };
      } else {
        kids.splice(i, 1); i--;
      }
      continue;
    }

    if (node.type === "containerDirective") {
      const a = attrs(node);
      if (node.name === "callout") {
        const kind = a.kind || "note";
        node.data = { hName: "aside", hProperties: { className: ["callout", `callout--${kind}`], dataKind: kind } };
      } else {
        node.data = { hName: "div", hProperties: { className: ["directive-unknown"], dataName: node.name } };
      }
      transform(node);
      continue;
    }

    if (node.type === "leafDirective") {
      const a = attrs(node);
      if (KNOWN_LEAF.has(node.name)) {
        node.data = { hName: node.name, hProperties: a };
        node.children = [];
      } else {
        node.data = { hName: "div", hProperties: { className: ["directive-unknown"], dataName: node.name } };
        node.children = [{ type: "text", value: `Unknown embed: ::${node.name}` }];
      }
      continue;
    }

    if (node.type === "textDirective") {
      kids[i] = { type: "text", value: `:${node.name}${textOf(node) ? `[${textOf(node)}]` : ""}` };
      continue;
    }

    if (node.type === "paragraph" && node.children?.length === 1 && node.children[0].type === "image") {
      const img = node.children[0];
      node.data = { hName: "figure", hProperties: { className: ["post-figure"] } };
      if (img.title) {
        node.children = [img, { type: "figcaptionNode", data: { hName: "figcaption" }, children: [{ type: "text", value: img.title }] }];
      }
      continue;
    }

    transform(node);
  }
}

/** remark plugin. Use after remark-directive (and remark-gfm). */
export default function remarkMvpeav() {
  return (tree) => { transform(tree); };
}
