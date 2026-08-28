#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::collect_blocking;

use super::writer::{
    compute_branch_switch_diff, compute_status_diff, get_numstat_map, parse_porcelain,
    serialize_files_for_diff, GitStatusDiff,
};

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
    let mut last_branch = String::new();
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

        if current == last_status && current_branch == last_branch {
            continue;
        }

        let mut current_files = parse_porcelain(&current);
        const MAX_NUMSTAT_FILES: usize = 200;
        if !current_files.is_empty() && current_files.len() <= MAX_NUMSTAT_FILES {
            let numstat = get_numstat_map(&repo_path);
            for file in &mut current_files {
                if let Some((add, del)) = numstat.get(&file.path) {
                    file.additions = *add;
                    file.deletions = *del;
                }
            }
        }

        let current_serialized = serialize_files_for_diff(&current_files);

        log::debug!(
            "[GitWorker] git status result for {}: {} bytes, changed={}",
            path_str,
            current.len(),
            current != last_status
        );

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

            last_status = current;

            if current_serialized != last_serialized {
                let diff = compute_status_diff(&last_files, &current_files);

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

        let (emit_tx, emit_rx) = mpsc::channel::<GitStatusDiff>();
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
}
