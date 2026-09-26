"""scope 匹配与仓库根定位 —— 后者是 2026-09-16「空转护栏」事故的根因所在。"""
from __future__ import annotations

import pathlib
import tempfile
import unittest

from guards.core import repo


class FindRootTest(unittest.TestCase):
    def test_walks_up_to_the_marker_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / ".git").mkdir()
            (root / "package.json").write_text("{}")
            deep = root / "tools" / "guards" / "checks"
            deep.mkdir(parents=True)
            self.assertEqual(repo.find_repo_root(deep / "x.py"), root)

    def test_refuses_to_guess_a_root(self):
        """没有 marker 就必须失败 —— 静默返回一个「看起来像根」的目录正是恒绿事故的形状。"""
        with tempfile.TemporaryDirectory() as tmp:
            stray = pathlib.Path(tmp) / "a" / "b"
            stray.mkdir(parents=True)
            with self.assertRaises(repo.RepoRootNotFound):
                repo.find_repo_root(stray)

    def test_worktree_style_dotgit_file_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / ".git").write_text("gitdir: /elsewhere")
            (root / "package.json").write_text("{}")
            self.assertEqual(repo.find_repo_root(root / "src" / "x.ts"), root)


class ScopeMatchTest(unittest.TestCase):
    def test_recursive_glob_matches_any_depth(self):
        self.assertTrue(repo.matches_any(["src/**/*.ts"], "src/a/b/c.ts"))
        self.assertTrue(repo.matches_any(["src/**/*.ts"], "src/a.ts"))
        self.assertFalse(repo.matches_any(["src/**/*.ts"], "src/a.tsx"))

    def test_single_star_does_not_cross_directories(self):
        self.assertTrue(repo.matches_any(["src/*.ts"], "src/a.ts"))
        self.assertFalse(repo.matches_any(["src/*.ts"], "src/deep/a.ts"))

    def test_bare_directory_scope_covers_its_subtree_and_itself(self):
        globs = ["src-tauri/src"]
        self.assertTrue(repo.matches_any(globs, "src-tauri/src/a/b.rs"))
        self.assertTrue(repo.matches_any(globs, "src-tauri/src"))
        self.assertFalse(repo.matches_any(globs, "src-tauri/tests/a.rs"))

    def test_intersects_is_empty_safe(self):
        self.assertFalse(repo.intersects(["src/**"], []))
        self.assertTrue(repo.intersects(["src/**", "docs/**"], ["docs/x.md"]))


if __name__ == "__main__":
    unittest.main()
