# C2 Design: Backend File I/O Unification

## Goal

Remove 3-way `match GitTransport` in `git/commands.rs` for file operations. Route all file I/O through a unified `common/file/service.rs` that accepts `ExecTarget`.

## Design

### New: `common/file/service.rs`

```rust
pub async fn read_dir_tree(
    target: &ExecTarget,
    root_path: &str,
    sub_path: Option<&str>,
    max_depth: u32,
) -> Result<Vec<FileNode>, AppError>

pub async fn read_file_content(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
) -> Result<FileContent, AppError>

pub async fn write_file_content(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
    content: &str,
) -> Result<(), AppError>

pub async fn read_file_content_shell(
    target: &ExecTarget,
    full_path: &str,
) -> Result<FileContent, AppError>
```

### Implementation Strategy

- `Local` target: delegate to existing `common/file/services.rs` (pure fs)
- `Wsl`/`Remote` target: use `exec_on(target, "bash", &["-c", &cmd])` pattern

### Files to Remove/Merge

- `common/git/wsl.rs` → `wsl_read_dir_tree` moves to `file/service.rs`, file removed
- `common/git/remote.rs` → `remote_read_dir_tree_fn` moves to `file/service.rs`, `get_remote_git_info` stays in operations

### `git/commands.rs` Changes

- `read_dir_tree` → calls `file_service::read_dir_tree(target, ...)`
- `read_file_content` → calls `file_service::read_file_content(target, ...)`
- `write_file_content` → calls `file_service::write_file_content(target, ...)`
- `generate_commit_message` — stays 3-way (different logic: AI agent dispatch vs shell)
- Remove `exec_target_from_git_transport` (duplicate of `ProjectEnvironment::to_exec_target`)

### `resolve_agent_config` / `resolve_agent_for_remote`

- These have different signatures but overlapping purpose
- `resolve_agent_config` returns `AgentInvokeConfig`; used by generate_commit_message
- `resolve_agent_for_remote` returns `(String, Vec<String>, Vec<String>)`; used for remote agent dispatch
- Keep as is but consolidate naming: rename `resolve_agent_for_remote` → `resolve_agent_command` and unify return type
