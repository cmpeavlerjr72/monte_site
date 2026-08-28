#!/usr/bin/env node
/**
 * Generate the PWA icon set in public/icons/ from the MVPEAV brand logo.
 *
 * Source of truth is src/assets/mvpeav-logo-dark.png (white "MV" shield with a
 * gold border on the brand navy). The wordmark underneath is dropped — at
 * 192px an app icon has no room for six-point type — so we crop to the shield
 * and re-center it on a flat --brand navy field.
 *
 * The shield's bounding box inside the source was measured (not eyeballed) by
 * scanning for pixels that differ from the corner background; if the brand
 * asset is ever replaced, re-run that scan and update SHIELD below.
 *
 * Rendering is done by headless Edge/Chrome screenshotting a square page —
 * no `sharp`/`canvas` native dependency to install or keep working on Render
 * (icons are committed, so this script never runs in CI).
 *
 * Usage:  node scripts/make_pwa_icons.mjs
 *         PWA_ICON_BROWSER="C:/path/to/chrome.exe" node scripts/make_pwa_icons.mjs
 *
 * (Deliberately NOT the $BROWSER env var — VS Code sets that to a .cmd shim
 * that node refuses to spawn.)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "assets", "mvpeav-logo-dark.png");
const OUT_DIR = path.join(ROOT, "public", "icons");

/** Measured bounding box of the shield inside the source image. */
const SHIELD = { x: 91, y: 23, w: 245, h: 264 };

/** Brand navy — must stay in sync with `--brand` in src/theme.css. */
const NAVY = "#0b2d4b";

/**
 * `frac` = share of the canvas edge the shield's LONG side occupies.
 * "any" icons go near full-bleed; the maskable one stays inside the 80%
 * safe circle Android crops to, so 0.55 leaves the shield untouched by any
 * mask shape.
 */
const TARGETS = [
  { file: "icon-192.png", size: 192, frac: 0.74 },
  { file: "icon-512.png", size: 512, frac: 0.74 },
  { file: "icon-512-maskable.png", size: 512, frac: 0.55 },
  { file: "apple-touch-icon.png", size: 180, frac: 0.74 },
];

const CANDIDATES = [
  process.env.PWA_ICON_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) throw new Error(`No headless browser found. Tried:\n${CANDIDATES.join("\n")}`);

const work = mkdtempSync(path.join(tmpdir(), "mvpeav-icons-"));
copyFileSync(SRC, path.join(work, "logo.png"));
mkdirSync(OUT_DIR, { recursive: true });

for (const { file, size, frac } of TARGETS) {
  // Map the shield box onto a centred square of `size * frac`, preserving
  // aspect.
  const target = size * frac;
  const scale = Math.min(target / SHIELD.w, target / SHIELD.h);
  const left = (size - SHIELD.w * scale) / 2;
  const top = (size - SHIELD.h * scale) / 2;

  // Crop to the shield's bounding box (the wordmark never enters the icon) and
  // repaint the source's own navy field — a hair off --brand — to the token
  // navy, so no rectangle seam shows around the shield on the icon canvas.
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${NAVY};}
    canvas{display:block;}
  </style><canvas id="c" width="${size}" height="${size}"></canvas><script>
    const S = ${JSON.stringify(SHIELD)};
    const c = document.getElementById('c'), g = c.getContext('2d');
    g.fillStyle = ${JSON.stringify(NAVY)}; g.fillRect(0, 0, ${size}, ${size});
    const img = new Image();
    img.onload = () => {
      // Recolor on the FULL source: the reference background must be sampled
      // at the image corner. Sampling the crop's own (0,0) picks up the
      // shield's drop shadow and the repaint silently no-ops.
      const full = document.createElement('canvas');
      full.width = img.width; full.height = img.height;
      const fg = full.getContext('2d');
      fg.drawImage(img, 0, 0);
      const d = fg.getImageData(0, 0, full.width, full.height);
      const p = d.data, bg = [p[0], p[1], p[2]];
      const to = [${parseInt(NAVY.slice(1, 3), 16)}, ${parseInt(NAVY.slice(3, 5), 16)}, ${parseInt(NAVY.slice(5, 7), 16)}];
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i]-bg[0]) + Math.abs(p[i+1]-bg[1]) + Math.abs(p[i+2]-bg[2]) <= 24) {
          p[i] = to[0]; p[i+1] = to[1]; p[i+2] = to[2];
        }
      }
      fg.putImageData(d, 0, 0);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(full, S.x, S.y, S.w, S.h, ${left.toFixed(3)}, ${top.toFixed(3)},
        ${(SHIELD.w * scale).toFixed(3)}, ${(SHIELD.h * scale).toFixed(3)});
    };
    img.src = 'logo.png';
  <\/script>`;
  const page = path.join(work, `${file}.html`);
  writeFileSync(page, html);

  const out = path.join(OUT_DIR, file);
  execFileSync(browser, [
    "--headless=new",
    "--allow-file-access-from-files",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${size},${size}`,
    `--screenshot=${out}`,
    "--virtual-time-budget=4000",
    `file:///${page.replace(/\\/g, "/")}`,
  ], { stdio: "ignore" });

  if (!existsSync(out)) throw new Error(`screenshot failed: ${file}`);
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}

rmSync(work, { recursive: true, force: true });
