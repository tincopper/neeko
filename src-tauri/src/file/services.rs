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

/// 读取目录树（纯业务逻辑，无 State 依赖）。
pub fn read_dir_tree(base: &Path, sub_path: Option<&str>, depth: u32) -> Result<Vec<FileNode>, AppError> {
    let target_path = match sub_path {
        Some(sp) => base.join(sp),
        None => base.to_path_buf(),
    };

    crate::utils::path_resolver::validate_within_root(&target_path, base)?;

    read_dir_recursive(&target_path, base, depth)
}

/// 读取文件内容（纯业务逻辑，无 State 依赖）。
pub fn read_file_content(base: &Path, file_path: &str) -> Result<FileContent, AppError> {
    let full_path = base.join(file_path);
    crate::utils::path_resolver::validate_within_root(&full_path, base)?;

    let metadata = std::fs::metadata(&full_path)
        .map_err(|e| AppError::File(format!("Failed to read metadata: {}", e)))?;
    let size = metadata.len();
    let is_binary = is_binary_file(&full_path)?;

    if is_binary {
        return Ok(FileContent {
            path: file_path.to_string(),
            content: String::new(),
            size,
            is_binary: true,
        });
    }

    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| AppError::File(format!("Failed to read file: {}", e)))?;

    Ok(FileContent {
        path: file_path.to_string(),
        content,
        size,
        is_binary: false,
    })
}

/// 写入文件内容（纯业务逻辑，无 State 依赖）。
pub fn write_file_content(base: &Path, file_path: &str, content: &str) -> Result<(), AppError> {
    let full_path = base.join(file_path);

    let canonical_root = base
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid root path: {}", e)))?;

    if let Some(parent) = full_path.parent() {
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| AppError::File(format!("Invalid parent path: {}", e)))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err(AppError::File("File path is outside root directory".to_string()));
            }
        }
    }

    std::fs::write(&full_path, content.as_bytes())
        .map_err(|e| AppError::File(format!("Failed to write file: {}", e)))?;
    Ok(())
}

/// 检查文件是否为二进制文件（读取前 8KB 检测 null 字节）。
pub fn is_binary_file(path: &Path) -> Result<bool, AppError> {
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
