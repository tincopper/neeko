"""gate 声明加载 —— 一份数据文件的 schema 校验。

这些用例守的是 PRD R1：拼错键名不许静默按默认值生效、空 argv 不许声明、非法
kind/stage/platform 不许进入词汇表、重复 id 不许两条门禁同名。每条判据都要能指名
gate 与键，否则改错一次要翻半天。

红灯纪律：先写本文件（此时 core/gates.py 不存在），确认 ImportError/失败，再实现。
"""
from __future__ import annotations

import json
import pathlib
import unittest

from guards.core import registry, repo
from guards.core.contract import PLATFORMS
from guards.core.gates import GateLedgerError, load_gates
from guards.core.runner import select
from guards.tests.support import temp_repo


def gate_dict(**overrides) -> dict:
    base = {
        "id": "sample_gate",
        "title": "样例门禁",
        "scopes": ["src/**/*.ts"],
        "argv": ["pnpm", "lint:fe"],
        "kind": "lint",
        "stages": ["local"],
        "budget_ms": 1_000,
        "fix_hint": "改掉它",
    }
    base.update(overrides)
    return base


class GateLedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = temp_repo(self)

    def write(self, payload) -> pathlib.Path:
        path = self.tmp / "ledger" / "gates.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(payload, str):
            path.write_text(payload, encoding="utf-8")
        else:
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return path

    def load(self, payload):
        return load_gates(self.write(payload))

    def assert_rejected(self, payload, *needles):
        with self.assertRaises(GateLedgerError) as ctx:
            self.load(payload)
        message = str(ctx.exception)
        for needle in needles:
            self.assertIn(needle, message)
        return message

    # ── 单个 gate 的字段校验 ───────────────────────────────────────────────
    def test_unknown_key_is_rejected_rather_than_silently_defaulted(self):
        """`stage` 拼成单数不许静默按默认值生效 —— 这是 R1 的核心。"""
        self.assert_rejected({"gates": [gate_dict(stage=["local"])]}, "sample_gate", "stage")

    def test_empty_argv_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(argv=[])]}, "sample_gate", "argv")

    def test_non_string_argv_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(argv=["pnpm", 1])]}, "sample_gate", "argv")

    def test_unknown_kind_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(kind="smoke")]}, "sample_gate", "kind")

    def test_unknown_stage_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(stages=["nightly"])]}, "sample_gate", "stage")

    def test_empty_stages_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(stages=[])]}, "sample_gate", "stages")

    def test_unknown_platform_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(platforms=["plan9"])]}, "sample_gate", "platform")

    def test_non_positive_budget_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(budget_ms=0)]}, "sample_gate", "budget_ms")

    def test_empty_scopes_are_rejected(self):
        self.assert_rejected({"gates": [gate_dict(scopes=[])]}, "sample_gate", "scopes")

    def test_invalid_id_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(id="Lint-Fe")]}, "Lint-Fe")

    def test_duplicate_id_is_rejected(self):
        payload = {"gates": [gate_dict(), gate_dict(title="另一条")]}
        self.assert_rejected(payload, "sample_gate", "重复")

    # ── ci 与 ci_job 的双向一致性 ─────────────────────────────────────────
    def test_ci_stage_without_a_job_is_rejected(self):
        self.assert_rejected({"gates": [gate_dict(stages=["ci"])]}, "sample_gate", "ci_job")

    def test_ci_job_without_the_ci_stage_is_rejected(self):
        self.assert_rejected(
            {"gates": [gate_dict(stages=["local"], ci_job="frontend-check")]},
            "sample_gate",
        )

    def test_ci_stage_with_a_job_is_accepted(self):
        gate = self.load(
            {"gates": [gate_dict(stages=["local", "ci"], ci_job="frontend-check")]}
        )[0]
        self.assertEqual(gate.ci_job, "frontend-check")

    # ── 顶层结构 ───────────────────────────────────────────────────────────
    def test_empty_gate_list_is_rejected(self):
        self.assert_rejected({"gates": []}, "gates")

    def test_missing_file_is_rejected(self):
        with self.assertRaises(GateLedgerError) as ctx:
            load_gates(self.tmp / "ledger" / "nope.json")
        self.assertIn("缺失", str(ctx.exception))

    def test_unparseable_file_is_rejected(self):
        self.assert_rejected("{not json", "gates")

    def test_valid_declaration_round_trips_every_field(self):
        payload = {
            "gates": [
                gate_dict(
                    id="lint_fe",
                    title="eslint + tsc",
                    scopes=["src/*.ts", "src/**/*.tsx"],
                    argv=["pnpm", "lint:fe"],
                    kind="lint",
                    stages=["local", "commit", "push", "ci"],
                    ci_job="frontend-check",
                    platforms=["linux", "macos"],
                    budget_ms=180_000,
                    fix_hint="修 eslint",
                )
            ]
        }
        gate = self.load(payload)[0]
        self.assertEqual(gate.id, "lint_fe")
        self.assertEqual(tuple(gate.scopes), ("src/*.ts", "src/**/*.tsx"))
        self.assertEqual(gate.argv, ("pnpm", "lint:fe"))
        self.assertEqual(gate.kind, "lint")
        self.assertEqual(gate.stages, ("local", "commit", "push", "ci"))
        self.assertEqual(gate.ci_job, "frontend-check")
        self.assertEqual(gate.platforms, ("linux", "macos"))
        self.assertEqual(gate.budget_ms, 180_000)
        self.assertEqual(gate.fix_hint, "修 eslint")

    def test_defaults_apply_when_a_gate_declares_no_stages_or_platforms(self):
        """未声明时吃框架默认（本地 + commit；全平台）—— 首批 gate 全部显式声明，不靠它。"""
        entry = gate_dict()
        entry.pop("stages")
        gate = self.load({"gates": [entry]})[0]
        self.assertNotIn("ci", gate.stages)
        self.assertEqual(gate.platforms, PLATFORMS)


