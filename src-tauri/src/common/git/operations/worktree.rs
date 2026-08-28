// Git operations — worktree sub-module (split from operations.rs God File).

#![allow(unused_imports, missing_docs)]
use super::{invalidate_caches, readonly_opts, READONLY_ENV};
use crate::common::executor::factory::ExecTarget;
use crate::common::git::cache;
use crate::common::git::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
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

pub async fn remove_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    worktree_path: &str,
) -> Result<()> {
    transport
        .run_git(&["worktree", "remove", "--force", worktree_path], work_dir)
        .await?;
    invalidate_caches(work_dir);
    invalidate_caches(worktree_path);
    Ok(())
}

/// Rename a worktree: `git worktree move <old_path> <new_path>`
pub async fn rename_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    old_path: &str,
    new_path: &str,
) -> Result<()> {
    transport
        .run_git(&["worktree", "move", old_path, new_path], work_dir)
        .await?;
    invalidate_caches(work_dir);
    invalidate_caches(old_path);
    invalidate_caches(new_path);
    Ok(())
}

/// Check if a worktree is dirty: `git status --porcelain` returns output
pub async fn is_worktree_dirty(transport: &dyn GitTransport, worktree_path: &str) -> Result<bool> {
    let output = transport
        .run_git(&["status", "--porcelain"], worktree_path)
        .await?;
    Ok(!output.trim().is_empty())
}

/// Create a worktree: `git worktree add <path> <branch>`
pub async fn create_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    worktree_path: &str,
    branch_name: &str,
    new_branch: bool,
) -> Result<()> {
    let mut args = vec!["worktree", "add"];
    if new_branch {
        args.push("-b");
        args.push(branch_name);
    }
    args.push(worktree_path);
    if !new_branch {
        args.push(branch_name);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    invalidate_caches(worktree_path);
    Ok(())
}

/// Get default branch: `git remote show origin | grep HEAD`
pub async fn default_branch(transport: &dyn GitTransport, work_dir: &str) -> Result<String> {
    let output = transport
        .run_git(&["remote", "show", "origin"], work_dir)
        .await?;
    for line in output.lines() {
        if let Some(branch) = line.trim().strip_prefix("HEAD branch: ") {
            return Ok(branch.to_string());
        }
    }
    let output = transport
        .run_git(&["rev-parse", "--abbrev-ref", "origin/HEAD"], work_dir)
        .await?;
    let branch = output
        .trim()
        .strip_prefix("origin/")
        .unwrap_or(output.trim());
    Ok(branch.to_string())
}

// ─── Commit Log ──────────────────────────────────────────────────────────────

/// Get commit log: `git log --format=...`
pub(crate) fn parse_worktree_list(output: &str) -> Vec<Worktree> {
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();
    let mut current_head = String::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some(stripped) = line.strip_prefix("worktree ") {
            if !current_path.is_empty() {
                worktrees.push(Worktree {
                    path: std::path::PathBuf::from(&current_path),
                    branch: std::mem::take(&mut current_branch),
                    head: std::mem::take(&mut current_head),
                });
            }
            current_path = stripped.to_string();
        } else if let Some(ref_str) = line.strip_prefix("branch ") {
            if let Some(name) = ref_str.strip_prefix("refs/heads/") {
                current_branch = name.to_string();
            }
        } else if let Some(stripped) = line.strip_prefix("HEAD ") {
            current_head = stripped.to_string();
        }
    }
    if !current_path.is_empty() {
        worktrees.push(Worktree {
            path: std::path::PathBuf::from(current_path),
            branch: current_branch,
            head: current_head,
        });
    }
    worktrees
}
