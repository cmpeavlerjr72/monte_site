"""Capture the /about/how-it-works screenshots from a running site.

    py -3 scripts/capture_about_shots.py http://localhost:4173 [AWAY HOME]

Writes public/about/{board-card,game-scores,player-props,record}.png from the CURRENT UI
(light theme, 2x, downscaled to 1520px wide and palette-quantised so each stays
well under 300 KB). Re-run whenever the board, its open-card charts or the Record change
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


# One game for every board shot, so the page reads as one story. Two teams
# with clearly different colours (owner 2026-10-16: Memphis blue vs Tulane
# green) so the margin chart's two halves are easy to tell apart.
AWAY, HOME = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ("Memphis", "Tulane")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=2, color_scheme="light")
    pg = ctx.new_page()

    # 1. The game's card on the board.
    pg.goto(f"{BASE}/cfb/scoreboard", wait_until="networkidle")
    pg.wait_for_timeout(6000)
    target = pg.locator("[id^='game-']").filter(has_text=AWAY).filter(has_text=HOME).first
    target.scroll_into_view_if_needed()
    pg.wait_for_timeout(1500)
    save(target.screenshot(), "board-card.png", max_w=1040)

    # The open card's panel (a separate grid item under the card's row).
    target.locator("button[aria-expanded]").first.click()
    panel = pg.locator("div, section").filter(has=pg.get_by_role("button", name="Close"))         .filter(has_text="Simulated Scores").filter(has_text="Player Props").last

    # 2. Simulated Scores: the margin chart with a line entered.
    pg.locator("button").filter(has_text="Simulated Scores").first.click()
    pg.locator("svg[aria-label^='Simulated margin']").first.wait_for(timeout=30000)
    panel.locator("input").first.fill("13.5")
    pg.wait_for_timeout(1000)
    panel.scroll_into_view_if_needed()
    save(panel.screenshot(), "game-scores.png")

    # 3. Player Props: one player's simulated stat line against a prop.
    pg.locator("button").filter(has_text="Player Props").first.click()
    pg.wait_for_timeout(6000)
    panel.scroll_into_view_if_needed()
    save(panel.screenshot(), "player-props.png")

    # 4. The Record's verdict panel.
    pg.goto(f"{BASE}/cfb/record", wait_until="domcontentloaded")
    pg.wait_for_selector(".rec__hero", timeout=90000)
    pg.wait_for_timeout(2500)
    panel = pg.locator(".rec__panel", has=pg.locator(".rec__hero")).first
    save(panel.screenshot(), "record.png")
    b.close()
