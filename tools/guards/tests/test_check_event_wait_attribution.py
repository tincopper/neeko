"""check_event_wait_attribution 用例。

判据 1：`impl CollectingSink` 的公开方法必须接 `workspace_key`（观测口归属化）。
判据 2：除观测口实现文件外，不得手写「循环 + sink 查询」的等待原语（等待原语单点）。
两条判据各自配正反例：反例证明能抓到事故形态，正例证明不误伤既有写法。
"""
from __future__ import annotations

import unittest

from guards.checks import check_event_wait_attribution as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

SINK = "src-tauri/src/common/file/watcher/sink.rs"
TEST_FILE = "src-tauri/src/git/services/status.rs"


def run(test: unittest.TestCase, files: dict) -> object:
    root = temp_repo(test)
    make_repo(root, files)
    return subject.check(context(root))


def impl_with(method: str) -> str:
    return f"impl CollectingSink {{\n{method}\n}}\n"


class UnattributedQueryTest(unittest.TestCase):
    """判据 1：无 key 的观测口查询就是弱谓词的原材料。"""

    def test_count_without_key_is_a_violation(self):
        body = impl_with("    pub(crate) fn count(&self, name: &str) -> usize {\n        0\n    }")
        result = run(self, {SINK: body})
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("workspace_key", result.findings[0].message)

    def test_event_names_without_key_is_a_violation(self):
        body = impl_with("    pub(crate) fn event_names(&self) -> Vec<String> {\n        Vec::new()\n    }")
        self.assertEqual(run(self, {SINK: body}).verdict, VIOLATION)

    def test_keyed_query_passes(self):
        body = impl_with(
            "    pub(crate) fn count_for(&self, workspace_key: &str, name: &str) -> usize {\n"
            "        0\n"
            "    }"
        )
        self.assertEqual(run(self, {SINK: body}).verdict, PASS)

    def test_indented_impl_is_detected_too(self):
        # 真实形态：观测口住在 `#[cfg(test)] mod test_support` 里 ⇒ `impl` 恒缩进 4 格。
        # 判据必须允许缩进，否则它在真实文件上永远不触发（写这条时实测到的洞）。
        body = (
            "mod test_support {\n"
            "    impl CollectingSink {\n"
            "        pub(crate) fn event_names(&self) -> Vec<String> {\n"
            "            Vec::new()\n"
            "        }\n"
            "    }\n"
            "}\n"
        )
        self.assertEqual(run(self, {SINK: body}).verdict, VIOLATION)

    def test_constructor_is_exempt(self):
        body = impl_with("    pub(crate) fn new() -> Arc<Self> {\n        Arc::new(Self::default())\n    }")
        self.assertEqual(run(self, {SINK: body}).verdict, PASS)

    def test_trait_impl_block_is_not_the_observation_surface(self):
        # `impl WatcherEventSink for CollectingSink` 的 `emit` 不是查询，不该被误判。
        body = "impl WatcherEventSink for CollectingSink {\n    fn emit(&self, event: WatcherEvent<'_>) {}\n}\n"
        self.assertEqual(run(self, {SINK: body}).verdict, PASS)


class HandRolledWaitTest(unittest.TestCase):
    """判据 2：等待原语单点，且必须带单元 key。"""

    WEAK_WAIT = (
        "fn wait_for_sink_event(sink: &CollectingSink, timeout: Duration) -> bool {\n"
        "    let deadline = Instant::now() + timeout;\n"
        "    while Instant::now() < deadline {\n"
        "        if !sink.names_for(&key).is_empty() { return true; }\n"
        "        std::thread::sleep(Duration::from_millis(25));\n"
        "    }\n"
        "    false\n"
        "}\n"
    )

    def test_hand_rolled_sink_polling_outside_the_sink_module_is_a_violation(self):
        result = run(self, {TEST_FILE: self.WEAK_WAIT})
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("wait_for_unit_event", result.findings[0].message)

    def test_same_code_inside_the_sink_module_is_allowed(self):
        # 等待原语本体就住在这里（`wait_for_unit_event`），它是「循环 + 查询」的合法宿主。
        self.assertEqual(run(self, {SINK: self.WEAK_WAIT}).verdict, PASS)

    def test_polling_a_manager_snapshot_is_not_the_sink_surface(self):
        body = (
            "fn wait_for_snapshot(manager: &WatcherManager, unit: &WorkspaceRef) -> bool {\n"
            "    loop {\n"
            "        if manager.snapshot(unit).is_some() { return true; }\n"
            "        std::thread::sleep(Duration::from_millis(25));\n"
            "    }\n"
            "}\n"
        )
        self.assertEqual(run(self, {TEST_FILE: body}).verdict, PASS)

    def test_keyed_query_outside_a_loop_is_not_polling(self):
        body = (
            "fn counts(sink: &CollectingSink, key: &str) -> usize {\n"
            "    sink.count_for(key, FILE_CHANGED_EVENT)\n"
            "}\n"
        )
        self.assertEqual(run(self, {TEST_FILE: body}).verdict, PASS)

    def test_commented_out_weak_wait_passes(self):
        # 注释是记录「为什么删」的地方：抄一段旧实现进注释不算违规。
        commented = "".join(f"// {line}\n" for line in self.WEAK_WAIT.splitlines())
        self.assertEqual(run(self, {TEST_FILE: commented}).verdict, PASS)


class ScannedTest(unittest.TestCase):
    def test_scanned_counts_rust_files(self):
        result = run(
            self,
            {
                "src-tauri/src/git/services/status.rs": "fn a() {}\n",
                "src-tauri/src/common/file/watcher/sink.rs": "fn b() {}\n",
            },
        )
        self.assertGreaterEqual(result.scanned, 2)


if __name__ == "__main__":
    unittest.main()
