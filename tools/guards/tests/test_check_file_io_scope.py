"""文件 IO Workspace 寻址护栏用例 —— 唯一命令面 / 散参退役 / 单一编码。"""
from __future__ import annotations

import unittest

from guards.checks import check_file_io_scope as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

API_FILE = "src/features/file/api/fileApi.ts"
OTHER = "src/features/editor/hooks/useThing.ts"


class FileIoScopeGuardTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_invoke_outside_api_is_a_violation(self):
        result = self.run_guard(
            {
                OTHER: "export function f() {\n"
                "  return invoke<FileContent>('read_file_content', { projectId, filePath });\n"
                "}\n"
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("read_file_content", result.findings[0].message)

    def test_invoke_in_api_file_is_allowed(self):
        result = self.run_guard(
            {
                API_FILE: "export function readFileContent(workspace, filePath) {\n"
                "  return invoke<FileContent>('read_file_content', { workspace, filePath });\n"
                "}\n"
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_legacy_root_param_in_api_is_a_violation(self):
        result = self.run_guard(
            {
                API_FILE: "export function readFileContent(projectId, filePath, rootPath) {\n"
                "  return invoke<FileContent>('read_file_content', { projectId, filePath, rootPath });\n"
                "}\n"
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("rootPath" in f.message for f in result.findings))

    def test_retired_tabkey_symbol_is_a_violation(self):
        result = self.run_guard({OTHER: "const k = resolveTabKey(pid, wt);\n"})
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("resolveTabKey", result.findings[0].message)

    def test_retired_tabkey_module_is_a_violation(self):
        result = self.run_guard(
            {OTHER: "import { resolveTabKey } from '@/shared/utils/tabKey';\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("tabKey" in f.message for f in result.findings))

    def test_backtick_invoke_outside_api_is_a_violation(self):
        """模板串命令名不得绕过 A 口径（invoke(`read_file_content`)）。"""
        result = self.run_guard(
            {OTHER: "export function f() {\n  return invoke(`read_dir_tree`, { workspace });\n}\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("read_dir_tree", result.findings[0].message)

    def test_legacy_root_param_in_command_factory_is_a_violation(self):
        """B 口径同样覆盖 commandFactory（ProjectCommands 曾有的文件散参名）。"""
        result = self.run_guard(
            {
                "src/features/project/hooks/use-active-project/commandFactory.ts": (
                    "export function readFileContent(projectId, filePath, rootPath) {\n"
                    "  return invoke('read_file_content', { projectId, filePath, rootPath });\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("rootPath" in f.message for f in result.findings))

    def test_comment_mention_of_retired_module_is_not_a_violation(self):
        """注释里讲解退役历史是合法的 —— 只有 import 形态才算回潮。"""
        result = self.run_guard(
            {
                OTHER: "// shared/utils/tabKey 已退役（tab 组键 = canonical WorkspaceKey）\n"
                "export const k = workspaceKeyOf(pid, wt);\n"
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_clean_file_passes(self):
        result = self.run_guard(
            {
                OTHER: "export function f(workspace, filePath) {\n"
                "  return readFileContent(workspace, filePath);\n"
                "}\n"
            }
        )
        self.assertEqual(result.verdict, PASS)


if __name__ == "__main__":
    unittest.main()
