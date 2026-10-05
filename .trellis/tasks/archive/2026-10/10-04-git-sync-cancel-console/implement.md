# 执行计划

## Step 0 · 前置

- [x] `task.py create`（本任务）
- [ ] `task.py add-context` + `task.py start`

## Step 1 · 领域/执行层

- [x] `common/git/transport/cancel.rs`：`GitSyncHandle` + `GitSyncEntry` + `GitSyncSlots` 注册表（按 `RepoRef::key()` 分槽）+ `GitSyncGuard`
- [x] `common/executor/collect.rs`：`drain_stream` 合流（16KB / 50ms / EOF 冲刷）+ 两条回归测试
- [x] `common/git/transport/mod.rs`：`GitRunHooks` owned + `run_shell_streaming` / `finish_git_output`
- [x] `local.rs` / `wsl.rs` / `ssh.rs`：改走共享核心（消三份复制）
- [x] `operations/{commit,sync}.rs`：签名去生命周期

## Step 2 · 命令层

- [x] `git/commands/sync.rs`：`begin_git_run`（唯一装配点，按仓库单元占槽）+ `cancel_git_sync(console_run_id)` 目标匹配
- [x] `git/commands/commit.rs`：改走 `begin_git_run`
- [x] `app_state.rs`：槽类型 `GitSyncSlots`（同单元互斥 / 异单元并行）

## Step 3 · 前端

- [x] 事件常量归 `shared/events.ts`；payload 归 `shared/types/git.ts`；删 `shared/utils/gitEvents.ts`
- [x] `gitApi.cancelGitSync(consoleRunId)` + `taskStore.cancelGitConsole(runId)` 透传
- [x] `features/git/api/gitConsoleRun.ts`：`runGitConsoleOp` 全入口编排（open → ok/auth 收尾 → fail）+ 仓库级 busy 去重；`taskStore` 增 `failGitConsole` / `awaitAuthGitConsole`
- [x] `useGitActions` / `ProjectsPanel` / `CommitDialog` 全走 `runGitConsoleOp`，去掉旁路 `withTimeout`（去墙钟）

## Step 4 · 验证

- [x] `cargo check --all-targets`、`cargo clippy -- -D warnings`、`cargo fmt --check`
- [x] 后端定向测试（transport / collect / operations / events）
- [x] `pnpm type-check` + 前端定向测试
- [x] `pnpm guards run --stage local`
- [x] `check_long_git_op_wall_clock` 护栏（禁长 git 操作包 `withTimeout`）+ 配套单测
- [x] `pnpm lint`（EXIT=0）/ `pnpm check`（lint + 三套测试全绿，2026-10-04）

## Step 5 · 文档与提交

- [x] `git-domain.md §13`：取消目标匹配 + 合流 + DRY 单点
- [x] `concurrency-guidelines.md`：超时策略段收 `GitSyncEntry` / run id / 合流
- [x] 提交（不 push）—— 待用户确认后执行

## Step 6 · 审查 P3 优化

- [x] `AppError::Conflict`（并发占用语义）+ `BUSY_MESSAGE` 常量 + Rust pin 测试
- [x] `GitSyncEntry.run_id` → `correlation_id`（去除 Console 语义下沉到 common）
- [x] 取消 kill 确认有界（`collect.rs` 的 `KILL_GRACE=5s` + `await_kill_bounded` + 两条单测）
- [x] `gitConsoleRun.ts` 文件头说明「为何在 api/」（导入防火墙白名单）
- [x] `GIT_BUSY_MESSAGE` 跨语言 pin 测试；spec 记录 command-future-drop 残留（非目标）
