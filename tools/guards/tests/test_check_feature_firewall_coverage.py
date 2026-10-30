"""防火墙覆盖面护栏用例 —— 两侧漂移都必须被抓到，且「配置读不出来」必须报失效。

重点是变异可判：把被测的覆盖判定删掉，任一用例都要红；否则「恒绿」与「真在查」不可区分。
"""
from __future__ import annotations

import unittest

from guards.checks import check_feature_firewall_coverage as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

CONFIG = ".eslintrc.cjs"


def config_with(*names: str) -> str:
    items = ", ".join(f"'{name}'" for name in names)
    return f"const FEATURE_DIRS = [\n  {items},\n];\nmodule.exports = {{}};\n"


class FeatureFirewallCoverageGuardTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_one_to_one_mapping_passes(self):
        result = self.run_guard(
            {
                CONFIG: config_with("agent", "file"),
                "src/features/agent/index.ts": "",
                "src/features/file/index.ts": "",
            }
        )
        self.assertEqual(result.verdict, PASS)
        # 两侧都参与判定：2 个目录 + 2 条清单。
        self.assertEqual(result.scanned, 4)

    def test_directory_missing_from_the_list_is_a_violation(self):
        """本类缺陷的原始形态：目录在、清单没有 ⇒ 该域不受防火墙约束。"""
        result = self.run_guard(
            {
                CONFIG: config_with("agent"),
                "src/features/agent/index.ts": "",
                "src/features/agent-chat/index.ts": "",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("agent-chat" in f.message for f in result.findings))
        self.assertEqual(result.findings[0].file, CONFIG)

    def test_stale_entry_not_on_disk_is_a_violation(self):
        result = self.run_guard(
            {
                CONFIG: config_with("agent", "ghost"),
                "src/features/agent/index.ts": "",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("ghost" in f.message for f in result.findings))

    def test_declaration_line_points_at_the_editable_line(self):
        result = self.run_guard(
            {
                CONFIG: "// 注释\n" + config_with("agent"),
                "src/features/agent/index.ts": "",
                "src/features/file/index.ts": "",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 2)

    def test_non_feature_directories_are_ignored(self):
        result = self.run_guard(
            {
                CONFIG: config_with("agent"),
                "src/features/agent/index.ts": "",
                "src/features/__tests__/whatever.ts": "",
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_missing_declaration_block_is_a_guard_error(self):
        """块被改名/重构 ⇒ 退出码 2，而不是「清单为空所以全缺」或静默通过。"""
        result = self.run_guard({CONFIG: "module.exports = {};\n"})
        self.assertEqual(result.verdict, ERROR)

    def test_missing_feature_root_is_a_guard_error(self):
        result = self.run_guard({CONFIG: config_with("agent")})
        self.assertEqual(result.verdict, ERROR)

    def test_parser_reads_quoted_names_and_ignores_comments(self):
        """配置里混注释时仍只取字符串项（正则只认引号内的名字）。"""
        source = "const FEATURE_DIRS = [\n  // 说明\n  'agent', \"file\",\n];\n"
        self.assertEqual(subject.declared_feature_dirs(source), ["agent", "file"])
        self.assertIsNone(subject.declared_feature_dirs("module.exports = {};\n"))


if __name__ == "__main__":
    unittest.main()
