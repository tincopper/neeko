//! File-system service functions for listing, reading, and searching files.

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::{collect_output, exec_on};
use crate::common::git::parsers::build_file_tree_from_find;
use crate::common::utils::command::local::safe_path;
use crate::project::types::{FileContent, FileNode};
use crate::AppError;
use std::collections::HashSet;
use std::path::Path;

/// 文件树默认递归深度
pub const DEFAULT_TREE_DEPTH: u32 = 3;

/// Maximum file size for editing (512 KB)
#[allow(dead_code)]
const MAX_EDIT_SIZE: u64 = 512 * 1024;

/// 构建 WSL/Remote 文件树扫描命令。
/// 仅排除 git 元数据目录 `.git`（`git status --ignored` 永不报告它，且不是用户工作文件）；
/// `node_modules`、`target` 等改由前端基于 .gitignore 灰显，不再在后端硬编码排除。
fn build_find_tree_command(safe_path: &str, max_depth: u32) -> String {
    format!(
        "find '{safe_path}' -maxdepth {max_depth} \
         -not -path '*/.git/*' \
         -not -name '.git' \
          2>/dev/null | sort"
    )
}

/// 剪枝被 .gitignore 忽略的目录：保留目录节点用于前端灰显，子节点置空。
/// 剪枝只作用于 children 后代节点，被请求目录（树根）自身不受影响 ——
/// 用户点击被忽略目录时可通过懒加载（read_dir_tree + sub_path）穿透获取完整内容。
fn prune_ignored_dirs(nodes: &mut [FileNode], ignored: &HashSet<&str>) {
    for node in nodes.iter_mut() {
        if node.is_dir && ignored.contains(node.path.as_str()) {
            node.children.clear();
        } else if !node.children.is_empty() {
            prune_ignored_dirs(&mut node.children, ignored);
        }
    }
}

/// 统一读取目录树，按 ExecTarget 类型分发。
pub async fn read_dir_tree(
    target: &ExecTarget,
    root_path: &str,
    sub_path: Option<&str>,
    max_depth: u32,
    ignored: &[String],
) -> Result<Vec<FileNode>, AppError> {
    let ignored_set: HashSet<&str> = ignored.iter().map(String::as_str).collect();
    match target {
        ExecTarget::Local => {
            let base = Path::new(root_path);
            let target_path = match sub_path {
                Some(sp) => base.join(sp),
                None => base.to_path_buf(),
            };
            crate::common::utils::path_resolver::validate_within_root(&target_path, base)?;
            let mut tree = read_dir_recursive(&target_path, base, max_depth)?;
            prune_ignored_dirs(&mut tree, &ignored_set);
            Ok(tree)
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let effective_sub = sub_path.filter(|sp| !sp.is_empty());
            let actual_path = match effective_sub {
                Some(sp) => format!("{}/{}", root_path, sp),
                None => root_path.to_string(),
            };
            let safe_ap = safe_path(&actual_path);
            let cmd = build_find_tree_command(&safe_ap, max_depth);
            let shell = if matches!(target, ExecTarget::Wsl { .. }) {
                "bash"
            } else {
                "sh"
            };
            let output = collect_output(target, shell, &["-c", &cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to read dir tree: {}", e)))?;

            // find 非零退出（如个别目录无权限）不代表整树失败：stdout 仍包含已扫描路径。
            // 故用 collect_output（保留非零退出）而非 exec_on（非零即 Err），避免整树被丢弃。
            let find_output = String::from_utf8_lossy(&output.stdout);
            let mut tree = build_file_tree_from_find(&find_output, &actual_path);
            if let Some(sp) = effective_sub {
                prefix_paths(&mut tree, sp);
            }
            prune_ignored_dirs(&mut tree, &ignored_set);
            Ok(tree)
        }
    }
}

/// 统一读取文件内容，按 ExecTarget 类型分发。
pub async fn read_file_content(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
) -> Result<FileContent, AppError> {
    let full_path = format!("{}/{}", base_path, file_path);
    match target {
        ExecTarget::Local => {
            let base = Path::new(base_path);
            let full = base.join(file_path);
            crate::common::utils::path_resolver::validate_within_root(&full, base)?;
            let metadata = std::fs::metadata(&full)
                .map_err(|e| AppError::File(format!("Failed to read metadata: {}", e)))?;
            let size = metadata.len();
            let is_binary = is_binary_file(&full)?;
            if is_binary {
                return Ok(FileContent {
                    path: file_path.to_string(),
                    content: String::new(),
                    size,
                    is_binary: true,
                });
            }
            let content = std::fs::read_to_string(&full)
                .map_err(|e| AppError::File(format!("Failed to read file: {}", e)))?;
            Ok(FileContent {
                path: file_path.to_string(),
                content,
                size,
                is_binary: false,
            })
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            read_file_content_shell(target, &full_path, file_path).await
        }
    }
}

/// 统一写入文件内容，按 ExecTarget 类型分发。
pub async fn write_file_content(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let full_path = format!("{}/{}", base_path, file_path);
    match target {
        ExecTarget::Local => {
            let base = Path::new(base_path);
            let full = base.join(file_path);
            let canonical_root = base
                .canonicalize()
                .map_err(|e| AppError::File(format!("Invalid root path: {}", e)))?;
            if let Some(parent) = full.parent() {
                if parent.exists() {
                    let canonical_parent = parent
                        .canonicalize()
                        .map_err(|e| AppError::File(format!("Invalid parent path: {}", e)))?;
                    if !canonical_parent.starts_with(&canonical_root) {
                        return Err(AppError::File(
                            "File path is outside root directory".to_string(),
                        ));
                    }
                }
            }
            std::fs::write(&full, content.as_bytes())
                .map_err(|e| AppError::File(format!("Failed to write file: {}", e)))?;
            Ok(())
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            write_file_content_remote(target, &full_path, content).await
        }
    }
}

/// 创建新文件（包含父目录），按 ExecTarget 类型分发。
pub async fn create_new_file(
    target: &ExecTarget,
    base_path: &str,
    file_path: &str,
) -> Result<(), AppError> {
    let full_path = format!("{}/{}", base_path, file_path);
    match target {
        ExecTarget::Local => {
            let base = std::path::Path::new(base_path);
            let canonical_base = base
                .canonicalize()
                .map_err(|e| AppError::File(format!("Invalid base path: {}", e)))?;

            if file_path.split('/').any(|c| c == "..") {
                return Err(AppError::File("Path traversal is not allowed".to_string()));
            }

            let full = canonical_base.join(file_path);

            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::File(format!("Failed to create parent dirs: {}", e)))?;
            }
            std::fs::write(&full, "")
                .map_err(|e| AppError::File(format!("Failed to create file: {}", e)))?;
            Ok(())
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            create_new_file_remote(target, &full_path).await
        }
    }
}

