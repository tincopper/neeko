"""Neeko 护栏框架 —— 把「仓库状态 → 判定」收敛成一次调用、一份清单。

注册表 = `guards/checks/` 目录本身（见 core/registry.py）。新增一条护栏只需往该目录
放一个模块，不需要改动本包任何已有文件，也不需要改 package.json / CI / lefthook。
"""

__all__ = ["checks", "core"]
