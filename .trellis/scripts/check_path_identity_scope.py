#!/usr/bin/env python3
"""防复发护栏：路径「形态重写」出现点必须全部登记并分类。

## 第一性原理（为什么需要它）

「这是不是同一个文件」只允许有一个判据 —— `shared/utils/fileRef.ts` 里的 `FileRef` 身份。
一旦某个消费方自己写字符串归一（`\\`→`/`、去尾斜杠）或别名匹配（后缀/前缀/拼接比较），
同一份文件就有了第二种表示：黄线在、光标不在；断点 key 两套；变更事件漏配导致视图不刷新。
issue #13 的切片 1+2 修了写入侧、切片 3 修了比较侧，**本脚本负责让这件事不再回退**。

## 背景教训（本脚本存在的直接原因）

切片 3 的 R1 义务是产出一张「路径归一结论表」。第一版把口径写成**叙述**
（「grep `replace(/\\\\/g, '/')` 共 28 处」）而**从未执行**：实测 36 处 / 24 文件，
表格漏掉 3 个文件 —— 其中 `useBrowserTab.ts` 与 `useBrowserPanelEvents` 是同一个 bug 的孪生副本，
因漏分类而没被修。**口径写成叙述 = 没执行**；本脚本把口径变成可执行断言。

## 口径（本脚本定义的「形态重写」）

`src/**/*.{ts,tsx}`（不含 `__tests__`）中，`String.replace` / `replaceAll` 形态的路径重写：

| 类别 | 形态 | 语义 |
|---|---|---|
| `backslash` | `replace(/\\\\/g, …)` / `replaceAll('\\\\', …)` | Windows/WSL 反斜杠 → 斜杠 |
| `collapse` | `replace(/\\/+/g, …)` | 连续斜杠压缩 |
| `strip` | `replace(/\\/+$/, …)` | 去尾斜杠 |

**边界（如实声明，不过度声称）**：

- `split('/').filter(…).join('/')` 形态（如身份所有者的私有 `normalizeSlashes`）**不在**口径内
  —— 它与身份所有者同住，由「单一归属」保证，不构成消费侧自造归一；
- 别名匹配（`endsWith('/' + p)`、`` `${root}/${rel}` === p ``）**不在**口径内 —— 该形态噪声过大。
  它由另一条机制覆盖：这类代码通常**同时**含上面的形态重写（`useBrowserTab` 即如此），
  因此会以「未登记命中」的形式被本脚本拦下。

## 判据

| 分类 | 含义 | 处理 |
|---|---|---|
| `owner` | 身份所有者（`src/shared/utils/fileRef.ts`）—— 全仓唯一允许做形态归一的地方 | 必须恰为 1 条 |
| `legit` | 合法的展示 / URL / 树结构 / 命令入参派生 / 边界归一（**不参与同文件判定**） | 登记 |
| `debt` | ★ 已确认属**身份判定**但尚未收敛（已知残留） | 登记 + 脚本结尾列出；不阻断（避免因既存低危项被整体关掉） |

## 修复要求

任何新增命中都必须：

1. 优先**删除**它，改用身份所有者（`sameIdentity` / `pathsContainFile` / `canonicalFsPath`）；
2. 若确属展示/派生，登记到下面的 `MANIFEST`（分类 + 一句「为什么不是身份判定」）。

## 自检（防「空转静默通过」）

本仓库发生过一次真实事故：`check_worktree_byte_assertions.py` 用 `parents[3]` 定位仓库根，
解析成仓库的**父目录**，扫描集恒为空，于是它接在 `pnpm lint` 与 CI 上却**什么都没检查**
（恒打印 OK；2026-09-16 修复，见该脚本模块头的「历史」段）。本脚本因此强制：
**扫描文件数为 0 直接判失败**，并把扫描数打印出来。

用法：python3 .trellis/scripts/check_path_identity_scope.py [--list]
退出码 0 = 通过；非 0 = 未登记命中 / 登记失效 / 计数漂移 / 扫描集为空。
"""
from __future__ import annotations

import pathlib
import re
import sys

OWNER = "src/shared/utils/fileRef.ts"


