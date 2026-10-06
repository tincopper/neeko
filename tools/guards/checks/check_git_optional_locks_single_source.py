"""git 只读语义（`GIT_OPTIONAL_LOCKS=0`）只能由执行层单点表达。

## 第一性原理

不变量：**读 git 不得取 optional lock / 不得 refresh `.git/index`**（否则与 IDE / 用户
手工 git 争 `.git/index.lock`，实测挡住过用户 `git commit`，2026-09-24）。

正确机制已收敛到执行层——`common/executor/env_defaults.rs` 的默认环境表，经
`core::exec` facade（Local 同步桥）与 `common::git::transport`（Local/WSL/SSH 三端）
两处 `with_default_env` 注入。但这条不变量在历史上**已复发 4 次**：

1. 调用点漏传 opts（`operations/info.rs` / `worktree.rs`）；
2. `status_worker` 的 `--no-optional-locks` + 老 git 回退分支；
3. `readonly_opts()` / `READONLY_ENV` 逐点注入（第 3 份副本）；
4. `status_worker/collapsed_probe.rs` 又留了一处 `--no-optional-locks`（第 4 处，且与
   "已退役" 的记录矛盾）。

每次都靠"纪律 + 文档"修复，每次都长回来 ⇒ 根因不是某处冗余，而是**同一语义可以被多处
独立表达，且没有任何机器拦住**。本护栏把"单一源"从文档变成**强制**。

## 判据（刻意选最简、显然正确的形式）

该字面量在整个 `src-tauri/{src,tests}` 的 `.rs` 中**只允许出现在一个文件**里——
`common/executor/env_defaults.rs`（数据表 + 其单测）。**注释也不允许出现**：注释要说明该
语义时，请指向单一源文件（`common/executor/env_defaults.rs`），不要复述字面量。

为什么不剥离注释后再匹配：那需要自写 Rust 词法扫描器（行/块注释、字符串、原始字符串、
字符与生命周期的区分），是持续维护与漏报的来源；而“单文件唯一”这条更严、更易验证的规则
连扫描器都不需要。`grep GIT_OPTIONAL_LOCKS` 全仓只剩一个文件，本身就是最好的可读性。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src-tauri/src/**/*.rs", "src-tauri/tests/**/*.rs")

# 唯一允许出现这些字面量的文件（数据表 + 其单测）。
ALLOWED_FILE = "src-tauri/src/common/executor/env_defaults.rs"

# 禁止的字面量：环境变量名、等价的 CLI 标志、旧 config 拼法。
FORBIDDEN = (
    re.compile(r"GIT_OPTIONAL_LOCKS"),
    re.compile(r"--no-optional-locks"),
    re.compile(r"optionalLocks"),
)

GUARD = Guard(
    id="check_git_optional_locks_single_source",
    title="git 只读语义只能单点表达（字面量仅允许 env_defaults.rs，含注释）",
    scopes=SCOPES,
    red_lines=(1,),
    docs=".trellis/spec/backend/git-domain.md",
    fix_hint=(
        "不要在任何 .rs（含注释）复述该字面量：只读语义由 common/executor/env_defaults.rs 的"
        "默认环境表经 core::exec 与 common::git::transport 单点注入；注释请指向该文件"
    ),
)


def check(ctx: Context) -> GuardResult:
    files = sorted({p for scope in SCOPES for p in ctx.glob(scope)})
    findings = []
    for path in files:
        rel = ctx.rel(path)
        if rel == ALLOWED_FILE:
            continue
        text = ctx.read(rel)
        for pattern in FORBIDDEN:
            for m in pattern.finditer(text):
                findings.append(
                    Finding(
                        f"只读语义字面量 {m.group(0)!r} 只允许出现在单一源 {ALLOWED_FILE}"
                        "（注释里也不要复述，指向该文件即可）",
                        rel,
                        text.count("\n", 0, m.start()) + 1,
                    )
                )

    metrics = f"{len(files)} 个 .rs / 违规 {len(findings)}"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
