# Design：护栏编排脚手架（gate orchestration）

前置事实：`research/current-gate-topology.md`（改造前逐行快照）。需求与验收：`prd.md`。

## 1. 第一性原理（一句话版）

门禁里没有「eslint / cargo / python」这三样东西，只有三个物理量：

1. **判据** —— 从仓库状态到 `{PASS | VIOLATION | ERROR}` 的函数；
2. **上下文** —— 有限可枚举，每个自带**延迟预算**与**平台集**（资源约束，不是标签）；
3. **聚合** —— 多个结论收敛成一个退出码。

执行体天然异构（Node / Rust / Python / bash），所以统一抽象只能落在**进程边界**上，
而进程边界只传递 `argv`、退出码、stdout 三样。故「一条门禁」= **声明 + 调用方式 +
退出码约定**：声明是数据，调用方式是 argv，退出码是三态。

判据层（`checks/`）已经按这套原则做完；**本次只是把同一套原则补到编排层**，并复用
判据层已付过费的全部基础设施。

## 2. 目标态映射（等价性证明，AC13）

| 场合 | 现状 | 目标态 | 命令集合是否等价 |
|---|---|---|---|
| `pnpm lint` | `lint:fe && lint:rust && guards run --stage local` | `run.py run --stage local --suite lint` | ✅ 16 进程内 + lint_fe + lint_rust |
| `pnpm test` | `test:fe && test:rust && test:host` | `run.py run --stage local --suite test` | ✅ test_fe + test_rust + test_host |
| `pnpm check` | `pnpm lint && pnpm test` | `run.py run --stage local` | ✅ 上述并集 |
| `pnpm test:coverage` | `test:fe:coverage && test:rust:coverage` | `run.py run --stage manual` | ✅ 两套覆盖率 |
| `lefthook` pre-commit | 3 条命令（lint-frontend / lint-rust / guards） | `run.py run --stage commit --staged` | ✅ 同一集合，scope 由声明决定 |
| `lefthook` pre-push | 3 条命令并行 | `run.py run --stage push --changed {push_files} --jobs 3` | ✅ 同一集合，并发保持 |
| `ci.yml` guards job | `run --stage ci`（16 进程内） | `run --stage ci --suite lint --source python` | ✅ 逐字等价 |
| `ci.yml` 其余 6 个 job | 手写 | **手写保留**，由 A1 断言接线 | ✅ 不生成 workflow（见 §7 D2） |

## 3. 契约（`core/contract.py`）

### 3.1 词汇表与默认值必须分开（最高爆半径点）

```python
# 上下文词汇表（可表达全部真实场合；push/manual 为本次新增）
STAGES = ("local", "commit", "push", "ci", "manual")

# 默认值（既有 15 条护栏未显式声明 stages，全部吃这个默认 —— 见 research §1.1）
DEFAULT_STAGES = ("local", "commit", "ci")     # 逐字等于改造前的 ALL_STAGES

KINDS = ("lint", "test")                       # 归属套件
PLATFORMS = ("linux", "macos", "windows")
```

`ALL_STAGES` 这个名字**删除**：它把「词汇表」与「默认值」混成一个常量，正是
「加一个 stage 就让 15 条护栏全都多跑一遍」的成因。AC3 要求 `pnpm guards list` 前后
输出逐字一致。

### 3.2 类型表

```python
@dataclass(frozen=True)
class Guard:
    id: str; title: str; scopes: tuple
    stages: tuple = DEFAULT_STAGES
    red_lines: tuple = (); docs: str = ""; ledger: str = ""
    fix_hint: str = ""; budget_ms: int = DEFAULT_BUDGET_MS
    kind: str = "lint"                    # 新增，置于末尾以保持位置构造兼容

@dataclass(frozen=True)
class Gate(Guard):                        # 进程内判据 = Guard；命令判据 = Gate
    argv: tuple = ()
    platforms: tuple = PLATFORMS
    ci_job: str = ""
    # __post_init__ 追加校验：argv 非空且全为 str；kind ∈ KINDS；
    # platforms 非空且 ⊆ PLATFORMS；"ci" ∈ stages ⇔ ci_job 非空（双向，两边都不许漏）
```

