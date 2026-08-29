// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // PUSH-ONLY service worker (2026-08-29). History, because it is the rule:
    // the 2026-08-28 blank-phone incident (two caching workers stranded across
    // rapid deploys — registration alive, CacheStorage gone, every navigation
    // a Response.error()) was cured with `selfDestroying: true`, and that flag
    // was only ever allowed to come off alongside a reviewed redesign that
    // answers the stranding mode. This is that redesign: src/sw.ts has NO
    // fetch handler at all — it cannot intercept a navigation, so its worst
    // failure is silence, never a blank site. It exists solely for Web Push
    // (owner fill alerts, /api/push/* in server/liveScores.ts). CACHING STAYS
    // BANNED: re-adding a fetch handler or workbox re-opens the incident mode
    // and needs its own reviewed answer.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      // The manifest is hand-authored at public/manifest.webmanifest and
      // linked from index.html, so the plugin must not emit a second one.
      manifest: false,
      // Registration lives in src/main.tsx so the update/reload behaviour is
      // explicit and testable rather than generated.
      injectRegister: false,
      injectManifest: {
        // The worker caches NOTHING; injectManifest just insists on a manifest
        // to inject. One entry keeps the generated sw.js tiny.
        globPatterns: ["index.html"],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        // Overridable so a patched server build can be tested on a side port
        // without touching a live instance on 8080.
        target: process.env.API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      }
    }
  },
});
