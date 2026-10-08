"""调度层 —— 重点是三条「护栏不许假装自己检查过」的路径。"""
from __future__ import annotations

import io
import os
import pathlib
import shutil
import sys
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
    SKIP,
    VIOLATION,
    Context,
    Finding,
    Gate,
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


def gate_reg(
    gate_id,
    argv,
    *,
    kind="test",
    stages=("local",),
    platforms=("linux", "macos", "windows"),
    budget_ms=120_000,
    scopes=("src/**",),
) -> Registration:
    return Registration(
        guard=Gate(
            id=gate_id,
            title="命令门禁",
            scopes=scopes,
            stages=stages,
            kind=kind,
            argv=tuple(argv),
            platforms=platforms,
            budget_ms=budget_ms,
            fix_hint="修掉它",
        ),
        check=None,
        module_name=f"gate_{gate_id}",
        source=pathlib.Path("ledger/gates.json"),
    )


def py(script: str, *extra: str) -> tuple:
    """夹具外部命令一律由 `sys.executable` 派生（红线 13，不得硬编码绝对路径 / bash）。"""
    return (sys.executable, "-c", script, *extra)


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

    def test_skipped_result_is_exempt_from_the_vacuous_scan_check(self):
        """「跳过」不是「扫了 0 个还报绿」——退出码 0 的合法不跑不该被反空转转成 ERROR。"""
        result = self.outcome(lambda ctx: GuardResult.skipped("平台不适用")).result
        self.assertEqual(result.verdict, SKIP)

    def test_a_violation_with_an_empty_scan_is_still_a_guard_error(self):
        result = self.outcome(lambda ctx: GuardResult.violated(0, [Finding("x")])).result
        self.assertEqual(result.verdict, ERROR)

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

    def test_platform_mismatched_gate_is_skipped_and_counted(self):
        regs = [
            gate_reg("host_gate", py("print('should not run')"), platforms=("linux", "macos"))
        ]
        with mock.patch.object(runner, "platform_tag", lambda: "windows"):
            code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_OK)
        self.assertIn("1 条跳过", out)
        self.assertIn("SKIP", out)

    def test_jobs_run_command_gates_concurrently_in_declaration_order(self):
        slow = py("import time; time.sleep(1)")
        regs = [gate_reg(f"g{i}", slow) for i in range(3)]
        started = time.perf_counter()
        code, out, _ = self.run_with(regs, jobs=3)
        elapsed = time.perf_counter() - started
        self.assertEqual(code, EXIT_OK)
        self.assertLess(elapsed, 2.0, "三条各 sleep 1s 的 gate 在 jobs=3 下应并发")
        positions = [out.index(f"g{i}") for i in range(3)]
        self.assertEqual(positions, sorted(positions))

    def test_fail_fast_does_not_start_later_gates(self):
        marker_dir = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, marker_dir, True)
        marker = marker_dir / "second-ran"
        first = gate_reg("first", py("import sys; print('boom'); sys.exit(1)"))
        second = gate_reg(
            "second",
            py("import pathlib, sys; pathlib.Path(sys.argv[1]).write_text('x')", str(marker)),
        )
        code, _, _ = self.run_with([first, second], jobs=1)
        self.assertEqual(code, EXIT_VIOLATION)
        self.assertFalse(marker.exists(), "fail-fast 之后不得再启动新的 gate")

    def test_command_gate_violation_exits_one_with_the_output(self):
        regs = [
            gate_reg("bad_gate", py("import sys; print('the failure detail'); sys.exit(3)"))
        ]
        code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_VIOLATION)
        self.assertIn("the failure detail", out)

    def test_command_gate_over_budget_exits_two(self):
        regs = [gate_reg("slow_gate", py("import time; time.sleep(5)"), budget_ms=100)]
        code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("超时", out)

    def test_missing_command_exits_two(self):
        regs = [gate_reg("ghost_gate", ("no-such-command-xyz",))]
        code, out, _ = self.run_with(regs)
        self.assertEqual(code, EXIT_GUARD_ERROR)
        self.assertIn("无法", out)

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


class SelectFilterTest(unittest.TestCase):
    """`--suite`（kind）与 `--source`（形态）是两个正交过滤器，不引入重载语义的套件名。"""

    def setUp(self):
        self.regs = [
            reg(
                lambda ctx: GuardResult.passed(1),
                Guard(id="check_a", title="t", scopes=("src/**",), stages=("local",)),
            ),
            gate_reg("gate_lint", py("pass"), kind="lint"),
            gate_reg("gate_test", py("pass"), kind="test"),
        ]

    def ids(self, **kwargs):
        return [r.id for r in select(self.regs, "local", [], [], **kwargs)]

    def test_suite_filters_by_kind(self):
        self.assertEqual(self.ids(suite="lint"), ["check_a", "gate_lint"])
        self.assertEqual(self.ids(suite="test"), ["gate_test"])

    def test_source_filters_by_form(self):
        self.assertEqual(self.ids(source="python"), ["check_a"])
        self.assertEqual(self.ids(source="command"), ["gate_lint", "gate_test"])

    def test_filters_are_orthogonal(self):
        self.assertEqual(self.ids(suite="lint", source="command"), ["gate_lint"])
        self.assertEqual(self.ids(suite="test", source="python"), [])


