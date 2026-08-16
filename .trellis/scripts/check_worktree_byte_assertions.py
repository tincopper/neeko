#!/usr/bin/env python3
"""防复发护栏：检查 Git 测试是否对工作区换行做字节级精确断言。

背景（第一性原理）：Neeko 是 Git 客户端，同时面对两个内容视图——
- **git 归一化视图**（blob / diff / status）：受 text/autocrlf 影响时统一 LF，平台无关、确定；
- **工作区物化字节**：由平台 + git 配置决定。Windows 上 git 默认 `core.autocrlf=true`，
  会把 stash/checkout/discard/apply 等 git 写操作落盘的工作区内容转成 CRLF。

因此「`read_to_string` 读工作区文件 → `assert_eq!` 与字符串字面量精确比较」的测试
在 Windows CI 上必然挂（回归样例：`git_test::stash_apply_restores_changes_keeps_entry`）。

本脚本检出该模式（read_to_string 绑定的变量随后被 assert_eq! 引用）。

修复要求：
- 测试仓库统一用确定性 builder（集成侧 `tests/unit/support.rs::TestRepo`、
  lib 侧 `operations.rs::init_repo`：仓库级 `core.autocrlf=false` + 提交
  `.gitattributes * -text` 双保险）；
- 必须断言工作区字节时，走行尾无关比较（`support::assert_content_eq` /
  `assert_worktree_eq`），或优先在 git 归一化视图（status/diff）上断言。

用法：python3 .trellis/scripts/check_worktree_byte_assertions.py
退出码 0 = 通过；非 0 = 检出违规。
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC_DIRS = [ROOT / "src-tauri" / "src", ROOT / "src-tauri" / "tests"]

READ_RE = re.compile(r"(?:std::fs|tokio::fs)::read_to_string")


def scan_file(path: pathlib.Path) -> list[tuple[int, str]]:
    text = path.read_text(encoding="utf-8")
    # keepends=True：行分隔符长度按真实字节计（LF 或 CRLF 均正确），
    # 保证后续按字节偏移定位 assert_eq! 实参时不受源文件换行风格影响。
    lines = text.splitlines(keepends=True)
    offsets: list[int] = []
    off = 0
    for ln in lines:
        offsets.append(off)
        off += len(ln)
    plain = [ln.rstrip("\r\n") for ln in lines]

    # 1) 收集绑定自 read_to_string 的变量名
    bound: dict[str, int] = {}
    for i, ln in enumerate(plain):
        m = READ_RE.search(ln)
        if not m:
            continue
        b = re.search(r"\blet\s+(\w+)\s*=", ln[: m.start()])
        if b:
            bound[b.group(1)] = i + 1

    # 2) 找 assert_eq! 第一个实参（可跨行）：若实参精确等于 read 绑定变量（其后紧跟 `,`
    #    而非 `.replace(...)` 等表达式），即为「字节级精确断言」违规。
    hits: list[tuple[int, str]] = []
    for i, ln in enumerate(plain):
        for m in re.finditer(r"assert_eq!\s*\(", ln):
            after = text[offsets[i] + m.end():]
            am = re.match(r"\s*(\w+)", after)
            if not am:
                continue
            var = am.group(1)
            rest = after[am.end():]
            # 精确使用：var 后首个非空字符是 `,`；若为 `.`（如 .replace(...)）则视为已归一化，放行
            if var in bound and re.match(r"\s*,", rest):
                hits.append((i + 1, ln.strip()))
                break

    return hits


def main() -> int:
    problems: list[str] = []
    for d in SRC_DIRS:
        if not d.exists():
            continue
        for path in sorted(d.rglob("*.rs")):
            for line_no, text in scan_file(path):
                problems.append(f"{path.relative_to(ROOT)}:{line_no}: {text}")

    if problems:
        print("发现对工作区换行做字节级精确断言的测试（Windows/autocrlf 下必挂）：")
        for p in problems:
            print(f"  {p}")
        print()
        print("修复：优先用 git 归一化视图（status/diff）做 oracle；必须读字节时，")
        print("走行尾无关比较（support::assert_content_eq / assert_worktree_eq），")
        print("或使用确定性测试仓库（TestRepo / init_repo：autocrlf=false + * -text）。")
        return 1

    print("OK: 未发现对工作区换行做字节级精确断言的测试。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
