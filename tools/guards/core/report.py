"""渲染 —— 结论 → 输出。guard 永远不自己 print。

三种格式的分工：`text` 给人（本地 + CI 日志），`github-actions` 给 PR（把违规钉回
diff 行），`json` 给工具。退出码由 runner 决定，与格式无关。
"""
from __future__ import annotations

import json

from .contract import ERROR, EXIT_GUARD_ERROR, EXIT_OK, EXIT_VIOLATION, PASS, VIOLATION

FORMATS = ("text", "github-actions", "json")


def exit_code(outcomes) -> int:
    if any(o.result.verdict == ERROR for o in outcomes):
        return EXIT_GUARD_ERROR
    if any(o.result.verdict == VIOLATION for o in outcomes):
        return EXIT_VIOLATION
    return EXIT_OK


def render(outcomes, fmt: str, summary: str) -> str:
    if fmt == "json":
        return _render_json(outcomes, summary)
    lines: list[str] = []
    for o in outcomes:
        lines.extend(_render_one_text(o) if fmt != "github-actions" else _render_one_gh(o))
    lines.append("")
    lines.append(summary)
    return "\n".join(lines)


_MARK = {PASS: "ok  ", VIOLATION: "FAIL", ERROR: "ERR!"}


def _render_one_text(o):
    r = o.result
    budget = o.guard.budget_ms
    over = "!" if r.verdict != ERROR and o.duration_ms > budget else " "
    out = [
        f"{_MARK[r.verdict]}  {o.id:<34} scanned={r.scanned:<5} {o.duration_ms:>5}ms/{budget:,}ms{over}  {r.metrics}"
    ]
    if r.error:
        out.append(f"      护栏自身失效：{r.error}")
        out.append("      这不是被检查代码的问题 —— 修护栏，别把它当成「检查过了」。")
        return out
    if r.findings:
        out.append(f"      {o.guard.title}")
        for f in r.findings:
            out.append(f"        - {f.as_text()}")
        if o.guard.fix_hint:
            out.append(f"      修复：{o.guard.fix_hint}")
    return out


def _annotation(level: str, message: str, file: str = "", line: int = 0) -> str:
    attrs = ""
    if file:
        attrs = f" file={file}" + (f",line={line}" if line else "")
    safe = message.replace("\n", "%0A").replace("::", "–")
    return f"::{level}{attrs}::{safe}"


def _render_one_gh(o):
    r = o.result
    if r.verdict == PASS:
        return _render_one_text(o)
    lines = [f"::group::{o.id} — {r.verdict}"]
    lines.extend(_render_one_text(o))
    lines.append("::endgroup::")
    if r.verdict == ERROR:
        # 坏掉的护栏没有 findings —— 只藏在可折叠的 ::group:: 里的话，
        # 「护栏静默失效」在 PR 上就完全不可见，正是这套框架要拦的那类失效。
        lines.append(_annotation("warning", f"{o.id}: 护栏自身失效 — {r.error}"))
        return lines
    for f in r.findings:
        lines.append(_annotation("error", f"{o.id}: {f.as_text()}", f.file, f.line))
    return lines


def _render_json(outcomes, summary):
    return json.dumps(
        {
            "exit": exit_code(outcomes),
            "summary": summary,
            "guards": [
                {
                    "id": o.id,
                    "title": o.guard.title,
                    "verdict": o.result.verdict,
                    "redLines": list(o.guard.red_lines),
                    "stages": list(o.guard.stages),
                    "scanned": o.result.scanned,
                    "durationMs": o.duration_ms,
                    "budgetMs": o.guard.budget_ms,
                    "metrics": o.result.metrics,
                    "error": o.result.error,
                    "findings": [
                        {"file": f.file, "line": f.line, "message": f.message}
                        for f in o.result.findings
                    ],
                }
                for o in outcomes
            ],
        },
        indent=2,
        ensure_ascii=False,
    )
