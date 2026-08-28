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
