"""`check:quick` —— 延迟预算内的轻量检查（开发循环用，不该让人等）。

**它不是门禁。** 判据与 CI 不同（`vitest related` 基于 import 图反推相关测试），
因此结果**不能作为提交 / 合并依据** —— 「门禁」只该有一个强度含义。

定位（第一性原理）：**阶段边界按延迟预算划，不按语言划** —— 这条原则本仓库早已写在
`lefthook.yml` 的文件头（commit = 快静态检查 / push = 全套分钟级门禁 / CI = 三平台终审）。
`check:quick` 就是其中的「开发循环档」：**不该让人等的都在这，分钟级的都在 push**。

| 轻量（本命令，实测 ~12s 暖缓存） | 重量（push / CI，`pnpm check`） |
| --- | --- |
| 静态检查：eslint + tsc + fmt + clippy | 集成测试 |
| 仓库护栏（进程内判据，清单即 `checks/` 目录） | 全量单元测试（`test_fe` / `test_rust`） |
| 改动文件的单元测试（`vitest related`） | `test:host` / 覆盖率地板 / 生产打包 |

三个设计点：

1. **静态检查不在这里自造清单。** 直接复用框架的「lint 档」——
   `runner.execute(stage="local", suite="lint")`。框架的 `kind=lint` 就是「静态检查」这个
   概念的**唯一定义点**：新增一条 lint 门禁会自动纳入本命令，这里一行都不用改。
   把 `--changed` 透传给框架，它按各门禁自报的 scope 过滤（只改 .rs 就不会跑 eslint）。
   —— 早先的实现把 `eslint` / `tsc` / `lint:rust:all-targets` 抄在这里，那是一份与
   `gates.json` 重复的清单，必然漂移。
2. **只有单元测试需要「改动集」这个机制。** 框架的 gate 把 argv 写死在 `gates.json`
   的静态数据里，而 `vitest related <files>` 必须按改动集动态拼 —— 这一段框架表达不了，
   所以留在这里。
3. **诚实声明缺口。** 轻量档不含的东西必须说出来，否则「绿」会被读成「都查过了」。
   两处缺口：Rust（无 import 图，`cargo test` 粒度是整个 crate）、
   Java host（`tools/java-host/**` 的唯一门禁就是重量级的 `test:host`）。
   两处都不静默跳过 —— 那会让一个实际没有任何检查覆盖的改动看起来是「绿」的。

耗时前提（不成立就会退到 60–140s，排查「变慢了」先看这三条，不要先怀疑代码）：

- `eslint --cache`：缓存冷跑 72s，暖跑 2s。`lint:fe` 用 `--cache-strategy content` 而非默认的
  metadata —— 内容哈希对 mtime 免疫，`checkout` / `git clean` / `touch` 不再让缓存失效。
- `tsc --incremental`：无 tsbuildinfo 时 20s，有则 1.6s（缓存在 `node_modules/.cache/`）。
- `vitest related`：启动固定开销 ~5s；改动命中 `shared/store` 这类共享节点时反推出上百个
  测试，退化到 ~30s。这是**真实的覆盖面**，不是浪费 —— 别为了变快砍掉它。
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

from guards.core import platform, proc, repo, runner

# 静态检查 = 框架的 lint 档（`kind=lint` 的全部门禁）。这两个词是**框架的词汇**
# （`contract.STAGES` / `contract.KINDS`），不是这里另造的概念。
STATIC_STAGE = "local"
STATIC_SUITE = "lint"

# 改动文件的单元测试：只有这里需要「改动集」这个机制（见模块头第 2 点）。
FRONTEND_TEST = ("pnpm", "exec", "vitest", "related")

# 单步超时。各步耗时量级差很大（`vitest related` 分钟级），所以给一个
# **宽但有限**的统一上限：目的不是限速，而是「工具挂死时不会永久卡住」—— 本仓 2026-09
# 出过 vitest worker 超时，而这是人手敲的交互命令，无限等待比失败更糟。
# 超时与工具缺失一样按「环境问题」处理（退出码 2），不是代码违规。
STEP_TIMEOUT_MS = 300_000

# `vitest related` 在「无相关测试」时**退出码仍是 0**，只打印这一行 —— 静默绿的形状。
# 本仓库为此专门有反空转设计（见 core/contract.py 的 `GuardResult.broken`），此处同样不例外。
NO_RELATED_TESTS = "No test files found"

# 缺口声明：轻量档**不含**的东西必须说出来，否则「绿」会被读成「都查过了」。
# Rust：无 import 图，测试粒度是整个 crate。
RUST_TEST_GAP = (
    "改动含 .rs：本命令**不跑 `cargo test`** —— Rust 无 import 图，测试粒度是整个 crate，"
    "从改动文件反推不出该跑哪些测试。这条缺口由 pre-push hook 与 CI 的 test_rust 覆盖；"
    "需要本地直测时跑 `pnpm test:rust`。"
)

# Java host：`tools/java-host/**` 的**唯一**门禁就是 test_host / build_host（都是重量级，
# 本命令不含）。所以这里不能静默跳过 —— 那会让一个没有任何检查覆盖的改动看起来是「绿」的。
JAVA_HOST_DIR = "tools/java-host/"
JAVA_HOST_TEST_GAP = (
    "改动含 tools/java-host/**：本命令**不跑 `pnpm test:host`**（重量级，"
    "且它是该目录的唯一门禁）。host 判据请跑 `pnpm check`。"
)


@dataclass
class Step:
    """一步「改动文件的单元测试」。

    `kind` 是**稳定标识**，`title` 只负责给人看 —— 测试与分派都按 `kind` 定位，不按文案。
    把展示文案当标识，会让一次文案润色连带挂掉测试。
    """

    kind: str
    title: str
    argv: list
    no_related_tests: bool = False


@dataclass
class Plan:
    """改动集 → 要跑的**单元测试**步骤（静态检查不在此，它由框架的 lint 档承担）。

    **纯数据**，由 `plan()` 产出，不碰进程 —— 因此可纯函数测试。
    """

    steps: list = field(default_factory=list)
    notes: list = field(default_factory=list)


@dataclass
class StepResult:
    """一步的结论。`unavailable` 区分「代码有问题」与「这台机器跑不了这项检查」。"""

    passed: bool
    output: str
    unavailable: bool = False


# 前端源码根（vitest.config.ts 的 `include`/`coverage.include` 均为 `src/**`）。
# 判据必须与之一致：仓库里存在 `src/` **之外**的 `.ts`/`.tsx`，它们不是前端源码 ——
# 最典型的是 `src-tauri/src/agent/hooks/templates/*.ts`（**嵌进 Rust 二进制的模板**，
# 由 `include_str!` 消费），以及 `packages/**`（独立发布、门禁豁免，见根 AGENTS.md）、
# `.pi/` / `.omp/` 扩展、根配置（`vite.config.ts` / `commitlint.config.ts`）。
# 只判后缀会把它们喂给 `vitest related` → 恒为「无相关测试」→ 本命令**假失败**，
# 而失败原因与改动无关（2026-10-16 实测：改 OMP 模板触发）。
FRONTEND_ROOT = "src/"


def _is_frontend(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return normalized.startswith(FRONTEND_ROOT) and normalized.endswith((".ts", ".tsx"))


def _is_rust(path: str) -> bool:
    # **不需要**反斜杠归一：判据是纯后缀 `.rs`，分隔符与它无关
    #（`src\a.rs` 与 `src/a.rs` 都命中）。归一化真正必要的是**前缀型**判据
    #（`_is_frontend` / `_is_java_host`）—— 那里反斜杠会让 `startswith` 失效。
    return path.endswith(".rs")


def _is_java_host(path: str) -> bool:
    return path.replace("\\", "/").startswith(JAVA_HOST_DIR)


def plan(changed) -> Plan:
    """改动集 → 单元测试步骤。

    为什么只有「改动文件的单元测试」这一段：静态检查复用框架的 lint 档（见模块头第 1 点），
    而测试要按文件推。**推不出来／属重量级的就说出来**（`*_TEST_GAP`），不静默跳过。
    """
    result = Plan()

    frontend = [p for p in changed if _is_frontend(p)]
    if frontend:
        result.steps.append(
            Step(
                "frontend_tests",
                "改动文件的前端单元测试（vitest related）",
                [*FRONTEND_TEST, *frontend],
                no_related_tests=True,
            )
        )

    if any(_is_rust(p) for p in changed):
        result.notes.append(RUST_TEST_GAP)

    if any(_is_java_host(p) for p in changed):
        result.notes.append(JAVA_HOST_TEST_GAP)

    return result


def changed_files(root: Path) -> list:
    """工作区改动集 = 未暂存 + 已暂存 + 未跟踪。

    排除删除的文件（`--diff-filter`）：它们已不存在，喂给后续命令只会得到「文件不存在」
    这类与改动无关的噪音。改名按新名计入（`R` 在 `ACMR` 内）。
    """
    tracked = proc.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"], cwd=root, timeout_ms=30_000
    )
    untracked = proc.run(
        ["git", "ls-files", "--others", "--exclude-standard"], cwd=root, timeout_ms=30_000
    )
    for result, what in ((tracked, "改动集"), (untracked, "未跟踪文件集")):
        if result.kind != proc.COMPLETED:
            raise RuntimeError(f"拿不到 git {what}（{result.kind}）：{result.detail}")
        if result.returncode != 0:
            raise RuntimeError("拿不到 git 改动集（不在 git 仓库内 / git 不可用）")
    paths = (*tracked.output.splitlines(), *untracked.output.splitlines())
    return sorted({line.strip() for line in paths if line.strip()})


def run_static_checks(changed) -> int:
    """静态检查 = 框架的 lint 档（eslint / tsc / fmt / clippy / 仓库护栏）。

    **清单不在这里**：`--suite lint` 让框架自己选（`ledger/gates.json` + `checks/` 目录），
    所以新增一条 lint 门禁会自动进入本命令。`--changed` 交给框架按 scope 过滤，
    框架自身的改动规则（触及 `tools/guards/**` 即全量）也随之自动生效。
    """
    return runner.execute(
        stage=STATIC_STAGE,
        suite=STATIC_SUITE,
        changed=list(changed),
        jobs=platform.default_jobs(),
    )


def run_step(step: Step, root: Path) -> StepResult:
    """跑一步单元测试。

    执行交给 `core.proc`（`cwd=root` 让相对路径在任何 cwd 下都对；超时与工具缺失由它统一
    收口），本函数只负责「什么算通过」这个**属于本步骤的判据**。
    """
    result = proc.run(step.argv, cwd=root, timeout_ms=STEP_TIMEOUT_MS)

    if result.kind == proc.SPAWN_FAILED:
        # 工具链没装（如未 `pnpm install`）—— 不是代码的错。
        return StepResult(
            False,
            f"无法启动 {' '.join(step.argv)}（{result.detail}）—— 工具链问题，不是代码问题。",
            unavailable=True,
        )
    if result.kind == proc.TIMED_OUT:
        return StepResult(
            False,
            f"超过 {STEP_TIMEOUT_MS:,}ms 未结束 —— 已终止。这是工具/环境问题，不是代码问题。",
            unavailable=True,
        )

    if result.returncode == 0:
        if step.no_related_tests and NO_RELATED_TESTS in result.output:
            # 退出码 0 但没有任何测试被跑 —— 这是「没查到」而不是「查过了」。
            # 原文那句 "exiting with code 0" 会让人以为这步通过了，故在此改写。
            return StepResult(
                False,
                "未找到与本次改动相关的测试文件（vitest 的 import 图反推不出关联）。\n"
                "这可能意味着：该改动确实没有对应测试（缺口），或 related 的盲区"
                "（动态 import / vi.mock 隔离 / 模块级单例）漏掉了它。\n"
                "全量判据请跑 `pnpm check`。",
            )
        return StepResult(True, result.output)
    return StepResult(False, result.output)


def main(argv: list = None) -> int:
    parser = argparse.ArgumentParser(
        prog="check:quick",
        description=(
            "开发循环的默认检查（静态 + 改动文件的单元测试）。"
            "覆盖面窄于全量 `pnpm check`；全量由 pre-push hook 与 CI 承担，"
            "不需要在本地重复跑"
        ),
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="显式指定改动文件（相对仓库根）；缺省从 git 工作区读",
    )
    args = parser.parse_args(argv)

    try:
        root = repo.find_repo_root()
        changed = args.paths or changed_files(root)
    except repo.RepoRootNotFound as exc:
        print(f"check:quick 无法启动：{exc}", file=sys.stderr)
        return 2
    except RuntimeError as exc:
        print(f"check:quick 无法启动：{exc}", file=sys.stderr)
        return 2

    if not changed:
        # 静默绿是本仓库反复踩的失效模式：没有可查的东西 ≠ 查过了。
        print("check:quick：工作区没有改动，跳过（不是「检查通过」）。")
        return 0

    plan_result = plan(changed)
    print(
        f"check:quick：{len(changed)} 个改动文件 → "
        f"静态检查（框架 lint 档）+ {len(plan_result.steps)} 项改动文件的单元测试"
    )

    # ① 静态检查（含格式化）：复用框架的 lint 档。放在最前面 —— 它最可能立刻给出反馈。
    static_code = run_static_checks(changed)

    # ② 改动文件的单元测试。
    failures = []
    unavailable = []
    for step in plan_result.steps:
        result = run_step(step, root)
        if result.passed:
            print(f"  ok    {step.title}")
            continue
        (unavailable if result.unavailable else failures).append((step, result.output))

    for step, output in (*failures, *unavailable):
        print(f"\nFAIL  {step.title}（{' '.join(step.argv)}）", file=sys.stderr)
        print(output.rstrip(), file=sys.stderr)

    for line in plan_result.notes:
        print(f"  · {line}")

    if unavailable or static_code == 2:
        # 环境问题与代码问题必须可区分（与框架的 1=违规 / 2=护栏不可信同构）：
        # 混成一个退出码会让人以为「代码有问题」，从而去改不该改的地方。
        print(
            "\ncheck:quick：有检查无法执行 —— 这是工具/环境问题，不是代码问题。",
            file=sys.stderr,
        )
        return 2
    if failures or static_code == 1:
        print(
            "\ncheck:quick 有失败项 —— 修完再跑一次。",
            file=sys.stderr,
        )
        return 1

    print(
        "check:quick 全部通过（开发循环档：静态判据 + 改动文件的单元测试）。"
        "全量测试/集成/覆盖率由 pre-push hook 与 CI 覆盖，此处不重复。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
