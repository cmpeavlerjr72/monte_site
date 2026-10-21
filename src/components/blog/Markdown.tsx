// src/components/blog/Markdown.tsx: renders a post body. Lazy blog chunk only.
//
// react-markdown + GFM + remark-directive + the site's own transform
// (src/lib/blog/remarkMvpeav.mjs, shared with the crawler-HTML build). Raw HTML
// in a post is never rendered. Embeds map to read-only components: nothing in
// a post can show an order, Tail or price button.

import { createContext, createElement, useContext, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkMvpeav from "../../lib/blog/remarkMvpeav.mjs";
import { SimGameEmbed } from "./SimGameEmbed";
import { RecordEmbed } from "./RecordEmbed";
import { GettyEmbed, PhotoEmbed, XEmbed, YouTubeEmbed } from "./MediaEmbeds";

type P = Record<string, unknown> & { node?: unknown; children?: React.ReactNode };
const str = (v: unknown) => (v == null ? "" : String(v));

/** Tap-to-edit in the owner's private preview (src/pages/blog/PreviewPost.tsx). Off everywhere else. A block is a
 *  top-level paragraph, heading, list or quote, addressed by its [start, end) offsets in `body`. */
export type BlockEdit = {
  active: number | null;
  onTap: (start: number, end: number) => void;
  render: (start: number, end: number) => React.ReactNode;
  /** The draft workspace (2026-10-19): an image / embed carrying a `wsid` (the bot's image id) gets an options button. */
  onMedia?: (wsid: string) => void;
  /** The draft workspace: an "add something here" affordance after each top-level block ([start, end) of that block). */
  renderInsert?: (start: number, end: number) => React.ReactNode;
};

// Only these top-level blocks can be tapped. Embeds, figures, callouts and owner beats are directives or wrappers and are
// changed from the bot.
const EDITABLE = new Set(["p", "h2", "h3", "ul", "ol", "blockquote", "table"]);   // table: 2026-10-21

type HastNode = { type: string; tagName?: string; position?: { start: { offset?: number }; end: { offset?: number } }; properties?: Record<string, unknown>; children?: HastNode[] };

/** rehype: stamp each editable top-level block with its source span (data-blk="start:end"). */
function rehypeBlockSpans() {
  return (tree: HastNode) => {
    for (const c of tree.children || []) {
      const s = c.position?.start.offset, e = c.position?.end.offset;
      if (c.type === "element" && EDITABLE.has(c.tagName || "") && s != null && e != null) {
        c.properties = { ...(c.properties || {}), dataBlk: `${s}:${e}` };
      }
    }
  };
}

// The blocks read the edit hooks from context, so their component identity never changes between renders (a new identity
// would remount the open editor and drop what's being typed).
const EditCtx = createContext<BlockEdit | null>(null);

function editable(Tag: string) {
  return function EditableBlock({ node: _n, ...props }: P) {
    const edit = useContext(EditCtx);
    const span = str(props["data-blk"]);
    // a table keeps the site's scroll wrapper (the plain `table` component is replaced by this one while editing)
    const make = (p: Record<string, unknown>) => Tag === "table" ? <div className="post-table">{createElement("table", p)}</div> : createElement(Tag, p);
    if (!span || !edit) return make(props);
    const [s, e] = span.split(":").map(Number);
    const insert = edit.renderInsert ? edit.renderInsert(s, e) : null;
    if (edit.active === s) return <>{edit.render(s, e)}{insert}</>;
    return (
      <>
        {make({
          ...props,
          className: [str(props.className), "pe-block"].filter(Boolean).join(" "),
          onClick: (ev: React.MouseEvent) => {
            if ((ev.target as HTMLElement).closest("a")) return;          // links still work
            edit.onTap(s, e);
          },
        })}
        {insert}
      </>
    );
  };
}

/** An embed in the workspace: the embed as it renders on the site, plus an options button (an iframe or a lite player
 *  would swallow a tap on the embed itself). Without the workspace hook, or without a wsid, it is just the embed. */
function MediaFrame({ wsid, children }: { wsid: string; children: React.ReactNode }) {
  const edit = useContext(EditCtx);
  if (!edit?.onMedia || !wsid) return <>{children}</>;
  return (
    <div className="ws-media">
      {children}
      <button type="button" className="ws-media__btn" onClick={() => edit.onMedia!(wsid)} aria-label="Image options">✎ Image options</button>
    </div>
  );
}

const EDITABLE_COMPONENTS = Object.fromEntries([...EDITABLE].map((t) => [t, editable(t)]));

export default function Markdown({ body, draft, edit }: { body: string; draft: boolean; edit?: BlockEdit }) {
  const editing = !!edit;
  // Memoized: a fresh map would give every embed a new component type on each render and remount it (a Getty iframe
  // reloading on every keystroke in the preview editor).
  const components = useMemo(() => ({
    img: ({ node: _n, src, alt, title: _t, ...rest }: P & { src?: string; alt?: string; title?: string }) => (
      <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" {...(rest as object)} />
    ),
    a: ({ node: _n, href, children }: P & { href?: string }) => {
      const external = !!href && /^https?:\/\//.test(href) && !href.includes("mvpeav.com");
      return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
    },
    table: ({ node: _n, children }: P) => <div className="post-table"><table>{children}</table></div>,
    "sim-game": ({ season, week, game, frozen }: P) => (
      <SimGameEmbed season={Number(season)} week={Number(week)} gameId={str(game)} frozen={str(frozen) || undefined} />
    ),
    "record-card": ({ frozen }: P) => <RecordEmbed frozen={str(frozen) || undefined} />,
    "x-post": ({ url, img }: P) => (
      <figure className="post-figure post-xpost">
        <a href={str(url)} target="_blank" rel="noopener noreferrer">
          {img ? <img src={str(img)} alt="Post on X (screenshot)" loading="lazy" decoding="async" /> : "View the post on X"}
        </a>
        <figcaption><a href={str(url)} target="_blank" rel="noopener noreferrer">View on X →</a></figcaption>
      </figure>
    ),
    "post-photo": ({ node: _n, ...p }: P) => editing ? <MediaFrame wsid={str(p.wsid)}><PhotoEmbed {...p} /></MediaFrame> : <PhotoEmbed {...p} />,
    "x-embed": ({ node: _n, ...p }: P) => editing ? <MediaFrame wsid={str(p.wsid)}><XEmbed {...p} /></MediaFrame> : <XEmbed {...p} />,
    "youtube-embed": ({ node: _n, ...p }: P) => editing ? <MediaFrame wsid={str(p.wsid)}><YouTubeEmbed {...p} /></MediaFrame> : <YouTubeEmbed {...p} />,
    "getty-embed": ({ node: _n, ...p }: P) => editing ? <MediaFrame wsid={str(p.wsid)}><GettyEmbed {...p} /></MediaFrame> : <GettyEmbed {...p} />,
    "owner-beat": ({ note }: P) =>
      draft ? (
        <aside className="owner-beat" aria-label="Owner beat (draft only)">
          <span className="owner-beat__tag">Owner beat</span> {str(note)}
        </aside>
      ) : null,
    ...(editing ? EDITABLE_COMPONENTS : {}),
  }) as unknown as Components, [draft, editing]);

  return (
    <EditCtx.Provider value={edit ?? null}>
      <div className={edit ? "post-body post-body--editing" : "post-body"}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkDirective, remarkMvpeav]} rehypePlugins={edit ? [rehypeBlockSpans] : []} skipHtml components={components}>
          {body}
        </ReactMarkdown>
      </div>
    </EditCtx.Provider>
  );
}
