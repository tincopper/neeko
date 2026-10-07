"""check_invariant_enforcement 用例。

判据核心是「不平衡即红」：每条不变量必须有可解析的强制落点，`prose` 债务必须显式且带理由，
guard → 红线引用必须真实存在。夹具不依赖真实仓库（`ctx` 注入 + 临时仓库树）。
"""
from __future__ import annotations

import unittest
from unittest import mock

from guards.checks import check_invariant_enforcement as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.core.ledger import LedgerError
from guards.tests.support import context, make_repo, temp_repo

TIERS = {t: f"tier {t}" for t in subject.REQUIRED_TIERS}
SIGNATURES = {str(n) for n in range(1, 16)}


def ledger_with(*invariants: dict) -> dict:
    return {"tiers": TIERS, "invariants": list(invariants)}


def good_guard_invariant(**overrides) -> dict:
    inv = {
        "id": "demo-invariant",
        "title": "演示不变量",
        "tier": "guard",
        "enforcement": [
            {"kind": "guard", "ref": "check_demo"},
            {"kind": "test", "ref": "tools/guards/tests/test_demo.py"},
        ],
        "red_line": 12,
    }
    inv.update(overrides)
    return inv


def repo_with_demo(test) -> object:
    root = temp_repo(test)
    make_repo(
        root,
        {
            "tools/guards/checks/check_demo.py": 'GUARD = object()\nred_lines=(12,)\n',
            "tools/guards/tests/test_demo.py": "# demo\n",
            ".eslintrc.cjs": "module.exports = { rules: { 'demo/rule': 'error' } };\n",
        },
    )
    return root


class RequiredTiersTest(unittest.TestCase):
    def test_required_tiers_are_the_six_documented_levels(self):
        self.assertEqual(
            subject.REQUIRED_TIERS,
            frozenset({"type", "structure", "guard", "lint", "test", "prose"}),
        )


class ValidateInvariantsTest(unittest.TestCase):
    def test_good_ledger_passes(self):
        root = repo_with_demo(self)
        findings = subject.validate_invariants(
            ledger_with(good_guard_invariant()), context(root), SIGNATURES
        )
        self.assertEqual(findings, [])

    def test_missing_guard_ref_is_a_violation(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(
            enforcement=[{"kind": "guard", "ref": "check_does_not_exist"}]
        )
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)
        self.assertIn("check_does_not_exist", findings[0].message)

    def test_missing_test_path_is_a_violation(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(enforcement=[{"kind": "test", "ref": "nope/missing.py"}])
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)

    def test_structure_requires_note(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(
            tier="structure",
            enforcement=[{"kind": "structure", "ref": "src/structure.py"}],
        )
        make_repo(root, {"src/structure.py": "# structural mechanism\n"})
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)
        self.assertIn("note", findings[0].message)

    def test_prose_requires_reason(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(
            tier="prose", enforcement=[{"kind": "prose"}], red_line=None
        )
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)
        self.assertIn("reason", findings[0].message)

    def test_prose_with_reason_passes(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(
            tier="prose",
            enforcement=[{"kind": "prose", "reason": "运行时判据，静态不可判"}],
            red_line=None,
        )
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(findings, [])

    def test_duplicate_id_is_a_violation(self):
        root = repo_with_demo(self)
        findings = subject.validate_invariants(
            ledger_with(good_guard_invariant(), good_guard_invariant()),
            context(root),
            SIGNATURES,
        )
        self.assertEqual(len(findings), 1)
        self.assertIn("重复", findings[0].message)

    def test_empty_enforcement_is_a_violation(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(enforcement=[])
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)

    def test_unknown_tier_is_a_violation(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(tier="expert")
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)

    def test_unknown_red_line_reference_is_a_violation(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(red_line=99)
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)
        self.assertIn("99", findings[0].message)

    def test_red_line_list_is_checked_element_wise(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(red_line=[11, 13])
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(findings, [])

    def test_lint_rule_must_exist_in_eslint_config(self):
        root = repo_with_demo(self)
        inv = good_guard_invariant(enforcement=[{"kind": "lint", "ref": "demo/other"}])
        findings = subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)
        self.assertIn("demo/other", findings[0].message)

    def test_lint_without_config_is_guard_error(self):
        root = temp_repo(self)
        make_repo(root, {})
        inv = good_guard_invariant(enforcement=[{"kind": "lint", "ref": "demo/rule"}])
        with self.assertRaises(subject.InputError):
            subject.validate_invariants(ledger_with(inv), context(root), SIGNATURES)


class GuardRedLineRefsTest(unittest.TestCase):
    def test_existing_red_line_passes(self):
        root = repo_with_demo(self)
        paths = [root / "tools/guards/checks/check_demo.py"]
        self.assertEqual(
            subject.validate_guard_red_line_refs(paths, context(root), SIGNATURES), []
        )

    def test_unknown_red_line_in_guard_is_a_violation(self):
        root = temp_repo(self)
        make_repo(root, {"tools/guards/checks/check_bad.py": "red_lines=(99,)\n"})
        paths = [root / "tools/guards/checks/check_bad.py"]
        findings = subject.validate_guard_red_line_refs(paths, context(root), SIGNATURES)
        self.assertEqual(len(findings), 1)
        self.assertIn("99", findings[0].message)


class CheckVerdictTest(unittest.TestCase):
    def test_real_repository_ledger_is_evaluable(self):
        # 不硬性要求 PASS：台账写错时应报 VIOLATION（数据/代码违规），而不是把护栏自身打成
        # ERROR（否则 `pnpm guards run` 显示「护栏自身单测未通过」，把数据问题伪装成工具问题）。
        from guards.core.repo import find_repo_root

        result = subject.check(context(find_repo_root()))
        self.assertNotEqual(result.verdict, ERROR)
        self.assertGreater(result.scanned, 0)

    def test_ledger_load_failure_is_reported_as_guard_error(self):
        def boom(name, required_keys=()):
            raise LedgerError(f"台账 {name} 坏了")

        with mock.patch.object(subject, "load_ledger", side_effect=boom):
            result = subject.check(context(  # any root; fails before scanning
                __import__("pathlib").Path(".")
            ))
        self.assertEqual(result.verdict, ERROR)
        self.assertNotEqual(result.error, "")

    def test_invalid_ledger_is_reported_as_guard_error(self):
        def fake(name, required_keys=()):
            if name == "invariants":
                return ledger_with(good_guard_invariant(enforcement=[{"kind": "lint", "ref": "x"}]))
            return {"signatures": {str(n): "sig" for n in range(1, 16)}}

        root = temp_repo(self)
        make_repo(root, {})  # 无 .eslintrc.cjs → lint 落点无法解析 → InputError
        with mock.patch.object(subject, "load_ledger", side_effect=fake):
            result = subject.check(context(root))
        self.assertEqual(result.verdict, ERROR)


if __name__ == "__main__":
    unittest.main()
