use crate::project::types::{FileContent, FileNode};
use crate::AppError;
use crate::AppStateWrapper;
use crate::file::services;
use crate::utils::path_resolver;
use std::path::Path;
use std::process::Command;
use tauri::State;

// ── File Commands ────────────────────────────────────────────────────────────

/// 读取目录树
#[tauri::command]
pub fn read_dir_tree(
    project_id: String,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(services::DEFAULT_TREE_DEPTH);
    let base = path_resolver::resolve_worktree_or_project(
        &state,
        &project_id,
        root_path.as_deref(),
    )?;
    services::read_dir_tree(&base, sub_path.as_deref(), depth)
}

/// 读取文件内容
#[tauri::command]
pub fn read_file_content(
    project_id: String,
    file_path: String,
    root_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<FileContent, AppError> {
    let base = path_resolver::resolve_worktree_or_project(
        &state,
        &project_id,
        root_path.as_deref(),
    )?;
    services::read_file_content(&base, &file_path)
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
    let base = path_resolver::resolve_worktree_or_project(
        &state,
        &project_id,
        root_path.as_deref(),
    )?;
    services::write_file_content(&base, &file_path, &content)
}

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

/// 规范化路径：将正斜杠统一为反斜杠（Windows）
fn normalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.replace('/', "\\")
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

/// 构建在系统文件管理器中 reveal 指定路径的命令（不执行）
fn build_reveal_command(path: &Path) -> Option<Command> {
    let path_str = path.to_str()?;
    let normalized = normalize_path(path_str);

    #[cfg(target_os = "windows")]
    {
        if path.is_dir() {
            let mut cmd = Command::new("explorer");
            cmd.arg(&normalized);
            Some(cmd)
        } else {
            let mut cmd = Command::new("explorer");
            cmd.arg(format!("/select,{}", normalized));
            Some(cmd)
        }
    }

    #[cfg(target_os = "macos")]
    {
        if path.is_dir() {
            let mut cmd = Command::new("open");
            cmd.arg(&normalized);
            Some(cmd)
        } else {
            let mut cmd = Command::new("open");
            cmd.arg("-R").arg(&normalized);
            Some(cmd)
        }
    }

    #[cfg(target_os = "linux")]
    {
        if path.is_dir() {
            let mut cmd = Command::new("xdg-open");
            cmd.arg(&normalized);
            Some(cmd)
        } else {
            path.parent().map(|parent| {
                let mut cmd = Command::new("xdg-open");
                cmd.arg(parent);
                cmd
            })
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
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
