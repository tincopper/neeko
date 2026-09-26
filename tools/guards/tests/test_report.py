"""渲染 —— 扫描数必须出现在每次输出里，空转信号才可能被人看见。"""
from __future__ import annotations

import json
import unittest

from guards.core import report
from guards.core.contract import Finding, Guard, GuardResult
from guards.core.runner import Outcome


def outcome(result, guard_id="sample_guard") -> Outcome:
    return Outcome(
        guard=Guard(id=guard_id, title="标题", scopes=("src/**",), fix_hint="改法"),
        result=result,
    )


class TextTest(unittest.TestCase):
    def test_pass_line_carries_the_scan_count(self):
        text = report.render([outcome(GuardResult.passed(42, metrics="42 个文件"))], "text", "s")
        self.assertIn("scanned=42", text)
        self.assertIn("42 个文件", text)

    def test_violation_lists_findings_with_location(self):
        result = GuardResult.violated(3, [Finding("裸 font-family", "src/styles/a.css", 12)])
        text = report.render([outcome(result)], "text", "s")
        self.assertIn("src/styles/a.css:12: 裸 font-family", text)
        self.assertIn("修复：改法", text)

    def test_broken_guard_says_so_loudly(self):
        text = report.render([outcome(GuardResult.broken("口径失效"))], "text", "s")
        self.assertIn("护栏自身失效", text)
        self.assertIn("别把它当成「检查过了」", text)

    def test_summary_is_appended(self):
        text = report.render([outcome(GuardResult.passed(1))], "text", "6 条护栏：6 通过")
        self.assertTrue(text.rstrip().endswith("6 条护栏：6 通过"))


class GitHubTest(unittest.TestCase):
    def test_annotation_points_at_the_file_and_line(self):
        result = GuardResult.violated(3, [Finding("x", "src/a.ts", 7)])
        text = report.render([outcome(result)], "github-actions", "s")
        self.assertIn("::error file=src/a.ts,line=7::", text)

    def test_broken_guard_is_a_warning_not_an_error_annotation(self):
        """护栏坏了不是代码违规 —— 钉成 error 会把工具故障伪装成产品缺陷。"""
        text = report.render([outcome(GuardResult.broken("口径失效"))], "github-actions", "s")
        self.assertIn("::warning", text)
        self.assertIn("护栏自身失效", text)

    def test_control_sequences_in_message_are_neutralised(self):
        result = GuardResult.violated(3, [Finding("a::b\nc", "src/a.ts", 1)])
        text = report.render([outcome(result)], "github-actions", "s")
        annotation = [ln for ln in text.splitlines() if ln.startswith("::error")][0]
        self.assertNotIn("a::b\nc", annotation)
        self.assertIn("%0A", annotation)


class JsonTest(unittest.TestCase):
    def test_payload_is_stable_and_complete(self):
        payload = json.loads(
            report.render(
                [outcome(GuardResult.passed(2, metrics="m"), "a"),
                 outcome(GuardResult.violated(1, [Finding("f")]), "b")],
                "json",
                "s",
            )
        )
        self.assertEqual(payload["exit"], 1)
        self.assertEqual([g["id"] for g in payload["guards"]], ["a", "b"])
        self.assertEqual(payload["guards"][0]["scanned"], 2)


if __name__ == "__main__":
    unittest.main()
