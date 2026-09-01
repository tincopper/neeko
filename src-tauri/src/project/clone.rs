//! Git repository cloning for project creation: URL validation, name
//! derivation, progress parsing, target checks, and the async clone runner.
//!
//! Clone subprocess flows through the unified executor facade
//! (`common::executor`), never `std::process::Command` (Review Gate #1).
//! Progress is streamed from `git clone --progress` stderr; cancellation uses
//! a `tokio::sync::watch` channel (single sender in `AppStateWrapper`).

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use tokio::io::{AsyncReadExt, BufReader};

use crate::common::error::AppError;
use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::ExecError;
use crate::common::executor::SpawnOptions;
use crate::common::git::transport::{classify_stderr, ErrorKind};
use crate::project::events::CloneProgressEvent;

/// Error message for a user-cancelled clone.
pub const CLONE_CANCELLED: &str = "Clone cancelled";

/// Cap for retained clone stderr used in error classification.
const STDERR_TAIL_CAP: usize = 8 * 1024;

/// Upper bound for a single stderr line before it is force-flushed.
const MAX_LINE_LEN: usize = 4096;

// ── Pure helpers (unit-testable, no I/O) ──────────────────────────────────

/// Validate that a git URL has a supported scheme (http/https/git@ only).
pub fn validate_git_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("Git URL cannot be empty".to_string());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("git@") {
        return Err("Invalid git URL scheme. Expected http://, https://, or git@".to_string());
    }
    Ok(())
}

/// Derive a project name from a git URL: strip trailing `/` and `.git`, take
/// the last path segment (scp-style `git@host:owner/repo.git` included).
/// Returns an empty string when nothing can be derived.
#[must_use]
pub fn derive_project_name(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let without_suffix = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let last_segment = without_suffix.rsplit('/').next().unwrap_or("");
    let after_colon = last_segment.rsplit(':').next().unwrap_or(last_segment);
    after_colon.to_string()
}

/// Sanitize a user-supplied project name: allowlist `[A-Za-z0-9._-]`, other
/// characters become `-`. Rejects empty, `.` and `..`.
pub fn sanitize_project_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err(format!("Invalid project name: {trimmed}"));
    }
    let sanitized: String = trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    Ok(sanitized)
}

/// Clone progress phase, mirroring git's progress keywords.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClonePhase {
    /// Counting objects.
    Counting,
    /// Compressing objects.
    Compressing,
    /// Receiving objects.
    Receiving,
    /// Resolving deltas.
    Resolving,
    /// Updating files.
    Updating,
}

impl ClonePhase {
    /// snake_case keyword used in IPC payloads.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Counting => "counting",
            Self::Compressing => "compressing",
            Self::Receiving => "receiving",
            Self::Resolving => "resolving",
            Self::Updating => "updating",
        }
    }
}

/// Parsed clone progress from one stderr line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloneProgress {
    /// Progress phase keyword.
    pub phase: ClonePhase,
    /// Percentage (0-100).
    pub percent: u8,
}

static PROGRESS_RE: LazyLock<Regex> = LazyLock::new(|| {
    // Infallible: static pattern verified by unit tests.
    #[allow(clippy::expect_used)]
    Regex::new(r"(?i)(counting|compressing|receiving|resolving|updating)[^:%]*:\s+(\d{1,3})%")
        .expect("progress regex must compile")
});

/// Parse a git `--progress` stderr line into phase + percent.
/// Returns `None` for non-progress lines (localization is mitigated by
/// spawning with `LC_ALL=C`; unmatched lines degrade to indeterminate UI).
#[must_use]
pub fn parse_clone_progress(line: &str) -> Option<CloneProgress> {
    let caps = PROGRESS_RE.captures(line)?;
    let phase = match caps.get(1)?.as_str().to_ascii_lowercase().as_str() {
        "counting" => ClonePhase::Counting,
        "compressing" => ClonePhase::Compressing,
        "receiving" => ClonePhase::Receiving,
        "resolving" => ClonePhase::Resolving,
        "updating" => ClonePhase::Updating,
        _ => return None,
    };
    let percent: u8 = caps.get(2)?.as_str().parse().ok()?;
    if percent > 100 {
        return None;
    }
    Some(CloneProgress { phase, percent })
}

