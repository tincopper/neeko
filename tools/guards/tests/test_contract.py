"""contract 层：退出码语义由 verdict 推导，且「护栏坏了」必须与「代码违规」可区分。"""
from __future__ import annotations

import unittest

from guards.core.contract import (
    DEFAULT_BUDGET_MS,
    ERROR,
    EXIT_GUARD_ERROR,
    EXIT_OK,
    EXIT_VIOLATION,
    VIOLATION,
    Context,
    Finding,
    Guard,
    GuardResult,
)
from guards.core import report
from guards.core.runner import Outcome


class VerdictTest(unittest.TestCase):
    def test_findings_make_violation(self):
        r = GuardResult.violated(3, [Finding("x")])
        self.assertEqual(r.verdict, VIOLATION)

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
