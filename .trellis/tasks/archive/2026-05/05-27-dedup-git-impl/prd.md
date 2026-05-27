# Remove Dead Git Operations, Consolidate Parsers

## Goal

Remove dead git operations from `wsl.rs` and `remote.rs` (superseded by `operations.rs`). Consolidate duplicate parser functions.

## Scope

### Dead code removal
- wsl.rs: 12 dead git functions (all git operations except `open_wsl_ide` and `wsl_read_dir_tree`)
- remote.rs: 11 dead git functions (all git operations except `get_remote_git_info` and `remote_read_dir_tree_fn`)

### Parser consolidation
- `parse_commit_log`: use `parsers.rs` version in local.rs and operations.rs
- `extract_commit_hash`: use `parsers.rs` version
- `parse_numstat_line`: keep in operations.rs (already used by both)

## Out of Scope
- local.rs cleanup (Candidate #3 — git2 bypass, already rejected)
