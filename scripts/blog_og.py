"""Blog images, rendered with Playwright from HTML templates (navy / gold).

    py -3 scripts/blog_og.py og <slug>            public/blog/<slug>/og.png (1200x630)
    py -3 scripts/blog_og.py og --all             every post in content/blog
    py -3 scripts/blog_og.py default              public/og-default.png (site-wide card)
    py -3 scripts/blog_og.py record-hero <slug> <json>
                                                  a "receipts" record image, e.g.
        '{"kicker":"Week 5 · starred picks","record":"119-252","units":-77.12,
          "weeks":[[3,24.85],[4,-23.69],[5,-77.12],[6,11.18]],"focus":5,
          "out":"record-week5.png"}'
    py -3 scripts/blog_og.py placeholder <dir> <name> "<label>"   a screenshot placeholder

Post metadata comes from the SAME parser the build and the app use
(scripts/blog/frontmatter.mjs, via node), so the card's headline is the post's
headline. Look at every image (open it) before committing it: the card IS the
ad on X, and X caches a card for about a week per URL.

Brand: navy #0b2d4b, gold #c2a35a (same pair as the X bot's cards), the site's
display face (Barlow Condensed, embedded), the MV shield. Money colours only on
money, and never alone: bars go up or down from zero and carry signed labels.
"""
import base64
import json
import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NAVY, GOLD = "#0b2d4b", "#c2a35a"


def b64(path: str) -> str:
    with open(os.path.join(ROOT, path), "rb") as f:
        return base64.b64encode(f.read()).decode()


FONT = {w: b64(f"src/assets/fonts/barlow-condensed-latin-{w}-normal.woff2") for w in (600, 700, 800)}
SHIELD = b64("src/assets/mv-shield.png")

BASE_CSS = f"""
@font-face {{ font-family: BC; font-weight: 600; src: url(data:font/woff2;base64,{FONT[600]}) format('woff2'); }}
@font-face {{ font-family: BC; font-weight: 700; src: url(data:font/woff2;base64,{FONT[700]}) format('woff2'); }}
@font-face {{ font-family: BC; font-weight: 800; src: url(data:font/woff2;base64,{FONT[800]}) format('woff2'); }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ background: {NAVY}; }}
body {{ font-family: system-ui, 'Segoe UI', Roboto, Arial, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }}
.card {{ position: relative; overflow: hidden; background: {NAVY}; }}
.rule {{ position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: {GOLD}; }}
.brand {{ display: flex; align-items: center; gap: 14px; }}
.brand img {{ height: 58px; }}
.word {{ font-family: BC; font-weight: 800; font-size: 40px; letter-spacing: .04em; }}
.kicker {{ font-family: BC; font-weight: 700; font-size: 26px; letter-spacing: .1em; text-transform: uppercase; color: {GOLD}; }}
.foot {{ position: absolute; left: 72px; right: 64px; bottom: 44px; display: flex; justify-content: space-between;
         font-family: BC; font-weight: 700; font-size: 26px; letter-spacing: .06em; color: #b4c2d1; text-transform: uppercase; }}
.foot b {{ color: #fff; font-weight: 700; }}
.grain {{ position: absolute; inset: 0; background:
  repeating-linear-gradient(135deg, rgba(255,255,255,.018) 0 2px, transparent 2px 9px); pointer-events: none; }}
"""


