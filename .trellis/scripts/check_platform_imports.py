#!/usr/bin/env python3
"""
Platform import guard: 确保平台专属 import 与使用点同 cfg 门控。

背景：`src-tauri/src/common/utils/fonts.rs` 曾因 `BTreeSet` / `Path` 仅在
`#[cfg(target_os = "macos")]` 分支使用，却在文件顶部无条件 `use`，导致
Linux/Windows 上 `clippy -D warnings` 报 `unused_imports`（CI 三平台矩阵才暴露）。

规则：若一个 `use` 未被 `#[cfg(...)]` 直接门控，但其引入的符号在文件中
仅出现在 `#[cfg(target_os = ...)]` / `#[cfg(unix)]` / `#[cfg(windows)]` 等
平台门控块内，则视为违规——应给 `use` 加同条件的 `#[cfg]`，或将代码
抽入 `src-tauri/src/platform/<theme>/`。

检查范围：`src-tauri/src/**/*.rs`
匹配：无 cfg 门控的 `use` + 符号仅在 cfg 平台块内使用
豁免：已带 `#[cfg(...)]` 的 `use`；符号在非 cfg 上下文也有使用则放行

用法：python3 .trellis/scripts/check_platform_imports.py
退出码 0 = 通过；非 0 = 检出违规。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "src-tauri" / "src"

# 识别平台 cfg：target_os / unix / windows 及其组合
CFG_PLATFORM_RE = re.compile(r"#\s*\[\s*cfg\s*\([^]]*target_os[^]]*\)")
CFG_PLATFORM_ALT_RE = re.compile(r"#\s*\[\s*cfg\s*\([^]]*\b(unix|windows)\b[^]]*\)")
CFG_TEST_RE = re.compile(r"#\s*\[\s*cfg\s*\(\s*test\s*\)")

USE_RE = re.compile(r"^\s*use\s+([^;]+);")
# 提取 use 引入的符号名（最后一段或 {} 内列表）
# 例：std::collections::BTreeSet -> BTreeSet
#     std::path::{Path, PathBuf} -> Path, PathBuf
#     std::path::Path as MyPath -> MyPath


def extract_imported_names(use_body: str) -> list[str]:
    # 去掉注释尾部
    body = use_body.split("//")[0].strip()
    # 处理 as 别名：取 as 后
    # 处理 {} 列表
    names: list[str] = []
    # 先按逗号/分号外的顶层分割？简化：找 {} 块
    brace_m = re.search(r"\{([^}]+)\}", body)
    if brace_m:
        inner = brace_m.group(1)
        for part in inner.split(","):
            part = part.strip()
            if not part:
                continue
            # 处理 as
            if " as " in part:
                part = part.split(" as ")[-1].strip()
            # 去掉可能的 self/super
            names.append(part.strip())
        # 同时处理 {} 外的别名？通常只有 {} 内
        return names
    # 无 {}：取最后一段 :: 后
    # 处理多 use 如 `use foo::bar::{A, B}` 已在上面处理；此处处理单路径
    # 去掉 as
    if " as " in body:
        alias = body.split(" as ")[-1].strip().split()[0].strip()
        return [alias]
    # 取 :: 最后一段
    # 可能包含 `use foo::bar::Baz;` -> Baz
    # 可能包含 `use foo::bar::*;` -> 跳过 glob
    if "::*" in body:
        return []
    last = body.split("::")[-1].strip()
    # 去掉可能的泛型/空格
    last = re.split(r"[^A-Za-z0-9_]", last)[0]
    if last and last not in ("self", "super", "crate"):
        return [last]
    return []


def has_cfg_gate(lines: list[str], idx: int) -> bool:
    # 检查 use 所在行之前 1-3 行是否有 #[cfg(...)] 且包含平台相关
    for j in range(max(0, idx - 3), idx):
        if CFG_PLATFORM_RE.search(lines[j]) or CFG_PLATFORM_ALT_RE.search(lines[j]):
            return True
    return False


def find_cfg_gated_ranges(lines: list[str], pattern: re.Pattern[str] | None = None) -> list[tuple[int, int]]:
    """返回所有平台 cfg 门控的函数/模块范围 [start, end) 行号。"""
    ranges: list[tuple[int, int]] = []
    n = len(lines)
    i = 0
    use_re = pattern or CFG_PLATFORM_RE
    # 允许传入组合判断：默认同时匹配 PLATFORM_RE 与 ALT_RE
    def is_platform_cfg(line: str) -> bool:
        if pattern is not None:
            return bool(pattern.search(line))
        return bool(CFG_PLATFORM_RE.search(line) or CFG_PLATFORM_ALT_RE.search(line))
    while i < n:
        line = lines[i]
        if is_platform_cfg(line):
            # 找到门控后，找下一个非空非注释的 item 行
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            # 跳过 doc comment / attribute 连续行
            while j < n and lines[j].strip().startswith("#["):
                j += 1
                while j < n and not lines[j].strip():
                    j += 1
            if j >= n:
                i += 1
                continue
            item_line = lines[j].strip()
            # 仅处理带块的 item：fn / mod / impl / struct+{} / enum+{}
            is_block_item = any(
                item_line.startswith(prefix)
                for prefix in ("fn ", "pub fn ", "async fn ", "pub async fn ", "mod ", "pub mod ", "impl ", "struct ", "pub struct ", "enum ", "pub enum ", "pub(crate) mod ", "pub(super) mod ")
            ) or (" fn " in item_line and "{" in item_line)
            # 更宽松：若该行或后续行包含 {，视为块
            has_brace = "{" in "".join(lines[j : j + 3])
            if is_block_item and has_brace:
                # 找起始 { 所在行
                brace_start = j
                while brace_start < n and "{" not in lines[brace_start]:
                    brace_start += 1
                if brace_start >= n:
                    i = j + 1
                    continue
                # 括号匹配到对应 }
                depth = 0
                end = brace_start
                for k in range(brace_start, n):
                    for ch in lines[k]:
                        if ch == "{":
                            depth += 1
                        elif ch == "}":
                            depth -= 1
                            if depth == 0:
                                end = k
                                break
                    if depth == 0 and k >= brace_start:
                        break
                # 包含 cfg 行到块结束
                ranges.append((i, end + 1))
                i = end + 1
                continue
            else:
                # 单行门控 use / const 等，无块，仅标记该 item 行
                ranges.append((i, j + 1))
        i += 1
    return ranges


def is_inside_ranges(line_no: int, ranges: list[tuple[int, int]]) -> bool:
    for s, e in ranges:
        if s <= line_no < e:
            return True
    return False


def scan_file(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    lines = text.splitlines()
    # 快速过滤：文件若无任何平台 cfg，直接放行
    has_platform_cfg = any(CFG_PLATFORM_RE.search(l) or CFG_PLATFORM_ALT_RE.search(l) for l in lines)
    if not has_platform_cfg:
        return []

    cfg_ranges = find_cfg_gated_ranges(lines)
    test_ranges = find_cfg_gated_ranges(lines, CFG_TEST_RE)
    problems: list[str] = []

    for idx, line in enumerate(lines):
        m = USE_RE.match(line)
        if not m:
            continue
        # 已在平台 cfg 块或 test 块内的 use 本身已门控，无需再检查
        if is_inside_ranges(idx, cfg_ranges) or is_inside_ranges(idx, test_ranges):
            continue
        if has_cfg_gate(lines, idx):
            continue
        # 跳过文件内已注释的 use
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        use_body = m.group(1)
        names = extract_imported_names(use_body)
        if not names:
            continue
        for name in names:
            # 在文件内搜索该符号的出现（排除 use 行本身）
            # 统计所有出现行
            usages: list[int] = []
            for j, l in enumerate(lines):
                if j == idx:
                    continue
                # 粗略：单词边界匹配
                if re.search(rf"\b{re.escape(name)}\b", l):
                    usages.append(j)
            if not usages:
                # 未使用但非平台相关？可能是其他 lint 会报，但此处也视为可疑
                # 仅当文件含平台 cfg 且符号是常见平台类型时才报，避免噪音
                # 保守：无任何使用则跳过（由 unused_imports 本身会报）
                continue
            # 若所有使用都在 cfg 门控范围内，则违规
            all_inside = all(is_inside_ranges(u, cfg_ranges) for u in usages)
            if all_inside:
                # 额外确认：至少有一个 cfg 范围确实包含该符号，避免误报
                rel = path.relative_to(ROOT)
                problems.append(
                    f"{rel}:{idx+1}: unconditional `use` of `{name}` only used inside #[cfg(target_os/...)] blocks — add #[cfg(target_os = \"...\")] to the `use` or move to src-tauri/src/platform/<theme>/"
                )
                break  # 每条 use 只报一次

    return problems


def main() -> int:
    if not SRC_DIR.exists():
        print(f"[platform-import-guard] src dir not found: {SRC_DIR}", file=sys.stderr)
        return 0

    all_problems: list[str] = []
    for rs_file in sorted(SRC_DIR.rglob("*.rs")):
        all_problems.extend(scan_file(rs_file))

    if all_problems:
        print("[platform-import-guard] 平台专属 import 未门控（非目标平台会触发 unused_imports，-D warnings 下编译失败）：", file=sys.stderr)
        for p in all_problems:
            print(f"  {p}", file=sys.stderr)
        print(file=sys.stderr)
        print("修复：给 `use` 加同条件的 `#[cfg(target_os = \"...\")]`，或将代码抽入 `src-tauri/src/platform/<theme>/`（见 .trellis/spec/backend/quality-guidelines.md#平台差异集中化）。", file=sys.stderr)
        return 1

    print("[platform-import-guard] ok — no unguarded platform imports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
