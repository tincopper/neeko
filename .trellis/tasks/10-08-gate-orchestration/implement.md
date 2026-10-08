# Implement：护栏编排脚手架（执行计划）

规则：TDD（Red → Green → Refactor）。每个增量先写失败测试再实现，跑完即验证。
**顺序约束**：增量 1–7 只动框架与测试，增量 8（消费端收口）必须与增量 3–4
（`gates.json` + 注册表合并）落在**同一个 commit** —— 否则中间态要么双跑
（lefthook 的 lint:fe 与 gate lint_fe 同时跑）、要么声明了没接线。

## 增量 0：基线快照（回滚点）

```bash
pnpm guards list > /tmp/guards-before.txt
pnpm guards list --stage ci > /tmp/guards-ci-before.txt
git status --porcelain            # 必须干净
```

## 增量 1：契约层（`core/contract.py` + `tests/test_contract.py`）

1. Red：`test_contract.py` 新增
   - `STAGES` 含 `push`/`manual`；`DEFAULT_STAGES == ("local","commit","ci")`；
     `ALL_STAGES` 已不存在（`assertFalse(hasattr(contract, "ALL_STAGES"))`）。
   - `Guard(...)` 默认 `kind == "lint"`；`kind="nope"` 抛 `ValueError`。
   - `Gate(id, title, scopes, argv=("x",))` 合法；`argv=()` 抛错；`argv=(1,)` 抛错；
     `kind="nope"` 抛错；`platforms=("plan9",)` 抛错；
     `stages=("ci",)` 而 `ci_job=""` 抛错；`ci_job="j"` 而 stages 无 `ci` 抛错。
   - `GuardResult.skipped("reason").verdict == SKIP`；`skipped` 与 `findings` 同时存在时
     仍按 VIOLATION 判（违规优先于跳过）。
2. Green：`STAGES`/`DEFAULT_STAGES`/`KINDS`/`PLATFORMS`/`SKIP`、`Guard.kind`（置于末尾）、
   `Gate(Guard)`、`GuardResult.skipped` 与 `verdict` 分支。
3. 验证：`python3 tools/guards/run.py run --stage commit` 必须全绿，
   且 `diff /tmp/guards-before.txt <(pnpm guards list)` 为空（AC3）。

## 增量 2：声明加载器（新 `core/gates.py`、新 `ledger/gates.json`、新 `tests/test_gates.py`）

1. Red：`test_gates.py`（夹具仓库用 `tests/support.py` 的 `temp_repo`，路径一律
   tempdir 派生 —— 红线 13）：
   - 未知键（`stage`）、空 argv、非 str argv、非法 kind/stage/platform、
     `budget_ms<=0`、空 scopes、id 不合法、重复 id、`gates: []`、文件缺失、JSON 解析失败
     ⇒ 逐条抛 `GateLedgerError`（错误信息含 gate id 与键名）。
   - `"ci" ∈ stages` 与 `ci_job` 的双向一致性各一条。
   - 合法声明产出 `tuple[Gate, ...]`，字段逐项对齐。
2. Green：`load_gates()` = `ledger.load_ledger("gates", required_keys=("gates",))` +
   `dataclasses.fields(Gate)` 派生允许键集 + 每字段校验。
3. 同时写入本任务的**首批 10 条 gate**（design §4.1 表），`scopes` 用展开形态
   （无 `{a,b}`），`budget_ms` 按冷缓存上限。
4. 验证：`python3 -m unittest tools.guards.tests.test_gates -v`（由框架自检跑）。

## 增量 3：注册表合并（`core/registry.py` + `tests/test_registry.py`）

1. Red：
   - `discover()` 返回 checks ∪ gates，按 id 排序；
   - gate 不需要 `tests/test_<id>.py`，但缺 `tests/test_gates.py` 时抛 `RegistryError`；
   - check 与 gate id 冲突 ⇒ `RegistryError`；
   - gate 的悬空 `docs` ⇒ `RegistryError`。
2. Green：`Registration.check` 允许为 `None`（`object | None`），gate 的 `source` 指向
   `ledger/gates.json`。
