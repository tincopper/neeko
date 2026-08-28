// Git operations — files sub-module (split from operations.rs God File).

#![allow(unused_imports, missing_docs)]
use super::{invalidate_caches, readonly_opts, READONLY_ENV};
use crate::common::executor::factory::ExecTarget;
use crate::common::git::cache;
use crate::common::git::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use crate::common::git::operations::diff::get_worktree_changed_files_shell;
use crate::common::git::parsers::{parse_numstat_line, parse_status_line};
use crate::common::git::provider::detect_provider;
use crate::common::git::transport::{ErrorKind, GitExecError, GitTransport};
use crate::common::git::types::PushOutcome;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect_in_dir;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, GitBranchInfo, GitInfo, GitProvider, StashActionResult, StashEntry, Worktree,
};
use anyhow::{bail, Result};

pub async fn get_worktree_changed_files(
    transport: &dyn GitTransport,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    crate::common::git::local::assert_git_repo(std::path::Path::new(worktree_path))?;
    if let Some(repo) = transport.open_repo(worktree_path) {
        tokio::task::spawn_blocking(move || {
            crate::common::git::local::get_changed_files_from_repo(&repo)
        })
        .await
        .map_err(|e| anyhow::anyhow!("git changed files task join error: {e}"))?
    } else {
        get_worktree_changed_files_shell(transport, worktree_path).await
    }
}

/// Get ignored files (from .gitignore / .git/info/exclude) for a worktree path.
/// Uses `git status --porcelain --ignored` (directory-level collapsed), which works
/// for local, WSL and SSH transports alike. Empty when the path is not a git repo.
pub async fn get_ignored_files(
    transport: &dyn GitTransport,
    worktree_path: &str,
) -> Result<Vec<String>> {
    const MAX_IGNORED_FILES: usize = 500;
    let output = transport
        .run_git_opts(
            &["status", "--porcelain", "--ignored"],
            worktree_path,
            readonly_opts(),
        )
        .await?;
    let mut entries = parse_ignored_porcelain(&output);
    if entries.len() > MAX_IGNORED_FILES {
        // 与 get_untracked_files 截断惯例一致：超限必须留痕，避免静默丢数据
        ::log::warn!(
            "get_ignored_files({}) exceeded cap: {} entries truncated to {}",
            worktree_path,
            entries.len(),
            MAX_IGNORED_FILES
        );
        entries.truncate(MAX_IGNORED_FILES);
    }
    Ok(entries)
}

/// List untracked files under `dir_path`, expanding a collapsed untracked-dir
/// entry from `get_worktree_changed_files` (changes list shows `dir/` as a single
/// row; the UI expands it on demand). `git ls-files --others --exclude-standard`
/// respects .gitignore and works for all transports; result is capped to guard
/// IPC size on huge untracked directories (公理：随输入规模增长的结构必须有界).
pub async fn get_untracked_files(
    transport: &dyn GitTransport,
    worktree_path: &str,
    dir_path: &str,
) -> Result<Vec<String>> {
    const MAX_UNTRACKED_FILES: usize = 500;
    let dir = dir_path.trim_end_matches('/');
    if dir.is_empty() {
        return Ok(Vec::new());
    }
    let output = transport
        .run_git_opts(
            &["ls-files", "--others", "--exclude-standard", "--", dir],
            worktree_path,
            readonly_opts(),
        )
        .await?;
    let mut entries: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    if entries.len() > MAX_UNTRACKED_FILES {
        // 与 local.rs MAX_CHANGED_FILES 截断惯例一致：超限必须留痕，避免静默丢数据
        ::log::warn!(
            "get_untracked_files({}) exceeded cap: {} entries truncated to {}",
            dir,
            entries.len(),
            MAX_UNTRACKED_FILES
        );
        entries.truncate(MAX_UNTRACKED_FILES);
    }
    Ok(entries)
}

/// Parse `git status --porcelain --ignored` output into relative paths.
/// Ignored entries are prefixed with `!! `; directories end with a trailing `/`.
pub(crate) fn parse_ignored_porcelain(output: &str) -> Vec<String> {
    output
        .lines()
        .filter(|line| line.starts_with("!! "))
        .map(|line| line[3..].trim_end_matches('/').to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Get changed files diff stats (additions/deletions).
/// Uses git2 for local transports, local shell fallback otherwise.
pub async fn get_recent_commit_messages(
    transport: &dyn GitTransport,
    work_dir: &str,
    count: usize,
) -> Result<Vec<String>> {
    let count_str = format!("-{}", count);
    let output = transport
        .run_git(&["log", count_str.as_str(), "--format=%s"], work_dir)
        .await?;
    let messages: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(messages)
}