# ── 仓库根：向上找同时含 .git 与 src 的目录；找不到即失败（不静默降级）──────────
def find_repo_root() -> pathlib.Path:
    here = pathlib.Path(__file__).resolve()
    for parent in here.parents:
        if (parent / ".git").exists() and (parent / "src").is_dir():
            return parent
    print("FATAL: 找不到仓库根（需同时含 .git 与 src/）—— 拒绝在未知根上静默通过。")
    sys.exit(2)


ROOT = find_repo_root()
SRC = ROOT / "src"

# ── 口径：路径形态重写 ────────────────────────────────────────────────────────
PATTERNS: dict[str, re.Pattern[str]] = {
    "backslash": re.compile(r"replace\(/\\\\/g|replaceAll\('\\\\'"),
    "collapse": re.compile(r"replace\(/\\/\+/g"),
    "strip": re.compile(r"replace\(/\\/\+\\?\$/"),
}

# ── 台账（机读口径的唯一事实源）──────────────────────────────────────────────
# path: (classification, {pattern: count}, note)
MANIFEST: dict[str, tuple[str, dict[str, int], str]] = {
    # ── 身份所有者（唯一允许归一处）──
    OWNER: ("owner", {"backslash": 7}, "身份所有者：canonicalFsPath / relativeToRoot / relativeToRootOrNull 在此归一"),
    # ── 展示 / 解析 / 派生（不参与同文件判定）──
    "src/ui/MarkdownPreview.tsx": ("legit", {"backslash": 3}, "图片 src → asset: URL 构建"),
    "src/shared/components/ChangeFileTree.tsx": ("legit", {"backslash": 1}, "变更列表建树（按 / 分段）"),
    "src/shared/utils/fileTree.ts": ("legit", {"backslash": 1}, "取文件名用于显示"),
    "src/shared/utils/browserUtils.ts": ("legit", {"backslash": 3}, "相对→绝对解析 + file:// URL 构建"),
    "src/shared/utils/languageRegistry.ts": ("legit", {"backslash": 2}, "取扩展名/文件名查语言表"),
    "src/shared/utils/markdownLinks.ts": ("legit", {"backslash": 2, "strip": 1}, "md 内链 → 绝对路径"),
    "src/shared/utils/gitFileDecoration.ts": ("legit", {"backslash": 1, "strip": 1}, "git 输出路径 → 内部 map key"),
    "src/features/editor/breadcrumb.ts": ("legit", {"backslash": 1, "strip": 1}, "面包屑分段展示"),
    "src/features/editor/hooks/useFileEditorState.ts": ("legit", {"backslash": 1}, "预览/资源基准目录"),
    "src/features/git/components/diff/diffViewUtils.ts": ("legit", {"backslash": 1}, "diff 行「文件名 + 目录」"),
    "src/features/git/components/gitlog/commitListUtils.ts": ("legit", {"backslash": 1}, "commit 行「文件名 + 目录」"),
    "src/features/git/components/ChangesSection.tsx": ("legit", {"strip": 1}, "折叠目录占位行显示名剥离尾斜杠"),
    "src/features/git/hooks/useUntrackedDirExpansion.ts": ("legit", {"strip": 1}, "兼容旧 payload 的命令入参归一"),
    "src/features/lsp/api/languageMap.ts": ("legit", {"backslash": 2}, "路径 → LSP file:// uri"),
    "src/features/project/utils/cloneFormUtils.ts": ("legit", {"strip": 1}, "从 git URL 推导项目名（URL 派生）"),
    "src/features/quick-open/fileIndex.ts": ("legit", {"backslash": 2}, "文件索引条目（派生，不做同文件判定）"),
    "src/features/symbol-nav/store/symbolNavStore.ts": ("legit", {"backslash": 1}, "引用项标签取 basename"),
    "src/features/file/utils/fileTreeUtils.ts": ("legit", {"backslash": 1}, "各级父目录（树展开）"),
    "src/features/file/utils/javaPackageTree.ts": ("legit", {"backslash": 2}, "判定 Java 源根（树结构）"),
    "src/features/runner/languages/go/pkg.ts": ("legit", {"backslash": 2}, "文件所在目录相对 module 根（命令派生）"),
    "src/features/runner/languages/java/commands.ts": ("legit", {"backslash": 1}, "路径布局 → FQCN（命令派生）"),
    "src/features/runner/languages/rust/commands.ts": ("legit", {"backslash": 1}, "路径形状 → cargo target flag（命令派生）"),
}

