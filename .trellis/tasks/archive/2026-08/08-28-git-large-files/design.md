# Design — Git domain large files decomposition

## 1. Invariant (First Principles)

`operations.rs` was a God File because all write operations shared the same `transport: &dyn GitTransport` + `invalidate_caches` pattern but lived in one file. The fix is **directory + mod.rs thin hub** (Slim Mod Hub #14) + `pub use` re-exports so external path `crate::common::git::operations::stage_files` stays stable (open-closed).

## 2. Module Map (mirrors `operations/` reference)

```
common/git/
  local/          # was local.rs 1065
    mod.rs        # thin hub
    status.rs     # get_status, get_changed_files_from_repo
    branch.rs     # get_branch_info_from_repo
    worktree.rs   # get_worktrees, is_worktree_dirty
    diff.rs       # get_file_diff, assert_git_repo
  parsers/        # was parsers.rs 865
    mod.rs
    status.rs     # parse_status_line (single porcelain entry)
    diff.rs       # parse_unified_diff, collapse_diff_context
    commit.rs     # parse_commit_log_output, extract_commit_hash
    numstat.rs    # parse_numstat_line
  transport/      # was transport.rs 682
    mod.rs        # trait GitTransport, GitExecOptions
    local.rs      # LocalTransport
    ssh.rs        # SshTransport
    wsl.rs        # WslTransport (cfg windows)
  cache/          # was cache.rs 603
    mod.rs
    memory.rs     # RwLock map, invalidate_repo_caches
    file.rs       # Json file persistence
    key.rs        # cache key helpers
  status_worker/  # was status_worker.rs 712
    mod.rs
    worker.rs     # tokio loop, listen/unlisten
    writer.rs     # GitStatusFile assembly (parse_porcelain wrapper removed)

git/
  commands/       # was commands.rs 983 (40+ commands)
    mod.rs        # thin hub, re-exports
    index.rs      # stage/unstage/discard (5 commands)
    branch.rs     # checkout/create/delete/rename (6)
    worktree.rs   # worktree create/remove/rename (3)
    stash.rs      # stash list/apply/pop (5)
    sync.rs       # fetch/push/pull + credentials (6)
    query.rs      # info/log/diff (8)
  services/commit/ # was services/commit.rs 520
    mod.rs
    prompt.rs
    diff_aggregator.rs
    service.rs    # generate_commit_message orchestration
```

Each new file target <350 lines, `mod.rs` <40 lines, `#[deny(missing_docs)]` satisfied via `#![allow(missing_docs)]` only on the new `mod.rs` where `pub mod` docs are intentionally slim (mirrors `operations/mod.rs` precedent).

## 3. Rewiring Rules

- `super::cache` / `super::parsers` inside `operations/*.rs` → `crate::common::git::cache` / `crate::common::git::parsers` (because `super` is now `operations`, not `common::git`)
- Cross-submodule calls (e.g., `commit.rs` → `stage_files` in `stage.rs`) → `use crate::common::git::operations::stage::stage_files;`
- Helpers used by `#[cfg(test)]` (e.g., `parse_worktree_list`, `get_worktree_changed_files_shell`) → `pub(crate)`
- Section comments `// ─── Worktree ───` are dropped (they were splitting artifacts, not docs)

## 4. Test Strategy (80% gate)

- Keep existing `#[cfg(test)]` blocks in place, move the unified `operations/tests.rs` (already 803 lines) as-is via `#[cfg(test)] mod tests;` in `operations/mod.rs`
- New sub-modules reuse the same `cargo test --lib` suite (890 tests). No new test files required unless a new helper is introduced (then add `#[test]` in the same file, mirroring `parsers.rs` `porcelain_status_tests`)
- Frontend `pnpm lint:fe` is unaffected (Rust-only change)

## 5. Rollout Batches (for `implement.md`)

- **Batch 1**: `local.rs` + `parsers.rs` (no inter-dependency, easiest to verify)
- **Batch 2**: `transport.rs` + `cache.rs` + `status_worker.rs` (transport is leaf, cache is leaf)
- **Batch 3**: `git/commands.rs` + `services/commit.rs` (depends on Batch 1-2, touches IPC thin layer)

Each batch: `cargo check` → `cargo fmt` → `clippy -D warnings` → `cargo test` before next batch.

## 6. Non-Goals

- No API change for `crate::git::commands::*` (Tauri `neeko_invoke_handler!` stays untouched)
- No frontend changes
