# T2 Implement：三条不变量落层

## 前置

- 先完成 T1（台账格式 + 门禁就位）。

## Step 1 — R1 依赖方向

- [ ] 1.1 抽共享测试支撑 `isolated_state` / `plain_project_state`（`#[cfg(test)]`），
      `dap/testing.rs`、`browser/url_validator.rs`、`dap/adapter/java/backend.rs` 改复用。
- [ ] 1.2 `activate` 签名改收 `Arc<dyn WatcherEventSink>`；`status.rs` 删 `AppHandleSink` import。
- [ ] 1.3 `set_active_repo_unit` 在命令层构造 `AppHandleSink`。
- [ ] 1.4 先写测试（`git/services/status.rs` 内 `#[cfg(test)]`）：注入 `CollectingSink` 驱动
      `activate` + 断言挂载/事件/释放，确认在旧签名上不可编译（红）。
- [ ] 1.5 新 guard `check_service_no_delivery_dep.py` + 自测（坏例：`use tauri::AppHandle`；好例：无）。
- [ ] 1.6 `cargo test` + `cargo clippy -D warnings` 绿。

## Step 2 — R2 status 单一读取口

- [ ] 2.1 `projectStore.ts` 增 `selectStatuses` / `selectHasStatus`；先写 `projectStore` 单测（红）。
- [ ] 2.2 迁移 7 处（design 表）。`useGitStatusEventsSync` 用 `selectStatus(...)?.branch`。
- [ ] 2.3 `check_repo_unit_identity` 增判据 7 + 自测（坏例：`s.statuses[k]`、`{ statuses }`；
      好例：`selectEntries(s, k)`）。
- [ ] 2.4 `projectStore.ts` 注释改为「已由判据 7 强制」。
- [ ] 2.5 `pnpm type-check` + `pnpm test:run` 绿。

## Step 3 — R3 组件规模 ratchet

- [ ] 3.1 生成 `ledger/component_size.json` 基线（脚本一次性生成，命令写进 guard docstring）。
- [ ] 3.2 先写 `tests/test_check_component_size.py`（红）：未登记越线必红 / 已登记缩小为绿 /
      已登记变大必红 / 台账缺失 → broken。
- [ ] 3.3 实现 `check_component_size.py`。
- [ ] 3.4 `pnpm guards run` 全绿；确认 `ConnectionProjectCard.tsx` 277 ≤ 300。

## Step 4 — 台账收尾 + 文档

- [ ] 4.1 `ledger/invariants.json` 追加 R1/R2/R3 三条（落点 = 新 guard + 自测路径）。
- [ ] 4.2 `.trellis/spec/frontend/component-guidelines.md` 的「≤300 红线」补「已由
      `check_component_size` ratchet 强制」。
- [ ] 4.3 `.trellis/spec/frontend/state-management.md` 补「status 唯一读取口 + 判据 7」。
- [ ] 4.4 `.trellis/spec/backend/git-domain.md` 补「服务层只依赖端口，AppHandle 适配在命令边界」。

## Step 5 — 全量验证

- [ ] 5.1 `cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test`。
- [ ] 5.2 `pnpm lint` / `pnpm type-check` / `pnpm test:run`。
- [ ] 5.3 `pnpm check`。

## 诚实声明

- R1 的 WSL/SSH 分支（`compute_and_record` 经 transport）不做单测：需要真实远端 transport，
  继续由 `supports_push_producer` 纯函数 + 现场 AC13（独立任务）兜底。
- R3 只止血（新债），存量 59 个越线文件的拆分另开任务。

---

## 实测留痕（2026-10-06）

### R1 依赖方向
- 抽共享夹具 `src-tauri/src/common/testing.rs`（`isolated_state` / `plain_project_state`），
  三处复用点（`dap/testing.rs` re-export、`browser/url_validator.rs`、`dap/adapter/java/backend.rs`）改复用。
- `activate` 签名改收 `Arc<dyn WatcherEventSink>`；`set_active_repo_unit` 命令层构造 `AppHandleSink`。
- 新增 `status.rs` 编排测试 3 条：`only_local_targets_get_a_push_producer` +
  `activate_mounts_the_unit_and_emits_to_the_injected_sink` + `activate_releases_the_previous_unit`，
  `cargo test --lib git::services::status` → **3 passed**。旧签名（收 `&AppHandle`）下前两条根本无法编译 ⇒ 红。
- 新护栏 `check_service_no_delivery_dep` + 7 条自测；真实仓库 `scanned=6 / 0 处交付依赖`。
  （红例留痕：状态栏断言文案里出现 "AppHandle" 被正确报出，改成中文描述后绿。）

### R2 status 单一读取口
- `projectStore.ts` 增 `selectStatuses` / `selectHasStatus`；`projectStore.test.ts` 增「区分未知 vs 干净」用例。
- 迁移 7 处（GitControlPanelWrapper / FilesPanelWrapper / WorktreeList / ProjectGitSection /
  GitCommitPanel / useGitStatusEventsSync / useSessionBootstrap），`useGitStatusEventsSync` 用
  `selectStatus(...)?.branch` 保留 `undefined` 语义。
- `check_repo_unit_identity` 判据 7 + 4 条自测；真实仓库 `前端 964 个文件 / 0 处违规`。
- `pnpm type-check` exit 0；受影响的 4 个测试文件 44 用例绿。

### R3 组件规模 ratchet
- 基线 `ledger/component_size.json`（脚本生成，59 条）；护栏 `check_component_size` + 9 条自测。
- 真实仓库 `scanned=520 / 基线 59 / 0 处越线`；`ConnectionProjectCard.tsx` 277 ≤ 300。
- 红例留痕：临时造 `src/x/components/TmpBig.tsx`（301 行）→ `1 处越线`；删除后回绿。

### 台账 / 文档
- `ledger/invariants.json` 追加 3 条（服务层无交付依赖 / status 单一读取口 / 组件规模预算），
  门禁 `check_invariant_enforcement` 报 `10 条不变量 / 15 个 guard 文件（prose 1 条）/ 0 处违规`。
- spec 同步：`frontend/component-guidelines.md`（≤300 已机器强制）、`frontend/state-management.md`
  （场景 10 + 判据 7）、`backend/git-domain.md`（服务层只依赖端口）。

### 全量门禁
- `cargo fmt --check` / `cargo clippy -- -D warnings` exit 0。
- `pnpm lint`：14 条护栏 / 263 自测 / eslint+tsc 全绿。
- `pnpm test:rust`：lib + 103 integration + doc-tests 全绿。
- `pnpm test:fe`：503 文件 / 4514 passed / 1 skipped。
- `pnpm test:host`：java-host tests OK。
