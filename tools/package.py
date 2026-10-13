"""Build the folder and zip to upload to Qollab ("Upload your own files").

    python tools/package.py

Copies only what Qollab runs into dist/qollab/ and zips it. Local-only folders
(dev/, tests/, tools/) are left out. Fails if a Qollab limit is broken: at most
100 files, 2 MB each, with index.html and main.js at the top level.
"""

from __future__ import annotations

import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "dist" / "qollab"
ZIP = ROOT / "dist" / "blackout-lab-qollab.zip"
TOP_LEVEL = ["index.html", "main.js", "main.css", "requirements.txt", "README.md", "LICENSE"]
FOLDERS = {"game": "*.js", "engine": "*.py"}


def main() -> int:
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    for name in TOP_LEVEL:
        shutil.copy2(ROOT / name, DEST / name)
    for folder, pattern in FOLDERS.items():
        (DEST / folder).mkdir()
        for path in sorted((ROOT / folder).glob(pattern)):
            shutil.copy2(path, DEST / folder / path.name)

    files = sorted(p for p in DEST.rglob("*") if p.is_file())
    problems = []
    if len(files) > 100:
        problems.append(f"{len(files)} files (Qollab allows 100)")
    problems += [f"{p.relative_to(DEST)} is over 2 MB" for p in files if p.stat().st_size > 2 * 1024 * 1024]

    html = (DEST / "index.html").read_text()
    if re.search(r"<\s*(html|head|body|script)\b", html, re.I):
        problems.append("index.html must be body content only, with no <script> tags")
    if "This effort is supported by Qollab &amp; IonQ." not in html:
        problems.append("the attribution line is missing from index.html")

    # Every relative import must resolve; the only bare import allowed is the Python bridge.
    for path in [DEST / "main.js", *sorted((DEST / "game").glob("*.js"))]:
        source = re.sub(r"/\*.*?\*/", "", path.read_text(), flags=re.S)
        source = re.sub(r"^\s*//.*$", "", source, flags=re.M)
        if re.search(r"\bimport\s*\(", source):
            problems.append(f"{path.name}: dynamic import() is not resolved by Qollab")
        for spec in re.findall(r"""(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]""", source):
            if spec.startswith("."):
                if not (path.parent / spec).is_file():
                    problems.append(f"{path.name}: import {spec} does not exist")
            elif spec != "engine.bridge":
                problems.append(f"{path.name}: unexpected import {spec}")

    if problems:
        print("NOT READY:\n  " + "\n  ".join(problems))
        return 1

    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(DEST).as_posix())
    size = sum(p.stat().st_size for p in files) / 1024
    print(f"dist/qollab: {len(files)} files, {size:.0f} KB\n{ZIP.relative_to(ROOT)} written")
    for path in files:
        print(f"  {path.relative_to(DEST).as_posix()}")
    empty = (DEST / "index.html").read_text(encoding="utf-8").count('href=""')
    if empty:
        print(f"NOTE: {empty} project link(s) in the about block of index.html are still empty.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
