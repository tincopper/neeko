use crate::models::{FileContent, FileNode};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::Path;
use tauri::State;

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

/// Maximum file size for editing (512 KB)
const MAX_EDIT_SIZE: u64 = 512 * 1024;

/// Read a directory tree recursively
#[tauri::command]
pub fn read_dir_tree(
    project_id: String,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
    state: State<AppStateWrapper>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(4);

    let (target_root, base_root) = if let Some(ref rp) = root_path {
        // Worktree mode: use the provided path directly as root
        let root = std::path::PathBuf::from(rp);
        if !root.exists() {
            return Err(AppError::File(format!("Worktree path not found: {}", rp)));
        }
        if !root.is_dir() {
            return Err(AppError::File(format!(
                "Worktree path is not a directory: {}",
                rp
            )));
        }
        let canonical = root
            .canonicalize()
            .map_err(|e| AppError::File(format!("Invalid worktree path: {}", e)))?;
        (canonical.clone(), canonical)
    } else {
        // Project mode: resolve root from project_id
        let project_path = {
            let pm = state
                .project_manager
                .lock()
                .map_err(|e| AppError::File(e.to_string()))?;
            pm.get_project(&project_id)
                .map(|p| p.path.clone())
                .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
        };
        let canonical = project_path
            .canonicalize()
            .map_err(|e| AppError::File(format!("Invalid project path: {}", e)))?;
        (canonical, project_path)
    };

    let target_path = match sub_path {
        Some(sp) => target_root.join(&sp),
        None => target_root.clone(),
    };

    // Validate the target path is within the root (prevents path traversal)
    let canonical_target = target_path
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid path: {}", e)))?;
    if !canonical_target.starts_with(&target_root) {
        return Err(AppError::File("Path is outside root directory".to_string()));
    }

    let nodes = read_dir_recursive(&target_path, &base_root, depth)?;
    Ok(nodes)
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

        // Skip excluded directories
        if EXCLUDED_DIRS.iter().any(|&ex| ex == name) {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| AppError::File(e.to_string()))?;
        let full_path = entry.path();

        // Calculate relative path from project root
        let relative_path = full_path
            .strip_prefix(project_root)
            .map_err(|e| AppError::File(e.to_string()))?
            .to_string_lossy()
            .to_string();

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

    // Sort: directories first, then alphabetical
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

/// Read file content
#[tauri::command]
pub fn read_file_content(
    project_id: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<FileContent, AppError> {
    // Get project path
    let project_path = {
        let pm = state
            .project_manager
            .lock()
            .map_err(|e| AppError::File(e.to_string()))?;
        pm.get_project(&project_id)
            .map(|p| p.path.clone())
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
    };

    let full_path = project_path.join(&file_path);

    // Validate the file path is within the project root
    let canonical_file = full_path
        .canonicalize()
        .map_err(|e| format!("File not found: {}", e))?;
    let canonical_root = project_path
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid project path: {}", e)))?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err("File path is outside project root".into());
    }

    // Get file metadata
    let metadata = std::fs::metadata(&canonical_file)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let size = metadata.len();

    // Check if binary (read first 8KB and look for null bytes)
    let is_binary = is_binary_file(&canonical_file)?;

    if is_binary {
        return Ok(FileContent {
            path: file_path,
            content: String::new(),
            size,
            is_binary: true,
        });
    }

    // Check file size (> 512 KB = large file)
    if size > MAX_EDIT_SIZE {
        // Still read content for view-only
        let content = std::fs::read_to_string(&canonical_file)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        return Ok(FileContent {
            path: file_path,
            content,
            size,
            is_binary: false,
        });
    }

    let content = std::fs::read_to_string(&canonical_file)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    Ok(FileContent {
        path: file_path,
        content,
        size,
        is_binary: false,
    })
}

/// Write file content
#[tauri::command]
pub fn write_file_content(
    project_id: String,
    file_path: String,
    content: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    // Get project path
    let project_path = {
        let pm = state
            .project_manager
            .lock()
            .map_err(|e| AppError::File(e.to_string()))?;
        pm.get_project(&project_id)
            .map(|p| p.path.clone())
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
    };

    let full_path = project_path.join(&file_path);

    // Validate: prevent path traversal
    let canonical_root = project_path
        .canonicalize()
        .map_err(|e| AppError::File(format!("Invalid project path: {}", e)))?;

    // For write, we need to check parent if file doesn't exist yet
    if let Some(parent) = full_path.parent() {
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("Invalid parent path: {}", e))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err("File path is outside project root".into());
            }
        }
    }

    // Atomic write
    std::fs::write(&full_path, content.as_bytes())
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

/// Check if a file is binary by reading the first 8KB
fn is_binary_file(path: &Path) -> Result<bool, AppError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut buffer = vec![0u8; 8192];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|e| AppError::File(e.to_string()))?;

    // Check for null bytes in the first 8KB
    Ok(buffer[..bytes_read].contains(&0))
}
