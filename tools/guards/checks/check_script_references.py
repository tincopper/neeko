"""hook / CI / 文档里引用的 `pnpm <script>` 必须真的在 package.json 里。

背景（2026-09-30 门禁整理）：`lint` / `test` 的语义被重新定义，同时删掉了 4 个脚本名
（`lint:fe:static` / `lint:all` / `lint:host` / `test:run`）。改名本身不难，难的是**调用点**
—— lefthook.yml、ci.yml、AGENTS.md、两份 CONTRIBUTING、`.trellis/spec/**` 里有十几处引用。
漏改一处的后果分两档：写了一个**不存在**的脚本名，pnpm 会报错（吵，但能发现）；写了**语义
已经变了**的旧名，它照样成功（静默变弱）。本护栏把第一档钉死，第二档靠语义变更必须过评审。

判据：扫描有限的**实时面**（hook / CI / 仓库级文档 / spec 树），把每处 `pnpm <name>` 的
name 与 package.json 的 scripts 键比对。

为什么不是「全仓 md」：`.trellis/workspace/` 的 journal、`.trellis/tasks/` 的归档、
`docs/superpowers/` 的历史计划、`.qoder/worktrees/` 的旧副本里**必然**留着旧名 —— 那是历史
记录，改它们等于篡改历史。实时面是可枚举的，所以清单写在这里，而不是撒一张会误伤历史的大网。

`pnpm <x>` 里 x 不一定是脚本名，三类例外：
- pnpm 自己的子命令（`install` / `add` / `run` / `exec` / `-C ... run` …）：`-C` 这类以 `-` 开头
  的形态正则直接不匹配，等于跳过；
- 转发给 `node_modules/.bin` 的 CLI（`pnpm lefthook install`）：不是脚本，列在 FORWARDED_BINS。
  `pnpm tauri dev` 不需要在这里列 —— `tauri` 本身就是 package.json 里的脚本名；
- 版本叙述：`注意 pnpm v11 不读 overrides` 这种句子里的 `v11` 是版本号，不是命令（实测命中过
  一次），按 RE_VERSION_TOKEN 跳过，且不计入引用计数。
"""
from __future__ import annotations

import json
import re

from guards.core.contract import Context, Finding, Guard, GuardResult

PACKAGE_JSON = "package.json"

# 实时面：hook / CI / 仓库级文档 / spec 树 + 两个构建配置（它们的注释里也会写脚本名，
# 实测 vitest.config.ts 的注释就写了 `pnpm test:coverage` —— 改名时同样要改）。
SCAN_PATTERNS = (
    "lefthook.yml",
    ".github/workflows/*.yml",
    ".github/pull_request_template.md",
    ".github/BRANCH_PROTECTION.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "CONTRIBUTING_CN.md",
    "docs/*.md",
    ".trellis/spec/**/*.md",
    "vite.config.ts",
    "vitest.config.ts",
)

PNPM_BUILTINS = frozenset(
    {
        "add",
        "audit",
        "bin",
        "config",
        "create",
        "dedupe",
        "deploy",
        "dlx",
        "doctor",
        "env",
        "exec",
        "fetch",
        "filter",
        "get",
        "help",
        "import",
        "init",
        "install",
        "licenses",
        "link",
        "list",
        "ls",
        "node",
        "outdated",
        "pack",
        "patch",
        "patch-commit",
        "prune",
        "publish",
        "rebuild",
        "recursive",
        "remove",
        "rm",
        "root",
        "run",
        "self-update",
        "set",
        "setup",
        "store",
        "uninstall",
        "unlink",
        "up",
        "update",
        "upgrade",
        "v",
        "version",
        "why",
    }
)

# 转发给 node_modules/.bin 的 CLI（不是脚本名，但 `pnpm <name>` 合法）。
FORWARDED_BINS = frozenset({"lefthook"})

# `pnpm <name>` 与 `pnpm run <name>`：`(?:run\s+)?` 让两种写法落到同一个捕获组。
RE_PNPM = re.compile(r"\bpnpm\s+(?:run\s+)?([A-Za-z][\w:.-]*)")

# 版本叙述（`pnpm v11 不读 overrides` / `pnpm 11.25.0`）不是命令调用。
RE_VERSION_TOKEN = re.compile(r"^v?\d[\w.:-]*$")

GUARD = Guard(
    id="check_script_references",
    title="hook / CI / 文档引用的 pnpm 脚本名必须存在（改名不许漏调用点）",
    scopes=(
        PACKAGE_JSON,
        "lefthook.yml",
        ".github/workflows/",
        ".github/pull_request_template.md",
        ".github/BRANCH_PROTECTION.md",
        "AGENTS.md",
        "CONTRIBUTING.md",
        "CONTRIBUTING_CN.md",
        "docs/",
        ".trellis/spec/",
        "vite.config.ts",
        "vitest.config.ts",
    ),
    red_lines=(),
    fix_hint=(
        "把引用改成 package.json 里存在的脚本名；删脚本时同步改掉全部调用点"
        "（hook / CI / AGENTS.md / CONTRIBUTING / .trellis/spec）"
    ),
)


def _known_names(ctx: Context) -> tuple[set, str]:
    """package.json 的 scripts 键 + pnpm 内建 + 转发 CLI。返回 (names, error)。"""
    path = ctx.path(PACKAGE_JSON)
    if not path.is_file():
        return set(), f"{PACKAGE_JSON} 不存在 —— 无法判定脚本名是否有效"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return set(), f"{PACKAGE_JSON} 读取/解析失败：{type(exc).__name__}: {exc}"
    scripts = data.get("scripts")
    if not isinstance(scripts, dict) or not scripts:
        return set(), "package.json 没有任何 scripts —— 判据口径已失效"
    return set(scripts) | PNPM_BUILTINS | FORWARDED_BINS, ""


def check(ctx: Context) -> GuardResult:
    known, error = _known_names(ctx)
    if error:
        return GuardResult.broken(error)

    files = sorted({path for pattern in SCAN_PATTERNS for path in ctx.glob(pattern)})
    if not files:
        return GuardResult.broken(
            "实时面一个文件都没扫到 —— SCAN_PATTERNS 或仓库布局已变，本护栏实际什么都没查"
        )

    findings: list[Finding] = []
    seen: set[tuple[str, int, str]] = set()
    refs = 0
    for path in files:
        rel = ctx.rel(path)
        for lineno, line in enumerate(
            path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1
        ):
            for match in RE_PNPM.finditer(line):
                name = match.group(1)
                if RE_VERSION_TOKEN.match(name):
                    continue
                refs += 1
                if name in known or (rel, lineno, name) in seen:
                    continue
                seen.add((rel, lineno, name))
                findings.append(
                    Finding(
                        f"`pnpm {name}` 不是 package.json 的脚本名"
                        "（也不是 pnpm 内建命令或转发 CLI）",
                        rel,
                        lineno,
                    )
                )

    metrics = f"{len(files)} 个文件 / {refs} 处 pnpm 引用 / {len(known)} 个已知名字"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
