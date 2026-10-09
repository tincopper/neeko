"""命令层 / async operations 层禁止在阻塞池外直连阻塞原语（红线 3）。

第一性原理：`async fn` 的契约是「不阻塞当前 worker」。当异步函数体里直接调用同步 fs 原语
（`exists` / `canonicalize` / `.git` 探测 / git2 `Repository::open`）时，契约与实现相反 ——
调用方以为不阻塞，实际把文件系统等待压在 Tokio worker 上（网络盘 / 无响应挂载点可达秒级，
期间同一 worker 承载的 PTY 输出、watcher 事件与 IPC 全部停摆）。这类形态叫**假异步**。

判据（三条同时成立才违规）：

1. 命中「同步核心」原语（下表左列；模式要求原语名后紧跟 `(`，`*_async` 形态不误命中）；
2. 该行位于某个 **`async fn` 函数体**内 —— 同步函数体内调用同步核心是本分
   （例如 `operations/worktree.rs::normalized_worktree`，它的调用方在阻塞池里等它）；
3. **不在阻塞池包装内**：`spawn_blocking(...)` / `run_blocking(...)` / `run_blocking_result(...)`
   的括号区间内一律豁免（`spawn_blocking(move || WorkspaceRef::resolve(..))` 正是正确写法）。
   三个包装名缺一不可：`run_blocking_result` 是本仓命令层的主力形态（`library/skill/commands.rs`
   51 处、`library/mcp/commands.rs` 28 处都在扫描集内），漏识别会让池内合法调用集体变成误报。

| 禁止（同步核心） | 必须改用（异步入口） |
| --- | --- |
| `CheckoutPath::resolve(` | `CheckoutPath::resolve_async(...).await` |
| `WorkspaceRef::resolve(` | `AppStateWrapper::resolve_workspace(...).await` |
| `assert_git_repo(` | `assert_git_repo_async(...).await` |
| `.open_repo(` | `.open_repo_async(...).await` |
| `...git::(local::)?is_git_repo(` | `transport.is_git_repo(...).await` |
| `is_git_repo(`（`use` 导入后的裸名） | `transport.is_git_repo(...).await` |

**配对必须在抹平注释/字面量后的文本上做**：见 [`sanitize`] —— `// 结束 }` 会提前闭合函数体
（漏报），闭包里的 `'('` 会让池区间永不配平（误报）。

**判据边界（刻意）**：只收「有成对异步替代」的原语。`std::fs::*` 不收 —— 它没有成对入口，
而「这一行是否已在池内」靠上面的第 2/3 条已经表达；再收 `std::fs::*` 只会把
`spawn_blocking(move || std::fs::create_dir_all(..))` 之外的合法形态也卷进来（噪声 ⇒ 习惯性忽略）。
同步实现层（`common/git/local/**`、`platform/**`、`transport/{local,wsl,ssh}.rs`）不在扫描集内。

**范围**：命令层（`**/commands*.rs`、`**/commands/**`）+ `common/git/operations/**`；
`tests.rs` / `*_tests.rs` 与源码内 `#[cfg(test)] mod` 块跳过。
"""
from __future__ import annotations

import pathlib
import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = (
    "src-tauri/src/**/commands*.rs",
    "src-tauri/src/**/commands/**/*.rs",
    "src-tauri/src/common/git/operations/**/*.rs",
)

GUARD = Guard(
    id="check_blocking_fs_in_commands",
    title="阻塞池外禁止直连阻塞原语（async fn 体内；需走成对的异步入口）",
    scopes=SCOPES,
    red_lines=(3,),
    docs=".trellis/spec/backend/concurrency-guidelines.md",
    fix_hint=(
        "改用对应异步入口：CheckoutPath::resolve_async(...).await / state.resolve_workspace(...).await / "
        "assert_git_repo_async(...).await / transport.open_repo_async(...).await / "
        "transport.is_git_repo(...).await；若该段必须同步执行，就把它包进 spawn_blocking"
    ),
)

