"""Archive a season of sim CSVs out of the frontend.

Takes a messy per-week source tree and produces:

  1. A compact local archive (gzipped, ~10x smaller):
       <datastorage>/<sport>/<season>/weekNN/{scores,players}/<slug>.csv.gz
  2. A clean upload staging tree with manifests and per-week score bundles:
       <datastorage>/__hf_stage__/<sport>-sims-<season>/<season>/weeks/weekNN/...

Then `--verify` proves every source byte is reproducible from the archive
before you delete anything.

Typical use:
    python archive_season.py --src ../src/data --sport cfb --season 2025
    python archive_season.py --sport cfb --season 2025 --verify
"""
import argparse, csv, gzip, hashlib, json, os, re, shutil, sys
from collections import defaultdict
from pathlib import Path

WEEK_RE = re.compile(r"^week(\d+)\s*(?:\((.*)\))?$", re.I)
FILE_RE = re.compile(r"^(scores|players)_(.+?)_wk(\d+)_sims\.csv( - Copy)?\.csv$", re.I)
GAMES_RE = re.compile(r"^week_.*games.*\.csv$", re.I)
OPEN_RE = re.compile(r"^week\d+_open\.csv$", re.I)
SCORE_HEADER = ["team", "opp", "pts", "opp_pts", "plays", "opp_plays"]

# Folder suffixes -> nicer display labels.
LABEL_OVERRIDES = {
    "rivalry week": "Rivalry Week",
    "conf champ": "Conference Championships",
    "bowls + a-n": "Bowls + Army-Navy",
}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def sha256_gz(p: Path) -> str:
    h = hashlib.sha256()
    with gzip.open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def link_or_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)  # same volume: costs no extra disk
    except OSError:
        shutil.copy2(src, dst)


