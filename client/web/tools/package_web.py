#!/usr/bin/env python3
"""Package the browser scene as static files any web host can serve.

    python3.11 client/web/tools/package_web.py            # verify, then write dist/web/
    python3.11 client/web/tools/package_web.py --check    # verify only, write nothing
    python3.11 client/web/tools/package_web.py --out DIR  # write somewhere else

There is no build step to package. The scene resolves every path from the
repository root (`main.js`: `new URL('../../../', import.meta.url)`), so the
package keeps repository paths: `viewer.json`, every file its `fetched` manifest
names, byte for byte, and the three.js licence that must travel with its code.
A root `index.html` redirects to `client/web/scene.html`, and a root `_headers`
file (Cloudflare Pages and Workers static assets read it; other hosts ignore it)
sets the caching policy described at HEADERS.

Every file is checked against the sha256 `viewer.json` records BEFORE anything
is written. The scene refuses to start when one fetched file differs, so a
package with a single stale file is a broken deploy; this finds it here rather
than in a visitor's browser. If a source changed on purpose, regenerate the
manifest with `make_viewer_data.py` first.

The output folder is replaced only when it is empty or was written by this
script (it carries `MARKER`); any other folder is refused, never deleted.
Stdlib only, no network.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[3]
MANIFEST = "client/web/data/viewer.json"
ENTRY = "client/web/scene.html"
EXTRAS = ("client/web/vendor/LICENSE.three",)   # three.js is MIT: its notice ships with its code
MARKER = ".tumbler-web-package"
# Every response is revalidated before use. The file names carry no content
# hash, and the scene refuses to start when any fetched file differs from
# viewer.json, so a browser holding last release's copy of one file would break
# the page; "immutable" or a long max-age is exactly wrong here. Revalidation
# is a cheap 304 against the ETag the host sends. This is Cloudflare Pages'
# default, stated so the policy is in the package rather than assumed.
HEADERS = """/*
  Cache-Control: public, max-age=0, must-revalidate
"""
REDIRECT = """<!doctype html>
<meta charset="utf-8">
<title>Tumbler</title>
<meta http-equiv="refresh" content="0; url=client/web/scene.html">
<p><a href="client/web/scene.html">Open the scene</a></p>
"""


class PackageError(Exception):
    pass


def plain_relative(path: str) -> str:
    """A manifest path, refused unless it stays inside the repository."""
    pure = PurePosixPath(path)
    if not path or "\\" in path or pure.is_absolute() or ".." in pure.parts:
        raise PackageError(f"manifest path {path!r} is not a plain repository-relative path")
    return str(pure)


def verified_files(repo: Path) -> list[str]:
    """Every file the package holds, each checked; raises before anything is written."""
    manifest = json.loads((repo / MANIFEST).read_text(encoding="utf-8"))
    files, problems = [MANIFEST], []
    for entry in manifest["fetched"]:
        rel = plain_relative(entry["path"])
        source = repo / rel
        if not source.is_file():
            problems.append(f"{rel}: missing")
            continue
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            problems.append(f"{rel}: sha256 {digest[:12]}, viewer.json says {entry['sha256'][:12]}")
        files.append(rel)
    for extra in EXTRAS:
        if not (repo / extra).is_file():
            problems.append(f"{extra}: missing")
        files.append(extra)
    if ENTRY not in files:
        problems.append(f"{ENTRY} is not in the manifest")
    if problems:
        raise PackageError("nothing written; fix these first:\n  " + "\n  ".join(problems))
    return files


def write_package(repo: Path, out: Path, files: list[str]) -> int:
    """Copy `files` under `out`, keeping repository paths; returns the bytes copied."""
    if out.exists() and any(out.iterdir()):
        if not (out / MARKER).is_file():
            raise PackageError(f"{out} is not empty and was not written by this script; refusing to replace it")
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    for rel in files:
        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / rel, target)
    (out / "index.html").write_text(REDIRECT, encoding="utf-8")
    (out / "_headers").write_text(HEADERS, encoding="utf-8")
    (out / MARKER).write_text("Written by client/web/tools/package_web.py; safe for it to replace.\n", encoding="utf-8")
    return sum((out / rel).stat().st_size for rel in files)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, default=REPO / "dist" / "web", help="output folder (default: dist/web)")
    parser.add_argument("--check", action="store_true", help="verify every file against viewer.json and write nothing")
    args = parser.parse_args(argv)
    try:
        files = verified_files(REPO)
        if args.check:
            print(f"verified {len(files) - 1 - len(EXTRAS)} fetched files against viewer.json; nothing written")
            return 0
        size = write_package(REPO, args.out.resolve(), files)
    except PackageError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"packaged {len(files)} files ({size / 1e6:.1f} MB) into {args.out}")
    print(f"upload its contents to the web root; the scene is at /{ENTRY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
