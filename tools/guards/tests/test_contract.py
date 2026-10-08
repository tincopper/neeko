"""contract 层：退出码语义由 verdict 推导，且「护栏坏了」必须与「代码违规」可区分。"""
from __future__ import annotations

import unittest

from guards.core.contract import (
    DEFAULT_BUDGET_MS,
    DEFAULT_GATE_STAGES,
    DEFAULT_STAGES,
    ERROR,
    EXIT_GUARD_ERROR,
    EXIT_OK,
    EXIT_VIOLATION,
    KINDS,
    PLATFORMS,
    SKIP,
    STAGES,
    VIOLATION,
    Context,
    Finding,
    Gate,
    Guard,
    GuardResult,
)
from guards.core import contract, report
from guards.core.runner import Outcome


class VerdictTest(unittest.TestCase):
    def test_findings_make_violation(self):
        r = GuardResult.violated(3, [Finding("x")])
        self.assertEqual(r.verdict, VIOLATION)

    def test_violated_requires_at_least_one_finding(self):
        """空 findings 的「违规」会落回 PASS —— 让这个非法状态写不出来。"""
        with self.assertRaises(ValueError):
            GuardResult.violated(3, [])

    def test_error_outweighs_findings(self):
        """护栏自己坏了时不能因为「也报了违规」就伪装成一次正常检查。"""
        r = GuardResult(scanned=3, findings=(Finding("x"),), error="口径失效")
        self.assertEqual(r.verdict, ERROR)

    def test_exit_code_distinguishes_violation_from_broken_guard(self):
        outcomes = [Outcome(guard=Guard("a", "t", ("src",)), result=GuardResult.broken("坏"))]
        self.assertEqual(report.exit_code(outcomes), EXIT_GUARD_ERROR)
        outcomes = [Outcome(guard=Guard("a", "t", ("src",)), result=GuardResult.violated(1, [Finding("x")]))]
        self.assertEqual(report.exit_code(outcomes), EXIT_VIOLATION)
        outcomes = [Outcome(guard=Guard("a", "t", ("src",)), result=GuardResult.passed(1))]
        self.assertEqual(report.exit_code(outcomes), EXIT_OK)


class GuardDeclarationTest(unittest.TestCase):
    def test_empty_fields_are_rejected(self):
        cases = [
            dict(id="", title="t", scopes=("src",)),
            dict(id="x", title="", scopes=("src",)),
            dict(id="x", title="t", scopes=()),
            dict(id="x", title="t", scopes=("src",), stages=()),
        ]
        for kwargs in cases:
            with self.assertRaises(ValueError):
                Guard(**kwargs)

    def test_unknown_stage_is_rejected(self):
        with self.assertRaises(ValueError):
            Guard(id="x", title="t", scopes=("src",), stages=("nightly",))

    def test_non_positive_budget_is_rejected(self):
        """预算必须为正 —— 0 或负数会让每条护栏都「超时」，等于整体关掉门禁还报红。"""
        for budget in (0, -1):
            with self.subTest(budget=budget):
                with self.assertRaises(ValueError):
                    Guard(id="x", title="t", scopes=("src",), budget_ms=budget)

    def test_default_budget_is_generous_but_finite(self):
        guard = Guard(id="x", title="t", scopes=("src",))
        self.assertEqual(guard.budget_ms, DEFAULT_BUDGET_MS)
        self.assertGreaterEqual(DEFAULT_BUDGET_MS, 1000)


class VocabularyTest(unittest.TestCase):
    """词汇表与默认值必须分开 —— 合成一个常量正是「加一个 stage 就全跑一遍」的成因。"""

    def test_stages_vocabulary_covers_every_real_occasion(self):
        self.assertEqual(STAGES, ("local", "commit", "push", "ci", "manual"))

    def test_default_stages_are_pinned_to_the_historical_value(self):
        # 顺序也与改造前逐字一致：`pnpm guards list` 直接打印 `','.join(stages)`，
        # AC3 要求改造前后该输出可以 diff。design.md 的字面顺序是笔误，以基线为准。
        self.assertEqual(DEFAULT_STAGES, ("local", "ci", "commit"))

    def test_all_stages_is_gone(self):
        """`ALL_STAGES` 把词汇表与默认值混成一个常量，必须删除而不是保留别名。"""
        self.assertFalse(hasattr(contract, "ALL_STAGES"))

    def test_kinds_and_platforms_are_enumerated(self):
        self.assertEqual(KINDS, ("lint", "test"))
        self.assertEqual(PLATFORMS, ("linux", "macos", "windows"))


