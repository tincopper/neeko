"""事件名常量：Rust 侧带协议的通道名必须在前端 `src/shared/events.ts` 里有同值镜像（红线 5）。

## 第一性原理（为什么需要它）

红线 5 的原始问题是「同一个事件名在两个语言里各写一遍，改一边忘另一边 ⇒ 前端静默失联」。
项目已经用「常量单一源 + 前端镜像」的纪律压住它，但**纪律本身没有执行者**：

- TS 侧对本仓库的 Rust 常量零编译期知识 —— 把 `'agent-team://event'` 改成
  `'agent-team://changed'`，`tsc` 一声不响；
- 现有护栏明确把这件事排除在外：`check_terminal_foreground_arbitration.py` 的 A4 判据
  只扫 `neeko:*` 形态的**前端 DOM** 事件，并在 docstring 里写明「后端 Tauri 事件名不在射程」。

于是「双端同源」目前是一句话，不是一个判据。本护栏把它变成判据：任何带 `scheme://`
的 `pub const` 事件通道名，必须在 `src/shared/events.ts` 里逐字存在；反过来 TS 里带
`scheme://` 的常量也必须在 Rust 侧有出处（多余 = 前端在监听一个永远不会到达的事件）。

## 判据（三条）

集合在两侧都只取「名字里含 `EVENT` 标识片段 + 值是 `scheme://rest`」的常量：

- 为什么限定 `scheme://`：只有这类通道名在本仓形成了稳定的双端约定（`agent-chat://` /
  `translation://` / `browser://` / `agent-team://`）。形如 `file-changed`、`dap-event`、
  `notification-refocus` 的名字**没有**统一约定，而且前缀式名字（`lsp-diagnostics-{path}` /
  `lsp-progress-{path}`）根本不是字面量 —— 把它们纳进来会造出「前缀 vs 完整名」的假阳性。
  **边界如实声明**：本判据不覆盖无协议事件名，那一半仍然只能靠人工 review。
- 为什么要求名字含 `EVENT`：`pub const REGISTRY_BASE_URL = "https://…"` 这类业务 URL 也会
  命中 `scheme://`，而它不是事件通道。本仓的事件常量命名已经统一含 `EVENT`
  （`*_EVENT` 或 `EVENT_*`），用命名做区分而不是靠 scheme 白名单（白名单会漏掉下一个新协议）。

1. **A1 前端镜像缺失**：Rust 有、`events.ts` 没有 ⇒ 前端永远收不到（名字只在前端拼字符串时才会暴露）。
2. **A2 前端多余**：`events.ts` 有、Rust 没有 ⇒ 前端在监听一个后端从未 emit 的通道
   （红线 14 的同型：声明了却没人实现）。
3. **A3 同名常量指向不同值**：两侧同名（如 `AGENT_TEAM_EVENT`）但值不同 ⇒ 典型的手改一处。
   **覆盖率如实声明**：只判两侧都存在同名常量的那部分。本仓 `browser://` 组的命名约定
   两侧刻意不同（Rust `EVENT_BROWSER_*` vs TS `BROWSER_*_EVENT`），因此它们只受 A1/A2 的
   集合判据约束 —— 值仍然被逐字比对，只是不做「名字 → 值」的配对。

## 反空转

两侧扫描集任一为空 ⇒ `GuardResult.broken`（退出码 2）：Rust 扫到 0 个事件常量意味着
正则口径失效（例如把 `&'static str` 换成 `Cow` 或 `concat!`），而不是「仓库很干净」。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

RUST_SCOPES = ("src-tauri/src/**/*.rs",)
TS_FILE = "src/shared/events.ts"

# Rust：`pub const X_EVENT: &str = "scheme://rest";`（容忍 `&'static str`）。
RUST_EVENT_CONST_RE = re.compile(
    r"""^\s*pub\s+const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:\s*'static\s+)?str\s*=\s*"""
    r""""([a-z][a-z0-9+.\-]*://[^"]*)"\s*;""",
    re.MULTILINE,
)
# TS：`export const X_EVENT = 'scheme://rest';`
TS_CONST_RE = re.compile(
    r"""^export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]*)['"]""", re.MULTILINE
)

