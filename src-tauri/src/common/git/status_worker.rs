//! Background worker for periodically polling git status changes.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::common::utils::command::local;
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::{path::Path, path::PathBuf, sync::mpsc, thread};

/// Extract the git process exit code and signal for diagnostics (e.g. exit status 129 / SIGHUP).
fn exit_diagnostics(status: &std::process::ExitStatus) -> (Option<i32>, Option<i32>) {
    let code = status.code();
    #[cfg(unix)]
    let signal = status.signal();
    #[cfg(not(unix))]
    let signal = None;
    (code, signal)
}

/// Incremental status diff: what changed since the last `git status` poll.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitStatusDiff {
    /// Project ID that this diff belongs to.
    pub project_id: String,
    /// Newly added files.
    pub added: Vec<GitStatusFile>,
    /// Paths of removed files.
    pub removed: Vec<String>,
    /// Files whose status changed (e.g. Untracked → Added).
    pub modified: Vec<GitStatusFile>,
}

/// Status information for a single file from `git status --porcelain`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusFile {
    /// File path relative to repository root.
    pub path: String,
    /// Status string (Modified, Added, Deleted, Untracked, Renamed).
    pub status: String,
    /// Number of added lines.
    pub additions: i32,
    /// Number of deleted lines.
    pub deletions: i32,
}

impl GitStatusFile {
    const fn new(path: String, status: String) -> Self {
        Self {
            path,
            status,
            additions: 0,
            deletions: 0,
        }
    }
}

/// Persistent git status worker that runs `git status --porcelain` on demand.
///
/// Spawns a dedicated thread that receives "check" signals, runs the status
/// command, compares with the previous result, and calls the callback with
/// the incremental diff when changes are detected.
///
/// Internally holds an `mpsc::Sender` and supports `Clone` so multiple
/// consumers can share the same worker thread.
#[derive(Clone)]
pub struct GitStatusWorker {
    /// Channel to signal a status check request.
    signal_tx: mpsc::Sender<()>,
}

impl GitStatusWorker {
    /// Start the worker for the given `repo_path`.
    /// `on_change` is called with the incremental diff whenever the status changes.
    pub fn start(repo_path: PathBuf, on_change: impl Fn(GitStatusDiff) + Send + 'static) -> Self {
        let (signal_tx, signal_rx) = mpsc::channel::<()>();

        thread::Builder::new()
            .name(format!(
                "git-worker-{}",
                repo_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            ))
            .spawn(move || {
                worker_loop(repo_path, signal_rx, on_change);
            })
            .expect("Failed to spawn git worker thread");

        Self { signal_tx }
    }

    /// Request a status check (non-blocking).
    pub fn check(&self) {
        let _ = self.signal_tx.send(());
    }
}

