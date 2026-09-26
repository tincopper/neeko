#!/usr/bin/env python3
"""薄启动器：让 `python3 tools/guards/run.py` 在任意 cwd、任意平台可用。

包内模块一律以 `guards.` 绝对导入互相引用，因此必须把 `tools/` 放进 sys.path；
除此之外这里不做任何事 —— 入口逻辑在 `guards.core.cli`。
"""
import pathlib
import sys

_TOOLS_DIR = str(pathlib.Path(__file__).resolve().parents[1])
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)

from guards.core.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