/// Resolve and validate the clone destination: canonicalize the parent dir
/// (path-safety gate) and reject an existing target (file or directory).
pub fn ensure_target_available(dest_parent: &Path, name: &str) -> Result<PathBuf, AppError> {
    let canonical_parent = dest_parent.canonicalize().map_err(|_| {
        AppError::Project(format!(
            "Destination directory does not exist: {}",
            dest_parent.display()
        ))
    })?;
    let dest = canonical_parent.join(name);
    if dest.exists() {
        return Err(AppError::Project(format!(
            "Destination already exists: {}",
            dest.display()
        )));
    }
    Ok(dest)
}

/// Remove a partial clone directory (best effort, ignores errors).
pub fn cleanup_partial_clone(dest: &Path) {
    if dest.exists() {
        let _ = std::fs::remove_dir_all(dest);
    }
}

// ── Cancellation handle ───────────────────────────────────────────────────

/// Handle for a running project clone. Stored in the `AppStateWrapper`
/// single-clone slot; `cancel` is safe to call from a sync command.
#[derive(Clone, Debug)]
pub struct CloneHandle {
    cancel_tx: tokio::sync::watch::Sender<bool>,
    /// Keeps at least one receiver alive so `cancel` before `run_clone`
    /// still updates the channel value (pre-start cancellation).
    _cancel_rx: tokio::sync::watch::Receiver<bool>,
}

impl Default for CloneHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl CloneHandle {
    /// Create a handle with a fresh (non-cancelled) watch channel.
    #[must_use]
    pub fn new() -> Self {
        let (tx, rx) = tokio::sync::watch::channel(false);
        Self {
            cancel_tx: tx,
            _cancel_rx: rx,
        }
    }

    /// Signal cancellation to the running clone.
    pub fn cancel(&self) -> Result<(), tokio::sync::watch::error::SendError<bool>> {
        self.cancel_tx.send(true)
    }
}

// ── Async clone runner ────────────────────────────────────────────────────

/// Run `git clone --progress <url> <dest>` on the local executor, streaming
/// progress through `on_progress`. No timeout by design (clones can take
/// minutes); `GIT_TERMINAL_PROMPT=0` prevents credential-prompt hangs, user
/// cancel is the escape hatch. Cleans up the destination on failure or
/// cancellation. Decoupled from `AppHandle` for testability — the command
/// layer injects the emit closure.
pub async fn run_clone<F>(
    clone_id: &str,
    url: &str,
    dest: PathBuf,
    handle: &CloneHandle,
    on_progress: F,
) -> Result<PathBuf, AppError>
where
    F: Fn(CloneProgressEvent),
{
    let mut cancel_rx = handle.cancel_tx.subscribe();
    if *cancel_rx.borrow() {
        return Err(AppError::Project(CLONE_CANCELLED.to_string()));
    }

    let dest_str = dest.to_string_lossy().into_owned();
    let executor = create_executor(&ExecTarget::Local);
    let mut child = executor
        .spawn_with(
            SpawnOptions::new("git", &["clone", "--progress", url, dest_str.as_str()])
                .with_env(&[("GIT_TERMINAL_PROMPT", "0"), ("LC_ALL", "C")]),
        )
        .await
        .map_err(|e| AppError::Project(format!("Failed to spawn git clone: {e}")))?;

    let (_, _, stderr) = child.take_stdio();
    let (mut wait, kill_fn) = child.into_wait_and_kill();
    let stderr =
        stderr.ok_or_else(|| AppError::Project("git clone stderr unavailable".to_string()))?;
    let mut reader = BufReader::new(stderr);

    // Read stderr to EOF (progress lines are \r-delimited), racing cancel.
    let mut stderr_tail = String::new();
    let mut last_key: Option<(ClonePhase, u8)> = None;
    let mut byte = [0u8; 1];
    let mut line: Vec<u8> = Vec::new();

    enum ReadOutcome {
        Eof,
        Cancelled,
    }

    let read_outcome = tokio::select! {
        biased;
        _ = cancel_rx.changed() => ReadOutcome::Cancelled,
        _ = async {
            loop {
                match reader.read(&mut byte).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if byte[0] == b'\n' || byte[0] == b'\r' || line.len() >= MAX_LINE_LEN {
                            if !line.is_empty() {
                                handle_progress_line(
                                    &line, clone_id, &on_progress, &mut stderr_tail, &mut last_key,
                                );
                                line.clear();
                            }
                        } else {
                            line.push(byte[0]);
                        }
                    }
                }
            }
            if !line.is_empty() {
                handle_progress_line(&line, clone_id, &on_progress, &mut stderr_tail, &mut last_key);
            }
        } => ReadOutcome::Eof,
    };

    if matches!(read_outcome, ReadOutcome::Cancelled) {
        finish_cancelled(kill_fn, &mut wait, &dest).await;
        return Err(AppError::Project(CLONE_CANCELLED.to_string()));
    }

    let exit_code = wait
        .await
        .map_err(|e| AppError::Project(format!("git clone wait failed: {e}")))?;

    // Cancel flag may have been set while waiting for exit (race guard).
    if *cancel_rx.borrow() {
        cleanup_async(&dest).await;
        return Err(AppError::Project(CLONE_CANCELLED.to_string()));
    }

    if exit_code != 0 {
        cleanup_async(&dest).await;
        return Err(AppError::Git(classify_message(&stderr_tail)));
    }

    Ok(dest)
}