/// Main worker loop: wait for signal → run git status → compare → notify.
fn worker_loop(
    repo_path: PathBuf,
    signal_rx: mpsc::Receiver<()>,
    on_change: impl Fn(GitStatusDiff),
) {
    let mut last_status = String::new();
    // 分支切换检测：分支变化时全量替换 diff，避免残留旧分支 changes
    let mut last_branch = String::new();
    // 首次尝试带 --no-optional-locks；若 git 版本不支持则永久回退到不带该参数
    let mut supports_no_optional_locks = true;
    let path_str = repo_path.display().to_string();

    log::debug!("[GitWorker] Worker started for {}", path_str);

    loop {
        // 阻塞等待第一个信号
        match signal_rx.recv() {
            Ok(()) => {}
            Err(_) => {
                log::debug!(
                    "[GitWorker] Channel closed, worker exiting for {}",
                    path_str
                );
                break;
            }
        }

        // 消费队列中积压的信号（合并多次触发为一次）
        while signal_rx.try_recv().is_ok() {
            // drain
        }

        log::debug!("[GitWorker] Running git status for {}", path_str);

        let current = git_status_porcelain(&repo_path, &mut supports_no_optional_locks);
        let current_branch = get_current_branch(&repo_path);

        // Parse porcelain output and enrich with additions/deletions from --numstat
        let mut current_files = parse_porcelain(&current);
        if !current_files.is_empty() {
            let numstat = get_numstat_map(&repo_path);
            for file in &mut current_files {
                if let Some((add, del)) = numstat.get(&file.path) {
                    file.additions = *add;
                    file.deletions = *del;
                }
            }
        }

        // Serialize to string for comparison (preserve counts)
        let current_serialized = serialize_files_for_diff(&current_files);

        log::debug!(
            "[GitWorker] git status result for {}: {} bytes, changed={}",
            path_str,
            current.len(),
            current != last_status
        );

        // 分支切换：全量替换 diff（旧分支文件全部 removed，新分支文件全部 added），
        // 前端整体替换 changed_files，避免残留旧分支的 changes
        if current_branch != last_branch {
            let last_files = parse_porcelain(&last_status);
            let diff = compute_branch_switch_diff(&last_files, &current_files);
            log::debug!(
                "[GitWorker] Branch changed {} -> {} for {}, emitting full diff",
                last_branch,
                current_branch,
                path_str
            );
            last_status = current;
            last_branch = current_branch;
            on_change(diff);
            continue;
        }

        if current != last_status {
            let last_files = parse_porcelain(&last_status);
            let last_serialized = serialize_files_for_diff(&last_files);

            // 无论 serialized 是否一致都推进 last_status，避免 worker 卡在旧快照
            last_status = current;

            if current_serialized != last_serialized {
                let diff = compute_status_diff(&last_files, &current_files);

                // 只在有实际变化时通知
                if !diff.added.is_empty() || !diff.removed.is_empty() || !diff.modified.is_empty() {
                    log::debug!(
                        "[GitWorker] Emitting diff for {}: +{} ~{} -{}",
                        path_str,
                        diff.added.len(),
                        diff.modified.len(),
                        diff.removed.len()
                    );
                    on_change(diff);
                }
            }
        }
    }
}

/// 获取当前分支名（detached HEAD 时返回 "HEAD"），失败时返回空字符串。
fn get_current_branch(repo_path: &Path) -> String {
    let path_str = repo_path.to_str().unwrap_or(".");
    match local::exec("git")
        .args(["-C", path_str, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    }
}

/// 执行 git status --porcelain
/// 优先使用 --no-optional-locks（避免锁冲突），若当前 git 版本不支持则自动回退。
/// supports_no_optional_locks 为 per-worker 状态，一旦检测到不支持就记住，后续直接跳过重试。
fn git_status_porcelain(repo_path: &Path, supports_no_optional_locks: &mut bool) -> String {
    let path_str = repo_path.to_str().unwrap_or(".");

    if *supports_no_optional_locks {
        match local::exec("git")
            .args([
                "-C",
                path_str,
                "status",
                "--porcelain",
                "--no-optional-locks",
            ])
            .output()
        {
            Ok(output) if output.status.success() => {
                return String::from_utf8_lossy(&output.stdout).to_string();
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if stderr.contains("unknown option") {
                    // 当前 git 版本不支持该选项，永久回退
                    log::warn!(
                        "[GitWorker] git at {} does not support --no-optional-locks, falling back",
                        repo_path.display()
                    );
                    *supports_no_optional_locks = false;
                    // fall through to retry without the flag
                } else {
                    // 其他错误（权限、非 git 仓库等），直接返回空 stdout
                    let (code, signal) = exit_diagnostics(&output.status);
                    log::warn!(
                        "[GitWorker] git status failed at {}: exit={:?} signal={:?} stderr={}",
                        repo_path.display(),
                        code,
                        signal,
                        stderr.trim()
                    );
                    return String::from_utf8_lossy(&output.stdout).to_string();
                }
            }
            Err(e) => {
                log::error!(
                    "[GitWorker] Failed to spawn git at {}: {}",
                    repo_path.display(),
                    e
                );
                return String::new();
            }
        }
    }

    // Fallback：不带 --no-optional-locks
    match local::exec("git")
        .args(["-C", path_str, "status", "--porcelain"])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let (code, signal) = exit_diagnostics(&output.status);
                log::warn!(
                    "[GitWorker] git status failed at {}: exit={:?} signal={:?} stderr={}",
                    repo_path.display(),
                    code,
                    signal,
                    stderr.trim()
                );
            }
            String::from_utf8_lossy(&output.stdout).to_string()
        }
        Err(e) => {
            log::error!(
                "[GitWorker] Failed to spawn git at {}: {}",
                repo_path.display(),
                e
            );
            String::new()
        }
    }
}

