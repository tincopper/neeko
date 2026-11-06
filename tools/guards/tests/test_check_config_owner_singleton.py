"""config owner / 主题投影唯一性护栏用例（含负例/变异验证）。"""
from __future__ import annotations

import unittest

from guards.checks import check_config_owner_singleton as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

OWNER_DEF = "export function useAppConfigOwner() { return null; }\n"
CALL_SITE = "import { useAppConfigOwner } from './useAppConfigOwner';\nuseAppConfigOwner();\n"
PROJECTION = "document.documentElement.setAttribute('data-theme', theme);\n"
HOOK_SITE = "import { useLiveSessionsBridge } from '@/features/live-sessions';\nuseLiveSessionsBridge();\n"
BARREL = "export { saveConfig } from './api/settingsApi';\n"
LEAF = "export const leaf = 1;\n"


def base_repo() -> dict:
    return {
        "src/app/hooks/useAppConfigOwner.ts": OWNER_DEF,
        "src/app/hooks/useAppShellData.ts": CALL_SITE,
        "src/app/bootstrap/configProjection.ts": PROJECTION,
        "src/app/hooks/useAppGlobalEffects.ts": HOOK_SITE,
        "src/features/settings/index.ts": BARREL,
        "src/features/skill/components/Leaf.tsx": LEAF,
    }


class ConfigOwnerSingletonTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_valid_topology_passes(self):
        result = self.run_guard(base_repo())
        self.assertEqual(result.verdict, PASS, result.findings)
        self.assertGreater(result.scanned, 0)

    def test_second_owner_in_feature_is_a_violation(self):
        files = base_repo()
        files["src/features/skill/components/Leaf.tsx"] = "useAppConfigOwner();\n"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("feature" in f.message for f in result.findings), result.findings)

    def test_missing_owner_call_is_a_violation(self):
        files = base_repo()
        files["src/app/hooks/useAppShellData.ts"] = "export const x = 1;\n"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)

    def test_theme_write_outside_projection_is_a_violation(self):
        files = base_repo()
        files["src/features/skill/components/Leaf.tsx"] = (
            "document.documentElement.setAttribute('data-theme', 'dark');\n"
        )
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("唯一投影点" in f.message for f in result.findings), result.findings)

    def test_dataset_theme_write_outside_projection_is_a_violation(self):
        # 等价写法也是投影：只认 setAttribute 等于给判据留后门
        files = base_repo()
        files["src/features/skill/components/Leaf.tsx"] = (
            "document.documentElement.dataset.theme = 'dark';\n"
        )
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)

    def test_template_literal_theme_write_outside_projection_is_a_violation(self):
        files = base_repo()
        files["src/features/skill/components/Leaf.tsx"] = (
            "document.documentElement.setAttribute(`data-theme`, 'dark');\n"
        )
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)

    def test_legacy_owner_name_is_a_violation(self):
        files = base_repo()
        files["src/features/skill/components/Leaf.tsx"] = "useAppConfig();\n"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)

    def test_barrel_leak_is_a_violation(self):
        files = base_repo()
        files["src/features/settings/index.ts"] = BARREL + "export { useAppConfigOwner } from './hooks/useAppConfigOwner';\n"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("barrel" in f.message for f in result.findings), result.findings)

    def test_duplicated_hook_owner_is_a_violation(self):
        files = base_repo()
        files["src/features/skill/components/Leaf.tsx"] = "useLiveSessionsBridge();\n"
        result = self.run_guard(files)
        self.assertEqual(result.verdict, VIOLATION)

    def test_hook_owner_referenced_through_adapter_table_passes(self):
        # 实现可以是直接调用，也可以是适配器表里的值引用（`Record<ReactHookOwnerId, …>`）：
        # 两种写法都是「同一文件接线」，判据不得因此假红。
        files = base_repo()
        files["src/app/hooks/useAppGlobalEffects.ts"] = (
            "import { useLiveSessionsBridge } from '@/features/live-sessions';\n"
            "const ADAPTERS = { liveSessionsBridge: useLiveSessionsBridge };\n"
            "export const run = () => ADAPTERS.liveSessionsBridge();\n"
        )
        result = self.run_guard(files)
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_test_fixtures_are_out_of_scope(self):
        files = base_repo()
        files["src/features/skill/components/__tests__/Leaf.test.tsx"] = (
            "document.documentElement.setAttribute('data-theme', 'light');\nuseAppConfigOwner();\n"
        )
        result = self.run_guard(files)
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_empty_scan_is_an_infra_failure(self):
        result = subject.check(context(self.root))
        self.assertEqual(result.error != "", True)


if __name__ == "__main__":
    unittest.main()
