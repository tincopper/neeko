use crate::AppError;
use std::path::Path;
use std::process::Command;

/// 判断路径是否为目录
fn is_directory(path: &str) -> bool {
    Path::new(path).is_dir()
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
/// - 文件：在文件管理器中选中该文件
/// - 文件夹：直接打开该文件夹
fn build_reveal_command(path: &Path) -> Option<Command> {
    let normalized = normalize_path(&path.to_str().unwrap_or_default());

    #[cfg(target_os = "windows")]
    {
        if path.is_dir() {
            let mut cmd = Command::new("explorer");
            cmd.arg(&normalized);
            Some(cmd)
        } else {
            let mut cmd = Command::new("explorer");
            // /select, 与路径必须合并为单一参数，分开传递 explorer 无法识别
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
        assert!(is_directory(temp.to_str().unwrap()));
        let _ = fs::remove_dir(&temp);
    }

    #[test]
    fn test_is_directory_with_file() {
        let temp = std::env::temp_dir().join("neeko_test_is_dir_file.txt");
        let _ = fs::write(&temp, "test");
        assert!(!is_directory(temp.to_str().unwrap()));
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
        // build_reveal_command 不检查存在性，只构建命令
        // 存在性检查在 reveal_in_file_manager 中完成
        let cmd = build_reveal_command(Path::new("/nonexistent/path"));
        assert!(cmd.is_some());
    }
}
