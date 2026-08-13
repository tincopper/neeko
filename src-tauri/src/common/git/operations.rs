//! High-level git operations (push, pull, clone, etc.) using the transport abstraction.

use anyhow::{bail, Result};

use super::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use super::transport::{ErrorKind, GitExecError, GitTransport};
use super::types::PushOutcome;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::parsers::parse_numstat_line;
use crate::common::git::provider::detect_provider;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect_in_dir;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, FileStatus, GitBranchInfo, GitInfo, GitProvider, Worktree,
};

/// Stage specific files: `git add -- <files>`
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
    Ok(())
}

/// Stage all changes: `git add -A`
pub async fn stage_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["add", "-A"], work_dir).await?;
    Ok(())
}

/// Unstage all changes: `git restore --staged .`
pub async fn unstage_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["restore", "--staged", "."], work_dir)
        .await?;
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

/// Fetch from all remotes: `git fetch --all`
pub async fn fetch(transport: &dyn GitTransport, work_dir: &str) -> Result<PushOutcome> {
    let result = transport.run_git(&["fetch", "--all"], work_dir).await;
    match result {
        Ok(_) => Ok(PushOutcome::Success {}),
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Fetch with cached credentials (approve before fetch).
pub async fn fetch_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    exec_with_credentials(transport, work_dir, &["fetch", "--all"], username, password).await
}

/// Push to remote: `git push [--set-upstream [-o origin <branch>]]`
pub async fn push(
    transport: &dyn GitTransport,
    work_dir: &str,
    set_upstream: bool,
) -> Result<PushOutcome> {
    let owned = push_args(transport, work_dir, set_upstream).await;
    let args: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    let result = transport.run_git(&args, work_dir).await;
    match result {
        Ok(_) => Ok(PushOutcome::Success {}),
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Push with pre-approved credentials (credential_approve + push).
pub async fn push_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    set_upstream: bool,
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    let owned = push_args(transport, work_dir, set_upstream).await;
    let args: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    exec_with_credentials(transport, work_dir, &args, username, password).await
}

/// Pull: fetch + merge --ff-only
pub async fn pull(transport: &dyn GitTransport, work_dir: &str) -> Result<PushOutcome> {
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let branch = branch.trim();
    let _ = transport
        .run_git(&["fetch", "origin", branch], work_dir)
        .await;
    let remote_branch = format!("origin/{}", branch);
    let result = transport
        .run_git(&["merge", "--ff-only", &remote_branch], work_dir)
        .await;
    match result {
        Ok(_) => Ok(PushOutcome::Success {}),
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Pull with pre-approved credentials.
pub async fn pull_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let branch = branch.trim();
    exec_with_credentials(
        transport,
        work_dir,
        &["fetch", "origin", branch],
        username,
        password,
    )
    .await?;
    let remote_branch = format!("origin/{}", branch);
    let result = transport
        .run_git(&["merge", "--ff-only", &remote_branch], work_dir)
        .await;
    match result {
        Ok(_) => Ok(PushOutcome::Success {}),
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Commit staged changes: `git commit -m <message>`
pub async fn commit_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
    message: &str,
) -> Result<CommitResult> {
    if !file_paths.is_empty() {
        stage_files(transport, work_dir, file_paths).await?;
    }
    let output = transport
        .run_git(&["commit", "-m", message], work_dir)
        .await?;
    let hash = super::parsers::extract_commit_hash_from_output(&output);
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
    Ok(())
}

// ─── Branching ───────────────────────────────────────────────────────────────

/// Checkout a branch: `git checkout <branch_name>`
pub async fn checkout_branch(
    transport: &dyn GitTransport,
    work_dir: &str,
    branch_name: &str,
) -> Result<()> {
    transport
        .run_git(&["checkout", branch_name], work_dir)
        .await?;
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
    Ok(())
}

// ─── Worktree ────────────────────────────────────────────────────────────────

/// Remove a worktree: `git worktree remove --force <path>`
pub async fn remove_worktree(
    transport: &dyn GitTransport,
    work_dir: &str,
    worktree_path: &str,
) -> Result<()> {
    transport
        .run_git(&["worktree", "remove", "--force", worktree_path], work_dir)
        .await?;
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
        "--all".to_string(),
        "--topo-order".to_string(),
    ];
    if count > 0 {
        args.push(format!("-{}", count));
    }
    if let Some(s) = skip_str {
        args.push(s);
    }
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = transport.run_git(&str_args, work_dir).await?;
    Ok(super::parsers::parse_commit_log_output(&output))
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

    let status_map: std::collections::HashMap<String, String> = status_output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                Some((parts[1].to_string(), parts[0].to_string()))
            } else {
                None
            }
        })
        .collect();

    let files: Vec<CommitFileChange> = numstat
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let path = parts[2].to_string();
                let additions = parts[0].parse::<usize>().unwrap_or(0);
                let deletions = parts[1].parse::<usize>().unwrap_or(0);
                let status = status_map
                    .get(&path)
                    .cloned()
                    .unwrap_or_else(|| "M".to_string());
                Some(CommitFileChange {
                    path,
                    status,
                    additions,
                    deletions,
                })
            } else {
                None
            }
        })
        .collect();
    Ok(files)
}

