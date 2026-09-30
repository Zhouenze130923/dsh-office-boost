"""Extract optional PPT Master icons into a task directory."""

import argparse
from pathlib import Path
from zipfile import ZipFile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    archive = Path(__file__).resolve().parent.parent / "vendor" / "ppt-master" / "templates" / "icons.zip"
    args.output.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive) as zf:
        zf.extractall(args.output)
    print(args.output / "icons")


if __name__ == "__main__":
    main()
