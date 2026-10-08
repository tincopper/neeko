"""check_nondeterministic_event_assertions 用例 —— 域级不变量的正例 / 反例 / 空转。

矩阵（护栏没有测试 = 没有护栏）：
1. 正例：入域文件 + 绝对零 → VIOLATION（行号正确）。
2. 反例·确定性：**未入域**文件 + 同样断言 → PASS（钉住确定性替身语义）。
3. 反例·差分：入域文件 + 与 baseline 比较 → PASS。
4. 反例·正向：入域文件 + `> 0` / `assert_ne!(n, 0)` → PASS。
5. 空转：空树 scanned == 0；非空树 scanned 计入真实文件数。
6. 逃生舱：`@nondeterministic-domain` 注解只扩大域，违规仍命中。
"""
from __future__ import annotations

import unittest

from guards.checks import check_nondeterministic_event_assertions as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

FIXTURE = "src-tauri/src/common/file/watcher/git_meta/tests/watcher.rs"
# 域入口（结构信号）：定义有界等待原语 ⇒ 文件进入非确定性域。
DOMAIN_HEADER = "fn wait_for_event() {}\n"


class NondeterministicEventAssertionTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, body: str, path: str = FIXTURE):
        make_repo(self.root, {path: body})
        return subject.check(context(self.root))

    def test_absolute_zero_in_domain_is_a_violation(self):
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn detects_index_change() {\n"
            "    assert_eq!(refs_changed.load(Ordering::SeqCst), 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 4)

    def test_reversed_literal_side_is_also_a_violation(self):
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn detects_index_change() {\n"
            "    assert_eq!(0, refs_changed.load(Ordering::SeqCst));\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_precise_set_count_in_domain_is_a_violation(self):
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn exact_once() {\n"
            "    assert_eq!(index_changed.load(Ordering::SeqCst), 1);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_assert_macro_absolute_zero_is_a_violation(self):
        """`assert!(observer == 0)` 与 `assert_eq!(observer, 0)` 同类，换宏不放过。"""
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn detects_index_change() {\n"
            "    assert!(refs_changed.load(Ordering::SeqCst) == 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 4)

    def test_assert_macro_inequality_is_allowed(self):
        """`assert!(observer != 0)` 是单向可达，放行。"""
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn reaches_event() {\n"
            "    assert!(refs_changed.load(Ordering::SeqCst) != 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_deterministic_fake_outside_domain_passes(self):
        """钉住 `conversation/manager.rs` 式假 adapter：无真实源 ⇒ 不入域。"""
        result = self.run_guard(
            "#[test]\n"
            "fn failures_do_not_touch_sibling_adapter() {\n"
            "    assert_eq!(calls_a.load(Ordering::SeqCst), 1);\n"
            "    assert_eq!(calls_b.load(Ordering::SeqCst), 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_differential_baseline_in_domain_passes(self):
        """差分式生命周期负向：delta == 0，与运行时基线比较。"""
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn unwatch_stops_delivering() {\n"
            "    let baseline = sink.count(FILE_CHANGED_EVENT);\n"
            "    assert_eq!(sink.count(FILE_CHANGED_EVENT) - baseline, 0);\n"
            "    assert_eq!(sink.count(FILE_CHANGED_EVENT), baseline);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_positive_reachability_in_domain_passes(self):
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn reaches_event() {\n"
            "    assert_ne!(n.load(Ordering::SeqCst), 0);\n"
            "    assert!(sink.count(FILE_CHANGED_EVENT) > 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_escape_hatch_widens_domain_and_does_not_exempt(self):
        result = self.run_guard(
            "// @nondeterministic-domain (未来接入进程 / 时钟源)\n"
            "#[test]\n"
            "fn process_callback_fires() {\n"
            "    assert_eq!(calls.load(Ordering::SeqCst), 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_comment_examples_are_ignored(self):
        """注释里的示例不得被当成代码违规。"""
        result = self.run_guard(
            DOMAIN_HEADER
            + "#[test]\n"
            "fn doc_example() {\n"
            "    // assert_eq!(refs_changed.load(Ordering::SeqCst), 0);\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_empty_tree_scans_zero_files(self):
        """空转：框架对 scanned == 0 判 ERROR；guard 如实上报 0。"""
        result = subject.check(context(self.root))
        self.assertEqual(result.scanned, 0)

    def test_scanned_counts_real_files(self):
        make_repo(
            self.root,
            {
                "src-tauri/src/a.rs": "#[test]\nfn ok() {}\n",
                "src-tauri/tests/b.rs": "#[test]\nfn ok() {}\n",
            },
        )
        result = subject.check(context(self.root))
        self.assertEqual(result.scanned, 2)

    def test_clean_in_domain_tree_passes(self):
        make_repo(self.root, {FIXTURE: DOMAIN_HEADER + "#[test]\nfn ok() {}\n"})
        self.assertEqual(subject.check(context(self.root)).verdict, PASS)


if __name__ == "__main__":
    unittest.main()