3. 验证：`pnpm guards list` 列出 16 + 10 条，`--stage push` 只列 push 集合
   （16 条进程内不在其中 + test_fe/test_rust/test_host）。

## 增量 4：调度（`core/runner.py` + `tests/test_runner.py`）

1. Red（夹具命令一律 `sys.executable -c "..."`，保证跨平台）：
   - exit 0 ⇒ PASS；exit 3 ⇒ VIOLATION 且 findings 含输出行；输出 >40 行 ⇒ 截断提示；
   - 超预算（`budget_ms` 极小）⇒ ERROR（退出码 2），且 POSIX 下进程组被清；
   - argv 指向不存在的命令 ⇒ ERROR；
   - 平台不匹配 ⇒ SKIPPED，退出码 0，汇总计数包含「N 条跳过」；
   - `--suite lint/test` 与 `--source python/command` 的正交过滤各一条；
   - `jobs=3` 下三条各 sleep 1s 的 gate 墙钟 < 2s，且汇报顺序 == 声明顺序；
   - fail-fast：第 1 条违规后不启动第 2 条（用「第 2 条是否创建了 mark 文件的夹具」断言）；
   - `scanned<=0` 反空转对 SKIPPED 豁免、对 FAIL 仍成立。
2. Green：`select` 加 `suite`/`source`；`execute` 加 `jobs`、先进程内后命令门禁、
   有界输出、`_run_gate`。`scanned<=0` 判定加 `not result.skipped` 条件。
3. 验证：`python3 tools/guards/run.py run --stage commit`（真实仓库）全绿。

## 增量 5：汇报（`core/report.py` + `tests/test_report.py`）

1. Red：text 输出含 `SKIP` 标记与跳过计数；`github-actions` 格式下 SKIPPED 不产生
   `::error::`（它是合法不跑），但不许消失（打一行 `::notice::` 或在 group 内可见）；
   json 输出每条带 `verdict`/`kind`/`stages`/`platforms`/`argv`/`skipped`。
2. Green：`_MARK` 加 SKIP，`summary` 加跳过分段，`_render_json` 补字段。
3. 验证：`python3 tools/guards/run.py run --stage local --format json | python3 -m json.tool`。

## 增量 6：CLI（`core/cli.py` + `tests/test_cli.py`）

1. Red：`--suite {lint,test,all}`、`--source {any,python,command}`、`--jobs N`
   （`N<1` 报错）解析；`list` 输出含 kind/stages/platforms/argv/budget；
   `--stage push` 的 registry 表打印「未列入」清单。
2. Green：argparse 增项 + `_registry_table` 补字段。
3. 验证：`pnpm guards list --stage push`、`pnpm guards list lint_fe`。

## 增量 7：拓扑护栏（新 `checks/check_gate_topology.py` + 新 `tests/test_check_gate_topology.py`）

1. Red（夹具仓库，不碰真实 `ci.yml`）：
   - **A1**：gate 声明的 `ci_job` 不存在于 `ci.yml` ⇒ VIOLATION；job 存在但命令不在其
     steps 里 ⇒ VIOLATION（覆盖 `pnpm <script>` 与裸 `cargo check` 两种形态）；
     `pnpm build` 不得被 `pnpm build:host` 误命中（词边界用例）。
   - **A3**：`lefthook.yml` 出现手写门禁命令（`run: pnpm lint:fe`）⇒ VIOLATION；
     pre-commit/pre-push 缺框架调用 ⇒ VIOLATION；任一 `run:` 含 `&&` ⇒ VIOLATION。
   - 反空转：`ci.yml` 或 `lefthook.yml` 缺失/为空 ⇒ ERROR（不是 PASS）。
2. Green：行级解析 `ci.yml`（`jobs:` → 2 空格 job → 缩进 `run:` 块）与 `lefthook.yml`
   （hook 段 → `run:`），断言集合相等。配 `docs=".trellis/spec/guides/invariant-enforcement.md"`。
3. 验证：真实仓库上 `python3 tools/guards/run.py run --stage local --only check_gate_topology`
   通过（此时 lefthook 仍是旧的 ⇒ **预期先红**，由增量 8 转绿；这是有意的 Red）。

