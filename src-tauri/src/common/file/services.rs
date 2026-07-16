use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::common::git::parsers::build_file_tree_from_find;
use crate::common::utils::command::local::safe_path;
use crate::project::types::{FileContent, FileNode};
use crate::AppError;
use std::path::Path;

/// Directories to exclude from the file tree
const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".idea",
    ".vscode",
];

/// 文件树默认递归深度
pub const DEFAULT_TREE_DEPTH: u32 = 4;

/// Maximum file size for editing (512 KB)
#[allow(dead_code)]
const MAX_EDIT_SIZE: u64 = 512 * 1024;

/// 统一读取目录树，按 ExecTarget 类型分发。
pub async fn read_dir_tree(
    target: &ExecTarget,
    root_path: &str,
    sub_path: Option<&str>,
    max_depth: u32,
) -> Result<Vec<FileNode>, AppError> {
    match target {
        ExecTarget::Local => {
            let base = Path::new(root_path);
            let target_path = match sub_path {
                Some(sp) => base.join(sp),
                None => base.to_path_buf(),
            };
            crate::common::utils::path_resolver::validate_within_root(&target_path, base)?;
            read_dir_recursive(&target_path, base, max_depth)
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let effective_sub = sub_path.filter(|sp| !sp.is_empty());
            let actual_path = match effective_sub {
                Some(sp) => format!("{}/{}", root_path, sp),
                None => root_path.to_string(),
            };
            let safe_ap = safe_path(&actual_path);

            let cmd = format!(
                "find '{safe_ap}' -maxdepth {max_depth} \
                 -not -path '*/.git/*' \
                 -not -path '*/node_modules/*' \
                 -not -path '*/target/*' \
                 -not -name '.git' \
                  2>/dev/null | sort"
            );
            let shell = if matches!(target, ExecTarget::Wsl { .. }) {
                "bash"
            } else {
                "sh"
            };
            let output = exec_on(target, shell, &["-c", &cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to read dir tree: {}", e)))?;

            let mut tree = build_file_tree_from_find(&output, &actual_path)?;
            if let Some(sp) = effective_sub {
                prefix_paths(&mut tree, sp);
            }
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
fn prefix_paths(nodes: &mut Vec<FileNode>, prefix: &str) {
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

        if EXCLUDED_DIRS.iter().any(|&ex| ex == name) {
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
