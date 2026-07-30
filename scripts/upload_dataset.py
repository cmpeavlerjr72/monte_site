"""Publish a staged season archive to Hugging Face, then verify the upload.

    python upload_dataset.py --sport cfb --season 2025
    python upload_dataset.py --sport cfb --season 2026 --verify-only

Reads HF_TOKEN from CBB-Monte/.env (or the environment).
"""
import argparse, os, sys
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import HfApi, create_repo


def stage_files(root: Path) -> set[str]:
    return {
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*")
        if p.is_file() and ".cache" not in p.parts
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", default="cfb")
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--owner", default="mvpeav")
    ap.add_argument("--datastorage", default=r"C:\Users\devuser\datastorage")
    ap.add_argument("--env", default=r"C:\Users\devuser\CBB-Monte\.env")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()

    repo_id = f"{args.owner}/{args.sport}-sims-{args.season}"
    stage = Path(args.datastorage) / "__hf_stage__" / f"{args.sport}-sims-{args.season}"
    if not stage.is_dir():
        sys.exit(f"staging tree not found: {stage}\nRun archive_season.py first.")

    load_dotenv(args.env)
    token = os.getenv("HF_TOKEN") or os.getenv("HF_ACCESS_TOKEN")
    if not token:
        sys.exit("HF_TOKEN missing (checked --env file and environment)")

    api = HfApi(token=token)
    local = stage_files(stage)

    if not args.verify_only:
        create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True,
                    private=args.private, token=token)
        size = sum((stage / f).stat().st_size for f in local)
        print(f"uploading {len(local)} files / {size/1e6:.0f}MB -> {repo_id}")
        api.upload_large_folder(repo_id=repo_id, repo_type="dataset",
                                folder_path=str(stage), num_workers=8)

    hub = {f for f in api.list_repo_files(repo_id, repo_type="dataset")
           if not f.startswith(".")}
    missing, extra = local - hub, hub - local
    print(f"\nhub {len(hub)} files | local {len(local)} files")
    print(f"missing on hub: {len(missing)}")
    for m in sorted(missing)[:20]:
        print(f"  !! {m}")
    print(f"extra on hub  : {len(extra)}")

    if missing:
        print("\n*** UPLOAD INCOMPLETE — do not delete local sources ***")
        return 1
    print(f"\n*** VERIFIED: {repo_id} holds every staged file ***")
    return 0


if __name__ == "__main__":
    sys.exit(main())
