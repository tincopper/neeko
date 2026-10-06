# 执行计划：退出时收敛 git 子进程树

> 硬闸门：本文件 + `prd.md` + `design.md` 完成后，**等用户显式确认**再 `task.py start` 写代码。

## Step 0 · 前置
- [x] `task.py add-context`（implement/check 清单）
- [x] 用户确认设计 → `task.py start`

## Step 1 · 登记表核心（新文件）
- [x] `src-tauri/src/common/executor/child_registry.rs`
  - `track(pid) -> ChildLease`（RAII 注销）、`kill_all_live()`、`kill_all_with(&dyn Fn(u32))`、`is_tracked`
  - 锁纪律：短临界 / 无 await / 中毒 tolerant；`kill_all_with` 锁外调 killer
- [x] `common/executor/mod.rs`：`mod child_registry;` + `pub use child_registry::{track, kill_all_live, is_tracked};`
- [x] `#[cfg(test)]`：track→kill_all_with 命中 / lease drop→不命中 / 空表 no-op / 幂等；**不调 kill_all_live**

## Step 2 · 传输层登记
- [x] `common/git/transport/mod.rs::run_shell_streaming`：spawn 后 `let _lease = child.pid.map(track);`
- [x] 复核：`run_shell_streaming` 是 git 传输唯一经 `kill_tree` 的 spawn 路径（grep）

## Step 3 · 退出收敛
- [x] `app_state.rs::shutdown_background_and_exit`：`CleanupTask` 增 `("git-children", || kill_all_live())`
- [x] 复核顺序：在 terminal/remote/watcher/lsp 关停前后均可（同步 fire-and-forget），放终态前

## Step 4 · 文档
- [x] `git-domain.md §13`：「已知残留」改述为**已收敛**（登记 + 退出树杀 + 远端边界）
- [x] `concurrency-guidelines.md`：增「退出时子进程收敛」判据（登记表 / kill_all / 平台门面）

## Step 5 · 验证
- [x] `cargo fmt --all -- --check`、`cargo clippy -- -D warnings`
- [x] `cargo test --lib`（含新单测）
- [x] `pnpm lint`（10 护栏）、`pnpm check`（lint + 三套测试）
- [x] 人工复核：无第二 `kill_tree` spawn 路径漏登记

## Step 6 · 提交
- [x] `test(executor): ...` + `fix(git): ...` 或单个 `fix(git): reap git child trees on app exit`
- [x] 不 push；收尾 `add_session.py`
