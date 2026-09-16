#!/usr/bin/env python3
"""防复发护栏：检查 Git 测试是否对工作区换行做字节级精确断言。

背景（第一性原理）：Neeko 是 Git 客户端，同时面对两个内容视图——
- **git 归一化视图**（blob / diff / status）：受 text/autocrlf 影响时统一 LF，平台无关、确定；
- **工作区物化字节**：由平台 + git 配置决定。Windows 上 git 默认 `core.autocrlf=true`，
  会把 stash/checkout/discard/apply 等 git 写操作落盘的工作区内容转成 CRLF。

因此「`read_to_string` 读工作区文件 → `assert_eq!` 与字符串字面量精确比较」的测试
在 Windows CI 上必然挂（回归样例：`git_test::stash_apply_restores_changes_keeps_entry`）。

本脚本检出该模式（read_to_string 绑定的变量随后被 assert_eq! 引用）。

## 精确化：什么时候**不**构成风险（2026-09-16 补）

前提是「字节可能由 **git** 物化」。若同一函数里**自己写了这个路径**（`fs::write` / `File::create`），
且函数内**没有任何 git 操作**，那么读回的字节就是测试自己写进去的那些 —— 与 autocrlf 无关，
断言在任何平台都成立。这类读**豁免**（`logger.rs::write_through_rotate_log_file_keeps_append_handle`）。

豁免刻意**保守**（宁可多报不可漏报）：

- 同一函数出现任何 git 术语（`git` / `stash` / `checkout` / `apply` / `discard` / `commit` /
  `TestRepo` / `init_repo`）→ **不豁免**（先前自写的字节可能已被 git 重新物化）；
- 路径由 helper 传入（如 `repo.write_file("a.txt", …)`，字面量而非局部变量）→ **不豁免**。

不豁免时请按下方「修复要求」处理，不要往本脚本塞白名单。

修复要求：
- 测试仓库统一用确定性 builder（集成侧 `tests/unit/support.rs::TestRepo`、
  lib 侧 `operations.rs::init_repo`：仓库级 `core.autocrlf=false` + 提交
  `.gitattributes * -text` 双保险）；
- 必须断言工作区字节时，走行尾无关比较（`support::assert_content_eq` / `assert_worktree_eq`），
  或优先在 git 归一化视图（status/diff）上断言。

用法：python3 .trellis/scripts/check_worktree_byte_assertions.py [--list]
退出码 0 = 通过；非 0 = 检出违规 / 仓库根不可判定 / 扫描集为空。

> 历史（勿重犯）：本脚本曾用 `parents[3]` 定位仓库根 —— 那解析到仓库的**父目录**，两个扫描目录
> 都不存在并被 `if not d.exists(): continue` 静默跳过，于是它接在 `pnpm lint` 与 CI 上却**什么都没检查**
> （恒打印 OK）。现改为向上找 `.git` + `src-tauri`，且**扫描集为空直接判失败**并打印扫描数。
"""
from __future__ import annotations

import pathlib
import re
import sys

READ_RE = re.compile(r"(?:std::fs|tokio::fs)::read_to_string")
TARGET_DIRS = ("src-tauri/src", "src-tauri/tests")

# 同一函数里出现这些词 → 该函数的「自写豁免」作废（字节可能已被 git 重新物化）
GIT_TERMS = re.compile(
    r"\bgit\b|stash|checkout|apply|discard|\bcommit\b|TestRepo|init_repo", re.IGNORECASE
)
# 「自己写了这个路径」的信号
LOCAL_WRITE_RE = re.compile(
    r"(?:std::fs|tokio::fs)::write\s*\(\s*&?(\w+)|File::create\s*\(\s*&?(\w+)"
)


def find_repo_root() -> pathlib.Path:
    """向上找同时含 .git 与 src-tauri 的目录；找不到即失败（不静默降级 —— 见模块头历史）。"""
    for parent in pathlib.Path(__file__).resolve().parents:
        if (parent / ".git").exists() and (parent / "src-tauri").is_dir():
            return parent
    print("FATAL: 找不到仓库根（需同时含 .git 与 src-tauri/）—— 拒绝在未知根上静默通过。")
    sys.exit(2)


ROOT = find_repo_root()


def function_spans(text: str) -> list[tuple[int, int]]:
    """每个 `fn` 体的字符区间（按花括号配对；跳过字符串/字符字面量）。"""
    spans: list[tuple[int, int]] = []
    for m in re.finditer(r"\bfn\s+\w+", text):
        open_brace = text.find("{", m.end())
        if open_brace < 0:
            continue
        depth = 0
        i = open_brace
        while i < len(text):
            ch = text[i]
            if ch == '"':  # 字符串字面量（含 b"…"）：跳到收尾引号
                i += 1
                while i < len(text) and text[i] != '"':
                    i += 2 if text[i] == "\\" else 1
            elif ch == "'":  # 字符字面量：跳过 'x' / '\n'（花括号不参与配对）
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


