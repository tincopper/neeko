"""禁止对「工作区物化字节」做行尾敏感的精确断言。

第一性原理：Neeko 是 Git 客户端，同时面对两个内容视图 ——
- **git 归一化视图**（blob / diff / status）：受 text/autocrlf 影响时统一 LF，平台无关；
- **工作区物化字节**：由平台 + git 配置决定。Windows 上 `core.autocrlf=true` 会把
  stash/checkout/discard/apply 落盘的内容转成 CRLF。

所以「`read_to_string` 读工作区 → `assert_eq!` 与字面量精确比较」的测试在 Windows CI
必挂（回归样例：`git_test::stash_apply_restores_changes_keeps_entry`）。

## 历史（勿重犯）

本护栏曾用 `parents[3]` 定位仓库根 —— 那解析到仓库的**父目录**，两个扫描目录都不存在
并被 `if not d.exists(): continue` 静默跳过，于是它接在 `pnpm lint` 与 CI 上却**什么都没
检查**（恒打印 OK；2026-09-16 发现）。现在根定位与「扫描集为空即判失效」都由框架统一
负责（core/repo.py、core/runner.py），单条护栏没有能力再漏掉这条拦截。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src-tauri/src/**/*.rs", "src-tauri/tests/**/*.rs")
READ_RE = re.compile(r"(?:std::fs|tokio::fs)::read_to_string")
ASSERT_RE = re.compile(r"assert_eq!\s*\(")
BIND_RE = re.compile(r"\blet\s+(\w+)\s*=")
READ_ARG_RE = re.compile(r"\s*\(\s*&?(\w+)")

# 同一函数里出现这些词 → 「自写豁免」作废（先前自写的字节可能已被 git 重新物化）。
# 边界刻意放宽：`\bcommit\b` 匹配不到 `git_commit()`（下划线算 word char），会让该函数
# 被误判成「与 git 无关 → 豁免」。这里宁可多报（本护栏文档定的保守方向）。
GIT_TERMS = re.compile(
    r"\bgit\b|git_|_git|stash|checkout|apply|discard|commit|TestRepo|init_repo",
    re.IGNORECASE,
)
LOCAL_WRITE_RE = re.compile(
    r"(?:std::fs|tokio::fs)::write\s*\(\s*&?(\w+)|File::create\s*\(\s*&?(\w+)"
)

GUARD = Guard(
    id="check_worktree_byte_assertions",
    title="Git 测试禁止对工作区换行做字节级精确断言（Windows/autocrlf 下必挂）",
    scopes=SCOPES,
    red_lines=(11, 13),
    docs=".trellis/spec/backend/git-domain.md",
    fix_hint=(
        "优先在 git 归一化视图（status/diff）上做 oracle；必须读字节时走行尾无关比较"
        "（support::assert_content_eq / assert_worktree_eq），或使用确定性测试仓库"
        "（TestRepo / init_repo：仓库级 core.autocrlf=false + 提交 .gitattributes `* -text`）"
    ),
)


def function_spans(text: str) -> list:
    """每个 `fn` 体的字符区间（花括号配对；跳过字符串/字符字面量）。"""
    spans: list[tuple[int, int]] = []
    for m in re.finditer(r"\bfn\s+\w+", text):
        open_brace = text.find("{", m.end())
        if open_brace < 0:
            continue
        depth = 0
        i = open_brace
        while i < len(text):
            ch = text[i]
            if ch == '"':
                i += 1
                while i < len(text) and text[i] != '"':
                    i += 2 if text[i] == "\\" else 1
            elif ch == "'":
                i += 3 if (i + 1 < len(text) and text[i + 1] == "\\") else 2
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    spans.append((open_brace, i))
                    break
            i += 1
    return spans


def enclosing_span(offset: int, spans: list):
    """包含该偏移的最内层函数区间。"""
    best = None
    for start, end in spans:
        if start <= offset <= end and (best is None or (end - start) < (best[1] - best[0])):
            best = (start, end)
    return best


def scan_file(ctx: Context, path) -> tuple:
    text = ctx.read(ctx.rel(path))
    # keepends=True：行分隔符按真实字节计，LF/CRLF 下后续字节偏移定位都成立
    lines = text.splitlines(keepends=True)
    offsets: list[int] = []
    off = 0
    for ln in lines:
        offsets.append(off)
        off += len(ln)
    plain = [ln.rstrip("\r\n") for ln in lines]
    spans = function_spans(text)

    def is_self_authored(read_offset: int, read_var) -> bool:
        """同一函数内自己写过该路径、且函数内无 git 操作 → 字节非 git 物化，豁免。"""
        if not read_var:
            return False
        span = enclosing_span(read_offset, spans)
        if span is None:
            return False
        body = text[span[0] : span[1]]
        if GIT_TERMS.search(body):
            return False
        return any(read_var in m.groups() for m in LOCAL_WRITE_RE.finditer(body))

    # 1) 收集 read_to_string 绑定的变量。
    #    **不能**按变量名收成 dict：不同测试常复用同一个名字（如 `content`），按名索引会让
    #    它们互相覆盖，把 A 的绑定当成 B 的（原实现即有此隐患：报告片段取自另一个测试）。
    #    故存成列表，断言处按「同函数优先」挑选。
    bindings: list[tuple] = []
    for i, ln in enumerate(plain):
        m = READ_RE.search(ln)
        if not m:
            continue
        bound = BIND_RE.search(ln[: m.start()])
        if bound:
            arg = READ_ARG_RE.match(ln[m.end() :])
            bindings.append((bound.group(1), m.start() + offsets[i], arg.group(1) if arg else None))

    hits: list[Finding] = []
    exemptions: list[Finding] = []
    for i, ln in enumerate(plain):
        for m in ASSERT_RE.finditer(ln):
            after = text[offsets[i] + m.end() :]
            am = re.match(r"\s*(\w+)", after)
            if not am:
                continue
            var = am.group(1)
            # 精确使用 = var 后首个非空字符是 `,`；若是 `.`（.replace(...)）说明已归一化，放行
            if not re.match(r"\s*,", after[am.end() :]):
                continue
            cands = [b for b in bindings if b[0] == var]
            if not cands:
                continue
            assert_offset = offsets[i] + m.start()
            same_fn = [
                b for b in cands if enclosing_span(b[1], spans) == enclosing_span(assert_offset, spans)
            ]
            pool = same_fn or [b for b in cands if b[1] <= assert_offset] or cands
            read_offset, read_var = max(pool, key=lambda b: b[1])[1:]
            target = exemptions if is_self_authored(read_offset, read_var) else hits
            target.append(Finding(ln.strip(), ctx.rel(path), i + 1))
            break

    return hits, exemptions


def check(ctx: Context) -> GuardResult:
    files = sorted({p for scope in SCOPES for p in ctx.glob(scope)})
    findings: list[Finding] = []
    exempted: list[Finding] = []
    for path in files:
        hits, exempt = scan_file(ctx, path)
        findings.extend(hits)
        exempted.extend(exempt)

    metrics = f"{len(files)} 个 .rs / 违规 {len(findings)} / 豁免 {len(exempted)}"
    notes = tuple(f"  [豁免] {f.as_text()}" for f in exempted)
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics, notes=notes)
    return GuardResult.passed(len(files), metrics=metrics)