/// Get file diff for a commit: `git diff <hash>^ <hash> -- <file>`
pub async fn get_commit_file_diff(
    transport: &dyn GitTransport,
    work_dir: &str,
    commit_hash: &str,
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
        args.push(super::parsers::full_diff_context_arg(file_bytes));
    }
    args.push(format!("{}^", commit_hash));
    args.push(commit_hash.to_string());
    args.push("--".to_string());
    args.push(file_path.to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = transport.run_git(&arg_refs, work_dir).await?;
    let mut result = super::parsers::parse_unified_diff(&output);
    if collapse {
        super::parsers::collapse_diff_context(&mut result.hunks, 12);
    }
    Ok(result)
}

/// Get ahead/behind counts: `git rev-list --left-right --count`
pub async fn get_ahead_behind(transport: &dyn GitTransport, work_dir: &str) -> Result<AheadBehind> {
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

/// Get diff for specific files against HEAD
pub async fn get_diff_for_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
    line_limit: usize,
) -> Result<String> {
    if file_paths.is_empty() {
        return Ok(String::new());
    }
    let mut args = vec!["diff", "HEAD", "--"];
    args.extend(file_paths.iter().map(|s| s.as_str()));
    let diff_text = transport.run_git(&args, work_dir).await?;
    let lines: Vec<&str> = diff_text.lines().collect();
    if lines.len() <= line_limit {
        Ok(diff_text)
    } else {
        let truncated: String = lines[..line_limit].join("\n");
        let stat_args = {
            let mut sa = vec!["diff", "HEAD", "--stat", "--"];
            sa.extend(file_paths.iter().map(|s| s.as_str()));
            sa
        };
        let stat = transport.run_git(&stat_args, work_dir).await?;
        Ok(format!(
            "{}\n\n[diff truncated at {} lines]\n\nFile change summary:\n{}",
            truncated,
            line_limit,
            stat.trim()
        ))
    }
}

/// Get staged diff: `git diff --cached`
pub async fn get_staged_diff(
    transport: &dyn GitTransport,
    work_dir: &str,
    line_limit: usize,
) -> Result<String> {
    let diff_text = transport.run_git(&["diff", "--cached"], work_dir).await?;
    if diff_text.trim().is_empty() {
        return Ok(String::new());
    }
    let lines: Vec<&str> = diff_text.lines().collect();
    if lines.len() <= line_limit {
        Ok(diff_text)
    } else {
        let truncated: String = lines[..line_limit].join("\n");
        let stat = transport
            .run_git(&["diff", "--cached", "--stat"], work_dir)
            .await?;
        Ok(format!(
            "{}\n\n[diff truncated at {} lines]\n\nFile change summary:\n{}",
            truncated,
            line_limit,
            stat.trim()
        ))
    }
}

// ─── Info operations (shell-based, works for all transports) ─────────────────

