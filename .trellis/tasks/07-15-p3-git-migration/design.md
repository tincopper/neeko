# P3 Design: git 命令迁移

## 模式转换

### 当前模式（所有 git 命令）

```rust
// 常规 git 命令 — 只有 transport，无 project lookup
#[tauri::command]
pub async fn stage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_files(&t, wd, &file_paths).await.map_err(AppError::from)
}

// PR 命令 — transport + project_id 双参数
#[tauri::command]
pub async fn list_prs_command(
    project_id: String,
    transport: GitTransportKind,
    state: String,
    limit: usize,
    state_w: State<'_, AppStateWrapper>,
) -> Result<Vec<PRListItem>, AppError> {
    let target = into_exec_target(&transport);
    let project_path = { /* lookup from project_manager */ };
    crate::git::list_prs(&project_path, &target, &state, limit).await.map_err(AppError::from)
}
```

### 统一模式

```rust
// 所有命令统一
#[tauri::command]
pub async fn stage_files(
    project_id: String,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    operations::stage_files(&t, &wd, &file_paths).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn list_prs_command(
    project_id: String,
    state_filter: String,
    limit: usize,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<PRListItem>, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = match &t {
        GitTransport::Local => ExecTarget::Local,
        GitTransport::Wsl { distro } => ExecTarget::Wsl { distro: distro.clone() },
        GitTransport::Remote { host, port, username, auth } => ExecTarget::Remote { ... },
    };
    crate::git::list_prs(&wd, &target, &state_filter, limit).await.map_err(AppError::from)
}
```

## 辅助宏

由于大量命令都重复 `let (t, wd) = state.resolve_project(&project_id)?;` 模式，可定义宏简化：

```rust
macro_rules! resolve_project {
    ($state:expr, $project_id:expr) => {
        $state.resolve_project($project_id)?
    };
}
```

## 删除清单

从 `git/commands.rs` 删除（或移至内部辅助模块）：

1. `GitTransportKind` enum
2. `FileTransportKind` enum
3. `into_transport_and_dir()`
4. `into_exec_target()`

## 特殊处理

- `get_remote_home_dir` 不接收 transport 也不接收 project_id，保持不变
- `is_gh_installed_command` / `is_gh_authenticated_command` 无参数，保持不变
- 文件操作命令（`read_dir_tree`, `read_file_content`, `write_file_content`）当前使用 `FileTransportKind`，统一改为 `project_id` + `state`
- `generate_commit_message` 当前使用 `FileTransportKind`，改为 `project_id` + `state`

## 数量统计

总共约 50 个命令需要修改签名 + 内部逻辑：
- staging: 6 (stage_files, unstage_files, stage_all, unstage_all, discard_file, discard_all)
- remote: 7 (fetch, pull, push, fetch_with_credentials, pull_with_credentials, push_with_credentials, commit_files)
- cherry-pick/revert/tag: 3 (cherry_pick, revert, create_tag)
- branching: 6 (checkout_branch, create_branch, delete_branch, rename_branch, create_and_switch_branch, checkout_detached)
- worktree: 4 (create_worktree, remove_worktree, rename_worktree, is_worktree_dirty)
- info/read: 7 (get_git_info, get_git_branch_info, get_worktree_changed_files, get_changed_files_diff_stats, get_file_diff, is_git_repo, get_remote_home_dir — 最后一个不变)
- commit log: 5 (get_commit_log, get_commit_detail, get_commit_files, get_commit_file_diff, get_ahead_behind)
- default branch: 1 (default_branch)
- file operations: 3 (read_dir_tree, read_file_content, write_file_content)
- commit message: 1 (generate_commit_message)
- PR commands: 15+ (list_prs, list_repo_labels, list_repo_authors, view_pr, create_pr, merge_pr, close_pr, list_pr_files, list_pr_commits, list_pr_comments, add_pr_comment, edit_pr_comment, delete_pr_comment, add_comment_reaction, add_pr_review_comment, list_pr_review_comments)