EXPECTED_GATES = {
    # id: (argv, kind, stages, ci_job, platforms, budget_ms)
    "lint_fe": (
        ("pnpm", "lint:fe"), "lint", ("local", "commit", "ci"),
        "frontend-check", ("linux", "macos", "windows"), 180_000,
    ),
    "lint_rust": (
        ("pnpm", "lint:rust"), "lint", ("local", "commit", "ci"),
        "backend-check", ("linux", "macos", "windows"), 600_000,
    ),
    "rust_check": (
        ("cargo", "check"), "lint", ("ci",),
        "backend-check", ("linux", "macos", "windows"), 900_000,
    ),
    "build_web": (
        ("pnpm", "build"), "lint", ("ci",),
        "frontend-build", ("linux", "macos", "windows"), 600_000,
    ),
    "test_fe": (
        ("pnpm", "test:fe"), "test", ("local", "push"),
        "", ("linux", "macos", "windows"), 300_000,
    ),
    "test_rust": (
        ("pnpm", "test:rust"), "test", ("local", "push", "ci"),
        "backend-test", ("linux", "macos", "windows"), 900_000,
    ),
    "test_host": (
        ("pnpm", "test:host"), "test", ("local", "push"),
        "", ("linux", "macos"), 300_000,
    ),
    "test_fe_coverage": (
        ("pnpm", "test:fe:coverage"), "test", ("ci", "manual"),
        "frontend-test", ("linux", "macos", "windows"), 600_000,
    ),
    "test_rust_coverage": (
        ("pnpm", "test:rust:coverage"), "test", ("ci", "manual"),
        "backend-coverage", ("linux", "macos", "windows"), 1_200_000,
    ),
    "build_host": (
        ("pnpm", "build:host"), "test", ("ci",),
        "java-host-check", ("linux", "macos"), 600_000,
    ),
}


class ShippedGatesTest(unittest.TestCase):
    """真实 gates.json 就是 AC13 的等价性对照表 —— 逐条固定，防止声明漂移。"""

    def setUp(self):
        self.gates = {g.id: g for g in load_gates()}

    def test_the_shipped_set_is_exactly_the_first_batch(self):
        self.assertEqual(set(self.gates), set(EXPECTED_GATES))

    def test_each_gate_matches_the_equivalence_table(self):
        for gid, (argv, kind, stages, ci_job, platforms, budget) in EXPECTED_GATES.items():
            with self.subTest(gate=gid):
                gate = self.gates[gid]
                self.assertEqual(tuple(gate.argv), argv)
                self.assertEqual(gate.kind, kind)
                self.assertEqual(gate.stages, stages)
                self.assertEqual(gate.ci_job, ci_job)
                self.assertEqual(tuple(gate.platforms), platforms)
                self.assertEqual(gate.budget_ms, budget)

    def test_every_gate_gives_a_fix_hint(self):
        missing = [g.id for g in self.gates.values() if not g.fix_hint]
        self.assertEqual(missing, [])

    def test_every_gate_id_is_unique_and_matches_the_pattern(self):
        import re

        for gate in self.gates.values():
            self.assertRegex(gate.id, r"^[a-z][a-z0-9_]*$")


