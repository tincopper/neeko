"""字体护栏用例 —— 重点是「种一个违规必须被抓到」，否则恒绿与失效不可区分。"""
from __future__ import annotations

import unittest

from guards.checks import check_font_family_guard as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo


class FontGuardTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_bare_font_family_is_a_violation(self):
        result = self.run_guard({"src/styles/app.css": "a { font-family: Helvetica, sans; }\n"})
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 1)
        self.assertIn("Helvetica", result.findings[0].message)

    def test_role_variable_is_allowed(self):
        for value in ("var(--font-mono)", "var(--font-ui) !important", "inherit"):
            with self.subTest(value=value):
                result = self.run_guard(
                    {"src/styles/app.css": f"a {{ font-family: {value}; }}\n"}
                )
                self.assertEqual(result.verdict, PASS, value)

    def test_font_face_sources_are_exempt_but_still_counted(self):
        result = self.run_guard({"src/styles/nerd-font.css": '@font-face { font-family: "NF"; }\n'})
        self.assertEqual(result.verdict, PASS)
        self.assertEqual(result.scanned, 1)

    def test_empty_scan_set_is_reported_as_nothing_checked(self):
        """目录不存在时 scanned=0 —— 由框架判失效，而不是打印 OK。"""
        result = subject.check(context(self.root))
        self.assertEqual(result.scanned, 0)


if __name__ == "__main__":
    unittest.main()
