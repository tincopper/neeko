use crate::common::utils::command::local;
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::{path::PathBuf, sync::mpsc, thread};

/// 提取 git 进程退出码与信号，便于诊断 exit status: 129 (SIGHUP) 等异常
fn exit_diagnostics(status: &std::process::ExitStatus) -> (Option<i32>, Option<i32>) {
    let code = status.code();
    #[cfg(unix)]
    let signal = status.signal();
    #[cfg(not(unix))]
    let signal = None;
    (code, signal)
}

/// 增量状态差异：与上次 git status 对比后的变化
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitStatusDiff {
    /// 项目 ID
    pub project_id: String,
    /// 新增文件
    pub added: Vec<GitStatusFile>,
    /// 被删除的文件路径
    pub removed: Vec<String>,
    /// 状态变化的文件（如 Untracked → Added）
    pub modified: Vec<GitStatusFile>,
}

/// 单个文件的 git status 信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusFile {
    pub path: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
}

impl GitStatusFile {
    fn new(path: String, status: String) -> Self {
        Self {
            path,
            status,
            additions: 0,
            deletions: 0,
        }
    }
}

/// 常驻 git status worker。
/// 启动一个专用线程，接收 "请检查" 信号，
/// 执行 `git status --porcelain --no-optional-locks`，
/// 对比上次结果，有变化时通过回调通知。
///
/// 内部持有 mpsc::Sender，支持 Clone（多个 clone 共享同一个 worker 线程）。
#[derive(Clone)]
pub struct GitStatusWorker {
    signal_tx: mpsc::Sender<()>,
}

impl GitStatusWorker {
    /// 启动 worker。repo_path 是项目路径。
    /// on_change 在 status 结果发生变化时被调用，参数为增量 diff。
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

    /// 请求一次 status 检查（非阻塞）
    pub fn check(&self) {
        let _ = self.signal_tx.send(());
    }
}

/// worker 主循环：阻塞等待信号 → 执行 git status → 对比 → 通知
fn worker_loop(
    repo_path: PathBuf,
    signal_rx: mpsc::Receiver<()>,
    on_change: impl Fn(GitStatusDiff),
) {
    let mut last_status = String::new();
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

        if current != last_status {
            let last_files = parse_porcelain(&last_status);
            let last_serialized = serialize_files_for_diff(&last_files);

            if current_serialized != last_serialized {
                let diff = compute_status_diff(&last_files, &current_files);
                last_status = current;

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

/// 执行 git status --porcelain
/// 优先使用 --no-optional-locks（避免锁冲突），若当前 git 版本不支持则自动回退。
/// supports_no_optional_locks 为 per-worker 状态，一旦检测到不支持就记住，后续直接跳过重试。
fn git_status_porcelain(repo_path: &PathBuf, supports_no_optional_locks: &mut bool) -> String {
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
fn get_numstat_map(repo_path: &PathBuf) -> HashMap<String, (i32, i32)> {
    let path_str = repo_path.to_str().unwrap_or(".");
    let mut map: HashMap<String, (i32, i32)> = HashMap::new();

    // Unstaged changes
    if let Ok(output) = std::process::Command::new("git")
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
    if let Ok(output) = std::process::Command::new("git")
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
}
