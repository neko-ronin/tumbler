"""client/web/tools/package_web.py: what it copies, and what it refuses to write.

    python3.11 -m unittest client.web.tests.test_package_web -v
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("package_web_under_test", REPO / "client/web/tools/package_web.py")
assert _spec is not None and _spec.loader is not None
pw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pw)


def fake_repo(root: pathlib.Path, files: dict[str, bytes], manifest_paths: list[str] | None = None) -> None:
    """A repository holding `files`, the licence, and a viewer.json that names `manifest_paths` (default: all)."""
    for rel, data in {**files, pw.EXTRAS[0]: b"MIT"}.items():
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
        self.files = {pw.ENTRY: b"<!doctype html>", "shared/activities/ride.js": b"export const r = 1;"}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_it_keeps_repository_paths_and_adds_the_licence_and_redirect(self) -> None:
        fake_repo(self.repo, self.files)
        pw.write_package(self.repo, self.out, pw.verified_files(self.repo))
        for rel, data in self.files.items():
            self.assertEqual((self.out / rel).read_bytes(), data, rel)
        self.assertTrue((self.out / pw.MANIFEST).is_file())
        self.assertTrue((self.out / pw.EXTRAS[0]).is_file())
        self.assertIn(f"url={pw.ENTRY}", (self.out / "index.html").read_text())
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

    def test_the_committed_manifest_verifies(self) -> None:
        files = pw.verified_files(REPO)
        self.assertIn(pw.ENTRY, files)


if __name__ == "__main__":
    unittest.main()
