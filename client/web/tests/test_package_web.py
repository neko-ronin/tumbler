"""client/web/tools/package_web.py: what it copies, and what it refuses to write.

    python3.11 -m unittest client.web.tests.test_package_web -v
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import posixpath
import re
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("package_web_under_test", REPO / "client/web/tools/package_web.py")
assert _spec is not None and _spec.loader is not None
pw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pw)


def fake_repo(root: pathlib.Path, files: dict[str, bytes], manifest_paths: list[str] | None = None) -> None:
    """A repository holding `files`, the licence, and a viewer.json that names `manifest_paths` (default: all)."""
    for rel, data in {**{m: b"map" for m in pw.MAP}, **files, pw.EXTRAS[0]: b"MIT"}.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(data)
    fetched = [{"path": p, "sha256": hashlib.sha256(files.get(p, b"")).hexdigest()} for p in (manifest_paths or list(files))]
    (root / pw.MANIFEST).parent.mkdir(parents=True, exist_ok=True)
    (root / pw.MANIFEST).write_text(json.dumps({"fetched": fetched}))


class PackageWeb(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name) / "repo"
        self.out = pathlib.Path(self.tmp.name) / "dist"
        self.files = {pw.ENTRY: b"<!doctype html><html><head><title>t</title></head></html>",
                      "shared/activities/ride.js": b"export const r = 1;"}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_it_keeps_repository_paths_and_adds_the_licence_and_redirect(self) -> None:
        fake_repo(self.repo, self.files)
        pw.write_package(self.repo, self.out, pw.verified_files(self.repo))
        for rel, data in self.files.items():
            self.assertEqual((self.out / rel).read_bytes(), data, rel)
        self.assertTrue((self.out / pw.MANIFEST).is_file())
        self.assertTrue((self.out / pw.EXTRAS[0]).is_file())
        root = (self.out / "index.html").read_text()
        self.assertEqual(root.replace(f"\n  {pw.BASE}", ""), self.files[pw.ENTRY].decode(), "the root page is the scene plus one <base>")
        for rel in pw.MAP:
            self.assertTrue((self.out / rel).is_file(), rel)
        self.assertIn("Cache-Control: public, max-age=0, must-revalidate", (self.out / "_headers").read_text())
        pw.write_package(self.repo, self.out, pw.verified_files(self.repo))   # its own folder may be replaced

    def test_a_stale_file_writes_nothing(self) -> None:
        fake_repo(self.repo, self.files)
        (self.repo / "shared/activities/ride.js").write_bytes(b"changed after the manifest")
        with self.assertRaisesRegex(pw.PackageError, "ride.js: sha256"):
            pw.verified_files(self.repo)
        self.assertFalse(self.out.exists())

    def test_a_path_leaving_the_repository_is_refused(self) -> None:
        fake_repo(self.repo, self.files, [pw.ENTRY, "../outside.js"])
        with self.assertRaisesRegex(pw.PackageError, "not a plain repository-relative path"):
            pw.verified_files(self.repo)

    def test_a_folder_it_did_not_write_is_not_replaced(self) -> None:
        fake_repo(self.repo, self.files)
        self.out.mkdir()
        (self.out / "precious.txt").write_text("keep")
        with self.assertRaisesRegex(pw.PackageError, "refusing to replace"):
            pw.write_package(self.repo, self.out, pw.verified_files(self.repo))
        self.assertEqual((self.out / "precious.txt").read_text(), "keep")

    def test_a_scene_that_sets_its_own_base_is_refused(self) -> None:
        with self.assertRaisesRegex(pw.PackageError, "no <base>"):
            pw.root_page('<html><head><base href="/"></head></html>')

    def test_the_map_list_covers_every_import_and_fetch(self) -> None:
        """MAP is written out by hand; this walks what the 2D map really loads."""
        web = REPO / "client/web"
        needed, todo = set(), ["src/main.js"]
        page = (web / "index.html").read_text()
        needed.update(re.findall(r'src="([^"]+)"', page))
        while todo:
            module = todo.pop()
            needed.add(module)
            text = (web / module).read_text()
            for spec in re.findall(r'from\s+"(\.[^"]+)"', text):
                rel = (pathlib.PurePosixPath(module).parent / spec).as_posix().replace("/./", "/").removeprefix("./")
                if rel not in needed:
                    todo.append(rel)
        fetched = re.findall(r'fetch(?:Json|Image)\("([^"]+)"', (web / "src/main.js").read_text())
        self.assertGreater(len(fetched), 5, "the fetch walk found nothing; its pattern is stale")
        for rel in fetched:
            needed.add(rel)
        packaged = set(pw.MAP) | set(pw.verified_files(REPO))
        for rel in sorted(needed):
            # Resolved as a browser does: a "../" past the site root stays at the root.
            path = posixpath.normpath(f"client/web/{rel}")
            while path.startswith("../"):
                path = path[3:]
            self.assertIn(path, packaged, f"the 2D map loads {rel} but the package does not ship {path}")

    def test_the_committed_manifest_verifies(self) -> None:
        files = pw.verified_files(REPO)
        self.assertIn(pw.ENTRY, files)


if __name__ == "__main__":
    unittest.main()