VALID_KINDS = {"owner", "legit", "debt"}


def scan() -> tuple[int, dict[str, dict[str, int]]]:
    """扫 src/ 生产代码，返回 (扫描文件数, {相对路径: {pattern: count}})。"""
    files = [
        p
        for p in sorted(SRC.rglob("*.ts")) + sorted(SRC.rglob("*.tsx"))
        if "__tests__" not in p.parts
    ]
    hits: dict[str, dict[str, int]] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        per = {name: len(rx.findall(text)) for name, rx in PATTERNS.items()}
        per = {name: n for name, n in per.items() if n}
        if per:
            hits[path.relative_to(ROOT).as_posix()] = per
    return len(files), hits


def main() -> int:
    list_mode = bool({"--list", "-l"} & set(sys.argv[1:]))
    scanned, hits = scan()

    # 自检①：扫描集不得为空（防「空转静默通过」）
    if scanned == 0:
        print(f"FATAL: 在 {SRC} 下扫到 0 个文件 —— 口径失效，拒绝通过。")
        return 2

    problems: list[str] = []

    # 自检②：未登记命中 —— 这是本脚本最主要的拦截目标
    for path in sorted(set(hits) - set(MANIFEST)):
        detail = ", ".join(f"{k}×{v}" for k, v in sorted(hits[path].items()))
        problems.append(f"未登记命中: {path}（{detail}）")

    # 自检③：登记失效（条目已无命中）
    for path in sorted(set(MANIFEST) - set(hits)):
        problems.append(f"登记失效: {path}（已无命中，请从 MANIFEST 删除）")

    # 自检④：计数漂移（同一文件新增/删除了归一）
    def fmt(counts: dict[str, int]) -> str:
        return "、".join(f"{k}×{v}" for k, v in sorted(counts.items())) or "无"

    for path in sorted(set(MANIFEST) & set(hits)):
        expected = MANIFEST[path][1]
        if expected != hits[path]:
            problems.append(f"计数漂移: {path}（登记 {fmt(expected)}，实测 {fmt(hits[path])}）")

    # 自检⑤：分类合法 + owner 恰为一条
    for path, (kind, _, _) in sorted(MANIFEST.items()):
        if kind not in VALID_KINDS:
            problems.append(f"分类非法: {path} = {kind!r}（只允许 {' / '.join(sorted(VALID_KINDS))}）")
    owners = [p for p, (k, _, _) in MANIFEST.items() if k == "owner"]
    if owners != [OWNER]:
        problems.append(f"owner 必须恰为 {OWNER}，实测 {owners}")

    if list_mode:
        print(f"扫描 {scanned} 个文件，命中 {len(hits)} 个文件 / {sum(sum(v.values()) for v in hits.values())} 处")
        for path in sorted(hits):
            kind = MANIFEST.get(path, ("未登记",))[0]
            print(f"  [{kind:8}] {path}  {hits[path]}")

    if problems:
        print("路径形态重写台账与代码不一致：")
        for p in problems:
            print(f"  {p}")
        print()
        print("修复：优先改走身份所有者（sameIdentity / pathsContainFile / sameFile）；")
        print("确属展示/派生的，在 .trellis/scripts/check_path_identity_scope.py 的 MANIFEST 登记")
        print("（分类 + 一句「为什么不是身份判定」），并把计数改成实测值。")
        return 1

    counts = {k: sum(1 for _, (kind, _, _) in MANIFEST.items() if kind == k) for k in sorted(VALID_KINDS)}
    total = sum(sum(v.values()) for v in hits.values())
    print(
        f"OK: 路径形态重写台账一致 —— 扫描 {scanned} 个文件、命中 {len(hits)} 个文件 / {total} 处，"
        f"全部已分类（owner {counts['owner']} / legit {counts['legit']} / debt {counts['debt']}）。"
    )
    for path, (kind, _, note) in sorted(MANIFEST.items()):
        if kind == "debt":
            print(f"     [debt] {path}: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
