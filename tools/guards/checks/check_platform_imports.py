"""平台专属 import 必须与使用点同 cfg 门控。

背景：`src-tauri/src/common/utils/fonts.rs` 曾把 `BTreeSet` / `Path` 无条件 `use` 在文件
顶部，却只在 `#[cfg(target_os = "macos")]` 分支里用 —— Linux/Windows 上 `clippy
-D warnings` 报 unused_imports，而宿主机（macOS）的单平台 clippy 看不见，只能靠 CI 三平台
矩阵兜底。本护栏让它在 macOS 本机就暴露。

判据（不变）：无 cfg 门控的 `use`，其引入符号在文件内的**所有**出现都落在平台 cfg 块内
→ 违规。符号完全未使用则放行（交给 unused_imports 本身，避免两处口径重复）。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPE = "src-tauri/src/**/*.rs"

CFG_PLATFORM_RE = re.compile(r"#\s*\[\s*cfg\s*\([^]]*target_os[^]]*\)")
CFG_PLATFORM_ALT_RE = re.compile(r"#\s*\[\s*cfg\s*\([^]]*\b(unix|windows)\b[^]]*\)")
CFG_TEST_RE = re.compile(r"#\s*\[\s*cfg\s*\(\s*test\s*\)")
USE_RE = re.compile(r"^\s*use\s+([^;]+);")
BLOCK_PREFIXES = (
    "fn ",
    "pub fn ",
    "async fn ",
    "pub async fn ",
    "mod ",
    "pub mod ",
    "impl ",
    "struct ",
    "pub struct ",
    "enum ",
    "pub enum ",
    "pub(crate) mod ",
    "pub(super) mod ",
)

GUARD = Guard(
    id="check_platform_imports",
    title="平台专属 `use` 必须带同条件 #[cfg]，或抽入 src-tauri/src/platform/<theme>/",
    scopes=(SCOPE,),
    red_lines=(10,),
    docs=".trellis/spec/backend/quality-guidelines.md",
    fix_hint=(
        '给 `use` 加同条件的 #[cfg(target_os = "...")]，或把该段代码抽入 '
        "src-tauri/src/platform/<theme>/（红线 10：平台差异集中化）"
    ),
)


def extract_imported_names(use_body: str) -> list:
    body = use_body.split("//")[0].strip()
    brace = re.search(r"\{([^}]+)\}", body)
    if brace:
        names = []
        for part in brace.group(1).split(","):
            part = part.strip()
            if part:
                names.append(part.split(" as ")[-1].strip() if " as " in part else part)
        return names
    if " as " in body:
        return [body.split(" as ")[-1].strip().split()[0].strip()]
    if "::*" in body:
        return []
    last = re.split(r"[^A-Za-z0-9_]", body.split("::")[-1].strip())[0]
    return [last] if last and last not in ("self", "super", "crate") else []


def has_cfg_gate(lines: list, idx: int) -> bool:
    for j in range(max(0, idx - 3), idx):
        if CFG_PLATFORM_RE.search(lines[j]) or CFG_PLATFORM_ALT_RE.search(lines[j]):
            return True
    return False


def is_platform_cfg(line: str) -> bool:
    return bool(CFG_PLATFORM_RE.search(line) or CFG_PLATFORM_ALT_RE.search(line))


def find_cfg_gated_ranges(lines: list, pattern=None) -> list:
    """所有平台 cfg 门控的块范围 [start, end)。pattern 用于复用同一段解析跑 test 块。"""

    def gate(line: str) -> bool:
        return bool(pattern.search(line)) if pattern else is_platform_cfg(line)

    ranges: list[tuple[int, int]] = []
    n = len(lines)
    i = 0
    while i < n:
        if not gate(lines[i]):
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
        item_line = lines[j].strip()
        is_block_item = any(item_line.startswith(p) for p in BLOCK_PREFIXES) or (
            " fn " in item_line and "{" in item_line
        )
        if not (is_block_item and "{" in "".join(lines[j : j + 3])):
            ranges.append((i, j + 1))
            i += 1
            continue
        brace_start = j
        # 上面已要求 lines[j:j+3] 里含 `{`，因此这里必然能找到，无需再防越界。
        while "{" not in lines[brace_start]:
            brace_start += 1
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
        ranges.append((i, end + 1))
        i = end + 1
    return ranges


def is_inside_ranges(line_no: int, ranges: list) -> bool:
    return any(start <= line_no < end for start, end in ranges)


def scan_file(ctx: Context, path) -> list:
    try:
        text = ctx.read_tolerant(ctx.rel(path))
    except OSError:
        return []
    lines = text.splitlines()
    if not any(is_platform_cfg(ln) for ln in lines):
        return []

    cfg_ranges = find_cfg_gated_ranges(lines)
    test_ranges = find_cfg_gated_ranges(lines, CFG_TEST_RE)
    findings: list[Finding] = []

    for idx, line in enumerate(lines):
        match = USE_RE.match(line)
        if not match:
            continue
        if is_inside_ranges(idx, cfg_ranges) or is_inside_ranges(idx, test_ranges):
            continue
        if has_cfg_gate(lines, idx) or line.strip().startswith("//"):
            continue
        names = extract_imported_names(match.group(1))
        for name in names:
            usages = [
                j for j, ln in enumerate(lines) if j != idx and re.search(rf"\b{re.escape(name)}\b", ln)
            ]
            if usages and all(is_inside_ranges(u, cfg_ranges) for u in usages):
                findings.append(
                    Finding(
                        f"无条件 `use` 的 `{name}` 只在平台 #[cfg] 块内使用",
                        ctx.rel(path),
                        idx + 1,
                    )
                )
                break
    return findings


def check(ctx: Context) -> GuardResult:
    files = ctx.glob(SCOPE)
    findings: list[Finding] = []
    for rs_file in files:
        findings.extend(scan_file(ctx, rs_file))

    metrics = f"{len(files)} 个 .rs / {len(findings)} 处未门控"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
