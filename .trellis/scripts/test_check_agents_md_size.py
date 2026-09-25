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

# 真实仓库根（import 时确定）：RealRepoTest 用它显式归位 REPO。
REAL_REPO = guard.REPO


def index_row(num: int, *cells: str) -> str:
    """构造一行台账：列数由调用方决定（落点始终是末列）。"""
    return "| " + " | ".join([str(num), *cells]) + " |"


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


LEDGER_HEADER = (
    "| # | 红线 | 必须 / 禁止（摘要） | 全文位置 |",
    "| --- | --- | --- | --- |",
)
LEGACY_HEADER = ("| # | 红线 | 全文位置 |", "| --- | --- | --- |")


def ledger_root(rows, header=LEDGER_HEADER) -> str:
    return "\n".join(
        [
            "# Neeko — Repository Guidelines",
            "",
            "## AI 代码审查红线 (Review Gates)",
            "",
            *header,
            *rows,
            "",
        ]
    )


def ledger_row(
    num: int, summary: str, loc: str = "`src-tauri/AGENTS.md`", title: str = ""
) -> str:
    """title 留空 → 用签名（= 正常形态）；显式传入可构造「台账标题漂移」用例。"""
    return index_row(num, title or guard.SIGNATURES[num], summary, loc)


def ledger_rows_all(summary: str = "摘要") -> list:
    return [ledger_row(n, summary) for n in sorted(guard.SIGNATURES)]


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


