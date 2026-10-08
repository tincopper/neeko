# PRD：护栏编排脚手架 —— 把 lint/test/check 的 `&&` 链收敛进单一声明源

## 背景

判据层（`tools/guards/checks/`）已经完成脚手架化：目录即注册表，新增护栏不改任何
消费端。**编排层没有**：`package.json` 里 10 处 `&&`、`lefthook.yml` 里 6 条手写命令
+ 9 条手写 glob、`ci.yml` 的 7 个 job、`BRANCH_PROTECTION.md` 的 required check 清单，
四份互不校验的复制品共同描述「什么改动在什么场合跑哪些门禁」。事实清单见
`research/current-gate-topology.md`。

这条链路已经实测漂移过两次（`check_font_family_guard` 对 PR 零约束力；
`BRANCH_PROTECTION.md` 漏列 job），根 `AGENTS.md` 把失效模式写成规则但只能靠人记。

## Goal

把「哪些门禁在哪个上下文跑、如何聚合」从**四处手抄**变成**一份声明 + 一个校验护栏**，
使新增一条门禁（无论判据型还是外部命令型）不再需要改动框架核心逻辑，也不可能
出现「声明了却没接线」的静默门禁。

## Requirements

### R1 单一声明源（MVP）

门禁的「命令 / 归属套件 / 生效上下文 / 平台 / 目标 job / 时间预算 / scope」必须声明在
**一个**数据文件里（`tools/guards/ledger/gates.json`），且声明格式有 schema 校验
（未知键必须报错 —— 拼错 `stage`/`stages` 不许静默按默认值生效）。

### R2 `pnpm` 门禁脚本不含 `&&`（MVP）

`lint` / `test` / `check` / `test:coverage` 四个门禁入口必须收敛成对护栏框架的
单次调用，脚本内容里不出现 `&&`。开发者的四个动词（静态检查 / 测试 / 全量 / 覆盖率）
保持不变。

### R3 上下文词汇表补齐（MVP）

门禁上下文必须能表达当前实际存在的全部场合：本地手动、pre-commit、pre-push、CI-PR、
手动全保真（覆盖率）。现有 `STAGES` 缺 `push`，导致 pre-push 档在物理上无法被注册表
管理。

### R4 外部命令门禁可声明（MVP）

一条外部命令门禁 = 「argv + 归属套件 + 上下文 + 平台 + 目标 job + 预算」，框架负责执行、
超时、三态判定与汇报。**框架核心不得出现任何具体工具链的名字**（eslint / cargo /
vitest / java 等一律不许出现在 `tools/guards/core/`）。

### R5 编排漂移必须被机器发现（MVP，断言 1 与 3）

新增一条护栏 `check_gate_topology`，至少断言：

- **A1**：任何声明了 `ci` 上下文的外部命令门禁，其命令必须能在 `ci.yml` 的**指定 job**
  里被找到（支持 `pnpm <script>` 与裸命令两种形态）。
- **A3**：`lefthook.yml` 的 pre-commit / pre-push 只允许出现对护栏框架的单次调用，
  不得再出现手写的门禁命令；且不得出现 `&&`。

### R6 不得引入延迟回归（MVP）

pre-push 收成一条框架命令后，墙钟不得显著变差（现状三套并行 ≈ 3min）。
框架必须能把外部命令门禁并发执行。

### R7 三态语义与可见性不退化（MVP）

- 外部命令门禁的三态沿用 0 通过 / 1 违规 / 2 护栏自身失效（超时、命令缺失）。
- 平台不适用的门禁必须显式记 SKIPPED 并在汇总中可见，不得静默通过
  （java-host 在非 POSIX 上今天会自己 `exit 0`，直接包进框架会把「跳过」伪装成「通过」）。
- 门禁自行跳过的情形（如缺 JDK）至少要把它自报的最后一行输出显示在汇总里。

### R8 文档与台账同步（MVP）

`CONTRIBUTING.md`（Quality Gates 表 + 新增「Adding a gate」）、`AGENTS.md`
（Development Commands 段）、`ledger/invariants.json`（登记编排单源不变量）
必须与实现同一 diff 落地。

### R9 批次 2（本次不做，仅登记）

- **A2**：`BRANCH_PROTECTION.md` 的 required check 集 == `ci.yml` 的 job 集（需人肉核对
  GitHub 后台实际规则，不应与框架改造混在一个 diff）。
- **A4**：`AGENTS.md` 的 `packages/` 豁免 ⇔ registry 的 excludes（牵动红线表落点唯一性
  与 AGENTS.md 体积台账，单独一批）。
