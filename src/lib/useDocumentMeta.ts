// src/lib/useDocumentMeta.ts: per-route <title> and description (2026-10-16).
//
// Nothing set document.title before this, so every tab and history entry read
// the same. Pages call useDocumentMeta({ title, description }); the title gets
// " | MVPEAV" appended (pass `bare` to skip it, for the homepage). Leaving a
// page restores the index.html defaults. Crawlers do not run this: per-post
// tags for X come from the server (server/liveScores.ts, /blog routes).

import { useEffect } from "react";

export type DocMeta = {
  title: string; description?: string; bare?: boolean; noindex?: boolean;
  image?: string; type?: "website" | "article";
};

const SITE = "MVPEAV";

function setMeta(attr: "name" | "property", key: string, value: string | null): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  const prev = el?.getAttribute("content") ?? null;
  if (value == null) {
    if (el && created) el.remove();
    return () => {};
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
  return () => {
    if (created) el?.remove();
    else if (prev != null) el?.setAttribute("content", prev);
  };
}

export function useDocumentMeta(meta: DocMeta | null): void {
  const title = meta?.title ?? null;
  const description = meta?.description ?? null;
  const bare = !!meta?.bare;
  const noindex = !!meta?.noindex;
  const image = meta?.image ?? null;
  const type = meta?.type ?? null;
  useEffect(() => {
    if (title == null) return;
    const full = bare ? title : `${title} | ${SITE}`;
    const prevTitle = document.title;
    document.title = full;
    const undo = [
      setMeta("property", "og:title", full),
      setMeta("name", "twitter:title", full),
      ...(description ? [
        setMeta("name", "description", description),
        setMeta("property", "og:description", description),
        setMeta("name", "twitter:description", description),
      ] : []),
      ...(image ? [setMeta("property", "og:image", image), setMeta("name", "twitter:image", image)] : []),
      ...(type ? [setMeta("property", "og:type", type)] : []),
      ...(noindex ? [setMeta("name", "robots", "noindex")] : []),
    ];
    return () => {
      document.title = prevTitle;
      undo.reverse().forEach((f) => f());
    };
  }, [title, description, bare, noindex, image, type]);
}
