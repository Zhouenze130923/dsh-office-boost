"""Fetch optional Windows office runtimes once, outside the plugin package."""
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

URL = "https://github.com/Zhouenze130923/dsh-office-boost/releases/download/office-assets-v1/office-assets-win-x64-py312.zip"
SHA256 = "4eedf460a9b8f4ff65cd6631ce5b9f7471336286bd057374c94a36053b8664ab"
ROOT = Path.home() / ".dsh" / "cache" / "office-boost" / "office-assets-v1"
PYTHON = ROOT / "vendor" / "python"
ICONS = ROOT / "vendor" / "ppt-master" / "templates" / "icons.zip"


def ready():
    return (PYTHON / "pymupdf" / "__init__.py").exists() and ICONS.exists()


def main():
    if sys.platform != "win32" or sys.version_info[:2] != (3, 12):
        raise SystemExit("These optional assets require Windows x64 and Python 3.12")
    if not ready():
        request = urllib.request.Request(URL, headers={"User-Agent": "dsh-office-boost/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise SystemExit("Office asset download failed checksum verification")
        ROOT.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix="office-assets-", dir=ROOT.parent))
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for entry in archive.infolist():
                    target = (staging / entry.filename).resolve()
                    if not target.is_relative_to(staging.resolve()):
                        raise SystemExit("Office asset archive contains an invalid path")
                archive.extractall(staging)
            if ROOT.exists():
                shutil.rmtree(ROOT)
            os.replace(staging, ROOT)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
    print(json.dumps({"python": str(PYTHON), "icons_zip": str(ICONS)}))


if __name__ == "__main__":
    main()