/// Get git info using shell commands. Falls back to shell even for local.
pub async fn get_git_info_shell(transport: &dyn GitTransport, work_dir: &str) -> Result<GitInfo> {
    let branch_info = get_git_branch_info_shell(transport, work_dir).await?;
    let changed_files = transport
        .run_git(&["status", "--porcelain"], work_dir)
        .await?;
    let is_clean = changed_files.trim().is_empty();
    let files = if is_clean {
        vec![]
    } else {
        parse_porcelain_status(&changed_files)
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

fn parse_worktree_list(output: &str) -> Vec<Worktree> {
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

fn parse_porcelain_status(output: &str) -> Vec<FileChange> {
    let mut files = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.len() < 3 {
            continue;
        }
        let (xy, rest) = line.split_at(2);
        let path = rest.trim();
        if path.is_empty() {
            continue;
        }
        let status = match xy.trim() {
            "??" => FileStatus::Untracked,
            "A " | "AM" | "A?" => FileStatus::Added,
            "M " | " M" | "MM" => FileStatus::Modified,
            "D " | " D" => FileStatus::Deleted,
            "R " | " R" => FileStatus::Renamed,
            _ => continue,
        };
        files.push(FileChange {
            path: std::path::PathBuf::from(path),
            status,
            additions: 0,
            deletions: 0,
        });
    }
    files
}

/// Get changed files for a worktree path (shell-based) with additions/deletions
async fn get_worktree_changed_files_shell(
    transport: &dyn GitTransport,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    let output = transport
        .run_git(&["status", "--porcelain"], worktree_path)
        .await?;
    let mut files = parse_porcelain_status(&output);

    // Enrich with additions/deletions from git diff --numstat
    if !files.is_empty() {
        let mut numstat: std::collections::HashMap<String, (usize, usize)> =
            std::collections::HashMap::new();

        // Unstaged changes
        if let Ok(unstaged) = transport
            .run_git(&["diff", "--numstat"], worktree_path)
            .await
        {
            for line in unstaged.lines() {
                if let Some((add, del, path)) = parse_numstat_line(line) {
                    let entry = numstat.entry(path).or_insert((0, 0));
                    entry.0 += add;
                    entry.1 += del;
                }
            }
        }

        // Staged changes
        if let Ok(staged) = transport
            .run_git(&["diff", "--cached", "--numstat"], worktree_path)
            .await
        {
            for line in staged.lines() {
                if let Some((add, del, path)) = parse_numstat_line(line) {
                    let entry = numstat.entry(path).or_insert((0, 0));
                    entry.0 += add;
                    entry.1 += del;
                }
            }
        }

        // Merge numstat counts into files
        for file in &mut files {
            let path_str = file.path.to_string_lossy().to_string();
            if let Some((add, del)) = numstat.get(&path_str) {
                file.additions = *add;
                file.deletions = *del;
            }
        }
    }

    Ok(files)
}

/// Get file diff for a worktree path (shell-based)
async fn get_file_diff_shell(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_path: &str,
    collapse: bool,
) -> Result<DiffResult> {
    let mut args = vec!["diff".to_string()];
    if collapse {
        args.push("-U3".to_string());
    } else {
        // 全量护栏：按文件字节数生成 -U 参数，防止 IPC JSON 超 2MB
        let file_bytes = tokio::fs::metadata(std::path::Path::new(work_dir).join(file_path))
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        args.push(super::parsers::full_diff_context_arg(file_bytes));
    }
    args.push("--".to_string());
    args.push(file_path.to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = transport.run_git(&arg_refs, work_dir).await?;
    let mut result = super::parsers::parse_unified_diff(&output);
    if result.hunks.is_empty() {
        let full_path = std::path::Path::new(work_dir).join(file_path);
        if full_path.exists() && full_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                let lines: Vec<DiffLine> = content
                    .lines()
                    .map(|line| DiffLine::Added(line.to_string()))
                    .collect();
                if !lines.is_empty() {
                    #[allow(clippy::cast_possible_truncation)]
                    result.hunks.push(DiffHunk {
                        old_start: 0,
                        old_lines: 0,
                        new_start: 1,
                        new_lines: lines.len() as u32,
                        lines,
                    });
                }
            }
        }
    }
    if collapse {
        super::parsers::collapse_diff_context(&mut result.hunks, 12);
    }
    Ok(result)
}

/// Get changed files diff stats (additions/deletions) for local
pub async fn get_changed_files_diff_stats_local(work_dir: &str) -> Result<Vec<FileDiffStats>> {
    let unstaged = collect_in_dir(
        &ExecTarget::Local,
        "git",
        &["diff", "--numstat"],
        Some(work_dir),
    )
    .await?;
    let staged = collect_in_dir(
        &ExecTarget::Local,
        "git",
        &["diff", "--cached", "--numstat"],
        Some(work_dir),
    )
    .await?;

    let mut stats: Vec<FileDiffStats> = Vec::new();
    let mut tracked_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in String::from_utf8_lossy(&unstaged.stdout).lines() {
        if let Some((add, del, path)) = super::parsers::parse_numstat_line(line) {
            tracked_paths.insert(path.clone());
            stats.push(FileDiffStats {
                path: std::path::PathBuf::from(&path),
                additions: add,
                deletions: del,
            });
        }
    }

    for line in String::from_utf8_lossy(&staged.stdout).lines() {
        if let Some((add, del, path)) = super::parsers::parse_numstat_line(line) {
            if let Some(existing) = stats.iter_mut().find(|s| s.path.to_string_lossy() == path) {
                existing.additions += add;
                existing.deletions += del;
            } else {
                tracked_paths.insert(path.clone());
                stats.push(FileDiffStats {
                    path: std::path::PathBuf::from(&path),
                    additions: add,
                    deletions: del,
                });
            }
        }
    }

    let untracked = collect_in_dir(
        &ExecTarget::Local,
        "git",
        &["ls-files", "--others", "--exclude-standard"],
        Some(work_dir),
    )
    .await?;
    for file_path in String::from_utf8_lossy(&untracked.stdout).lines() {
        let file_path = file_path.trim();
        if file_path.is_empty() || tracked_paths.contains(file_path) {
            continue;
        }
        let full_path = std::path::Path::new(work_dir).join(file_path);
        if !full_path.exists() || !full_path.is_file() {
            continue;
        }
        let line_count = std::fs::read_to_string(&full_path)
            .map(|c| c.lines().count())
            .unwrap_or(0);
        stats.push(FileDiffStats {
            path: std::path::PathBuf::from(file_path),
            additions: line_count,
            deletions: 0,
        });
    }

    Ok(stats)
}

// ── Optimized dispatch: git2 when available, shell fallback ────────────────

/// Get git info. Uses git2 for local transports, shell fallback otherwise.
pub async fn get_git_info(transport: &dyn GitTransport, work_dir: &str) -> Result<GitInfo> {
    if let Some(repo) = transport.open_repo(work_dir) {
        tokio::task::spawn_blocking(move || {
            let branch_info = super::local::get_git_branch_info_from_repo(&repo)?;
            let changed_files = super::local::get_changed_files_from_repo(&repo)?;
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
    if let Some(repo) = transport.open_repo(work_dir) {
        tokio::task::spawn_blocking(move || super::local::get_git_branch_info_from_repo(&repo))
            .await
            .map_err(|e| anyhow::anyhow!("git branch info task join error: {e}"))?
    } else {
        get_git_branch_info_shell(transport, work_dir).await
    }
}

/// Get changed files for a worktree path. Uses git2 for local transports,
/// shell fallback otherwise.
pub async fn get_worktree_changed_files(
    transport: &dyn GitTransport,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    if let Some(repo) = transport.open_repo(worktree_path) {
        tokio::task::spawn_blocking(move || super::local::get_changed_files_from_repo(&repo))
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
    let output = transport
        .run_git(&["status", "--porcelain", "--ignored"], worktree_path)
        .await?;
    Ok(parse_ignored_porcelain(&output))
}

/// Parse `git status --porcelain --ignored` output into relative paths.
/// Ignored entries are prefixed with `!! `; directories end with a trailing `/`.
fn parse_ignored_porcelain(output: &str) -> Vec<String> {
    output
        .lines()
        .filter(|line| line.starts_with("!! "))
        .map(|line| line[3..].trim_end_matches('/').to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Get changed files diff stats (additions/deletions).
/// Uses git2 for local transports, local shell fallback otherwise.
pub async fn get_changed_files_diff_stats(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<Vec<FileDiffStats>> {
    if transport.open_repo(work_dir).is_some() {
        let work_dir_owned = work_dir.to_string();
        tokio::task::spawn_blocking(move || {
            super::local::get_changed_files_diff_stats(std::path::Path::new(&work_dir_owned))
        })
        .await
        .map_err(|e| anyhow::anyhow!("git diff stats task join error: {e}"))?
    } else {
        get_changed_files_diff_stats_local(work_dir).await
    }
}

/// Get file diff for a worktree path. Uses git2 for local transports,
/// shell fallback otherwise.
pub async fn get_file_diff(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_path: &str,
    collapse: bool,
) -> Result<DiffResult> {
    if let Some(_repo) = transport.open_repo(work_dir) {
        let work_dir_owned = work_dir.to_string();
        let file_path_owned = file_path.to_string();
        tokio::task::spawn_blocking(move || {
            super::local::get_file_diff(
                std::path::Path::new(&work_dir_owned),
                &file_path_owned,
                collapse,
            )
        })
        .await
        .map_err(|e| anyhow::anyhow!("git file diff task join error: {e}"))?
    } else {
        get_file_diff_shell(transport, work_dir, file_path, collapse).await
    }
}

/// Get recent commit messages
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

// ── HTTPS credential helpers (AC1-AC6) ──────────────────────────────────────

/// 构造 push 参数列表（带 --set-upstream 时附加 origin branch）。返回 String 避免生命周期问题。
async fn push_args(
    transport: &dyn GitTransport,
    work_dir: &str,
    set_upstream: bool,
) -> Vec<String> {
    if set_upstream {
        if let Some(branch) = get_current_branch_opt(transport, work_dir).await {
            vec![
                "push".to_string(),
                "--set-upstream".to_string(),
                "origin".to_string(),
                branch,
            ]
        } else {
            vec!["push".to_string(), "--set-upstream".to_string()]
        }
    } else {
        vec!["push".to_string()]
    }
}

/// 跑一条 git 命令并在鉴权失败时返回 AuthRequired（approve 后重试用）。
async fn exec_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    args: &[&str],
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    let remote_url = get_remote_url(transport, work_dir)
        .await
        .unwrap_or_else(|_| "unknown".to_string());
    let helper = resolve_credential_helper(transport, work_dir).await?;
    // 如果 remote_url 不是合法 URL（如 "unknown"），跳过 credential 流程直接执行
    if remote_url == "unknown" || !remote_url.contains("://") {
        let result = transport.run_git(args, work_dir).await;
        return match result {
            Ok(_) => Ok(PushOutcome::Success {}),
            Err(e) => classify_git_error(transport, work_dir, e).await,
        };
    }
    let cred = match Credential::from_url(&remote_url, Some(username)) {
        Ok(c) => c,
        Err(_) => {
            // URL 格式无法解析，跳过 credential 流程
            let result = transport.run_git(args, work_dir).await;
            return match result {
                Ok(_) => Ok(PushOutcome::Success {}),
                Err(e) => classify_git_error(transport, work_dir, e).await,
            };
        }
    };
    let _ = credential_approve(transport, work_dir, &helper, &cred, username, password).await;
    let result = transport.run_git(args, work_dir).await;
    match result {
        Ok(_) => Ok(PushOutcome::Success {}),
        Err(e) => {
            let classified = classify_git_error(transport, work_dir, e).await?;
            if let PushOutcome::AuthRequired { ssh: false, .. } = classified {
                let _ = credential_reject(transport, work_dir, &helper, &cred, username).await;
                Ok(PushOutcome::AuthRequired {
                    remote_url,
                    username_hint: Some(username.to_string()),
                    ssh: false,
                })
            } else {
                Ok(classified)
            }
        }
    }
}

/// 从 GitExecError 分类为 PushOutcome（Auth / AuthSsh → AuthRequired；其他 bail）。
/// 异步版本，直接 await remote URL 获取，避免嵌套 tokio Runtime。
async fn classify_git_error(
    transport: &dyn GitTransport,
    work_dir: &str,
    err: anyhow::Error,
) -> Result<PushOutcome> {
    let kind = err
        .chain()
        .find_map(|c| c.downcast_ref::<GitExecError>())
        .map(|e| e.kind)
        .unwrap_or(ErrorKind::Other);
    let remote_url = get_remote_url(transport, work_dir)
        .await
        .unwrap_or_else(|_| "unknown".to_string());
    let username_hint = extract_username_hint(&remote_url);
    let is_ssh_url = remote_url.starts_with("git@") || remote_url.starts_with("ssh://");
    match kind {
        ErrorKind::Auth => Ok(PushOutcome::AuthRequired {
            remote_url,
            username_hint,
            ssh: false,
        }),
        ErrorKind::AuthSsh => Ok(PushOutcome::AuthRequired {
            remote_url,
            username_hint,
            ssh: true,
        }),
        ErrorKind::Network => {
            bail!("Network error (check connectivity): {}", err);
        }
        ErrorKind::Ambiguous => Ok(PushOutcome::AuthRequired {
            remote_url,
            username_hint,
            ssh: is_ssh_url,
        }),
        ErrorKind::NoUpstream => {
            bail!("The current branch has no upstream branch. Push with `--set-upstream` or use the 'Push with upstream' option.");
        }
        ErrorKind::Other => {
            bail!("git operation failed: {}", err);
        }
    }
}

/// 获取 origin remote URL。
async fn get_remote_url(transport: &dyn GitTransport, work_dir: &str) -> Result<String> {
    transport
        .run_git(&["remote", "get-url", "origin"], work_dir)
        .await
        .map(|s| s.trim().to_string())
}

/// 获取当前分支名（Option 版，失败返回 None）。
async fn get_current_branch_opt(transport: &dyn GitTransport, work_dir: &str) -> Option<String> {
    transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|b| b != "HEAD")
}

/// 从 https://user@host/path 中提取 user。
fn extract_username_hint(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    rest.split_once('@').map(|(user, _)| user.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::executor::factory::ExecTarget;
    use crate::common::git::transport::{GitExecOptions, GitTransport};
    use async_trait::async_trait;
    use tempfile::tempdir;

    /// 在测试中执行本地 git 命令（async，走统一接口）。
    async fn git_local(path: &str, args: &[&str]) -> crate::common::executor::ExecOutput {
        collect_in_dir(&ExecTarget::Local, "git", args, Some(path))
            .await
            .expect("run git command")
    }

    /// 初始化一个含单个提交的临时 git 仓库，返回 (TempDir, 路径)。
    async fn init_repo() -> (tempfile::TempDir, String) {
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().to_string_lossy().to_string();
        let commands: Vec<Vec<&str>> = vec![
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
            // Windows 上 git 默认 autocrlf=true 会把检出内容转成 CRLF,
            // 导致 discard 恢复后内容与写入的 `base\n` 不一致;关闭以保证跨平台一致。
            vec!["config", "core.autocrlf", "false"],
        ];
        for cmd in &commands {
            let out = git_local(&path, cmd).await;
            assert!(
                out.exit_code == 0,
                "git {:?} failed: {}",
                cmd,
                String::from_utf8_lossy(&out.stderr)
            );
        }
        std::fs::write(dir.path().join("base.txt"), "base\n").expect("write base");
        let out = git_local(&path, &["add", "-A"]).await;
        assert!(out.exit_code == 0, "git add failed");
        let out = git_local(&path, &["commit", "-qm", "init"]).await;
        assert!(out.exit_code == 0, "git commit failed");
        (dir, path)
    }

    #[tokio::test]
    async fn discard_file_should_delete_untracked_file() {
        // 未跟踪文件（git status ??）：`git checkout -- <file>` 会报 pathspec 错误，
        // discard 应改为删除文件，而不是失败。
        let (dir, path) = init_repo().await;
        std::fs::write(dir.path().join("test_structure.html"), "new\n").expect("write untracked");

        let transport = ExecTarget::Local;
        discard_file(&transport, &path, "test_structure.html")
            .await
            .expect("discard untracked file should not fail");

        assert!(
            !dir.path().join("test_structure.html").exists(),
            "untracked file should be deleted"
        );
    }

    #[tokio::test]
    async fn discard_file_should_restore_modified_tracked_file() {
        // 已跟踪文件的工作区修改：应恢复到 HEAD 版本。
        let (dir, path) = init_repo().await;
        std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify tracked");

        let transport = ExecTarget::Local;
        discard_file(&transport, &path, "base.txt")
            .await
            .expect("discard tracked file should succeed");

        let content = std::fs::read_to_string(dir.path().join("base.txt")).expect("read base");
        assert_eq!(content, "base\n", "tracked file should be restored");
    }

    #[tokio::test]
    async fn discard_file_should_unstage_and_restore_staged_file() {
        // 已暂存（index 变更）：应撤销暂存并恢复工作区。
        let (dir, path) = init_repo().await;
        std::fs::write(dir.path().join("base.txt"), "staged\n").expect("modify tracked");
        let out = git_local(&path, &["add", "base.txt"]).await;
        assert!(out.exit_code == 0, "git add failed");

        let transport = ExecTarget::Local;
        discard_file(&transport, &path, "base.txt")
            .await
            .expect("discard staged file should succeed");

        let content = std::fs::read_to_string(dir.path().join("base.txt")).expect("read base");
        assert_eq!(content, "base\n", "staged file should be restored");
    }

    /// 脚本化 mock transport：status 返回已暂存修改，reset 返回真实错误（非 unknown revision）。
    struct ResetErrorTransport;

    #[async_trait]
    impl GitTransport for ResetErrorTransport {
        async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
            self.run_git_opts(args, work_dir, GitExecOptions::default())
                .await
        }

        async fn run_git_opts(
            &self,
            args: &[&str],
            _work_dir: &str,
            _opts: GitExecOptions<'_>,
        ) -> Result<String> {
            match args.first() {
                Some(&"status") => Ok("M  base.txt\0".to_string()),
                Some(&"reset") => Err(GitExecError {
                    kind: ErrorKind::Other,
                    stderr: "fatal: unable to reset".to_string(),
                    stdout: String::new(),
                    command: "git reset HEAD -- base.txt".to_string(),
                }
                .into()),
                _ => Ok(String::new()),
            }
        }

        async fn run_git_with_stdin(
            &self,
            _args: &[&str],
            _work_dir: &str,
            _opts: GitExecOptions<'_>,
            _stdin: &[u8],
        ) -> Result<String> {
            unimplemented!()
        }

        fn open_repo(&self, _path: &str) -> Option<git2::Repository> {
            None
        }

        async fn is_git_repo(&self, _path: &str) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn discard_file_should_delete_staged_add_in_repo_without_head() {
        // 新仓库无 HEAD：staged 新增（A）→ reset 报 unknown revision → rm --cached + clean 删除
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().to_string_lossy().to_string();
        let out = git_local(&path, &["init", "-q"]).await;
        assert!(out.exit_code == 0, "git init failed");
        std::fs::write(dir.path().join("new.txt"), "new\n").expect("write new file");
        let out = git_local(&path, &["add", "new.txt"]).await;
        assert!(out.exit_code == 0, "git add failed");

        let transport = ExecTarget::Local;
        discard_file(&transport, &path, "new.txt")
            .await
            .expect("discard staged add in no-HEAD repo should succeed");

        assert!(
            !dir.path().join("new.txt").exists(),
            "staged add should be deleted in no-HEAD repo"
        );
    }

    #[tokio::test]
    async fn discard_file_should_propagate_real_reset_error() {
        // reset 返回真实错误（stderr 非 unknown revision / ambiguous）→ 错误应传播而非静默吞掉
        let transport = ResetErrorTransport;
        let result = discard_file(&transport, "/tmp", "base.txt").await;
        assert!(result.is_err(), "real reset error should propagate");
    }

    #[test]
    fn parse_ignored_porcelain_extracts_ignored_paths() {
        // `!! ` 前缀为忽略项；目录带尾斜杠；普通 porcelain 行应被过滤
        let output = "!! .env\n!! dist/\n M src/main.rs\n?? new.txt\n";
        let paths = parse_ignored_porcelain(output);
        assert_eq!(paths, vec![".env", "dist"]);
    }

    #[test]
    fn parse_ignored_porcelain_handles_edge_cases() {
        assert!(parse_ignored_porcelain("").is_empty());
        assert!(parse_ignored_porcelain(" M src/main.rs\n").is_empty());
        assert_eq!(
            parse_ignored_porcelain("!! node_modules/\n"),
            vec!["node_modules"]
        );
    }

    // ── collapse 参数：false 时跳过上下文折叠、返回完整上下文 ────────────────

    /// 脚本化 mock transport：返回带长连续 context 的 diff 文本。
    struct DiffTextTransport {
        output: String,
        captured_args: std::sync::Mutex<Vec<String>>,
    }

    impl DiffTextTransport {
        fn new(output: String) -> Self {
            Self {
                output,
                captured_args: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn last_args(&self) -> Vec<String> {
            self.captured_args.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl GitTransport for DiffTextTransport {
        async fn run_git(&self, args: &[&str], _work_dir: &str) -> Result<String> {
            self.captured_args.lock().unwrap().push(
                args.iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            Ok(self.output.clone())
        }

        async fn run_git_opts(
            &self,
            _args: &[&str],
            _work_dir: &str,
            _opts: GitExecOptions<'_>,
        ) -> Result<String> {
            Ok(self.output.clone())
        }

        async fn run_git_with_stdin(
            &self,
            _args: &[&str],
            _work_dir: &str,
            _opts: GitExecOptions<'_>,
            _stdin: &[u8],
        ) -> Result<String> {
            unimplemented!()
        }

        fn open_repo(&self, _path: &str) -> Option<git2::Repository> {
            None
        }

        async fn is_git_repo(&self, _path: &str) -> bool {
            true
        }
    }

    /// 构造一段含 20 行连续 context 的 diff 文本（超过 collapse 阈值 12）。
    fn long_context_diff() -> String {
        let mut out = String::from("diff --git a/a.txt b/a.txt\n@@ -1,25 +1,26 @@\n");
        for i in 1..=20 {
            out.push_str(&format!(" context{i}\n"));
        }
        out.push_str("-old\n+new\n");
        for i in 21..=25 {
            out.push_str(&format!(" context{i}\n"));
        }
        out
    }

    #[tokio::test]
    async fn get_commit_file_diff_collapse_true_keeps_markers() {
        let transport = DiffTextTransport::new(long_context_diff());
        let result = get_commit_file_diff(&transport, "/tmp", "abc123", "a.txt", true)
            .await
            .expect("parse diff");
        let has_collapsed = result
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| matches!(l, DiffLine::Collapsed(_)));
        assert!(has_collapsed, "collapse=true should keep Collapsed markers");
        // 20 行连续 context → 前 3 保留 + 1 折叠标记 + 后 3 保留；随后变更行；
        // 尾部 5 行 context 未达阈值 12 全部保留 → 3+1+3+1+1+5 = 14
        let kept: Vec<&DiffLine> = result.hunks[0].lines.iter().collect();
        assert_eq!(
            kept.len(),
            14,
            "3 kept + collapsed + 3 kept + removed + added + 5 tail"
        );
        // collapse=true 不传 -U 全量参数
        assert!(
            !transport.last_args()[0].contains("-U100000"),
            "collapse=true should not pass -U100000"
        );
    }

    #[tokio::test]
    async fn get_commit_file_diff_collapse_false_expands_full_context() {
        let transport = DiffTextTransport::new(long_context_diff());
        let result = get_commit_file_diff(&transport, "/tmp", "abc123", "a.txt", false)
            .await
            .expect("parse diff");
        let has_collapsed = result
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| matches!(l, DiffLine::Collapsed(_)));
        assert!(
            !has_collapsed,
            "collapse=false should drop Collapsed markers"
        );
        let context_count = result.hunks[0]
            .lines
            .iter()
            .filter(|l| matches!(l, DiffLine::Context(_)))
            .count();
        assert_eq!(context_count, 25, "all 25 context lines should be kept");
        assert!(
            transport.last_args()[0].contains("-U100000"),
            "collapse=false should pass -U100000, got: {}",
            transport.last_args()[0]
        );
    }

    #[tokio::test]
    async fn get_file_diff_shell_collapse_false_passes_full_context_arg() {
        let transport = DiffTextTransport::new(long_context_diff());
        // shell 路径（open_repo=None）不会走 git2，直接使用 shell 实现
        let _ = get_file_diff(&transport, "/tmp", "a.txt", false)
            .await
            .expect("parse diff");
        let args = transport.last_args();
        assert!(
            args[0].contains("-U100000"),
            "collapse=false should pass -U100000, got: {}",
            args[0]
        );
        let collapsed = get_file_diff(&transport, "/tmp", "a.txt", true)
            .await
            .expect("parse diff");
        assert!(
            collapsed
                .hunks
                .iter()
                .flat_map(|h| &h.lines)
                .any(|l| matches!(l, DiffLine::Collapsed(_))),
            "collapse=true should keep markers in shell path"
        );
    }
}
