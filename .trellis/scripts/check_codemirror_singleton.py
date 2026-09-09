#!/usr/bin/env python3
"""
CodeMirror singleton guard: pnpm-lock.yaml 中 @codemirror/view 必须只保留一个版本。

背景：Vite 预打包曾产出两个 @codemirror/view 实例（live 6.43.9 vs source
6.43.11），mouseClickGuard 的 facet 无法匹配 live EditorView，导致滚动后
点击光标错位。根治靠 pnpm.overrides 单一版本 + vite resolve.dedupe。

检查：解析 pnpm-lock.yaml 的 packages/snapshots 段，收集所有
'@codemirror/view@<version>' 条目去重；版本数 != 1 时 exit 1 并打印版本与来源。
失败时 exit 1，成功打印 ok。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "pnpm-lock.yaml"

# 顶层包条目：  '@codemirror/view@6.43.11':
RE_PKG_ENTRY = re.compile(r"^ {2}'@codemirror/view@([^']+)':\s*$")
# 快照内依赖引用：      '@codemirror/view': 6.43.9
RE_SNAPSHOT_REF = re.compile(r"'@codemirror/view':\s*([0-9][^,\s]*)")


def main() -> int:
    if not LOCK.exists():
        print(f"[codemirror-singleton] lockfile not found: {LOCK}", file=sys.stderr)
        return 1

    versions: set[str] = set()
    referrers: dict[str, list[str]] = {}
    current_pkg = ""
    for line in LOCK.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = RE_PKG_ENTRY.match(line)
        if m:
            versions.add(m.group(1))
            current_pkg = line.strip().rstrip(":")
            continue
        # 快照段顶层 key（两个空格缩进、非引用行）→ 更新当前包上下文
        if line.startswith("  ") and not line.startswith("   ") and line.rstrip().endswith(":"):
            current_pkg = line.strip().rstrip(":")
            continue
        rm = RE_SNAPSHOT_REF.search(line)
        if rm:
            ver = rm.group(1).strip().strip("'\"")
            referrers.setdefault(ver, [])
            if current_pkg and current_pkg not in referrers[ver]:
                referrers[ver].append(current_pkg)

    if len(versions) != 1:
        print(
            f"[codemirror-singleton] duplicate @codemirror/view versions: {sorted(versions)} (expected exactly 1)",
            file=sys.stderr,
        )
        for ver in sorted(versions):
            refs = referrers.get(ver, [])
            print(f"  {ver} referenced by: {', '.join(refs[:8]) or '(unknown)'}", file=sys.stderr)
        print(
            "  fix: pin pnpm.overrides \"@codemirror/view\" to the single version + vite resolve.dedupe",
            file=sys.stderr,
        )
        return 1

    print(f"[codemirror-singleton] ok — single @codemirror/view {sorted(versions)[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
