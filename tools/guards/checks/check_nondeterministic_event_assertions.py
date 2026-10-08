"""禁止对真实异步事件源的事件观察者做绝对零 / 精确集合断言。

第一性原理：真实源（OS 文件事件 / 进程 / 时钟 / 线程调度）只承诺**单向可达**（至少一次），
不承诺事件集合精确。裸 `Arc<AtomicUsize>` 把命中计数暴露给测试，于是
`assert_eq!(refs.load(..), 0)` 这类跨回调绝对零断言随手就能写出来，并在 Windows
`ReadDirectoryChangesW` 的目录级事件下必挂（2026-10-08 事故，仅 windows-latest 红）。

本护栏对**非确定性域**（真的使用真实异步事件源 / 有界等待原语的文件）施加域级不变量：
域内禁止把「事件观察者读取」与整数字面量做相等断言（`assert_eq!` / `assert!(… == …)`）——
绝对零与精确集合同罪，换一个宏不该绕过规则。
差分式（与运行时基线比较）与正向可达（`wait_reached` / `> 0` / `assert_ne!(_, 0)`）放行。

域判定基于**结构信号**（文件是否用真实事件源），不是断言形状：确定性替身
（`conversation/manager.rs` 假 adapter、`sink.rs::CollectingSink`、`registration/tests.rs`
的 MockWatcher）不含这些原语，因此不进域、不被误伤。

机制详解与判定表：`.trellis/spec/unit-test/real-source-determinism.md`。
同类不变量：`worktree-byte-assertion-ban`（工作区字节）—— 两者是「环境契约被当作应用契约」
的两个特化，判据不重叠，故不合并。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src-tauri/src/**/*.rs", "src-tauri/tests/**/*.rs")

# 域判定：使用真实异步事件源 / 有界等待原语的结构信号。命中任一即入域。
DOMAIN_MARKERS = (
    "create_git_meta_watcher(",
    "RecommendedWatcher::new(",
    "WatcherManager::new(",
    "fn wait_until",
    "fn wait_for_event",
    "fn touch_and_wait",
    "fn wait_reached",
)
# 逃生舱注解：未来接入进程 / 时钟 / 网络源时用。它只**扩大**域，不放行。
ESCAPE_HATCH = "@nondeterministic-domain"

ASSERT_EQ_RE = re.compile(r"\bassert_eq!\s*\(")
# `assert!(..)`（排除 `assert_eq!` / `assert_ne!` / `debug_assert!`）：同一缺陷类的第二种宏形态。
ASSERT_RE = re.compile(r"(?<![\w!])assert!\s*\(")
# 裸整数字面量（允许 `_` 分隔与类型后缀）。
INT_LITERAL_RE = re.compile(r"\d[\d_]*(?:[iu](?:8|16|32|64|128|size))?")
# 裸观察者读取：整个实参就是一次 `.load(..)` / `.count(..)`，没有外层二元运算。
# 差分式 `count(..) - baseline` 因带外层运算而不匹配 ⇒ 放行。
BARE_OBSERVER_RE = re.compile(
    r"^\s*&?\s*[\w:.]+\.(?:load|count)\s*\([^()]*\)\s*$"
)

GUARD = Guard(
    id="check_nondeterministic_event_assertions",
    title="真实源事件观察者禁止绝对零 / 精确集合断言（只能单向可达或差分式）",
    scopes=SCOPES,
    red_lines=(),
    docs=".trellis/spec/unit-test/real-source-determinism.md",
    fix_hint=(
        "正向用 CallbackProbe::wait_reached / wait_for_event；负向分类下沉 units 纯函数；"
        "生命周期负向改差分式（assert_eq!(count, baseline)）"
    ),
)


def _in_domain(text: str) -> bool:
    return ESCAPE_HATCH in text or any(marker in text for marker in DOMAIN_MARKERS)


def _mask_comments(text: str) -> str:
    """把 `//` 与 `/* */` 注释内容替换为空格（保留长度与换行 ⇒ 偏移/行号不变）。

    同时正确跳过字符串字面量（`"http://…"` 里的 `//` 不是注释）。掩码后在代码上做
    匹配，避免文档 / 注释里的示例被误报。
    """
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            out[i] = " "
            out[i + 1] = " "
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                if text[i] != "\n":
                    out[i] = " "
                i += 1
            if i < n:
                out[i] = " "
                out[i + 1] = " "
                i += 2
            continue
        i += 1
    return "".join(out)


def _matching_paren(text: str, open_idx: int) -> int:
    """返回与 `text[open_idx] == '('` 配对的 `)` 下标；-1 表示不闭合（跳过该处）。"""
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _split_args(args: str) -> list[str]:
    """按顶层逗号切分实参（忽略嵌套括号 / 方括号 / 花括号 / 字符串内的逗号）。"""
    parts: list[str] = []
    depth = 0
    start = 0
    i = 0
    n = len(args)
    while i < n:
        ch = args[i]
        if ch == '"':
            i += 1
            while i < n:
                if args[i] == "\\":
                    i += 2
                    continue
                if args[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(args[start:i])
            start = i + 1
        i += 1
    parts.append(args[start:])
    return parts


def _split_top_level_eq(expr: str) -> tuple[str, str] | None:
    """在深度 0 找恰好一个 `==`（排除 `!=` / `>=` / `<=` / `===`）；无或多于一个返回 None。"""
    depth = 0
    i = 0
    n = len(expr)
    found: tuple[str, str] | None = None
    while i < n:
        ch = expr[i]
        if ch == '"':
            i += 1
            while i < n:
                if expr[i] == "\\":
                    i += 2
                    continue
                if expr[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif (
            ch == "="
            and depth == 0
            and i + 1 < n
            and expr[i + 1] == "="
            and (i == 0 or expr[i - 1] not in "!<>=$")
            and (i + 2 >= n or expr[i + 2] != "=")
        ):
            if found is not None:
                return None
            found = (expr[:i], expr[i + 2 :])
            i += 2
            continue
        i += 1
    return found


def _observer_vs_literal(left: str, right: str) -> bool:
    """恰好一侧是裸整数字面量、另一侧是裸事件观察者读取。"""
    return (_is_bare_int(left) and _is_bare_observer(right)) or (
        _is_bare_observer(left) and _is_bare_int(right)
    )


def _is_bare_int(value: str) -> bool:
    return INT_LITERAL_RE.fullmatch(value.strip()) is not None


def _is_bare_observer(value: str) -> bool:
    return BARE_OBSERVER_RE.fullmatch(value) is not None


def scan_file(ctx: Context, rel: str) -> list[Finding]:
    raw = ctx.read(rel)
    if not _in_domain(raw):
        return []
    text = _mask_comments(raw)
    findings: list[Finding] = []
    for match in ASSERT_EQ_RE.finditer(text):
        open_idx = text.find("(", match.end() - 1)
        if open_idx < 0:
            continue
        close_idx = _matching_paren(text, open_idx)
        if close_idx < 0:
            continue
        args = _split_args(text[open_idx + 1 : close_idx])
        if len(args) < 2:
            continue
        left, right = args[0], args[1]
        if _observer_vs_literal(left, right):
            findings.append(_finding(text, match.start(), rel, "assert_eq!", left, right))
    # `assert!(observer == 0)`：与绝对零断言同类，换一个宏不该绕过规则。
    for match in ASSERT_RE.finditer(text):
        open_idx = text.find("(", match.end() - 1)
        if open_idx < 0:
            continue
        close_idx = _matching_paren(text, open_idx)
        if close_idx < 0:
            continue
        args = _split_args(text[open_idx + 1 : close_idx])
        if not args:
            continue
        split = _split_top_level_eq(args[0])
        if split is None:
            continue
        left, right = split
        if _observer_vs_literal(left, right):
            findings.append(_finding(text, match.start(), rel, "assert!", left, right))
    return findings


def _finding(text: str, start: int, rel: str, macro: str, left: str, right: str) -> Finding:
    return Finding(
        f"真实源事件观察者不得与整数字面量做 {macro}（绝对零 / 精确集合同罪）——"
        f"改单向可达（wait_reached / > 0）或差分式（与 baseline 比较）：{left.strip()} vs {right.strip()}",
        rel,
        text.count("\n", 0, start) + 1,
    )


def check(ctx: Context) -> GuardResult:
    files = sorted({p for scope in SCOPES for p in ctx.glob(scope)})
    findings: list[Finding] = []
    in_domain = 0
    for path in files:
        rel = ctx.rel(path)
        hits = scan_file(ctx, rel)
        if hits or _in_domain(ctx.read(rel)):
            in_domain += 1
        findings.extend(hits)

    metrics = f"{len(files)} 个 .rs（入域 {in_domain}）/ 违规 {len(findings)}"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
