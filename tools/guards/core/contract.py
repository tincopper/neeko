"""护栏契约 —— 框架与单条 guard 之间的唯一接口。

为什么需要这一层（第一性原理）：一条护栏只需要「判据 + 一次调用」，但原先 6 个脚本
各自 print、各自选退出码，同一个「违规」有 4 种文案，`&&` 链还把「代码违规」与
「护栏自己坏了」压成同一个错。本模块把这些一次性定死：

- guard 只返回**结构化结论** `GuardResult`，不 print、不 sys.exit；
- `scanned`（参与判定的文件/条目数）是必填项，由**框架**拦「空转静默通过」——
  这个失效模式本仓库真实踩过两次（见 checks/check_worktree_byte_assertions.py 模块头），
  原先靠每条脚本自觉写 `if scanned == 0`，漏写就恒绿；
- 退出码三档：0 通过 / 1 违规 / 2 护栏自身失效。2 与 1 必须可区分，否则工具链坏掉
  会伪装成「代码有问题」，或被当成「已经检查过了」。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_GUARD_ERROR = 2

STAGES = ("local", "commit", "push", "ci", "manual")
# 既有进程内护栏全部依赖这个默认值。它必须逐字等于改造前的 `ALL_STAGES`——包括**顺序**，
# 因为 `pnpm guards list` 逐字打印 `','.join(g.stages)`，AC3 要求改造前后该输出完全一致。
# 把「词汇表」（STAGES）与「默认值」（本常量）混成一个常量，正是「加一个 stage 就让
# 全部门禁多跑一遍」的成因，因此 ALL_STAGES 这个名字被删除，不留别名。
DEFAULT_STAGES = ("local", "ci", "commit")

# 命令门禁的默认上下文：**不含 ci**。CI 是显式选择，而且一旦选了就**必须点名 job**
# （见 Gate 的 ci⇔ci_job 双向校验）—— 若默认含 ci，一条没写 stages 的 gate 会直接撞上
# 「说了在 CI 跑却没说在哪个 job」，反而逼人把它写出来；默认不含 ci 更诚实。
# 首批 10 条 gate 全部显式声明 stages，不依赖本默认值。
DEFAULT_GATE_STAGES = ("local", "commit")

# 归属套件 —— 与「上下文」正交：上下文决定何时跑，套件决定它属于静态检查还是测试。
KINDS = ("lint", "test")

# 平台词汇表。命令门禁在此集合之外不跑（显式记 SKIPPED），而不是把脚本自报的
# 「我跳过了」当成通过。
PLATFORMS = ("linux", "macos", "windows")

# 单条护栏的时间预算。默认给得很松（当前 6 条全量实测 ~0.42s），它的定位不是性能调优，
# 而是「门禁不可用」的探测器：一条慢到没人愿意跑的护栏，实际等价于从门禁里消失 ——
# 和恒绿但什么都不查是同一类失效，只是慢下来才看得见。所以超时判 ERROR 而不是违规。
DEFAULT_BUDGET_MS = 10_000

PASS = "PASS"
VIOLATION = "VIOLATION"
ERROR = "ERROR"
SKIP = "SKIP"


@dataclass(frozen=True)
class Finding:
    """一处违规。`file` + `line` 让 CI 能把它钉回 diff 行。"""

    message: str
    file: str = ""
    line: int = 0

    def location(self) -> str:
        if not self.file:
            return ""
        return f"{self.file}:{self.line}" if self.line else self.file

    def as_text(self) -> str:
        where = self.location()
        return f"{where}: {self.message}" if where else self.message


@dataclass(frozen=True)
class GuardResult:
    """一条 guard 的结论。

    `notes` 只在 `list` 模式打印（台账明细）；`metrics` 是一行实测摘要，进汇总表，
    让「扫了 0 个文件」「扫了 3 个文件」这种空转信号在任何一次运行里都肉眼可见。
    """

    scanned: int = 0
    findings: tuple = ()
    notes: tuple = ()
    metrics: str = ""
    error: str = ""
    # 不用 `skipped` 做字段名：`GuardResult.skipped(reason)` 是构造跳过的唯一入口，
    # 同名 classmethod 会在 dataclass 建类时被当成字段默认值（实例全变 SKIP）。
    # 对外 JSON 仍输出 `skipped` 键（见 report._render_json）。
    skip_reason: str = ""

    @classmethod
    def passed(cls, scanned: int, metrics: str = "", notes: Sequence[str] = ()) -> "GuardResult":
        return cls(scanned=scanned, metrics=metrics, notes=tuple(notes))

    @classmethod
    def skipped(cls, reason: str) -> "GuardResult":
        """合法不跑（平台不适用 / 缺工具链）——带原因，且在汇总里可见。

        这不是「未被选中」（那由 select 过滤掉），而是**被选中但无法执行**。
        `scanned=0` 的反空转判定对它豁免（见 runner）。
        """
        return cls(skip_reason=reason)

    @classmethod
    def violated(
        cls, scanned: int, findings: Sequence[Finding], metrics: str = "", notes: Sequence[str] = ()
    ) -> "GuardResult":
        if not findings:
            # 空 findings 的 verdict 会落回 PASS —— 把违规伪装成通过。用 passed() 表示通过，
            # 或给出至少一条 Finding；这个非法状态必须在构造期就写不出来。
            raise ValueError(
                "GuardResult.violated 至少需要一条 Finding：空 findings 会落回 PASS，"
                "把违规伪装成通过（用 passed() 表示通过）"
            )
        return cls(
            scanned=scanned,
            findings=tuple(findings),
            metrics=metrics,
            notes=tuple(notes),
        )

    @classmethod
    def broken(cls, error: str, scanned: int = 0) -> "GuardResult":
        """护栏无法完成判定 —— 不是被检查代码的错。"""
        return cls(scanned=scanned, error=error)

    @property
    def verdict(self) -> str:
        if self.error:
            return ERROR
        if self.findings:
            return VIOLATION
        if self.skip_reason:
            return SKIP
        return PASS


@dataclass(frozen=True)
class Guard:
    """护栏的自我描述，同时是**调度元数据**（原先硬编码在 CI/lefthook 里的东西）。

    `scopes` 决定「什么改动需要这条护栏」，用于 pre-commit 跳过无关检查；
    它**不缩小扫描集** —— 台账类护栏必须全量比对才能发现计数漂移。

    `docs` 与 `ledger` 是两个不同的指针，各自只有一种含义，由注册表逐个验证存在性：
    `docs` = 仓库根相对的机制详解文档；`ledger` = `ledger/<name>.json` 的数据名。
    """

    id: str
    title: str
    scopes: tuple
    stages: tuple = DEFAULT_STAGES
    red_lines: tuple = ()
    docs: str = ""
    ledger: str = ""
    fix_hint: str = ""
    budget_ms: int = DEFAULT_BUDGET_MS
    kind: str = "lint"

    def __post_init__(self) -> None:
        if not self.id or not self.title or not self.scopes or not self.stages:
            raise ValueError(f"guard {self.id!r}: id/title/scopes/stages 都不允许为空")
        if self.budget_ms <= 0:
            raise ValueError(f"guard {self.id!r}: budget_ms 必须为正数")
        if self.kind not in KINDS:
            raise ValueError(f"guard {self.id!r}: 未知 kind {self.kind!r}（可选 {KINDS}）")
        for stage in self.stages:
            if stage not in STAGES:
                raise ValueError(f"guard {self.id!r}: 未知 stage {stage!r}（可选 {STAGES}）")


@dataclass(frozen=True)
class Gate(Guard):
    """外部命令门禁 = 进程内判据（Guard） + 一次进程调用（argv）。

    继承 `Guard` 而不是抽一个 `Check` 基类：字段与需求完全重合，抽基类只换来纯改名
    噪音与更弱的类型关系。代价是一条 Gate 也带一个空 `ledger` 字段 —— 可接受：它是
    `Gate` 的合法字段，写进 `gates.json` 只会被忽略（注册表不对 gate 校验 ledger）。

    `ci_job` 与 `"ci" ∈ stages` 互为充要条件：声明了 CI 门禁却不说它在哪个 job，
    拓扑校验（A1）就无从下手；反过来，任务里没 `ci` 却指定 job 是悬空指针。
    """

    argv: tuple = ()
    platforms: tuple = PLATFORMS
    ci_job: str = ""
    stages: tuple = DEFAULT_GATE_STAGES

    def __post_init__(self) -> None:
        super().__post_init__()
        if not self.argv or not all(isinstance(a, str) for a in self.argv):
            raise ValueError(f"gate {self.id!r}: argv 必须是非空的字符串序列")
        if not self.argv[0]:
            raise ValueError(f"gate {self.id!r}: argv[0] 不能为空")
        if not self.platforms:
            raise ValueError(f"gate {self.id!r}: platforms 不能为空")
        for platform in self.platforms:
            if platform not in PLATFORMS:
                raise ValueError(
                    f"gate {self.id!r}: 未知 platform {platform!r}（可选 {PLATFORMS}）"
                )
        if ("ci" in self.stages) != bool(self.ci_job):
            raise ValueError(
                f"gate {self.id!r}: `ci` 上下文与 ci_job 必须同时出现或同时缺席"
                f"（stages={self.stages!r} ci_job={self.ci_job!r}）"
            )


@dataclass(frozen=True)
class Context:
    """框架注入给 guard 的运行环境。guard 不得自行定位仓库根 —— 全仓只有一处实现。"""

    repo_root: "object"
    changed: frozenset = field(default_factory=frozenset)
    list_mode: bool = False

    def path(self, rel: str):
        return self.repo_root / rel

    def glob(self, pattern: str) -> list:
        """按 posix glob 取文件；目录不存在时返回空 —— 由框架的 scanned 校验兜住。"""
        return sorted(p for p in self.repo_root.glob(pattern) if p.is_file())

    def rel(self, path) -> str:
        """相对仓库根的正斜杠路径，用于所有对外展示与定位。"""
        return path.relative_to(self.repo_root).as_posix()

    def read(self, rel: str) -> str:
        """严格读取 —— 解不开就让护栏报错退出（2），而不是悄悄少算几处命中。"""
        return self.path(rel).read_text(encoding="utf-8")

    def read_tolerant(self, rel: str) -> str:
        """容忍解码错误 —— 仅用于「文件本身可能有噪声」的文本类扫描（css / 混排源文件）。"""
        return self.path(rel).read_text(encoding="utf-8", errors="ignore")


CheckFn = Callable[[Context], GuardResult]