/// Process one stderr line: retain for error classification, emit progress
/// event when phase/percent changes.
fn handle_progress_line<F>(
    line: &[u8],
    clone_id: &str,
    on_progress: &F,
    stderr_tail: &mut String,
    last_key: &mut Option<(ClonePhase, u8)>,
) where
    F: Fn(CloneProgressEvent),
{
    let text = String::from_utf8_lossy(line);
    // Keep the tail for error classification (cap size, drop oldest).
    stderr_tail.push_str(&text);
    stderr_tail.push('\n');
    if stderr_tail.len() > STDERR_TAIL_CAP {
        let cut = stderr_tail.len() - STDERR_TAIL_CAP;
        let boundary = (cut..stderr_tail.len())
            .find(|&i| stderr_tail.is_char_boundary(i))
            .unwrap_or(stderr_tail.len());
        stderr_tail.drain(..boundary);
    }

    if let Some(progress) = parse_clone_progress(&text) {
        let key = (progress.phase, progress.percent);
        if *last_key != Some(key) {
            *last_key = Some(key);
            on_progress(CloneProgressEvent {
                clone_id: clone_id.to_string(),
                phase: progress.phase.as_str().to_string(),
                percent: progress.percent,
                message: text.trim().to_string(),
            });
        }
    }
}

/// Kill future factory produced by `ExecChild::into_wait_and_kill`.
type KillFn = Box<
    dyn FnOnce()
            -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), ExecError>> + Send>>
        + Send,
>;
/// Exit-code future produced by `ExecChild::into_wait_and_kill`.
type WaitFuture =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<i32, ExecError>> + Send>>;

/// Kill the clone process, reap it, and remove the partial destination.
async fn finish_cancelled(kill_fn: KillFn, wait: &mut WaitFuture, dest: &Path) {
    if let Err(e) = (kill_fn)().await {
        log::warn!("Failed to kill git clone process: {e}");
    }
    let _ = wait.as_mut().await;
    cleanup_async(dest).await;
}

/// Remove partial clone dir off the async driver thread.
async fn cleanup_async(dest: &Path) {
    let dest = dest.to_path_buf();
    let _ = tokio::task::spawn_blocking(move || cleanup_partial_clone(&dest)).await;
}

