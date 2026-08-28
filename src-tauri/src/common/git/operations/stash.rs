// Git operations — stash sub-module (split from operations.rs God File).

#![allow(unused_imports, missing_docs)]
use super::{invalidate_caches, readonly_opts, READONLY_ENV};
use crate::common::executor::factory::ExecTarget;
use crate::common::git::cache;
use crate::common::git::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use crate::common::git::operations::log::get_revision_file_diff;
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

pub async fn get_stash_list(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<Vec<StashEntry>> {
    let output = transport
        .run_git(
            &["stash", "list", "--format=%gd%x00%gs%x00%H%x00%aI%x00"],
            work_dir,
        )
        .await?;
    Ok(crate::common::git::parsers::parse_stash_list(&output))
}

/// Get files changed in a stash entry: `git stash show --numstat/--name-status <selector>`
pub async fn get_stash_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    selector: &str,
) -> Result<Vec<CommitFileChange>> {
    let numstat = transport
        .run_git(&["stash", "show", "--numstat", selector], work_dir)
        .await?;
    let status_output = transport
        .run_git(&["stash", "show", "--name-status", selector], work_dir)
        .await?;
    Ok(crate::common::git::parsers::parse_numstat_with_status(
        &numstat,
        &status_output,
    ))
}

/// Get diff for a single file in a stash entry: `git diff <selector>^ <selector> -- <file>`
pub async fn get_stash_file_diff(
    transport: &dyn GitTransport,
    work_dir: &str,
    selector: &str,
    file_path: &str,
    collapse: bool,
) -> Result<DiffResult> {
    get_revision_file_diff(transport, work_dir, selector, file_path, collapse).await
}

/// Apply a stash entry to the working tree: `git stash apply <selector>`.
/// Operation-level failures (conflicts, etc.) are reported as `success: false`
/// with the git stderr message; system-level errors (auth/network/spawn) propagate.
pub async fn stash_apply(
    transport: &dyn GitTransport,
    work_dir: &str,
    selector: &str,
) -> Result<StashActionResult> {
    match transport
        .run_git(&["stash", "apply", selector], work_dir)
        .await
    {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(StashActionResult {
                success: true,
                message: String::new(),
            })
        }
        // 冲突（success: false）时 git 可能已部分应用到工作区，同样需要失效
        Err(e) => {
            invalidate_caches(work_dir);
            stash_action_result(e)
        }
    }
}

/// Pop (apply + drop) a stash entry: `git stash pop <selector>`.
/// On conflict git keeps the entry; reported as `success: false`.
/// System-level errors (auth/network/spawn) propagate instead of being masked.
pub async fn stash_pop(
    transport: &dyn GitTransport,
    work_dir: &str,
    selector: &str,
) -> Result<StashActionResult> {
    match transport
        .run_git(&["stash", "pop", selector], work_dir)
        .await
    {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(StashActionResult {
                success: true,
                message: String::new(),
            })
        }
        // pop 冲突时 git 已 apply（改动在工作区）但保留条目，同样需要失效
        Err(e) => {
            invalidate_caches(work_dir);
            stash_action_result(e)
        }
    }
}

/// Operation-level stash apply/pop failure markers. Git reports merge conflicts and
/// invalid selectors as ordinary operation failures, not system faults. Real 3-way
/// conflicts surface on **stdout** ("CONFLICT (content): ..."), while local-change
/// conflicts ("would be overwritten by merge") and bad selectors land on **stderr**.
const STASH_OP_FAILURE_MARKERS: &[&str] = &[
    "CONFLICT (content):",
    "CONFLICT (rename",
    "CONFLICT (modify/delete)",
    "would be overwritten by merge",
    "log for 'stash' only has",
    "No stash entries found.",
];

/// Classify a stash apply/pop failure into a result:
/// - operation-level failures (merge conflicts, local-change conflicts, invalid
///   selector, no stash entries) → `success: false` with the raw git message;
/// - system-level errors (auth / network / ambiguous / no-upstream) and
///   non-`GitExecError` failures (spawn, timeout) → propagate as `Err`.
pub(crate) fn stash_action_result(err: anyhow::Error) -> Result<StashActionResult> {
    match err.downcast_ref::<GitExecError>() {
        Some(ge)
            if ge.kind == ErrorKind::Other
                && STASH_OP_FAILURE_MARKERS
                    .iter()
                    .any(|m| ge.stderr.contains(m) || ge.stdout.contains(m)) =>
        {
            // 冲突信息可能落在 stderr（本地改动冲突）或 stdout（真实 3-way 冲突）；
            // stderr 为空时从 stdout 提取 CONFLICT 行，避免 toast 空消息。
            let message = if ge.stderr.trim().is_empty() {
                stash_conflict_message_from_stdout(&ge.stdout)
            } else {
                ge.stderr.clone()
            };
            Ok(StashActionResult {
                success: false,
                message,
            })
        }
        _ => Err(err),
    }
}

/// Extract the first conflict line from stdout (real 3-way conflicts land here,
/// not on stderr).
pub(crate) fn stash_conflict_message_from_stdout(stdout: &str) -> String {
    stdout
        .lines()
        .find(|l| l.contains("CONFLICT"))
        .unwrap_or_else(|| stdout.trim())
        .to_string()
}