/// 解析 git status --porcelain 输出，返回 (path, status) 列表
fn parse_porcelain(output: &str) -> Vec<GitStatusFile> {
    let mut files = Vec::new();
    for line in output.lines() {
        // git status --porcelain 格式: XY path
        // XY 是两个字符的状态码，后面跟一个空格，然后是路径
        // 跳过空行和非 porcelain 格式的行
        if line.len() < 3 {
            continue;
        }
        let xy = &line[..2];
        let path_part = &line[3..];

        // 处理 rename: "old_path -> new_path"
        let path = if let Some(idx) = path_part.find(" -> ") {
            path_part[idx + 4..].to_string()
        } else {
            path_part.to_string()
        };

        let status = xy_to_status(xy);
        files.push(GitStatusFile::new(path, status));
    }
    files
}

/// 将 porcelain 状态码映射为可读状态
fn xy_to_status(xy: &str) -> String {
    let x = xy.as_bytes()[0];
    let y = xy.as_bytes()[1];

    if x == b'?' && y == b'?' {
        "Untracked".to_string()
    } else if x == b'A' {
        "Added".to_string()
    } else if x == b'D' || y == b'D' {
        "Deleted".to_string()
    } else if x == b'T' || y == b'T' {
        "Modified".to_string()
    } else if x == b'R' {
        "Renamed".to_string()
    } else {
        "Modified".to_string()
    }
}

/// 分支切换时生成全量替换 diff：
/// 旧分支的所有文件进入 `removed`，新分支的所有文件进入 `added`，
/// 前端收到后整体替换列表，避免增量 merge 残留旧分支数据。
fn compute_branch_switch_diff(
    old_files: &[GitStatusFile],
    new_files: &[GitStatusFile],
) -> GitStatusDiff {
    GitStatusDiff {
        project_id: String::new(),
        added: new_files.to_vec(),
        removed: old_files.iter().map(|f| f.path.clone()).collect(),
        modified: Vec::new(),
    }
}

/// 计算两次 git status 结果之间的增量差异
/// 接收解析后的文件列表（含 additions/deletions 计数）
fn compute_status_diff(old_files: &[GitStatusFile], new_files: &[GitStatusFile]) -> GitStatusDiff {
    let old_map: std::collections::HashMap<String, &GitStatusFile> =
        old_files.iter().map(|f| (f.path.clone(), f)).collect();
    let new_map: std::collections::HashMap<String, &GitStatusFile> =
        new_files.iter().map(|f| (f.path.clone(), f)).collect();

    let mut diff = GitStatusDiff::default();

    // 找新增和修改的文件
    for (path, file) in &new_map {
        match old_map.get(path) {
            None => {
                // 新文件
                diff.added.push((*file).clone());
            }
            Some(old_file) => {
                if old_file.status != file.status
                    || old_file.additions != file.additions
                    || old_file.deletions != file.deletions
                {
                    // 状态或行数变化
                    diff.modified.push((*file).clone());
                }
            }
        }
    }

    // 找删除的文件
    for path in old_map.keys() {
        if !new_map.contains_key(path) {
            diff.removed.push(path.clone());
        }
    }

    diff
}

/// 将文件列表序列化为比较字符串（用于检测变化，包含 counts）
fn serialize_files_for_diff(files: &[GitStatusFile]) -> String {
    let mut parts: Vec<String> = files
        .iter()
        .map(|f| format!("{}:{}:+{}-{}", f.path, f.status, f.additions, f.deletions))
        .collect();
    parts.sort();
    parts.join("\n")
}