## 增量 8：消费端收口（与增量 3–4 同 commit）

1. `package.json`：四个门禁入口改单次调用（design §6.1），删除孤儿 `check:fe`/`check:rust`
   （R11，若用户选择保留则跳过本小步并同步 PRD）。
2. `lefthook.yml`：pre-commit / pre-push 各一条命令，删 9 条 glob 与 `parallel: true`。
3. `ci.yml`：guards job 那一行加 `--suite lint --source python`。**其余一行不动。**
4. 验证（顺序固定）：
   ```bash
   pnpm guards run --stage commit --staged      # 代替 lefthook pre-commit
   pnpm lint                                    # 单次调用、无 &&
   pnpm test                                    # 单次调用、无 &&
   pnpm guards list --stage ci --suite lint --source python   # 与 /tmp/guards-ci-before.txt 等价
   grep -n '&&' package.json                    # 四个门禁行零命中
   python3 tools/guards/run.py run --stage local --only check_gate_topology
   ```

## 增量 9：文档与台账

1. `ledger/invariants.json` 增：`id="gate-topology-single-source"`、`tier="guard"`、
   `enforcement=[{kind:"guard",ref:"check_gate_topology"},{kind:"test",ref:"tools/guards/tests/test_check_gate_topology.py"}]`。
2. `CONTRIBUTING.md`：Quality Gates 表改成「两个 hook 各一条命令」；新增
   `### Adding a gate`（改 `ledger/gates.json` 加一条对象，消费端零改动）；
   `pnpm lint`/`pnpm test` 的组成描述同步。
3. `AGENTS.md`：Development Commands 段的组成描述同步；`packages/` 门禁豁免段的
   「只改一处」句注明「编排单源由 `check_gate_topology` 校验（批次 2 会补 BRANCH_PROTECTION）」。
   **不要触碰红线索引表**（否则要同步 `ledger/agents_md_routing.json`）。
4. 验证：`pnpm guards run --stage local --only check_agents_md_size --only check_script_references --only check_invariant_enforcement`。

## 增量 10：全量回归

```bash
pnpm guards run --stage local      # 16 进程内 + 10 命令门禁
pnpm lint                           # eslint + tsc + cargo fmt + clippy + guards
pnpm test                           # fe + rust + host
pnpm check                          # 最小回归集（本次任务的最终验收）
```

`pnpm check` 全绿 + `git status` 无意外改动 = 完成。

## 复核点（review gates）

| 位置 | 复核内容 |
|---|---|
| 增量 1 后 | `pnpm guards list` 与基线逐字一致（AC3，最能证明没伤到既有 15 条） |
| 增量 4 后 | 并发/超时/跳过三条路径的测试覆盖（这是本次唯一的新执行路径） |
| 增量 7 后 | 真实仓库上拓扑护栏先红（旧 lefthook）→ 增量 8 后转绿 ⇒ 证明它真的在判定 |
| 增量 8 后 | 四个门禁入口无 `&&`；`ci.yml` 只改一行（`git diff` 逐行确认） |
| 收尾 | `pnpm check` 全绿；`CONTRIBUTING.md` 的 Adding a gate 与代码实际一致（照它做一次「纸面新增」验证零改动） |

## 触及文件清单

新增：
- `tools/guards/core/gates.py`
- `tools/guards/ledger/gates.json`
- `tools/guards/checks/check_gate_topology.py`
- `tools/guards/tests/test_gates.py`
- `tools/guards/tests/test_check_gate_topology.py`

修改：
- `tools/guards/core/contract.py` · `registry.py` · `runner.py` · `report.py` · `cli.py`
- `tools/guards/tests/test_contract.py` · `test_runner.py` · `test_report.py` ·
  `test_cli.py` · `test_registry.py`
- `package.json` · `lefthook.yml` · `.github/workflows/ci.yml`（一行）
- `CONTRIBUTING.md` · `AGENTS.md` · `tools/guards/ledger/invariants.json`

不改：`tools/guards/checks/` 的既有 15 条判据、任何 `src/**` / `src-tauri/**`。
