"""`@codemirror/view` 在 pnpm-lock.yaml 里必须只有一个版本。

背景：Vite 预打包曾产出两个 view 实例（live 6.43.9 vs source 6.43.11），
mouseClickGuard 的 facet 匹配不上 live EditorView，导致滚动后点击光标错位。
根治靠 pnpm.overrides 单一版本 + vite resolve.dedupe，本护栏钉住结果。

判据变化（迁移时故意改的一点）：原实现在「一个条目都没解析到」时报「duplicate
versions: []」—— 那是 lockfile 格式变了（解析口径失效），属于护栏自己坏了，
不是依赖违规，现在按 scanned=0 交由框架判退出码 2。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

LOCKFILE = "pnpm-lock.yaml"
PACKAGE = "@codemirror/view"

RE_PKG_ENTRY = re.compile(r"^ {2}'@codemirror/view@([^']+)':\s*$")
RE_SNAPSHOT_REF = re.compile(r"'@codemirror/view':\s*([0-9][^,\s]*)")

GUARD = Guard(
    id="check_codemirror_singleton",
    title="pnpm-lock.yaml 中 @codemirror/view 必须只解析出一个版本",
    scopes=(LOCKFILE, "pnpm-workspace.yaml", "vite.config.ts"),
    docs=".trellis/spec/frontend/quality-guidelines.md",
    fix_hint=(
        'pnpm-workspace.yaml 的 pnpm.overrides 把 "@codemirror/view" 钉到单版本，'
        "并在 vite.config.ts 配 resolve.dedupe；改完重新 pnpm install"
    ),
)


def check(ctx: Context) -> GuardResult:
    lock = ctx.path(LOCKFILE)
    if not lock.is_file():
        return GuardResult.broken(f"lockfile 不存在：{LOCKFILE}")

    versions: set[str] = set()
    referrers: dict[str, list[str]] = {}
    current_pkg = ""

    for line in lock.read_text(encoding="utf-8", errors="ignore").splitlines():
        entry = RE_PKG_ENTRY.match(line)
        if entry:
            versions.add(entry.group(1))
            current_pkg = line.strip().rstrip(":")
            continue
        if line.startswith("  ") and not line.startswith("   ") and line.rstrip().endswith(":"):
            current_pkg = line.strip().rstrip(":")
            continue
        ref = RE_SNAPSHOT_REF.search(line)
        if ref:
            ver = ref.group(1).strip().strip("'\"")
            bucket = referrers.setdefault(ver, [])
            if current_pkg and current_pkg not in bucket:
                bucket.append(current_pkg)

    if not versions:
        return GuardResult.broken(
            f"{LOCKFILE} 里一个 {PACKAGE} 条目都没解析到 —— lockfile 格式可能已变，"
            "本护栏的解析口径随之失效",
            scanned=0,
        )
    metrics = f"{len(versions)} 个版本 / {len(referrers)} 处引用"
    if len(versions) == 1:
        return GuardResult.passed(len(versions), metrics=f"{sorted(versions)[0]}（唯一）")

    findings = [Finding(f"lockfile 里出现 {sorted(versions)}，期望恰好 1 个")]
    for ver in sorted(versions):
        refs = referrers.get(ver, [])
        findings.append(
            Finding(f"{ver} 被引用于 {', '.join(refs[:8]) or '(未知)'}", LOCKFILE)
        )
    return GuardResult.violated(len(versions), findings, metrics=metrics)
