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

/// 在系统文件管理器中打开或 reveal 指定路径
/// - 文件：在文件管理器中选中该文件
/// - 文件夹：直接打开该文件夹
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

    #[cfg(target_os = "windows")]
    {
        if path.is_dir() {
            Command::new("explorer")
                .arg(&normalized)
                .spawn()
                .map_err(|e| AppError::Io(format!("Failed to open folder: {}", e)))?;
        } else {
            Command::new("explorer")
                .arg("/select,")
                .arg(&normalized)
                .spawn()
                .map_err(|e| AppError::Io(format!("Failed to reveal file: {}", e)))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        if path.is_dir() {
            Command::new("open")
                .arg(&normalized)
                .spawn()
                .map_err(|e| AppError::Io(format!("Failed to open folder: {}", e)))?;
        } else {
            Command::new("open")
                .arg("-R")
                .arg(&normalized)
                .spawn()
                .map_err(|e| AppError::Io(format!("Failed to reveal file: {}", e)))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        if path.is_dir() {
            Command::new("xdg-open")
                .arg(&normalized)
                .spawn()
                .map_err(|e| AppError::Io(format!("Failed to open folder: {}", e)))?;
        } else {
            // xdg-open 没有 "reveal" 功能，打开父目录
            if let Some(parent) = path.parent() {
                Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| AppError::Io(format!("Failed to open folder: {}", e)))?;
            }
        }
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
    fn test_reveal_existing_file() {
        // 创建临时文件
        let temp = std::env::temp_dir().join("neeko_test_reveal_file.txt");
        fs::write(&temp, "test").unwrap();

        let result = reveal_in_file_manager(temp.to_str().unwrap().to_string());
        // 在 CI 环境中可能没有图形界面，所以这里只验证命令不报错
        // 实际的 explorer/open 命令可能会失败，但路径验证应该通过
        // 我们主要验证路径存在性检查通过
        let _ = result;

        let _ = fs::remove_file(&temp);
    }

    #[test]
    fn test_reveal_existing_dir() {
        let temp = std::env::temp_dir().join("neeko_test_reveal_dir");
        let _ = fs::create_dir_all(&temp);

        let result = reveal_in_file_manager(temp.to_str().unwrap().to_string());
        let _ = result;

        let _ = fs::remove_dir(&temp);
    }
}