/// Create or overwrite a file at `directory/filename` with the given content.
/// Returns the relative path `directory/filename`.
pub async fn save_new_file(
    target: &ExecTarget,
    base_path: &str,
    directory: &str,
    filename: &str,
    content: &str,
) -> Result<String, AppError> {
    let rel_path = if directory.is_empty() || directory == "." {
        filename.to_string()
    } else {
        format!("{}/{}", directory.trim_end_matches('/'), filename)
    };

    let full_path = format!("{}/{}", base_path, rel_path);
    match target {
        ExecTarget::Local => {
            let base = std::path::Path::new(base_path);
            let canonical_base = base
                .canonicalize()
                .map_err(|e| AppError::File(format!("Invalid base path: {}", e)))?;

            if rel_path.split('/').any(|c| c == "..") {
                return Err(AppError::File("Path traversal is not allowed".to_string()));
            }

            let full = canonical_base.join(&rel_path);

            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::File(format!("Failed to create parent dirs: {}", e)))?;
            }
            std::fs::write(&full, content)
                .map_err(|e| AppError::File(format!("Failed to write file: {}", e)))?;
            Ok(rel_path)
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let safe_fp = safe_path(&full_path);
            let shell = if matches!(target, ExecTarget::Wsl { .. }) {
                "bash"
            } else {
                "sh"
            };

            if let Some(parent) = std::path::Path::new(&full_path).parent() {
                let safe_parent = safe_path(parent.to_str().unwrap_or(""));
                let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
                let _ = exec_on(target, shell, &["-c", &mkdir_cmd]).await;
            }

            let escaped = content.replace('\'', "'\\''");
            let write_cmd = format!("cat > '{safe_fp}' << 'EOF'\n{escaped}\nEOF");
            exec_on(target, shell, &["-c", &write_cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to write file: {}", e)))?;
            Ok(rel_path)
        }
    }
}

