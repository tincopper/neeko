"""路径身份台账护栏用例 —— 四种失败模式（未登记 / 失效 / 漂移 / owner 不唯一）都要能被抓到。"""
from __future__ import annotations

import json
import pathlib
import shutil
import tempfile
import unittest
from unittest import mock

from guards.checks import check_path_identity_scope as subject
from guards.core import ledger as ledger_mod
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo

OWNER = "src/shared/utils/fileRef.ts"
BACKSLASH = "  const p = s.replace(/\\\\/g, '/');\n"


def rewrite(count: int) -> str:
    return "export function n(s: string): string {\n" + BACKSLASH * count + "  return s;\n}\n"


def manifest(entries: dict) -> dict:
    return {
        "owner": OWNER,
        "valid_kinds": ["owner", "legit", "debt"],
        "manifest": {
            path: {"kind": kind, "counts": counts, "note": "夹具"}
            for path, (kind, counts) in entries.items()
        },
    }


class PathIdentityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = self.tmp / "repo"
        ledgers = self.tmp / "ledger"
        ledgers.mkdir()
        patcher = mock.patch.object(ledger_mod, "LEDGER_DIR", ledgers)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.ledger_dir = ledgers

    def write_ledger(self, entries: dict) -> None:
        (self.ledger_dir / "path_identity_scope.json").write_text(
            json.dumps(manifest(entries), ensure_ascii=False), encoding="utf-8"
        )

    def run_guard(self, files: dict, entries: dict):
        make_repo(self.root, files)
        self.write_ledger(entries)
        return subject.check(context(self.root))

    def test_consistent_ledger_passes(self):
        result = self.run_guard(
            {OWNER: rewrite(2), "src/ui/MarkdownPreview.tsx": rewrite(1)},
            {OWNER: ("owner", {"backslash": 2}), "src/ui/MarkdownPreview.tsx": ("legit", {"backslash": 1})},
        )
        self.assertEqual(result.verdict, PASS)
        self.assertIn("owner 1", result.metrics)

    def test_unregistered_hit_is_caught(self):
        """这是本护栏的主要拦截目标：新增一处归一却没登记。"""
        result = self.run_guard(
            {OWNER: rewrite(1), "src/features/x/useThing.ts": rewrite(1)},
            {OWNER: ("owner", {"backslash": 1})},
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("未登记命中", str([f.message for f in result.findings]))

    def test_stale_entry_is_caught(self):
        result = self.run_guard(
            {OWNER: rewrite(1)},
            {
                OWNER: ("owner", {"backslash": 1}),
                "src/gone.ts": ("legit", {"backslash": 3}),
            },
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("登记失效", str([f.message for f in result.findings]))

    def test_count_drift_is_caught(self):
        result = self.run_guard(
            {OWNER: rewrite(3)},
            {OWNER: ("owner", {"backslash": 2})},
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("计数漂移", str([f.message for f in result.findings]))

    def test_missing_owner_is_caught(self):
        result = self.run_guard(
            {OWNER: rewrite(1)},
            {OWNER: ("legit", {"backslash": 1})},
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("owner 必须恰为", str([f.message for f in result.findings]))

    def test_illegal_kind_is_caught(self):
        result = self.run_guard(
            {OWNER: rewrite(1)},
            {OWNER: ("fine", {"backslash": 1})},
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("分类非法", str([f.message for f in result.findings]))

    def test_test_files_are_out_of_scope(self):
        result = self.run_guard(
            {OWNER: rewrite(1), "src/shared/utils/__tests__/fileRef.test.ts": rewrite(4)},
            {OWNER: ("owner", {"backslash": 1})},
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_empty_scan_set_is_an_infra_failure(self):
        self.write_ledger({OWNER: ("owner", {"backslash": 1})})
        result = subject.check(context(self.root))
        self.assertEqual(result.verdict, ERROR)


class RealLedgerTest(unittest.TestCase):
    def test_repository_ledger_is_consistent(self):
        root = ledger_mod.LEDGER_DIR
        repo = root.parents[2]
        result = subject.check(context(repo))
        self.assertEqual(result.verdict, PASS, [f.as_text() for f in result.findings])


if __name__ == "__main__":
    unittest.main()
