# 批量迁移 Git 命令到 operations.rs

## Goal

将 `commands/git.rs`、`commands/wsl_git.rs`、`commands/remote_git.rs` 中与 `operations.rs` 对应的命令体替换为统一实现。命令签名不变，前端零改动。

## Commands to migrate

| operations.rs | git.rs | wsl_git.rs | remote_git.rs |
|---|---|---|---|
| `stage_files` | ✅ done | ✅ done | ✅ done |
| `unstage_files` | `unstage_files_command` | `wsl_unstage_files` | `remote_unstage_files` |
| `discard_file` | `discard_file_command` | `wsl_discard_file` | `remote_discard_file` |
| `fetch` | `fetch_command` | `wsl_fetch` | `remote_fetch` |
| `push` | `push_command` | `wsl_push` | `remote_push` |
| `cherry_pick` | `cherry_pick_command` | `wsl_cherry_pick` | `remote_cherry_pick` |
| `revert` | `revert_command` | `wsl_revert_commit` | `remote_revert_commit` |
| `create_tag` | `create_tag_command` | `wsl_create_tag` | `remote_create_tag` |
| `checkout_branch` | `checkout_branch` | `wsl_checkout_branch` | `remote_checkout_branch` |
| `create_branch` | `create_branch` | `wsl_create_branch` | `remote_create_branch` |
| `delete_branch` | `delete_branch` | — | — |
| `rename_branch` | `rename_branch` | `wsl_rename_branch` | `remote_rename_branch` |
| `remove_worktree` | `remove_worktree` | `wsl_remove_worktree` | `remote_remove_worktree` |
| `rename_worktree` | `rename_worktree` | `wsl_rename_worktree` | `remote_rename_worktree` |
| `is_worktree_dirty` | `is_worktree_dirty` | `wsl_is_worktree_dirty` | `remote_is_worktree_dirty` |
| `checkout_detached` | `checkout_detached_command` | — | — |
| `create_and_switch_branch` | `create_and_switch_branch_command` | — | — |

## Acceptance Criteria

- [ ] `cargo check` 零 error
- [ ] `cargo test` 全部通过
- [ ] `npx tsc --noEmit` 零 error
- [ ] 命令签名不变
