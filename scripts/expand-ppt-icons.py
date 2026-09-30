"""Extract optional PPT Master icons into a task directory."""

import argparse
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    archive = Path(__file__).resolve().parent.parent / "vendor" / "ppt-master" / "templates" / "icons.zip"
    if not archive.exists():
        subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "ensure-office-assets.py")], check=True, capture_output=True, text=True)
        archive = Path.home() / ".dsh" / "cache" / "office-boost" / "office-assets-v1" / "vendor" / "ppt-master" / "templates" / "icons.zip"
    args.output.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive) as zf:
        zf.extractall(args.output)
    print(args.output / "icons")


if __name__ == "__main__":
    main()
