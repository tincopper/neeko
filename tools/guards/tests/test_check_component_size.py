"""check_component_size 用例 —— 组件/hook 规模 ≤300 的 ratchet。

判据不是「一次性全绿」（存量 59 个文件已越线），而是**新债止步、旧债只许缩小**。
夹具走临时仓库树；基线的「已登记路径」取自真实台账（与 check_agents_md_size 同款约定）。
"""
from __future__ import annotations

import unittest
from unittest import mock

from guards.checks import check_component_size as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.core.ledger import LedgerError, load_ledger
from guards.tests.support import context, make_repo, temp_repo


def ledger() -> dict:
    return load_ledger("component_size", required_keys=("max_lines", "baseline"))


LED = ledger()
MAX_LINES = LED["max_lines"]
BASELINE = LED["baseline"]
A_BASELINED = next(iter(BASELINE))


def body(lines: int) -> str:
    return "".join(f"export const x{i} = {i};\n" for i in range(lines))


class ComponentSizeTest(unittest.TestCase):
    def test_new_file_over_limit_is_a_violation(self):
        root = temp_repo(self)
        make_repo(root, {"src/x/components/Big.tsx": body(MAX_LINES + 1)})
        result = subject.check(context(root))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("红线" in f.message for f in result.findings))

    def test_new_file_at_limit_passes(self):
        root = temp_repo(self)
        make_repo(root, {"src/x/components/Ok.tsx": body(MAX_LINES)})
        self.assertEqual(subject.check(context(root)).verdict, PASS)

    def test_baselined_file_at_recorded_size_passes(self):
        root = temp_repo(self)
        make_repo(root, {A_BASELINED: body(BASELINE[A_BASELINED])})
        self.assertEqual(subject.check(context(root)).verdict, PASS)

    def test_baselined_file_shrinking_passes(self):
        root = temp_repo(self)
        make_repo(root, {A_BASELINED: body(304)})
        self.assertEqual(subject.check(context(root)).verdict, PASS)

    def test_baselined_file_growing_is_a_violation(self):
        root = temp_repo(self)
        make_repo(root, {A_BASELINED: body(BASELINE[A_BASELINED] + 1)})
        result = subject.check(context(root))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("基线" in f.message for f in result.findings))

    def test_test_files_are_not_counted(self):
        root = temp_repo(self)
        make_repo(
            root,
            {
                "src/x/components/__tests__/Big.test.tsx": body(MAX_LINES + 50),
                "src/x/components/Big.stories.tsx": body(10),
            },
        )
        self.assertEqual(subject.check(context(root)).verdict, PASS)

    def test_hooks_are_scanned_too(self):
        root = temp_repo(self)
        make_repo(root, {"src/x/hooks/useBig.ts": body(MAX_LINES + 1)})
        self.assertEqual(subject.check(context(root)).verdict, VIOLATION)

    def test_scanned_counts_component_and_hook_files(self):
        root = temp_repo(self)
        make_repo(
            root,
            {
                "src/x/components/A.tsx": body(10),
                "src/x/hooks/useA.ts": body(10),
            },
        )
        result = subject.check(context(root))
        self.assertGreaterEqual(result.scanned, 2)

    def test_missing_ledger_is_a_guard_error(self):
        def boom(name, required_keys=()):
            raise LedgerError("台账 component_size 缺失")

        with mock.patch.object(subject, "load_ledger", side_effect=boom):
            result = subject.check(context(__import__("pathlib").Path(".")))
        self.assertEqual(result.verdict, ERROR)


if __name__ == "__main__":
    unittest.main()
