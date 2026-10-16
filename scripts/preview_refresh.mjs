#!/usr/bin/env node
// scripts/preview_refresh.mjs: ONE-COMMAND LOCAL PREVIEW (2026-10-16)
//
//   preview_refresh.cmd              build app + server, serve on :4173
//   preview_refresh.cmd --no-build   serve what is already built
//   preview_refresh.cmd --port 4180  another port
//   preview_refresh.cmd --no-drafts  build exactly like production (no drafts)
//   npm run preview:refresh          same thing
//
// Stop it with Ctrl+C in the window it runs in (it stops the server too).
//
// What it serves: the production build (`dist/`) through the REAL Express
// server (`server/dist/liveScores.js`), exactly as Render does. That matters
// for the blog: `/blog/*` meta injection happens in Express, so a plain
// `vite preview` would not show it. Data comes read-only from the same
// Hugging Face datasets as production, through the server's /api/data proxy.
//
// WHY THIS CANNOT PLACE AN ORDER. Three independent walls; any one is enough.
//
//  1. NO CREDENTIALS. The server is spawned with a WHITELISTED environment
//     built from scratch (below), never the caller's. It holds no
//     KALSHI_*, CFB_PORTAL_PASSWORD*, CFB_PORTFOLIO_TOKEN, CFB_ORDERS_LIVE*,
//     CFB_PORTAL_OWNERS, KALSHI_CRED_SECRET, SUPABASE_*, VAPID_* or
//     TX_INGEST_TOKEN. The server reads its secrets from process.env only (it
//     has no dotenv / env-file loader), so:
//       - portalBuildAccounts() registers no account (no password var), and
//       - `supa` is null (no SUPABASE_URL / SERVICE_ROLE_KEY), so there is no
//         signed-in user and no linked user key (KALSHI_CRED_SECRET absent).
//     portalGate() therefore answers 503 portal_not_configured to every
//     /api/portfolio/* route, before any order code runs. And portalSend(),
//     the ONLY function that signs a mutating Kalshi request, throws
//     portal_credentials_missing without a key id and private key.
//  2. READ-ONLY SERVER. MVPEAV_PREVIEW=1 makes the server refuse every
//     request that is not GET/HEAD/OPTIONS with 403 before any route sees it
//     (server/liveScores.ts, right after the body parser). Every order,
//     cancel and convert route is a POST.
//  3. NO MUTATING GET. portalSend's three call sites are all inside POST
//     handlers (orders, orders/convert via ordersSubmitOne, orders/cancel).
//
// The script also refuses to start if any secret-shaped variable somehow made
// it into the child env (belt and braces against an edit to the whitelist).

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
// Drafts are compiled in for the owner's review unless --no-drafts. Even then
// they show only with ?drafts=1, and they never reach a production build
// (Render does not set BLOG_DRAFTS). See scripts/blog/vite-plugin-blog.mjs.
const drafts = !args.includes("--no-drafts");
const portArg = args.indexOf("--port");
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
const isWin = process.platform === "win32";

function run(cmd, cmdArgs, cwd, extraEnv = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}   (in ${path.relative(root, cwd) || "."})`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: isWin, env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) {
    console.error(`\n[preview] FAILED: ${cmd} ${cmdArgs.join(" ")} (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

if (!noBuild) {
  if (!existsSync(path.join(root, "node_modules"))) run("npm", ["ci"], root);
  if (!existsSync(path.join(root, "server", "node_modules"))) run("npm", ["ci"], path.join(root, "server"));
  run("npm", ["run", "build"], root, { BLOG_DRAFTS: drafts ? "1" : "" });
  run("npx", ["tsc"], path.join(root, "server"));
}

if (!existsSync(path.join(root, "dist", "index.html"))) {
  console.error("[preview] dist/index.html is missing. Run without --no-build.");
  process.exit(1);
}

// The child environment, built from nothing. Only what Node and Windows need
// to run, plus the port and the preview flag.
const KEEP = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT"];
const env = {};
for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
env.PORT = String(PORT);
env.NODE_ENV = "production";
env.MVPEAV_PREVIEW = "1";

const SECRET = /KALSHI|PORTAL|PORTFOLIO|ORDERS|SUPABASE|VAPID|TX_INGEST|CRED|TOKEN|SECRET|PASSWORD|KEY/i;
const leaked = Object.keys(env).filter((k) => SECRET.test(k));
if (leaked.length) {
  console.error(`[preview] REFUSING TO START: secret-shaped env in the child: ${leaked.join(", ")}`);
  process.exit(1);
}

const url = `http://localhost:${PORT}`;
console.log(`\n[preview] starting the Express server READ-ONLY (orders disabled) on ${url}`);
const child = spawn(process.execPath, [path.join(root, "server", "dist", "liveScores.js")], {
  cwd: path.join(root, "server"), env, stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => {
  process.stdout.write(d);
  if (/listening on/.test(String(d))) {
    console.log(`\n  ========================================================`);
    console.log(`   MVPEAV preview is up:  ${url}`);
    console.log(`   Blog drafts:           ${url}/blog?drafts=1${drafts ? "" : "   (built --no-drafts: none)"}`);
    console.log(`   Order placement is DISABLED in this preview.`);
    console.log(`   Stop: Ctrl+C in this window.`);
    console.log(`  ========================================================\n`);
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => { console.log(`[preview] server exited (${code})`); process.exit(code ?? 0); });
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { child.kill(); setTimeout(() => process.exit(0), 1500).unref(); });
}
