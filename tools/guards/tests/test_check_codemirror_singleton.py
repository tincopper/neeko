"""CodeMirror 单实例护栏用例。"""
from __future__ import annotations

import unittest

from guards.checks import check_codemirror_singleton as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

HEADER = "lockfileVersion: '9.0'\nsnapshots:\n"


def entry(version: str) -> str:
    return f"  '@codemirror/view@{version}':\n"


class CodemirrorTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, lock: str):
        make_repo(self.root, {"pnpm-lock.yaml": HEADER + lock})
        return subject.check(context(self.root))

    def test_single_version_passes(self):
        result = self.run_guard(entry("6.43.11"))
        self.assertEqual(result.verdict, PASS)
        self.assertIn("6.43.11", result.metrics)

    def test_two_versions_are_a_violation_naming_the_referencers(self):
        lock = entry("6.43.11") + entry("6.43.9") + "  '@neeko/x@1':\n    '@codemirror/view': 6.43.9\n"
        result = self.run_guard(lock)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("6.43.9", result.findings[0].message)
        self.assertTrue(any("@neeko/x@1" in f.message for f in result.findings), result.findings)

    def test_zero_parsed_entries_is_an_infra_failure_not_a_violation(self):
        """lockfile 格式变了属于「口径失效」：报违规会把人指向错误的修复方向。"""
        result = self.run_guard("  something-else@1.0.0:\n")
        self.assertEqual(result.verdict, ERROR)

    def test_missing_lockfile_is_an_infra_failure(self):
        result = subject.check(context(self.root))
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("lockfile", result.error)


if __name__ == "__main__":
    unittest.main()