def shoot(html: str, out: str, w: int, h: int) -> None:
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
        pg.set_content(html, wait_until="load")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(250)
        # Shrink the headline until it fits its box (max 4 lines).
        pg.evaluate("""() => {
          const el = document.querySelector('[data-fit]'); if (!el) return;
          const box = el.parentElement; let size = parseFloat(getComputedStyle(el).fontSize);
          while ((el.scrollHeight > box.clientHeight || el.scrollWidth > box.clientWidth) && size > 30) {
            size -= 2; el.style.fontSize = size + 'px';
          }
        }""")
        pg.screenshot(path=out, clip={"x": 0, "y": 0, "width": w, "height": h})
        b.close()
    print(out, os.path.getsize(out) // 1024, "KB")


def esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def card_html(kicker: str, title: str, foot_left: str = "mvpeav.com", foot_right: str = "@MVPeav") -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}
.card {{ width: 1200px; height: 630px; }}
.top {{ position: absolute; left: 72px; right: 64px; top: 52px; display: flex; justify-content: space-between; align-items: center; }}
.titlebox {{ position: absolute; left: 72px; right: 80px; top: 150px; bottom: 120px; display: flex; align-items: center; }}
.title {{ font-family: BC; font-weight: 800; font-size: 76px; line-height: .98; text-transform: uppercase; letter-spacing: .005em; }}
</style></head><body><div class="card"><div class="grain"></div><div class="rule"></div>
<div class="top"><div class="brand"><img src="data:image/png;base64,{SHIELD}"><span class="word">MVPEAV</span></div>
<div class="kicker">{esc(kicker)}</div></div>
<div class="titlebox"><div class="title" data-fit>{esc(title)}</div></div>
<div class="foot"><span><b>{esc(foot_left)}</b></span><span>{esc(foot_right)}</span></div>
</div></body></html>"""


TAG_WORDS = {"cfb": "College football", "cbb": "College basketball", "nhl": "NHL",
             "fantasy-ai": "Fantasy AI", "previews": "Game preview", "receipts": "Receipts"}


def post_meta() -> list:
    js = ("import('./scripts/blog/frontmatter.mjs').then(m => {"
          "const ps = m.loadPosts(process.cwd()).filter(p => !p.errors.length).map(m.metaOf);"
          "process.stdout.write(JSON.stringify(ps)); })")
    out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def og_for(meta: dict) -> None:
    tags = meta.get("tags") or []
    kick = " · ".join(TAG_WORDS.get(t, t) for t in tags[:2]) or "Blog"
    folder = "blog-private" if meta.get("_private") else "blog"
    out = os.path.join(ROOT, "public", folder, meta["slug"], "og.png")
    shoot(card_html(kick, meta["title"]), out, 1200, 630)


def default_card() -> None:
    html = card_html("Sports sims that keep receipts",
                     "College football and basketball, simulated 10,000 times. Every pick graded in public.")
    shoot(html, os.path.join(ROOT, "public", "og-default.png"), 1200, 630)


def record_hero(slug: str, spec: dict) -> None:
    weeks = spec["weeks"]
    focus = spec.get("focus")
    mx = max(abs(u) for _, u in weeks) or 1
    H = 300  # half-height of the bar area around zero is H/2
    bars = []
    for wk, u in weeks:
        h = abs(u) / mx * (H / 2 - 20)
        up = u >= 0
        color = "#3fb950" if up else "#f85149"
        ring = f"outline: 3px solid {GOLD}; outline-offset: 4px;" if wk == focus else ""
        label = f"{'+' if up else '−'}{abs(u):.2f}u"
        bars.append(f"""<div class="col">
          <div class="half up">{f'<div class="v">{label}</div><div class="bar" style="height:{h:.0f}px;background:{color};{ring}"></div>' if up else ''}</div>
          <div class="half dn">{'' if up else f'<div class="bar" style="height:{h:.0f}px;background:{color};{ring}"></div><div class="v">{label}</div>'}</div>
          <div class="wk{' on' if wk == focus else ''}">Week {wk}</div></div>""")
    units = spec["units"]
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}
.card {{ width: 1600px; height: 900px; }}
.top {{ position: absolute; left: 88px; right: 80px; top: 64px; display: flex; justify-content: space-between; align-items: center; }}
.left {{ position: absolute; left: 88px; top: 210px; width: 760px; }}
.rec {{ font-family: BC; font-weight: 800; font-size: 250px; line-height: .86; letter-spacing: -.01em; }}
.units {{ font-family: BC; font-weight: 800; font-size: 120px; line-height: 1; color: {'#3fb950' if units >= 0 else '#f85149'}; margin-top: 18px; }}
.sub {{ font-size: 30px; line-height: 1.35; color: #b4c2d1; margin-top: 30px; max-width: 700px; }}
.chart {{ position: absolute; right: 88px; top: 210px; width: 600px; height: {H + 60}px; display: flex; gap: 34px; align-items: stretch; }}
.chart::before {{ content: ""; position: absolute; left: -10px; right: -10px; top: {H/2:.0f}px; border-top: 2px solid rgba(255,255,255,.35); }}
.chart-title {{ position: absolute; right: 88px; top: 170px; width: 600px; font-family: BC; font-weight: 700; font-size: 24px; letter-spacing: .08em; text-transform: uppercase; color: #b4c2d1; }}
.col {{ flex: 1; display: grid; grid-template-rows: {H/2:.0f}px {H/2:.0f}px 60px; }}
.half {{ display: flex; flex-direction: column; align-items: center; }}
.half.up {{ justify-content: flex-end; }} .half.dn {{ justify-content: flex-start; }}
.bar {{ width: 78px; border-radius: 4px; }}
.half.up .bar {{ border-bottom-left-radius: 0; border-bottom-right-radius: 0; margin-bottom: 1px; }}
.half.dn .bar {{ border-top-left-radius: 0; border-top-right-radius: 0; margin-top: 1px; }}
.v {{ font-family: BC; font-weight: 700; font-size: 30px; margin: 8px 0; color: #fff; }}
.wk {{ text-align: center; font-family: BC; font-weight: 700; font-size: 26px; letter-spacing: .06em; text-transform: uppercase; color: #b4c2d1; padding-top: 12px; }}
.wk.on {{ color: {GOLD}; }}
</style></head><body><div class="card"><div class="grain"></div><div class="rule"></div>
<div class="top"><div class="brand"><img src="data:image/png;base64,{SHIELD}"><span class="word">MVPEAV</span></div>
<div class="kicker">{esc(spec.get('kicker', 'The record'))}</div></div>
<div class="left"><div class="rec">{esc(spec['record'])}</div>
<div class="units">{'+' if units >= 0 else '−'}{abs(units):.2f} units</div>
<div class="sub">{esc(spec.get('sub', 'Every pick posted before kickoff, graded at the price we posted it, fees included. Still on the record page.'))}</div></div>
<div class="chart-title">{esc(spec.get('chart_title', 'Units by week, starred picks'))}</div>
<div class="chart">{''.join(bars)}</div>
<div class="foot" style="left:88px;right:80px;bottom:56px"><span><b>mvpeav.com/cfb/record</b></span><span>@MVPeav</span></div>
</div></body></html>"""
    out = os.path.join(ROOT, "public", "blog", slug, spec.get("out", "record.png"))
    shoot(html, out, 1600, 900)


