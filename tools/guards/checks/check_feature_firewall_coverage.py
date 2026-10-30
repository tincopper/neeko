"""Import/Export 防火墙覆盖面护栏 —— `FEATURE_DIRS` 必须等于磁盘上的 feature 目录集合。

第一性原理：防火墙的**判据集**是 `.eslintrc.cjs` 里手写的 `FEATURE_DIRS` 数组。
「手写清单 ↔ 磁盘目录」之间没有任何机制约束，于是新增一个 feature 目录 = 该域的跨域私有
导入（以及别的域对它的私有导入）**一整块区域没有规则** —— 这不是「少一条规则」，是
`import/no-restricted-paths` 根本没为那个目录生成 zone，ESLint 不会报任何错。
2026-10-30 实测：`agent-chat` 与 `search` 双双缺席，`src/app` 因此可以直引
`@/features/agent-chat/hooks/useChatResumableAgents` 而没人拦 —— 门面规则看起来存在，
实际对这两个域不成立。

判据（双向，缺一不可）：

- **磁盘有、清单无** → 覆盖面缺口（本护栏存在的理由）；
- **清单有、磁盘无** → 陈旧条目（清单不再描述现实，zone 指向不存在的路径）。

两侧都**不**断言规则正文 —— 正文仍单一事实源在 `.eslintrc.cjs`（zone 由 `FEATURE_DIRS`
派生，不需要第二处列举）。本护栏只保证「清单 ↔ 现实」这个映射成立。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

ESLINT_CONFIG = ".eslintrc.cjs"
FEATURES_DIR = "src/features"

# feature 根下不是「域」的目录：测试与工具目录。豁免必须显式且可读 ——
# 用「看起来不像 feature」这类形状推断，等于把判据藏进命名习惯。
NON_FEATURE_DIRS = frozenset({"__tests__", "tests", "__snapshots__", "node_modules"})

RE_FEATURE_DIRS_BLOCK = re.compile(r"const\s+FEATURE_DIRS\s*=\s*\[(.*?)\];", re.DOTALL)
RE_QUOTED = re.compile(r"['\"]([^'\"]+)['\"]")

GUARD = Guard(
    id="check_feature_firewall_coverage",
    title="FEATURE_DIRS 必须与 src/features 的目录一一对应（防火墙不允许有盲区）",
    scopes=(ESLINT_CONFIG, "src/features/**"),
    docs=".trellis/spec/frontend/quality-guidelines.md",
    fix_hint=(
        "新增 feature 目录时，在同一 diff 内把它加进 .eslintrc.cjs 的 FEATURE_DIRS；"
        "删目录时同步删条目（清单必须描述现实，否则该域的跨域私有导入不受任何约束）"
    ),
)


def declared_feature_dirs(source: str) -> list[str] | None:
    """从 ESLint 配置里取出 `FEATURE_DIRS` 的字符串项；块缺失返回 `None`。

    返回 `None` 而不是空列表：块被改名/重构时**必须**报护栏失效（退出码 2），
    不能退化成「清单为空所以每个目录都缺」或「没找到就跳过」。
    """
    match = RE_FEATURE_DIRS_BLOCK.search(source)
    if match is None:
        return None
    return RE_QUOTED.findall(match.group(1))


def disk_feature_dirs(ctx: Context) -> list[str] | None:
    """`src/features/` 下真实存在的 feature 目录名；根目录缺失返回 `None`。"""
    root = ctx.path(FEATURES_DIR)
    if not root.is_dir():
        return None
    return sorted(
        entry.name
        for entry in root.iterdir()
        if entry.is_dir() and entry.name not in NON_FEATURE_DIRS and not entry.name.startswith(".")
    )


def declaration_line(source: str) -> int:
    """`FEATURE_DIRS` 声明所在行（1 起），让 CI 能把报告钉回可编辑的那一行。"""
    for idx, line in enumerate(source.splitlines(), start=1):
        if "const FEATURE_DIRS" in line:
            return idx
    return 0


def check(ctx: Context) -> GuardResult:
    source = ctx.read_tolerant(ESLINT_CONFIG)
    declared = declared_feature_dirs(source)
    if declared is None:
        return GuardResult.broken(
            f"{ESLINT_CONFIG} 里找不到 `const FEATURE_DIRS = [...]` 块 —— "
            "防火墙覆盖面无从判定（改结构时请同步本护栏）"
        )

    on_disk = disk_feature_dirs(ctx)
    if on_disk is None:
        return GuardResult.broken(f"{FEATURES_DIR}/ 不存在 —— 扫描集为空，判定无意义")

    line = declaration_line(source)
    declared_set = set(declared)
    disk_set = set(on_disk)
    findings: list[Finding] = []

    for name in sorted(disk_set - declared_set):
        findings.append(
            Finding(
                f"feature 目录 `{name}` 不在 FEATURE_DIRS：该域（以及别人引用它）的跨域私有导入"
                "当前完全不受防火墙约束",
                ESLINT_CONFIG,
                line,
            )
        )
    for name in sorted(declared_set - disk_set):
        findings.append(
            Finding(
                f"FEATURE_DIRS 里的 `{name}` 在 {FEATURES_DIR}/ 下不存在：清单已不描述现实，"
                "对应 zone 指向不存在的路径",
                ESLINT_CONFIG,
                line,
            )
        )

    scanned = len(disk_set) + len(declared_set)
    metrics = f"{len(disk_set)} 个目录 / 清单 {len(declared_set)} 条 / {len(findings)} 处违规"
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics)
    return GuardResult.passed(scanned, metrics=metrics)
