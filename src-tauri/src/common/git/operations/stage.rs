// Git operations — stage sub-module (split from operations.rs God File).

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

pub async fn stage_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["add", "--"];
    for f in file_paths {
        args.push(f);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Unstage specific files: `git restore --staged -- <files>`
pub async fn unstage_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    for f in file_paths {
        args.push(f);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Stage all changes: `git add -A`
pub async fn stage_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["add", "-A"], work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Unstage all changes: `git restore --staged .`
pub async fn unstage_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["restore", "--staged", "."], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Discard file changes: `git checkout -- <file>`
///
/// 未跟踪文件（`??`）无法用 checkout 恢复，直接删除；已暂存文件先 reset 撤销暂存；
/// 仅工作区修改恢复到 index 版本。参考 `local::discard_file` 的状态判定。
pub async fn discard_file(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_path: &str,
) -> Result<()> {
    // 先查询文件状态，区分未跟踪 / 已暂存 / 仅工作区修改
    let status = transport
        .run_git(
            &["status", "--porcelain=1", "-z", "--", file_path],
            work_dir,
        )
        .await?;

    if status.is_empty() {
        bail!("File '{}' has no changes to discard.", file_path);
    }

    let bytes = status.as_bytes();
    let x = bytes.first().copied().unwrap_or(b' ');
    let y = bytes.get(1).copied().unwrap_or(b' ');

    // ?? → 未跟踪文件：直接删除（checkout 无法处理未跟踪文件）
    if x == b'?' && y == b'?' {
        transport
            .run_git(&["clean", "-fd", "--", file_path], work_dir)
            .await?;
        return Ok(());
    }

    // X (index) 有变更 → 先撤销暂存（reset；无 HEAD 的 staged 新增走 rm --cached）
    if x != b' ' && x != b'?' {
        unstage_via_reset_or_rm_cached(transport, work_dir, file_path, x == b'A').await?;
    }

    // reset 撤销暂存后工作区可能仍有残留变更（如 staged 修改 `M `），
    // 重新查询状态并恢复工作区。
    let status_after = transport
        .run_git(
            &["status", "--porcelain=1", "-z", "--", file_path],
            work_dir,
        )
        .await?;
    if status_after.is_empty() {
        return Ok(());
    }
    let bytes_after = status_after.as_bytes();
    let x2 = bytes_after.first().copied().unwrap_or(b' ');
    let y2 = bytes_after.get(1).copied().unwrap_or(b' ');

    // reset 后变为未跟踪（如 staged 新增）→ 删除
    if x2 == b'?' && y2 == b'?' {
        transport
            .run_git(&["clean", "-fd", "--", file_path], work_dir)
            .await?;
        return Ok(());
    }
    // 工作区有变更 → checkout 恢复
    if y2 != b' ' && y2 != b'?' {
        transport
            .run_git(&["checkout", "--", file_path], work_dir)
            .await?;
    }

    invalidate_caches(work_dir);
    Ok(())
}

/// 撤销指定文件的暂存状态。
///
/// 优先 `git reset HEAD -- <file>`；新仓库无 HEAD 时 reset 报 unknown revision，
/// 此时 staged 新增（`A`）走 `rm --cached` + `clean` 删除。
async fn unstage_via_reset_or_rm_cached(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_path: &str,
    staged_as_new: bool,
) -> Result<()> {
    if let Err(e) = transport
        .run_git(&["reset", "HEAD", "--", file_path], work_dir)
        .await
    {
        let stderr = e
            .downcast_ref::<GitExecError>()
            .map(|ge| ge.stderr.as_str())
            .unwrap_or("");
        // 真实错误 → 直接传播；仅"无 HEAD"类错误继续走 rm --cached 兜底
        if !stderr.contains("unknown revision") && !stderr.contains("ambiguous") {
            return Err(e);
        }
        // 新仓库无 HEAD：staged 新增 → 变为 untracked → 删除
        if staged_as_new {
            transport
                .run_git(&["rm", "--cached", "-f", "--", file_path], work_dir)
                .await?;
            transport
                .run_git(&["clean", "-fd", "--", file_path], work_dir)
                .await?;
        }
    }
    Ok(())
}

/// Discard all changes: `git checkout -- .`
pub async fn discard_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["checkout", "--", "."], work_dir)
        .await?;
    let _ = transport.run_git(&["clean", "-fd"], work_dir).await;
    Ok(())
}
