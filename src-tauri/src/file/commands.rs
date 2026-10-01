use crate::common::executor::factory::ExecTarget;
use crate::common::git::unit_path::UnitPath;
use crate::common::git::RepoRef;
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
// ── Existence probe ──────────────────────────────────────────────────────────

/// 存在性探测（O(1) stat，不读内容）：任务命令构造等前端逻辑用，返回 bool
/// 而非 NotFound 错误。仅元数据访问，无内容泄露面。
#[tauri::command]
pub fn file_exists(path: String) -> Result<bool, AppError> {
    Ok(Path::new(&normalize_path(&path)).exists())
}

// ── File operations ──────────────────────────────────────────────────────────

/// 解析 file 操作基准目录：`root_path` 是 worktree 用户输入，必须先校验；
/// 为空时回落到 `resolve_project()` 返回的受信项目根。
///
/// 取 **`exec`（宿主形态）** 而非身份：这个值是 `std::fs`、gitignore 过滤器与
/// `FileAccessScope` 的输入，必须与 watcher 挂载根（同样来自 `RepoRef::work_dir()` 的
/// 宿主形态）逐字同源，否则 `same_root` 类比较会静默失配。
fn resolve_base(
    target: &ExecTarget,
    root_path: Option<&str>,
    wd: &str,
) -> Result<String, AppError> {
    match root_path.filter(|path| !path.trim().is_empty()) {
        // 传入的 base 若是某个工作树根，归一化后取宿主观；否则退回项目根语义。
        Some(path) => UnitPath::resolve(target, path)
            .map(|resolved| resolved.exec().to_string())
            .map_err(AppError::from),
        None => Ok(wd.to_string()),
    }
}

/// Read the directory tree.
#[tauri::command]
pub async fn read_dir_tree(
    project_id: String,
    root_path: Option<String>,
    sub_path: Option<String>,
    max_depth: Option<u32>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<FileNode>, AppError> {
    // 深度常量单一事实源：crate::common::file::services::DEFAULT_TREE_DEPTH
    let depth = max_depth.unwrap_or(crate::common::file::services::DEFAULT_TREE_DEPTH);
    let (t, wd) = state.resolve_project(&project_id)?;
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    // S5：gitignore 语义由 watcher 的分层过滤器原生提供（读前剪枝 + ignored 标记），
    // 前端 ignored_files 平行数组退役。watcher 未挂载（切换项目时首载与 watch
    // 并发的 race）→ resolve_gitignore_filter 现场构建兜底，保证首屏即带 ignored
    // 标注；非 git 项目 → None（仅 .git 硬过滤）。
    // 过滤器按**仓库单元**取：主仓与 worktree 的 .gitignore 规则链不同（各自工作树根
    // + 各自 gitdir 的 exclude）。未挂载（首载与 watch 并发）→ 现场构建兜底。
    let repo = RepoRef::resolve(&project_id, &wd, root_path.as_deref(), &target)
        .map_err(AppError::from)?;
    let gitignore = crate::common::file::services::resolve_gitignore_filter(
        &target,
        state.watcher_manager.gitignore_for(&repo),
        Path::new(base),
    )
    .await;
    crate::common::file::services::read_dir_tree(
        &project_id,
        &target,
        base,
        sub_path.as_deref(),
        depth,
        gitignore.as_deref(),
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::reader::read_file(
        crate::common::file::reader::FileAccessScope::InProject {
            root: std::path::PathBuf::from(base),
        },
        crate::common::file::reader::FileReadRequest {
            target,
            base: base.to_string(),
            path: file_path,
            // 行为保持：项目内读取无大小上限，二进制检测与既有实现一致
            max_bytes: None,
            detect_binary: true,
        },
    )
    .await
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::services::write_file_content(&target, base, &file_path, content).await
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::services::create_new_file(&target, base, &file_path).await
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::services::save_new_file(&target, base, &directory, &filename, content)
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::services::create_directory(&target, base, &dir_path).await
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::services::delete_path(&target, base, &path).await
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
    let target = t;
    let base_owned = resolve_base(&target, root_path.as_deref(), &wd)?;
    let base = base_owned.as_str();
    crate::common::file::services::rename_path(&target, base, &path, &new_name).await
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
    fn resolve_base_accepts_valid_worktree_and_rejects_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().to_string_lossy().to_string();
        let root = Some(path);
        assert!(resolve_base(&ExecTarget::Local, root.as_deref(), "/trusted").is_ok());

        let traversal = Some("../../etc".to_string());
        assert!(resolve_base(&ExecTarget::Local, traversal.as_deref(), "/trusted").is_err());
    }

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
    fn test_file_exists() {
        let temp = std::env::temp_dir().join("neeko_test_file_exists_marker");
        let _ = fs::remove_file(&temp);
        assert!(!file_exists(temp.to_str().unwrap().to_string()).unwrap());

        fs::write(&temp, b"x").unwrap();
        assert!(file_exists(temp.to_str().unwrap().to_string()).unwrap());

        let _ = fs::remove_file(&temp);
    }

    #[test]
    fn test_build_reveal_command_for_nonexistent() {
        let cmd = build_reveal_command(Path::new("/nonexistent/path"));
        assert!(cmd.is_some());
    }
}
