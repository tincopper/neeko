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
use crate::core::exec::collect;
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

// ─── Worktree list ───────────────────────────────────────────────────────────

/// 单条清单条目的归一化出口（唯一）：归一失败返回 `None`，由调用方丢弃该条目。
fn normalized_worktree(
    target: &ExecTarget,
    raw_path: &str,
    branch: String,
    head: String,
) -> Option<Worktree> {
    match crate::common::git::path_guard::canonicalize_worktree_path(target, raw_path) {
        Ok(path) => Some(Worktree {
            path: std::path::PathBuf::from(path),
            branch,
            head,
        }),
        Err(e) => {
            log::warn!("[git] dropping worktree `{raw_path}`: path is not normalizable: {e}");
            None
        }
    }
}

/// Parse `git worktree list --porcelain` into the authoritative worktree list.
///
/// **路径即身份**：这些路径会被前端拼成 `RepoKey`，必须与 `RepoRef::key()` 逐字同形 ——
/// 因此**产出即归一**（`target` 决定语义：Local 走文件系统 canonicalize，WSL / SSH 走词法
/// 归一，远端路径绝不能经宿主 `std::path`，详见 `path_guard::canonicalize_worktree_path`）。
/// 归一漏掉时同一单元会有两种形态：前端按清单拼的 key 取不到快照（侧栏 +A/-D 空白）、
/// 存活校验把激活单元误判成已消失并回落主仓。
///
/// 实测（2026-09-30）git 输出的已是 realpath 形态，所以此处当前是幂等加固；显式归一 +
/// 同名单测是为了让「产物必须与消费侧身份同形」成为可执行契约，而非依赖 git 的实现细节。
///
/// 归一失败的条目不进清单：宁可缺一项，也不对外产出第二种身份表示。
pub(crate) fn parse_worktree_list(output: &str, target: &ExecTarget) -> Vec<Worktree> {
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();
    let mut current_head = String::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some(stripped) = line.strip_prefix("worktree ") {
            if !current_path.is_empty() {
                if let Some(wt) = normalized_worktree(
                    target,
                    &current_path,
                    std::mem::take(&mut current_branch),
                    std::mem::take(&mut current_head),
                ) {
                    worktrees.push(wt);
                }
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
        if let Some(wt) = normalized_worktree(target, &current_path, current_branch, current_head) {
            worktrees.push(wt);
        }
    }
    worktrees
}