`Gate` 继承 `Guard`（而不是抽 `Check` 基类）：`Guard` 的字段与 `Gate` 需求完全重合，
抽基类只带来 ~15 处纯改名噪音与一份更弱的类型关系。代价是一条 Gate 也带一个空
`ledger` 字段 —— 可接受，且 `gates.json` 的未知键校验会把误写的 `ledger` 挡回来。

### 3.3 三态 + SKIPPED

```python
PASS = "PASS"; VIOLATION = "VIOLATION"; ERROR = "ERROR"; SKIP = "SKIP"

@dataclass(frozen=True)
class GuardResult:
    scanned: int = 0; findings: tuple = (); notes: tuple = ()
    metrics: str = ""; error: str = ""
    skipped: str = ""                     # 新增：平台不适用等「合法不跑」，带原因

    @property
    def verdict(self):                     # error > findings > skipped > pass
        ...
```

**为什么 SKIPPED 是 MVP 而不是装饰**：`tools/java-host/test.sh` 在非 POSIX 平台自己
`exit 0` 并打印 skip。若直接把它包成 gate，退出码 0 ⇒ PASS ⇒ **把「没检查」伪装成
「检查过了」**，恰好是这套框架存在的理由。所以要么显式 SKIPPED，要么不许包。

`SKIPPED` 与「scope 不匹配」是两件事：前者是*被选中但无法执行*（计入汇总），
后者是*未被选中*（由 `select` 过滤，但会打印 id 列表以保证可见）。

## 4. 声明：`ledger/gates.json`

一份数据文件（复用 `ledger.load_ledger` 的存在性 / 解析 / 空值拒绝），由
`core/gates.py::load_gates()` 做二级 schema 校验后产出 `tuple[Gate, ...]`。

```jsonc
{
  "gates": [
    {
      "id": "lint_fe",
      "title": "eslint + tsc（前端静态检查）",
      "argv": ["pnpm", "lint:fe"],
      "kind": "lint",
      "stages": ["local", "commit", "push", "ci"],
      "ci_job": "frontend-check",
      "budget_ms": 180000,
      "scopes": ["src/*.ts", "src/*.tsx", "src/**/*.ts", "src/**/*.tsx",
                 "package.json", "pnpm-lock.yaml", "tsconfig.json",
                 "tsconfig.app.json", "tsconfig.node.json",
                 "vite.config.ts", "vitest.config.ts", ".eslintrc.cjs", ".prettierrc"],
      "docs": ".trellis/spec/frontend/quality-guidelines.md",
      "fix_hint": "改 eslint/tsc 报出的具体问题"
    }
  ]
}
```

校验规则（`core/gates.py`，每条都要有单测）：

| 规则 | 拦住的失效 |
|---|---|
| 未知键即报错（允许键 = `dataclasses.fields(Gate)` 的 id 集合） | 拼错 `stage`/`scope`/`budget` ⇒ 静默按默认值生效 |
| `argv` 非空、全为 str、首元素非空 | 声明了一条不会跑任何东西的门禁 |
| `id` 匹配 `^[a-z][a-z0-9_]*$` 且与既有 `checks/` 的 id 不冲突 | CLI 打不出来 / 两条门禁同名 |
| `stages` 非空且 ⊆ `STAGES`；`kind` ∈ `KINDS`；`platforms` ⊆ `PLATFORMS` | 词汇表之外的上下文静默永不生效 |
| `budget_ms` 为正 | 0 预算 ⇒ 恒 ERROR |
| `"ci" ∈ stages ⇔ ci_job 非空` | 声明了 CI 门禁但没说它在哪个 job（A1 就无从校验） |
| `docs` 若给则必须存在（复用 registry 的判据） | 机制详解指针悬空 |
| `gates` 列表非空 | 空注册表全绿 |

