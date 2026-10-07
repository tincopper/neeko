"""check_service_no_delivery_dep 用例。

判据：`src-tauri/src/git/services/**` 是**编排层**，只允许依赖端口（`WatcherEventSink` 等），
不得依赖交付机制（`tauri::AppHandle`）或其适配器（`AppHandleSink`）。注释里允许出现这些词
—— 注释是记录「为什么删」的地方。
"""
from __future__ import annotations

import unittest

from guards.checks import check_service_no_delivery_dep as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

PATH = "src-tauri/src/git/services/status.rs"


def run(test: unittest.TestCase, body: str) -> object:
    root = temp_repo(test)
    make_repo(root, {PATH: body})
    return subject.check(context(root))


class ServiceNoDeliveryDepTest(unittest.TestCase):
    def test_tauri_import_is_a_violation(self):
        result = run(self, "use tauri::AppHandle;\n\nfn f() {}\n")
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(len(result.findings), 1)

    def test_bare_app_handle_is_a_violation(self):
        result = run(self, "fn f(app: AppHandle) {}\n")
        self.assertEqual(result.verdict, VIOLATION)

    def test_app_handle_sink_adapter_is_a_violation(self):
        result = run(self, "let s = Arc::new(AppHandleSink::new(app.clone()));\n")
        self.assertEqual(result.verdict, VIOLATION)

    def test_port_only_code_passes(self):
        body = (
            "use crate::common::file::watcher::WatcherEventSink;\n"
            "pub async fn activate(sink: Arc<dyn WatcherEventSink>) {}\n"
        )
        self.assertEqual(run(self, body).verdict, PASS)

    def test_runtime_helper_name_is_not_a_false_positive(self):
        result = run(self, "let rt = AppRuntime::try_current_or_tauri();\n")
        self.assertEqual(result.verdict, PASS)

    def test_doc_comment_recording_the_removal_passes(self):
        result = run(self, "/// 不再收 `tauri::AppHandle`，改注入端口。\nfn f() {}\n")
        self.assertEqual(result.verdict, PASS)

    def test_string_literal_mention_passes(self):
        # 断言文案 / 日志里提到交付机制不算依赖（依赖指 use / 路径 / 类型引用）。
        result = run(self, 'let msg = "service must not use tauri::AppHandle";\n')
        self.assertEqual(result.verdict, PASS)

    def test_inline_comment_mention_passes(self):
        result = run(self, "let x = 1; // 不再用 AppHandle\n")
        self.assertEqual(result.verdict, PASS)

    def test_scanned_counts_files(self):
        root = temp_repo(self)
        make_repo(
            root,
            {
                "src-tauri/src/git/services/status.rs": "fn a() {}\n",
                "src-tauri/src/git/services/commit/service.rs": "fn b() {}\n",
            },
        )
        result = subject.check(context(root))
        self.assertGreaterEqual(result.scanned, 2)


if __name__ == "__main__":
    unittest.main()
