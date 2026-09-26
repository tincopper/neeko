"""check_agents_md_size 用例（自 .trellis/scripts 迁移，判据用例逐条保留）。

迁移带来的结构性差别：原先靠 monkeypatch 模块级 `REPO` 常量来喂夹具仓库，
现在根目录由 `Context` 注入 —— 夹具与真实仓库互不污染，也不依赖 addCleanup 的顺序。
"""
from __future__ import annotations

import pathlib
import shutil
import tempfile
import unittest

from guards.checks import check_agents_md_size as subject
from guards.core.contract import PASS, VIOLATION
from guards.core.repo import find_repo_root
from guards.tests.support import context


def ledger() -> subject.Ledger:
    return subject.read_ledger()


LED = ledger()
SIGNATURES = LED.signatures


def index_row(num: int, *cells: str) -> str:
    return "| " + " | ".join([str(num), *cells]) + " |"


def make_repo(root: pathlib.Path, body: str, src: str = "", tauri: str = "") -> pathlib.Path:
    (root / "AGENTS.md").parent.mkdir(parents=True, exist_ok=True)
    (root / "AGENTS.md").write_text(body, encoding="utf-8")
    for rel, content in (("src/AGENTS.md", src), ("src-tauri/AGENTS.md", tauri)):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(content, encoding="utf-8")
    return root


def root_with_index(*rows: str, header=None) -> str:
    return "\n".join(
        [
            "# Neeko — Repository Guidelines",
            "",
            "## AI 代码审查红线 (Review Gates)",
            "",
            *(header or LEDGER_HEADER),
            *rows,
            "",
        ]
    )


LEDGER_HEADER = (
    "| # | 红线 | 必须 / 禁止（摘要） | 全文位置 |",
    "| --- | --- | --- | --- |",
)
LEGACY_HEADER = ("| # | 红线 | 全文位置 |", "| --- | --- | --- |")

ROOT_NUMS = (4, 5, 14)
SRC_NUMS = (12,)


def home_of(num: int) -> str:
    if num in ROOT_NUMS:
        return "本文件 ↓"
    if num in SRC_NUMS:
        return "`src/AGENTS.md`"
    return "`src-tauri/AGENTS.md`"


def ledger_row(num: int, summary: str, loc: str = "", title: str = "") -> str:
    return index_row(
        num, title or SIGNATURES[num], summary, loc or home_of(num)
    )


def ledger_rows_all(summary: str = "摘要") -> list:
    return [ledger_row(n, summary) for n in sorted(SIGNATURES)]


def bodies(nums) -> str:
    return "".join(f"\n**{n}. {SIGNATURES[n]}** —— 正文。\n" for n in nums)


def full_index() -> str:
    header = "| # | 红线 | 全文位置 |"
    return "\n".join(
        [
            "# Neeko",
            "",
            "## AI 代码审查红线 (Review Gates)",
            "",
            header,
            "| --- | --- | --- |",
            *[index_row(n, SIGNATURES[n], home_of(n)) for n in sorted(SIGNATURES)],
            "",
        ]
    )


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def parse_index(self, body: str) -> dict:
        make_repo(self.tmp, body)
        return subject.parse_index(self.tmp, LED)

    def route(self, root: str, src: str = "", tauri: str = "") -> list:
        make_repo(self.tmp, root, src=src, tauri=tauri)
        return subject.report_routing(self.tmp, LED)

    def ledger_problems(self, rows, header=None) -> list:
        make_repo(self.tmp, root_with_index(*rows, header=header))
        return subject.report_ledger(self.tmp, LED)


class ParseIndexTest(FixtureTest):
    def test_reads_declared_homes(self):
        declared = self.parse_index(
            root_with_index(
                index_row(1, "统一命令执行接口", "摘要", "`src-tauri/AGENTS.md`"),
                index_row(4, "**IPC 大文本边界**", "摘要", "本文件 ↓"),
                header=("| # | 红线 | 摘要 | 全文位置 |", "| --- | --- | --- | --- |"),
            )
        )
        self.assertEqual(declared[1], "src-tauri/AGENTS.md")
        self.assertEqual(declared[4], "AGENTS.md")

    def test_ignores_unknown_numbers(self):
        self.assertEqual(
            self.parse_index(root_with_index(index_row(99, "陌生编号", "`src/AGENTS.md`"))), {}
        )

    def test_location_is_the_last_column(self):
        declared = self.parse_index(
            root_with_index(
                index_row(1, "统一命令执行接口", "摘要", "`src-tauri/AGENTS.md`")
            )
        )
        self.assertEqual(declared[1], "src-tauri/AGENTS.md")


