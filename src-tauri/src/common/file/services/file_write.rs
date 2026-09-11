//! 文件写 / 建：按 ExecTarget 类型分发（Local: `std::fs` + `spawn_blocking`；
//! WSL/Remote: shell 命令），统一执行路径安全校验。
//!
//! 原 `crud.rs` 超 300 行，按职责拆分：本文件（写 / 建文件）与 `path_ops`（目录建 / 删 / 改名）。

use std::path::Path;

use crate::common::executor::factory::ExecTarget;
use crate::common::runtime::run_blocking_result;
use crate::common::utils::command::local::safe_path;
use crate::core::exec::run;
use crate::AppError;

use super::shell_cmd::{build_mkdir_command, remote_shell_name};

/// 统一写入文件内容，按 ExecTarget 类型分发。
///
/// `content` 按值传入：本地分支要把它移进阻塞线程池闭包，避免大文件多复制一份。
pub async fn write_file_content(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
    content: String,
) -> Result<(), AppError> {
    match target {
        ExecTarget::Local => {
            let base = base_path.to_owned();
            let rel = file_path.to_owned();
            run_blocking_result(move || write_file_content_local(&base, &rel, &content)).await
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let full_path = format!("{}/{}", base_path, file_path);
            write_file_content_remote(target, &full_path, &content).await
        }
    }
}

/// Local 分支：校验父目录未逃出根目录后写入（同步 I/O，**只在阻塞线程池调用**）。
fn write_file_content_local(
    base_path: &str,
    file_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let base = Path::new(base_path);
    let full = base.join(file_path);
    let canonical_root = base
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid root path: {e}")))?;
    if let Some(parent) = full.parent() {
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| AppError::File(format!("Invalid parent path: {e}")))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err(AppError::File(
                    "File path is outside root directory".to_string(),
                ));
            }
        }
    }
    std::fs::write(&full, content.as_bytes())
        .map_err(|e| AppError::File(format!("Failed to write file: {e}")))
}

/// 创建新文件（包含父目录），按 ExecTarget 类型分发。
pub async fn create_new_file(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
) -> Result<(), AppError> {
    match target {
        ExecTarget::Local => {
            let base = base_path.to_owned();
            let rel = file_path.to_owned();
            run_blocking_result(move || create_new_file_local(&base, &rel)).await
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let full_path = format!("{}/{}", base_path, file_path);
            create_new_file_remote(target, &full_path).await
        }
    }
}

/// Local 分支：建父目录 + 落空文件（同步 I/O，**只在阻塞线程池调用**）。
fn create_new_file_local(base_path: &str, file_path: &str) -> Result<(), AppError> {
    let base = Path::new(base_path);
    let canonical_base = base
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid base path: {e}")))?;

    if file_path.split('/').any(|c| c == "..") {
        return Err(AppError::File("Path traversal is not allowed".to_string()));
    }

    let full = canonical_base.join(file_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::File(format!("Failed to create parent dirs: {e}")))?;
    }
    std::fs::write(&full, "").map_err(|e| AppError::File(format!("Failed to create file: {e}")))
}

/// Create or overwrite a file at `directory/filename` with the given content.
/// Returns the relative path `directory/filename`.
pub async fn save_new_file(
    target: &ExecTarget,
    base_path: &str,
    directory: &str,
    filename: &str,
    content: String,
) -> Result<String, AppError> {
    let rel_path = if directory.is_empty() || directory == "." {
        filename.to_string()
    } else {
        format!("{}/{}", directory.trim_end_matches('/'), filename)
    };

    match target {
        ExecTarget::Local => {
            let base = base_path.to_owned();
            let rel = rel_path.clone();
            run_blocking_result(move || save_new_file_local(&base, &rel, &content)).await?;
            Ok(rel_path)
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let full_path = format!("{}/{}", base_path, rel_path);
            let safe_fp = safe_path(&full_path);
            let shell = remote_shell_name(target);

            if let Some(parent) = Path::new(&full_path).parent() {
                let safe_parent = safe_path(parent.to_str().unwrap_or(""));
                let mkdir_cmd = build_mkdir_command(&safe_parent);
                let _ = run(target, shell, &["-c", &mkdir_cmd]).await;
            }

            let escaped = content.replace('\'', "'\\''");
            let write_cmd = format!("cat > '{safe_fp}' << 'EOF'\n{escaped}\nEOF");
            run(target, shell, &["-c", &write_cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to write file: {e}")))?;
            Ok(rel_path)
        }
    }
}

/// Local 分支：建父目录 + 写入内容（同步 I/O，**只在阻塞线程池调用**）。
fn save_new_file_local(base_path: &str, rel_path: &str, content: &str) -> Result<(), AppError> {
    let base = Path::new(base_path);
    let canonical_base = base
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid base path: {e}")))?;

    if rel_path.split('/').any(|c| c == "..") {
        return Err(AppError::File("Path traversal is not allowed".to_string()));
    }

    let full = canonical_base.join(rel_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::File(format!("Failed to create parent dirs: {e}")))?;
    }
    std::fs::write(&full, content).map_err(|e| AppError::File(format!("Failed to write file: {e}")))
}

/// 通过 shell 创建新文件（WSL / Remote）
async fn create_new_file_remote(target: &ExecTarget, full_path: &str) -> Result<(), AppError> {
    let safe_fp = safe_path(full_path);
    let shell = remote_shell_name(target);

    if let Some(parent) = std::path::Path::new(full_path).parent() {
        let safe_parent = safe_path(parent.to_str().unwrap_or(""));
        let mkdir_cmd = build_mkdir_command(&safe_parent);
        let _ = run(target, shell, &["-c", &mkdir_cmd]).await;
    }

    let touch_cmd = format!("touch '{safe_fp}'");
    run(target, shell, &["-c", &touch_cmd])
        .await
        .map_err(|e| AppError::File(format!("Failed to create file: {}", e)))?;

    Ok(())
}

/// 通过 shell 写入文件内容（WSL / Remote）
async fn write_file_content_remote(
    target: &ExecTarget,
    full_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let safe_fp = safe_path(full_path);
    let shell = remote_shell_name(target);

    if let Some(parent) = std::path::Path::new(full_path).parent() {
        let safe_parent = safe_path(parent.to_str().unwrap_or(""));
        let mkdir_cmd = build_mkdir_command(&safe_parent);
        let _ = run(target, shell, &["-c", &mkdir_cmd]).await;
    }

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
    let write_cmd = format!("echo '{}' | base64 -d > '{safe_fp}'", encoded);
    run(target, shell, &["-c", &write_cmd])
        .await
        .map_err(|e| AppError::File(format!("Failed to write file: {}", e)))?;

    Ok(())
}
