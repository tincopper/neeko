# Git domain large files decomposition per services pattern

## Goal

Decompose the remaining 7 God Files in `src-tauri/src/common/git` and `src-tauri/src/git` that exceed the high-cohesion threshold (300/500 lines) using the `directory-structure.md` `services.rs` extraction pattern. `operations.rs` (2417 lines) has already been split into `operations/` (11 files, each <350) as the reference implementation in `f49b34ea`. This task completes the same for the rest of the git domain without any behavioral change.

## Background

- `operations.rs` split verified: `cargo check` / `clippy -D warnings` / `cargo test 890 passed`
- Remaining violations ( `wc -l` 2026-08-28 ):
  - `common/git/local.rs` 1065
  - `git/commands.rs` 983
  - `common/git/parsers.rs` 865
  - `common/git/status_worker.rs` 712
  - `common/git/transport.rs` 682
  - `common/git/cache.rs` 603
  - `git/services/commit.rs` 520

All violate `AGENTS.md` 高内聚低耦合 / `Slim Mod Hub` (mod.rs 只允许 `mod` + `pub use`) and the 300-line soft limit for UI (500-line soft limit for Rust domain as applied in this task).

## Requirements

### Scope — In

1. **`common/git/local.rs` (1065)** → `local/` directory:
   - `mod.rs` thin hub + `status.rs` (get_status / get_changed_files_from_repo) + `branch.rs` (get_branch_info_from_repo) + `worktree.rs` (get_worktrees / is_worktree_dirty) + `diff.rs` (get_file_diff / assert_git_repo)
2. **`common/git/parsers.rs` (865)** → `parsers/` directory:
   - `mod.rs` + `status.rs` (parse_status_line) + `diff.rs` (parse_unified_diff / collapse_diff_context) + `commit.rs` (parse_commit_log_output / extract_commit_hash) + `numstat.rs`
3. **`common/git/status_worker.rs` (712)** → `status_worker/`:
   - `mod.rs` + `worker.rs` (tokio loop) + `parser.rs` (parse_porcelain thin wrapper, now deleted after unification — keep only worker) + `writer.rs` (GitStatusFile assembly)
4. **`common/git/transport.rs` (682)** → `transport/`:
   - `mod.rs` (trait GitTransport + GitExecOptions) + `local.rs` + `ssh.rs` + `wsl.rs`
5. **`common/git/cache.rs` (603)** → `cache/`:
   - `mod.rs` + `memory.rs` (RwLock map + invalidate) + `file.rs` (Json persistence) + `key.rs`
6. **`git/commands.rs` (983)** → `git/commands/`:
   - `mod.rs` thin hub + `index.rs` + `branch.rs` + `worktree.rs` + `stash.rs` + `sync.rs` + `query.rs` (info/log/diff) — each `#[tauri::command]` remains thin, delegates to `operations::*`
7. **`git/services/commit.rs` (520)** → `git/services/commit/`:
   - `mod.rs` + `prompt.rs` + `diff_aggregator.rs` + `service.rs`

### Scope — Out

- Frontend (`src/features/*`), other Rust domains (`terminal`, `connection`, `project`), and test helpers (`tests.rs` files may remain >500 as they are not production code)
- No new IPC commands, no API behavior change

### Constraints

- Follow `directory-structure.md` `services.rs` pattern: pure I/O without `AppStateWrapper` goes to `services.rs` / sub-module, stateful goes to `Manager`
- `mod.rs` / directory root must stay **Slim Hub** (only `mod` + `pub use`, no `fn`/`impl`)
- Cross-module helpers that were `fn` but are used by tests or sibling modules become `pub(crate)`
- Preserve `#[allow(unused_imports, missing_docs)]` only where needed for split; do not suppress `clippy::empty_line_after_doc_comments`
- Keep `cargo fmt` and `clippy -D warnings` green

## Acceptance Criteria

- [ ] Each new sub-module file <400 lines (soft), `mod.rs` <40 lines
- [ ] `wc -l` for the 7 target files: no production file >500, `operations/` already <350 verified
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` passes
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` passes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 890+ passed (existing `operations/tests.rs` and `parsers` tests remain green)
- [ ] `cargo fmt -- --check` passes
- [ ] `pub use` re-exports in each new `mod.rs` keep external `crate::common::git::local::get_status` / `crate::git::commands::stage_files` etc. paths working (no breaking API)
- [ ] No `if let` nesting >=3 introduced (flatten to `match`)

## Notes

- Reference implementation: `f49b34ea` (operations.rs 2417 → 11 files)
- Batch order: (1) `local.rs` + `parsers.rs` (no cross-dependency), (2) `transport.rs` + `cache.rs` + `status_worker.rs`, (3) `git/commands.rs` + `services/commit.rs`
- Risk: `super::` → `crate::common::git::` rewiring and `pub(crate)` promotion for test helpers; mitigated by `cargo test` after each batch