class SizeReportTest(FixtureTest):
    def at_cap(self, prefix: str, rel: str, delta: int = 10) -> str:
        return prefix + "a" * (LED.size_caps[rel] - len(prefix) - delta)

    def test_single_file_over_cap_is_reported(self):
        cap = LED.size_caps["AGENTS.md"]
        make_repo(self.tmp, "# x\n" + "a" * (cap + 1))
        self.assertTrue(
            any("超过上限" in p for p in subject.report_sizes(self.tmp, LED))
        )

    def test_file_within_cap_passes(self):
        make_repo(self.tmp, "# ok\n", src="# s\n", tauri="# t\n")
        self.assertEqual(subject.report_sizes(self.tmp, LED), [])

    def test_root_plus_nested_over_pair_cap_is_reported(self):
        """单文件各自合规 ≠ root + 嵌套合规（Codex 按 cwd 祖先路径拼接加载）。"""
        make_repo(
            self.tmp,
            self.at_cap("# root\n", "AGENTS.md"),
            tauri=self.at_cap("# tauri\n", "src-tauri/AGENTS.md"),
        )
        pair = (self.tmp / "AGENTS.md").stat().st_size + (self.tmp / "src-tauri/AGENTS.md").stat().st_size
        self.assertGreater(pair, LED.pair_cap)
        problems = subject.report_sizes(self.tmp, LED)
        self.assertTrue(any("AGENTS.md + src-tauri/AGENTS.md" in p for p in problems), problems)

    def test_three_file_sum_is_not_a_constraint(self):
        """三文件求和不设限：两个嵌套同时压满、root 很小 → 通过（修正前的假阳性）。"""
        make_repo(
            self.tmp,
            "# root\n",
            src=self.at_cap("# src\n", "src/AGENTS.md"),
            tauri=self.at_cap("# tauri\n", "src-tauri/AGENTS.md"),
        )
        total = sum((self.tmp / rel).stat().st_size for rel in LED.scanned)
        self.assertGreater(total, LED.pair_cap)
        self.assertEqual(subject.report_sizes(self.tmp, LED), [])

    def test_pair_cap_is_reachable_within_single_file_caps(self):
        """常量自洽：单文件上限必须允许构造出超 PAIR_CAP 的组合，否则该项检查形同虚设。"""
        for nested in LED.nested:
            worst = LED.size_caps["AGENTS.md"] + LED.size_caps[nested]
            self.assertGreater(worst, LED.pair_cap, f"root + {nested} 永不可能超限")

    def test_missing_nested_file_is_reported(self):
        make_repo(self.tmp, "# root\n")
        (self.tmp / "src/AGENTS.md").unlink()
        problems = subject.report_sizes(self.tmp, LED)
        self.assertTrue(any("缺少文件 src/AGENTS.md" in p for p in problems), problems)


