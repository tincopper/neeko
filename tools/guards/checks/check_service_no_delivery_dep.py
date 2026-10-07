"""git 服务层禁止依赖交付机制 —— 钉住依赖倒置的结构边界。

第一性原理：`git/services/**` 是**编排层**（`activate` / `read_unit_status` / `wait_status_fresh`
等），只应依赖**端口**（`WatcherEventSink`、`RepoRef`…），不应依赖**交付适配器**
（`tauri::AppHandle` → `AppHandleSink`）。一旦服务层自己 `new AppHandleSink(app.clone())`，
高层就依赖了低层实现细节：`activate` 无法在无 GUI 的 `cargo test` 里被驱动，编排分支
（Local 挂载 vs WSL/SSH pull）成了最没测试覆盖的地方 —— 而它恰是「远端 Changes 面板永远
Loading」那次回归的发生地。

修复方式是把适配器的构造留在**命令边界**（`git/commands/query.rs`），服务层改收
`Arc<dyn WatcherEventSink>`。本护栏防止它被「顺手又接回来」。

注释里允许出现这些名字 —— 注释是记录「为什么删」的地方（删掉记录反而会让它被重新发明）。

已知边界（诚实声明）：字符串剥离是**行级**启发式 —— 跨行字符串（`"…\n…"`）的内容行不会被剥，
本仓 `git/services/**` 无跨行字符串，命中即按真实依赖处理。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPE = "src-tauri/src/git/services/**/*.rs"

# 交付机制：`tauri::` 路径（含 `use tauri::…`）与 `AppHandle` / `AppHandleSink`（`AppHandle`
# 后缀式覆盖后者）。`AppRuntime::try_current_or_tauri()` 不含 `tauri::` 也不含 `AppHandle`，
# 不会误伤。
#
# 判定只看**代码 token**：先剥字符串字面量与行内注释再匹配 —— 「不得依赖」指 use/路径/类型
# 引用，断言文案或日志里提到 `AppHandle` 不算违规（实测被误伤过一次）。剥离只会减少命中，
# 不会漏掉真实依赖（依赖不可能出现在字符串里）。
DELIVERY_RE = re.compile(r"tauri\s*::|\bAppHandle(Sink)?\b")
# 注释行按空行处理（行号保持不变，Finding 要能钉回 diff 行）。
COMMENT_ONLY = re.compile(r"^\s*(//|/\*|\*)")
# 字符串字面量（含转义）与行内注释：剥离后只剩代码 token。
STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"')
INLINE_COMMENT_RE = re.compile(r"//.*$")


def _code_tokens(line: str) -> str:
    """剥字符串字面量与行内注释，只留代码 token。"""
    return INLINE_COMMENT_RE.sub("", STRING_RE.sub('""', line))

GUARD = Guard(
    id="check_service_no_delivery_dep",
    title="git 服务层只依赖端口，不得依赖交付机制（tauri::AppHandle / AppHandleSink）",
    scopes=(SCOPE,),
    red_lines=(),
    docs=".trellis/spec/backend/git-domain.md",
    fix_hint=(
        "服务层收端口（Arc<dyn WatcherEventSink>），把 AppHandleSink::new(app) 留在命令层"
        "（git/commands/query.rs）。这样服务层可用测试替身驱动，且模块结构上不依赖 Tauri。"
    ),
)


def check(ctx: Context) -> GuardResult:
    findings: list[Finding] = []
    paths = ctx.glob(SCOPE)
    for path in paths:
        rel = ctx.rel(path)
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if COMMENT_ONLY.match(line):
                continue
            if DELIVERY_RE.search(_code_tokens(line)):
                findings.append(
                    Finding(
                        "服务层依赖了交付机制：`git/services/**` 只允许依赖端口"
                        "（WatcherEventSink 等）；AppHandleSink::new(app) 属于命令边界"
                        "（git/commands/query.rs）",
                        rel,
                        number,
                    )
                )
    scanned = len(paths)
    metrics = f"{scanned} 个 .rs / {len(findings)} 处交付依赖"
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics)
    return GuardResult.passed(scanned, metrics=metrics)
