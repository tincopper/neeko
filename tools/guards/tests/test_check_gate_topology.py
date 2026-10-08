"""拓扑护栏 —— 编排层的漂移必须被机器发现（A1 + A3）。

A1：任何声明了 `ci` 上下文的外部命令门禁，其命令必须能在 `ci.yml` 的**指定 job** 里找到
    （支持 `pnpm <script>` 与裸命令两种形态，且带词边界）。
A3：`lefthook.yml` 的 pre-commit / pre-push 只允许出现对护栏框架的**单次**调用，
    不得再出现手写的门禁命令，且不允许 `&&`。

全部夹具在 tempdir 里构造（红线 13），不碰真实 `ci.yml` / `lefthook.yml`。
"""
from __future__ import annotations

import json
import unittest

from guards.checks import check_gate_topology as topology
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo


def gate_entry(
    gate_id="lint_fe",
    argv=("pnpm", "lint:fe"),
    ci_job="frontend-check",
    stages=("ci",),
) -> dict:
    entry = {
        "id": gate_id,
        "title": "t",
        "scopes": ["src/**/*.ts"],
        "argv": list(argv),
        "kind": "lint",
        "stages": list(stages),
        "budget_ms": 1_000,
        "fix_hint": "fix",
    }
    if ci_job:
        entry["ci_job"] = ci_job
    return entry


def ci_with_job(job: str, command: str) -> str:
    return (
        "name: CI\n"
        "on:\n"
        "  pull_request:\n"
        "    branches: [main]\n"
        "jobs:\n"
        f"  {job}:\n"
        "    runs-on: ubuntu-latest\n"
        "    steps:\n"
        "      - name: Checkout\n"
        "        uses: actions/checkout@v4\n"
        "      - name: Run\n"
        f"        run: {command}\n"
    )


VALID_LEFTHOOK = (
    "pre-commit:\n"
    "  commands:\n"
    "    guards:\n"
    "      run: python3 tools/guards/run.py run --stage commit --staged\n"
    "commit-msg:\n"
    "  commands:\n"
    "    commitlint:\n"
    "      run: pnpm commitlint --edit {1}\n"
    "pre-push:\n"
    "  commands:\n"
    "    gates:\n"
    "      run: python3 tools/guards/run.py run --stage push --changed {push_files} --jobs 3\n"
)


def build(test, gates, ci, lefthook=VALID_LEFTHOOK):
    root = temp_repo(test)
    make_repo(
        root,
        {
            "tools/guards/ledger/gates.json": json.dumps(
                {"gates": gates}, ensure_ascii=False
            ),
            ".github/workflows/ci.yml": ci,
            "lefthook.yml": lefthook,
        },
    )
    return context(root)


class CiTopologyTest(unittest.TestCase):
    def check(self, gates, ci, lefthook=VALID_LEFTHOOK):
        return topology.check(build(self, gates, ci, lefthook))

    def test_declared_job_missing_is_a_violation(self):
        result = self.check([gate_entry(ci_job="ghost-job")], ci_with_job("other", "pnpm lint:fe"))
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("ghost-job" in f.message for f in result.findings))

    def test_command_missing_from_the_declared_job_is_a_violation(self):
        result = self.check([gate_entry()], ci_with_job("frontend-check", "pnpm install"))
        self.assertEqual(result.verdict, VIOLATION)

    def test_pnpm_form_and_bare_form_are_both_supported(self):
        ci = (
            ci_with_job("frontend-check", "pnpm lint:fe")
            + "  backend-check:\n"
            "    runs-on: ubuntu-latest\n"
            "    steps:\n"
            "      - name: Rust check\n"
            "        run: cargo check\n"
        )
        gates = [
            gate_entry(),
            gate_entry(gate_id="rust_check", argv=("cargo", "check"), ci_job="backend-check"),
        ]
        self.assertEqual(self.check(gates, ci).verdict, PASS)

    def test_prefix_command_does_not_satisfy_a_longer_script(self):
        """`pnpm build` 不得被 `pnpm build:host` 误命中（词边界）。"""
        gates = [gate_entry(gate_id="build_web", argv=("pnpm", "build"), ci_job="frontend-build")]
        result = self.check(gates, ci_with_job("frontend-build", "pnpm build:host"))
        self.assertEqual(result.verdict, VIOLATION)

    def test_suffix_command_does_not_satisfy_a_shorter_script(self):
        """反向也要防：`pnpm test:rust` 声明不得被 `pnpm test:rust:coverage` 满足。"""
        gates = [gate_entry(gate_id="test_rust", argv=("pnpm", "test:rust"), ci_job="backend-test")]
        result = self.check(gates, ci_with_job("backend-test", "pnpm test:rust:coverage"))
        self.assertEqual(result.verdict, VIOLATION)

    def test_gates_without_ci_context_are_not_checked_against_ci(self):
        gates = [gate_entry(ci_job="", stages=("local", "push"))]
        self.assertEqual(self.check(gates, ci_with_job("frontend-check", "pnpm install")).verdict, PASS)

    def test_command_on_a_comment_line_does_not_count(self):
        ci = (
            "jobs:\n"
            "  frontend-check:\n"
            "    runs-on: ubuntu-latest\n"
            "    steps:\n"
            "      - name: Run\n"
            "        # run: pnpm lint:fe\n"
            "        run: echo noise\n"
        )
        result = self.check([gate_entry()], ci)
        self.assertEqual(result.verdict, VIOLATION)


