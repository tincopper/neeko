"""注册表 —— 「有哪些护栏」的唯一事实源 = `guards/checks/` 目录本身。

为什么不用一份显式清单（哪怕只有一份）：清单是会被抄的东西。原先护栏清单同时存在于
`package.json` 的 `&&` 链、`.github/workflows/ci.yml` 的具名步骤和 `lefthook.yml` 三处，
三处没有任何东西保证一致 —— 实测已经漂移：`check_font_family_guard` 与
`check_codemirror_singleton` 只挂在本地 lint，而 CI 根本不调用 `pnpm lint`，
于是这两条护栏对 PR 零约束力。改成目录发现后：

- 新增护栏 = 往 checks/ 放一个模块，三个消费端一行都不用改；
- 「忘了接线」在物理上不可能发生；
- checks/ 目录为空 = 注册表自检失败（同一条反空转规则递归适用于框架自己）。
"""
from __future__ import annotations

import importlib
import inspect
import pathlib
from dataclasses import dataclass

from .contract import Guard, GuardResult
from .ledger import LEDGER_DIR
from .repo import find_repo_root

CHECKS_DIR = pathlib.Path(__file__).resolve().parents[1] / "checks"
TESTS_DIR = pathlib.Path(__file__).resolve().parents[1] / "tests"


class RegistryError(RuntimeError):
    """注册表不合法 —— 属于「护栏自身坏了」，退出码 2，不是代码违规。"""


@dataclass(frozen=True)
class Registration:
    guard: Guard
    check: object
    module_name: str
    source: pathlib.Path

    @property
    def id(self) -> str:
        return self.guard.id


def _candidate_modules() -> list[pathlib.Path]:
    if not CHECKS_DIR.is_dir():
        return []
    return sorted(
        p
        for p in CHECKS_DIR.glob("*.py")
        if p.name not in ("__init__.py",) and not p.name.startswith("_")
    )


def _validate(module, path: pathlib.Path, root: pathlib.Path) -> tuple[Guard, object]:
    """把一个模块纳入注册表前的契约校验。问题一次性收集完再抛，别让人改一个跑一次。"""
    stem = path.name[:-3]
    problems: list[str] = []

    guard = getattr(module, "GUARD", None)
    if not isinstance(guard, Guard):
        problems.append(f"{path.name}: 缺少 `GUARD`（需为 contract.Guard 实例）")
        raise RegistryError(problems)

    if guard.id != stem:
        problems.append(f"{path.name}: GUARD.id={guard.id!r} 与文件名 {stem!r} 不一致")

    check = getattr(module, "check", None)
    if not callable(check):
        problems.append(f"{path.name}: 缺少可调用的 `check(ctx) -> GuardResult`")
    elif not _returns_result(check):
        problems.append(f"{path.name}: check 的返回值注解应为 GuardResult")

    if not (TESTS_DIR / f"test_{stem}.py").is_file():
        problems.append(
            f"{stem}: 缺少配套单测 tests/test_{stem}.py —— 护栏没有测试就等于没有护栏"
        )

    # 两个指针各自只有一种含义，且都必须可解析：写错的 docs / ledger 名会让护栏的
    # 「机制详解」与「数据」指向不存在的目标，而护栏本身仍然报绿。
    if guard.docs and not (root / guard.docs).exists():
        problems.append(f"{stem}: GUARD.docs 指向的文档不存在：{guard.docs}（相对仓库根）")
    if guard.ledger and not (LEDGER_DIR / f"{guard.ledger}.json").is_file():
        problems.append(f"{stem}: GUARD.ledger 台账不存在：ledger/{guard.ledger}.json")

    if problems:
        raise RegistryError(problems)
    return guard, check


def _returns_result(check) -> bool:
    """只认显式注解：忘标返回类型的模块会在自检期被抓，而不是在运行时悄悄返回 None。"""
    hint = inspect.signature(check).return_annotation
    return hint is GuardResult or hint == "GuardResult"


def discover(root: pathlib.Path | None = None) -> list[Registration]:
    """导入 checks/ 下所有模块并校验契约；任何问题都抛 RegistryError。"""
    paths = _candidate_modules()
    if not paths:
        raise RegistryError(
            [f"{CHECKS_DIR} 下没有任何护栏模块 —— 注册表为空，拒绝以「全绿」通过。"]
        )

    if root is None:
        root = find_repo_root()

    package = CHECKS_DIR.parent.name + "." + CHECKS_DIR.name
    registrations: list[Registration] = []
    problems: list[str] = []

    for path in paths:
        module_name = f"{package}.{path.name[:-3]}"
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:  # 导入即失败也是护栏坏了
            problems.append(f"{path.name}: 导入失败 {type(exc).__name__}: {exc}")
            continue
        try:
            guard, check = _validate(module, path, root)
        except RegistryError as exc:
            problems.extend(exc.args[0])
            continue
        # 无需再查重复 id：_validate 已强制 id == 文件名，而同一目录内文件名必然唯一。
        registrations.append(
            Registration(guard=guard, check=check, module_name=module_name, source=path)
        )

    if problems:
        raise RegistryError(problems)
    return sorted(registrations, key=lambda r: r.id)