def enclosing_span(offset: int, spans: list[tuple[int, int]]) -> tuple[int, int] | None:
    """包含该偏移的最内层函数区间。"""
    best: tuple[int, int] | None = None
    for start, end in spans:
        if start <= offset <= end and (best is None or (end - start) < (best[1] - best[0])):
            best = (start, end)
    return best


def scan_file(path: pathlib.Path) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    """返回 (违规, 豁免)。"""
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
    spans = function_spans(text)

    def is_self_authored(read_offset: int, read_var: str | None) -> bool:
        """同一函数内自己写过该路径、且函数内无 git 操作 → 字节非 git 物化。"""
        if not read_var:
            return False
        span = enclosing_span(read_offset, spans)
        if span is None:
            return False
        body = text[span[0] : span[1]]
        if GIT_TERMS.search(body):
            return False
        return any(read_var in m.groups() for m in LOCAL_WRITE_RE.finditer(body))

    # 1) 收集绑定自 read_to_string 的变量名
    #    注意：**不能**按变量名做 dict —— 不同测试常复用同一个名字（如 `content`），
    #    按名字索引会让它们互相覆盖，从而把 A 的绑定当成 B 的（原实现即有此隐患：
    #    报告的片段可能取自另一个测试）。故存成列表，断言处按「同函数优先」挑选。
    bindings: list[tuple[str, int, str | None]] = []  # (var, 字节偏移, read 的路径变量)
    for i, ln in enumerate(plain):
        m = READ_RE.search(ln)
        if not m:
            continue
        b = re.search(r"\blet\s+(\w+)\s*=", ln[: m.start()])
        if b:
            arg = re.match(r"\s*\(\s*&?(\w+)", ln[m.end() :])
            bindings.append((b.group(1), m.start() + offsets[i], arg.group(1) if arg else None))

    # 2) 找 assert_eq! 第一个实参（可跨行）：若实参精确等于 read 绑定变量（其后紧跟 `,`，
    #    而非 `.replace(...)` 等表达式），即为「字节级精确断言」。
    hits: list[tuple[int, str]] = []
    exempt: list[tuple[int, str]] = []
    for i, ln in enumerate(plain):
        for m in re.finditer(r"assert_eq!\s*\(", ln):
            after = text[offsets[i] + m.end() :]
            am = re.match(r"\s*(\w+)", after)
            if not am:
                continue
            var = am.group(1)
            rest = after[am.end() :]
            # 精确使用：var 后首个非空字符是 `,`；若为 `.`（如 .replace(...)）则视为已归一化，放行
            if not re.match(r"\s*,", rest):
                continue
            assert_offset = offsets[i] + m.start()
            cands = [b for b in bindings if b[0] == var]
            if not cands:
                continue
            same_fn = [b for b in cands if enclosing_span(b[1], spans) == enclosing_span(assert_offset, spans)]
            pool = same_fn or [b for b in cands if b[1] <= assert_offset] or cands
            read_offset, read_var = max(pool, key=lambda b: b[1])[1:]
            target = exempt if is_self_authored(read_offset, read_var) else hits
            target.append((i + 1, ln.strip()))
            break

    return hits, exempt


def main() -> int:
    list_mode = bool({"--list", "-l"} & set(sys.argv[1:]))
    problems: list[str] = []
    exemptions: list[str] = []
    scanned = 0

    for rel in TARGET_DIRS:
        d = ROOT / rel
        if not d.exists():
            continue
        for path in sorted(d.rglob("*.rs")):
            scanned += 1
            hits, exempt = scan_file(path)
            problems.extend(f"{path.relative_to(ROOT)}:{n}: {t}" for n, t in hits)
            exemptions.extend(f"{path.relative_to(ROOT)}:{n}: {t}" for n, t in exempt)

    # 自检：扫描集不得为空（防「空转静默通过」）
    if scanned == 0:
        print(f"FATAL: 在 {TARGET_DIRS} 下扫到 0 个 .rs 文件 —— 口径失效，拒绝通过。")
        return 2

    if list_mode:
        print(f"扫描 {scanned} 个 .rs：违规 {len(problems)}、豁免 {len(exemptions)}")
        for e in exemptions:
            print(f"  [豁免] {e}")

    if problems:
        print("发现对工作区换行做字节级精确断言的测试（Windows/autocrlf 下必挂）：")
        for p in problems:
            print(f"  {p}")
        print()
        print("修复：优先用 git 归一化视图（status/diff）做 oracle；必须读字节时，")
        print("走行尾无关比较（support::assert_content_eq / assert_worktree_eq），")
        print("或使用确定性测试仓库（TestRepo / init_repo：autocrlf=false + * -text）。")
        return 1

    print(
        f"OK: 未发现对工作区换行做字节级精确断言的测试"
        f"（扫描 {scanned} 个 .rs，豁免 {len(exemptions)} 处为测试自写文件）。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
