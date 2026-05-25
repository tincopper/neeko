# Phase 5.3: operations.rs（共享 git 操作）

## Goal

基于 `GitTransport` 抽象，创建 `git/operations.rs`，包含 8 个 shell-only git 操作。这些操作在 local/wsl/remote 三端完全一致，唯一差异是执行机制。

## Batch 1: Shell-only operations

| 操作 | git 命令 | 当前三路实现 |
|---|---|---|
| `stage_files` | `git add -- <files>` | local.rs L797 / wsl_git.rs inline / remote_git.rs inline |
| `unstage_files` | `git restore --staged -- <files>` | local.rs L819 / wsl_git.rs inline / remote_git.rs inline |
| `discard_file` | `git checkout -- <file>` | local.rs L903 / wsl_git.rs inline / remote_git.rs inline |
| `fetch` | `git fetch --all` | local.rs L1051 / wsl_git.rs inline / remote_git.rs inline |
| `push` | `git push` | local.rs L1120 / wsl_git.rs inline / remote_git.rs inline |
| `cherry_pick` | `git cherry-pick <hash>` | local.rs L1451 / wsl_git.rs inline / remote_git.rs inline |
| `revert` | `git revert --no-edit <hash>` | local.rs L1468 / wsl_git.rs inline / remote_git.rs inline |
| `create_tag` | `git tag -a <name> -m <msg>` | local.rs L1485 / wsl_git.rs inline / remote_git.rs inline |

## Requirements

1. 创建 `git/operations.rs`，实现 8 个函数
2. 每个函数接受 `&GitTransport` + 参数，返回 `Result<()>`
3. 函数内部调用 `transport.run_git(&args, work_dir).await`
4. 不修改任何现有文件（纯新增）

## Acceptance Criteria

- [ ] `cargo check` 零 error
- [ ] `cargo test` 全部通过
- [ ] 新 operations 编译通过

## Out of Scope

- 不替代现有 local.rs / wsl.rs / remote.rs 函数
- 不修改 commands 或前端
- 不含 git2 特定操作（commit, pull — Phase 5.4）
