"""命令执行护栏用例：V1/V2/V3 违规、正例零命中、豁免（platform / 执行层 / 测试）。"""
from __future__ import annotations

import unittest

from guards.checks import check_command_execution as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

FIXTURE = "src-tauri/src/foo/service.rs"


class CommandExecutionTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, body: str, fixture: str = FIXTURE):
        make_repo(self.root, {fixture: body})
        return subject.check(context(self.root))

    def test_shell_as_command_is_a_violation(self):
        result = self.run_guard(
            "async fn go(target: &ExecTarget) {\n"
            '    run(target, "bash", &["-c", "echo hi"]).await;\n'
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 2)
        self.assertIn("bash", result.findings[0].message)

    def test_spawn_options_with_shell_cmd_is_a_violation(self):
        result = self.run_guard(
            'let opts = SpawnOptions::new("cmd", &["/C", script]);\n'
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_direct_process_command_is_a_violation(self):
        result = self.run_guard(
            'let out = std::process::Command::new("git").args(args).output();\n'
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("Command", result.findings[0].message)

    def test_remote_shell_name_is_a_violation(self):
        result = self.run_guard("let shell = remote_shell_name(target);\n")
        self.assertEqual(result.verdict, VIOLATION)

    def test_argv_form_is_clean(self):
        result = self.run_guard(
            "let spawn = SpawnOptions::new(\"git\", &args)\n"
            "    .with_current_dir(dir)\n"
            "    .with_env(&env);\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_facade_is_scanned_not_exempt(self):
        # 统一 facade 不再拼 shell（选择下沉到 executor），因此**不在**豁免清单：
        # 若有人在 core/exec.rs 重新硬编码 shell，必须被拦下。
        result = self.run_guard(
            'let child = run(target, "sh", &["-c", script]).await;\n',
            fixture="src-tauri/src/core/exec.rs",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.scanned, 1)

    def test_executor_layer_is_exempt(self):
        result = self.run_guard(
            'let (program, argv) = platform::shell_launch::shell_argv(script);\n',
            fixture="src-tauri/src/common/executor/local.rs",
        )
        self.assertEqual(result.verdict, PASS)
        self.assertEqual(result.scanned, 0, "执行层不应进入扫描集")

    def test_platform_layer_is_exempt(self):
        result = self.run_guard(
            'spawn_detached(&ExecTarget::Local, "cmd", &["/C", &full_command]);\n',
            fixture="src-tauri/src/platform/ide_launch/windows.rs",
        )
        self.assertEqual(result.verdict, PASS)

    def test_cfg_test_block_is_exempt(self):
        result = self.run_guard(
            "#[cfg(test)]\n"
            "mod tests {\n"
            "    #[tokio::test]\n"
            "    async fn it_works() {\n"
            '        collect(&ExecTarget::Local, "sh", &["-c", "printf hi"]).await;\n'
            "    }\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_test_file_is_skipped(self):
        result = self.run_guard(
            'let out = run(&target, "bash", &["-c", "x"]).await;\n',
            fixture="src-tauri/src/foo/tests.rs",
        )
        self.assertEqual(result.verdict, PASS)
        self.assertEqual(result.scanned, 0)


if __name__ == "__main__":
    unittest.main()
