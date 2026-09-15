// Git operations — commit sub-module (split from operations.rs God File).

#![allow(unused_imports, missing_docs)]
use super::{invalidate_caches, readonly_opts, READONLY_ENV};
use crate::common::executor::factory::ExecTarget;
use crate::common::git::cache;
use crate::common::git::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use crate::common::git::operations::stage::stage_files;
use crate::common::git::parsers::{parse_numstat_line, parse_status_line};
use crate::common::git::provider::detect_provider;
use crate::common::git::transport::{ErrorKind, GitExecError, GitTransport};
use crate::common::git::types::PushOutcome;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, GitBranchInfo, GitInfo, GitProvider, StashActionResult, StashEntry, Worktree,
};
use anyhow::{bail, Result};

/// 提交前守卫：`git ls-files -u -- <paths>` 输出非空 = index 存在 unmerged 条目
/// （merge/rebase 冲突未解决）。`stage_files`（git add）会清除 unmerged 标记，
/// 直接提交会把未解决冲突当作已解决，故必须在 stage 之前拦截。
async fn ensure_no_unmerged(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["ls-files", "-u", "--"];
    args.extend(file_paths.iter().map(|p| p.as_str()));
    let output = transport.run_git(&args, work_dir).await?;
    if !output.trim().is_empty() {
        bail!(
            "Cannot commit: unresolved merge conflict in selected files (resolve conflicts first)"
        );
    }
    Ok(())
}

pub async fn commit_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
    message: &str,
) -> Result<CommitResult> {
    if !file_paths.is_empty() {
        ensure_no_unmerged(transport, work_dir, file_paths).await?;
        stage_files(transport, work_dir, file_paths).await?;
    }
    let output = transport
        .run_git(&["commit", "-m", message], work_dir)
        .await?;
    invalidate_caches(work_dir);
    let hash = crate::common::git::parsers::extract_commit_hash_from_output(&output);
    Ok(CommitResult {
        success: true,
        hash: hash.unwrap_or_default(),
        message: message.to_string(),
    })
}

/// Cherry-pick a commit: `git cherry-pick <commit_hash>`
pub async fn cherry_pick(
    transport: &dyn GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<()> {
    transport
        .run_git(&["cherry-pick", commit_hash], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Revert a commit: `git revert --no-edit <commit_hash>`
pub async fn revert(transport: &dyn GitTransport, work_dir: &str, commit_hash: &str) -> Result<()> {
    transport
        .run_git(&["revert", "--no-edit", commit_hash], work_dir)
        .await?;
    Ok(())
}

/// Create a tag: `git tag -a <name> -m <message>`
pub async fn create_tag(
    transport: &dyn GitTransport,
    work_dir: &str,
    name: &str,
    message: &str,
) -> Result<()> {
    transport
        .run_git(&["tag", "-a", name, "-m", message], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}
