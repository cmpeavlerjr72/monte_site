// src/pages/blog/PreviewPost.tsx: /preview/:token, the owner's private draft preview (2026-10-16).
//
// BlogBot uploads the draft (exactly as it would publish: hero, charts, embeds, captions, receipts) to a private store;
// the server answers /api/preview/<token> with {meta, body, version, held, hold} for a valid, unexpired token and a
// plain 404 otherwise. This page renders it with the same PostArticle as /blog/:slug, plus a slim banner. Never indexed
// (the server sends noindex; useDocumentMeta says so too); nothing links here.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { SkeletonLines } from "../../components/Skeleton";
import type { BlogMeta } from "../../lib/blog/posts";
import { useDocumentMeta } from "../../lib/useDocumentMeta";
import { PostArticle } from "./BlogPost";

type Preview = { meta: BlogMeta; body: string; version: number | null; held: boolean; hold: string | null };

export default function PreviewPost() {
  const { token = "" } = useParams();
  const [doc, setDoc] = useState<Preview | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setDoc(null); setMissing(false);
    fetch(`/api/preview/${encodeURIComponent(token)}`, { cache: "no-store", referrerPolicy: "no-referrer" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!alive) return; if (j && j.meta && typeof j.body === "string") setDoc(j as Preview); else setMissing(true); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [token]);

  useDocumentMeta({ title: doc ? `Preview: ${doc.meta.title}` : "Preview", noindex: true });

  if (missing) {
    return (
      <EmptyState kicker="Preview" title="This preview isn't available">
        <p>The link is wrong, has expired, or the post has been published.</p>
      </EmptyState>
    );
  }
  if (!doc) return <div className="post"><SkeletonLines rows={8} height={16} /></div>;

  const banner = (
    <div className="post-preview-banner" role="note">
      <b>PREVIEW</b> · not published{doc.version != null ? ` · v${doc.version}` : ""}
      {doc.held ? <> · <b>held</b>{doc.hold ? `: ${doc.hold}` : ""} (private to you)</> : null}
    </div>
  );
  return <PostArticle post={{ ...doc.meta, draft: true }} body={doc.body} banner={banner} />;
}
