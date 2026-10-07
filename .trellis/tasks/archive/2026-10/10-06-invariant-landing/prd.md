# T2：三条不变量落层

## 背景

承接父任务的三条延期项。每条都已用第一性原理定性（见父任务 prd.md 表格），本任务把它们从
「文字层」搬到「机制层」。

## Requirements

### R1 依赖方向（结构不变量）

- `git/services/status.rs::activate` 不再收 `&tauri::AppHandle`、不再自建 `AppHandleSink`；
  改为收端口 `Arc<dyn WatcherEventSink>`。`AppHandleSink` 的构造上移到命令边界
  `git/commands/query.rs::set_active_repo_unit`。
- 顺手消除 3 份重复的 AppStateWrapper 隔离夹具（DRY ≥3）：抽共享 `#[cfg(test)]` 测试支撑，
  `dap/testing.rs` 改为 re-export。
- 新增护栏判据：`src-tauri/src/git/services/**` 不得出现 `tauri::` / `AppHandle` / `AppHandleSink`。
- 新增服务层编排测试（`activate` 用注入 sink 驱动）。

### R2 status 单一读取口（表示不变量）

- `projectStore.ts` 增 `selectStatuses(state)` 与 `selectHasStatus(state, key)`（补齐既有
  `selectStatus` / `selectEntries` / `selectBranch`）。
- 迁移全部 7 处生产直读（含 `WorktreeList` 整表读、两个 `getState()` 命令式读）到 selector。
- 在 `check_repo_unit_identity` 增「判据 7」：`projectStore.statuses` 直读 / 解构命中即违规
  （白名单仅 `projectStore.ts`），含自测。

### R3 组件规模预算（预算不变量）

- 新增 `check_component_size` ratchet 护栏：`src/**/components/**` 与 `src/**/hooks/**` 组件/hook
  文件 ≤300 行；基线台账登记现存越线文件（path → 行数），未登记文件越线即红、已登记文件只允许缩小。
- 基线由脚本一次性生成（`--write-baseline` 或独立生成步骤），不得手抄。

## Acceptance Criteria

- [ ] `activate` 签名不含任何 Tauri 类型；`git/services/**` 无 `tauri::` / `AppHandle` / `AppHandleSink`。
- [ ] 新增服务层测试：注入 `CollectingSink` + 隔离 `AppStateWrapper` 能驱动 `activate` 且断言挂载/事件/释放；旧代码上必红。
- [ ] `AppStateWrapper` 隔离夹具只剩一份实现（三处复用点改 re-export）。
- [ ] 生产代码 `grep` 不到 `.statuses`（`projectStore.ts` 除外）；7 处迁移完成。
- [ ] `check_repo_unit_identity` 判据 7 自测含坏例（`s.statuses[k]`、`{ statuses }` 解构）与好例。
- [ ] `check_component_size` 自测：未登记越线必红、已登记缩小为绿、基线文件不存在 → broken。
- [ ] `ConnectionProjectCard.tsx` 仍 ≤300 行（当前 277，不得回涨）。
- [ ] `cargo fmt` / `cargo clippy -D warnings` / `cargo test` / `pnpm lint` / `pnpm type-check` / `pnpm test:run` 全绿。
- [ ] `ledger/invariants.json` 追加 R1/R2/R3 三条不变量，落点为对应 guard/test。

## Non-goals

- 不重构 zustand state 形状（不做类型级隐藏，见 design 诚实声明）。
- 不批量拆分现有 42+17 个越线文件（ratchet 只止血，还债另开任务）。
- 不做 AC13 真实 WSL/SSH 现场验证。

## 前置

- T1（`10-06-invariant-ledger-guard`）的台账格式与门禁先就位。

## 风险

- R1 抽测试支撑可能触及 dap 测试调用点 → 用 re-export 保持调用点零改动。
- R2 的 `useGitStatusEventsSync` 迁移不得改变 `undefined` vs `''` 的分支语义（用
  `selectStatus(...)?.branch`，不用 `selectBranch`）。
- R3 基线台账体积大（~59 行 JSON）→ 脚本生成，避免手抄漂移。
