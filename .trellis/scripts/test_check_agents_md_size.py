#!/usr/bin/env python3
"""check_agents_md_size.py 的单元测试。

运行：
    python3 .trellis/scripts/test_check_agents_md_size.py
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_agents_md_size as guard  # noqa: E402


def index_row(num: int, title: str, loc: str) -> str:
    return f"| {num} | {title} | {loc} |"


def make_repo(
    tmp: Path,
    root: str,
    src: str = "",
    tauri: str = "",
) -> None:
    (tmp / "AGENTS.md").write_text(root, encoding="utf-8")
    (tmp / "src").mkdir(exist_ok=True)
    (tmp / "src" / "AGENTS.md").write_text(src, encoding="utf-8")
    (tmp / "src-tauri").mkdir(exist_ok=True)
    (tmp / "src-tauri" / "AGENTS.md").write_text(tauri, encoding="utf-8")


def root_with_index(*rows: str) -> str:
    body = "\n".join(
        [
            "# Neeko — Repository Guidelines",
            "",
            "## AI 代码审查红线 (Review Gates)",
            "",
            "| # | 红线 | 全文位置 |",
            "| --- | --- | --- |",
            *rows,
            "",
        ]
    )
    return body


ROOT_NUMS = (4, 5, 14)
SRC_NUMS = (12,)


def home_of(num: int) -> str:
    if num in ROOT_NUMS:
        return "本文件 ↓"
    if num in SRC_NUMS:
        return "`src/AGENTS.md`"
    return "`src-tauri/AGENTS.md`"


def full_index() -> str:
    return root_with_index(
        *(index_row(n, guard.SIGNATURES[n], home_of(n)) for n in sorted(guard.SIGNATURES))
    )


def bodies(nums) -> str:
    return "".join(f"\n**{n}. {guard.SIGNATURES[n]}** —— 正文。\n" for n in nums)


class GuardTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._saved_repo = guard.REPO
        guard.REPO = self.tmp
        self.addCleanup(self._restore)

    def _restore(self):
        guard.REPO = self._saved_repo
        self._tmp.cleanup()

    @staticmethod
    def reset_cache():
        """兼容有/无显式 cache 参数两种签名，避免跨用例串味。"""
        defaults = guard.actual_homes.__defaults__
        if defaults and defaults[0]:
            defaults[0].clear()


class ParseIndexTest(GuardTestCase):
    def test_reads_declared_homes(self):
        make_repo(
            self.tmp,
            root_with_index(
                index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`"),
                index_row(4, "**IPC 大文本边界**", "本文件 ↓"),
            ),
        )
        declared = guard.parse_index(guard.read("AGENTS.md"))
        self.assertEqual(declared[1], "src-tauri/AGENTS.md")
        self.assertEqual(declared[4], "AGENTS.md")

    def test_ignores_unknown_numbers(self):
        make_repo(
            self.tmp,
            root_with_index(index_row(99, "陌生编号", "`src/AGENTS.md`")),
        )
        self.assertEqual(guard.parse_index(guard.read("AGENTS.md")), {})


class SizeReportTest(GuardTestCase):
    def test_single_file_over_cap_is_reported(self):
        cap = guard.SIZE_CAPS["AGENTS.md"]
        make_repo(self.tmp, "# x\n" + "a" * (cap + 1))
        problems = guard.report_sizes()
        self.assertTrue(any("超过上限" in p for p in problems), problems)

    def test_file_within_cap_passes(self):
        make_repo(self.tmp, "# ok\n")
        self.assertEqual(guard.report_sizes(), [])

    def test_combined_size_over_total_cap_is_reported(self):
        """三文件各自在单文件上限内，但合计超 Codex 32KiB 合并预算 → 必须报错。"""
        make_repo(
            self.tmp,
            "# root\n" + "a" * (guard.SIZE_CAPS["AGENTS.md"] - 10),
            src="# src\n" + "b" * (guard.SIZE_CAPS["src/AGENTS.md"] - 10),
            tauri="# tauri\n" + "c" * (guard.SIZE_CAPS["src-tauri/AGENTS.md"] - 10),
        )
        total = sum((self.tmp / rel).stat().st_size for rel in guard.SCANNED)
        self.assertGreater(total, guard.TOTAL_CAP)
        problems = guard.report_sizes()
        self.assertTrue(any("合计" in p for p in problems), problems)

    def test_combined_size_under_total_cap_passes(self):
        make_repo(self.tmp, "# root\n", src="# src\n", tauri="# tauri\n")
        self.assertEqual(guard.report_sizes(), [])


class RoutingReportTest(GuardTestCase):
    def run_routing(self, root, src="", tauri=""):
        make_repo(self.tmp, root, src=src, tauri=tauri)
        self.reset_cache()
        return guard.report_routing()

    def test_consistent_routing_passes(self):
        backend = [n for n in sorted(guard.SIGNATURES) if n not in ROOT_NUMS + SRC_NUMS]
        make_repo(
            self.tmp,
            full_index() + bodies(ROOT_NUMS),
            src=bodies(SRC_NUMS),
            tauri=bodies(backend),
        )
        self.reset_cache()
        self.assertEqual(guard.report_routing(), [])

    def test_missing_index_row_is_reported(self):
        problems = self.run_routing("# 根\n## AI 代码审查红线 (Review Gates)\n\n空表\n")
        self.assertTrue(any("缺少编号" in p for p in problems), problems)

    def test_missing_body_is_reported(self):
        problems = self.run_routing(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
        )
        self.assertTrue(any("全文缺失" in p for p in problems), problems)

    def test_drift_between_declared_and_actual_home_is_reported(self):
        sig = guard.SIGNATURES[1]
        problems = self.run_routing(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            src=f"## 审查红线\n\n**1. {sig}** —— 正文写错了文件。\n",
        )
        self.assertTrue(any("落点漂移" in p for p in problems), problems)

    def test_duplicate_body_across_files_is_reported(self):
        sig = guard.SIGNATURES[1]
        body = f"## 审查红线\n\n**1. {sig}** —— 同一正文。\n"
        problems = self.run_routing(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            src=body,
            tauri=body,
        )
        self.assertTrue(any("多个文件" in p for p in problems), problems)

    def test_stray_body_form_is_reported(self):
        sig = guard.SIGNATURES[1]
        problems = self.run_routing(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            tauri=f"plain text mention of {sig} not under a heading\n",
        )
        self.assertTrue(any("形态异常" in p for p in problems), problems)

    def test_index_row_is_not_counted_as_body(self):
        """索引表里的签名命中（表格行）不算第二份正文。"""
        sig = guard.SIGNATURES[1]
        problems = self.run_routing(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            tauri=f"## 审查红线\n\n**1. {sig}** —— 正文。\n",
        )
        self.assertEqual([p for p in problems if "多个文件" in p], [])


class RealRepoTest(unittest.TestCase):
    def test_repository_passes_guard(self):
        self.assertEqual(guard.report_sizes(), [])
        self.assertEqual(guard.report_routing(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
