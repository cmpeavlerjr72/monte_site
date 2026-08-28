// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
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
