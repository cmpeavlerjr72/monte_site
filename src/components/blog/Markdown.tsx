// src/components/blog/Markdown.tsx: renders a post body. Lazy blog chunk only.
//
// react-markdown + GFM + remark-directive + the site's own transform
// (src/lib/blog/remarkMvpeav.mjs, shared with the crawler-HTML build). Raw HTML
// in a post is never rendered. Embeds map to read-only components: nothing in
// a post can show an order, Tail or price button.

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkMvpeav from "../../lib/blog/remarkMvpeav.mjs";
import { SimGameEmbed } from "./SimGameEmbed";
import { RecordEmbed } from "./RecordEmbed";
import { GettyEmbed, PhotoEmbed, XEmbed, YouTubeEmbed } from "./MediaEmbeds";

type P = Record<string, unknown> & { node?: unknown; children?: React.ReactNode };
const str = (v: unknown) => (v == null ? "" : String(v));

export default function Markdown({ body, draft }: { body: string; draft: boolean }) {
  const components = {
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
    "post-photo": ({ node: _n, ...p }: P) => <PhotoEmbed {...p} />,
    "x-embed": ({ node: _n, ...p }: P) => <XEmbed {...p} />,
    "youtube-embed": ({ node: _n, ...p }: P) => <YouTubeEmbed {...p} />,
    "getty-embed": ({ node: _n, ...p }: P) => <GettyEmbed {...p} />,
    "owner-beat": ({ note }: P) =>
      draft ? (
        <aside className="owner-beat" aria-label="Owner beat (draft only)">
          <span className="owner-beat__tag">Owner beat</span> {str(note)}
        </aside>
      ) : null,
  } as unknown as Components;

  return (
    <div className="post-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkDirective, remarkMvpeav]} skipHtml components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
