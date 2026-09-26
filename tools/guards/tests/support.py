"""测试公共设施 —— 夹具路径一律由 tempdir 推导（不在任何夹具里硬编码绝对路径）。"""
from __future__ import annotations

import pathlib
import tempfile

from guards.core.contract import Context


def make_repo(root: pathlib.Path, files: dict) -> pathlib.Path:
    """按 `{相对路径: 内容}` 造一棵临时仓库树。"""
    for rel, content in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return root


def context(root: pathlib.Path, changed=(), list_mode: bool = False) -> Context:
    return Context(repo_root=root, changed=frozenset(changed), list_mode=list_mode)


def temp_repo(test: object) -> pathlib.Path:
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    return pathlib.Path(tmp.name)