class ParseIndexTest(GuardTestCase):
    def test_reads_declared_homes(self):
        make_repo(
            self.tmp,
            root_with_index(
                index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`"),
                index_row(4, "**IPC 大文本边界**", "本文件 ↓"),
            ),
        )
        declared = guard.parse_index()
        self.assertEqual(declared[1], "src-tauri/AGENTS.md")
        self.assertEqual(declared[4], "AGENTS.md")

    def test_ignores_unknown_numbers(self):
        make_repo(
            self.tmp,
            root_with_index(index_row(99, "陌生编号", "`src/AGENTS.md`")),
        )
        self.assertEqual(guard.parse_index(), {})

    def test_location_is_last_column(self):
        """落点取末列 —— 摘要列插在中间时路由仍正确。"""
        make_repo(
            self.tmp,
            root_with_index(index_row(1, "统一命令执行接口", "摘要", "`src-tauri/AGENTS.md`")),
        )
        self.assertEqual(guard.parse_index()[1], "src-tauri/AGENTS.md")


class SizeReportTest(GuardTestCase):
    def test_single_file_over_cap_is_reported(self):
        cap = guard.SIZE_CAPS["AGENTS.md"]
        make_repo(self.tmp, "# x\n" + "a" * (cap + 1))
        problems = guard.report_sizes()
        self.assertTrue(any("超过上限" in p for p in problems), problems)

    def test_file_within_cap_passes(self):
        make_repo(self.tmp, "# ok\n")
        self.assertEqual(guard.report_sizes(), [])

    @staticmethod
    def at_cap(prefix: str, rel: str, delta: int = 10) -> str:
        """构造体积恰好压在上限内（cap - delta）的文件内容。"""
        return prefix + "a" * (guard.SIZE_CAPS[rel] - len(prefix) - delta)

    def test_root_plus_nested_over_pair_cap_is_reported(self):
        """root 与嵌套各自在单文件上限内，但 root + 嵌套超 Codex 祖先路径拼接预算 → 报错。"""
        make_repo(
            self.tmp,
            self.at_cap("# root\n", guard.ROOT_FILE),
            tauri=self.at_cap("# tauri\n", "src-tauri/AGENTS.md"),
        )
        pair = (self.tmp / guard.ROOT_FILE).stat().st_size + (
            self.tmp / "src-tauri/AGENTS.md"
        ).stat().st_size
        self.assertGreater(pair, guard.PAIR_CAP)
        problems = guard.report_sizes()
        self.assertTrue(
            any(f"{guard.ROOT_FILE} + src-tauri/AGENTS.md" in p for p in problems), problems
        )

    def test_pair_under_cap_passes(self):
        make_repo(self.tmp, "# root\n", src="# src\n", tauri="# tauri\n")
        self.assertEqual(guard.report_sizes(), [])

    def test_three_file_sum_is_not_a_constraint(self):
        """三文件求和不再设限：两个嵌套同时压满、root 很小 → 通过（修正前的假阳性）。"""
        make_repo(
            self.tmp,
            "# root\n",
            src=self.at_cap("# src\n", "src/AGENTS.md"),
            tauri=self.at_cap("# tauri\n", "src-tauri/AGENTS.md"),
        )
        total = sum((self.tmp / rel).stat().st_size for rel in guard.SCANNED)
        self.assertGreater(total, guard.PAIR_CAP)
        self.assertEqual(guard.report_sizes(), [])

    def test_pair_cap_is_reachable_within_single_file_caps(self):
        """常量自洽：单文件上限必须允许构造出超 PAIR_CAP 的组合，否则该项检查形同虚设。"""
        for nested in guard.NESTED:
            worst = guard.SIZE_CAPS[guard.ROOT_FILE] + guard.SIZE_CAPS[nested]
            self.assertGreater(worst, guard.PAIR_CAP, f"root + {nested} 永不可能超限")


class RoutingReportTest(GuardTestCase):
    def run_routing(self, root, src="", tauri=""):
        make_repo(self.tmp, root, src=src, tauri=tauri)
        return guard.report_routing()

    def test_consistent_routing_passes(self):
        backend = [n for n in sorted(guard.SIGNATURES) if n not in ROOT_NUMS + SRC_NUMS]
        make_repo(
            self.tmp,
            full_index() + bodies(ROOT_NUMS),
            src=bodies(SRC_NUMS),
            tauri=bodies(backend),
        )
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


class LedgerReportTest(GuardTestCase):
    """D：台账「摘要」列是嵌套文件未加载时的兜底 —— 必须非空、不超长、列数自洽。"""

    def run_ledger(self, rows, header=LEDGER_HEADER) -> list:
        make_repo(self.tmp, ledger_root(rows, header=header))
        return guard.report_ledger()

    def test_complete_ledger_passes(self):
        self.assertEqual(self.run_ledger(ledger_rows_all()), [])

    def test_missing_header_is_reported(self):
        make_repo(self.tmp, "# 根\n## AI 代码审查红线 (Review Gates)\n\n无表\n")
        problems = guard.report_ledger()
        self.assertTrue(any("缺少表头行" in p for p in problems), problems)

    def test_missing_summary_column_is_reported(self):
        rows = [index_row(n, guard.SIGNATURES[n], home_of(n)) for n in sorted(guard.SIGNATURES)]
        problems = self.run_ledger(rows, header=LEGACY_HEADER)
        self.assertTrue(any(guard.SUMMARY_COLUMN in p for p in problems), problems)

    def test_title_missing_signature_is_reported(self):
        """台账标题改写成同义词 = 同一条规则两个名字 → 必须报错（正文标题是唯一名字）。"""
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "摘要", title="命令执行接口统一")
        problems = self.run_ledger(rows)
        self.assertTrue(any("不含签名" in p for p in problems), problems)

    def test_longer_title_containing_signature_is_accepted(self):
        """只要求包含签名（正文标题通常带更长限定），不要求逐字相等。"""
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "摘要", title=f"{guard.SIGNATURES[1]}（Local/WSL/SSH）")
        self.assertEqual(self.run_ledger(rows), [])

    def test_empty_summary_is_reported(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "")
        problems = self.run_ledger(rows)
        self.assertTrue(any("摘要列为空" in p for p in problems), problems)

    def test_oversized_summary_is_reported(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "a" * (guard.SUMMARY_MAX_BYTES + 1))
        problems = self.run_ledger(rows)
        self.assertTrue(any("超过上限" in p for p in problems), problems)

    def test_unescaped_pipe_changes_cell_count_and_is_reported(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "摘要混了 | 两条 | 竖线")
        problems = self.run_ledger(rows)
        self.assertTrue(any("列数" in p for p in problems), problems)

    def test_missing_row_is_routing_business_not_ledger(self):
        """缺行是路由问题（落点缺失），摘要列不为它背锅 —— 保持两项检查职责分离。"""
        make_repo(self.tmp, ledger_root(ledger_rows_all()[:-1]))
        self.assertEqual(guard.report_ledger(), [])
        self.assertTrue(any("缺少编号" in p for p in guard.report_routing()))


class RealRepoTest(unittest.TestCase):
    """校验真实仓库。显式钉住 REPO —— 不依赖 GuardTestCase 的 addCleanup 是否已归位。"""

    def setUp(self):
        self._saved_repo = guard.REPO
        guard.REPO = REAL_REPO
        self.addCleanup(self._restore)

    def _restore(self):
        guard.REPO = self._saved_repo

    def test_repository_passes_guard(self):
        self.assertEqual(guard.report_sizes(), [])
        self.assertEqual(guard.report_ledger(), [])
        self.assertEqual(guard.report_routing(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