class LefthookTopologyTest(unittest.TestCase):
    def check(self, lefthook, ci=None):
        ci = ci or ci_with_job("frontend-check", "pnpm lint:fe")
        return topology.check(build(self, [gate_entry()], ci, lefthook))

    def test_a_hand_written_gate_command_is_a_violation(self):
        lefthook = (
            "pre-commit:\n"
            "  commands:\n"
            "    lint-frontend:\n"
            "      run: pnpm lint:fe\n"
            "pre-push:\n"
            "  commands:\n"
            "    gates:\n"
            "      run: python3 tools/guards/run.py run --stage push --changed {push_files} --jobs 3\n"
        )
        result = self.check(lefthook)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("pre-commit", "\n".join(f.message for f in result.findings))

    def test_an_extra_command_beside_the_framework_call_is_a_violation(self):
        lefthook = VALID_LEFTHOOK.replace(
            "    guards:\n", "    lint-frontend:\n      run: pnpm lint:fe\n    guards:\n"
        )
        self.assertEqual(self.check(lefthook).verdict, VIOLATION)

    def test_a_missing_framework_call_in_a_hook_is_a_violation(self):
        lefthook = VALID_LEFTHOOK.replace(
            "      run: python3 tools/guards/run.py run --stage push --changed {push_files} --jobs 3\n",
            "      run: echo ok\n",
        )
        self.assertEqual(self.check(lefthook).verdict, VIOLATION)

    def test_ampersand_chains_are_rejected(self):
        lefthook = VALID_LEFTHOOK.replace(
            "run: python3 tools/guards/run.py run --stage commit --staged",
            "run: python3 tools/guards/run.py run --stage commit --staged && pnpm lint:fe",
        )
        result = self.check(lefthook)
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("&&", "\n".join(f.message for f in result.findings))

    def test_commit_msg_hook_is_not_governed(self):
        """commit-msg 跑 commitlint，不属于 A3 范围。"""
        self.assertEqual(self.check(VALID_LEFTHOOK).verdict, PASS)


class AntiVacuityTest(unittest.TestCase):
    def test_missing_ci_file_is_an_error_not_a_pass(self):
        root = temp_repo(self)
        make_repo(
            root,
            {
                "tools/guards/ledger/gates.json": json.dumps({"gates": [gate_entry()]}),
                "lefthook.yml": VALID_LEFTHOOK,
            },
        )
        result = topology.check(context(root))
        self.assertEqual(result.verdict, ERROR)

    def test_empty_lefthook_is_an_error_not_a_pass(self):
        result = topology.check(build(self, [gate_entry()], ci_with_job("frontend-check", "pnpm lint:fe"), "\n"))
        self.assertEqual(result.verdict, ERROR)

    def test_ci_without_any_job_is_an_error_not_a_pass(self):
        result = topology.check(build(self, [gate_entry()], "name: CI\non:\n  push:\n"))
        self.assertEqual(result.verdict, ERROR)

    def test_broken_gate_declaration_is_an_error(self):
        result = topology.check(
            build(self, [gate_entry(argv=())], ci_with_job("frontend-check", "pnpm lint:fe"))
        )
        self.assertEqual(result.verdict, ERROR)


if __name__ == "__main__":
    unittest.main()
