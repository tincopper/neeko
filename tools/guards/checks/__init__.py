"""护栏模块集 —— **这个目录就是注册表**。

每个模块导出两样东西：`GUARD`（contract.Guard，含 stage / scope / 关联红线）与
`check(ctx) -> GuardResult`。放进本目录即完成注册，不需要改框架、package.json、
CI 或 lefthook 的任何一处。配套单测必须叫 `tests/test_<模块名>.py`，由注册表强制。
"""
