"""注册表 —— 目录即清单，所以「清单不完整」必须无法通过校验。

这些用例守的是框架的核心承诺：新增护栏只需放一个模块，而**任何**不完整的模块
（缺 GUARD / id 与文件名不符 / check 未注解 / 没有配套单测 / 导入炸）都不允许悄悄
留在门禁里假装存在。
"""
from __future__ import annotations

import pathlib
import shutil
import tempfile
import types
import unittest
from unittest import mock

from guards.core import registry
from guards.core.contract import Guard, GuardResult
from guards.core.registry import RegistryError


def valid_check(ctx) -> GuardResult:
    return GuardResult.passed(1)


def module_with(guard=None, check=valid_check) -> types.ModuleType:
    mod = types.ModuleType("fake_check")
    if guard is not None:
        mod.GUARD = guard
    if check is not None:
        mod.check = check
    return mod


class DiscoverTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.checks = self.tmp / "checks"
        self.checks.mkdir()
        self.tests = self.tmp / "tests"
        self.tests.mkdir()
        self._patch(registry, "CHECKS_DIR", self.checks)
        self._patch(registry, "TESTS_DIR", self.tests)
        self.importer = self._patch(registry, "importlib", mock.Mock())

    def _patch(self, target_obj, name, value):
        patcher = mock.patch.object(target_obj, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def add_check(self, stem, with_test=True, module=None):
        (self.checks / f"{stem}.py").write_text("", encoding="utf-8")
        if with_test:
            (self.tests / f"test_{stem}.py").write_text("", encoding="utf-8")
        self.importer.import_module.return_value = module or module_with(
            Guard(id=stem, title="t", scopes=("src/**",))
        )

    def test_empty_checks_dir_fails_instead_of_passing(self):
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        self.assertIn("没有任何护栏模块", str(ctx.exception.args[0]))

    def test_missing_checks_dir_is_the_same_failure(self):
        """目录整个没了（误删 / 装错路径）与目录为空必须走同一条拒绝路径。"""
        with mock.patch.object(registry, "CHECKS_DIR", self.checks / "nope"):
            with self.assertRaises(RegistryError) as ctx:
                registry.discover()
        self.assertIn("没有任何护栏模块", str(ctx.exception.args[0]))

    def test_registered_module_is_returned(self):
        self.add_check("sample_guard")
        self.assertEqual([r.id for r in registry.discover()], ["sample_guard"])

    def test_missing_companion_test_is_rejected(self):
        self.add_check("sample_guard", with_test=False)
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        self.assertIn("缺少配套单测", str(ctx.exception.args[0]))

    def test_id_must_equal_module_name(self):
        self.add_check("sample_guard", module=module_with(Guard(id="other", title="t", scopes=("s",))))
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        self.assertIn("与文件名", str(ctx.exception.args[0]))

    def test_missing_guard_is_rejected(self):
        self.add_check("sample_guard", module=types.ModuleType("x"))
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        self.assertIn("缺少 `GUARD`", str(ctx.exception.args[0]))

    def test_check_return_annotation_is_required(self):
        self.add_check(
            "sample_guard",
            module=module_with(Guard(id="sample_guard", title="t", scopes=("s",)), check=lambda ctx: None),
        )
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        self.assertIn("返回值注解", str(ctx.exception.args[0]))

    def test_broken_module_does_not_hide_the_next_one(self):
        """导入炸掉时要连其余问题一起报出来，否则改一个跑一次。"""
        (self.checks / "a_guard.py").write_text("", encoding="utf-8")
        (self.checks / "b_guard.py").write_text("", encoding="utf-8")
        self.importer.import_module.side_effect = [
            SyntaxError("boom"),
            module_with(Guard(id="wrong", title="t", scopes=("s",))),
        ]
        (self.tests / "test_b_guard.py").write_text("", encoding="utf-8")
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        problems = "\n".join(ctx.exception.args[0])
        self.assertIn("a_guard", problems)
        self.assertIn("b_guard", problems)

    def test_private_and_dunder_modules_are_not_guards(self):
        for name in ("_helper.py", "__init__.py"):
            (self.checks / name).write_text("", encoding="utf-8")
        with self.assertRaises(RegistryError) as ctx:
            registry.discover()
        self.assertIn("没有任何护栏模块", str(ctx.exception.args[0]))


class PointerValidationTest(unittest.TestCase):
    """docs / ledger 是两个不同含义的指针，写错必须被抓 —— 否则护栏报绿而它的「依据」不存在。"""

    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        self.root = tmp / "repo"
        (self.root / "docs").mkdir(parents=True)
        (self.root / "docs" / "real.md").write_text("# ok", encoding="utf-8")
        self.ledger_dir = tmp / "ledger"
        self.ledger_dir.mkdir()
        self._patch(registry, "LEDGER_DIR", self.ledger_dir)
        tests = tmp / "tests"
        tests.mkdir()
        (tests / "test_sample_guard.py").write_text("", encoding="utf-8")
        self._patch(registry, "TESTS_DIR", tests)

    def _patch(self, target_obj, name, value):
        patcher = mock.patch.object(target_obj, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def validate(self, **guard_kwargs):
        module = module_with(Guard(id="sample_guard", title="t", scopes=("src/**",), **guard_kwargs))
        return registry._validate(module, pathlib.Path("sample_guard.py"), self.root)

    def test_dead_doc_pointer_is_rejected(self):
        with self.assertRaises(RegistryError) as ctx:
            self.validate(docs="docs/gone.md")
        self.assertIn("GUARD.docs", str(ctx.exception.args[0]))

    def test_dead_ledger_pointer_is_rejected(self):
        with self.assertRaises(RegistryError) as ctx:
            self.validate(ledger="no_such_ledger")
        self.assertIn("GUARD.ledger", str(ctx.exception.args[0]))

    def test_existing_pointers_are_accepted(self):
        (self.ledger_dir / "smoke_ledger.json").write_text("{}", encoding="utf-8")
        guard, _ = self.validate(docs="docs/real.md", ledger="smoke_ledger")
        self.assertEqual((guard.docs, guard.ledger), ("docs/real.md", "smoke_ledger"))

    def test_missing_check_function_is_rejected(self):
        module = types.ModuleType("fake_check")
        module.GUARD = Guard(id="sample_guard", title="t", scopes=("src/**",))
        with self.assertRaises(RegistryError) as ctx:
            registry._validate(module, pathlib.Path("sample_guard.py"), self.root)
        self.assertIn("缺少可调用的", str(ctx.exception.args[0]))


class RealChecksTest(unittest.TestCase):
    """真实 checks/ 目录必须随时可注册 —— 这是「新增文件即生效」的下界。"""

    def test_shipped_guards_satisfy_the_contract(self):
        found = registry.discover()
        self.assertGreaterEqual(len(found), 6)
        self.assertEqual(sorted(r.id for r in found), sorted({r.id for r in found}))

    def test_every_guard_declares_a_non_empty_fix_hint_or_red_line(self):
        """护栏报出问题却不给修复方向 = 把判据成本转嫁给下一个读日志的人。"""
        incomplete = [
            r.id for r in registry.discover() if not (r.guard.fix_hint or r.guard.red_lines)
        ]
        self.assertEqual(incomplete, [])


if __name__ == "__main__":
    unittest.main()
