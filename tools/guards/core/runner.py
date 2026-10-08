"""调度 —— 选门禁、跑门禁、兜住「护栏自己坏了」。

框架在这里承担三件原先散落在各脚本里、且各自做得不一样的事：
1. 仓库根只解析一次（core/repo.py），护栏拿不到也不该拿；
2. **反空转**：`scanned == 0` 一律判 ERROR，护栏想漏掉这条拦截必须在契约上显式作恶；
3. 异常与返回类型不符一律判 ERROR —— 一条抛异常的护栏如果算「通过」，
   等价于它从门禁里消失了，却没人知道。

执行体分两类，顺序固定：
- **进程内判据**（`Registration.check` 非空）先跑，顺序、全量（~0.4s）：最便宜的先跑；
- **命令门禁**（`check is None`，执行体是 argv）后跑，`--jobs N` 用线程池并发；
  fail-fast 默认开启（无开关）：出现第一个 VIOLATION/ERROR 后**不再启动新的** gate，
  但**不中断已在跑的**（中断一个跑了一半的外部命令会浪费它已付的暖缓存成本）。
  这是对现状 `&&` 语义的逐条保持。

已知平台限制：Windows 上超时只能杀直接子进程，孙进程可能存活（POSIX 走 `os.killpg` 清进程组）。
本模块不把这条差异交给 `subprocess` 的 timeout 默默掩盖，而是显式写在这里。
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import traceback
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass

from . import report, repo, selftest
from .contract import (
    ERROR,
    EXIT_GUARD_ERROR,
    EXIT_OK,
    PASS,
    SKIP,
    VIOLATION,
    Context,
    Finding,
    GuardResult,
)
from .platform import platform_tag
from .registry import RegistryError, discover

# 输出有界（防日志把 CI 刷爆）：给人定位 + 给 CI 钉行，不是保存完整日志。
FINDING_CAP = 40
LINE_CAP = 500
METRICS_CAP = 120
_LINE_SUFFIX = " …（行已截断）"


@dataclass(frozen=True)
class Outcome:
    guard: object
    result: GuardResult
    duration_ms: int = 0

    @property
    def id(self) -> str:
        return self.guard.id


def select(registrations, stage: str, changed, only, suite: str = "all", source: str = "any"):
    """stage / --only / --suite / --source 决定跑哪些；changed 只决定「与本次改动有关吗」。

    `suite`（kind）与 `source`（形态）是两个**正交**过滤器，不引入重载语义的套件名：
    `--stage ci --suite lint --source python` 与 `--stage local --suite lint` 各自含义唯一。
    """
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
    if suite != "all":
        picked = [r for r in picked if r.guard.kind == suite]
    if source == "python":
        picked = [r for r in picked if r.check is not None]
    elif source == "command":
        picked = [r for r in picked if r.check is None]
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
    # 反空转对「跳过」豁免：合法不跑（平台不适用）不是「扫了 0 个还报绿」。
    if not result.error and not result.skip_reason and result.scanned <= 0:
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


def _bounded_findings(text: str) -> tuple:
    """命令输出 → 有界 findings（≤40 行、每行 ≤500 字符，超出以一行提示收尾）。"""
    findings: list[Finding] = []
    truncated = 0
    for line in (ln for ln in text.splitlines() if ln.strip()):
        if len(findings) >= FINDING_CAP:
            truncated += 1
            continue
        if len(line) > LINE_CAP:
            findings.append(Finding(line[: LINE_CAP - len(_LINE_SUFFIX)] + _LINE_SUFFIX))
        else:
            findings.append(Finding(line))
    if truncated:
        findings.append(Finding(f"…（已截断 {truncated} 行输出；完整日志见本地终端 / CI 原生日志）"))
    return tuple(findings)


def _last_line(text: str) -> str:
    """metrics = 输出的最后一行非空内容，截断到 120 字符。

    这使「脚本自报跳过」这类信号在人眼里可见，而不必新增字段（design D6 / AC10）。
    """
    for line in reversed(text.splitlines()):
        if line.strip():
            return line.strip()[:METRICS_CAP]
    return ""


def _kill_tree(proc) -> None:
    """超时清场。POSIX 杀整个进程组；Windows 只能杀直接子进程（见模块头限制）。"""
    if os.name == "posix":
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    else:
        proc.kill()


def _run_gate(reg, context) -> Outcome:
    """命令门禁的唯一执行路径：argv + 退出码 → 三态。"""
    gate = reg.guard
    started = time.perf_counter()
    tag = platform_tag()
    if tag not in gate.platforms:
        # 显式记 SKIPPED —— 否则把脚本自报的「我跳过了」（exit 0）伪装成「检查过了」。
        return Outcome(
            gate,
            GuardResult.skipped(f"平台不适用（{tag} ∉ {'/'.join(gate.platforms)}）"),
            0,
        )

    def finish(result: GuardResult) -> Outcome:
        return Outcome(gate, result, int((time.perf_counter() - started) * 1000))

    try:
        proc = subprocess.Popen(
            list(gate.argv),
            cwd=str(context.repo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
    except (FileNotFoundError, NotADirectoryError, PermissionError) as exc:
        # 命令不存在 = 工具链坏了，不是代码违规。
        return finish(
            GuardResult.broken(
                f"命令无法启动：{gate.argv[0]!r}（{type(exc).__name__}: {exc}）"
            )
        )

    try:
        stdout, stderr = proc.communicate(timeout=gate.budget_ms / 1000)
    except subprocess.TimeoutExpired:
        _kill_tree(proc)
        proc.communicate()
        return finish(
            GuardResult.broken(
                f"超时：{gate.id} 超过预算 {gate.budget_ms:,}ms —— 超预算的门禁"
                "等价于从门禁里消失；这是门禁自身的问题，不是被检查代码的错"
            )
        )

    output = (stdout or "") + (("\n" + stderr) if stderr else "")
    metrics = _last_line(output)
    if proc.returncode == 0:
        return finish(GuardResult.passed(1, metrics=metrics))
    findings = _bounded_findings(output)
    if not findings:
        # 非零退出但零输出：verdict 由 findings 决定，空 findings 会被判成 PASS ——
        # 这正是「静默失败伪装成通过」。必须显式合成一条，让退出码自己说话。
        findings = (
            Finding(
                f"{gate.argv[0]} 退出码 {proc.returncode} 且没有任何输出 —— "
                "非零退出即违规，没有输出不代表通过"
            ),
        )
    return finish(GuardResult.violated(1, findings, metrics=metrics))


def _run_commands(command_regs, context, jobs: int) -> dict:
    """命令门禁：jobs>1 时并发；fail-fast（不启动新的，但不中断已跑的）。"""
    results: dict = {}
    if not command_regs:
        return results

    def halted(outcome) -> bool:
        return outcome.result.verdict in (VIOLATION, ERROR)

    if jobs <= 1:
        for reg in command_regs:
            outcome = _run_gate(reg, context)
            results[reg.id] = outcome
            if halted(outcome):
                break
        return results

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        remaining = iter(command_regs)
        pending: dict = {}
        stopped = False

        def fill() -> None:
            while not stopped and len(pending) < jobs:
                reg = next(remaining, None)
                if reg is None:
                    return
                pending[pool.submit(_run_gate, reg, context)] = reg

        fill()
        while pending:
            done, _ = wait(list(pending), return_when=FIRST_COMPLETED)
            for future in done:
                reg = pending.pop(future)
                outcome = future.result()
                results[reg.id] = outcome
                if halted(outcome):
                    stopped = True
            fill()
    return results


def execute(
    stage: str = "local",
    changed=None,
    only=(),
    fmt: str = "text",
    list_mode: bool = False,
    run_selftest: bool = True,
    out=None,
    err=None,
    suite: str = "all",
    source: str = "any",
    jobs: int = 1,
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
        chosen = select(registrations, stage, changed, only, suite=suite, source=source)
    except RegistryError as exc:
        print("护栏注册表校验未通过：", file=err)
        for problem in exc.args[0] if isinstance(exc.args[0], list) else [exc.args[0]]:
            print(f"  - {problem}", file=err)
        return EXIT_GUARD_ERROR

    if not chosen:
        # 增量/套件过滤后为空是正常情形（本次改动与任何门禁无关，或该形态在此场合不存在）；
        # 但 stage 本身选不出门禁 = 清单空了，那必须响亮地失败。
        if changed and not only:
            print(f"stage={stage}：本次改动未触及任何护栏的 scope，跳过。", file=out)
            return EXIT_OK
        if suite != "all" or source != "any":
            print(f"stage={stage}：套件/形态过滤后没有门禁被选中，跳过。", file=out)
            return EXIT_OK
        print(f"stage={stage} 下没有任何护栏被选中 —— 拒绝以「全绿」通过。", file=err)
        return EXIT_GUARD_ERROR

    context = Context(repo_root=root, changed=frozenset(changed or ()), list_mode=list_mode)
    in_process = [r for r in chosen if r.check is not None]
    command = [r for r in chosen if r.check is None]

    by_id = {reg.id: _run_one(reg, context) for reg in in_process}
    by_id.update(_run_commands(command, context, jobs))
    # fail-fast 下未启动的 gate 不进报告（它们没有被跑过，不该有假 verdict）；
    # 已执行部分的汇报顺序恒为声明顺序。
    outcomes = [by_id[r.id] for r in chosen if r.id in by_id]

    if list_mode:
        for outcome in outcomes:
            if outcome.result.notes:
                print("\n".join(outcome.result.notes), file=out)
                print(file=out)

    counts = {PASS: 0, VIOLATION: 0, ERROR: 0, SKIP: 0}
    for outcome in outcomes:
        counts[outcome.result.verdict] += 1
    summary = (
        f"{len(outcomes)} 条护栏："
        f"{counts[PASS]} 通过 / {counts[VIOLATION]} 违规 / "
        f"{counts[ERROR]} 护栏失效 / {counts[SKIP]} 条跳过"
    )
    print(report.render(outcomes, fmt, summary), file=out)
    return report.exit_code(outcomes)
