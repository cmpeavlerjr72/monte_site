"""Download ESPN team logos once and self-host them, so the site renders on
networks that block espncdn.com. Also snapshots the ESPN CBB teams list so the
browser never has to call site.api.espn.com.

Outputs (all under cfb-sim-explorer/public/logos/):
  <espnId>.webp        light logo, 128px
  <espnId>-dark.webp   dark logo, 128px
  teams-cbb.json       name -> {id, logo, darkLogo} source data for espnLogos.ts
  manifest.json        which ids exist locally
"""
import csv, io, json, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

ROOT = Path(r"C:\Users\devuser\monte_site\cfb-sim-explorer")
OUT = ROOT / "public" / "logos"
TEAM_INFO = ROOT / "src" / "assets" / "team_info.csv"
CBB_SNAPSHOT = Path(__file__).with_name("espn_cbb_teams_raw.json")
SIZE = 128
UA = {"User-Agent": "Mozilla/5.0 (logo-archiver)"}

def fetch(url: str, tries: int = 3) -> bytes | None:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                print(f"  FAIL {url} -> {e}")
    return None

def save_webp(data: bytes, dst: Path) -> int | None:
    try:
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGBA")
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "WEBP", quality=90, method=6)
        return dst.stat().st_size
    except Exception as e:
        print(f"  BAD IMAGE -> {dst.name}: {e}")
        return None

def espn_png(espn_id: str, dark: bool) -> str:
    seg = "500-dark" if dark else "500"
    return f"https://a.espncdn.com/i/teamlogos/ncaa/{seg}/{espn_id}.png"

def collect_ids() -> tuple[set[str], list[dict]]:
    ids: set[str] = set()

    with open(TEAM_INFO, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            tid = (row.get("Id") or "").strip()
            if tid:
                ids.add(tid)
    print(f"cfb ids from team_info.csv: {len(ids)}")

    cbb_teams = []
    if CBB_SNAPSHOT.exists():
        raw = json.loads(CBB_SNAPSHOT.read_text(encoding="utf-8"))
        entries = raw["sports"][0]["leagues"][0]["teams"]
        for e in entries:
            t = e.get("team") or e
            tid = str(t.get("id") or "").strip()
            if not tid:
                continue
            ids.add(tid)
            cbb_teams.append({
                "id": tid,
                "displayName": t.get("displayName"),
                "shortDisplayName": t.get("shortDisplayName"),
                "name": t.get("name"),
                "abbreviation": t.get("abbreviation"),
                "location": t.get("location"),
                "nickname": t.get("nickname"),
            })
        print(f"cbb teams from ESPN snapshot: {len(cbb_teams)}")
    else:
        print("WARNING: no CBB snapshot found; skipping teams-cbb.json")
    return ids, cbb_teams

def main():
    ids, cbb_teams = collect_ids()
    print(f"unique espn ids to fetch: {len(ids)}  (x2 for dark)")
    OUT.mkdir(parents=True, exist_ok=True)

    have_light, have_dark = set(), set()
    total_bytes = 0

    def job(args):
        tid, dark = args
        dst = OUT / (f"{tid}-dark.webp" if dark else f"{tid}.webp")
        if dst.exists() and dst.stat().st_size > 0:
            return tid, dark, dst.stat().st_size
        data = fetch(espn_png(tid, dark))
        if not data:
            return tid, dark, None
        return tid, dark, save_webp(data, dst)

    tasks = [(t, d) for t in sorted(ids) for d in (False, True)]
    with ThreadPoolExecutor(max_workers=12) as ex:
        for tid, dark, size in ex.map(job, tasks):
            if size:
                total_bytes += size
                (have_dark if dark else have_light).add(tid)

    print(f"\nlight logos: {len(have_light)}/{len(ids)}")
    print(f"dark logos : {len(have_dark)}/{len(ids)}")
    print(f"total size : {total_bytes/1e6:.2f}MB")

    missing_light = sorted(ids - have_light)
    if missing_light:
        print(f"no light logo for ids: {missing_light}")

    for t in cbb_teams:
        tid = t["id"]
        t["logo"] = f"/logos/{tid}.webp" if tid in have_light else None
        t["darkLogo"] = f"/logos/{tid}-dark.webp" if tid in have_dark else None
    if cbb_teams:
        (OUT / "teams-cbb.json").write_text(
            json.dumps({"teams": cbb_teams}, separators=(",", ":")), encoding="utf-8")
        print(f"wrote teams-cbb.json ({len(cbb_teams)} teams, "
              f"{(OUT / 'teams-cbb.json').stat().st_size/1024:.0f}KB)")

    (OUT / "manifest.json").write_text(json.dumps({
        "size": SIZE, "format": "webp",
        "light": sorted(have_light), "dark": sorted(have_dark),
    }, separators=(",", ":")), encoding="utf-8")
    print("wrote manifest.json")

if __name__ == "__main__":
    sys.exit(main())
