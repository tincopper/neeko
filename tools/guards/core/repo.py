"""仓库根定位 + scope 匹配 —— 全仓唯一一处实现。

原先 6 条护栏里有 3 套定位法：`parents[2]` ×3、`parent.parent.parent` ×1、向上找
`.git` + 某个 marker ×2（两条 marker 还各不相同）。`parents[N]` 是其中最危险的一种：
它把「脚本放在第几层目录」硬编码进常量，一旦移动就解析到父目录的父目录，扫描集恒为空
却照样打印 OK —— 本仓库 2026-09-16 的真实事故正是这个形状。

因此这里只认**语义 marker**（同时含 `.git` 与 `package.json`），找不到就直接失败，
绝不降级到一个「看起来像根」的目录。
"""
from __future__ import annotations

import pathlib
import re
from typing import Iterable

MARKERS = (".git", "package.json")


class RepoRootNotFound(RuntimeError):
    pass


def find_repo_root(start: pathlib.Path | None = None) -> pathlib.Path:
    here = (start or pathlib.Path(__file__).resolve()).parent
    for candidate in (here, *here.parents):
        if all((candidate / marker).exists() for marker in MARKERS):
            return candidate
    raise RepoRootNotFound(
        f"找不到仓库根（需同时含 {' 与 '.join(MARKERS)}）—— 拒绝在未知根上静默通过。"
    )


def _glob_to_regex(glob: str) -> re.Pattern:
    """posix glob → 正则：`**/` 跨任意目录、`**` 任意字符、`*`/`?` 不跨 `/`。"""
    out: list[str] = []
    i = 0
    while i < len(glob):
        ch = glob[i]
        if ch == "*":
            if glob[i : i + 3] == "**/":
                out.append("(?:.*/)?")
                i += 3
            elif glob[i : i + 2] == "**":
                out.append(".*")
                i += 2
            else:
                out.append("[^/]*")
                i += 1
            continue
        out.append("[^/]" if ch == "?" else ("\\" + ch if ch in ".+^$()[]{}|\\" else ch))
        i += 1
    return re.compile("^" + "".join(out) + "$")


def _expand(glob: str) -> tuple[str, ...]:
    """目录型 scope（不含通配符）等价于「该路径本身 + 其下任意深度的任何文件」。"""
    if "*" in glob or "?" in glob:
        return (glob,)
    base = glob.rstrip("/")
    return (base, f"{base}/**") if base else ("**",)


def matches_any(globs: Iterable[str], path: str) -> bool:
    return any(_glob_to_regex(g).match(path) for glob in globs for g in _expand(glob))


def intersects(globs: Iterable[str], paths: Iterable[str]) -> bool:
    """改动集是否触及该护栏的 scope（用于 pre-commit 跳过无关护栏）。

    注意：它只决定**跑不跑**，不缩小扫描集 —— 台账类护栏必须全量比对才能发现计数漂移。
    """
    globs = list(globs)
    return any(matches_any(globs, path) for path in paths)
