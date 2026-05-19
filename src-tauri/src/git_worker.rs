use crate::utils::command::local;
use std::{path::PathBuf, sync::mpsc, thread};

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

        log::debug!(
            "[GitWorker] git status result for {}: {} bytes, changed={}",
            path_str,
            current.len(),
            current != last_status
        );

        if current != last_status {
            let diff = compute_status_diff(&last_status, &current);
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
                    log::warn!(
                        "[GitWorker] git status failed (exit {}) at {}: {}",
                        output.status,
                        repo_path.display(),
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
                log::warn!(
                    "[GitWorker] git status failed (exit {}) at {}: {}",
                    output.status,
                    repo_path.display(),
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
        files.push(GitStatusFile { path, status });
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
    } else if x == b'R' {
        "Renamed".to_string()
    } else {
        "Modified".to_string()
    }
}

/// 计算两次 git status 输出之间的增量差异
fn compute_status_diff(old_output: &str, new_output: &str) -> GitStatusDiff {
    let old_files = parse_porcelain(old_output);
    let new_files = parse_porcelain(new_output);

    let old_map: std::collections::HashMap<String, String> =
        old_files.into_iter().map(|f| (f.path, f.status)).collect();
    let new_map: std::collections::HashMap<String, String> =
        new_files.into_iter().map(|f| (f.path, f.status)).collect();

    let mut diff = GitStatusDiff::default();

    // 找新增和修改的文件
    for (path, status) in &new_map {
        match old_map.get(path) {
            None => {
                // 新文件
                diff.added.push(GitStatusFile {
                    path: path.clone(),
                    status: status.clone(),
                });
            }
            Some(old_status) => {
                if old_status != status {
                    // 状态变化
                    diff.modified.push(GitStatusFile {
                        path: path.clone(),
                        status: status.clone(),
                    });
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
        let old = "";
        let new = "?? new_file.txt\n";
        let diff = compute_status_diff(old, new);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].path, "new_file.txt");
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_removed_file() {
        let old = " M file.txt\n";
        let new = "";
        let diff = compute_status_diff(old, new);
        assert!(diff.added.is_empty());
        assert_eq!(diff.removed.len(), 1);
        assert_eq!(diff.removed[0], "file.txt");
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_status_change() {
        let old = "?? file.txt\n";
        let new = "A  file.txt\n";
        let diff = compute_status_diff(old, new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.modified.len(), 1);
        assert_eq!(diff.modified[0].path, "file.txt");
        assert_eq!(diff.modified[0].status, "Added");
    }

    #[test]
    fn compute_diff_no_change() {
        let old = " M file.txt\n";
        let new = " M file.txt\n";
        let diff = compute_status_diff(old, new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }
}
