"""守门人的用例 —— `run_suite` 挡在所有护栏前面，它自己不能没人守。

夹具目录固定为 `<tmp>/neeko-guards-selftest-fixtures`，`setUpModule` 进入时清空：
这样它跨运行不自积垃圾，同时文件在进程退出时仍存在 —— 用 `python -m trace` 量覆盖率时，
提前删掉的被跟踪文件会让 trace 在收尾写盘阶段炸掉。
"""
from __future__ import annotations

import io
import pathlib
import shutil
import sys
import tempfile
import unittest

from guards.core import selftest

FIXTURE_ROOT = pathlib.Path(tempfile.gettempdir()) / "neeko-guards-selftest-fixtures"


def setUpModule():
    shutil.rmtree(FIXTURE_ROOT, ignore_errors=True)
    FIXTURE_ROOT.mkdir(parents=True)


def fixture_dir(name: str, test_source: str) -> pathlib.Path:
    root = FIXTURE_ROOT / name
    root.mkdir(parents=True)
    (root / f"test_gen_{name}.py").write_text(
        "import unittest\n\n"
        "class Generated(unittest.TestCase):\n"
        f"{test_source}\n",
        encoding="utf-8",
    )
    return root


class RunSuiteTest(unittest.TestCase):
    def tearDown(self):
        for module in [m for m in sys.modules if m.startswith("test_gen_")]:
            del sys.modules[module]

    def run_on(self, name, test_source):
        root = fixture_dir(name, test_source)
        return selftest.run_suite(io.StringIO(), start_dir=root, top_level_dir=root)

    def test_passing_suite_reports_counts(self):
        ok, summary = self.run_on("passing", "    def test_a(self):\n        self.assertTrue(True)")
        self.assertTrue(ok, summary)
        self.assertIn("1 用例", summary)

    def test_failing_suite_returns_false(self):
        ok, summary = self.run_on("failing", "    def test_a(self):\n        self.fail('炸了')")
        self.assertFalse(ok)
        self.assertIn("1 失败", summary)

    def test_empty_dir_is_not_green(self):
        """0 个用例必须判失败 —— 与护栏的「扫描集为空」是同一条反空转规则。"""
        root = FIXTURE_ROOT / "empty"
        root.mkdir()
        ok, summary = selftest.run_suite(io.StringIO(), start_dir=root, top_level_dir=root)
        self.assertFalse(ok)
        self.assertIn("0 个用例", summary)

    def test_default_target_is_the_real_suite(self):
        self.assertTrue(selftest.TESTS_DIR.is_dir())
        self.assertEqual(selftest.TOOLS_DIR, selftest.TESTS_DIR.parents[1])


if __name__ == "__main__":
    unittest.main()