### 4.1 首批 gate 清单（与现状逐条对应）

| id | argv | kind | stages | ci_job | platforms | budget |
|---|---|---|---|---|---|---|
| `lint_fe` | `pnpm lint:fe` | lint | local, commit, push, ci | frontend-check | all | 180s |
| `lint_rust` | `pnpm lint:rust` | lint | local, commit, push, ci | backend-check | all | 600s |
| `rust_check` | `cargo check` | lint | ci | backend-check | all | 900s |
| `build_web` | `pnpm build` | lint | ci | frontend-build | all | 600s |
| `test_fe` | `pnpm test:fe` | test | local, push | — | all | 300s |
| `test_rust` | `pnpm test:rust` | test | local, push, ci | backend-test | all | 900s |
| `test_host` | `pnpm test:host` | test | local, push | — | linux, macos | 300s |
| `test_fe_coverage` | `pnpm test:fe:coverage` | test | ci, manual | frontend-test | all | 600s |
| `test_rust_coverage` | `pnpm test:rust:coverage` | test | ci, manual | backend-coverage | all | 1200s |
| `build_host` | `pnpm build:host` | test | ci | java-host-check | linux, macos | 600s |

两处必须写进注释的建模决定：

- `test_fe` 声明 `ci` 吗？**不声明**。CI 跑的是 `test:fe:coverage`（覆盖地板是另一条判据），
  把它建模成 `test_fe_coverage` 的 `ci` 上下文，而不是给一条 gate 加「CI 里换个命令」的
  覆盖字段 —— 后者会让「gate = 一条判据」的定义破功。
- `test_host` / `build_host` 排除 `windows`：`test.sh` 在 MINGW/MSYS/CYGWIN 下自己
  `exit 0`，声明平台后由框架显式记 SKIPPED（原因可见），比脚本自报跳过更诚实。

## 5. 调度与汇报

### 5.1 `runner.select` 增加两个正交过滤

```python
select(registrations, stage, changed, only, suite="all", source="any")
#  stage  : 上下文（必选）
#  suite  : kind 过滤 —— all / lint / test
#  source : 形态过滤 —— any / python(进程内) / command(子进程)
#  scope  : changed 非空时按 intersects 过滤（不缩小扫描集，只决定跑不跑）
```

`--stage ci --suite lint --source python` = 现状 CI guards job；`--suite lint` =
现状 `pnpm lint`。两个过滤器正交，不引入「重载语义的 suite 名」。

### 5.2 `runner.execute` 的执行顺序与并发

1. 先跑**进程内判据**（顺序，全量 ~0.4s）——最便宜的先跑，最快给出反馈；
2. 再跑**命令门禁**：`--jobs N`（默认 1）用 `ThreadPoolExecutor` 并发，
   并发面**只限子进程**（进程内判据不进池，避免给框架引入无关并发）；
3. **fail-fast（默认，无开关）**：出现第一个 VIOLATION / ERROR 后**不再启动新的** gate，
   但不中断已在跑的（中断 cargo/vitest 会浪费它们的暖缓存进度）。
   —— 这是对现状 `&&` 语义的**逐条保持**（`pnpm lint` 里 eslint 失败即不再跑 clippy）。

汇报顺序恒定为声明顺序（`chosen` 顺序），与完成先后无关 ⇒ 输出可 diff。

### 5.3 `_run_gate`（新增，唯一需要新写的执行路径）

```python
def _run_gate(reg, context) -> Outcome:
    if platform_tag() not in reg.guard.platforms:
        return GuardResult.skipped(f"平台不适用（{platform_tag()} ∉ {platforms}）")
    try:
        proc = subprocess.run(
            list(reg.guard.argv), cwd=context.repo_root, capture_output=True, text=True,
            timeout=reg.guard.budget_ms / 1000, start_new_session=True,
        )
    except FileNotFoundError as exc:      # 命令不存在 ⇒ 工具链坏了，不是代码违规
        return broken(...)
    except subprocess.TimeoutExpired:     # 超预算 ⇒ 不可用的门禁等价于消失
        return broken(...)                # posix: os.killpg 清进程组
    # 退出码 → 三态；stdout/stderr 末 N 行 → findings（有界，见 §5.4）
    # metrics = 输出的最后一行非空（人眼可见「脚本自报跳过」这类信号）
```

