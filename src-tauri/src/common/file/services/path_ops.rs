//! 文件写 / 建 / 删 / 改名：按 ExecTarget 类型分发（Local fs + spawn_blocking，
//! WSL/Remote 走 shell 命令），统一执行路径安全校验。
//!
//! 原crud.rs超300行，按职责拆分：`file_write`（写/建文件）与 `path_ops`（目录建/删/改名）。

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::common::utils::command::local::safe_path;
use crate::AppError;

use super::shell_cmd::{
    build_exists_check_command, build_mkdir_command, build_mv_command, build_rm_command,
    remote_shell_name,
};

/// 创建目录（包含父目录），按 ExecTarget 类型分发。
pub async fn create_directory(
    target: &ExecTarget,
    base_path: &str,
    dir_path: &str,
) -> Result<(), AppError> {
    // 归一化分隔符后再做穿越检查（防 Windows 反斜杠绕过）
    let normalized = dir_path.replace('\\', "/");
    if normalized.is_empty() {
        return Err(AppError::InvalidInput(
            "Directory path is empty".to_string(),
        ));
    }
    if normalized.split('/').any(|c| c == "..") {
        return Err(AppError::File("Path traversal is not allowed".to_string()));
    }
    match target {
        ExecTarget::Local => {
            // 阻塞 I/O（canonicalize/fs::*）物理隔离到 OS 阻塞线程池（维度 7）
            let base_path = base_path.to_owned();
            let dir_path = dir_path.to_owned();
            tokio::task::spawn_blocking(move || -> Result<(), AppError> {
                let base = std::path::Path::new(&base_path);
                let canonical_base = base
                    .canonicalize()
                    .map_err(|e| AppError::File(format!("Invalid base path: {}", e)))?;
                let full = canonical_base.join(&dir_path);
                // 目标可能尚不存在：校验其最深已存在祖先仍在根目录内（防绝对路径/符号链接逃逸）
                let mut probe: &std::path::Path = &full;
                loop {
                    if probe.exists() {
                        let canonical_probe = probe
                            .canonicalize()
                            .map_err(|e| AppError::File(format!("Invalid path: {}", e)))?;
                        if !canonical_probe.starts_with(&canonical_base) {
                            return Err(AppError::File(
                                "Path is outside root directory".to_string(),
                            ));
                        }
                        break;
                    }
                    probe = match probe.parent() {
                        Some(p) => p,
                        None => return Err(AppError::File("Invalid directory path".to_string())),
                    };
                }
                std::fs::create_dir_all(&full)
                    .map_err(|e| AppError::File(format!("Failed to create directory: {}", e)))?;
                Ok(())
            })
            .await
            .map_err(|e| AppError::File(format!("Blocking task failed: {}", e)))?
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let full_path = format!("{}/{}", base_path, dir_path);
            let safe_fp = safe_path(&full_path);
            let mkdir_cmd = build_mkdir_command(&safe_fp);
            exec_on(target, remote_shell_name(target), &["-c", &mkdir_cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to create directory: {}", e)))?;
            Ok(())
        }
    }
}

/// 删除文件或目录（目录递归删除），按 ExecTarget 类型分发。
pub async fn delete_path(target: &ExecTarget, base_path: &str, path: &str) -> Result<(), AppError> {
    // 归一化分隔符后再做穿越检查（防 Windows 反斜杠绕过）
    let normalized = path.replace('\\', "/");
    if normalized.is_empty() || normalized == "." || normalized == "/" {
        return Err(AppError::InvalidInput(format!(
            "Refusing to delete path: {}",
            path
        )));
    }
    if normalized.split('/').any(|c| c == "..") {
        return Err(AppError::File("Path traversal is not allowed".to_string()));
    }
    match target {
        ExecTarget::Local => {
            // 阻塞 I/O（canonicalize/fs::*）物理隔离到 OS 阻塞线程池（维度 7）
            let base_path = base_path.to_owned();
            let path = path.to_owned();
            tokio::task::spawn_blocking(move || -> Result<(), AppError> {
                let base = std::path::Path::new(&base_path);
                let canonical_base = base
                    .canonicalize()
                    .map_err(|e| AppError::File(format!("Invalid base path: {}", e)))?;
                let full = canonical_base.join(&path);
                // 不允许删除根目录本身
                if full == canonical_base {
                    return Err(AppError::InvalidInput(
                        "Refusing to delete root".to_string(),
                    ));
                }
                // 目标必须位于根目录内（防绝对路径/符号链接逃逸）。
                // 校验最深已存在祖先，避免对不存在的目标误报 File 错误而破坏 NotFound 契约
                let mut probe: &std::path::Path = &full;
                loop {
                    if probe.exists() {
                        let canonical_probe = probe
                            .canonicalize()
                            .map_err(|e| AppError::File(format!("Invalid path: {}", e)))?;
                        if !canonical_probe.starts_with(&canonical_base) {
                            return Err(AppError::File(
                                "Path is outside root directory".to_string(),
                            ));
                        }
                        break;
                    }
                    probe = match probe.parent() {
                        Some(p) => p,
                        None => return Err(AppError::File("Invalid directory path".to_string())),
                    };
                }
                let metadata = std::fs::symlink_metadata(&full)
                    .map_err(|_| AppError::NotFound(format!("Path does not exist: {}", path)))?;
                if metadata.is_dir() {
                    std::fs::remove_dir_all(&full).map_err(|e| {
                        AppError::File(format!("Failed to delete directory: {}", e))
                    })?;
                } else {
                    std::fs::remove_file(&full)
                        .map_err(|e| AppError::File(format!("Failed to delete file: {}", e)))?;
                }
                Ok(())
            })
            .await
            .map_err(|e| AppError::File(format!("Blocking task failed: {}", e)))?
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let full_path = format!("{}/{}", base_path, path);
            let safe_fp = safe_path(&full_path);
            // 与 Local 分支保持一致的 NotFound 契约：目标不存在时报错
            let exists_cmd = build_exists_check_command(&safe_fp);
            let exists = exec_on(target, remote_shell_name(target), &["-c", &exists_cmd])
                .await
                .map(|out| out.trim() == "yes")
                .unwrap_or(false);
            if !exists {
                return Err(AppError::NotFound(format!("Path does not exist: {}", path)));
            }
            let rm_cmd = build_rm_command(&safe_fp);
            exec_on(target, remote_shell_name(target), &["-c", &rm_cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to delete path: {}", e)))?;
            Ok(())
        }
    }
}

/// 重命名文件或目录（同目录内改名），按 ExecTarget 类型分发。
pub async fn rename_path(
    target: &ExecTarget,
    base_path: &str,
    old_path: &str,
    new_name: &str,
) -> Result<(), AppError> {
    // 归一化分隔符后再做穿越检查（防 Windows 反斜杠绕过）
    let normalized_old = old_path.replace('\\', "/");
    if normalized_old.is_empty() || normalized_old == "." || normalized_old == "/" {
        return Err(AppError::InvalidInput(format!(
            "Refusing to rename path: {}",
            old_path
        )));
    }
    if normalized_old.split('/').any(|c| c == "..") {
        return Err(AppError::File("Path traversal is not allowed".to_string()));
    }
    // 新名字必须是纯名字：非空、不含路径分隔符、不允许 "."/".."
    if new_name.is_empty()
        || new_name.contains('/')
        || new_name.contains('\\')
        || new_name == "."
        || new_name == ".."
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid new name: {}",
            new_name
        )));
    }
    // 旧路径的父目录（'' 表示根目录）
    let parent = normalized_old
        .rfind('/')
        .map(|i| &normalized_old[..i])
        .unwrap_or("");
    let new_rel = if parent.is_empty() {
        new_name.to_string()
    } else {
        format!("{}/{}", parent, new_name)
    };
    match target {
        ExecTarget::Local => {
            // 阻塞 I/O（canonicalize/fs::*）物理隔离到 OS 阻塞线程池（维度 7）
            let base_path = base_path.to_owned();
            let old_path = old_path.to_owned();
            let new_name = new_name.to_owned();
            tokio::task::spawn_blocking(move || -> Result<(), AppError> {
                let base = std::path::Path::new(&base_path);
                let canonical_base = base
                    .canonicalize()
                    .map_err(|e| AppError::File(format!("Invalid base path: {}", e)))?;
                let full_old = canonical_base.join(&old_path);
                // 校验最深已存在祖先在根目录内（防绝对路径/符号链接逃逸）
                let mut probe: &std::path::Path = &full_old;
                loop {
                    if probe.exists() {
                        let canonical_probe = probe
                            .canonicalize()
                            .map_err(|e| AppError::File(format!("Invalid path: {}", e)))?;
                        if !canonical_probe.starts_with(&canonical_base) {
                            return Err(AppError::File(
                                "Path is outside root directory".to_string(),
                            ));
                        }
                        break;
                    }
                    probe = match probe.parent() {
                        Some(p) => p,
                        None => return Err(AppError::File("Invalid directory path".to_string())),
                    };
                }
                // 旧路径必须真实存在
                std::fs::symlink_metadata(&full_old).map_err(|_| {
                    AppError::NotFound(format!("Path does not exist: {}", old_path))
                })?;
                let full_new = match full_old.parent() {
                    Some(p) => p.join(&new_name),
                    None => return Err(AppError::File("Invalid parent directory".to_string())),
                };
                std::fs::rename(&full_old, &full_new)
                    .map_err(|e| AppError::File(format!("Failed to rename path: {}", e)))?;
                Ok(())
            })
            .await
            .map_err(|e| AppError::File(format!("Blocking task failed: {}", e)))?
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let old_full = format!("{}/{}", base_path, old_path);
            let new_full = format!("{}/{}", base_path, new_rel);
            let safe_old = safe_path(&old_full);
            let safe_new = safe_path(&new_full);
            // 与 Local 分支一致：旧路径不存在时报 NotFound
            let exists_cmd = build_exists_check_command(&safe_old);
            let exists = exec_on(target, remote_shell_name(target), &["-c", &exists_cmd])
                .await
                .map(|out| out.trim() == "yes")
                .unwrap_or(false);
            if !exists {
                return Err(AppError::NotFound(format!(
                    "Path does not exist: {}",
                    old_path
                )));
            }
            let mv_cmd = build_mv_command(&safe_old, &safe_new);
            exec_on(target, remote_shell_name(target), &["-c", &mv_cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to rename path: {}", e)))?;
            Ok(())
        }
    }
}
