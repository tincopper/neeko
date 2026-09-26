"""工作区字节断言护栏用例 —— 含「自写豁免」的边界，防它退化成一律放行。"""
from __future__ import annotations

import unittest

from guards.checks import check_worktree_byte_assertions as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

FIXTURE = "src-tauri/tests/git_test.rs"


class WorktreeByteTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, body: str):
        make_repo(self.root, {FIXTURE: body})
        return subject.check(context(self.root))

    def test_exact_byte_assertion_after_read_is_a_violation(self):
        result = self.run_guard(
            "#[test]\n"
            "fn stash_apply_restores_changes() {\n"
            "    let content = std::fs::read_to_string(&path).unwrap();\n"
            '    assert_eq!(content, "hello");\n'
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 4)

    def test_self_authored_file_without_git_is_exempt(self):
        """测试自己写进去的字节与 autocrlf 无关 —— 豁免，但仍计入扫描数。"""
        result = self.run_guard(
            "#[test]\n"
            "fn rotate_log_keeps_append_handle() {\n"
            "    std::fs::write(&path, b\"x\").unwrap();\n"
            "    let content = std::fs::read_to_string(&path).unwrap();\n"
            '    assert_eq!(content, "x");\n'
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)
        self.assertIn("豁免 1", result.metrics)

    def test_self_write_inside_a_git_test_is_not_exempt(self):
        """先自写再经 git 落盘，字节就可能被重新物化 —— 豁免必须保守。"""
        result = self.run_guard(
            "#[test]\n"
            "fn restores_after_write() {\n"
            "    std::fs::write(&path, b\"x\").unwrap();\n"
            "    let content = std::fs::read_to_string(&path).unwrap();\n"
            '    assert_eq!(content, "x");\n'
            "    git_commit();\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_normalized_comparison_is_accepted(self):
        result = self.run_guard(
            "#[test]\n"
            "fn reads_stash() {\n"
            "    let content = std::fs::read_to_string(&path).unwrap();\n"
            '    assert_eq!(content.replace("\\r\\n", "\\n"), "hello");\n'
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_repeated_variable_names_do_not_shadow_each_other(self):
        """两个测试复用 `content` 是常态：按名字建 dict 会让报告张冠李戴。"""
        result = self.run_guard(
            "#[test]\n"
            "fn first_stash() {\n"
            "    let content = std::fs::read_to_string(&a).unwrap();\n"
            '    assert_eq!(content, "one");\n'
            "}\n"
            "\n"
            "#[test]\n"
            "fn second_stash() {\n"
            "    let content = std::fs::read_to_string(&b).unwrap();\n"
            '    assert_eq!(content, "two");\n'
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual([f.line for f in result.findings], [4, 10])
        self.assertIn('"one"', result.findings[0].message)
        self.assertIn('"two"', result.findings[1].message)

    def test_clean_tree_passes(self):
        make_repo(self.root, {FIXTURE: "#[test]\nfn ok() {\n    assert_eq!(1, 1);\n}\n"})
        self.assertEqual(subject.check(context(self.root)).verdict, PASS)


if __name__ == "__main__":
    unittest.main()
