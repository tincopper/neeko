"""长 git 操作墙钟护栏用例 —— 含「首个实参是直接调用」的形态边界与测试豁免。"""
from __future__ import annotations

import unittest

from guards.checks import check_long_git_op_wall_clock as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

FIXTURE = "src/features/git/hooks/useGitActions.ts"


class LongGitOpWallClockTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, body: str, fixture: str = FIXTURE):
        make_repo(self.root, {fixture: body})
        return subject.check(context(self.root))

    def test_with_timeout_around_qualified_push_is_a_violation(self):
        result = self.run_guard(
            "async function go() {\n"
            "  await withTimeout(commands.push(false, runId), 30_000, 'push');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 2)
        self.assertIn("push", result.findings[0].message)

    def test_with_timeout_around_bare_pull_is_a_violation(self):
        result = self.run_guard(
            "async function go() {\n"
            "  const outcome = await withTimeout(pull(projectId, worktreePath), 30_000, 'pull');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_with_timeout_around_git_api_fetch_is_a_violation(self):
        result = self.run_guard(
            "async function go() {\n"
            "  await withTimeout(gitApi.fetch(projectId), 30_000, 'fetch');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_with_timeout_around_commit_files_is_a_violation(self):
        result = self.run_guard(
            "async function go() {\n"
            "  await withTimeout(commitFiles(projectId, paths, message), 30_000, 'commit');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_multiline_first_argument_is_a_violation(self):
        result = self.run_guard(
            "async function go() {\n"
            "  await withTimeout(\n"
            "    push(projectId, false, worktreePath),\n"
            "    TIMEOUT_NETWORK_MS,\n"
            "    'push',\n"
            "  );\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 2)

    def test_local_fast_ops_may_keep_with_timeout(self):
        result = self.run_guard(
            "async function go() {\n"
            "  await withTimeout(commands.stageFiles([path]), 30_000, 'stage');\n"
            "  await withTimeout(commands.discardFiles(paths), 30_000, 'discard');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_indirect_call_via_variable_is_out_of_scope(self):
        """`op()` 经变量间接调用无法静态判定 —— 明确不在射程内（靠单点编排约束）。"""
        result = self.run_guard(
            "async function go(op) {\n"
            "  await withTimeout(op(), 30_000, 'op');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_test_files_are_exempt_but_still_scanned(self):
        result = self.run_guard(
            "it('x', async () => {\n"
            "  await withTimeout(push(a, b), 30_000, 'push');\n"
            "});\n",
            fixture="src/features/git/hooks/__tests__/useGitActions.test.ts",
        )
        self.assertEqual(result.verdict, PASS)
        self.assertIn("豁免测试 1", result.metrics)
        self.assertGreater(result.scanned, 0)

    def test_prefetch_is_not_a_false_positive(self):
        result = self.run_guard(
            "async function go() {\n"
            "  await withTimeout(commands.prefetchData(id), 30_000, 'prefetch');\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_clean_tree_passes(self):
        result = self.run_guard("export const x = 1;\n")
        self.assertEqual(result.verdict, PASS)


if __name__ == "__main__":
    unittest.main()
