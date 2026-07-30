"""Rehydrate plain CSVs from the compressed local archive.

The archive at <datastorage>/<sport>/<season>/ stores sims as .csv.gz. Use this
to get usable CSVs back — for re-uploading, for analysis, or to recover if the
Hugging Face copy is ever unavailable.

    # one week, to a scratch folder
    python restore_from_archive.py --season 2025 --week 5 --out C:\\tmp\\wk5

    # the whole season, rebuilt as an upload staging tree
    python restore_from_archive.py --season 2025 --as-stage
"""
import argparse, gzip, shutil, sys
from pathlib import Path


def restore(src_root: Path, dst_root: Path) -> tuple[int, int]:
    n_files = n_bytes = 0
    for p in sorted(src_root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(src_root)
        if p.suffix == ".gz":
            dst = dst_root / rel.with_suffix("")  # strip .gz -> .csv
            dst.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(p, "rb") as fi, open(dst, "wb") as fo:
                shutil.copyfileobj(fi, fo, 1 << 20)
        else:
            dst = dst_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dst)
        n_files += 1
        n_bytes += dst.stat().st_size
    return n_files, n_bytes


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sport", default="cfb")
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--week", type=int, help="restore a single week (default: all)")
    ap.add_argument("--out", help="destination directory")
    ap.add_argument("--as-stage", action="store_true",
                    help="rebuild the HF staging tree layout for re-upload")
    ap.add_argument("--datastorage", default=r"C:\Users\devuser\datastorage")
    args = ap.parse_args()

    archive = Path(args.datastorage) / args.sport / str(args.season)
    if not archive.is_dir():
        sys.exit(f"archive not found: {archive}")

    if args.as_stage:
        dst = (Path(args.datastorage) / "__hf_stage__" /
               f"{args.sport}-sims-{args.season}" / str(args.season))
    elif args.out:
        dst = Path(args.out)
    else:
        sys.exit("give --out or --as-stage")

    src = archive / f"week{args.week:02d}" if args.week is not None else archive
    if not src.is_dir():
        sys.exit(f"not in archive: {src}")
    if args.week is not None and not args.as_stage:
        dst_final = dst
    else:
        dst_final = dst / "weeks" if args.as_stage else dst

    n, b = restore(src, dst_final)
    print(f"restored {n} files / {b/1e6:.0f}MB")
    print(f"  from {src}")
    print(f"  to   {dst_final}")


if __name__ == "__main__":
    main()
