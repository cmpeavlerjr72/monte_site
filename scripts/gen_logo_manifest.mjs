#!/usr/bin/env node
// Writes src/lib/logoManifest.json: the file names under public/logos, so the
// client asks for a self-hosted logo only when it exists and otherwise goes
// straight to ESPN's CDN (the server's SPA fallback would answer a missing
// /logos/<id>.webp with 200 text/html). Runs first in `npm run build`.
import { readdirSync, writeFileSync } from "node:fs";
const names = readdirSync("public/logos").filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)).sort();
writeFileSync("src/lib/logoManifest.json", JSON.stringify(names) + "\n");
console.log(`logo manifest: ${names.length} files`);
