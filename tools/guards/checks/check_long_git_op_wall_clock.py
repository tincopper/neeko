"""禁止给长 git 操作（push / fetch / pull / commit）包前端墙钟。

第一性原理：这四个操作的耗时由 pre-push/pre-commit hook 与网络决定、**没有上界**。
前端 `withTimeout` 到点只会 reject：既把「正常慢」误判成失败，**也不杀后端进程**（单飞槽
继续被占，远端状态未知）。2026-10-01 事故：pre-push 跑两套测试约 3 分钟，30s 上限先弹失败。

判据：源码里出现 `withTimeout(` 且**首个实参**是长 git 操作调用
（`push` / `pull` / `fetch` / `commitFiles`，可带 `commands.` / `gitApi.` 前缀）⇒ 违规。
本地快操作（`stageFiles` / `discardFiles` 等）的 `withTimeout` 放行。

覆盖边界（写清楚，避免误以为它管全）：
- 只看「首个实参是**直接调用**」的形态；`withTimeout(op(), …)` 这类经变量间接的调用无法
  静态判定，不在射程内 —— 约束它靠 `runGitConsoleOp` 单点编排与评审。
- 测试文件（`__tests__/` 与 `*.test.ts(x)`）豁免：它们可能需要 mock + 包超时来验证其它行为。
- 裸 `fetch(` 会与 WHATWG fetch 混淆，本仓 git 取数统一走 `commands.fetch` / `gitApi.fetch`，
  因此 `fetch` 只在带限定前缀时匹配。

机制详解：`.trellis/spec/backend/git-domain.md`「长操作超时策略与 Console 可见性」。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src/**/*.ts", "src/**/*.tsx")
# `\s*` 允许跨行：格式化后的多行 `withTimeout(\n  push(…),` 也要命中。
RE_LONG_OP_WITH_TIMEOUT = re.compile(
    r"withTimeout\s*\(\s*(?:(?:commands|gitApi)\s*\.\s*)?"
    r"(commitFiles|push|pull|fetch)\s*\(",
)

GUARD = Guard(
    id="check_long_git_op_wall_clock",
    title="长 git 操作（push/pull/fetch/commit）不得包前端墙钟",
    scopes=SCOPES,
    docs=".trellis/spec/backend/git-domain.md",
    fix_hint=(
        "统一走 `features/git/api/gitConsoleRun.ts` 的 runGitConsoleOp / beginGitConsoleRun"
        "（无墙钟 + 可取消 + Console 可见）；仅 stage/discard 等本地快操作保留 withTimeout"
    ),
)


def _is_test_file(rel: str) -> bool:
    return "/__tests__/" in rel or rel.endswith(".test.ts") or rel.endswith(".test.tsx")


def check(ctx: Context) -> GuardResult:
    files: list = []
    for scope in SCOPES:
        files.extend(ctx.glob(scope))

    findings: list[Finding] = []
    exempted = 0
    for path in files:
        rel = ctx.rel(path)
        if _is_test_file(rel):
            exempted += 1
            continue
        text = ctx.read(rel)
        for match in RE_LONG_OP_WITH_TIMEOUT.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            findings.append(
                Finding(
                    f"长 git 操作 `{match.group(1)}` 被 withTimeout 包了墙钟 —— "
                    "正常慢会被误判失败且不杀进程",
                    rel,
                    line,
                )
            )

    metrics = f"{len(files)} 个 ts/tsx（豁免测试 {exempted}）/ {len(findings)} 处墙钟"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
