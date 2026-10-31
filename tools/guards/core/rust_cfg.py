"""Rust 平台 cfg 的语法表层 —— 被多条平台纪律护栏共用的"共同语言"。

职责边界（单一职责）：
- **本模块只回答"文本长什么样"**：平台 cfg 属性识别、cfg 谓词 → 平台集合、块 / 语句 / item 范围、
  行噪声剥离、标识符出现位置。
- **判据不在这里**：`check_platform_imports`（独占消费者：定义与使用点的存活配置分离）与
  `check_platform_cfg_placement`（附着位置：门控粒度必须 ≥ 作用域粒度）各自持有自己的规则与 fix_hint。
- 依赖方向：`checks/* → core/rust_cfg`（单向，本模块不得 import 任何 check）。

抽取动机：同一套语法表层此前只在 `check_platform_imports` 内；第二个消费者（附着位置判据）落地时
再复制就会得到两份必然漂移的表示。等价性由 `check_platform_imports` 的既有单测与本仓命中清单恒等证明。
"""
from __future__ import annotations

import re

PLATFORMS = ("linux", "macos", "windows")
ALL_PLATFORMS = frozenset(PLATFORMS)
UNIX_PLATFORMS = frozenset({"linux", "macos"})

CFG_ATTR_RE = re.compile(r"#\s*\[\s*cfg\s*\((.*)\)\s*\]")
CFG_PLATFORM_RE = re.compile(r"#\s*\[\s*cfg\s*\([^]]*target_os[^]]*\)")
CFG_PLATFORM_ALT_RE = re.compile(r"#\s*\[\s*cfg\s*\([^]]*\b(unix|windows)\b[^]]*\)")
IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"')


def is_platform_cfg(line: str) -> bool:
    """该行是否是平台 cfg 属性（含 `target_os` / 裸 `unix` / `windows`）。"""
    return bool(CFG_PLATFORM_RE.search(line) or CFG_PLATFORM_ALT_RE.search(line))


def has_cfg_gate(lines: list, idx: int) -> bool:
    """刻意保守：cfg 在 item 上方 1-3 行内就算"门控着"（即使它门控的是别的 item）。

    向「宁可少报」一侧收敛 —— 误报会让人把整条护栏关掉。
    """
    for j in range(max(0, idx - 3), idx):
        if CFG_PLATFORM_RE.search(lines[j]) or CFG_PLATFORM_ALT_RE.search(lines[j]):
            return True
    return False


def strip_noise(line: str) -> str:
    """去掉字符串字面量与行尾注释 —— 括号配平、标识符索引、使用点判定都基于它。"""
    return STRING_RE.sub('""', line).split("//", 1)[0]


def split_top_level(body: str) -> list:
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    if "".join(current).strip():
        parts.append("".join(current))
    return [p.strip() for p in parts]


def evaluate_cfg(expr: str):
    """把 cfg 谓词体解析成「满足条件的平台集合」；None = 解析不了（保守：该候选放行）。"""
    expr = expr.strip()
    for head in ("not", "any", "all"):
        prefix = head + "("
        if expr.startswith(prefix) and expr.endswith(")"):
            parts = [evaluate_cfg(p) for p in split_top_level(expr[len(prefix) : -1])]
            if not parts:
                return None
            if head == "not":
                return None if len(parts) != 1 or parts[0] is None else ALL_PLATFORMS - parts[0]
            if any(p is None for p in parts):
                return None
            result = frozenset() if head == "any" else ALL_PLATFORMS
            for part in parts:
                result = (result | part) if head == "any" else (result & part)
            return result
    key, sep, value = expr.partition("=")
    if sep:
        if key.strip() == "target_os":
            name = value.strip().strip('"')
            return frozenset({name}) if name in PLATFORMS else frozenset()
        return None  # target_arch / feature 等：判不了
    if expr == "unix":
        return UNIX_PLATFORMS
    if expr == "windows":
        return frozenset({"windows"})
    if expr == "test":
        return ALL_PLATFORMS  # 平台口径上 test 构建三平台都在
    return None  # 未知谓词（含裸 `target_os`）


def parse_gate(attr_line: str):
    match = CFG_ATTR_RE.search(attr_line)
    return None if not match else evaluate_cfg(match.group(1))


def brace_end(noise_free: list, start: int) -> int:
    """从 start 起找到第一个 `{` 并返回配平到 0 的行号（找不到则退回 start）。"""
    brace_start = start
    while brace_start < len(noise_free) and "{" not in noise_free[brace_start]:
        brace_start += 1
    if brace_start >= len(noise_free):
        return start
    depth = 0
    for k in range(brace_start, len(noise_free)):
        for ch in noise_free[k]:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return k
    return len(noise_free) - 1


def statement_end(noise_free: list, start: int) -> int:
    """多行非块语句的收尾（attr 贴在 `assert!(...)` / `let` 这类语句上）。

    括号配平回到 0 的那一行，行尾必须是 `;` 或 `}` 才算语句结束；否则（枚举变体的
    `},`、结构体字段的 `job_handle,` 这类非语句项）判定不了，退回单行范围 ——
    向「宁可少报」一侧收敛：误报会让人把整条护栏关掉。
    """
    depth = 0
    for k in range(start, len(noise_free)):
        for ch in noise_free[k]:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
        if depth <= 0:
            return k if noise_free[k].strip().endswith((";", "}")) else start
    return start


def enclosing_block_end(noise_free: list, idx: int) -> int:
    """定义所在花括号块的收尾行（作用域判定的基础：不让跨函数同名串味）。"""
    depth = 0
    for k in range(idx, len(noise_free)):
        for ch in noise_free[k]:
            if ch == "{":
                depth += 1
            elif ch == "}":
                if depth == 0:
                    return k
                depth -= 1
    return len(noise_free) - 1