/// 根据 ExecTarget 选择 POSIX shell（WSL 使用 bash，Remote 使用 sh）
const fn remote_shell_name(target: &ExecTarget) -> &'static str {
    if matches!(target, ExecTarget::Wsl { .. }) {
        "bash"
    } else {
        "sh"
    }
}

/// 构建 WSL/Remote 的 mkdir -p 命令（路径已 safe_path 转义）
fn build_mkdir_command(safe_path: &str) -> String {
    format!("mkdir -p '{safe_path}'")
}

/// 构建 WSL/Remote 的存在性检查命令（输出 "yes"/"no"）
fn build_exists_check_command(safe_path: &str) -> String {
    format!("test -e '{safe_path}' && echo yes || echo no")
}

/// 构建 WSL/Remote 的 rm -rf 命令
fn build_rm_command(safe_path: &str) -> String {
    format!("rm -rf '{safe_path}'")
}

/// 构建 WSL/Remote 的 mv 命令
fn build_mv_command(safe_old: &str, safe_new: &str) -> String {
    format!("mv '{safe_old}' '{safe_new}'")
}

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

/// 通过 shell 读取文件内容（WSL / Remote）
async fn read_file_content_shell(
    target: &ExecTarget,
    full_path: &str,
    file_path: &str,
) -> Result<FileContent, AppError> {
    let safe_fp = safe_path(full_path);
    let shell = if matches!(target, ExecTarget::Wsl { .. }) {
        "bash"
    } else {
        "sh"
    };

    let stat_cmd = format!("stat -c '%s' '{safe_fp}' 2>/dev/null || echo 0");
    let size: u64 = exec_on(target, shell, &["-c", &stat_cmd])
        .await
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    let binary_cmd =
        format!("head -c 8192 '{safe_fp}' | grep -ql '\\x00' 2>/dev/null && echo 1 || echo 0");
    let is_binary = exec_on(target, shell, &["-c", &binary_cmd])
        .await
        .map(|out| out.trim() == "1")
        .unwrap_or(false);

    if is_binary {
        return Ok(FileContent {
            path: file_path.to_string(),
            content: String::new(),
            size,
            is_binary: true,
        });
    }

    let cat_cmd = format!("cat '{safe_fp}'");
    let content = exec_on(target, shell, &["-c", &cat_cmd])
        .await
        .map_err(|e| AppError::File(format!("Failed to read file content: {}", e)))?;

    Ok(FileContent {
        path: file_path.to_string(),
        content,
        size,
        is_binary: false,
    })
}

/// 通过 shell 创建新文件（WSL / Remote）
async fn create_new_file_remote(target: &ExecTarget, full_path: &str) -> Result<(), AppError> {
    let safe_fp = safe_path(full_path);
    let shell = if matches!(target, ExecTarget::Wsl { .. }) {
        "bash"
    } else {
        "sh"
    };

    if let Some(parent) = std::path::Path::new(full_path).parent() {
        let safe_parent = safe_path(parent.to_str().unwrap_or(""));
        let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
        let _ = exec_on(target, shell, &["-c", &mkdir_cmd]).await;
    }

    let touch_cmd = format!("touch '{safe_fp}'");
    exec_on(target, shell, &["-c", &touch_cmd])
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
    let shell = if matches!(target, ExecTarget::Wsl { .. }) {
        "bash"
    } else {
        "sh"
    };

    if let Some(parent) = std::path::Path::new(full_path).parent() {
        let safe_parent = safe_path(parent.to_str().unwrap_or(""));
        let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
        let _ = exec_on(target, shell, &["-c", &mkdir_cmd]).await;
    }

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
    let write_cmd = format!("echo '{}' | base64 -d > '{safe_fp}'", encoded);
    exec_on(target, shell, &["-c", &write_cmd])
        .await
        .map_err(|e| AppError::File(format!("Failed to write file: {}", e)))?;

    Ok(())
}

/// 递归给所有节点的 path 字段加上前缀
fn prefix_paths(nodes: &mut [FileNode], prefix: &str) {
    for node in nodes.iter_mut() {
        node.path = format!("{}/{}", prefix, node.path);
        if !node.children.is_empty() {
            prefix_paths(&mut node.children, prefix);
        }
    }
}

/// 检查本地文件是否为二进制文件
fn is_binary_file(path: &Path) -> Result<bool, AppError> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::File(format!("Failed to open file: {}", e)))?;
    let mut buffer = vec![0u8; 8192];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|e| AppError::File(e.to_string()))?;
    Ok(buffer[..bytes_read].contains(&0))
}