四类「门禁自身不可信」（异常、返回类型不符、扫描集为空、超时）的收口逻辑
**原样复用** `_run_one` 已有的 `done()` 闭包；`scanned<=0` 的反空转判定对
`skipped` 结果豁免（跳过不是「扫了 0 个还报绿」）。

### 5.4 输出有界（防止日志把 CI 刷爆）

`findings` 最多 40 行、每行截断 500 字符、超出部分以一行「已截断 N 行」收尾；
`metrics` 截断 120 字符。判据是「给人定位 + 给 CI 钉行」，不是保存完整日志。

### 5.5 `--jobs` 与进程组清理的平台差异

- POSIX：`start_new_session=True` + 超时时 `os.killpg(os.getpgid(pid), SIGKILL)`；
- Windows：只能杀直接子进程，孙进程可能存活 —— **已知限制，写入模块头**（不由
  `subprocess.run` 的 timeout 掩盖）。

## 6. 消费端目标态

### 6.1 `package.json`（门禁脚本零 `&&`）

```jsonc
"lint":           "python3 tools/guards/run.py run --stage local --suite lint",
"test":           "python3 tools/guards/run.py run --stage local --suite test",
"check":          "python3 tools/guards/run.py run --stage local",
"test:coverage":  "python3 tools/guards/run.py run --stage manual",
"guards":         "python3 tools/guards/run.py",
// 被 gate 的 argv 引用，必须保留（框架通过它们调用工具链）：
// lint:fe · lint:rust · test:fe · test:rust · test:host · build:host
// test:fe:coverage · test:rust:coverage · build
```

`check:fe` / `check:rust`（全仓零引用的孤儿 `&&` 链）建议删除 —— 见 PRD R11。
`build` / `lint:fe` / `lint:rust` 等**内部**的 `&&` 不属于门禁编排（它们是单条 gate 的
argv），判据只针对四个门禁入口。

### 6.2 `lefthook.yml`

```yaml
pre-commit:
  commands:
    guards:                       # 一条命令取代 lint-frontend + lint-rust + guards
      run: python3 tools/guards/run.py run --stage commit --staged
commit-msg:
  commands:
    commitlint: { run: pnpm commitlint --edit {1} }
pre-push:
  commands:
    gates:                        # 一条命令取代三套并行测试
      run: python3 tools/guards/run.py run --stage push --changed {push_files} --jobs 3
```

9 条手写 glob 全部删除（`scopes` 接管）；`parallel: true` 删除（stage 内只剩一条命令）。
`{push_files}` 是 lefthook 2.1.10 提供的模板变量（实测，见 research §4）；路径含空格的
仓库会踩到 argv 拆分，本仓库无此路径，且 CLI 已有 `-- <path>` 逃生口。

### 6.3 `ci.yml`

只有一行变化：

```yaml
run: python3 tools/guards/run.py run --stage ci --suite lint --source python --format github-actions
```

其余 6 个 job 手写保留，由 A1（`check_gate_topology`）逐条校验「声明了指派 job 的 gate
的命令确实出现在该 job 的 steps 里」。**不生成 workflow**，理由见 §7 D2。

## 7. 设计决定与取舍（含对上一轮对话方案的三处修订）