FORBIDDEN = (
    (re.compile(r"\bCheckoutPath::resolve\s*\("), "CheckoutPath::resolve_async(...).await"),
    (re.compile(r"\bWorkspaceRef::resolve\s*\("), "AppStateWrapper::resolve_workspace(...).await"),
    (re.compile(r"\bassert_git_repo\s*\("), "assert_git_repo_async(...).await"),
    (re.compile(r"\.open_repo\s*\("), ".open_repo_async(...).await"),
    (
        re.compile(r"\b(?:crate::)?(?:common::)?git::(?:local::)?is_git_repo\s*\("),
        "transport.is_git_repo(...).await",
    ),
    # 裸名（`use crate::common::git::local::is_git_repo;` 之后直接调用）。前导 `(?<![\w.:])`
    # 排掉方法调用 `t.is_git_repo(` 与 `Self::is_git_repo(`（后者是异步 trait 方法本身，
    # 正是要改用的形态）；`::` 限定的同步 helper 由上面那条负责。
    (re.compile(r"(?<![\w.:])is_git_repo\s*\("), "transport.is_git_repo(...).await"),
)

ASYNC_FN_RE = re.compile(r"\basync\s+fn\s+\w+")
POOL_WRAPPER_RE = re.compile(r"\b(?:spawn_blocking|run_blocking(?:_result)?)\s*\(")
CFG_TEST_RE = re.compile(r"#\s*\[\s*cfg\s*\(\s*test\s*\)")
RAW_STRING_RE = re.compile(r"(?:b?r)(?P<hashes>#*)\"")


def is_test_file(path: pathlib.Path) -> bool:
    """`operations/tests.rs` 这类纯测试文件不参与（它们直接用同步核心做夹具）。"""
    return path.as_posix().endswith(("/tests.rs", "/tests/mod.rs")) or path.stem.endswith(
        "_tests"
    )


def sanitize(text: str) -> str:
    """把注释与字面量的**内容**替换成等长空白（换行保留，故 offset 与 `text` 完全一致）。

    配对 `{}` / `()` 是纯字符操作，看不见「这段是注释 / 字面量」。两类真实形态：
    `// 结束 }` 里的 `}` 会让 [`async_fn_ranges`] 提前闭合函数体 ⇒ 漏报；闭包里的字符字面量
    `'('` 会让 [`paren_ranges`] 永不配平、整段池豁免被丢弃 ⇒ 误报。等长替换同时解决两者，
    且行号/列号仍然准确。
    """
    out = list(text)
    n = len(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, min(end, n)):
            if out[k] != "\n":
                out[k] = " "

    def word_before(pos: int) -> bool:
        return pos > 0 and (text[pos - 1].isalnum() or text[pos - 1] == "_")

    i = 0
    while i < n:
        ch = text[i]
        raw = None if word_before(i) else RAW_STRING_RE.match(text, i)
        if ch == "/" and text.startswith("//", i):
            end = text.find("\n", i)
            blank(i, n if end < 0 else end)
            i = n if end < 0 else end
        elif ch == "/" and text.startswith("/*", i):
            depth, j = 0, i
            while j < n:
                if text.startswith("/*", j):
                    depth += 1
                    j += 2
                elif text.startswith("*/", j):
                    depth -= 1
                    j += 2
                    if depth == 0:
                        break
                else:
                    j += 1
            blank(i, j)
            i = max(j, i + 2)
        elif raw:
            # `r"..."` / `r#"..."#` / `br##"..."##`：闭合定界符 = `"` + 同数量 `#`
            closing = '"' + raw.group("hashes")
            end = text.find(closing, raw.end())
            end = n if end < 0 else end + len(closing)
            blank(i, end)
            i = end
        elif ch == '"' or (ch in "bc" and not word_before(i) and text[i + 1: i + 2] == '"'):
            start = i
            j = i + 1 if ch == '"' else i + 2
            while j < n:
                if text[j] == "\\":
                    j += 2
                elif text[j] == '"':
                    j += 1
                    break
                else:
                    j += 1
            blank(start, j)
            i = j
        elif ch == "'":
            # `'a` 是生命周期，不能当字面量消费；`'x'` / `'\n'` / `'('` 才是字面量。
            if text[i + 1: i + 2] == "\\":
                j = i + 2
                while j < n and text[j] != "'":
                    j += 1
                blank(i, j + 1)
                i = j + 1
            elif text[i + 2: i + 3] == "'":
                blank(i, i + 3)
                i += 3
            else:
                i += 1
        else:
            i += 1
    return "".join(out)


