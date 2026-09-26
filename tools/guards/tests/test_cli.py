"""CLI 层 —— 三个消费端（package.json / CI / lefthook）都从这里进，它坏了没人会看见。

`list --stage <s>` 存在的全部理由：CI 门禁集与本地门禁集曾经不一致（两条护栏只挂在本地
lint，而 CI 从不调 `pnpm lint`），当时没有任何一条命令能一眼看出差异。
"""
from __future__ import annotations

import contextlib
import io
import pathlib
import unittest
from unittest import mock

from guards.core import cli
from guards.core.contract import Guard
from guards.core.registry import Registration


def reg(name: str, stages: tuple) -> Registration:
    return Registration(
        guard=Guard(
            id=name, title=name, scopes=("src/**",), stages=stages,
            docs="x.md", fix_hint="改法示意",
        ),
        check=lambda ctx: None,
        module_name=name,
        source=pathlib.Path(f"{name}.py"),
    )


class GitResult:
    def __init__(self, returncode=0, stdout=""):
        self.returncode = returncode
        self.stdout = stdout


class CliTestBase(unittest.TestCase):
    def _patch(self, dotted, value):
        head, _, attr = dotted.rpartition(".")
        patcher = mock.patch.object(getattr(cli, head) if head else cli, attr, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def capture(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(argv)
        return code, out.getvalue(), err.getvalue()


class RegistryTableTest(CliTestBase):
    def setUp(self):
        self.regs = [reg("a_both", ("local", "ci")), reg("b_ci_only", ("ci",))]
        self._patch("discover", lambda root=None: self.regs)
        self._patch("repo.find_repo_root", lambda *a: pathlib.Path("/repo"))

    def test_no_stage_lists_everything(self):
        code, text, _ = self.capture(["list"])
        self.assertEqual(code, 0)
        self.assertIn("共 2 条。", text)

    def test_stage_filters_and_names_what_is_left_out(self):
        _, text, _ = self.capture(["list", "--stage", "local"])
        self.assertIn("a_both", text)
        self.assertNotIn("  b_ci_only\n", text)
        self.assertIn("1 / 2 条在册", text)
        self.assertIn("未列入：b_ci_only", text)

    def test_stage_covering_all_says_so(self):
        _, text, _ = self.capture(["list", "--stage", "ci"])
        self.assertIn("2 / 2 条在册（无护栏被排除）", text)

    def test_unknown_stage_is_rejected_by_the_parser(self):
        with self.assertRaises(SystemExit) as ctx:
            self.capture(["list", "--stage", "nightly"])
        self.assertEqual(ctx.exception.code, 2)

    def test_list_with_a_guard_id_runs_it_in_ledger_mode(self):
        seen = {}
        self._patch("runner.execute", lambda **kw: seen.update(kw) or 0)
        self.capture(["list", "check_demo"])
        self.assertEqual(
            seen, {"only": ["check_demo"], "list_mode": True, "run_selftest": False}
        )


class BrokenRegistryTest(CliTestBase):
    def test_list_reports_registration_problems_and_exits_two(self):
        def boom(root=None):
            raise cli.RegistryError(["check_x.py: 缺少 `GUARD`", "check_y: 缺少配套单测"])

        self._patch("discover", boom)
        self._patch("repo.find_repo_root", lambda *a: pathlib.Path("/repo"))
        code, _, err = self.capture(["list"])
        self.assertEqual(code, 2)
        self.assertIn("注册表校验未通过", err)
        self.assertIn("缺少配套单测", err)

    def test_registry_error_carried_as_a_bare_string_is_still_printed(self):
        def boom(root=None):
            raise cli.RegistryError("注册表为空")

        self._patch("discover", boom)
        self._patch("repo.find_repo_root", lambda *a: pathlib.Path("/repo"))
        code, _, err = self.capture(["list"])
        self.assertEqual(code, 2)
        self.assertIn("注册表为空", err)


class RunCommandTest(CliTestBase):
    def setUp(self):
        self.calls = {}
        self._patch("runner.execute", lambda **kw: self.calls.update(kw) or 0)

    def test_flags_are_forwarded_to_the_runner(self):
        self.capture(
            ["run", "--stage", "ci", "--format", "github-actions", "--only", "a", "--no-selftest"]
        )
        self.assertEqual(self.calls["stage"], "ci")
        self.assertEqual(self.calls["fmt"], "github-actions")
        self.assertEqual(self.calls["only"], ["a"])
        self.assertFalse(self.calls["run_selftest"])

    def test_default_stage_keeps_the_selftest_gate(self):
        self.capture(["run"])
        self.assertEqual(self.calls["stage"], "local")
        self.assertTrue(self.calls["run_selftest"])

    def test_staged_reads_the_git_index(self):
        self._patch("subprocess.run", lambda *a, **k: GitResult(0, "src/a.ts\ndocs/x.md\n\n"))
        self.capture(["run", "--stage", "commit", "--staged"])
        self.assertEqual(self.calls["changed"], ["src/a.ts", "docs/x.md"])

    def test_staged_failure_does_not_degrade_to_a_quiet_full_run(self):
        """拿不到改动集就报框架失效（2），而不是当成「没有改动」假装跑过。"""
        self._patch("subprocess.run", lambda *a, **k: GitResult(128, ""))
        code, _, err = self.capture(["run", "--stage", "commit", "--staged"])
        self.assertEqual(code, 2)
        self.assertIn("git", err)

    def test_explicit_paths_after_double_dash_win(self):
        code, _, _ = self.capture(["run", "--stage", "commit", "--", "src/a.ts", "src/b.ts"])
        self.assertEqual(code, 0)
        self.assertEqual(self.calls["changed"], ["src/a.ts", "src/b.ts"])

    def test_changed_flag_feeds_the_scope_filter(self):
        self.capture(["run", "--changed", "docs/x.md"])
        self.assertEqual(self.calls["changed"], ["docs/x.md"])


if __name__ == "__main__":
    unittest.main()