def read_teams(p: Path):
    """(teamA, teamB, n_data_rows) from a scores CSV."""
    with open(p, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        next(r, None)
        first = next(r, None)
        n = 1 if first else 0
        for _ in r:
            n += 1
        if not first or len(first) < 2:
            return None, None, 0
        return first[0], first[1], n


def build(args) -> int:
    src = Path(args.src).resolve()
    archive = Path(args.datastorage) / args.sport / str(args.season)
    stage = (Path(args.datastorage) / "__hf_stage__" /
             f"{args.sport}-sims-{args.season}" / str(args.season))

    if not src.is_dir():
        sys.exit(f"source not found: {src}")

    problems, week_meta = [], []
    src_bytes = gz_bytes = 0

    week_dirs = []
    for d in sorted(src.iterdir()):
        if not d.is_dir():
            problems.append(f"stray file at source root: {d.name}")
            continue
        m = WEEK_RE.match(d.name.strip())
        if not m:
            problems.append(f"unparseable week folder: {d.name}")
            continue
        suffix = (m.group(2) or "").strip()
        label = f"Week {int(m.group(1))}"
        if suffix:
            label += f" ({LABEL_OVERRIDES.get(suffix.lower(), suffix)})"
        week_dirs.append((int(m.group(1)), label, d))
    week_dirs.sort()

    for num, label, d in week_dirs:
        wk_id = f"week{num:02d}"
        stage_wk, arch_wk = stage / "weeks" / wk_id, archive / wk_id

        games_src = open_src = None
        for f in sorted(d.iterdir()):
            if not f.is_file():
                continue
            if GAMES_RE.match(f.name):
                games_src = f
            elif OPEN_RE.match(f.name):
                open_src = f
            else:
                problems.append(f"{d.name}: unexpected root file {f.name}")
        if not games_src:
            problems.append(f"{d.name}: no games csv")

        # Collect sim files, resolving " - Copy" duplicates.
        picked = {}
        for sub in ("scores", "players"):
            subdir = d / sub
            if not subdir.is_dir():
                problems.append(f"{d.name}: missing {sub}/")
                continue
            for f in sorted(subdir.iterdir()):
                m = FILE_RE.match(f.name)
                if not m:
                    problems.append(f"{d.name}/{sub}: unrecognized {f.name}")
                    continue
                kind, slug, is_copy = m.group(1).lower(), m.group(2).lower(), bool(m.group(4))
                key = (kind, slug)
                if key in picked:
                    prev = picked[key]
                    if sha256_file(prev[0]) != sha256_file(f):
                        problems.append(f"{d.name}: CONTENT MISMATCH {f.name} vs {prev[1]}")
                        if f.stat().st_size > prev[0].stat().st_size:
                            picked[key] = (f, f.name)
                elif is_copy:
                    if not (subdir / f.name.replace(" - Copy", "")).exists():
                        picked[key] = (f, f.name)  # the Copy is the only version
                else:
                    picked[key] = (f, f.name)

        games = []
        for slug in sorted({s for (_, s) in picked}):
            sc, pl = picked.get(("scores", slug)), picked.get(("players", slug))
            entry = {"slug": slug}
            if sc:
                a, b, n = read_teams(sc[0])
                entry.update(teamA=a, teamB=b, n_rows=n, scores=f"scores/{slug}.csv")
            else:
                entry.update(teamA=None, teamB=None, scores=None)
                problems.append(f"{wk_id}: {slug} has players but no scores")
            entry["players"] = f"players/{slug}.csv" if pl else None
            if not pl:
                problems.append(f"{wk_id}: {slug} has scores but no players")
            games.append(entry)

            for rec, rel in ((sc, f"scores/{slug}.csv"), (pl, f"players/{slug}.csv")):
                if not rec:
                    continue
                src_bytes += rec[0].stat().st_size
                if args.dry_run:
                    continue
                link_or_copy(rec[0], stage_wk / rel)
                gz = arch_wk / (rel + ".gz")
                gz.parent.mkdir(parents=True, exist_ok=True)
                with open(rec[0], "rb") as fi, gzip.open(gz, "wb", compresslevel=9) as fo:
                    shutil.copyfileobj(fi, fo, 1 << 20)
                gz_bytes += gz.stat().st_size

        # One bundled scores file per week -> one fetch instead of ~50.
        bundle_rows = 0
        if not args.dry_run:
            stage_wk.mkdir(parents=True, exist_ok=True)
            arch_wk.mkdir(parents=True, exist_ok=True)
            with open(stage_wk / "scores_bundle.csv", "w", encoding="utf-8", newline="") as fo:
                w = csv.writer(fo, lineterminator="\n")
                w.writerow(["slug"] + SCORE_HEADER)
                for g in games:
                    if not g["scores"]:
                        continue
                    with open(stage_wk / g["scores"], "r", encoding="utf-8-sig", newline="") as fi:
                        r = csv.reader(fi)
                        header = next(r, None)
                        if [h.strip() for h in (header or [])] != SCORE_HEADER:
                            problems.append(f"{wk_id}/{g['slug']}: header {header}")
                            continue
                        for row in r:
                            if row and len(row) >= 6:
                                w.writerow([g["slug"]] + row[:6])
                                bundle_rows += 1

            for f, name in ((games_src, "games.csv"), (open_src, "open.csv")):
                if f:
                    link_or_copy(f, stage_wk / name)
                    shutil.copy2(f, arch_wk / name)

            index = {
                "sport": args.sport, "season": args.season, "week": num, "label": label,
                "folder_original": d.name, "legacy_key": d.name.strip().lower(),
                "n_games": len(games), "bundle_rows": bundle_rows,
                "files": {
                    "games": "games.csv" if games_src else None,
                    "open": "open.csv" if open_src else None,
                    "scores_bundle": "scores_bundle.csv",
                },
                "games": games,
            }
            for root in (stage_wk, arch_wk):
                (root / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")

        week_meta.append({
            "week": num, "id": wk_id, "dir": f"weeks/{wk_id}", "label": label,
            "legacy_key": d.name.strip().lower(), "n_games": len(games),
            "has_open": bool(open_src), "bundle_rows": bundle_rows,
        })
        print(f"{wk_id}: {len(games):3d} games  {label}")

    if not args.dry_run:
        season_index = {
            "sport": args.sport, "season": args.season,
            "note": "legacy_key matches the frontend week folder names used in ?week= deep links.",
            "weeks": week_meta,
        }
        for root in (stage, archive):
            root.mkdir(parents=True, exist_ok=True)
            (root / "season_index.json").write_text(
                json.dumps(season_index, indent=1), encoding="utf-8")

    print(f"\nsource {src_bytes/1e6:.0f}MB -> archive {gz_bytes/1e6:.0f}MB")
    print(f"problems ({len(problems)}):")
    print("\n".join(problems) if problems else "  none")
    return 1 if problems else 0


def verify(args) -> int:
    """Prove every source file's content exists in the archive. Exit 0 = safe."""
    src = Path(args.src).resolve()
    archive = Path(args.datastorage) / args.sport / str(args.season)

    print("hashing archive ...")
    arch = defaultdict(list)
    for p in archive.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix == ".gz":
            arch[sha256_gz(p)].append(p.name)
        elif p.suffix.lower() == ".csv":
            arch[sha256_file(p)].append(p.name)

    print("hashing source ...")
    missing, n = [], 0
    for p in sorted(src.rglob("*.csv")):
        n += 1
        if sha256_file(p) not in arch:
            missing.append(str(p.relative_to(src)))

    print(f"\nsource files : {n}")
    print(f"missing      : {len(missing)}")
    for m in missing[:40]:
        print(f"  !! {m}")
    if missing:
        print("\n*** NOT SAFE TO DELETE ***")
        return 1
    print("\n*** VERIFIED: every source byte is reproducible from the archive ***")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="../src/data", help="source week folders")
    ap.add_argument("--sport", default="cfb")
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--datastorage", default=r"C:\Users\devuser\datastorage")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--verify", action="store_true", help="check archive against source")
    args = ap.parse_args()
    sys.exit(verify(args) if args.verify else build(args))


if __name__ == "__main__":
    main()
