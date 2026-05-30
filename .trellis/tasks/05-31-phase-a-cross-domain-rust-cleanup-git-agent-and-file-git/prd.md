# Phase A: Cross-domain Rust cleanup

## Goal
Eliminate two cross-domain direct calls in Rust backend by extracting shared logic to `core/`.

## Items

### 1. AI commit message → `core/services/commit.rs`
- `git/commands.rs:812` → `agent::services::commit` and `agent::commands_commit`
- Create `core/services/commit.rs` with the AI commit logic
- Both `git` and `agent` import from `core::services::commit`

### 2. GitStatusWorker → `core/watcher.rs`
- `file/watcher.rs` → `crate::git::worker::{GitStatusDiff, GitStatusWorker}`
- Move `GitStatusWorker` and `GitStatusDiff` to `core/watcher.rs`
- Both `file/watcher` and `git/worker` import from `core::watcher`

## Acceptance Criteria
- [ ] `cargo check` passes
- [ ] `cargo clippy` passes (no new warnings)
- [ ] `cargo test` passes
- [ ] No remaining `crate::agent` imports in `git/commands.rs`
- [ ] No remaining `crate::git::worker` imports in `file/watcher.rs`

## Out of Scope
- module visibility fixes (Phase B)
- ESLint rule upgrades (Phase C)
