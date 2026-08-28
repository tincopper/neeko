// Git operations — log sub-module (split from operations.rs God File).

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

pub async fn get_commit_log(
    transport: &dyn GitTransport,
    work_dir: &str,
    count: usize,
    skip: usize,
) -> Result<Vec<CommitEntry>> {
    let format = "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D%x00%P";
    let skip_str = if skip > 0 {
        Some(format!("--skip={}", skip))
    } else {
        None
    };
    let mut args: Vec<String> = vec![
        "log".to_string(),
        format.to_string(),
        "--decorate=full".to_string(),
        "--topo-order".to_string(),
        "HEAD".to_string(),
    ];
    if count > 0 {
        args.push(format!("-{}", count));
    }
    if let Some(s) = skip_str {
        args.push(s);
    }
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = transport.run_git(&str_args, work_dir).await?;
    Ok(crate::common::git::parsers::parse_commit_log_output(
        &output,
    ))
}

/// Get commit detail: `git show --format=... --no-patch <hash>`
pub async fn get_commit_detail(
    transport: &dyn GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<CommitDetail> {
    let format = "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%B%x00%P%x00%D";
    let output = transport
        .run_git(&["show", format, "--no-patch", commit_hash], work_dir)
        .await?;
    let parts: Vec<&str> = output.split('\0').collect();
    if parts.len() < 7 {
        anyhow::bail!("Unexpected git show output format");
    }
    let parents = parts
        .get(6)
        .map(|s| {
            s.split_whitespace()
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let refs = parts.get(7).map(|s| s.to_string()).unwrap_or_default();
    Ok(CommitDetail {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        author: parts[2].to_string(),
        email: parts[3].to_string(),
        timestamp: parts[4].to_string(),
        message: parts[5].trim().to_string(),
        parents,
        refs,
    })
}

/// Get files changed in a commit: `git diff-tree --numstat <hash>`
pub async fn get_commit_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<Vec<CommitFileChange>> {
    let numstat = transport
        .run_git(
            &[
                "diff-tree",
                "--no-commit-id",
                "-r",
                "--numstat",
                commit_hash,
            ],
            work_dir,
        )
        .await?;

    let status_output = transport
        .run_git(
            &[
                "diff-tree",
                "--no-commit-id",
                "-r",
                "--name-status",
                commit_hash,
            ],
            work_dir,
        )
        .await?;

    Ok(crate::common::git::parsers::parse_numstat_with_status(
        &numstat,
        &status_output,
    ))
}

/// List stashes: `git stash list --format=%gd%x00%gs%x00%H%x00%aI%x00`
pub async fn get_commit_file_diff(
    transport: &dyn GitTransport,
    work_dir: &str,
    commit_hash: &str,
    file_path: &str,
    collapse: bool,
) -> Result<DiffResult> {
    get_revision_file_diff(transport, work_dir, commit_hash, file_path, collapse).await
}

/// Shared implementation for diffing one file against a revision's parent:
/// `git diff <revision>^ <revision> -- <file>` (used by commit and stash diffs).
pub(crate) async fn get_revision_file_diff(
    transport: &dyn GitTransport,
    work_dir: &str,
    revision: &str,
    file_path: &str,
    collapse: bool,
) -> Result<DiffResult> {
    let mut args = vec!["diff".to_string()];
    if !collapse {
        // 全量护栏：按文件字节数生成 -U 参数，防止 IPC JSON 超 2MB
        let file_bytes = tokio::fs::metadata(std::path::Path::new(work_dir).join(file_path))
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        args.push(crate::common::git::parsers::full_diff_context_arg(
            file_bytes,
        ));
    }
    args.push(format!("{}^", revision));
    args.push(revision.to_string());
    args.push("--".to_string());
    args.push(file_path.to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = transport.run_git(&arg_refs, work_dir).await?;
    let mut result = crate::common::git::parsers::parse_unified_diff(&output);
    if collapse {
        crate::common::git::parsers::collapse_diff_context(&mut result.hunks, 12);
    }
    Ok(result)
}

/// Get ahead/behind counts: `git rev-list --left-right --count`
pub async fn get_ahead_behind(transport: &dyn GitTransport, work_dir: &str) -> Result<AheadBehind> {
    crate::common::git::local::assert_git_repo(std::path::Path::new(work_dir))?;
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let branch = branch.trim().to_string();
    let output = transport
        .run_git(
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("origin/{}...{}", branch, branch),
            ],
            work_dir,
        )
        .await?;
    let parts: Vec<&str> = output.trim().split('\t').collect();
    Ok(AheadBehind {
        ahead: parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
        behind: parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
    })
}
