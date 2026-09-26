"""护栏自身的单测 —— 每次 `run` 先跑它，失败即「护栏坏了」（退出码 2）。

这不是新增约束，而是把原先手写在 `package.json` 与 `lefthook.yml` 里的
`python3 -m unittest discover -s .trellis/scripts` 收进框架：护栏没有测试就等于没有护栏，
而这条约束不该靠人记得去跑。
"""
from __future__ import annotations

import pathlib
import unittest

from .registry import TESTS_DIR

TOOLS_DIR = TESTS_DIR.parents[1]


def run_suite(stream, start_dir=TESTS_DIR, top_level_dir=TOOLS_DIR) -> tuple[bool, str]:
    """跑一遍护栏单测并回报。`start_dir` 可注入，是为了让「收集到 0 个用例」这条
    反空转分支本身可被测试 —— 否则守门人自己没人守。"""
    suite = unittest.TestLoader().discover(
        start_dir=str(start_dir), pattern="test_*.py", top_level_dir=str(top_level_dir)
    )
    if suite.countTestCases() == 0:
        return False, f"在 {pathlib.Path(str(start_dir)).name}/ 下收集到 0 个用例 —— 拒绝以「全绿」通过。"

    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    return (
        result.wasSuccessful(),
        f"{result.testsRun} 用例 / {len(result.failures)} 失败 / {len(result.errors)} 错误",
    )
