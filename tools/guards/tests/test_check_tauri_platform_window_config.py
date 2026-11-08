"""平台 Tauri 配置「有效窗口配置」护栏用例。

夹具由护栏的契约表派生（唯一事实源），测试自身不抄第二份配置值；
契约表与真实配置是否一致，由护栏本身在 `check:quick` 里校验。
"""
from __future__ import annotations

import json
import unittest
from unittest import mock

from guards.checks import check_tauri_platform_window_config as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

MAIN = subject.MAIN_CONF
MACOS = "src-tauri/tauri.macos.conf.json"
WINDOWS = "src-tauri/tauri.windows.conf.json"
HARMONY = "src-tauri/tauri.harmony.conf.json"

# 主配置是窗口字段清单的唯一事实源（产品约束另有 REQUIRED_STARTUP_STATE）。
BASE_WINDOW = {
    "title": "Neeko",
    "width": 1200,
    "height": 800,
    "resizable": True,
    "fullscreen": False,
    "maximized": True,
    "decorations": False,
    "transparent": False,
}


def macos_window(**overrides):
    """修复后的 macOS 窗口 = 主窗口 + 平台专属外观（复用护栏契约表）。"""
    window = {**BASE_WINDOW, **subject.PLATFORM_WINDOW_STATE["macos"]}
    window.update(overrides)
    return window


def old_macos_window():
    """事故形态：只写平台专属外观，主配置字段被数组替换整体吞掉。"""
    return dict(subject.PLATFORM_WINDOW_STATE["macos"])


def main_conf(windows=None) -> str:
    return json.dumps({"app": {"windows": windows if windows is not None else [BASE_WINDOW]}})


def platform_conf(app=None) -> str:
    conf = {"bundle": {"targets": ["dmg"]}}
    if app is not None:
        conf["app"] = app
    return json.dumps(conf)


class EffectiveWindowConfigTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def default_files(self, macos_app=None, *, include_macos=True):
        files = {
            MAIN: main_conf(),
            WINDOWS: platform_conf(),  # 无 app.windows：主配置原样生效
        }
        if include_macos:
            if macos_app is None:
                macos_app = {"windows": [macos_window()]}
            files[MACOS] = platform_conf(macos_app)
        return files

    @staticmethod
    def messages(result) -> str:
        return " ".join(f.message for f in result.findings)

    def test_current_configs_pass(self):
        result = self.run_guard(self.default_files())
        self.assertEqual(result.verdict, PASS, result.findings)
        self.assertEqual(result.scanned, 3)

    def test_original_bug_is_a_violation(self):
        result = self.run_guard(self.default_files({"windows": [old_macos_window()]}))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("maximized", self.messages(result))

    def test_null_windows_is_a_violation(self):
        """RFC 7396 中 null 删除键 → 有效配置零窗口；旧护栏把它当「未声明」放过。"""
        result = self.run_guard(self.default_files({"windows": None}))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("app.windows", self.messages(result))

    def test_macos_override_disappearing_is_a_violation(self):
        """平台覆盖整段消失 → 外观静默回退主配置，是原事故的反向形态。"""
        result = self.run_guard(self.default_files({}))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("decorations", self.messages(result))

    def test_missing_macos_config_is_a_violation(self):
        """有专属契约的平台连配置文件都没了，不能报绿。"""
        result = self.run_guard(self.default_files(include_macos=False))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("缺少 macos 平台配置", self.messages(result))

    def test_fewer_windows_than_base_is_a_violation(self):
        files = self.default_files({"windows": [macos_window()]})
        files[MAIN] = main_conf([BASE_WINDOW, dict(BASE_WINDOW, title="second")])
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("2 个窗口", self.messages(result))

    def test_extra_window_is_a_violation(self):
        """旧测试把这个洞写成了期望行为；数组整体替换后窗口集合必须完整。"""
        result = self.run_guard(
            self.default_files({"windows": [macos_window(), {"title": "extra"}]})
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("1 个窗口", self.messages(result))

    def test_new_platform_is_automatically_checked(self):
        """不维护平台词汇表：新平台配置出现即纳入，默认继承主配置契约。"""
        files = self.default_files()
        files[HARMONY] = platform_conf({"windows": [old_macos_window()]})
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("maximized", self.messages(result))

    def test_base_without_maximized_is_a_violation(self):
        files = self.default_files()
        files[MAIN] = main_conf([dict(BASE_WINDOW, maximized=False)])
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("maximized", self.messages(result))

    def test_explicit_value_drift_is_a_violation(self):
        result = self.run_guard(self.default_files({"windows": [macos_window(width=800)]}))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("width", self.messages(result))

    def test_extra_explicit_fields_are_allowed(self):
        """新增显式窗口字段无需改护栏（开闭原则）。"""
        window = macos_window(alwaysOnTop=True)
        result = self.run_guard(self.default_files({"windows": [window]}))
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_missing_main_config_is_an_infra_failure(self):
        result = self.run_guard({MACOS: platform_conf({"windows": [macos_window()]})})
        self.assertEqual(result.verdict, ERROR)

    def test_invalid_main_json_is_an_infra_failure(self):
        files = self.default_files()
        files[MAIN] = "{ not json"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("JSON", result.error)

    def test_invalid_platform_json_is_an_infra_failure(self):
        files = self.default_files()
        files[MACOS] = "{ not json"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("JSON", result.error)

    def test_non_object_config_is_an_infra_failure(self):
        files = self.default_files()
        files[MAIN] = "[]"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("顶层必须是对象", result.error)

    def test_main_with_bad_windows_is_an_infra_failure(self):
        files = self.default_files()
        files[MAIN] = json.dumps({"app": {"windows": []}})
        result = self.run_guard(files)
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("app.windows", result.error)

    def test_empty_ledger_with_no_platform_config_is_an_infra_failure(self):
        """连契约表都空了 = 护栏必然空转，拒绝报绿。"""
        with mock.patch.object(subject, "PLATFORM_WINDOW_STATE", {}):
            result = self.run_guard({MAIN: main_conf()})
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("空转", result.error)


class MergePatchTest(unittest.TestCase):
    """合并语义的唯一实现，直接断言纯函数（根 AGENTS.md「纯函数 100%」）。"""

    def test_objects_are_deep_merged(self):
        self.assertEqual(
            subject.merge_patch({"a": {"x": 1}, "b": 2}, {"a": {"y": 3}}),
            {"a": {"x": 1, "y": 3}, "b": 2},
        )

    def test_null_deletes_key(self):
        self.assertEqual(subject.merge_patch({"a": 1, "b": 2}, {"a": None}), {"b": 2})

    def test_array_is_replaced_not_merged(self):
        self.assertEqual(
            subject.merge_patch({"w": [{"a": 1, "b": 2}]}, {"w": [{"a": 9}]}),
            {"w": [{"a": 9}]},
        )

    def test_scalar_replaces_object(self):
        self.assertEqual(subject.merge_patch({"a": {"x": 1}}, {"a": True}), {"a": True})


if __name__ == "__main__":
    unittest.main()
