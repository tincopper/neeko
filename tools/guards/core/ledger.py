"""台账加载 —— 期望值数据（分类表、体积上限、签名表）的统一入口。

框架只负责「文件在不在、能不能解析、必填键齐不齐、集合是不是空」；
**数据语义**（某个分类是否合法、计数是否漂移）由持有它的那条 guard 判定 —— 框架不
长业务知识，否则每加一条护栏都要动框架。
"""
from __future__ import annotations

import json
import pathlib

LEDGER_DIR = pathlib.Path(__file__).resolve().parents[1] / "ledger"


class LedgerError(RuntimeError):
    pass


def load_ledger(name: str, required_keys: tuple[str, ...] = ()) -> dict:
    path = LEDGER_DIR / f"{name}.json"
    if not path.is_file():
        raise LedgerError(f"台账文件缺失：{path.relative_to(LEDGER_DIR.parent)}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LedgerError(f"台账 {path.name} 解析失败：{exc}") from exc
    if not isinstance(data, dict) or not data:
        raise LedgerError(f"台账 {path.name} 必须是顶层非空对象")

    missing = [k for k in required_keys if k not in data]
    if missing:
        raise LedgerError(f"台账 {path.name} 缺少必填键：{', '.join(missing)}")
    empty = [k for k, v in data.items() if isinstance(v, (list, dict, str)) and not v]
    if empty:
        raise LedgerError(
            f"台账 {path.name} 的以下键为空（空台账会让护栏失去判据却仍报 OK）："
            + ", ".join(sorted(empty))
        )
    return data