fn read_dir_recursive(
    dir: &Path,
    project_root: &Path,
    depth: u32,
) -> Result<Vec<FileNode>, AppError> {
    if depth == 0 {
        return Ok(vec![]);
    }

    let mut nodes = Vec::new();

    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::File(format!("Failed to read directory: {}", e)))?;

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        // git 元数据目录永不进入文件树：git status --ignored 不报告 .git（含 linked
        // worktree 场景的 .git 文件），只能在此排除；node_modules 等改由前端 .gitignore 灰显。
        if name == ".git" {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| AppError::File(e.to_string()))?;
        let full_path = entry.path();

        let relative_path = full_path
            .strip_prefix(project_root)
            .map_err(|e| AppError::File(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");

        if file_type.is_dir() {
            let children = read_dir_recursive(&full_path, project_root, depth - 1)?;
            nodes.push(FileNode {
                name,
                path: relative_path,
                is_dir: true,
                children,
            });
        } else {
            nodes.push(FileNode {
                name,
                path: relative_path,
                is_dir: false,
                children: vec![],
            });
        }
    }

    nodes.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::fs;

    #[test]
    fn remote_shell_selects_bash_for_wsl_and_sh_for_remote() {
        let wsl = ExecTarget::Wsl {
            distro: "Ubuntu-22.04".to_string(),
        };
        let remote = ExecTarget::Remote {
            host: "example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
        };
        assert_eq!(remote_shell_name(&wsl), "bash");
        assert_eq!(remote_shell_name(&remote), "sh");
    }

    #[test]
    fn build_commands_quote_escaped_paths() {
        // safe_path 会把单引号转义为 '\''，命令拼接后保持转义完整性
        let raw = "/home/user/it's dir/文件";
        let safe = safe_path(raw);
        assert_eq!(safe, "/home/user/it'\\''s dir/文件");

        let mkdir = build_mkdir_command(&safe);
        assert_eq!(mkdir, "mkdir -p '/home/user/it'\\''s dir/文件'");

        let exists = build_exists_check_command(&safe);
        assert_eq!(
            exists,
            "test -e '/home/user/it'\\''s dir/文件' && echo yes || echo no"
        );

        let rm = build_rm_command(&safe);
        assert_eq!(rm, "rm -rf '/home/user/it'\\''s dir/文件'");

        let mv = build_mv_command(&safe, "/target/新名");
        assert_eq!(mv, "mv '/home/user/it'\\''s dir/文件' '/target/新名'");
    }

    #[test]
    fn build_exists_check_command_outputs_yes_no() {
        assert_eq!(
            build_exists_check_command("/plain/path"),
            "test -e '/plain/path' && echo yes || echo no"
        );
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("neeko_file_mgmt_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_dir_tree_excludes_git_meta_directory() {
        let root = temp_root("tree_git_exclude");
        // .git 元数据目录：git status --ignored 永不报告它，必须由后端排除
        fs::create_dir_all(root.join(".git/objects")).expect("创建 .git 测试目录失败");
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main").expect("写入 .git/HEAD 失败");
        // 普通文件与依赖目录应保留（node_modules 改由前端 .gitignore 灰显）
        fs::write(root.join("a.txt"), "hello").expect("写入 a.txt 失败");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("创建 node_modules 测试目录失败");
        fs::write(root.join("node_modules/pkg/index.js"), "x").expect("写入 index.js 失败");

        let tree = read_dir_recursive(&root, &root, 3).expect("读取测试目录树失败");
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(
            !names.contains(&".git"),
            ".git 元数据目录不应出现在文件树中: {:?}",
            names
        );
        assert!(names.contains(&"a.txt"), "普通文件应保留");
        assert!(
            names.contains(&"node_modules"),
            "node_modules 不再由后端硬编码排除，应保留供前端灰显: {:?}",
            names
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn find_tree_command_excludes_git_but_keeps_others() {
        let cmd = build_find_tree_command("/safe/path", 3);
        assert!(
            cmd.contains("-not -path '*/.git/*'"),
            "find 应排除 .git 内部内容: {}",
            cmd
        );
        assert!(
            cmd.contains("-not -name '.git'"),
            "find 应排除 .git 条目本身: {}",
            cmd
        );
        assert!(
            !cmd.contains("*/node_modules/*"),
            "node_modules 不再由后端 find 排除: {}",
            cmd
        );
        assert!(cmd.contains("-maxdepth 3"), "应保留最大深度: {}", cmd);
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Runtime::new().unwrap().block_on(future)
    }

    fn dir_node(name: &str, path: &str, children: Vec<FileNode>) -> FileNode {
        FileNode {
            name: name.to_string(),
            path: path.to_string(),
            is_dir: true,
            children,
        }
    }

    fn file_node(name: &str, path: &str) -> FileNode {
        FileNode {
            name: name.to_string(),
            path: path.to_string(),
            is_dir: false,
            children: vec![],
        }
    }

    #[test]
    fn prune_ignored_clears_children_but_keeps_dir_node() {
        let mut tree = vec![dir_node(
            "node_modules",
            "node_modules",
            vec![
                dir_node(
                    "lodash",
                    "node_modules/lodash",
                    vec![file_node("index.js", "node_modules/lodash/index.js")],
                ),
                dir_node(
                    "react",
                    "node_modules/react",
                    vec![file_node("package.json", "node_modules/react/package.json")],
                ),
            ],
        )];
        let ignored = HashSet::from(["node_modules"]);
        prune_ignored_dirs(&mut tree, &ignored);
        let nm = &tree[0];
        assert_eq!(nm.name, "node_modules", "目录节点应保留（供前端灰显）");
        assert!(nm.children.is_empty(), "被忽略目录的子节点应被剪枝");
    }

    #[test]
    fn prune_preserves_unignored_subtree() {
        let mut tree = vec![dir_node(
            "src",
            "src",
            vec![
                file_node("a.ts", "src/a.ts"),
                dir_node(
                    "components",
                    "src/components",
                    vec![file_node("b.tsx", "src/components/b.tsx")],
                ),
            ],
        )];
        let ignored = HashSet::from(["node_modules"]);
        prune_ignored_dirs(&mut tree, &ignored);
        assert_eq!(tree[0].children.len(), 2, "未命中忽略的目录应完整保留");
    }

    #[test]
    fn prune_partial_ignore_only_prunes_matched_dir() {
        let mut tree = vec![dir_node(
            "sub",
            "sub",
            vec![
                dir_node(
                    "deep",
                    "sub/deep",
                    vec![file_node("cache.dat", "sub/deep/cache.dat")],
                ),
                file_node("keep.txt", "sub/keep.txt"),
            ],
        )];
        let ignored = HashSet::from(["sub/deep"]);
        prune_ignored_dirs(&mut tree, &ignored);
        let sub = &tree[0];
        assert_eq!(sub.children.len(), 2, "sub 自身未命中，children 应保留");
        assert!(sub.children[0].children.is_empty(), "sub/deep 命中 → 剪枝");
        assert_eq!(sub.children[1].name, "keep.txt", "未忽略项保留");
    }

    #[test]
    fn prune_does_not_affect_requested_dir_itself() {
        // 模拟懒加载展开 node_modules：返回树以 node_modules 下内容为根，
        // 剪枝只作用于 children，展开目标的内容必须完整可见（穿透语义）。
        let mut tree = vec![dir_node(
            "lodash",
            "node_modules/lodash",
            vec![file_node("index.js", "node_modules/lodash/index.js")],
        )];
        let ignored = HashSet::from(["node_modules"]);
        prune_ignored_dirs(&mut tree, &ignored);
        assert_eq!(tree[0].children.len(), 1, "展开目标目录的内容不应被剪枝");
        assert_eq!(tree[0].children[0].name, "index.js");
    }

    #[test]
    fn create_directory_creates_nested_dirs() {
        let root = temp_root("create_dir");
        let base = root.to_str().unwrap();
        block_on(create_directory(&ExecTarget::Local, base, "a/b/c")).unwrap();
        assert!(root.join("a/b/c").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_directory_rejects_empty_and_traversal() {
        let root = temp_root("create_dir_invalid");
        let base = root.to_str().unwrap();
        assert!(block_on(create_directory(&ExecTarget::Local, base, "")).is_err());
        assert!(block_on(create_directory(&ExecTarget::Local, base, "../evil")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_directory_rejects_absolute_and_backslash_traversal() {
        let root = temp_root("create_dir_abs");
        let base = root.to_str().unwrap();
        assert!(block_on(create_directory(
            &ExecTarget::Local,
            base,
            "/tmp/neeko_evil"
        ))
        .is_err());
        assert!(block_on(create_directory(&ExecTarget::Local, base, "..\\..\\evil")).is_err());
        assert!(block_on(create_directory(
            &ExecTarget::Local,
            base,
            "sub\\..\\..\\evil"
        ))
        .is_err());
        // 正常相对路径仍可创建
        block_on(create_directory(&ExecTarget::Local, base, "good/sub")).unwrap();
        assert!(root.join("good/sub").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_path_removes_file() {
        let root = temp_root("delete_file");
        let base = root.to_str().unwrap();
        fs::write(root.join("a.txt"), "content").unwrap();
        block_on(delete_path(&ExecTarget::Local, base, "a.txt")).unwrap();
        assert!(!root.join("a.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_path_removes_nested_directory() {
        let root = temp_root("delete_dir");
        let base = root.to_str().unwrap();
        fs::create_dir_all(root.join("sub/deep")).unwrap();
        fs::write(root.join("sub/deep/x.txt"), "x").unwrap();
        block_on(delete_path(&ExecTarget::Local, base, "sub")).unwrap();
        assert!(!root.join("sub").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_path_rejects_traversal_and_root() {
        let root = temp_root("delete_invalid");
        let base = root.to_str().unwrap();
        assert!(block_on(delete_path(&ExecTarget::Local, base, "../evil")).is_err());
        assert!(block_on(delete_path(&ExecTarget::Local, base, ".")).is_err());
        assert!(block_on(delete_path(&ExecTarget::Local, base, "/")).is_err());
        assert!(block_on(delete_path(&ExecTarget::Local, base, "")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_path_rejects_absolute_and_backslash_traversal() {
        let root = temp_root("delete_abs");
        let base = root.to_str().unwrap();
        fs::write(root.join("ok.txt"), "x").unwrap();
        // 绝对路径（根外）应被拒绝
        assert!(block_on(delete_path(&ExecTarget::Local, base, "/etc")).is_err());
        // Windows 风格反斜杠穿越应被拒绝
        assert!(block_on(delete_path(&ExecTarget::Local, base, "..\\..\\evil")).is_err());
        assert!(block_on(delete_path(&ExecTarget::Local, base, "sub\\..\\..\\evil")).is_err());
        // 根内文件仍可正常删除
        block_on(delete_path(&ExecTarget::Local, base, "ok.txt")).unwrap();
        assert!(!root.join("ok.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_path_missing_file_returns_not_found() {
        let root = temp_root("delete_missing");
        let base = root.to_str().unwrap();
        let err = block_on(delete_path(&ExecTarget::Local, base, "nope.txt")).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_path_renames_file_and_dir() {
        let root = temp_root("rename_ok");
        let base = root.to_str().unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.txt"), "x").unwrap();
        block_on(rename_path(&ExecTarget::Local, base, "sub/a.txt", "b.txt")).unwrap();
        assert!(!root.join("sub/a.txt").exists());
        assert_eq!(fs::read_to_string(root.join("sub/b.txt")).unwrap(), "x");
        // 目录重命名
        fs::create_dir_all(root.join("sub/inner")).unwrap();
        block_on(rename_path(&ExecTarget::Local, base, "sub/inner", "inner2")).unwrap();
        assert!(!root.join("sub/inner").exists());
        assert!(root.join("sub/inner2").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_path_rejects_invalid_names_and_traversal() {
        let root = temp_root("rename_invalid");
        let base = root.to_str().unwrap();
        fs::write(root.join("a.txt"), "x").unwrap();
        // 新名含分隔符/穿越/空 → 拒绝
        assert!(block_on(rename_path(&ExecTarget::Local, base, "a.txt", "b/c.txt")).is_err());
        assert!(block_on(rename_path(&ExecTarget::Local, base, "a.txt", "../evil")).is_err());
        assert!(block_on(rename_path(&ExecTarget::Local, base, "a.txt", "")).is_err());
        // 旧路径穿越/绝对路径 → 拒绝
        assert!(block_on(rename_path(&ExecTarget::Local, base, "../evil", "x")).is_err());
        assert!(block_on(rename_path(&ExecTarget::Local, base, "/etc", "x")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_path_missing_source_returns_not_found() {
        let root = temp_root("rename_missing");
        let base = root.to_str().unwrap();
        let err = block_on(rename_path(&ExecTarget::Local, base, "nope.txt", "x.txt")).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
        let _ = fs::remove_dir_all(&root);
    }
}
