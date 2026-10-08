"""gate 声明加载与 schema 校验 —— 编排层的单一事实源。

第一性原理（design §1）：门禁里没有具体工具链的名字，只有三个物理量 ——
**判据**（从仓库状态到三态的函数）、**上下文**（有限可枚举）、**聚合**（多个结论收敛成
一个退出码）。进程内判据已经由 `checks/` 目录注册；外部命令门禁只是一个「argv + 退出码」
的函数，因此它可以完全声明在**一份数据文件**里，由本模块加载成 `tuple[Gate, ...]`。

本模块的职责边界：

- 复用 `ledger.load_ledger` 做「文件在不在 / 能不能解析 / 顶层非空 / 必填键」；
- 在本层做**二级 schema 校验**：未知键即报错（拼错 `stage` 不许静默按默认值生效）、
  id 形态、重复 id、以及 `Gate` 自身 `__post_init__` 的字段级校验；
- **id 与既有 `checks/` 的冲突检测不在这里** —— 那需要注册表全貌，由 `registry.discover`
  合并两源时统一判定（见 core/registry.py）。
"""
from __future__ import annotations

import dataclasses
import pathlib
import re

from .contract import Gate
from .ledger import LedgerError, load_ledger

GATES_LEDGER = "gates"
_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class GateLedgerError(RuntimeError):
    """gate 声明不合法 —— 属于「门禁自身坏了」（退出码 2），不是代码违规。"""


def _allowed_keys() -> frozenset:
    """允许键 = `dataclasses.fields(Gate)` 的 id 集合 —— 单一事实源，不手抄。"""
    return frozenset(f.name for f in dataclasses.fields(Gate))


def load_gates(path: pathlib.Path | None = None) -> tuple[Gate, ...]:
    """加载并校验 gates 台账。`path` 仅测试注入；生产走 `ledger/gates.json`。"""
    try:
        data = load_ledger(GATES_LEDGER, required_keys=("gates",), path=path)
    except LedgerError as exc:
        raise GateLedgerError(str(exc)) from exc
    return parse_gates(data["gates"])


def parse_gates(entries) -> tuple[Gate, ...]:
    """把 `gates` 数组解析为 `tuple[Gate, ...]`；问题一次性收集完再抛。"""
    if not isinstance(entries, list):
        raise GateLedgerError("gates 必须是数组")
    if not entries:
        raise GateLedgerError("gates 不能为空 —— 空注册表会以「全绿」通过")

    allowed = _allowed_keys()
    singular = "、".join(sorted(allowed))
    gates: list[Gate] = []
    seen: set[str] = set()
    problems: list[str] = []

    for index, entry in enumerate(entries):
        where = f"gates[{index}]"
        if not isinstance(entry, dict):
            problems.append(f"{where}: 每条 gate 必须是对象")
            continue

        gate_id = entry.get("id")
        if isinstance(gate_id, str) and gate_id:
            where = f"gate {gate_id}"

        unknown = sorted(set(entry) - allowed)
        if unknown:
            problems.append(f"{where}: 未知键 {', '.join(unknown)}（允许：{singular}）")
            continue

        if not isinstance(gate_id, str) or not _ID_RE.match(gate_id):
            problems.append(
                f"{where}: id 必须匹配 {_ID_RE.pattern}（当前 {gate_id!r}）"
            )
            continue

        if gate_id in seen:
            problems.append(f"{where}: id 重复 —— 两条门禁同名会让 CLI 无法区分")
            continue
        seen.add(gate_id)

        try:
            gates.append(Gate(**_as_tuples(entry)))
        except (TypeError, ValueError) as exc:
            problems.append(f"{where}: {exc}")

    if problems:
        raise GateLedgerError("\n".join(problems))
    return tuple(gates)


_SEQUENCE_KEYS = ("scopes", "stages", "red_lines", "platforms", "argv")


def _as_tuples(entry: dict) -> dict:
    """JSON 只能表达数组；契约字段声明为 tuple。在唯一的反序列化边界统一归一。"""
    normalized = dict(entry)
    for key in _SEQUENCE_KEYS:
        if isinstance(normalized.get(key), list):
            normalized[key] = tuple(normalized[key])
    return normalized
