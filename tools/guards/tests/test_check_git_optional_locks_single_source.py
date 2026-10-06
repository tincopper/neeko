"""git 只读语义单源护栏用例 —— 判据是「字面量全仓 .rs 只出现一次（含注释也不许复述）」。"""
from __future__ import annotations

import unittest

from guards.checks import check_git_optional_locks_single_source as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

CALLER = "src-tauri/src/common/git/operations/files.rs"
INTEGRATION = "src-tauri/tests/git_test.rs"
SINGLE_SOURCE = "src-tauri/src/common/executor/env_defaults.rs"


class GitOptionalLocksSingleSourceTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_env_literal_in_code_is_a_violation(self):
        result = self.run_guard(
            {
                CALLER: (
                    "fn f() {\n"
                    '    let opts = GitExecOptions { env: &[("GIT_OPTIONAL_LOCKS", "0")] };\n'
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 2)
        self.assertIn("GIT_OPTIONAL_LOCKS", result.findings[0].message)

    def test_cli_flag_in_string_is_a_violation(self):
        result = self.run_guard(
            {CALLER: 'fn f() { run(&["git", "--no-optional-locks", "status"]); }\n'}
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("--no-optional-locks", result.findings[0].message)

    def test_literal_in_line_comment_is_a_violation(self):
        """注释也不许复述字面量（这正是「零词法分析」判据的代价与价值）。"""
        result = self.run_guard(
            {CALLER: "// 只读语义由 GIT_OPTIONAL_LOCKS=0 单点注入\nfn f() {}\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 1)

    def test_literal_in_block_comment_is_a_violation(self):
        result = self.run_guard(
            {CALLER: "/* --no-optional-locks 说明 */\nfn f() {}\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_single_source_file_is_exempt(self):
        result = self.run_guard(
            {SINGLE_SOURCE: 'const T: &[(&str, &str)] = &[("GIT_OPTIONAL_LOCKS", "0")];\n'}
        )
        self.assertEqual(result.verdict, PASS)
        self.assertEqual(result.scanned, 1)

    def test_violation_in_integration_tests_tree_is_found(self):
        """集成测试树也必须纳入扫描（否则 `--staged` 选路会漏掉这棵树）。"""
        result = self.run_guard({INTEGRATION: 'let _ = "--no-optional-locks";\n'})
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].file, INTEGRATION)

    def test_violation_in_nested_module_is_found(self):
        """防止扫描集退化成只查顶层目录。"""
        result = self.run_guard(
            {"src-tauri/src/a/b/c/deep.rs": 'let x = "GIT_OPTIONAL_LOCKS";\n'}
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_raw_string_content_is_still_scanned(self):
        result = self.run_guard(
            {CALLER: 'fn f() { let _ = r#"// GIT_OPTIONAL_LOCKS"#; }\n'}
        )
        self.assertEqual(result.verdict, VIOLATION)


if __name__ == "__main__":
    unittest.main()
