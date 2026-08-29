// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // App-shell service worker. `injectManifest` (not generateSW) because the
    // caching rules here are non-negotiable and belong in reviewable source:
    // see src/sw.ts — nothing but the hashed shell is ever cached, and /api,
    // ESPN, HuggingFace and Kalshi are never intercepted.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      // KILL SWITCH (2026-08-28 night, deliberate): ships a sw.js whose only
      // job is to UNREGISTER any existing worker and reload its clients. The
      // owner's phone was stranded blank TWICE in one night by workers left
      // broken across rapid deploys (registration alive, caches/HTTP state
      // wrong; incognito — no worker — always fine, even logged in). The
      // browser's sw.js update check bypasses a broken worker, so this cures
      // every stranded device remotely on its next launch. The app keeps its
      // manifest and installability and simply runs as an online site — this
      // worker never cached data anyway, only the shell, and live prices were
      // always no-store. Re-introduce a caching worker only with a redesign
      // that has an answer for the stranding mode (and remove this comment's
      // rule only alongside that design, reviewed).
      selfDestroying: true,
      // The manifest is hand-authored at public/manifest.webmanifest and
      // linked from index.html, so the plugin must not emit a second one.
      manifest: false,
      // Registration lives in src/main.tsx so the update/reload behaviour is
      // explicit and testable rather than generated.
      injectRegister: false,
      injectManifest: {
        // Shell only. public/ holds ~8MB of team logos, DuckDB wasm and JSON
        // data — precaching any of it would blow the cache budget AND start
        // serving stale data, which is the one thing this worker must not do.
        globPatterns: [
          "index.html",
          "assets/*.{js,css}",
          "assets/mvpeav-logo-*.png",
        ],
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
