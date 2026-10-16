"""Capture the /about/how-it-works screenshots from a running site.

    py -3 scripts/capture_about_shots.py http://localhost:4173

Writes public/about/{board-card,game-sims,record}.png from the CURRENT UI
(light theme, 2x, downscaled to 1520px wide and palette-quantised so each stays
well under 300 KB). Re-run whenever the board, Game sims or the Record change
look. Needs Python Playwright + Pillow (both on the owner's machine).
"""
import io
import os
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173").rstrip("/")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "about")
os.makedirs(OUT, exist_ok=True)


def save(png_bytes: bytes, name: str, max_w: int = 1520) -> None:
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    path = os.path.join(OUT, name)
    im.save(path, optimize=True)
    print(path, im.size, os.path.getsize(path) // 1024, "KB")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=2, color_scheme="light")
    pg = ctx.new_page()

    # 1. A board card that has lines and edges (skip live/final where possible).
    pg.goto(f"{BASE}/cfb/scoreboard", wait_until="domcontentloaded")
    pg.wait_for_timeout(7000)
    cards = pg.locator("[id^='game-']")
    target = None
    for i in range(min(cards.count(), 30)):
        c = cards.nth(i)
        txt = c.inner_text()
        if "Final" in txt or " ball" in txt:
            continue
        c.scroll_into_view_if_needed()
        pg.wait_for_timeout(1500)
        if "¢" in c.inner_text():
            target = c
            break
    target = target or cards.first
    target.scroll_into_view_if_needed()
    pg.wait_for_timeout(1500)
    save(target.screenshot(), "board-card.png", max_w=1040)

    # 2. Game sims: the margin chart with a line entered.
    pg.goto(f"{BASE}/cfb/game", wait_until="domcontentloaded")
    pg.wait_for_timeout(6000)
    pg.get_by_role("spinbutton", name="team line").fill("-6.5")
    pg.wait_for_timeout(800)
    save(pg.locator(".gc .ui-card").first.screenshot(), "game-sims.png")

    # 3. The Record's verdict panel.
    pg.goto(f"{BASE}/cfb/record", wait_until="domcontentloaded")
    pg.wait_for_selector(".rec__hero", timeout=90000)
    pg.wait_for_timeout(2500)
    panel = pg.locator(".rec__panel", has=pg.locator(".rec__hero")).first
    save(panel.screenshot(), "record.png")
    b.close()