def paren_ranges(text: str, pattern) -> list:
    """`pattern` 调用点的括号区间 [start, end)（含括号）。

    输入必须是 [`sanitize`] 的结果 —— 否则字面量里的括号会破坏配平。
    """
    ranges: list[tuple] = []
    for m in pattern.finditer(text):
        depth = 0
        for i in range(m.end() - 1, len(text)):  # m.end() - 1 指向 `(`
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
                if depth == 0:
                    ranges.append((m.start(), i + 1))
                    break
    return ranges


def async_fn_ranges(text: str) -> list:
    """所有 `async fn` 函数体的区间 [start, end)（花括号配对）。输入须为 [`sanitize`] 的结果。"""
    ranges: list[tuple] = []
    for m in ASYNC_FN_RE.finditer(text):
        open_brace = text.find("{", m.end())
        if open_brace < 0:
            continue
        depth = 0
        for i in range(open_brace, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    ranges.append((open_brace, i))
                    break
    return ranges


def cfg_test_ranges(lines: list) -> list:
    """`#[cfg(test)] mod tests { ... }` 的行区间 [start, end)。

    `mod tests;`（分号形态）**不产生区间** —— 它没有内联体，内容在 `tests.rs` 里（已由
    [`is_test_file`] 排除）。若照旧向后找第一个 `{`，就会把后面某个真实代码块整段当成测试块
    而豁免（漏报）。
    """
    ranges: list[tuple] = []
    n = len(lines)
    i = 0
    while i < n:
        if not CFG_TEST_RE.search(lines[i]):
            i += 1
            continue
        j = i
        if not lines[j].lstrip().startswith(("mod ", "pub mod ")):
            j = i + 1
            while j < n and (not lines[j].strip() or lines[j].strip().startswith("#[")):
                j += 1
        if j >= n or not lines[j].lstrip().startswith(("mod ", "pub mod ")):
            i += 1
            continue
        brace = j
        while brace < n and "{" not in lines[brace] and ";" not in lines[brace]:
            brace += 1
        if brace >= n or "{" not in lines[brace]:
            i = brace + 1 if brace < n else n  # `mod tests;`：无内联体可豁免
            continue
        depth = 0
        end = brace
        for k in range(brace, n):
            depth += lines[k].count("{") - lines[k].count("}")
            if depth <= 0:
                end = k
                break
        ranges.append((i, end + 1))
        i = end + 1
    return ranges


def touches(offset: int, ranges: list) -> bool:
    return any(start <= offset < end for start, end in ranges)


def scan_file(ctx: Context, path: pathlib.Path) -> list:
    try:
        text = ctx.read_tolerant(ctx.rel(path))
    except OSError:
        return []
    clean = sanitize(text)  # 与 text 等长：后面的 offset / 行号都按原文本报告
    lines = clean.splitlines(keepends=True)
    pools = paren_ranges(clean, POOL_WRAPPER_RE)
    async_bodies = async_fn_ranges(clean)
    test_blocks = cfg_test_ranges([ln.rstrip("\r\n") for ln in lines])

    offsets, off = [], 0
    for ln in lines:
        offsets.append(off)
        off += len(ln)

    findings: list[Finding] = []
    for idx, line in enumerate(lines):
        if not line.strip():
            continue
        for pattern, replacement in FORBIDDEN:
            m = pattern.search(line)
            if not m:
                continue
            at = offsets[idx] + m.start()
            if not touches(at, async_bodies):
                continue  # 同步函数体：调用同步核心是本分
            if touches(at, pools) or touches(idx, test_blocks):
                continue
            findings.append(
                Finding(
                    f"async fn 体内、阻塞池外直连同步原语 —— 应改用 {replacement}，"
                    f"或把该段包进 spawn_blocking",
                    ctx.rel(path),
                    idx + 1,
                )
            )
            break
    return findings


def check(ctx: Context) -> GuardResult:
    scanned: dict = {}
    for scope in SCOPES:
        for path in ctx.glob(scope):
            if not is_test_file(path):
                scanned[ctx.rel(path)] = path

    findings: list[Finding] = []
    for path in scanned.values():
        findings.extend(scan_file(ctx, path))

    metrics = f"{len(scanned)} 个文件 / {len(findings)} 处阻塞池外直连"
    if findings:
        return GuardResult.violated(len(scanned), findings, metrics=metrics)
    return GuardResult.passed(len(scanned), metrics=metrics)
