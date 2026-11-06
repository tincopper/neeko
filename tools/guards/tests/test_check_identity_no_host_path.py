"""`check_identity_no_host_path` 用例 —— 重点是「把 Path 加回去必须被抓到」。"""
from __future__ import annotations

import json
import pathlib
import shutil
import tempfile
import unittest
from unittest import mock

from guards.checks import check_identity_no_host_path as subject
from guards.core import ledger as ledger_mod
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo

LEDGER = f"tools/guards/ledger/{subject.LEDGER}.json"
IDENTITY = "src-tauri/src/common/git/unit_scope.rs"


def ledger(modules):
    return json.dumps({"note": "n", "modules": modules})


class IdentityNoHostPathTest(unittest.TestCase):
    def setUp(self):
        # 台账目录按 path_identity_scope 的既有做法注入临时目录：load_ledger 读的是模块级
        # LEDGER_DIR，不 patch 的话会读到真实台账（三个模块在临时仓库里都不存在）。
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = self.tmp / "repo"
        self.root.mkdir()
        ledgers = self.tmp / "ledger"
        ledgers.mkdir()
        patcher = mock.patch.object(ledger_mod, "LEDGER_DIR", ledgers)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.ledgers = ledgers

    def run_guard(self, files):
        make_repo(self.root, files)
        (self.ledgers / f"{subject.LEDGER}.json").write_text(
            files[LEDGER], encoding="utf-8"
        )
        return subject.check(context(self.root))

    def test_string_only_module_passes(self):
        result = self.run_guard(
            {
                LEDGER: ledger({IDENTITY: {"note": "单元归属"}}),
                IDENTITY: "fn contains(a: &str, b: &str) -> bool { a.starts_with(b) }\n",
            }
        )
        self.assertEqual(result.verdict, PASS, result.findings)
        self.assertEqual(result.scanned, 1)

    def test_host_path_use_is_a_violation(self):
        """事故本体：`Path::new(path).starts_with(Path::new(root))`。"""
        result = self.run_guard(
            {
                LEDGER: ledger({IDENTITY: {"note": "单元归属"}}),
                IDENTITY: "use std::path::Path;\n\nfn c(a: &str) { Path::new(a).exists(); }\n",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 1)
        self.assertIn("std::path", result.findings[0].message)

    def test_std_fs_is_a_violation(self):
        """时刻无关性（I3）：身份比较不得问「此刻磁盘上有什么」。"""
        result = self.run_guard(
            {
                LEDGER: ledger({IDENTITY: {"note": "单元归属"}}),
                IDENTITY: "fn c(p: &str) -> bool { std::fs::metadata(p).is_ok() }\n",
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("std::fs", result.findings[0].message)

    def test_comments_explaining_the_rule_are_not_violations(self):
        """文档里必须能写「不要用 std::path」—— 否则规则与它的解释互斥。"""
        result = self.run_guard(
            {
                LEDGER: ledger({IDENTITY: {"note": "单元归属"}}),
                IDENTITY: "// 禁止 std::path / PathBuf：那是宿主语义\n/// Path::new 会按平台切分量\nfn ok() {}\n",
            }
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_missing_registered_module_is_a_violation(self):
        result = self.run_guard({LEDGER: ledger({IDENTITY: {"note": "已删除"}})})
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("登记失效", result.findings[0].message)


if __name__ == "__main__":
    unittest.main()
