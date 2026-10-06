// Git operations — commit sub-module (split from operations.rs God File).

use super::invalidate_caches;
use crate::common::git::operations::stage::stage_files;
use crate::common::git::transport::{GitExecOptions, GitRunHooks, GitTransport};
use crate::project::types::CommitResult;
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

/// 提交指定路径已暂存的内容，返回提交结果。
pub async fn commit_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
    message: &str,
    hooks: GitRunHooks,
) -> Result<CommitResult> {
    if !file_paths.is_empty() {
        ensure_no_unmerged(transport, work_dir, file_paths).await?;
        stage_files(transport, work_dir, file_paths).await?;
    }
    // commit 会触发 pre-commit hook（eslint / tsc 等）：输出实时进 Console。
    let output = transport
        .run_git_opts_streaming(
            &["commit", "-m", message],
            work_dir,
            GitExecOptions::default(),
            hooks,
        )
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
