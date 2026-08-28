# Implement — Git domain large files decomposition

## Batch 1: `local.rs` (1065) + `parsers.rs` (865)

1. `local.rs` → `local/`:
   - `cp local.rs /tmp/local_backup.rs`
   - `mkdir -p local && rm local.rs`
   - `local/mod.rs` thin hub + `local/status.rs`, `branch.rs`, `worktree.rs`, `diff.rs` (each with `#![allow(unused_imports, missing_docs)]` + `use super::{...}` rewired to `crate::`)
   - `pub(crate)` for `get_worktrees` helpers used in tests
2. `parsers.rs` → `parsers/`:
   - Same pattern: `parsers/mod.rs` + `status.rs`, `diff.rs`, `commit.rs`, `numstat.rs`
3. Verify: `cargo check`, `cargo fmt`, `clippy -D warnings`, `cargo test --lib` (expect 890 passed)

## Batch 2: `transport.rs` (682) + `cache.rs` (603) + `status_worker.rs` (712)

1. `transport.rs` → `transport/`:
   - `mod.rs` (trait), `local.rs`, `ssh.rs`, `wsl.rs` (cfg windows)
2. `cache.rs` → `cache/`:
   - `mod.rs` + `memory.rs`, `file.rs`, `key.rs`
3. `status_worker.rs` → `status_worker/`:
   - `mod.rs` + `worker.rs`, `writer.rs` (drop `parse_porcelain` wrapper, use `parsers::parse_status_line` directly as done in `operations` split)
4. Verify as above

## Batch 3: `git/commands.rs` (983) + `git/services/commit.rs` (520)

1. `git/commands.rs` → `git/commands/`:
   - `mod.rs` thin hub with `pub mod index/branch/...` + `pub use index::*` etc.
   - Move each `#[tauri::command]` verbatim, keep `Result<T, AppError>` + `State<AppStateWrapper>` thin delegation to `operations::*`
   - No `if let` nesting >=3 (check with `grep -n "if let"`)
2. `git/services/commit.rs` → `git/services/commit/`:
   - `mod.rs` + `prompt.rs`, `diff_aggregator.rs`, `service.rs`
3. Verify: `pnpm lint:fe` (frontend unaffected) + `cargo check` + `cargo test` (full, includes `git_test.rs` integration)

## Commit Strategy

- One commit per batch, English, Conventional Commits:
  - `refactor(git): split local.rs and parsers.rs per services pattern`
  - `refactor(git): split transport, cache and status_worker per services pattern`
  - `refactor(git): split git commands and commit service per services pattern`

## Rollback

- Each batch is a single `operations/`-style directory rename; rollback is `git restore` + `rm -rf` new directory