GUARD = Guard(
    id="check_event_constants",
    title="带协议的事件通道名必须与前端 src/shared/events.ts 逐字镜像（红线 5）",
    scopes=RUST_SCOPES + (TS_FILE,),
    red_lines=(5,),
    docs=".trellis/spec/frontend/type-safety.md",
    fix_hint=(
        "在两端同时改：Rust 侧常量（如 `agent/team/events.rs::TEAM_EVENT`）+ "
        "`src/shared/events.ts` 的同值镜像；只改一边 = 前端静默失联（tsc 不会报）"
    ),
)


def _rust_events(ctx: Context) -> dict:
    """`{字面量: (相对路径, 常量名)}` —— 只收 `pub const` 且名字含 `EVENT` 的 `scheme://` 值。"""
    found: dict = {}
    for path in ctx.glob(RUST_SCOPES[0]):
        rel = ctx.rel(path)
        for match in RUST_EVENT_CONST_RE.finditer(ctx.read_tolerant(rel)):
            name, literal = match.group(1), match.group(2)
            if "EVENT" not in name:
                continue
            # 同名重复声明（不同模块各一份）不在这里判：那是 Rust 编译期的事。
            found.setdefault(literal, (rel, name))
    return found


def _ts_events(ctx: Context) -> dict:
    """`{字面量: 常量名}` —— 只收具名导出的 `scheme://` 常量。"""
    found: dict = {}
    for name, literal in TS_CONST_RE.findall(ctx.read(TS_FILE)):
        if "://" not in literal:
            continue
        found.setdefault(literal, name)
    return found


def check(ctx: Context) -> GuardResult:
    rust = _rust_events(ctx)
    ts = _ts_events(ctx)

    # 反空转：两侧任一为空都说明口径失效（正则/文件搬家），不是「仓库干净」。
    if not rust:
        return GuardResult.broken(
            f"在 {RUST_SCOPES[0]} 下扫到 0 个带协议的事件常量 —— 判据口径失效"
            "（常量形态变了？如 `&'static str` / `concat!` / 非 `pub`）",
            scanned=0,
        )
    if not ts:
        return GuardResult.broken(
            f"{TS_FILE} 里扫到 0 个带协议的常量 —— 判据口径失效（镜像表被改成对象/拼接？）",
            scanned=0,
        )

    findings: list[Finding] = []

    # A1：Rust 有、前端没有。
    for literal in sorted(set(rust) - set(ts)):
        rel, name = rust[literal]
        findings.append(
            Finding(
                f"A1 前端镜像缺失：{name} 声明了事件通道 {literal!r}，"
                f"但 {TS_FILE} 里没有同值常量 —— 前端永远收不到（红线 5）",
                rel,
            )
        )

    # A2：前端有、Rust 没有（监听一个不存在的通道）。
    for literal in sorted(set(ts) - set(rust)):
        findings.append(
            Finding(
                f"A2 前端多余：{TS_FILE} 的 {ts[literal]} = {literal!r} 在 Rust 侧没有任何"
                " `pub const ..._EVENT` 出处 —— 监听一个后端从未 emit 的通道（红线 14 同型）",
                TS_FILE,
            )
        )

    # A3：同名常量指向不同值（手改一处的典型形态；覆盖率见模块文档）。
    rust_by_name = {name: literal for literal, (_, name) in rust.items()}
    ts_by_name = {name: literal for literal, name in ts.items()}
    for name in sorted(set(rust_by_name) & set(ts_by_name)):
        if rust_by_name[name] != ts_by_name[name]:
            findings.append(
                Finding(
                    f"A3 同名常量值不一致：{name} 在 Rust 是 {rust_by_name[name]!r}，"
                    f"在 {TS_FILE} 是 {ts_by_name[name]!r}",
                    rust[rust_by_name[name]][0],
                )
            )

    metrics = f"Rust {len(rust)} 个通道名 / TS {len(ts)} 个（镜像 {len(set(rust) & set(ts))} 个）"
    notes = tuple(
        f"  {literal}  ←  {rust[literal][0]}::{rust[literal][1]}"
        for literal in sorted(rust)
    )
    if findings:
        return GuardResult.violated(len(rust) + len(ts), findings, metrics=metrics, notes=notes)
    return GuardResult.passed(len(rust) + len(ts), metrics=metrics, notes=notes)
