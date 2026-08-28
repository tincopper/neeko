// Git operations — info sub-module (split from operations.rs God File).

#![allow(unused_imports, missing_docs)]
use super::{invalidate_caches, readonly_opts, READONLY_ENV};
use crate::common::executor::factory::ExecTarget;
use crate::common::git::cache;
use crate::common::git::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use crate::common::git::operations::worktree::parse_worktree_list;
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

pub async fn get_git_info_shell(transport: &dyn GitTransport, work_dir: &str) -> Result<GitInfo> {
    let branch_info = get_git_branch_info_shell(transport, work_dir).await?;
    let changed_files = transport
        .run_git(&["status", "--porcelain"], work_dir)
        .await?;
    let is_clean = changed_files.trim().is_empty();
    let files = if is_clean {
        vec![]
    } else {
        changed_files
            .lines()
            .filter_map(parse_status_line)
            .collect()
    };

    // 检测 Git 提供商
    let remote_url = transport
        .run_git(&["remote", "get-url", "origin"], work_dir)
        .await
        .unwrap_or_default();
    let git_provider = if remote_url.trim().is_empty() {
        GitProvider::Unknown
    } else {
        detect_provider(remote_url.trim())
    };

    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        changed_files: files,
        is_clean,
        git_provider,
    })
}

/// Get git branch info using shell commands
pub async fn get_git_branch_info_shell(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<GitBranchInfo> {
    let head = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let current_branch = head.trim();
    let current_branch = if current_branch == "HEAD" {
        "HEAD (detached)"
    } else {
        current_branch
    };

    // 本地分支
    let local_output = transport
        .run_git(&["branch", "--format=%(refname:short)"], work_dir)
        .await?;
    let mut branches: Vec<String> = local_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    // 远程跟踪分支，跳过 HEAD 引用和已存在本地分支的同名分支
    let remote_output = transport
        .run_git(&["branch", "-r", "--format=%(refname:short)"], work_dir)
        .await
        .unwrap_or_default();
    for line in remote_output.lines() {
        let name = line.trim();
        if name.is_empty() || name.ends_with("/HEAD") {
            continue;
        }
        // 提取远程名后的分支名，如 origin/feature/xxx -> feature/xxx
        let local_name = name.split('/').skip(1).collect::<Vec<&str>>().join("/");
        if !local_name.is_empty() && branches.contains(&local_name) {
            continue;
        }
        branches.push(name.to_string());
    }

    let worktrees_output = transport
        .run_git(&["worktree", "list", "--porcelain"], work_dir)
        .await?;
    let mut worktrees = parse_worktree_list(&worktrees_output);
    // The first worktree is always the main worktree (the project directory itself).
    // Filter it out to match the behavior of git2 and parsers::parse_git_info_output.
    if !worktrees.is_empty() {
        worktrees.remove(0);
    }

    Ok(GitBranchInfo {
        current_branch: current_branch.to_string(),
        branches,
        worktrees,
    })
}

pub async fn get_git_info(transport: &dyn GitTransport, work_dir: &str) -> Result<GitInfo> {
    crate::common::git::local::assert_git_repo(std::path::Path::new(work_dir))?;
    if let Some(repo) = transport.open_repo(work_dir) {
        tokio::task::spawn_blocking(move || {
            let branch_info = crate::common::git::local::get_git_branch_info_from_repo(&repo)?;
            let changed_files = crate::common::git::local::get_changed_files_from_repo(&repo)?;
            let is_clean = changed_files.is_empty();
            let git_provider = repo
                .find_remote("origin")
                .ok()
                .and_then(|r| r.url().map(|u| u.to_string()))
                .map(|u| detect_provider(&u))
                .unwrap_or(GitProvider::Unknown);
            Ok(GitInfo {
                current_branch: branch_info.current_branch,
                branches: branch_info.branches,
                worktrees: branch_info.worktrees,
                changed_files,
                is_clean,
                git_provider,
            })
        })
        .await
        .map_err(|e| anyhow::anyhow!("git info task join error: {e}"))?
    } else {
        get_git_info_shell(transport, work_dir).await
    }
}

/// Get git branch info. Uses git2 for local transports, shell fallback otherwise.
pub async fn get_git_branch_info(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<GitBranchInfo> {
    crate::common::git::local::assert_git_repo(std::path::Path::new(work_dir))?;
    if let Some(repo) = transport.open_repo(work_dir) {
        tokio::task::spawn_blocking(move || {
            crate::common::git::local::get_git_branch_info_from_repo(&repo)
        })
        .await
        .map_err(|e| anyhow::anyhow!("git branch info task join error: {e}"))?
    } else {
        get_git_branch_info_shell(transport, work_dir).await
    }
}
