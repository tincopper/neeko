"""被 `include_str!` 编进二进制的文本资产，必须在 `.gitattributes` 里钉 `eol=lf`。

## 第一性原理

`include_str!` 嵌入的是**宿主工作区的字节**。Windows 上 `core.autocrlf=true` 的 checkout
会把 `.ts` / `.js` / `.mjs` 落成 CRLF，于是：

1. 二进制里带着**平台相关的换行** —— 同一份源码在 macOS 与 Windows 构建出不同字节；
2. 任何跨行断言（`contains("a;\\n  b;")`）本地绿、`windows-latest` 红。

2026-11-05 实测（红线 11 的同族事故）：`templates_gate_child_sessions_at_a_single_registration_point`
在 Windows 报「pi 模板的 onStatus 包装器缺子会话门」，而**模板正文一字不差** —— 只是被落成了
CRLF。断言侧已改为读归一化视图（`template_text`），本护栏钉住另一半：**资产本身**不该随宿主变形。

## 判据

对每个 `src-tauri/src/**/*.rs` 里的 `include_str!("literal")`：

- 解析目标路径（相对该 `.rs` 文件所在目录），
- 该路径必须被 `.gitattributes` 里某条含 `eol=lf`（或 `-text`）的模式命中。

`include_bytes!` **不在**口径内：字节包含意的调用方（图标、字体）本来就不该被文本归一化，
对它们要求 `eol=lf` 反而会损坏文件。非字面量目标（`concat!` / `env!`）判违规 —— 无法静态
解析就等于没人检查，那是本仓库反复踩过的「恒绿」失效（见 check_worktree_byte_assertions
模块头的两次事故）。

## 边界（如实声明）

模式匹配只实现 `.gitattributes` 的常用子集：字面路径、`*`（不跨 `/`）、`**`（跨 `/`）。
带 `!` / `[...]` 的模式**不被本护栏理解** —— 结果是不会被算作「命中了 eol=lf」，于是目标会被
判违规（fail-closed：宁可要求作者改用一个可判读的写法，也不静默放行）。
"""
from __future__ import annotations

import fnmatch
import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCAN_SCOPE = "src-tauri/src/**/*.rs"
ATTRS_FILE = ".gitattributes"
# 钉住「文本、LF」的属性写法；`-text` 是显式的二进制意图，同样满足「不再随宿主变形」。
EOL_LF_ATTRS = ("eol=lf", "-text")

INCLUDE_STR_RE = re.compile(r'include_str!\s*\(\s*"([^"]*)"\s*\)')
INCLUDE_UNRESOLVED_RE = re.compile(r"include_str!\s*\(\s*(?!\")")

GUARD = Guard(
    id="check_embedded_asset_eol",
    title="include_str! 编进二进制的文本资产必须在 .gitattributes 里钉 eol=lf",
    scopes=(SCAN_SCOPE, ATTRS_FILE),
    red_lines=(11,),
    docs=".trellis/spec/unit-test/backend-testing.md",
    fix_hint=(
        "在 .gitattributes 里给该资产加 `<pattern> text eol=lf`（通常按目录写一条）；"
        "若它本来就不是文本（图标 / 字体），改用 include_bytes!"
    ),
)


def load_pinned_patterns(ctx: Context) -> list[str] | None:
    """`.gitattributes` 里所有「钉住 LF」的模式（相对仓库根）；文件缺席时返回 None。"""
    if not ctx.path(ATTRS_FILE).is_file():
        return None
    patterns: list[str] = []
    for raw in ctx.read_tolerant(ATTRS_FILE).splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        pattern, attrs = parts[0], parts[1:]
        if any(a in EOL_LF_ATTRS for a in attrs):
            patterns.append(pattern)
    return patterns


def _match_segments(pattern_segs: list[str], path_segs: list[str]) -> bool:
    if not pattern_segs:
        return not path_segs
    head, rest = pattern_segs[0], pattern_segs[1:]
    if head == "**":
        # `**` 吃掉 0..n 段
        for skip in range(len(path_segs) + 1):
            if _match_segments(rest, path_segs[skip:]):
                return True
        return False
    if not path_segs:
        return False
    if not fnmatch.fnmatchcase(path_segs[0], head):
        return False
    return _match_segments(rest, path_segs[1:])


def is_pinned(patterns: list[str], target: str) -> bool:
    """`target`（仓库根相对，正斜杠）是否被某条钉住 LF 的模式命中。"""
    path_segs = target.split("/")
    for pattern in patterns:
        # 不含 `/` 的模式在 git 里匹配任意层级，这里按「逐层尝试」实现等价语义。
        if "/" not in pattern:
            if any(fnmatch.fnmatchcase(seg, pattern) for seg in path_segs):
                return True
            continue
        if _match_segments(pattern.split("/"), path_segs):
            return True
    return False


def check(ctx: Context) -> GuardResult:
    patterns = load_pinned_patterns(ctx)
    if patterns is None:
        return GuardResult.broken(f"缺少 {ATTRS_FILE} —— 嵌入资产的换行无法钉定", scanned=0)
    if not patterns:
        # 一条钉住都没读到时，本护栏对任何资产都会判违规 —— 那多半是 .gitattributes
        # 被改名/清空的信号，报失效比刷一屏违规更有用。
        return GuardResult.broken(
            f"{ATTRS_FILE} 里没有任何 eol=lf / -text 条目 —— 判据无法生效", scanned=0
        )

    findings: list[Finding] = []
    targets: set[str] = set()
    scanned = 0

    for rs in ctx.glob(SCAN_SCOPE):
        text = ctx.read_tolerant(ctx.rel(rs))
        if "include_str!" not in text:
            continue
        scanned += 1
        for idx, line in enumerate(text.splitlines(), start=1):
            for match in INCLUDE_STR_RE.finditer(line):
                raw_target = match.group(1)
                base = rs.parent
                resolved = (base / raw_target).resolve()
                try:
                    rel = resolved.relative_to(ctx.repo_root.resolve()).as_posix()
                except ValueError:
                    findings.append(
                        Finding(f"include_str! 目标在仓库之外: {raw_target}", ctx.rel(rs), idx)
                    )
                    continue
                targets.add(rel)
                if not is_pinned(patterns, rel):
                    findings.append(
                        Finding(
                            f"嵌入资产未被钉成 eol=lf: {rel}"
                            f"（Windows checkout 会落 CRLF ⇒ 二进制含平台换行 + 跨行断言必挂）",
                            ctx.rel(rs),
                            idx,
                        )
                    )
            if INCLUDE_UNRESOLVED_RE.search(line):
                findings.append(
                    Finding(
                        "include_str! 用了非字面量路径，本护栏无法判定其换行（"
                        "改成字面量，或改用 include_bytes! 并说明理由）",
                        ctx.rel(rs),
                        idx,
                    )
                )

    metrics = f"{scanned} 个含 include_str! 的 .rs / {len(targets)} 个资产 / 钉住模式 {len(patterns)}"
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics)
    return GuardResult.passed(scanned, metrics=metrics)
