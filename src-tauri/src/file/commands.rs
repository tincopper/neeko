use crate::platform::reveal::{build_reveal_command, normalize_path};
use crate::project::types::{FileContent, FileNode};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::Path;
use tauri::State;

// ── Opener Command ───────────────────────────────────────────────────────────

/// 在系统文件管理器中打开或 reveal 指定路径
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), AppError> {
    let normalized = normalize_path(&path);
    let path = Path::new(&normalized);

    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "Path does not exist: {}",
            normalized
        )));
    }

    if let Some(mut cmd) = build_reveal_command(path) {
        cmd.spawn()
            .map_err(|e| AppError::Io(format!("Failed to reveal in file manager: {}", e)))?;
    }

    Ok(())
}

// ── File operations ──────────────────────────────────────────────────────────

/// Read the directory tree.
#[tauri::command]
pub async fn read_dir_tree(
    project_id: String,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
    ignored: Option<Vec<String>>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileNode>, AppError> {
    // 深度常量单一事实源：crate::common::file::services::DEFAULT_TREE_DEPTH
    let depth = max_depth.unwrap_or(crate::common::file::services::DEFAULT_TREE_DEPTH);
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    // 被 .gitignore 忽略的目录剪枝：保留目录节点，子节点由懒加载展开时按需返回
    let ignored_list = ignored.unwrap_or_default();
    crate::common::file::services::read_dir_tree(
        &target,
        &base,
        sub_path.as_deref(),
        depth,
        &ignored_list,
    )
    .await
}

/// Read file content.
#[tauri::command]
pub async fn read_file_content(
    project_id: String,
    file_path: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<FileContent, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::read_file_content(&target, &base, &file_path).await
}

/// Write file content.
#[tauri::command]
pub async fn write_file_content(
    project_id: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::write_file_content(&target, &base, &file_path, &content).await
}

/// Create a new empty file (with parent directories).
#[tauri::command]
pub async fn create_new_file(
    project_id: String,
    file_path: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::create_new_file(&target, &base, &file_path).await
}

/// Save a new file with content at `directory/filename`, returning the relative path.
#[tauri::command]
pub async fn save_new_file(
    project_id: String,
    directory: String,
    filename: String,
    content: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::save_new_file(&target, &base, &directory, &filename, &content)
        .await
}

/// Create a new directory (with parent directories).
#[tauri::command]
pub async fn create_directory(
    project_id: String,
    dir_path: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::create_directory(&target, &base, &dir_path).await
}

/// Delete a file or directory (recursively for directories).
#[tauri::command]
pub async fn delete_path(
    project_id: String,
    path: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::delete_path(&target, &base, &path).await
}

/// Rename a file or directory (within the same parent directory).
#[tauri::command]
pub async fn rename_path(
    project_id: String,
    path: String,
    new_name: String,
    root_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t.exec_target();
    let base = root_path.unwrap_or(wd);
    crate::common::file::services::rename_path(&target, &base, &path, &new_name).await
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::reveal::build_reveal_command;
    #[cfg(target_os = "windows")]
    use crate::platform::reveal::normalize_path;
    use std::fs;

    #[test]
    fn test_normalize_path_windows() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                normalize_path("C:/Users/test/file.rs"),
                "C:\\Users\\test\\file.rs"
            );
            assert_eq!(
                normalize_path("C:\\Users\\test\\file.rs"),
                "C:\\Users\\test\\file.rs"
            );
            assert_eq!(normalize_path("./src/main.rs"), ".\\src\\main.rs");
        }
    }

    #[test]
    fn test_is_directory_with_existing_dir() {
        let temp = std::env::temp_dir().join("neeko_test_is_dir");
        let _ = fs::create_dir_all(&temp);
        assert!(std::path::Path::new(temp.to_str().unwrap()).is_dir());
        let _ = fs::remove_dir(&temp);
    }

    #[test]
    fn test_is_directory_with_file() {
        let temp = std::env::temp_dir().join("neeko_test_is_dir_file.txt");
        let _ = fs::write(&temp, "test");
        assert!(!std::path::Path::new(temp.to_str().unwrap()).is_dir());
        let _ = fs::remove_file(&temp);
    }

    #[test]
    fn test_reveal_nonexistent_path() {
        let result = reveal_in_file_manager("/nonexistent/path/that/does/not/exist".to_string());
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(_) => {} // expected
            other => panic!("Expected NotFound error, got: {:?}", other),
        }
    }

    #[test]
    fn test_build_reveal_command_for_file() {
        let temp = std::env::temp_dir().join("neeko_test_build_cmd_file.txt");
        fs::write(&temp, "test").unwrap();

        let cmd = build_reveal_command(Path::new(temp.to_str().unwrap()));
        assert!(cmd.is_some());

        let cmd = cmd.unwrap();
        let args: Vec<&std::ffi::OsStr> = cmd.get_args().collect();

        #[cfg(target_os = "windows")]
        {
            assert_eq!(cmd.get_program(), "explorer");
            assert_eq!(args.len(), 1);
            assert!(args[0].to_string_lossy().starts_with("/select,"));
        }

        #[cfg(target_os = "macos")]
        {
            assert_eq!(cmd.get_program(), "open");
            assert_eq!(args[0], "-R");
        }

        let _ = fs::remove_file(&temp);
    }

    #[test]
    fn test_build_reveal_command_for_dir() {
        let temp = std::env::temp_dir().join("neeko_test_build_cmd_dir");
        let _ = fs::create_dir_all(&temp);

        let cmd = build_reveal_command(Path::new(temp.to_str().unwrap()));
        assert!(cmd.is_some());

        let cmd = cmd.unwrap();
        let args: Vec<&std::ffi::OsStr> = cmd.get_args().collect();

        #[cfg(target_os = "windows")]
        {
            assert_eq!(cmd.get_program(), "explorer");
            assert_eq!(args.len(), 1);
        }

        #[cfg(target_os = "macos")]
        {
            assert_eq!(cmd.get_program(), "open");
            assert_eq!(args.len(), 1);
        }

        let _ = fs::remove_dir(&temp);
    }

    #[test]
    fn test_build_reveal_command_for_nonexistent() {
        let cmd = build_reveal_command(Path::new("/nonexistent/path"));
        assert!(cmd.is_some());
    }
}
