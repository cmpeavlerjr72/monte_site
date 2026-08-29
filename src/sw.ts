/// <reference lib="webworker" />
/**
 * MVPEAV service worker — PUSH ONLY.
 *
 * This is the reviewed redesign the 2026-08-28 kill switch demanded before any
 * worker could return. That night, TWO stranded caching workers left the
 * owner's phone fully blank — registration alive, CacheStorage gone, every
 * navigation answered with Response.error() — and the cure was shipping a
 * self-destroying sw.js (`selfDestroying: true`, vite config).
 *
 * The redesign's answer to the stranding mode is STRUCTURAL, not more careful
 * caching: THERE IS NO FETCH HANDLER IN THIS FILE. A worker that never calls
 * respondWith() cannot intercept a navigation, so its worst possible failure
 * is that notifications stop arriving — the site itself always loads exactly
 * as if no worker existed. The old app-shell worker (workbox precache +
 * network-first navigations) lives in git history at 010ce1b^:src/sw.ts; do
 * NOT bring back a fetch handler, caching, or workbox imports without a design
 * that answers the stranding mode all over again — "no fetch handler" IS this
 * file's answer, and it holds only while that stays true.
 *
 * What this worker DOES: receives Web Push (fill alerts for the owner's
 * resting Kalshi orders — see /api/push/* in server/liveScores.ts) and shows
 * the notification; a tap focuses or opens the scoreboard.
 */

// An export makes this file a MODULE, which is what lets the declaration
// below shadow lib.dom's `self: Window` with the worker global scope.
export {};

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// vite-plugin-pwa (injectManifest) refuses to build a worker whose COMPILED
// output does not contain `self.__WB_MANIFEST` — and a bare `void` reference
// is minified away. A global-property assignment is a side effect the
// minifier must keep. Referenced, never used: nothing is cached.
(self as unknown as Record<string, unknown>).__PRECACHE_UNUSED = self.__WB_MANIFEST;

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Belt and braces: destroy anything a previous caching generation left
      // behind, so no stale shell can ever be served by accident and the
      // browser's storage quota is handed back.
      for (const k of await caches.keys()) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

type PushPayload = { title?: string; body?: string; tag?: string; url?: string };

self.addEventListener("push", (e) => {
  let p: PushPayload = {};
  try {
    p = (e.data?.json() as PushPayload) ?? {};
  } catch {
    /* a non-JSON push still shows something rather than nothing */
  }
  e.waitUntil(
    self.registration.showNotification(p.title || "MVPEAV", {
      body: p.body || "",
      tag: p.tag || "cfb-fill",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: p.url || "/cfb/scoreboard" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = String((e.notification.data as { url?: string } | undefined)?.url || "/cfb/scoreboard");
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        // Any open tab of ours will do — focus it rather than spawning tabs.
        if ("focus" in w) {
          await w.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
