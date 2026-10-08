"""运行平台标签 —— 全仓唯一一处 `sys.platform` 判定。

命令门禁声明 `platforms`，框架据此决定「跑 / 显式跳过」。把判定收在这里，是为了让
`runner` 不再各自写 `sys.platform.startswith(...)`（那正是「同一规则抄成多份」的形状）。
"""
from __future__ import annotations

import sys


def platform_tag() -> str:
    """把 `sys.platform` 归一到 `contract.PLATFORMS` 的词汇表。"""
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform in ("win32", "cygwin", "msys"):
        return "windows"
    return sys.platform
