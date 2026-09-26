"""台账加载 —— 空台账会让护栏失去判据却仍报 OK，所以它必须直接失败。"""
from __future__ import annotations

import json
import pathlib
import shutil
import tempfile
import unittest
from unittest import mock

from guards.core import ledger as ledger_mod
from guards.core.ledger import LedgerError, load_ledger


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        patcher = mock.patch.object(ledger_mod, "LEDGER_DIR", self.tmp)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, data) -> None:
        (self.tmp / "sample.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )

    def test_missing_file_is_fatal(self):
        with self.assertRaises(LedgerError) as ctx:
            load_ledger("sample")
        self.assertIn("台账文件缺失", str(ctx.exception))

    def test_unparseable_file_is_fatal(self):
        (self.tmp / "sample.json").write_text("{nope", encoding="utf-8")
        with self.assertRaises(LedgerError) as ctx:
            load_ledger("sample")
        self.assertIn("解析失败", str(ctx.exception))

    def test_missing_required_key_is_named(self):
        self.write({"a": {"x": 1}})
        with self.assertRaises(LedgerError) as ctx:
            load_ledger("sample", required_keys=("a", "manifest"))
        self.assertIn("manifest", str(ctx.exception))

    def test_non_object_top_level_is_fatal(self):
        """`[]` 之类的顶层结构会让所有按 key 取值的判据都拿不到东西，却仍可能报绿。"""
        (self.tmp / "sample.json").write_text("[1, 2]", encoding="utf-8")
        with self.assertRaises(LedgerError) as ctx:
            load_ledger("sample")
        self.assertIn("顶层非空对象", str(ctx.exception))

    def test_empty_collection_value_is_rejected(self):
        """`{"manifest": {}}` 会让「未登记命中」永远查不出来。"""
        self.write({"manifest": {}, "note": "x"})
        with self.assertRaises(LedgerError) as ctx:
            load_ledger("sample")
        self.assertIn("manifest", str(ctx.exception))

    def test_valid_ledger_round_trips(self):
        self.write({"manifest": {"a.ts": {"kind": "legit"}}})
        self.assertEqual(load_ledger("sample")["manifest"]["a.ts"]["kind"], "legit")


class ShippedLedgersTest(unittest.TestCase):
    def test_real_ledgers_load_with_their_required_keys(self):
        self.assertTrue(load_ledger("path_identity_scope", ("owner", "valid_kinds", "manifest")))
        self.assertTrue(
            load_ledger(
                "agents_md_routing",
                ("root_file", "nested", "size_caps", "pair_cap", "signatures"),
            )
        )


if __name__ == "__main__":
    unittest.main()
