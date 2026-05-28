use crate::project::types::{FileContent, FileNode};
use crate::AppError;
use crate::AppStateWrapper;
use crate::workspace::services;
use tauri::State;

/// 读取目录树
#[tauri::command]
pub fn read_dir_tree(
    project_id: String,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(services::file_ops::DEFAULT_TREE_DEPTH);
    let base = services::path_resolver::resolve_worktree_or_project(
        &state,
        &project_id,
        root_path.as_deref(),
    )?;
    services::file_ops::read_dir_tree(&base, sub_path.as_deref(), depth)
}

/// 读取文件内容
#[tauri::command]
pub fn read_file_content(
    project_id: String,
    file_path: String,
    root_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<FileContent, AppError> {
    let base = services::path_resolver::resolve_worktree_or_project(
        &state,
        &project_id,
        root_path.as_deref(),
    )?;
    services::file_ops::read_file_content(&base, &file_path)
}

/// 写入文件内容
#[tauri::command]
pub fn write_file_content(
    project_id: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let base = services::path_resolver::resolve_worktree_or_project(
        &state,
        &project_id,
        root_path.as_deref(),
    )?;
    services::file_ops::write_file_content(&base, &file_path, &content)
}