/// 运行 `git diff --numstat`（unstaged + cached）并返回 path → (additions, deletions)
/// 与 `git_status_porcelain` 一致走 `local::exec("git")` 直连：
/// Windows 直连可执行文件（CREATE_NO_WINDOW），Unix 直连 git 二进制，
/// 不经过 transport 的 `sh -c` 包裹，避免无 sh 环境下静默失败。
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn get_numstat_map(repo_path: &Path) -> HashMap<String, (i32, i32)> {
    let path_str = repo_path.to_str().unwrap_or(".");
    let mut map: HashMap<String, (i32, i32)> = HashMap::new();

    // Unstaged changes
    if let Ok(output) = local::exec("git")
        .args(["-C", path_str, "diff", "--numstat"])
        .output()
    {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((add, del, path)) = super::parsers::parse_numstat_line(line) {
                let entry = map.entry(path).or_insert((0, 0));
                entry.0 += add as i32;
                entry.1 += del as i32;
            }
        }
    }

    // Staged changes
    if let Ok(output) = local::exec("git")
        .args(["-C", path_str, "diff", "--cached", "--numstat"])
        .output()
    {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((add, del, path)) = super::parsers::parse_numstat_line(line) {
                let entry = map.entry(path).or_insert((0, 0));
                entry.0 += add as i32;
                entry.1 += del as i32;
            }
        }
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建带一次初始提交的临时仓库，返回 (TempDir, Repository)
    fn create_repo_with_commit() -> (tempfile::TempDir, git2::Repository) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        std::fs::write(tmp.path().join("README.md"), "# Test\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }
        (tmp, repo)
    }

    /// get_current_branch 在初始分支上返回正确分支名
    #[test]
    fn get_current_branch_returns_initial_branch() {
        let (tmp, repo) = create_repo_with_commit();
        let expected = repo.head().unwrap().shorthand().unwrap().to_string();
        assert_eq!(get_current_branch(tmp.path()), expected);
    }

    /// get_current_branch 感知分支切换（checkout 后返回新分支名）
    #[test]
    fn get_current_branch_detects_branch_switch() {
        let (tmp, repo) = create_repo_with_commit();
        let head = repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();
        repo.branch("feature-commands", &commit, false).unwrap();
        repo.set_head("refs/heads/feature-commands").unwrap();
        repo.checkout_head(None).unwrap();
        assert_eq!(get_current_branch(tmp.path()), "feature-commands");
    }

    /// 非 git 目录返回空字符串（不 panic）
    #[test]
    fn get_current_branch_returns_empty_for_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(get_current_branch(tmp.path()), "");
    }

    #[test]
    fn parse_porcelain_single_file() {
        let output = " M src/main.rs\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].status, "Modified");
    }

    #[test]
    fn parse_porcelain_untracked() {
        let output = "?? new_file.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new_file.txt");
        assert_eq!(files[0].status, "Untracked");
    }

    #[test]
    fn parse_porcelain_added() {
        let output = "A  staged.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "staged.txt");
        assert_eq!(files[0].status, "Added");
    }

    #[test]
    fn parse_porcelain_deleted() {
        let output = " D deleted.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "deleted.txt");
        assert_eq!(files[0].status, "Deleted");
    }

    #[test]
    fn parse_porcelain_rename() {
        let output = "R  old.rs -> new.rs\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new.rs");
        assert_eq!(files[0].status, "Renamed");
    }

    #[test]
    fn compute_diff_added_file() {
        let old = parse_porcelain("");
        let new = parse_porcelain("?? new_file.txt\n");
        let new_files: Vec<GitStatusFile> = new
            .into_iter()
            .map(|mut f| {
                f.additions = 10;
                f
            })
            .collect();
        let diff = compute_status_diff(&old, &new_files);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].path, "new_file.txt");
        assert_eq!(diff.added[0].additions, 10);
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_removed_file() {
        let old = parse_porcelain(" M file.txt\n");
        let new = parse_porcelain("");
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert_eq!(diff.removed.len(), 1);
        assert_eq!(diff.removed[0], "file.txt");
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_status_change() {
        let old = parse_porcelain("?? file.txt\n");
        let new = parse_porcelain("A  file.txt\n");
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.modified.len(), 1);
        assert_eq!(diff.modified[0].path, "file.txt");
        assert_eq!(diff.modified[0].status, "Added");
    }

    #[test]
    fn compute_diff_no_change() {
        let old = parse_porcelain(" M file.txt\n");
        let new = parse_porcelain(" M file.txt\n");
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_additions_changed() {
        let old: Vec<GitStatusFile> =
            vec![GitStatusFile::new("file.txt".into(), "Modified".into())];
        let mut new: Vec<GitStatusFile> =
            vec![GitStatusFile::new("file.txt".into(), "Modified".into())];
        new[0].additions = 5;
        new[0].deletions = 3;
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.modified.len(), 1);
        assert_eq!(diff.modified[0].additions, 5);
        assert_eq!(diff.modified[0].deletions, 3);
    }

    /// 分支切换时旧分支文件必须全部进入 removed（回归：切换分支后残留旧分支 changes）
    #[test]
    fn compute_branch_switch_diff_removes_old_branch_files() {
        let old = parse_porcelain(" M src/main.rs\n?? notes.md\n");
        let new = parse_porcelain(" A feature.rs\n");
        let diff = compute_branch_switch_diff(&old, &new);
        assert_eq!(diff.removed.len(), 2, "旧分支的全部文件应进入 removed");
        assert!(diff.removed.contains(&"src/main.rs".to_string()));
        assert!(diff.removed.contains(&"notes.md".to_string()));
        assert_eq!(diff.added.len(), 1, "新分支的全部文件应进入 added");
        assert_eq!(diff.added[0].path, "feature.rs");
        assert!(diff.modified.is_empty());
    }

    /// 分支切换后新分支干净时，removed 必须携带旧分支全部文件（前端据此清空列表）
    #[test]
    fn compute_branch_switch_diff_clean_target_branch() {
        let old = parse_porcelain(" M src/main.rs\n");
        let new = parse_porcelain("");
        let diff = compute_branch_switch_diff(&old, &new);
        assert_eq!(diff.removed, vec!["src/main.rs".to_string()]);
        assert!(diff.added.is_empty());
        assert!(diff.modified.is_empty());
    }

    /// 分支切换后新分支同样有改动时，added 携带新文件且保留 numstat 计数
    #[test]
    fn compute_branch_switch_diff_keeps_new_counts() {
        let old = parse_porcelain(" M src/main.rs\n");
        let mut new: Vec<GitStatusFile> = parse_porcelain(" M src/main.rs\n");
        new[0].additions = 10;
        new[0].deletions = 4;
        let diff = compute_branch_switch_diff(&old, &new);
        assert_eq!(diff.removed, vec!["src/main.rs".to_string()]);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].additions, 10);
        assert_eq!(diff.added[0].deletions, 4);
        assert!(diff.modified.is_empty());
    }

    /// 修改未暂存文件 → numstat 映射包含该文件与增删行数
    #[test]
    fn get_numstat_map_counts_unstaged() {
        let (tmp, _repo) = create_repo_with_commit();
        let path = tmp.path();
        // 原内容 "# Test\n"（1 行）→ 改为替换首行 + 新增 1 行：
        // git 行对齐 diff 删除原行、添加新行 → unstaged numstat = +2 -1
        std::fs::write(path.join("README.md"), "# Changed\nline2\n").unwrap();

        let map = get_numstat_map(path);
        assert_eq!(map.get("README.md"), Some(&(2, 1)));
    }

    /// 暂存修改后 → cached diff 计入 numstat 映射
    #[test]
    fn get_numstat_map_counts_staged() {
        let (tmp, repo) = create_repo_with_commit();
        let path = tmp.path();
        // 原内容 "# Test\n"（1 行）→ 改为替换首行 + 新增 1 行：
        // staged diff = +2 -1
        std::fs::write(path.join("README.md"), "# Changed\nline2\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
        }

        let map = get_numstat_map(path);
        assert_eq!(map.get("README.md"), Some(&(2, 1)));
    }
}