class ScopeCoverageTest(unittest.TestCase):
    """每条 gate 的 scope 必须覆盖它实际依赖的输入 —— 漏一个输入 = 改它不再触发该门禁。

    这是 design D9 的落点：glob 引擎不支持 `{a,b}`，所以 scope 写展开形态，正确性由本表固定。
    """

    FRONTEND = (
        "src/app/App.tsx",
        "src/shared/utils/fileRef.ts",
        "src/main.jsx",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
        "tsconfig.app.json",
        "tsconfig.node.json",
        "vite.config.ts",
        "vitest.config.ts",
        ".eslintrc.cjs",
        ".prettierrc",
    )
    RUST = (
        "src-tauri/src/lib.rs",
        "src-tauri/src/git/mod.rs",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
        "src-tauri/build.rs",
    )
    HOST = ("tools/java-host/build.sh", "tools/java-host/test.sh")

    MUST_COVER = {
        "lint_fe": FRONTEND,
        "build_web": FRONTEND,
        "test_fe": FRONTEND,
        "test_fe_coverage": FRONTEND,
        "lint_rust": RUST,
        "rust_check": RUST,
        "test_rust": RUST,
        "test_rust_coverage": RUST + ("package.json",),
        "test_host": HOST,
        "build_host": HOST,
    }

    def test_declared_scopes_cover_every_required_input(self):
        gates = {g.id: g for g in load_gates()}
        for gid, inputs in self.MUST_COVER.items():
            for rel in inputs:
                with self.subTest(gate=gid, path=rel):
                    self.assertTrue(
                        repo.matches_any(gates[gid].scopes, rel),
                        f"{gid} 的 scope 未覆盖 {rel}",
                    )

    def test_declared_scopes_do_not_use_brace_expansion(self):
        """`core.repo` 的 glob 引擎不支持 `{a,b}` —— 写了会静默失配。"""
        for gate in load_gates():
            for scope in gate.scopes:
                with self.subTest(gate=gate.id, scope=scope):
                    self.assertNotIn("{", scope)
                    self.assertNotIn("}", scope)


class ContextCommandSetTest(unittest.TestCase):
    """AC13：改造前后「同一上下文实际跑的命令集合」逐条对得上。

    对照表就是 design §2 的「目标态映射」；这里把它变成可执行断言，防止 stages/kind
    的声明日后静默漂移（那会让 pre-push 多跑 lint、或让 `pnpm test` 不再只跑测试）。
    """

    @classmethod
    def setUpClass(cls):
        cls.registrations = registry.discover()

    def selected(self, stage, suite="all", source="any"):
        return select(self.registrations, stage, [], (), suite=suite, source=source)

    def command_ids(self, stage, suite="all", source="any"):
        return sorted(r.id for r in self.selected(stage, suite, source) if r.check is None)

    def in_process_count(self, stage, suite="all", source="any"):
        return sum(1 for r in self.selected(stage, suite, source) if r.check is not None)

    def test_pnpm_lint_is_the_lint_suite_at_local(self):
        self.assertEqual(self.command_ids("local", suite="lint"), ["lint_fe", "lint_rust"])

    def test_pnpm_test_is_the_test_suite_at_local(self):
        self.assertEqual(
            self.command_ids("local", suite="test"), ["test_fe", "test_host", "test_rust"]
        )

    def test_pnpm_check_is_the_union_at_local(self):
        self.assertEqual(
            self.command_ids("local"),
            ["lint_fe", "lint_rust", "test_fe", "test_host", "test_rust"],
        )
        # 15 条既有进程内判据 + 本次新增的 check_gate_topology
        self.assertEqual(self.in_process_count("local"), 16)

    def test_coverage_entry_is_the_manual_stage(self):
        self.assertEqual(
            self.command_ids("manual"), ["test_fe_coverage", "test_rust_coverage"]
        )

    def test_pre_push_stays_the_three_test_commands(self):
        self.assertEqual(
            self.command_ids("push"), ["test_fe", "test_host", "test_rust"]
        )

    def test_pre_commit_runs_the_lint_gates(self):
        self.assertEqual(self.command_ids("commit"), ["lint_fe", "lint_rust"])

    def test_ci_guards_job_stays_in_process_only(self):
        self.assertEqual(self.command_ids("ci", suite="lint", source="python"), [])
        self.assertEqual(self.in_process_count("ci", suite="lint", source="python"), 16)


if __name__ == "__main__":
    unittest.main()
