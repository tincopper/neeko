"""`check_embedded_asset_eol` 用例 —— 重点是负例：「钉错了地方」必须被抓到。"""
from __future__ import annotations

import unittest

from guards.checks import check_embedded_asset_eol as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo


class EmbeddedAssetEolTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_pinned_directory_passes_and_counts_the_asset(self):
        result = self.run_guard(
            {
                ".gitattributes": "src-tauri/src/hooks/templates/* text eol=lf\n",
                "src-tauri/src/hooks/templates/mod.rs": 'const T: &str = include_str!("a.ts");\n',
                "src-tauri/src/hooks/templates/a.ts": "x\n",
            }
        )
        self.assertEqual(result.verdict, PASS, result.findings)
        self.assertEqual(result.scanned, 1)
        self.assertIn("1 个资产", result.metrics)

    def test_asset_without_attribute_is_a_violation(self):
        result = self.run_guard(
            {
                ".gitattributes": "src-tauri/src/other/* text eol=lf\n",
                "src-tauri/src/hooks/mod.rs": 'const T: &str = include_str!("b.ts");\n',
                "src-tauri/src/hooks/b.ts": "x\n",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 1)
        self.assertIn("src-tauri/src/hooks/b.ts", result.findings[0].message)

    def test_pattern_that_does_not_match_the_asset_is_a_violation(self):
        """钉的是兄弟目录 —— 看着像修过，实际没盖住。"""
        result = self.run_guard(
            {
                ".gitattributes": "src-tauri/src/hooks/* text eol=lf\n",
                "src-tauri/src/hooks/deep/mod.rs": 'const T: &str = include_str!("c.ts");\n',
                "src-tauri/src/hooks/deep/c.ts": "x\n",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_double_star_pattern_covers_nested_asset(self):
        result = self.run_guard(
            {
                ".gitattributes": "src-tauri/src/hooks/** text eol=lf\n",
                "src-tauri/src/hooks/deep/mod.rs": 'const T: &str = include_str!("c.ts");\n',
                "src-tauri/src/hooks/deep/c.ts": "x\n",
            }
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_explicit_binary_attr_also_satisfies_the_rule(self):
        """`-text` = 「别动它的字节」，与 eol=lf 同属「不随宿主变形」。"""
        result = self.run_guard(
            {
                ".gitattributes": "src-tauri/src/binary/* -text\n",
                "src-tauri/src/binary/mod.rs": 'const T: &str = include_str!("d.txt");\n',
                "src-tauri/src/binary/d.txt": "x\n",
            }
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_non_literal_include_is_a_violation(self):
        result = self.run_guard(
            {
                ".gitattributes": "src-tauri/src/* text eol=lf\n",
                "src-tauri/src/mod.rs": 'const T: &str = include_str!(concat!("a", ".ts"));\n',
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("非字面量", result.findings[0].message)

    def test_unreadable_gitattributes_is_a_guard_error(self):
        result = self.run_guard(
            {"src-tauri/src/mod.rs": 'const T: &str = include_str!("a.ts");\n'}
        )
        self.assertEqual(result.verdict, ERROR)
        self.assertIn(".gitattributes", result.error)


if __name__ == "__main__":
    unittest.main()