/// Map classified git stderr to a user-facing message.
fn classify_message(stderr: &str) -> String {
    match classify_stderr(stderr) {
        ErrorKind::Auth => {
            "Authentication failed — check your git credential helper configuration".to_string()
        }
        ErrorKind::AuthSsh => {
            "SSH authentication failed — ensure ssh-agent has the required key".to_string()
        }
        ErrorKind::Network => {
            "Network error — check your connection and the remote URL".to_string()
        }
        ErrorKind::Ambiguous => {
            "Repository not found or access denied — verify the URL and permissions".to_string()
        }
        _ => format!("git clone failed: {}", stderr.trim()),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // validate_git_url

    #[test]
    fn validate_git_url_accepts_supported_schemes() {
        assert!(validate_git_url("https://github.com/owner/repo.git").is_ok());
        assert!(validate_git_url("http://example.com/repo.git").is_ok());
        assert!(validate_git_url("git@github.com:owner/repo.git").is_ok());
    }

    #[test]
    fn validate_git_url_rejects_unsupported() {
        assert!(validate_git_url("").is_err());
        assert!(validate_git_url("ftp://example.com/repo").is_err());
        assert!(validate_git_url("github.com/owner/repo").is_err());
        assert!(validate_git_url("/local/path/repo").is_err());
    }

    // derive_project_name

    #[test]
    fn derive_project_name_strips_git_suffix() {
        assert_eq!(
            derive_project_name("https://github.com/owner/repo.git"),
            "repo"
        );
    }

    #[test]
    fn derive_project_name_handles_trailing_slash() {
        assert_eq!(
            derive_project_name("https://github.com/owner/repo/"),
            "repo"
        );
        assert_eq!(
            derive_project_name("https://github.com/owner/repo.git/"),
            "repo"
        );
    }

    #[test]
    fn derive_project_name_handles_scp_style() {
        assert_eq!(derive_project_name("git@github.com:owner/repo.git"), "repo");
        assert_eq!(derive_project_name("git@github.com:repo"), "repo");
    }

    #[test]
    fn derive_project_name_nested_path_and_empty() {
        assert_eq!(
            derive_project_name("https://git.example.com/a/b/c.git"),
            "c"
        );
        assert_eq!(derive_project_name(""), "");
        assert_eq!(derive_project_name("https://"), "");
    }

    // sanitize_project_name

    #[test]
    fn sanitize_project_name_replaces_special_chars() {
        assert_eq!(sanitize_project_name("my repo!").unwrap(), "my-repo-");
        assert_eq!(
            sanitize_project_name("  repo.name_x  ").unwrap(),
            "repo.name_x"
        );
    }

    #[test]
    fn sanitize_project_name_rejects_bad_input() {
        assert!(sanitize_project_name("").is_err());
        assert!(sanitize_project_name("   ").is_err());
        assert!(sanitize_project_name(".").is_err());
        assert!(sanitize_project_name("..").is_err());
    }

    // parse_clone_progress

    #[test]
    fn parse_clone_progress_receiving() {
        let p = parse_clone_progress("Receiving objects: 45% (123/273), 5.2 MiB | 2.1 MiB/s")
            .expect("should parse");
        assert_eq!(p.phase, ClonePhase::Receiving);
        assert_eq!(p.percent, 45);
    }

    #[test]
    fn parse_clone_progress_all_phases() {
        let p = parse_clone_progress("remote: Counting objects: 100% (10/10), done.").unwrap();
        assert_eq!(p.phase, ClonePhase::Counting);
        assert_eq!(p.percent, 100);

        assert_eq!(
            parse_clone_progress("Compressing objects:  60% (3/5)")
                .unwrap()
                .phase,
            ClonePhase::Compressing
        );
        let p = parse_clone_progress("Resolving deltas: 100% (7/7), done.").unwrap();
        assert_eq!(p.phase, ClonePhase::Resolving);
        let p = parse_clone_progress("Updating files: 100% (5/5), done.").unwrap();
        assert_eq!(p.phase, ClonePhase::Updating);
    }

    #[test]
    fn parse_clone_progress_ignores_non_progress_lines() {
        assert!(parse_clone_progress("Cloning into 'repo'...").is_none());
        assert!(parse_clone_progress("fatal: repository not found").is_none());
        assert!(parse_clone_progress("réception d'objets: 45%").is_none());
        assert!(parse_clone_progress("").is_none());
    }

    #[test]
    fn parse_clone_progress_rejects_out_of_range_percent() {
        assert!(parse_clone_progress("Receiving objects: 101%").is_none());
        assert!(parse_clone_progress("Receiving objects: 999%").is_none());
    }

    // ensure_target_available

    #[test]
    fn ensure_target_available_rejects_missing_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("no-such-parent");
        assert!(ensure_target_available(&missing, "repo").is_err());
    }

    #[test]
    fn ensure_target_available_rejects_existing_dir_and_file() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("taken")).unwrap();
        assert!(ensure_target_available(tmp.path(), "taken").is_err());

        std::fs::write(tmp.path().join("afile"), b"x").unwrap();
        assert!(ensure_target_available(tmp.path(), "afile").is_err());
    }

    #[test]
    fn ensure_target_available_returns_canonical_path() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = ensure_target_available(tmp.path(), "fresh").unwrap();
        assert!(dest.is_absolute());
        assert_eq!(dest.file_name().unwrap().to_str(), Some("fresh"));
        assert!(!dest.exists());
    }

    // cleanup_partial_clone

    #[test]
    fn cleanup_partial_clone_removes_dir_and_tolerates_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let partial = tmp.path().join("partial");
        std::fs::create_dir_all(partial.join("objects")).unwrap();
        std::fs::write(partial.join("HEAD"), b"ref").unwrap();
        cleanup_partial_clone(&partial);
        assert!(!partial.exists());
        // Missing path must be a no-op (no panic).
        cleanup_partial_clone(&tmp.path().join("never-existed"));
    }

    // run_clone (async integration against a local fixture repo)

    #[tokio::test]
    async fn run_clone_clones_local_repo_successfully() {
        let src = tempfile::tempdir().unwrap();
        run_git_in(&src, &["init", "-q"]);
        std::fs::write(src.path().join("README.md"), "hello").unwrap();
        run_git_in(&src, &["add", "."]);
        run_git_in(
            &src,
            &[
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-qm",
                "init",
            ],
        );

        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("cloned-repo");
        let handle = CloneHandle::new();
        let events: std::sync::Arc<std::sync::Mutex<Vec<CloneProgressEvent>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();

        let result = run_clone(
            "test-clone-id",
            src.path().to_str().unwrap(),
            dest.clone(),
            &handle,
            move |event| sink.lock().unwrap().push(event),
        )
        .await;

        result.as_ref().expect("clone should succeed");
        assert!(dest.join(".git").exists());
        assert!(dest.join("README.md").exists());
        // Any emitted progress events must carry our clone id.
        for event in events.lock().unwrap().iter() {
            assert_eq!(event.clone_id, "test-clone-id");
        }
    }

    #[tokio::test]
    async fn run_clone_fails_and_cleans_up_on_bad_source() {
        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("never-cloned");
        let handle = CloneHandle::new();

        let result = run_clone(
            "test-clone-id",
            "https://localhost:1/definitely/not-a-repo.git",
            dest.clone(),
            &handle,
            |_| {},
        )
        .await;

        assert!(result.is_err(), "clone from bad source must fail");
        assert!(!dest.exists(), "partial destination must be cleaned up");
    }

    #[tokio::test]
    async fn run_clone_cancelled_before_start_returns_error() {
        let src = tempfile::tempdir().unwrap();
        run_git_in(&src, &["init", "-q"]);
        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("cancelled");

        let handle = CloneHandle::new();
        handle.cancel().expect("cancel signal should send");

        let result = run_clone(
            "test-clone-id",
            src.path().to_str().unwrap(),
            dest.clone(),
            &handle,
            |_| {},
        )
        .await;

        assert!(matches!(result, Err(AppError::Project(ref msg)) if msg.contains(CLONE_CANCELLED)));
        assert!(!dest.exists());
    }

    /// Test helper: run a git command in a directory (test-only direct spawn).
    fn run_git_in(dir: &tempfile::TempDir, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(dir.path())
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("git must be available for tests");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
