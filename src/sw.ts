/// <reference lib="webworker" />
/**
 * MVPEAV service worker — app shell ONLY.
 *
 * The single hard rule here: this worker never caches data. Every sim slate,
 * ESPN poll, HuggingFace file and Kalshi quote must hit the network exactly as
 * it would with no worker installed, because a stale price or a stale live
 * score is worse than no app at all (and `cache: "no-store"` on those fetches,
 * rule 3 in docs/AGENT_BRIEF.md, has to stay true in EFFECT, not just in the
 * call site).
 *
 * That is enforced structurally rather than by a denylist: the ONLY routes
 * registered are
 *   1. workbox's precache route, which matches an exact, hashed, same-origin
 *      URL from the build manifest and nothing else, and
 *   2. a navigation route, network-first, denylisted from /api.
 * Anything unmatched — /api/*, espn.com, huggingface.co, api.elections.kalshi.com
 * — falls through the router without `respondWith`, i.e. the browser performs
 * its normal network fetch. Do NOT add `setDefaultHandler`, and do NOT add
 * runtime caching for any origin.
 *
 * Update path: skipWaiting + clientsClaim, plus network-first navigations, so a
 * Render deploy is live on the next launch instead of pinning users to the
 * build they first installed.
 */
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  getCacheKeyForURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();

// Hashed /assets/* + index.html. Immutable filenames, so cache-first is safe:
// a new deploy means new names and a new manifest, never a stale hit.
precacheAndRoute(self.__WB_MANIFEST);

/**
 * Navigations go to the network first so a deploy is picked up immediately,
 * with the precached index.html as the offline/flaky-connection floor. The
 * timeout keeps a dead-but-not-refused connection from hanging the launch.
 */
const shellFallback = async (): Promise<Response> => {
  const key = getCacheKeyForURL("/index.html");
  const cached = key ? await caches.match(key) : undefined;
  if (cached) return cached;
  // LAST RESORT — network failed AND the precache is gone (live incident
  // 2026-08-28: a stranded older-generation worker whose CacheStorage had
  // been cleared answered every navigation with Response.error(), i.e. a
  // fully blank page, while /api/* typed into the URL bar worked fine). A
  // dead end must be a READABLE page: say so, offer retry. 503 keeps any
  // upstream cache from ever storing it.
  return new Response(
    "<!doctype html><meta charset='utf-8'><title>MVPEAV</title>" +
    "<body style='font-family:system-ui,Arial;padding:24px'>" +
    "<b>Can&rsquo;t load the app.</b><p>The network request failed and no " +
    "cached copy exists on this device.</p>" +
    "<button onclick='location.reload()' style='padding:10px 18px;font-size:15px'>Retry</button>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
};

registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "mvpeav-shell",
      networkTimeoutSeconds: 4,
      plugins: [
        {
          // Every route serves the same index.html, so key the whole SPA to
          // one entry. Without this the cache grows an entry per visited URL
          // (/cfb/game/<slug>… is unbounded) for zero benefit.
          cacheKeyWillBeUsed: async () => `${self.location.origin}/index.html`,
          handlerDidError: shellFallback,
        },
      ],
    }),
    // A navigation to /api/* is a human pasting an endpoint into the URL bar;
    // it must reach the server, never the shell.
    { denylist: [/^\/api\//] },
  ),
);