def placeholder(folder: str, name: str, label: str) -> None:
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}
html, body {{ background: #eef0f2; }}
.ph {{ width: 1200px; height: 760px; display: grid; place-items: center; background: #eef0f2;
  background-image: repeating-linear-gradient(135deg, rgba(11,45,75,.06) 0 14px, transparent 14px 28px);
  border: 6px dashed #9aa7b6; }}
.ph div {{ font-family: BC; font-weight: 800; font-size: 64px; color: {NAVY}; text-transform: uppercase; text-align: center; line-height: 1.05; }}
.ph small {{ display: block; font-size: 34px; color: #5f6670; margin-top: 12px; letter-spacing: .05em; }}
</style></head><body><div class="ph"><div>Screenshot placeholder<small>{esc(label)}</small></div></div></body></html>"""
    shoot(html, os.path.join(ROOT, folder, name), 1200, 760)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "default":
        default_card()
    elif cmd == "og":
        metas = post_meta()
        want = sys.argv[2] if len(sys.argv) > 2 else "--all"
        for m in metas:
            if want in ("--all", m["slug"]):
                m["_private"] = m["hero"] and m["hero"].startswith("/blog-private/")
                og_for(m)
    elif cmd == "record-hero":
        record_hero(sys.argv[2], json.loads(sys.argv[3]))
    elif cmd == "placeholder":
        placeholder(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