class GateExecutionTest(unittest.TestCase):
    """命令门禁唯一的新执行路径：argv → 退出码 → 三态；超时/命令缺失是护栏失效。"""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.ctx = Context(repo_root=self.tmp)

    def run_gate(self, argv, **kwargs):
        return runner._run_gate(gate_reg("g", argv, **kwargs), self.ctx)

    def test_exit_zero_is_a_pass(self):
        outcome = self.run_gate(py("print('all good')"))
        self.assertEqual(outcome.result.verdict, PASS)
        self.assertIn("all good", outcome.result.metrics)

    def test_nonzero_exit_is_a_violation_and_carries_the_output(self):
        outcome = self.run_gate(py("import sys; print('bad thing'); sys.exit(3)"))
        self.assertEqual(outcome.result.verdict, VIOLATION)
        self.assertTrue(any("bad thing" in f.message for f in outcome.result.findings))

    def test_nonzero_exit_without_output_is_still_a_violation(self):
        """退出码非 0 但零输出：verdict 由 findings 决定，空 findings 会落回 PASS。

        这是「静默失败伪装成通过」——本框架存在的理由，故必须显式坐实为 VIOLATION。
        """
        outcome = self.run_gate(py("import sys; sys.exit(9)"))
        self.assertEqual(outcome.result.verdict, VIOLATION)
        self.assertTrue(outcome.result.findings)
        self.assertIn("9", outcome.result.findings[0].message)

    def test_output_is_bounded(self):
        script = "import sys; print('\\n'.join(str(i) for i in range(100))); sys.exit(1)"
        outcome = self.run_gate(py(script))
        self.assertLessEqual(len(outcome.result.findings), 41)
        self.assertTrue(any("截断" in f.message for f in outcome.result.findings))

    def test_a_line_longer_than_the_cap_is_truncated(self):
        outcome = self.run_gate(py("import sys; print('x'*600); sys.exit(1)"))
        self.assertTrue(all(len(f.message) <= 500 for f in outcome.result.findings))
        self.assertTrue(any("截断" in f.message for f in outcome.result.findings))

    def test_over_budget_is_a_guard_error(self):
        outcome = self.run_gate(py("import time; time.sleep(5)"), budget_ms=100)
        self.assertEqual(outcome.result.verdict, ERROR)
        self.assertIn("超时", outcome.result.error)

    def test_missing_command_is_a_guard_error_not_a_violation(self):
        outcome = self.run_gate(("definitely-not-a-real-command-xyz",))
        self.assertEqual(outcome.result.verdict, ERROR)
        self.assertIn("无法", outcome.result.error)

    def test_platform_mismatch_is_skipped_not_passed(self):
        with mock.patch.object(runner, "platform_tag", lambda: "windows"):
            outcome = self.run_gate(py("print('nope')"), platforms=("linux", "macos"))
        self.assertEqual(outcome.result.verdict, SKIP)
        self.assertIn("windows", outcome.result.skip_reason)

    def test_metrics_is_the_last_non_empty_line(self):
        outcome = self.run_gate(py("print('first'); print('skip: no jdk'); print()"))
        self.assertEqual(outcome.result.metrics, "skip: no jdk")

    def test_metrics_is_bounded(self):
        outcome = self.run_gate(py("print('y'*300)"))
        self.assertLessEqual(len(outcome.result.metrics), 120)

    @unittest.skipUnless(os.name == "posix", "进程组语义仅 POSIX 可测")
    def test_timeout_kills_the_whole_process_group(self):
        marker = self.tmp / "grandchild-ran"
        script = (
            "import subprocess, sys, time\n"
            "subprocess.Popen([sys.executable, '-c',"
            " 'import pathlib,sys,time; time.sleep(0.4);"
            " pathlib.Path(sys.argv[1]).write_text(\"x\")', sys.argv[1]])\n"
            "time.sleep(10)\n"
        )
        outcome = runner._run_gate(
            gate_reg("g", py(script, str(marker)), budget_ms=150), self.ctx
        )
        self.assertEqual(outcome.result.verdict, ERROR)
        time.sleep(0.6)
        self.assertFalse(marker.exists(), "超时后孙进程仍在运行 —— 进程组未被清理")


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
