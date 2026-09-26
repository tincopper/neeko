"""平台 import 门控护栏用例（回归来源：fonts.rs 的 unused_imports 只在 Linux/Windows 暴露）。"""
from __future__ import annotations

import pathlib
import unittest

from guards.checks import check_platform_imports as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

SCOPE_FILE = "src-tauri/src/common/utils/fonts.rs"


class PlatformImportsTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, body: str):
        make_repo(self.root, {SCOPE_FILE: body})
        return subject.check(context(self.root))

    def test_ungated_use_used_only_in_platform_block_is_a_violation(self):
        result = self.run_guard(
            "use std::collections::BTreeSet;\n"
            "\n"
            '#[cfg(target_os = "macos")]\n'
            "fn collect() -> BTreeSet<u32> {\n"
            "    BTreeSet::new()\n"
            "}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("BTreeSet", result.findings[0].message)
        self.assertEqual(result.findings[0].line, 1)

    def test_same_condition_gate_on_the_use_is_accepted(self):
        result = self.run_guard(
            '#[cfg(target_os = "macos")]\n'
            "use std::collections::BTreeSet;\n"
            "\n"
            '#[cfg(target_os = "macos")]\n'
            "fn collect() -> BTreeSet<u32> {\n"
            "    BTreeSet::new()\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_use_also_reachable_off_the_platform_path_is_accepted(self):
        result = self.run_guard(
            "use std::collections::BTreeSet;\n"
            "\n"
            '#[cfg(target_os = "macos")]\n'
            "fn mac() -> BTreeSet<u32> {\n"
            "    BTreeSet::new()\n"
            "}\n"
            "\n"
            "fn every_one() -> BTreeSet<u32> {\n"
            "    BTreeSet::new()\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_file_without_platform_cfg_is_skipped_without_noise(self):
        result = self.run_guard("use std::path::Path;\n\nfn p(x: &Path) {}\n")
        self.assertEqual(result.verdict, PASS)
        self.assertEqual(result.scanned, 1)

    def test_braced_use_list_is_checked_per_name(self):
        result = self.run_guard(
            "use std::path::{Path, PathBuf};\n"
            "\n"
            '#[cfg(windows)]\n'
            "fn w(a: &Path, b: PathBuf) {}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(len(result.findings), 1, result.findings)
        self.assertIn("Path", result.findings[0].message)

    def test_alias_is_judged_by_the_bound_name(self):
        """`use a::b as C` 引入的名字是 C —— 按 b 判会永远查不到使用点。"""
        result = self.run_guard(
            "use std::path::Path as MyPath;\n"
            "\n"
            '#[cfg(target_os = "windows")]\n'
            "fn w(a: &MyPath) {}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("MyPath", result.findings[0].message)

    def test_glob_use_is_never_flagged(self):
        """glob 没有具体符号名，逐个符号判定无从下手 —— 报出来只能是噪音。"""
        result = self.run_guard(
            "use std::collections::*;\n"
            "\n"
            '#[cfg(target_os = "macos")]\n'
            "fn m() -> BTreeSet<u32> {\n"
            "    BTreeSet::new()\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_use_after_a_gated_block_is_left_alone(self):
        """刻意保守：cfg 在 use 上方 1-3 行内就不报，即使那个 cfg 门控的是别的 item。

        漏报可靠 CI 三平台矩阵兜住，误报会让整条护栏被人关掉 —— 方向上选宁可少报。
        """
        result = self.run_guard(
            '#[cfg(unix)]\n'
            "mod gated { pub fn a() {} }\n"
            "use std::path::Path;\n"
            "\n"
            "fn free(p: &Path) {}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_dangling_cfg_at_eof_is_not_fatal(self):
        result = self.run_guard(
            "use std::path::Path;\nfn b(p: &Path) {}\n#[cfg(unix)]\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_blank_lines_and_stacked_attributes_between_cfg_and_item(self):
        result = self.run_guard(
            "use std::collections::BTreeSet;\n"
            "fn free(x: BTreeSet<u32>) {}\n"
            "\n"
            "#[cfg(unix)]\n"
            "\n"
            "#[inline]\n"
            "fn mac() {}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_block_opening_brace_far_below_the_signature(self):
        result = self.run_guard(
            "use std::path::Path;\n"
            "fn b(p: &Path) {}\n"
            "\n"
            '#[cfg(windows)]\n'
            "fn win(\n"
            "    a: &Path,\n"
            ") {\n"
            "    let _ = a;\n"
            "}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_unconditional_use_that_is_simply_unused_is_not_this_guard(self):
        """完全没使用是 unused_imports 的活，这里再报一遍就是两处口径重复。"""
        result = self.run_guard(
            "use std::path::Path;\n"
            "\n"
            '#[cfg(unix)]\n'
            "fn a() {}\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_blank_line_between_stacked_attribute_and_item_still_finds_the_item(self):
        """`#[cfg]` + `#[inline]` + 空行 + `fn` —— 空行必须被跳过而不是把 item 丢掉。"""
        result = self.run_guard(
            "use std::collections::BTreeSet;\n"
            "fn free(x: BTreeSet<u32>) {}\n"
            "\n"
            "#[cfg(unix)]\n"
            "#[inline]\n"
            "\n"
            "fn mac() { let _ = 1; }\n"
        )
        self.assertEqual(result.verdict, PASS, result.findings)

    def test_unreadable_file_is_skipped_without_breaking_the_scan(self):
        class Exploding:
            def rel(self, path):
                return str(path)

            def read_tolerant(self, rel):
                raise OSError("EACCES")

        self.assertEqual(subject.scan_file(Exploding(), pathlib.Path("/x.rs")), [])


if __name__ == "__main__":
    unittest.main()
