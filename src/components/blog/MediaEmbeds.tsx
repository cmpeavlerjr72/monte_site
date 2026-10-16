// src/components/blog/MediaEmbeds.tsx: the three media directives (BlogBot images, 2026-10-16).
//
//   ::photo{src alt caption credit license licenseurl source own}  a figure with a credit/license line under it
//                                                              (Wikimedia Commons photos, our own cards); own="1"
//                                                              is the owner's own photo: no credit line
//   ::x-embed{url author text}                                 a REAL X post, privacy-friendly: a plain card with
//                                                              the post's text and a link; X's widget script loads
//                                                              only when the reader taps "Load the post"
//   ::youtube{id title start}                                  lite embed: a thumbnail button; the youtube-nocookie
//                                                              player loads only on tap
//
// Nothing here loads a third-party script or iframe before the reader asks for it. The crawler build
// (scripts/build_blog.mjs) renders all three as plain HTML (figure / blockquote + link / link).

import { useEffect, useRef, useState } from "react";

type Props = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

const X_STATUS = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/(\w+)\/status\/(\d+)/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function PhotoEmbed(p: Props) {
  const src = s(p.src), credit = s(p.credit), license = s(p.license), licUrl = s(p.licenseurl), source = s(p.source);
  const own = /mvpeav/i.test(credit);
  return (
    <figure className="post-figure post-photo">
      <img src={src} alt={s(p.alt)} loading="lazy" decoding="async" />
      {(s(p.caption) || credit) && (
        <figcaption>
          {s(p.caption) && <span className="post-photo__caption">{s(p.caption)}</span>}
          {credit && (
            <span className="post-photo__credit">
              {own ? credit : <>Photo: {source ? <a href={source} target="_blank" rel="noopener noreferrer">{credit}</a> : credit}
                {" / Wikimedia Commons"}
                {license && <>, {licUrl ? <a href={licUrl} target="_blank" rel="noopener noreferrer license">{license}</a> : license}</>}</>}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

let widgetsLoading: Promise<void> | null = null;
type Twttr = { widgets: { createTweet: (id: string, el: HTMLElement, o: Record<string, unknown>) => Promise<unknown> } };

function loadWidgets(): Promise<void> {
  const w = window as unknown as { twttr?: Twttr };
  if (w.twttr?.widgets) return Promise.resolve();
  if (!widgetsLoading) {
    widgetsLoading = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = "https://platform.twitter.com/widgets.js";
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { widgetsLoading = null; reject(new Error("X widget failed to load")); };
      document.head.appendChild(el);
    });
  }
  return widgetsLoading;
}

export function XEmbed(p: Props) {
  const url = s(p.url);
  const m = X_STATUS.exec(url);
  const [state, setState] = useState<"idle" | "loading" | "live" | "failed">("idle");
  const box = useRef<HTMLDivElement>(null);
  if (!m) return <p className="directive-unknown">X post: bad link</p>;
  const author = s(p.author) || `@${m[1]}`;
  const load = async () => {
    setState("loading");
    try {
      await loadWidgets();
      const w = window as unknown as { twttr?: Twttr };
      if (!box.current || !w.twttr) throw new Error("no widget");
      await w.twttr.widgets.createTweet(m[2], box.current, { dnt: true, conversation: "none", align: "center" });
      setState("live");
    } catch {
      setState("failed");
    }
  };
  return (
    <figure className="post-xembed">
      <div ref={box} className="post-xembed__live" />
      {state !== "live" && (
        <blockquote className="post-xembed__card" cite={url}>
          <p className="post-xembed__author">{author} on X</p>
          {s(p.text) && <p className="post-xembed__text">{s(p.text)}</p>}
          <p className="post-xembed__actions">
            <button type="button" onClick={load} disabled={state === "loading"}>
              {state === "loading" ? "Loading…" : state === "failed" ? "Couldn't load it. Try again" : "Load the post (photo / video)"}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer">Open on X →</a>
          </p>
          <p className="post-xembed__note">Loading it contacts X.</p>
        </blockquote>
      )}
    </figure>
  );
}

export function YouTubeEmbed(p: Props) {
  const id = s(p.id), title = s(p.title) || "Video";
  const start = Number(s(p.start)) || 0;
  const [play, setPlay] = useState(false);
  if (!YT_ID.test(id)) return <p className="directive-unknown">YouTube: bad video id</p>;
  const watch = `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
  return (
    <figure className="post-yt">
      <div className="post-yt__frame">
        {play ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ""}`}
            title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy"
          />
        ) : (
          <button type="button" className="post-yt__poster" onClick={() => setPlay(true)} aria-label={`Play: ${title}`}>
            <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" decoding="async" />
            <span className="post-yt__play" aria-hidden="true">▶</span>
          </button>
        )}
      </div>
      <figcaption>{title} · <a href={watch} target="_blank" rel="noopener noreferrer">Watch on YouTube</a></figcaption>
    </figure>
  );
}

// ::getty{id et sig w h caption credit page}: Getty Images' Embedded Viewer, EDITORIAL use only (their terms). The
// iframe is created only when the figure scrolls into view, so Getty's tracking and ads never run on page load; until
// then (and with no JS, or if Getty pulls the image) the caption, the credit and a link to the Getty page stand in.
// A Getty photo is never downloaded or re-hosted, and never a post's hero / og_image (build_blog.mjs refuses that).
export function GettyEmbed(p: Props) {
  const id = s(p.id), et = s(p.et), sigRaw = s(p.sig);
  const w = Number(s(p.w)) || 594, h = Number(s(p.h)) || 396;
  const page = s(p.page) || (id ? `https://www.gettyimages.com/detail/${id}` : "");
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    if (typeof IntersectionObserver === "undefined") { setShow(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShow(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [show]);
  if (!/^\d{5,}$/.test(id) || !et || !sigRaw) return <p className="directive-unknown">Getty embed: missing id / et / sig</p>;
  let sig = sigRaw;
  try { sig = encodeURIComponent(decodeURIComponent(sigRaw)); } catch { sig = encodeURIComponent(sigRaw); }
  const src = `https://embed.gettyimages.com/embed/${id}?et=${encodeURIComponent(et)}&tld=com&sig=${sig}&caption=true&ver=1`;
  return (
    <figure className="post-getty">
      <div ref={ref} className="post-getty__frame" style={{ aspectRatio: `${w} / ${h}` }}>
        {show && <iframe src={src} title={s(p.caption) || "Getty Images"} width={w} height={h} loading="lazy" scrolling="no" />}
      </div>
      <figcaption>
        {s(p.caption) && <span className="post-photo__caption">{s(p.caption)} </span>}
        <span className="post-photo__credit">{s(p.credit) || "Getty Images"} · <a href={page} target="_blank" rel="noopener noreferrer">View on Getty Images</a></span>
      </figcaption>
    </figure>
  );
}