| # | 决定 | 理由 |
|---|---|---|
| **D1 修订** | `Gate` **继承** `Guard`（原方案是「抽 `Check` 基类，`Guard`/`Gate` 各继承一次」） | `Guard` 的字段与 Gate 需求完全重合，抽基类只换来 ~15 处纯改名（`Registration.guard` → `.check`）和一份更弱的类型关系。继承方向反转后改动面缩小到「末尾加字段 + 一个子类」 |
| **D2 保持** | CI 手写 job + 机器校验一致性，不生成 YAML | 三平台矩阵、`backend-check (ubuntu-latest)` 这类矩阵后缀的 required check 名、setup 步骤与 secrets 都是生成器的复杂度黑洞；**漂移检测比代码生成更便宜** |
| **D3 修订** | 套件用 `--suite`（kind 过滤）+ `--source`（形态过滤）两个正交开关，而非 `--suite guards/lint/test/all` 四个名字 | 四个名字里 `guards` 与 `lint` 是两种语义（形态 vs 归属），命名会被迫说谎；正交后 `--stage ci --suite lint --source python` 与 `--stage local --suite lint` 各自含义唯一 |
| **D4 新增** | `--jobs N`（默认 1，lefthook pre-push 传 3） | 派生需求：现状 pre-push 三套并行 ≈ 3min，收成一条命令若不并发会退化成 ≈ 4min+。这是 PRD R6 |
| **D5 新增** | `platforms` + `SKIPPED` 进 MVP | 不加就只能把 `test:host` 的「自己 exit 0 跳过」当成 PASS，等于新框架第一次落地就打破自己最核心的保证（§3.3） |
| **D6 新增** | gate 输出的末行进 `metrics` | 不新增字段即可让「脚本自报跳过」在人眼里可见（AC10） |
| **D7 保持** | fail-fast 默认开启、无开关 | 与现状 `&&` 语义逐条对齐；collect-all 是另一种产品决策，不该顺手改掉 |
| **D8 砍掉** | 原方案里的 `require_tools`（缺工具链 ⇒ ERROR） | 与「本地无 JDK 时 `pnpm test` 应跳过而非硬失败」冲突，需要 stage 感知策略（本地跳过 / CI 硬失败），方案未定 ⇒ 移入批次 2（PRD R10）。**残留风险**：CI 若 `setup-java` 坏掉，`build_host` 仍会以「可见的 skip 行 + 退出码 0」通过 —— MVP 只保证可见性，不保证硬失败 |
| **D9 保持** | 不扩 `repo` 的 glob 引擎（不加 `{a,b}`） | 花括号只是让 `scopes` 好看一点；引擎改动会影响 15 条既有护栏的 scope 判据，收益/风险不划算。`scopes` 写展开形态，权威性由 `tests/test_gates.py` 中每条 gate 的「必须覆盖的输入」表固定 |

## 8. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| `DEFAULT_STAGES` 拆分写错 | 15 条护栏的 stage 集合变化（可能漏跑） | AC3：改造前后 `pnpm guards list` 输出逐字对比 |
| gate 预算太小 | CI 冷缓存下超时 ⇒ 退出码 2 ⇒ 挡住 PR | 预算按冷缓存上限给（600s~1200s），并把「超时是 ERROR」写在报告里指向 gate id |
| `--jobs 3` 与 fail-fast 交互 | 已启动的 gate 不会被中断，退出仍要等最慢的 | 明确语义（不中断已在跑的），并在 module docstring 写明 |
| `lefthook` pre-commit 从「无 glob 每次跑」变成「scope 过滤」 | 若某 gate 的 scope 漏了一个输入文件，改该文件将不再触发它 | `tests/test_gates.py` 固定「每条 gate 必须覆盖的输入」表；A3 保证 lefthook 不再有第二份 glob |
| `check_gate_topology` 自身误报 | 挡住所有提交 | 断言基于对 `ci.yml` 的**行级**解析（job 边界 + `run:` 内容），并有夹具测试；真实仓库上必须全绿才能提交 |

**回滚**：本次改动全部落在 `tools/guards/**`、`package.json`、`lefthook.yml`、
`ci.yml` 一行、两份文档与一份台账。回滚 = `git revert` 单个 commit；无数据迁移、
无存储格式变更、无外部状态。`gates.json` 是新增文件，删除它 + 还原消费端即回到现状。
