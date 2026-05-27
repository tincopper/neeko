# Research: Dead Code in git/wsl.rs and git/remote.rs

- **Query**: Determine which functions in `git/wsl.rs` and `git/remote.rs` are dead code (no callers outside their own file)
- **Scope**: internal
- **Date**: 2026-05-27

## Summary

Both files were legacy git operation implementations that have been superseded by `git/operations.rs` (unified shell-based git ops). Only 3 of 27 public functions still have external callers:

| File | Public functions | LIVE (has external callers) | DEAD (no external callers) |
|---|---|---|---|
| `wsl.rs` | 14 | 2 | 12 |
| `remote.rs` | 13 | 2 | 11 |

---

## Findings: wsl.rs (`src-tauri/src/git/wsl.rs`)

**Module gating**: wsl.rs is `#[cfg(target_os = "windows")]` only (see `git/mod.rs:14,24`).

### LIVE Functions (have callers outside wsl.rs)

| Function | Called From | Notes |
|---|---|---|
| `open_wsl_ide` (line 80) | `project/commands_ide.rs:228` | `crate::git::open_wsl_ide(...)` — delegates to `utils::command::wsl::open_ide`. Also registered as `$crate::commands::open_wsl_ide` in `lib.rs:69` |
| `wsl_read_dir_tree` (line 412) | `git/commands_wsl.rs:18` | `crate::git::wsl_read_dir_tree(...)` — file tree reading, NOT a git operation. Also registered as `$crate::commands::wsl_read_dir_tree` in `lib.rs:89` |

### DEAD Functions (no callers outside wsl.rs)

| Function | Line | Notes |
|---|---|---|
| `get_wsl_git_info` | 15 | Superseded by `operations.rs` unified git info |
| `get_wsl_file_diff` | 36 | Superseded by `operations.rs` unified diff |
| `run_wsl_git` | 68 | Generic git command runner — superseded |
| `get_wsl_worktree_changed_files` | 85 | Superseded |
| `wsl_is_worktree_dirty` | 104 | Superseded |
| `get_wsl_worktree_file_diff` | 144 | Superseded |
| `wsl_get_commit_log` | 182 | Superseded |
| `wsl_get_commit_detail` | 219 | Superseded |
| `wsl_get_commit_files` | 264 | Superseded |
| `wsl_get_commit_file_diff` | 321 | Superseded |
| `wsl_get_ahead_behind` | 338 | Superseded |
| `wsl_commit_files` | 375 | Superseded |

### Private Helpers in wsl.rs (only internal callers, all dead-by-association)

| Function | Line | Called By |
|---|---|---|
| `parse_wsl_commit_log` | 214 | `wsl_get_commit_log:211` (DEAD) |
| `extract_wsl_commit_hash` | 407 | `wsl_commit_files:399` (DEAD) |
| `prefix_paths` | 448 | `wsl_read_dir_tree:441` (LIVE, but private) |
| `build_file_tree` | 457 | `wsl_read_dir_tree:437` (LIVE, but private) |

---

## Findings: remote.rs (`src-tauri/src/git/remote.rs`)

### LIVE Functions (have callers outside remote.rs)

| Function | Called From | Notes |
|---|---|---|
| `get_remote_git_info` (line 17) | `git/commands_remote.rs:15` | `crate::git::remote::get_remote_git_info(...)` — wrapped by `refresh_remote_git_info` command. Registered as `$crate::commands::refresh_remote_git_info` in `lib.rs:99` |
| `remote_read_dir_tree_fn` (line 401) | `git/commands_remote.rs:44` | `crate::git::remote::remote_read_dir_tree_fn(...)` — file tree reading, NOT a git operation. Registered as `$crate::commands::remote_read_dir_tree` in `lib.rs:102` |

### DEAD Functions (no callers outside remote.rs)

| Function | Line | Notes |
|---|---|---|
| `get_remote_file_diff` | 41 | Superseded by `operations.rs` unified diff |
| `run_remote_git` | 79 | Generic git command runner — superseded |
| `get_remote_worktree_changed_files` | 93 | Superseded |
| `remote_is_worktree_dirty` | 113 | Superseded |
| `get_remote_worktree_file_diff` | 156 | Superseded |
| `remote_get_commit_log` | 177 | Superseded |
| `remote_get_commit_detail_fn` | 201 | Superseded |
| `remote_get_commit_files_fn` | 244 | Superseded |
| `remote_get_commit_file_diff_fn` | 302 | Superseded |
| `remote_get_ahead_behind_fn` | 322 | Superseded |
| `remote_commit_files_fn` | 368 | Superseded |

