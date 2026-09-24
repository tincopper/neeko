#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::collect_blocking;

use super::collapsed_probe::{collapsed_dirs_digest, Digest};
use super::writer::{parse_porcelain, GitStatusSnapshot};

const fn exit_diagnostics(code: i32) -> (Option<i32>, Option<i32>) {
    (Some(code), None)
}

/// Persistent git status worker that runs `git status --porcelain` on demand.
#[derive(Clone)]
pub struct GitStatusWorker {
    /// Channel to signal a status check request.
    signal_tx: mpsc::Sender<()>,
}

impl GitStatusWorker {
    /// Start the worker for the given `repo_path`.
    pub fn start(
        repo_path: PathBuf,
        on_change: impl Fn(GitStatusSnapshot) + Send + 'static,
    ) -> Self {
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

/// Main worker loop: wait for signal → run git status → compare → emit full snapshot.
///
/// G2 单一权威化：worker 是 status 的唯一计算路径（D1）。任何实质变化（porcelain
/// 输出或分支变化）都产出**完整快照**（version 单调递增）并整体通知 —— 事件携带
/// 全量数据而非增量 patch（D3），前端以 version 门控替换，乱序/回退从结构上消除（P1）。
fn worker_loop(
    repo_path: PathBuf,
    signal_rx: mpsc::Receiver<()>,
    on_change: impl Fn(GitStatusSnapshot),
) {
    let mut last_status = String::new();
    let mut last_branch = String::new();
    // 上一次 emit 时折叠 untracked 目录的内容摘要（见 `collapsed_probe`）。
    // `None` = 尚未探测 → 放行 emit。
    let mut last_collapsed_digest: Option<Digest> = None;
    let mut version: u64 = 0;
    let mut supports_no_optional_locks = true;
    let path_str = repo_path.display().to_string();

    log::debug!("[GitWorker] Worker started for {}", path_str);

    loop {
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

        while signal_rx.try_recv().is_ok() {}

        log::debug!("[GitWorker] Running git status for {}", path_str);

        let current = git_status_porcelain(&repo_path, &mut supports_no_optional_locks);
        let current_branch = get_current_branch(&repo_path);

        let mut current_files = parse_porcelain(&current);

        // G4（P7）：numstat/行数不再进 status 主链路 —— 行数由 CommitPanel 独立的
        // get_changed_files_diff_stats 按需提供（stats 优先、快照行数仅 fallback），
        // status 重算从「status + 2×diff --numstat」降为单次 porcelain。

        // 全链路封顶（公理：随输入规模增长的结构必须有界；对齐 orca 1000 条超限截断）。
        const MAX_STATUS_ENTRIES: usize = 1000;
        let truncated = current_files.len() > MAX_STATUS_ENTRIES;
        if truncated {
            log::warn!(
                "[GitWorker] status entries exceeded cap for {}: {} truncated to {}",
                path_str,
                current_files.len(),
                MAX_STATUS_ENTRIES
            );
            current_files.truncate(MAX_STATUS_ENTRIES);
        }

        // 折叠 untracked 目录的**内容**摘要：porcelain 折叠语义下目录内部增删不会改变
        // `current` 字符串，只看字符串的闸门会判定「无变化」→ 不 emit → 前端拿到陈旧
        // 快照且没有任何失效信号（本任务要修的盲区）。摘要只喂闸门，不进快照载荷，
        // 因此 IPC 条目数、折叠语义都不变。
        // 取截断后的集合：超出上限的条目本就不进快照，也就无需为其探测。
        let collapsed_digest = collapsed_dirs_digest(&repo_path, &current_files);

        let status_unchanged = current == last_status && current_branch == last_branch;
        // 未知摘要一律放行（宁可多发一次快照，不可漏发）；已知且与上次相等才算「真无变化」
        let digest_unchanged =
            !collapsed_digest.is_unknown() && Some(collapsed_digest) == last_collapsed_digest;
        if status_unchanged && digest_unchanged {
            continue;
        }

        log::debug!(
            "[GitWorker] git status result for {}: {} bytes, changed={}, entries={}, digest={:?}",
            path_str,
            current.len(),
            current != last_status,
            current_files.len(),
            collapsed_digest
        );

        last_status = current;
        last_branch.clone_from(&current_branch);
        last_collapsed_digest = Some(collapsed_digest);
        version += 1;

        log::debug!(
            "[GitWorker] Emitting snapshot v{} for {} (branch {}): {} entries",
            version,
            path_str,
            current_branch,
            current_files.len()
        );

        on_change(GitStatusSnapshot {
            version,
            project_id: String::new(),
            branch: current_branch,
            entries: current_files,
            truncated,
        });
    }
}

/// Get current branch name (detached HEAD → "HEAD"), empty on error.
pub(crate) fn get_current_branch(repo_path: &Path) -> String {
    let path_str = repo_path.to_str().unwrap_or(".");
    match collect_blocking(
        &ExecTarget::Local,
        "git",
        &["-C", path_str, "rev-parse", "--abbrev-ref", "HEAD"],
    ) {
        Ok(output) if output.exit_code == 0 => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    }
}

/// Execute `git status --porcelain` with optional `--no-optional-locks`.
fn git_status_porcelain(repo_path: &Path, supports_no_optional_locks: &mut bool) -> String {
    let path_str = repo_path.to_str().unwrap_or(".");

    if *supports_no_optional_locks {
        match collect_blocking(
            &ExecTarget::Local,
            "git",
            &[
                "-C",
                path_str,
                "status",
                "--porcelain",
                "--no-optional-locks",
            ],
        ) {
            Ok(output) if output.exit_code == 0 => {
                return String::from_utf8_lossy(&output.stdout).to_string();
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if stderr.contains("unknown option") {
                    log::warn!(
                        "[GitWorker] git at {} does not support --no-optional-locks, falling back",
                        repo_path.display()
                    );
                    *supports_no_optional_locks = false;
                } else {
                    let (code, signal) = exit_diagnostics(output.exit_code);
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

    match collect_blocking(
        &ExecTarget::Local,
        "git",
        &["-C", path_str, "status", "--porcelain"],
    ) {
        Ok(output) => {
            if output.exit_code != 0 {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let (code, signal) = exit_diagnostics(output.exit_code);
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn get_current_branch_returns_initial_branch() {
        let (tmp, repo) = create_repo_with_commit();
        let expected = repo.head().unwrap().shorthand().unwrap().to_string();
        assert_eq!(get_current_branch(tmp.path()), expected);
    }

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

    #[test]
    fn get_current_branch_returns_empty_for_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(get_current_branch(tmp.path()), "");
    }

    #[test]
    fn worker_does_not_emit_when_status_unchanged() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        std::fs::write(tmp.path().join("README.md"), "# Changed\n").unwrap();

        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(tmp.path().to_path_buf(), move |diff| {
            let _ = emit_tx.send(diff);
        });

        worker.check();
        emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit the first diff");

        worker.check();
        match emit_rx.recv_timeout(Duration::from_millis(800)) {
            Ok(_) => panic!("unchanged status must not emit another diff"),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }
    }

    /// 对照（防矫枉过正）：折叠目录**内容不变**时不得因为新增了摘要探测就反复 emit
    /// —— 否则每次 FS 事件批次都会让前端整体替换快照（churn）。
    #[test]
    fn untracked_dir_unchanged_does_not_emit() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(tmp.path().to_path_buf(), move |snap| {
            let _ = emit_tx.send(snap);
        });

        let dir = tmp.path().join("stable");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x\n").unwrap();

        worker.check();
        emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit");

        worker.check();
        match emit_rx.recv_timeout(Duration::from_millis(800)) {
            Ok(snap) => panic!(
                "折叠目录内容未变时不得 emit（摘要相等应继续闸门），got v{}",
                snap.version
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }
    }

    /// AC7（后端侧）/ AC5：同一个折叠 untracked 目录**已进入上一次快照**后，在其内部
    /// 连续创建 10 个文件 → 恰好产出 1 个新快照（不是 10 个，也不是 0 个），幅度只体现
    /// 为 version 前进。
    ///
    /// 关键前置：目录必须先以折叠条目形态存在于上一次快照里 —— 否则 porcelain 字符串
    /// （`""` → `?? burst/`）本身就会变化，闸门放行，用例通过但什么都没验证到。
    ///
    /// 当前实现为 Red：第二阶段 porcelain 全程是 `?? burst/`（折叠语义），闸门判定
    /// 「无变化」→ 不 emit。前端调用次数上界见
    /// `src/features/git/hooks/__tests__/useUntrackedDirExpansion.test.ts`。
    #[test]
    fn untracked_dir_burst_creates_emit_exactly_one_snapshot() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (tmp, _repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(tmp.path().to_path_buf(), move |snap| {
            let _ = emit_tx.send(snap);
        });

        // v1：干净工作区
        worker.check();
        let first = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit");
        assert_eq!(first.version, 1);
        assert_eq!(first.entries.len(), 0);

        // v2：折叠目录入场（此阶段 porcelain 字符串确实变化，闸门放行属正常路径）
        let burst = tmp.path().join("burst");
        std::fs::create_dir_all(&burst).unwrap();
        std::fs::write(burst.join("f0.txt"), "x\n").unwrap();
        worker.check();
        let with_dir = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("collapsed dir should emit");
        assert_eq!(with_dir.version, 2);
        assert_eq!(with_dir.entries.len(), 1, "折叠语义：1 条目录条目");
        assert!(with_dir.entries[0].is_dir);
        assert_eq!(with_dir.entries[0].path, std::path::PathBuf::from("burst"));

        // v3：同一批次内在**已折叠**的目录里再建 10 个文件（其间不发 check）——
        // porcelain 字符串始终是 `?? burst/`，只有目录内容变了
        for i in 1..=10 {
            std::fs::write(burst.join(format!("f{i}.txt")), "x\n").unwrap();
        }
        worker.check();
        let snap = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("折叠目录内部的风暴必须产出快照（当前实现：porcelain 不变 → 被闸门吞掉）");
        assert_eq!(snap.version, 3, "version 必须单调递增");
        assert_eq!(
            snap.entries.len(),
            1,
            "折叠语义：11 个文件仍是 1 条目录条目"
        );
        assert!(snap.entries[0].is_dir, "折叠目录条目必须携带 is_dir");

        // 同一批次不得二次 emit（风暴不放大为多次快照）
        match emit_rx.recv_timeout(Duration::from_millis(300)) {
            Ok(extra) => panic!("同一批次不得二次 emit，got v{}", extra.version),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }
    }

    /// G2 验收标准的自动化替身（redesign-plan §3.7「压测：高频 touch + 心跳并发 +
    /// 切分支 → 零丢失、零回退」）。确定性化：并发信号风暴打在未变更工作区上
    /// （不得产生任何 emit），随后单次实质变更与切分支各产生恰好一个新版本；
    /// 最终快照与 `git status --porcelain` 真值逐条一致。
    #[test]
    fn worker_stress_concurrent_signals_churn_and_branch_switch() {
        use std::sync::Arc;
        use std::time::Duration;

        let (tmp, repo) = create_repo_with_commit();
        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusSnapshot>();
        let worker = GitStatusWorker::start(tmp.path().to_path_buf(), move |snap| {
            let _ = emit_tx.send(snap);
        });

        // 初始版本（v1，干净工作区）
        worker.check();
        let first = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("initial check should emit");
        assert_eq!(first.version, 1);
        assert_eq!(first.branch, repo.head().unwrap().shorthand().unwrap());

        // 并发信号风暴（4 线程 × 50 次 check，模拟 watcher/index/心跳同时触发）：
        // 内容未变 → 不得产生任何新 emit（查询-比较闸门在并发下同样生效）
        let worker_arc = Arc::new(worker.clone());
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let w = Arc::clone(&worker_arc);
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        w.check();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().expect("storm thread should not panic");
        }
        match emit_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(snap) => panic!(
                "unchanged-content storm must not emit, got v{}",
                snap.version
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("unexpected recv error: {e}"),
        }

        // 实质变更（modify tracked + add untracked）→ 恰好一个新版本（v2）
        std::fs::write(tmp.path().join("README.md"), "# changed\n").unwrap();
        std::fs::write(tmp.path().join("extra.txt"), "untracked\n").unwrap();
        worker.check();
        let after_churn = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("churn should emit");
        assert_eq!(after_churn.version, 2, "version 必须严格单调");
        assert_eq!(after_churn.entries.len(), 2);

        // 切分支 → 分支变化触发新版本（v3）
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature-stress", &head, false).unwrap();
        repo.set_head("refs/heads/feature-stress").unwrap();
        worker.check();
        let after_switch = emit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("branch switch should emit");
        assert_eq!(after_switch.version, 3);
        assert_eq!(after_switch.branch, "feature-stress");

        // 最终一致：快照 entries 与 porcelain 真值逐条一致（同一解析入口）
        let output = std::process::Command::new("git")
            .args(["-C", tmp.path().to_str().unwrap(), "status", "--porcelain"])
            .output()
            .expect("git should be available (worker itself shells out to git)");
        let truth = parse_porcelain(&String::from_utf8_lossy(&output.stdout));
        assert_eq!(after_switch.entries.len(), truth.len());
        for (entry, truth_entry) in after_switch.entries.iter().zip(truth.iter()) {
            assert_eq!(entry.path, truth_entry.path);
            assert_eq!(entry.status, truth_entry.status);
        }
    }
}
