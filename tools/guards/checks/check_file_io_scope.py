"""文件 IO 必须按 Workspace 寻址（地址值对象 `WorkspaceSession`），不得回退到散参 / 旧编码。

## 第一性原理

文件读写的**地址 = 该文件所属 Workspace** = `WorkspaceSession`（`{ projectId, worktreePath }`，
`worktreePath === null` = 主 checkout）。后端由 `AppStateWrapper::resolve_workspace_target` **唯一解析**
出工作树根，调用方不传「任意 root 路径」。

历史病根是「按 `projectId` 寻址、按 `checkout` 作用」：补位的 `rootPath` 是**可选且默认错误**的
参数（主仓恒对、worktree 恒错），漏传即静默失效。本护栏把「地址必须是 workspace」从文档变成强制。

## 判据（三条，均确定性可复现）

- **A 唯一命令面**：8 个文件命令的原始 `invoke('…')` 只允许出现在
  `src/features/file/api/fileApi.ts`（WSL/Remote 与 Local 走同一后端命令，按 `ExecTarget` 路由）。
- **B 散参名退役**：命令面文件里不得再出现旧的 `rootPath` / `root_path` 散参名。
- **C 单一编码**：退役的 `:wt:` 编辑 tab 键编码 —— `resolveTabKey` / `parseProjectIdFromTabKey` /
  `buildWorktreeTabKey` 与 `shared/utils/tabKey` 模块 —— 不得回潮（tab 组键 = canonical `WorkspaceKey`）。

> 注：终端会话 cache key 使用自己的 `:wt:` 命名空间（`terminalCache` / strategies），与 Workspace
> 身份编码不是同一件事，本护栏不覆盖它（登记为独立命名空间）。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCAN_SCOPES = ("src/**/*.ts", "src/**/*.tsx")

FILE_COMMANDS = (
    "read_file_content",
    "write_file_content",
    "read_dir_tree",
    "create_new_file",
    "save_new_file",
    "create_directory",
    "delete_path",
    "rename_path",
)

INVOKE_RE = re.compile(
    r"invoke(?:\s*<[^>]*>)?\s*\(\s*['\"`](?P<cmd>" + "|".join(FILE_COMMANDS) + r")['\"`]"
)

# A：唯一允许原始 invoke 文件命令的文件
API_FILE = "src/features/file/api/fileApi.ts"
# B：命令面文件（不得出现旧散参名）
SCOPE_FILES = {
    API_FILE,
    "src/features/project/hooks/use-active-project/commandFactory.ts",
}
ROOT_PARAM_RE = re.compile(r"\brootPath\b|\broot_path\b")

# C：退役的 :wt: 编辑 tab 键编码
RETIRED_SYMBOL_RE = re.compile(
    r"\bresolveTabKey\b|\bparseProjectIdFromTabKey\b|\bbuildWorktreeTabKey\b"
)
RETIRED_MODULE = "shared/utils/tabKey"
# 只按 import 形态判定（注释/文档里提及退役模块名是合法的历史说明，不是回潮）
RETIRED_MODULE_RE = re.compile(
    r'''(?:from|import)\s*\(?\s*['"][^'"]*shared/utils/tabKey'''
)

GUARD = Guard(
    id="check_file_io_scope",
    title="文件 IO 按 Workspace 值对象寻址（唯一命令面 / 散参退役 / 单一编码）",
    scopes=SCAN_SCOPES,
    red_lines=(12,),
    docs="docs/domain-model.md",
    fix_hint=(
        "地址一律用 `WorkspaceSession`（首个参数，由 activeWorkspaceSession / tab.workspace 给出）；"
        "原始 invoke 只留在 fileApi.ts；编辑 tab 组键用 workspaceKeyOf（勿复活 tabKey.ts）"
    ),
)


def check(ctx: Context) -> GuardResult:
    files = sorted({p for scope in SCAN_SCOPES for p in ctx.glob(scope)})
    if not files:
        return GuardResult.broken("在 src/**/*.{ts,tsx} 下扫到 0 个文件 —— 口径失效", scanned=0)

    findings: list[Finding] = []
    for path in files:
        rel = ctx.rel(path)
        text = ctx.read(rel)

        # A：原始 invoke 文件命令只允许在唯一命令面
        if rel != API_FILE:
            for m in INVOKE_RE.finditer(text):
                findings.append(
                    Finding(
                        f"文件命令 invoke('{m.group('cmd')}') 只允许出现在唯一命令面 {API_FILE}"
                        "（其余一律经 fileApi 包装器 + workspace 地址）",
                        rel,
                        text.count("\n", 0, m.start()) + 1,
                    )
                )

        # B：命令面不得再有旧散参名
        if rel in SCOPE_FILES:
            for m in ROOT_PARAM_RE.finditer(text):
                findings.append(
                    Finding(
                        f"旧散参名 {m.group(0)!r} 已退役：地址改为 WorkspaceSession 的 `workspace` 参数",
                        rel,
                        text.count("\n", 0, m.start()) + 1,
                    )
                )

        # C：退役的 :wt: 编辑 tab 键编码
        for m in RETIRED_SYMBOL_RE.finditer(text):
            findings.append(
                Finding(
                    f"退役符号 {m.group(0)!r} 不得回潮（tab 组键 = canonical WorkspaceKey）",
                    rel,
                    text.count("\n", 0, m.start()) + 1,
                )
            )
        m = RETIRED_MODULE_RE.search(text)
        if m:
            findings.append(
                Finding(
                    f"退役模块 {RETIRED_MODULE!r} 不得回潮（tab 组键 = canonical WorkspaceKey）",
                    rel,
                    text.count("\n", 0, m.start()) + 1,
                )
            )

    metrics = f"{len(files)} 个 ts/tsx / 违规 {len(findings)}"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