### Private Helpers in remote.rs (only internal callers, all dead-by-association)

| Function | Line | Called By |
|---|---|---|
| `prefix_paths_remote` | 437 | `remote_read_dir_tree_fn:430` (LIVE, but private) |

---

## Parser Functions (in parsers.rs, not wsl.rs/remote.rs)

The user listed these under "parser functions in wsl.rs" but they actually live in `src-tauri/src/git/parsers.rs`. wsl.rs and remote.rs import and use some of them.

| Function | In parsers.rs line | Callers | Status |
|---|---|---|---|
| `parse_git_info_output` | 115 | wsl.rs:32, remote.rs:37, remote.rs tests (470,516) | LIVE |
| `parse_status_line` | 228 | wsl.rs:97, remote.rs:106, parsers.rs:196, remote.rs tests (482,490,497,504,510,511) | LIVE |
| `parse_commit_log_output` | 264 | wsl.rs:215, remote.rs:197 | LIVE (but both callers are from DEAD functions) |
| `parse_unified_diff` | 12 | wsl.rs (43,155,332), remote.rs (53,171,316), operations.rs (514,748), local.rs (641,1340 + tests) | LIVE |
| `collapse_diff_context` | 94 | wsl.rs:333, remote.rs:317, operations.rs (515,769), local.rs (687,1341) | LIVE |
| `extract_commit_hash_from_output` | 295 | wsl.rs:408, remote.rs:392 | LIVE (but wsl.rs caller in DEAD function) |
| `build_file_tree_from_find` | 314 | wsl.rs:458, remote.rs:426 | LIVE |

**Note**: `parse_commit_log`, `parse_worktree_list`, `parse_porcelain_status`, `extract_commit_hash`, `parse_numstat_line` — these are local functions in `operations.rs` and/or `local.rs`, not in `wsl.rs` or `remote.rs`. They don't exist in the two files under investigation.

---

## Tauri Command Registration (lib.rs)

The `neeko_invoke_handler!` in `lib.rs` confirms no old WSL/Remote git commands remain registered. The only wsl/remote entries are:

**WSL block** (lines 84-92): `get_wsl_distros`, `get_wsl_directories`, `get_wsl_home_dir`, `create_wsl_terminal_session`, `wsl_set_project_color`, `wsl_read_dir_tree`, `wsl_read_file_content`, `wsl_write_file_content`, `wsl_generate_commit_message`

**Remote block** (lines 94-105): `create_remote_terminal_session`, `close_remote_terminal_session`, `resize_remote_terminal`, `test_remote_connection`, `list_remote_directories`, `refresh_remote_git_info`, `get_remote_home_dir`, `remote_set_project_color`, `remote_read_dir_tree`, `remote_read_file_content`, `remote_write_file_content`, `remote_generate_commit_message`

None of these are the legacy git operations from wsl.rs/remote.rs.

---

## Caveats

1. **`wsl.rs` is Windows-only** — it's behind `#[cfg(target_os = "windows")]` in `git/mod.rs`. On non-Windows, the entire file is dead code regardless of caller analysis.
2. **`open_wsl_ide` is not a git function** — it launches an IDE in WSL. Despite being in `git/wsl.rs`, it has nothing to do with git. Its caller chain is: Tauri command → `project/commands_ide.rs:225` → `git/wsl.rs:80` → `utils/command/wsl::open_ide`.
3. **Private helpers of LIVE functions**: `prefix_paths` (line 448) and `build_file_tree` (line 457) are called by the LIVE `wsl_read_dir_tree`, so they can't be removed unless `wsl_read_dir_tree` itself is refactored. Similarly `prefix_paths_remote` (line 437) is called by the LIVE `remote_read_dir_tree_fn`.
4. **Test code in `remote.rs`** (lines 447-521) tests `parse_git_info_output` and `parse_status_line` — these tests reference parser functions, not remote.rs's own public API. These tests could be relocated to `parsers.rs` or a test module.
