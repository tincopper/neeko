"""调度 —— 选护栏、跑护栏、兜住「护栏自己坏了」。

框架在这里承担三件原先散落在各脚本里、且各自做得不一样的事：
1. 仓库根只解析一次（core/repo.py），护栏拿不到也不该拿；
2. **反空转**：`scanned == 0` 一律判 ERROR，护栏想漏掉这条拦截必须在契约上显式作恶；
3. 异常与返回类型不符一律判 ERROR —— 一条抛异常的护栏如果算「通过」，
   等价于它从门禁里消失了，却没人知道。
"""
from __future__ import annotations

import sys
import time
import traceback
from dataclasses import dataclass

from . import report, repo, selftest
from .contract import (
    ERROR,
    EXIT_GUARD_ERROR,
    EXIT_OK,
    PASS,
    VIOLATION,
    Context,
    GuardResult,
)
from .registry import RegistryError, discover


@dataclass(frozen=True)
class Outcome:
    guard: object
    result: GuardResult
    duration_ms: int = 0

    @property
    def id(self) -> str:
        return self.guard.id


def select(registrations, stage: str, changed, only):
    """stage / --only 决定跑哪些；changed 只决定「这条护栏与本次改动有关吗」。"""
    if only:
        known = {r.guard.id for r in registrations}
        unknown = sorted(set(only) - known)
        if unknown:
            raise RegistryError(
                f"未知护栏：{', '.join(unknown)}（已注册：{', '.join(sorted(known))}）"
            )
        wanted = set(only)
        return [r for r in registrations if r.guard.id in wanted]

    picked = [r for r in registrations if stage in r.guard.stages]
    if not changed:
        return picked
    return [r for r in picked if repo.intersects(r.guard.scopes, changed)]


def _run_one(reg, context) -> Outcome:
    """跑一条护栏并把四类「护栏自身不可信」统一收口：异常、返回类型不符、扫描集为空、超时。"""
    started = time.perf_counter()

    def done(result: GuardResult) -> Outcome:
        took = int((time.perf_counter() - started) * 1000)
        if not result.error and took > reg.guard.budget_ms:
            result = GuardResult.broken(
                f"耗时 {took:,}ms 超过预算 {reg.guard.budget_ms:,}ms —— 慢到没人愿意跑的门禁"
                "等价于从门禁里消失；这是护栏自身的问题，不是被检查代码的错",
                scanned=result.scanned,
            )
        return Outcome(reg.guard, result, took)

    try:
        result = reg.check(context)
    except Exception as exc:
        detail = traceback.format_exc(limit=4).strip().replace("\n", "\n      ")
        return done(GuardResult.broken(f"{type(exc).__name__}: {exc}\n{detail}"))

    if not isinstance(result, GuardResult):
        return done(
            GuardResult.broken(f"check() 返回 {type(result).__name__}，应为 GuardResult")
        )
    if not result.error and result.scanned <= 0:
        return done(
            GuardResult.broken(
                "扫描集为空 —— 判据口径或 scope 已失效，这条护栏实际什么都没检查"
            )
        )
    return done(result)


FRAMEWORK_DIR = "tools/guards/"


def _apply_framework_rule(changed):
    """改动触及框架/护栏自身 → 每条护栏的判据都受影响，增量跳过不成立，一律全量跑。"""
    paths = [p.replace("\\", "/") for p in changed or ()]
    return [] if any(p.startswith(FRAMEWORK_DIR) for p in paths) else paths


def execute(
    stage: str = "local",
    changed=None,
    only=(),
    fmt: str = "text",
    list_mode: bool = False,
    run_selftest: bool = True,
    out=None,
    err=None,
) -> int:
    out = out or sys.stdout
    err = err or sys.stderr
    changed = _apply_framework_rule(changed)

    try:
        root = repo.find_repo_root()
    except repo.RepoRootNotFound as exc:
        print(f"护栏框架无法启动：{exc}", file=err)
        return EXIT_GUARD_ERROR

    if run_selftest:
        ok, summary = selftest.run_suite(err)
        if not ok:
            print(f"护栏自身单测未通过（{summary}）—— 先修护栏，再谈代码。", file=err)
            return EXIT_GUARD_ERROR

    try:
        registrations = discover(root)
        chosen = select(registrations, stage, changed, only)
    except RegistryError as exc:
        print("护栏注册表校验未通过：", file=err)
        for problem in exc.args[0] if isinstance(exc.args[0], list) else [exc.args[0]]:
            print(f"  - {problem}", file=err)
        return EXIT_GUARD_ERROR

    if not chosen:
        # 增量过滤后为空是正常情形（本次改动与任何护栏的 scope 无关）；
        # 但 stage 本身选不出护栏 = 清单空了，那必须响亮地失败。
        if changed and not only:
            print(f"stage={stage}：本次改动未触及任何护栏的 scope，跳过。", file=out)
            return EXIT_OK
        print(f"stage={stage} 下没有任何护栏被选中 —— 拒绝以「全绿」通过。", file=err)
        return EXIT_GUARD_ERROR

    context = Context(repo_root=root, changed=frozenset(changed or ()), list_mode=list_mode)
    outcomes = [_run_one(reg, context) for reg in chosen]

    if list_mode:
        for outcome in outcomes:
            if outcome.result.notes:
                print("\n".join(outcome.result.notes), file=out)
                print(file=out)

    summary = (
        f"{len(outcomes)} 条护栏："
        f"{sum(1 for o in outcomes if o.result.verdict == PASS)} 通过 / "
        f"{sum(1 for o in outcomes if o.result.verdict == VIOLATION)} 违规 / "
        f"{sum(1 for o in outcomes if o.result.verdict == ERROR)} 护栏失效"
    )
    print(report.render(outcomes, fmt, summary), file=out)
    return report.exit_code(outcomes)
