"""sink 事件观测必须按单元归属（共享端口 ≠ 某单元已收敛的证据）。

第一性原理：批量入口（`activate_many` / `reconcile_mounted`）一次只注入**一个**端口给整批
单元，端口观察到的永远是「这批里某个单元发生了某事」。因此「有没有事件」不能作为
「某个单元已就绪/已收敛」的证据 —— 被兄弟单元的投递满足是**必然**的，只需要一台慢机。

事故（2026-11，仅 windows-latest 红）：`declaring_two_units_mounts_both` 等「A 的首份快照」，
谓词是 `!sink.event_names().is_empty()`；A 的冷窗口超时（合法 `Pending`）期间 B 的推送到达
⇒ 等待立刻返回 ⇒ `snapshot(&repo_a)` 为 `None` ⇒ 断言炸。反证产品侧无缺陷：`deliver_push`
先写登记表再 emit，「A 的快照事件已到而登记表没有 A」在结构上不可能 —— 失败只能说明那条
事件**不是 A 的**。

判据（命中即违规；刻意不配台账 —— 台账服务于「已知违例逐个消债」，这里要的是永远为零）：

1. **观测口归属化**：`impl CollectingSink` 里每个 `pub(crate) fn`（除 `new`）都必须接
   `workspace_key` 参数。无归属查询就是弱谓词的原材料（历史上是 `count(name)` /
   `event_names()`），加回一个便捷方法就等于把事故入口重新打开。
2. **等待原语单点**：除 `sink.rs` 外，测试代码不得出现「函数体内既有循环、又有 sink 查询」
   的手写轮询 —— 唯一入口是 `sink::test_support::wait_for_unit_event` /
   `wait_for_unit_snapshot`，两者都强制 `workspace_key`。

已知边界（诚实声明）：判据 2 是块级启发式 —— 经函数指针间接轮询（`let q = sink.count_for;`）、
或在 A 函数里循环调用 B 函数里的查询，都不在射程内。这类形态由「等待原语单点」的 review
约定兜底（实测本仓无此写法）；判据 1 是编译期强制的配套面，两者互补。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src-tauri/src/**/*.rs",)

# 观测口实现文件：它是**唯一**允许出现「循环 + sink 查询」的地方（等待原语本体在此）。
SINK_FILE = "src-tauri/src/common/file/watcher/sink.rs"

# 观测口的固有实现块（`impl WatcherEventSink for CollectingSink` 不匹配本式）。
# 允许缩进：观测口实现住在 `#[cfg(test)] mod test_support` 里，`impl` 不在行首。
IMPL_RE = re.compile(r"^\s*impl\s+CollectingSink\s*\{", re.M)
PUB_FN_RE = re.compile(r"pub\(crate\)\s+fn\s+(\w+)\s*\(")
FN_RE = re.compile(r"\bfn\s+(\w+)")
# sink 观测口上的查询调用（含历史上无归属的 `count` / `names` —— 判据 1 已禁止它们，
# 这里一并认出来，改写时不会因为「改个名字就绕过」而漏判）。接收者名须含 `sink`
# 才计入：`.count()` 在普通迭代器上到处都是，不设这条会把无关代码判成违规。
SINK_QUERY_RE = re.compile(
    r"\b\w*sink\w*\.(?:count|count_for|event_names|names|names_for|snapshot_landed)\s*\(",
    re.I,
)
LOOP_RE = re.compile(r"\b(?:while|loop|for)\b")
# 免于判据 1 的方法：构造器没有「哪个单元」可言。
METHOD_EXEMPT = frozenset({"new"})

GUARD = Guard(
    id="check_event_wait_attribution",
    title="sink 观测必须按单元归属（禁止无 key 查询 / 手写轮询）",
    scopes=SCOPES,
    red_lines=(),
    docs=".trellis/spec/unit-test/real-source-determinism.md",
    fix_hint=(
        "等某单元就绪用 wait_for_unit_event(sink, &unit.key(), NAME, n, timeout) / "
        "wait_for_unit_snapshot；计数与负向断言用 count_for / names_for —— "
        "不要给观测口加回无 workspace_key 的便捷查询"
    ),
)


def _mask_comments_and_strings(text: str) -> str:
    """把注释内容与字符串字面量替换为空格（保留长度与换行 ⇒ 行号不变）。

    判据只看代码 token：注释里写「曾经用 `count(name)`」是记录，不是违规。
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
                    out[i] = " "
                    if i + 1 < n:
                        out[i + 1] = " "
                    i += 2
                    continue
                if text[i] == '"':
                    break
                if text[i] != "\n":
                    out[i] = " "
                i += 1
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
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _matching_brace(text: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _body_start(text: str, start: int) -> int:
    """从 `start` 之后找函数体起始 `{`；先遇到顶层 `;` 返回 -1（声明无体）。"""
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and ch == "{":
            return i
        elif depth == 0 and ch == ";":
            return -1
    return -1


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def _scan_unattributed_methods(text: str, rel: str) -> list[Finding]:
    """判据 1：`impl CollectingSink` 的公开方法必须带 `workspace_key`。"""
    findings: list[Finding] = []
    for impl in IMPL_RE.finditer(text):
        open_idx = text.find("{", impl.end() - 1)
        close_idx = _matching_brace(text, open_idx)
        if close_idx < 0:
            continue
        block = text[open_idx:close_idx]
        for method in PUB_FN_RE.finditer(block):
            name = method.group(1)
            if name in METHOD_EXEMPT:
                continue
            paren = open_idx + method.end() - 1
            close = _matching_paren(text, paren)
            params = text[paren : close + 1] if close > 0 else ""
            if "workspace_key" in params:
                continue
            findings.append(
                Finding(
                    "观测口的公开查询必须接 `workspace_key`: "
                    f"`{name}` 是无归属查询的原材料（弱谓词入口），"
                    "按单元归属的方法名是 count_for / names_for",
                    rel,
                    _line_of(text, paren),
                )
            )
    return findings


def _scan_hand_rolled_waits(text: str, rel: str) -> list[Finding]:
    """判据 2：除观测口实现文件外，不得出现「循环体内查 sink」的手写轮询。

    判据落在**循环体**而不是整个函数体：函数里别处恰有一次 `.count()`（迭代器统计之类）
    不该被算成轮询 —— 实测 `terminal/history/store.rs::tail` 就是这个形态。
    """
    findings: list[Finding] = []
    for loop in LOOP_RE.finditer(text):
        body_open = _body_start(text, loop.end())
        if body_open < 0:
            continue
        body_close = _matching_brace(text, body_open)
        if body_close < 0:
            continue
        if not SINK_QUERY_RE.search(text, body_open, body_close):
            continue
        findings.append(
            Finding(
                "不得在测试文件里手写 sink 轮询（循环体内查观测口）："
                "等待原语单点在 sink::test_support，且必须带单元 key —— "
                "wait_for_unit_event / wait_for_unit_snapshot",
                rel,
                _line_of(text, loop.start()),
            )
        )
    return findings


def check(ctx: Context) -> GuardResult:
    files = sorted({p for scope in SCOPES for p in ctx.glob(scope)})
    findings: list[Finding] = []
    for path in files:
        rel = ctx.rel(path)
        masked = _mask_comments_and_strings(ctx.read(rel))
        findings.extend(_scan_unattributed_methods(masked, rel))
        if rel != SINK_FILE:
            findings.extend(_scan_hand_rolled_waits(masked, rel))

    metrics = f"{len(files)} 个 .rs / 违规 {len(findings)}"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
