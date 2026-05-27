# Git Unification: Delete Old Commands, Switch Frontend to Unified

## Goal

消除三端（Local/WSL/Remote）Git 命令的重复实现，统一走 `GitTransport` 分发。删除遗留的 `commands/git.rs`、`commands/git_wsl.rs`、`commands/git_remote.rs` 中的旧 Git 命令，前端所有 invoke 调用切换到 unified 命令入口。

## Completed

### Candidate #1: AI Commit Dedup ✅
- Extracted `build_agent_commit_cmd()` into `workspace/commands_ai_commit.rs`
- WSL 和 Remote 共享 cmd 构造逻辑
- 替换了占位测试为真实单元测试（cargo test 78 passed）

### Candidate #2: Cross-store Project Selection ✅
- Extracted `handleSelectProjectWithClear` from 698-line `useAppContainer` into `useProjectSelection` hook
- 新 hook 先读全部 4 个 store 状态 → 计算 deltas → 再统一 apply
- useAppContainer 中的包装层保留 `closeSettingsView()` 和 `setWslDiffState(null)` 作为 app 层关注点

### Core Git Unification (Previous Work) ✅
- Extended `git/transport.rs` with `open_repo()` and `supports_git2()`
- Wrote `git/operations.rs` with all shell-based git operations
- Wrote `git/commands_unified.rs` with 30+ unified Tauri commands
- Rewrote `commandFactory.ts` to single `createUnifiedCommands(transport)`
- Migrated 11 hooks/components to unified commands
- Trimmed `git/commands.rs`, `git/commands_wsl.rs`, `git/commands_remote.rs`
- Cleaned `neeko_invoke_handler!` macro
- Cleaned `commandFactory.test.ts`

## Remaining Work

- Architecture candidate #3–6: git2 transport bypass, god hook decomposition, legacy re-export layer, component-store shortcuts

## Technical Notes

- git2 preserved for local info operations (get_git_info, get_git_branch_info, get_file_diff)
- Frontend invoke() calls switched in a single cutover
- Architecture report saved to `/tmp/architecture-review-1779861800.html`
- Committed as `ee15a9b` (27 files, 1497 insertions, 2806 deletions)

## Out of Scope (for this task)

- Architecture candidates #3–6 deferred to future tasks
