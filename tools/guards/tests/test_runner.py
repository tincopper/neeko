"""调度层 —— 重点是三条「护栏不许假装自己检查过」的路径。"""
from __future__ import annotations

import io
import pathlib
import shutil
import tempfile
import time
import unittest
from unittest import mock

from guards.core import repo, runner
from guards.core.contract import (
    ERROR,
    EXIT_GUARD_ERROR,
    EXIT_OK,
    EXIT_VIOLATION,
    PASS,
    VIOLATION,
    Context,
    Finding,
    Guard,
    GuardResult,
)
from guards.core.registry import Registration
from guards.core.runner import select


def reg(check, guard=None, stage=("local",), scopes=("src/**",)) -> Registration:
    return Registration(
        guard=guard or Guard(id="sample_guard", title="t", scopes=scopes, stages=stage),
        check=check,
        module_name="sample_guard",
        source=pathlib.Path("sample_guard.py"),
    )


class SelectTest(unittest.TestCase):
    def setUp(self):
        self.regs = [
            reg(lambda ctx: GuardResult.passed(1), stage=("ci",), scopes=("src/**",)),
            reg(
                lambda ctx: GuardResult.passed(1),
                guard=Guard(
                    id="docs_guard", title="t", scopes=("docs/**",), stages=("local", "ci")
                ),
            ),
        ]

    def ids(self, stage, changed=None, only=()):
        return [r.guard.id for r in select(self.regs, stage, changed, only)]

    def test_stage_narrows_the_set(self):
        self.assertEqual(self.ids("ci"), ["sample_guard", "docs_guard"])
        self.assertEqual(self.ids("local"), ["docs_guard"])

    def test_changed_set_skips_unrelated_guards(self):
        self.assertEqual(self.ids("ci", ["src/a.ts"]), ["sample_guard"])
        self.assertEqual(self.ids("ci", ["docs/a.md"]), ["docs_guard"])
        self.assertEqual(self.ids("ci", ["README.md"]), [])

    def test_only_bypasses_stage_but_not_existence(self):
        self.assertEqual(self.ids("local", only=["sample_guard"]), ["sample_guard"])
        with self.assertRaises(Exception):
            self.ids("local", only=["nope"])


class RunOneTest(unittest.TestCase):
    def outcome(self, check):
        return runner._run_one(reg(check), Context(repo_root=pathlib.Path("/")))

    def test_vacuous_scan_becomes_an_error_not_a_pass(self):
        """scanned=0 是判据口径失效的信号 —— 本仓库真实踩过两次，框架必须无条件拦下。"""
        result = self.outcome(lambda ctx: GuardResult.passed(0)).result
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("扫描集为空", result.error)

    def test_exception_becomes_an_error(self):
        def boom(ctx):
            raise RuntimeError("口径解析炸了")

        result = self.outcome(boom).result
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("口径解析炸了", result.error)

    def test_wrong_return_type_becomes_an_error(self):
        result = self.outcome(lambda ctx: ["not", "a", "result"]).result
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("GuardResult", result.error)

    def test_explicit_infra_error_keeps_its_own_message(self):
        result = self.outcome(lambda ctx: GuardResult.broken("lockfile 不存在")).result
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("lockfile 不存在", result.error)

    def test_real_findings_stay_a_violation(self):
        check = lambda ctx: GuardResult.violated(4, [Finding("裸 font-family")])
        outcome = self.outcome(check)
        self.assertEqual(outcome.result.verdict, VIOLATION)
        self.assertEqual(outcome.result.scanned, 4)


class ExecuteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self._patch("find_repo_root", lambda *a, **k: self.tmp)
        self._patch_in(runner.selftest, "run_suite", lambda stream: (True, "ok"))

    def _patch(self, name, value):
        patcher = mock.patch.object(runner.repo, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _patch_in(self, module, name, value):
        patcher = mock.patch.object(module, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_with(self, registrations, **kwargs):
        patcher = mock.patch.object(runner, "discover", lambda root=None: registrations)
        patcher.start()
        self.addCleanup(patcher.stop)
        out, err = io.StringIO(), io.StringIO()
        code = runner.execute(out=out, err=err, run_selftest=False, **kwargs)
        return code, out.getvalue(), err.getvalue()

    def test_missing_repo_root_blocks_before_any_guard_runs(self):
        """根定位失败时必须报「框架失效」（2），而不是拿一个猜出来的目录当仓库根。"""
        self._patch("find_repo_root", lambda *a, **k: (_ for _ in ()).throw(repo.RepoRootNotFound("找不到根")))
        out, err = io.StringIO(), io.StringIO()
        code = runner.execute(out=out, err=err, run_selftest=False)
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("找不到根", err.getvalue())

    def test_violation_exits_one(self):
        regs = [reg(lambda ctx: GuardResult.violated(2, [Finding("x")]))]
        code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_VIOLATION)
        self.assertIn("x", out)

    def test_broken_guard_exits_two(self):
        regs = [reg(lambda ctx: GuardResult.broken("台账文件缺失"))]
        code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("护栏自身失效", out)

    def test_empty_stage_is_not_green(self):
        regs = [reg(lambda ctx: GuardResult.passed(1), stage=("ci",))]
        code, _, err = self.run_with(regs, stage="local")
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("没有任何护栏", err)

    def test_unknown_guard_id_is_reported(self):
        code, _, err = self.run_with([reg(lambda ctx: GuardResult.passed(1))], only=["ghost"])
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("未知护栏", err)

    def test_selftest_failure_blocks_before_any_verdict(self):
        self._patch_in(runner.selftest, "run_suite", lambda stream: (False, "2 失败"))
        out, err = io.StringIO(), io.StringIO()
        code = runner.execute(out=out, err=err, only=["sample_guard"], run_selftest=True)
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("护栏自身单测", err.getvalue())

    def test_json_format_is_machine_readable(self):
        import json

        regs = [reg(lambda ctx: GuardResult.violated(2, [Finding("x", "src/a.ts", 7)]))]
        _, out, _ = self.run_with(regs, fmt="json")
        payload = json.loads(out)
        self.assertEqual(payload["exit"], EXIT_VIOLATION)
        self.assertEqual(payload["guards"][0]["findings"][0]["line"], 7)

    def test_list_mode_prints_the_guard_ledger(self):
        """`guards list <id>` 的台账明细走这条路 —— AI 改台账前先看它。"""
        regs = [
            reg(
                lambda ctx: GuardResult.passed(
                    2, metrics="m", notes=("台账第 1 行", "台账第 2 行")
                )
            )
        ]
        _, out, _ = self.run_with(regs, list_mode=True)
        self.assertIn("台账第 1 行", out)
        self.assertIn("台账第 2 行", out)

    def test_github_format_emits_annotations_on_the_cited_line(self):
        regs = [reg(lambda ctx: GuardResult.violated(2, [Finding("x", "src/a.ts", 7)]))]
        _, out, _ = self.run_with(regs, fmt="github-actions")
        self.assertIn("::error file=src/a.ts,line=7::", out)

    def test_unrelated_change_skips_without_a_green_verdict(self):
        """增量过滤后为空是正常情形（提交与任何护栏的 scope 无关），不该报错也不该假装全绿。"""
        regs = [reg(lambda ctx: GuardResult.passed(1), stage=("commit",))]
        code, out, _ = self.run_with(regs, stage="commit", changed=["README.md"])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("未触及任何护栏", out)

    def test_a_change_to_the_framework_itself_re_runs_everything(self):
        """护栏自己的代码变了 → 每条护栏的判据都受影响，增量跳过不成立。"""
        regs = [
            reg(lambda ctx: GuardResult.passed(1), stage=("commit",)),
            reg(
                lambda ctx: GuardResult.passed(1),
                guard=Guard(id="other", title="t", scopes=("docs/**",), stages=("commit",)),
            ),
        ]
        _, out, _ = self.run_with(regs, stage="commit", changed=["tools/guards/core/runner.py"])
        self.assertIn("2 条护栏", out)

    def test_empty_stage_still_fails_when_no_filter_was_requested(self):
        regs = [reg(lambda ctx: GuardResult.passed(1), stage=("ci",))]
        code, _, err = self.run_with(regs, stage="local")
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("没有任何护栏", err)

    def test_a_slow_guard_blocks_the_gate_with_exit_two(self):
        """端到端：超时不是「违规」，而是「门禁不可用」。"""
        slow = Guard(id="slow_guard", title="t", scopes=("src/**",), budget_ms=5)
        regs = [reg(BudgetTest().slow_check(40), guard=slow)]
        code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("超过预算", out)


class BudgetTest(unittest.TestCase):
    """慢到没人愿意跑的门禁 = 消失的门禁，所以超时判「护栏自身不可信」而非违规。"""

    CONTEXT = Context(repo_root=pathlib.Path("/"))

    def slow_check(self, ms, result=None):
        def check(ctx):
            time.sleep(ms / 1000)
            return result or GuardResult.passed(7)

        return check

    def run_with_budget(self, budget_ms, check):
        guard = Guard(id="slow_guard", title="t", scopes=("src/**",), budget_ms=budget_ms)
        return runner._run_one(reg(check, guard=guard), self.CONTEXT)

    def test_over_budget_becomes_a_guard_error(self):
        outcome = self.run_with_budget(5, self.slow_check(40))
        self.assertEqual(outcome.result.verdict, ERROR)
        self.assertIn("超过预算", outcome.result.error)
        self.assertIn("不是被检查代码的错", outcome.result.error)

    def test_within_budget_keeps_the_verdict_and_records_timing(self):
        outcome = self.run_with_budget(5_000, self.slow_check(1))
        self.assertEqual(outcome.result.verdict, PASS)
        self.assertEqual(outcome.result.scanned, 7, "计时不得吞掉判据结果")
        self.assertGreaterEqual(outcome.duration_ms, 0)

    def test_a_real_guard_error_is_not_masked_by_the_budget_message(self):
        outcome = self.run_with_budget(
            5, self.slow_check(40, GuardResult.broken("台账缺失", scanned=3))
        )
        self.assertIn("台账缺失", outcome.result.error)
        self.assertEqual(outcome.result.scanned, 3)


if __name__ == "__main__":
    unittest.main()