class RoutingReportTest(FixtureTest):
    def test_consistent_routing_passes(self):
        backend = [n for n in sorted(SIGNATURES) if n not in ROOT_NUMS + SRC_NUMS]
        make_repo(
            self.tmp,
            full_index() + bodies(ROOT_NUMS),
            src=bodies(SRC_NUMS),
            tauri=bodies(backend),
        )
        self.assertEqual(subject.report_routing(self.tmp, LED), [])

    def test_missing_index_row_is_reported(self):
        problems = self.route("# 根\n## AI 代码审查红线 (Review Gates)\n\n空表\n")
        self.assertTrue(any("缺少编号" in p for p in problems), problems)

    def test_missing_body_is_reported(self):
        problems = self.route(root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")))
        self.assertTrue(any("全文缺失" in p for p in problems), problems)

    def test_drift_between_declared_and_actual_home_is_reported(self):
        problems = self.route(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            src=f"## 审查红线\n\n**1. {SIGNATURES[1]}** —— 正文写错了文件。\n",
        )
        self.assertTrue(any("落点漂移" in p for p in problems), problems)

    def test_duplicate_body_across_files_is_reported(self):
        body = f"## 审查红线\n\n**1. {SIGNATURES[1]}** —— 同一正文。\n"
        problems = self.route(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            src=body,
            tauri=body,
        )
        self.assertTrue(any("多个文件" in p for p in problems), problems)

    def test_stray_body_form_is_reported(self):
        problems = self.route(
            root_with_index(index_row(1, "统一命令执行接口", "`src-tauri/AGENTS.md`")),
            tauri=f"plain text mention of {SIGNATURES[1]} not under a heading\n",
        )
        self.assertTrue(any("形态异常" in p for p in problems), problems)

    def test_index_row_is_not_counted_as_body(self):
        problems = self.route(
            root_with_index(index_row(1, "统一命令执行接口", "摘要", "`src-tauri/AGENTS.md`")),
            tauri=f"## 审查红线\n\n**1. {SIGNATURES[1]}** —— 正文。\n",
        )
        self.assertEqual([p for p in problems if "多个文件" in p], [])


class LedgerReportTest(FixtureTest):
    def test_complete_ledger_passes(self):
        self.assertEqual(self.ledger_problems(ledger_rows_all()), [])

    def test_missing_header_is_reported(self):
        make_repo(self.tmp, "# 根\n## AI 代码审查红线 (Review Gates)\n\n无表\n")
        self.assertTrue(
            any("缺少表头行" in p for p in subject.report_ledger(self.tmp, LED))
        )

    def test_missing_summary_column_is_reported(self):
        rows = [index_row(n, SIGNATURES[n], home_of(n)) for n in sorted(SIGNATURES)]
        problems = self.ledger_problems(rows, header=LEGACY_HEADER)
        self.assertTrue(any(LED.summary_column in p for p in problems), problems)

    def test_title_missing_signature_is_reported(self):
        """台账标题改写成同义词 = 同一条规则两个名字 → 必须报错。"""
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "摘要", title="命令执行接口统一")
        self.assertTrue(any("不含签名" in p for p in self.ledger_problems(rows)), rows)

    def test_longer_title_containing_signature_is_accepted(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "摘要", title=f"{SIGNATURES[1]}（Local/WSL/SSH）")
        self.assertEqual(self.ledger_problems(rows), [])

    def test_empty_summary_is_reported(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "")
        self.assertTrue(any("摘要列为空" in p for p in self.ledger_problems(rows)))

    def test_oversized_summary_is_reported(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "a" * (LED.summary_max_bytes + 1))
        self.assertTrue(any("超过上限" in p for p in self.ledger_problems(rows)))

    def test_unescaped_pipe_changes_cell_count_and_is_reported(self):
        rows = ledger_rows_all()
        rows[0] = ledger_row(1, "摘要混了 | 两条 | 竖线")
        self.assertTrue(any("列数" in p for p in self.ledger_problems(rows)))

    def test_missing_row_is_routing_business_not_ledger(self):
        """缺行是路由问题（落点缺失），摘要列不为它背锅 —— 两项检查职责分离。"""
        make_repo(self.tmp, root_with_index(*(ledger_rows_all()[:-1])))
        self.assertEqual(subject.report_ledger(self.tmp, LED), [])
        self.assertTrue(any("缺少编号" in p for p in subject.report_routing(self.tmp, LED)))


class CheckContractTest(FixtureTest):
    def test_missing_agents_md_is_an_infra_failure(self):
        result = subject.check(context(self.tmp))
        self.assertTrue(result.error, result)

    def test_planted_violation_is_reported_through_the_contract(self):
        backend = [n for n in sorted(SIGNATURES) if n not in ROOT_NUMS + SRC_NUMS]
        make_repo(
            self.tmp,
            root_with_index(*ledger_rows_all()) + bodies(ROOT_NUMS),
            src=bodies(SRC_NUMS),
            tauri=bodies(backend),
        )
        rows = subject.ledger_rows(self.tmp, LED)[1]
        self.assertEqual(subject.check(context(self.tmp)).verdict, PASS, rows)

        make_repo(self.tmp, root_with_index(*ledger_rows_all()) + bodies(ROOT_NUMS), src=bodies(SRC_NUMS))
        self.assertEqual(subject.check(context(self.tmp)).verdict, VIOLATION)


class RealRepoTest(unittest.TestCase):
    """真实仓库必须过检 —— 台账一改，这里就是第一道回执。"""

    def test_repository_passes_guard(self):
        repo = find_repo_root()
        self.assertEqual(subject.report_sizes(repo, LED), [])
        self.assertEqual(subject.report_ledger(repo, LED), [])
        self.assertEqual(subject.report_routing(repo, LED), [])
        self.assertEqual(subject.check(context(repo)).verdict, PASS)


if __name__ == "__main__":
    unittest.main()
