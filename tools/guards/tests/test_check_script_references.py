"""`pnpm <script>` 引用护栏用例。"""
from __future__ import annotations

import json
import unittest

from guards.checks import check_script_references as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

SCRIPTS = {"lint": "eslint src", "lint:fe": "eslint src", "test": "vitest run", "tauri": "tauri"}


def pkg(scripts=None) -> str:
    return json.dumps({"name": "x", "scripts": SCRIPTS if scripts is None else scripts})


class ScriptReferenceTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_references_that_exist_pass(self):
        result = self.run_guard(
            {
                "package.json": pkg(),
                "lefthook.yml": "      run: pnpm lint:fe\n      run: pnpm test\n",
                "AGENTS.md": "pnpm lint\npnpm run test\n",
            }
        )
        self.assertEqual(result.verdict, PASS)
        self.assertIn("2 个文件", result.metrics)

    def test_unknown_script_name_is_a_violation_with_location(self):
        result = self.run_guard(
            {"package.json": pkg(), "lefthook.yml": "      run: pnpm lint:fe:static\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].file, "lefthook.yml")
        self.assertEqual(result.findings[0].line, 1)
        self.assertIn("lint:fe:static", result.findings[0].message)

    def test_pnpm_builtins_and_forwarded_bins_are_not_scripts(self):
        result = self.run_guard(
            {
                "package.json": pkg(),
                "CONTRIBUTING.md": (
                    "pnpm install\npnpm add -D x\npnpm exec vitest\npnpm run lint\n"
                    "pnpm lefthook install\npnpm tauri dev\n"
                ),
            }
        )
        self.assertEqual(result.verdict, PASS, [f.message for f in result.findings])
        # `pnpm -C <path> run <name>` 以 `-` 开头 ⇒ 正则不匹配，等于跳过（刻意：那是另一个包）。
        result = self.run_guard(
            {"package.json": pkg(), "CONTRIBUTING.md": "pnpm -C packages/x run check\n"}
        )
        self.assertEqual(result.verdict, PASS)

    def test_spec_tree_and_workflow_files_are_scanned(self):
        result = self.run_guard(
            {
                "package.json": pkg(),
                ".github/workflows/ci.yml": "        run: pnpm test:run\n",
                ".trellis/spec/frontend/quality-guidelines.md": "pnpm lint:all\n",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(
            {f.file for f in result.findings},
            {".github/workflows/ci.yml", ".trellis/spec/frontend/quality-guidelines.md"},
        )

    def test_version_narration_is_not_a_command(self):
        """`注意 pnpm v11 不读 overrides` —— 版本号不是脚本名（实测命中过）。"""
        result = self.run_guard(
            {
                "package.json": pkg(),
                "CONTRIBUTING.md": "注意 pnpm v11 不读 package.json 顶层 overrides。\n",
            }
        )
        self.assertEqual(result.verdict, PASS, [f.message for f in result.findings])
        self.assertIn("0 处 pnpm 引用", result.metrics)

    def test_missing_package_json_is_an_infra_failure(self):
        result = self.run_guard({"lefthook.yml": "run: pnpm lint\n"})
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("package.json", result.error)

    def test_package_json_without_scripts_is_an_infra_failure(self):
        result = self.run_guard({"package.json": pkg(scripts={}), "lefthook.yml": "x\n"})
        self.assertEqual(result.verdict, ERROR)

    def test_empty_scan_set_is_an_infra_failure(self):
        make_repo(self.root, {"package.json": pkg()})
        result = subject.check(context(self.root))
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("实时面", result.error)

    def test_broken_package_json_is_an_infra_failure(self):
        result = self.run_guard({"package.json": "{ not json", "lefthook.yml": "x\n"})
        self.assertEqual(result.verdict, ERROR)


if __name__ == "__main__":
    unittest.main()
