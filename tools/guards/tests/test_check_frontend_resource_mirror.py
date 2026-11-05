"""前端资源态镜像禁令护栏用例 —— 判据是「影子记账标识符 / 渲染期裸读」。"""
from __future__ import annotations

import unittest

from guards.checks import check_frontend_resource_mirror as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

HOOK = "src/app/hooks/useThing.ts"
PANEL = "src/features/git/components/Panel.tsx"
API = "src/features/git/api/gitApi.ts"
UTIL = "src/features/git/utils/gitStatus.ts"
TYPES = "src/shared/types/project.ts"


class FrontendResourceMirrorTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    # ── 判据 A：影子记账标识符 ────────────────────────────────────────────

    def test_clean_production_code_passes(self):
        result = self.run_guard(
            {
                HOOK: (
                    "export function useThing() {\n"
                    "  useEffect(() => { void sync([]); }, []);\n"
                    "}\n"
                ),
                API: "export function getWorkspaceStatus(ws: W) { return invoke('x', { ws }); }\n",
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_mirror_identifier_is_a_violation(self):
        result = self.run_guard(
            {HOOK: "const requestedIntent = useRef<string | null>(null);\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("requestedIntent", result.findings[0].message)
        self.assertEqual(result.findings[0].line, 1)

    def test_every_identifier_in_the_list_is_caught(self):
        # 清单是唯一事实源：每条都必须真的被判定（防止「加了词但正则没覆盖」）
        for identifier in subject.MIRROR_IDENTIFIERS:
            with self.subTest(identifier):
                result = self.run_guard({HOOK: f"const {identifier} = 1;\n"})
                self.assertEqual(result.verdict, VIOLATION, f"{identifier} 未被拦住")

    def test_identifier_in_comment_counts(self):
        # 注释里留下退役机制的名字 = 概念还在代码库里，下一个读代码的人会照着抄
        result = self.run_guard({HOOK: "// 旧实现用 retryTick 自愈，已删除\n"})
        self.assertEqual(result.verdict, VIOLATION)

    def test_prefix_collision_is_not_a_violation(self):
        result = self.run_guard({HOOK: "const requestedIntentFoo = 1;\n"})
        self.assertEqual(result.verdict, PASS)

    def test_tests_and_type_only_files_are_out_of_scope(self):
        result = self.run_guard(
            {
                "src/app/hooks/__tests__/useThing.test.ts": "const requestedIntent = 1;\n",
                "src/testing/factories.ts": "export const retryTick = 1;\n",
                # 纯类型：方法签名不是调用（且这里不可能是渲染期）
                TYPES: "export interface C { refreshWorkspaceStatus(): Promise<void>; }\n",
            }
        )
        self.assertEqual(result.verdict, PASS)

    # ── 判据 B：状态读的调用位置 ──────────────────────────────────────────

    def test_status_read_inside_effect_passes(self):
        result = self.run_guard(
            {
                HOOK: (
                    "export function useThing(ws: W) {\n"
                    "  useEffect(() => {\n"
                    "    void getWorkspaceStatus(ws);\n"
                    "  }, [ws]);\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_status_read_inside_callback_passes(self):
        result = self.run_guard(
            {
                PANEL: (
                    "export const Panel = () => {\n"
                    "  const refresh = useCallback(async () => {\n"
                    "    await refreshWorkspaceStatus(key);\n"
                    "  }, [key]);\n"
                    "  return null;\n"
                    "};\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_status_read_in_hook_body_is_a_violation(self):
        # 渲染期裸调用：每次渲染一次 IPC + 一次 store 写入
        result = self.run_guard(
            {
                HOOK: (
                    "export function useThing(ws: W) {\n"
                    "  void getWorkspaceStatus(ws);\n"
                    "  return null;\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 2)
        self.assertIn("渲染期裸调用", result.findings[0].message)

    def test_status_read_in_component_body_is_a_violation(self):
        result = self.run_guard(
            {
                PANEL: (
                    "export const Panel = React.memo(() => {\n"
                    "  void refreshWorkspaceStatus(key);\n"
                    "  return null;\n"
                    "});\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_status_read_in_usememo_is_a_violation(self):
        # `useMemo` 在渲染期同步执行 —— 与裸调用等价，刻意不在允许区间里
        result = self.run_guard(
            {
                HOOK: (
                    "export function useThing(ws: W) {\n"
                    "  const s = useMemo(() => getWorkspaceStatus(ws), [ws]);\n"
                    "  return s;\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_status_read_in_plain_function_passes(self):
        # 命令式流程（session 恢复 / 刷新按钮 / 事件回调）不可能是渲染期
        result = self.run_guard(
            {
                UTIL: (
                    "export async function refreshWorkspaceStatus(key: string): Promise<void> {\n"
                    "  const snapshot = await getWorkspaceStatus(fromKey(key));\n"
                    "  applyStatus(snapshot);\n"
                    "}\n"
                ),
                API: (
                    "export function createCommands(ws: W) {\n"
                    "  return { refreshWorkspaceStatus: () => getWorkspaceStatus(ws) };\n"
                    "}\n"
                    "export function getWorkspaceStatus(ws: W) {\n"
                    "  return invoke('get_workspace_status', { ws });\n"
                    "}\n"
                ),
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_named_function_inside_hook_does_not_launder_the_call(self):
        # 2026-11 复核发现的假阴性：hook 里包一层具名函数、再在渲染期调用它 ——
        # 「普通函数放行」这条豁免曾把它整段放行。豁免只适用于**模块级**具名函数。
        result = self.run_guard(
            {
                HOOK: (
                    "export function useThing(ws: W) {\n"
                    "  function inner() {\n"
                    "    return getWorkspaceStatus(ws);\n"
                    "  }\n"
                    "  void inner();\n"
                    "  return null;\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 3)

    def test_call_hidden_in_string_literal_does_not_count(self):
        # 先抹噪声再配平：字符串里的调用文本不是调用（也不能扰动括号配平）
        result = self.run_guard(
            {
                HOOK: (
                    "export function useThing() {\n"
                    "  log('getWorkspaceStatus(ignored)');\n"
                    "  return null;\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)


if __name__ == "__main__":
    unittest.main()
