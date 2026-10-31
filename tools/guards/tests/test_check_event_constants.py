"""事件名常量镜像护栏（`check_event_constants`）用例。"""
from __future__ import annotations

import unittest

from guards.checks import check_event_constants as subject
from guards.core.contract import ERROR, PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

RUST_EVENTS = "src-tauri/src/agent/team/events.rs"
RUST_BROWSER = "src-tauri/src/browser/events.rs"
TS_EVENTS = "src/shared/events.ts"


def rust_const(name: str, literal: str, public: bool = True) -> str:
    prefix = "pub " if public else ""
    return f'{prefix}const {name}: &str = "{literal}";\n'


def ts_const(name: str, literal: str) -> str:
    return f"export const {name} = '{literal}';\n"


class EventConstantsTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, rust: dict, ts: str):
        make_repo(self.root, {**rust, TS_EVENTS: ts})
        return subject.check(context(self.root))

    def test_mirrored_pairs_pass(self):
        result = self.run_guard(
            {RUST_EVENTS: rust_const("TEAM_EVENT", "agent-team://event")},
            ts_const("AGENT_TEAM_EVENT", "agent-team://event"),
        )
        self.assertEqual(result.verdict, PASS)
        self.assertIn("Rust 1", result.metrics)

    def test_a_rust_only_channel_is_a_violation_naming_the_constant(self):
        """Rust 有、TS 没有 ⇒ 前端永远收不到。文案必须带常量名，否则修的人要自己找。"""
        result = self.run_guard(
            {RUST_EVENTS: rust_const("TEAM_EVENT", "agent-team://event")},
            ts_const("AGENT_CHAT_EVENT", "agent-chat://event"),
        )
        self.assertEqual(result.verdict, VIOLATION)
        message = " ".join(f.message for f in result.findings)
        self.assertIn("TEAM_EVENT", message)
        self.assertIn("agent-team://event", message)

    def test_a_ts_only_channel_is_a_violation(self):
        """TS 有、Rust 没有 ⇒ 前端监听一个后端从未 emit 的通道（红线 14 同型）。"""
        result = self.run_guard(
            {RUST_EVENTS: rust_const("TEAM_EVENT", "agent-team://event")},
            ts_const("AGENT_TEAM_EVENT", "agent-team://event")
            + ts_const("GHOST_EVENT", "ghost://event"),
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("GHOST_EVENT" in f.message for f in result.findings), result.findings)

    def test_the_same_constant_name_with_a_different_value_is_a_violation(self):
        """手改一处的典型形态：两侧名字一样，值不一样（集合判据看不出来，靠 A3）。"""
        result = self.run_guard(
            {RUST_EVENTS: rust_const("TEAM_EVENT", "agent-team://event")},
            ts_const("TEAM_EVENT", "agent-team://changed"),
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("A3" in f.message for f in result.findings), result.findings)

    def test_a_different_naming_convention_still_passes(self):
        """两侧命名约定可以不同（Rust `EVENT_BROWSER_*` vs TS `BROWSER_*_EVENT`）——
        契约是**字面量**，不是标识符。这条用例把「不做名字配对」这个决定钉住。"""
        result = self.run_guard(
            {RUST_BROWSER: rust_const("EVENT_BROWSER_LOADING", "browser://loading")},
            ts_const("BROWSER_LOADING_EVENT", "browser://loading"),
        )
        self.assertEqual(result.verdict, PASS)

    def test_non_event_urls_and_schemeless_names_are_out_of_scope(self):
        """边界用例：业务 URL（`https://`）与无协议事件名（`file-changed`）不在判据内。

        前者靠「名字必须含 EVENT」排除，后者靠「值必须带 `://`」排除 —— 两条都是**刻意**的
        边界（见模块 docstring），不是漏扫。
        """
        rust = (
            rust_const("REGISTRY_BASE_URL", "https://registry.example/v1")
            + rust_const("TEAM_EVENT", "agent-team://event")
            + 'pub const FILE_CHANGED_EVENT: &str = "file-changed";\n'
        )
        result = self.run_guard(
            {RUST_EVENTS: rust},
            ts_const("AGENT_TEAM_EVENT", "agent-team://event"),
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_a_non_public_const_is_ignored(self):
        """非 `pub` 常量不是对外契约（域内字面量 / 测试夹具），不参与比对。"""
        result = self.run_guard(
            {
                RUST_EVENTS: rust_const("TEAM_EVENT", "agent-team://event")
                + rust_const("PRIVATE_CHANNEL_EVENT", "private://x", public=False)
            },
            ts_const("AGENT_TEAM_EVENT", "agent-team://event"),
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_zero_rust_constants_is_an_infra_failure(self):
        """扫描集为空 = 口径失效（常量形态变了），报 ERROR 而不是 PASS。"""
        result = self.run_guard(
            {RUST_EVENTS: 'pub const TEAM_EVENT: String = "agent-team://event".into();\n'},
            ts_const("AGENT_TEAM_EVENT", "agent-team://event"),
        )
        self.assertEqual(result.verdict, ERROR)
        self.assertIn("0 个", result.error)

    def test_zero_ts_constants_is_an_infra_failure(self):
        result = self.run_guard(
            {RUST_EVENTS: rust_const("TEAM_EVENT", "agent-team://event")}, ""
        )
        self.assertEqual(result.verdict, ERROR)


if __name__ == "__main__":
    unittest.main()
