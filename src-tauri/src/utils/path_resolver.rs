use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;

/// 从 project_manager 解析项目根路径。
pub fn resolve_project_path(
    state: &AppStateWrapper,
    project_id: &str,
) -> Result<PathBuf, AppError> {
    let pm = state
        .project_manager
        .lock()
        .map_err(|e| AppError::File(e.to_string()))?;
    pm.get_project(project_id)
        .map(|p| p.path.clone())
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))
}

/// 解析基础路径：优先使用 worktree 路径，否则从 project_manager 获取。
pub fn resolve_worktree_or_project(
    state: &AppStateWrapper,
    project_id: &str,
    root_path: Option<&str>,
) -> Result<PathBuf, AppError> {
    if let Some(rp) = root_path {
        let root = PathBuf::from(rp);
        if !root.exists() {
            return Err(AppError::File(format!("Root path not found: {}", rp)));
        }
        if !root.is_dir() {
            return Err(AppError::File(format!(
                "Root path is not a directory: {}",
                rp
            )));
        }
        root.canonicalize()
            .map_err(|e| AppError::File(format!("Invalid root path: {}", e)))
    } else {
        resolve_project_path(state, project_id)
    }
}

/// 校验目标路径在根目录范围内（防止路径穿越）。
pub fn validate_within_root(
    target: &std::path::Path,
    root: &std::path::Path,
) -> Result<(), AppError> {
    let canonical_target = target
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid path: {}", e)))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid root path: {}", e)))?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::File("Path is outside root directory".to_string()));
    }
    Ok(())
}