class GuardKindTest(unittest.TestCase):
    def test_kind_defaults_to_lint_so_existing_guards_need_no_edit(self):
        self.assertEqual(Guard(id="x", title="t", scopes=("src",)).kind, "lint")

    def test_unknown_kind_is_rejected(self):
        with self.assertRaises(ValueError):
            Guard(id="x", title="t", scopes=("src",), kind="nope")


class GateTest(unittest.TestCase):
    """命令门禁 = Guard + argv/platforms/ci_job；四类声明错误都必须在构造期炸。"""

    def gate(self, **kwargs):
        base = dict(id="lint_fe", title="t", scopes=("src/**",), argv=("pnpm", "lint:fe"))
        base.update(kwargs)
        return Gate(**base)

    def test_a_minimal_gate_is_valid_and_looks_like_a_guard(self):
        gate = self.gate()
        self.assertIsInstance(gate, Guard)
        self.assertEqual(gate.argv, ("pnpm", "lint:fe"))
        self.assertEqual(gate.platforms, PLATFORMS)
        self.assertEqual(gate.stages, DEFAULT_GATE_STAGES)
        self.assertNotIn("ci", DEFAULT_GATE_STAGES, "命令门禁默认不跑 CI —— CI 必须点名 job")

    def test_argv_must_be_non_empty_all_strings_and_start_with_a_real_command(self):
        for argv in ((), ("",), ("pnpm", 1), (None,)):
            with self.subTest(argv=argv):
                with self.assertRaises(ValueError):
                    self.gate(argv=argv)

    def test_platforms_must_be_a_non_empty_subset_of_the_vocabulary(self):
        for platforms in ((), ("plan9",), ("linux", "plan9")):
            with self.subTest(platforms=platforms):
                with self.assertRaises(ValueError):
                    self.gate(platforms=platforms)

    def test_ci_context_requires_a_ci_job_and_vice_versa(self):
        with self.assertRaises(ValueError):
            self.gate(stages=("ci",), ci_job="")
        with self.assertRaises(ValueError):
            self.gate(stages=("local",), ci_job="frontend-check")

    def test_ci_context_with_a_job_is_accepted(self):
        gate = self.gate(stages=("local", "ci"), ci_job="frontend-check")
        self.assertEqual(gate.ci_job, "frontend-check")


class SkippedVerdictTest(unittest.TestCase):
    """SKIPPED = 合法不跑（平台不适用），必须与「通过」和「违规」都区分开。"""

    def test_skipped_result_has_the_skip_verdict(self):
        self.assertEqual(GuardResult.skipped("平台不适用").verdict, SKIP)

    def test_skipped_is_still_visible_in_the_result(self):
        self.assertEqual(GuardResult.skipped("缺 JDK").skip_reason, "缺 JDK")

    def test_findings_outweigh_skipped(self):
        result = GuardResult(scanned=3, findings=(Finding("x"),), skip_reason="平台不适用")
        self.assertEqual(result.verdict, VIOLATION)

    def test_error_outweighs_skipped(self):
        result = GuardResult(error="护栏炸了", skip_reason="平台不适用")
        self.assertEqual(result.verdict, ERROR)


class ContextTest(unittest.TestCase):
    def test_glob_ignores_directories(self):
        import pathlib
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "src").mkdir()
            (root / "src" / "a.ts").write_text("x")
            ctx = Context(repo_root=root)
            self.assertEqual([p.name for p in ctx.glob("src/**/*.ts")], ["a.ts"])


if __name__ == "__main__":
    unittest.main()
