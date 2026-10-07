"""命令执行必须走统一接口（红线 1 / 2 / 10）。

第一性原理：调用方只描述「跑什么」（命令 + 参数 + cwd + env），「怎么跑」由
`ExecTarget` 对应的 executor 决定。一旦业务层自选 shell（`"sh"` / `"bash"` /
`"cmd"` / `"powershell"`）或自拼 `cd` / env 前缀，执行细节就散落在调用点 —— 换个环境
（Windows 的 `\\\\?\\` 路径、WSL/SSH 的登录 shell）就得每处各修一遍，必然漏。

判据（`src-tauri/src` 的生产代码，排除测试 / `platform/` / 执行层自身）：

- **V1**：把 shell 当命令传 —— shell 名字面量出现在 `SpawnOptions::new` / `run` /
  `collect` / `spawn`（含 `exec` facade 与 `common::executor`）的第一个参数位；
- **V2**：自造 shell 选择 —— 出现 `remote_shell_name` 式选择函数；
- **V3**：绕过统一接口 —— 直接 `std::process::Command` / `tokio::process::Command`
  （或裸名 `Command::new`）。

脚本形态（确有管道 / 重定向 / 用户命令串）的 shell 选择在 `platform::shell_launch::shell_argv`
（由 `LocalExecutor` 消费）与 WSL/SSH executor 的登录脚本（`common/executor/login_script`）——
`platform/` 与 `common/executor/` 都在豁免清单里；统一 facade `core::exec` 不再拼 shell，
因此**不在**豁免清单里（回归会被本条拦下）。

机制详解：`.trellis/spec/backend/command-execution.md`。
"""
from __future__ import annotations

import pathlib
import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src-tauri/src/**/*.rs",)

GUARD = Guard(
    id="check_command_execution",
    title="命令执行统一走 core::exec / common::executor（禁止自选 shell / 直接 spawn）",
    scopes=SCOPES,
    red_lines=(1, 2, 10),
    docs=".trellis/spec/backend/command-execution.md",
    fix_hint=(
        "argv 形态：exec::run/collect/spawn_with + SpawnOptions(cmd,args).with_current_dir/.with_env；"
        "script 形态：exec::collect_script/run_script。禁止把 \"sh\"/\"bash\"/\"cmd\"/\"powershell\" "
        "当 cmd 传，也禁止直接用 std::process::Command"
    ),
)

# 免扫路径（按 posix 片段匹配）：执行层自身、平台适配层、PTY 通道、命令工具函数。
EXEMPT_PATH_PARTS = (
    "src-tauri/src/platform/",
    "src-tauri/src/common/executor/",
    "src-tauri/src/terminal/",
    "src-tauri/src/common/utils/command/",
)
# 免扫文件（相对仓库根）：性能基准（非命令执行路径）。
EXEMPT_FILES = (
    "src-tauri/src/common/git/perf.rs",
)

SHELL_NAMES = ("sh", "bash", "cmd", "powershell", "pwsh")
SHELL_LITERAL_RE = re.compile(r'"(sh|bash|cmd|powershell|pwsh)"')
# 同一语句内、shell 字面量之前出现这些「起进程」符号 → 该字面量是 cmd 实参。
EXEC_TOKEN_RE = re.compile(
    r"(?:SpawnOptions::new|Command::new|::run|::collect|::spawn"
    r"|\brun\s*\(|\bcollect\s*\(|\bspawn\s*\(|\bspawn_with\s*\(|\bcollect_blocking\w*\s*\()"
)
REMOTE_SHELL_RE = re.compile(r"\bremote_shell_name\s*\(")
DIRECT_COMMAND_RE = re.compile(r"(?:(?:std|tokio)::process::)?Command::new\s*\(")
CFG_TEST_RE = re.compile(r"#\s*\[\s*cfg\s*\(\s*test\s*\)")


def is_test_path(rel: str) -> bool:
    return (
        "/tests/" in rel
        or rel.endswith("_tests.rs")
        or rel.endswith("/tests.rs")
        or rel.endswith("/tests/mod.rs")
    )


def is_exempt(rel: str, repo_rel: str) -> bool:
    if any(part in repo_rel for part in EXEMPT_PATH_PARTS):
        return True
    return repo_rel in EXEMPT_FILES or is_test_path(rel)


def cfg_test_ranges(lines: list) -> list:
    """`#[cfg(test)] mod tests { ... }` 的行区间 [start, end)。"""
    ranges: list[tuple] = []
    n = len(lines)
    i = 0
    while i < n:
        if not CFG_TEST_RE.search(lines[i]):
            i += 1
            continue
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
            i = brace + 1 if brace < n else n  # `mod tests;`：无内联体
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


def in_test_block(line_no: int, ranges: list) -> bool:
    return any(start <= line_no <= end for start, end in ranges)


def scan_file(ctx: Context, rel: str, path: pathlib.Path) -> list:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    lines = text.splitlines()
    test_blocks = cfg_test_ranges(lines)

    findings: list[Finding] = []
    seen: set = set()

    # V1：shell 名字面量作为起进程调用的 cmd 实参。
    for m in SHELL_LITERAL_RE.finditer(text):
        start = m.start()
        line_no = text.count("\n", 0, start) + 1
        if in_test_block(line_no, test_blocks):
            continue
        # 同一语句（最后一个 `;` 之后）里必须有起进程符号。
        seg = text[max(0, start - 200) : start].rsplit(";", 1)[-1]
        if not EXEC_TOKEN_RE.search(seg):
            continue
        key = ("V1", line_no)
        if key not in seen:
            seen.add(key)
            findings.append(
                Finding(
                    f'把 shell 当命令传（"{m.group(1)}"）—— 改用 SpawnOptions::new(真实命令, args) '
                    f"或 exec::collect_script",
                    rel,
                    line_no,
                )
            )

    # V2：自造 shell 选择。
    for m in REMOTE_SHELL_RE.finditer(text):
        line_no = text.count("\n", 0, m.start()) + 1
        if in_test_block(line_no, test_blocks):
            continue
        findings.append(
            Finding(
                "自造 shell 选择（remote_shell_name 式）—— shell 选择属于执行层，"
                "应经 platform::shell_launch / executor",
                rel,
                line_no,
            )
        )

    # V3：绕过统一接口的直接 spawn。
    for m in DIRECT_COMMAND_RE.finditer(text):
        line_no = text.count("\n", 0, m.start()) + 1
        if in_test_block(line_no, test_blocks):
            continue
        findings.append(
            Finding(
                "绕过统一接口直接 std/tokio::process::Command —— 改用 core::exec / common::executor",
                rel,
                line_no,
            )
        )
    return findings


def check(ctx: Context) -> GuardResult:
    scanned: dict = {}
    for scope in SCOPES:
        for path in ctx.glob(scope):
            rel = ctx.rel(path)
            repo_rel = rel.lstrip("./")
            if not is_exempt(rel, repo_rel):
                scanned[rel] = path

    findings: list[Finding] = []
    for rel, path in scanned.items():
        findings.extend(scan_file(ctx, rel, path))

    metrics = f"{len(scanned)} 个文件 / {len(findings)} 处违规"
    if findings:
        return GuardResult.violated(len(scanned), findings, metrics=metrics)
    return GuardResult.passed(len(scanned), metrics=metrics)
