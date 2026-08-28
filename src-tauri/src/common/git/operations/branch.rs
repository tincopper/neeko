// Git operations — branch sub-module (split from operations.rs God File).

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

pub async fn checkout_branch(
    transport: &dyn GitTransport,
    work_dir: &str,
    branch_name: &str,
) -> Result<()> {
    transport
        .run_git(&["checkout", branch_name], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Create a branch: `git branch <branch_name> [<start_point>]`
pub async fn create_branch(
    transport: &dyn GitTransport,
    work_dir: &str,
    branch_name: &str,
    start_point: Option<&str>,
) -> Result<()> {
    let mut args: Vec<&str> = vec!["branch", branch_name];
    if let Some(sp) = start_point {
        args.push(sp);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Delete a branch: `git branch -d <branch_name>` (force: `-D`)
pub async fn delete_branch(
    transport: &dyn GitTransport,
    work_dir: &str,
    branch_name: &str,
    force: bool,
) -> Result<()> {
    let flag = if force { "-D" } else { "-d" };
    transport
        .run_git(&["branch", flag, branch_name], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Rename a branch: `git branch -m <old_name> <new_name>`
pub async fn rename_branch(
    transport: &dyn GitTransport,
    work_dir: &str,
    old_name: &str,
    new_name: &str,
) -> Result<()> {
    transport
        .run_git(&["branch", "-m", old_name, new_name], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Create and switch to a new branch: `git checkout -b <branch_name>`
pub async fn create_and_switch_branch(
    transport: &dyn GitTransport,
    work_dir: &str,
    branch_name: &str,
) -> Result<()> {
    transport
        .run_git(&["checkout", "-b", branch_name], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Checkout detached HEAD
pub async fn checkout_detached(
    transport: &dyn GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<()> {
    transport
        .run_git(&["checkout", commit_hash], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}