def body_open_line(noise_free: list, start: int, limit: int = 4) -> int | None:
    """item 头部（属性 / 注释之后）是否拥有**块体开口 `{`**；返回其行号，无体返回 None。

    判据是**结构性的**（不枚举 item 种类，新 item 种类无需同步）：从 `start` 起向下扫，
    在遇到语句 / 成员终止符（深度为 0 的 `;` / `,`）之前先遇到 `{` ⇒ 该 `{` 就是本 item 的
    块体开口；否则本 item 无体（`use` / `const` / `static` / `type` / 字段 / `mod X;` …）。
    括号深度用于放行多行头部（`fn f(\n a: u32,\n) -> u32 {`），避免把参数列表的行尾 `,`
    误当成员终止符。

    **为什么必须区分**：对无体 item 做花括号配平会向后找到**别的 item** 的 `{` 并吞掉它 ——
    实测误报：`#[cfg(test)] use AtomicUsize;` 之后的生产代码被误判为测试域。
    """
    depth = 0
    for k in range(start, min(start + limit, len(noise_free))):
        line = noise_free[k]
        if "{" in line:
            return k
        depth += line.count("(") - line.count(")")
        if depth <= 0 and line.rstrip().endswith((";", ",")):
            return None
    return None


def find_cfg_gated_ranges(lines: list, noise_free: list) -> list:
    """所有平台 cfg 门控的范围 [start, end) + 该门控满足的平台集合（None=解析不了）。

    覆盖形态：`#[cfg]` + item（含多行签名）、`#[cfg]` + 裸 `{` 块、`#[cfg]` + 多行非块语句。
    """
    ranges: list[tuple[int, int, object]] = []
    n = len(lines)
    i = 0
    while i < n:
        if not is_platform_cfg(lines[i]) or lines[i].lstrip().startswith("//"):
            i += 1
            continue
        j = i + 1
        while j < n and not lines[j].strip():
            j += 1
        while j < n and lines[j].strip().startswith("#["):
            j += 1
            while j < n and not lines[j].strip():
                j += 1
        if j >= n:
            i += 1
            continue
        open_line = body_open_line(noise_free, j)
        if open_line is not None:
            end = brace_end(noise_free, open_line)
        else:
            end = statement_end(noise_free, j)
        ranges.append((i, end + 1, parse_gate(lines[i])))
        i = end + 1
    return ranges


def inside_ranges(line_no: int, ranges: list) -> bool:
    return any(start <= line_no < end for start, end, _ in ranges)


def alive_platforms(line_no: int, ranges: list) -> frozenset:
    """该行在哪些平台会被编译到；门控解析不了 → 视为全平台存活（保守）。"""
    alive = ALL_PLATFORMS
    for start, end, gate in ranges:
        if start <= line_no < end:
            if gate is None:
                return ALL_PLATFORMS
            alive = alive & gate
    return alive


def some_platform_drops_all(usages: list, ranges: list) -> bool:
    """是否存在某个平台，使这些使用点全部被编译掉。"""
    alive_per_usage = [alive_platforms(u, ranges) for u in usages]
    return any(
        not any(platform in alive for alive in alive_per_usage) for platform in PLATFORMS
    )


def build_identifier_index(noise_free: list) -> dict:
    """一行一个索引：标识符 → [(行号, 起始列)]（供作用域内的出现点查询）。"""
    index: dict[str, list] = {}
    for i, line in enumerate(noise_free):
        for match in IDENT_RE.finditer(line):
            index.setdefault(match.group(0), []).append((i, match.start()))
    return index


def is_member_access(line: str, start: int) -> bool:
    """`self.x` / `a::x` 不是局部绑定或文件级引入的使用点。"""
    head = line[:start].rstrip()
    return head.endswith(".") or head.endswith("::")


def occurrences(index: dict, noise_free: list, name: str, low: int, high: int) -> list:
    """[low, high] 行区间内 name 的出现行（排除字段/路径访问）。"""
    lines = {
        i
        for i, start in index.get(name, ())
        if low <= i <= high and not is_member_access(noise_free[i], start)
    }
    return sorted(lines)


# ── 测试域（`#[cfg(test)] mod tests { … }`）───────────────────────────────────────
# 抽取动机：同一段「按花括号配平切出内联测试块」此前在 `check_command_execution` 与
# `check_blocking_fs_in_commands` 各写一份；第三个消费者（执行上下文台账 / 手搓地址）
# 落地时再复制就会得到三份必然漂移的表示。等价性由两者既有单测证明。

CFG_TEST_RE = re.compile(r"#\s*\[\s*cfg\s*\(\s*test\s*\)")


def cfg_test_line_ranges(lines: list) -> list:
    """`#[cfg(test)] mod tests { … }` 的行区间 `[start, end)`（0 基，end 开）。

    `mod tests;`（分号形态）**不产生区间** —— 它没有内联体，内容在 `tests.rs` 里（由调用方的
    路径判据排除）。若照旧向后找第一个 `{`，就会把后面某个真实代码块整段当成测试块而豁免（漏报）。
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


def in_cfg_test_block(line_no: int, ranges: list) -> bool:
    """`line_no`（0 基）是否落在某个内联测试块内。"""
    return any(start <= line_no < end for start, end in ranges)


def mask_cfg_test(text: str) -> str:
    """把内联测试块整体抹成空行 —— **行数与偏移保持不变**，调用方的行号 / offset 仍然有效。"""
    lines = text.splitlines(keepends=True)
    for start, end in cfg_test_line_ranges([ln.rstrip("\r\n") for ln in lines]):
        for k in range(start, min(end, len(lines))):
            lines[k] = "\n" if lines[k].endswith("\n") else ""
    return "".join(lines)