- **R10**：`require_tools`（缺工具链即 ERROR）—— 与「本地无 JDK 时应跳过而非硬失败」
  冲突，需要 stage 感知策略，方案未定。

### R11 孤儿脚本（可选）

`check:fe` / `check:rust` 全仓零引用且自身是 `&&` 链。建议随本次删除；若用户希望保留，
只需从「门禁脚本不含 `&&`」的判据中排除它们。

## Acceptance Criteria

- [ ] **AC1**（R1）`gates.json` 中一条 gate 的键拼错（如 `stage`）会被加载器拒绝，
      且 `tests/test_gates.py` 覆盖：未知键、空 argv、非法 kind / stage / platform、
      重复 id、空数组、文件缺失/解析失败。
- [ ] **AC2**（R2）`grep -n '&&' package.json` 在四个门禁脚本行上零命中；
      `pnpm lint` / `pnpm test` / `pnpm check` / `pnpm test:coverage` 各自只调用一次
      `tools/guards/run.py`。
- [ ] **AC3**（R3）`STAGES` 含 `local|commit|push|ci|manual`；`ALL_STAGES` 拆成
      「词汇表」与「默认值」两个常量，**15 条既有护栏的 stage 集合逐字不变**
      （`pnpm guards list` 前后输出一致）。
- [ ] **AC4**（R4）`grep -rn "eslint\|cargo\|vitest\|java" tools/guards/core/` 零命中
      （不含 `tools/guards/tests/`）。
- [ ] **AC5**（R4）把一条 gate 的 `argv` 换成一条必然非零退出的命令后，
      `--suite test --stage local --only <id>` 返回退出码 1 且报告里带该命令的输出；
      换成超预算命令返回退出码 2；换成不存在的命令返回退出码 2。
- [ ] **AC6**（R5）`check_gate_topology` 存在配套 `tests/test_check_gate_topology.py`；
      人为从 `ci.yml` 删掉一个已声明 gate 的命令，该护栏报 VIOLATION（在夹具仓库上验证，
      不修改真实 `ci.yml`）。
- [ ] **AC7**（R5）`lefthook.yml` 内人为加回一条 `run: pnpm lint:fe` 会让
      `check_gate_topology` 报 VIOLATION。
- [ ] **AC8**（R6）`--jobs N > 1` 时 gate 并发执行；三条 gate 各 sleep 1s 的夹具下墙钟
      < 2s（顺序则 ≥ 3s）；且汇报顺序与声明顺序无关（确定性）。
- [ ] **AC9**（R7）平台不匹配的 gate 记 SKIPPED 且退出码为 0；汇总行中出现
      「N 条跳过」；`--format json` 里每条 gate 带 `verdict: "SKIP"` 与原因。
- [ ] **AC10**（R7）gate 退出码 0 但 stdout 末行是脚本自报的跳过原因时，该行出现在
      运行汇总的 metrics 列（人眼可见），退出码仍为 0。
- [ ] **AC11**（R8）`ledger/invariants.json` 登记新不变量并通过
      `check_invariant_enforcement`；`CONTRIBUTING.md` 与 `AGENTS.md` 的改动通过
      `check_agents_md_size` 与 `check_script_references`。
- [ ] **AC12**（回归）`pnpm guards run --stage commit` 全绿；`pnpm lint` / `pnpm test`
      在改造后的本地机器上全绿；`lefthook run pre-commit` 与
      `lefthook run pre-push`（仅验证命令接线，不真跑 3min 测试）可执行。
- [ ] **AC13**（等价性）改造前后「同一上下文实际跑的命令集合」逐条对得上，
      对照表落在 `design.md` 的「目标态映射」中，且由 `tests/test_gates.py` 固定。

## Constraints

- 护栏框架**只用 Python 标准库**（实测无 pyyaml；不得新增依赖）。
- `core/repo.py` 的 glob 引擎**不支持 `{a,b}`**；gate scope 必须写成展开形态。
- 夹具路径一律 `tempdir()` 派生、外部命令一律 `sys.executable`（红线 13）。
- 不改任何既有护栏的判据；不动 `AGENTS.md` 的红线索引表（避免连带体积台账）。
- 不引入 CI workflow 代码生成（D2：保持手写 job + 机器校验一致性）。

## Out of Scope

- 重新设计 `ci.yml` 的 job 结构 / 平台矩阵 / required check 粒度。
- 把门禁结果推到 GitHub Checks API、缓存、增量编译。
- 把构建脚本（`tools/java-host/build.sh` 之外的 `scripts/release.mjs` 等）纳入注册表。
