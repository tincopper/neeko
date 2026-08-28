//! High-level git operations (push, pull, clone, etc.) using the transport abstraction.

use anyhow::{bail, Result};

use super::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use super::transport::{ErrorKind, GitExecError, GitTransport};
use super::types::PushOutcome;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::parsers::{parse_numstat_line, parse_status_line};
use crate::common::git::provider::detect_provider;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect_in_dir;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, GitBranchInfo, GitInfo, GitProvider, StashActionResult, StashEntry, Worktree,
};
/// 只读 git 查询的执行环境（公理2：查询无副作用）。
///
/// `GIT_OPTIONAL_LOCKS=0` 是 git 官方的「跳过全部可选锁」开关：`git status` /
/// `git diff` / `git diff --numstat` 等只读命令默认会 stat-refresh 并改写
/// `.git/index`，index 写入又会触发 `.git` 元数据 watcher 事件，与「事件 →
/// 再查询 → 再写 index」形成自反馈回路（2026-08-26 实测 18.9G/2.5min 内存
/// 暴涨根因）。该环境变量对**所有** git 命令生效（包括不支持
/// `--no-optional-locks` 参数的 `git diff`），且对 WSL/SSH transport 同样透传。
/// 只读查询统一走 `run_git_opts(..., readonly_opts())`；写操作（add/commit/
/// checkout 等）不传。
const READONLY_ENV: &[(&str, &str)] = &[("GIT_OPTIONAL_LOCKS", "0")];

/// 构造只读查询的 [`GitExecOptions`]（env 为静态切片，可安全跨 await 借用）。
const fn readonly_opts() -> super::transport::GitExecOptions<'static> {
    super::transport::GitExecOptions {
        env: READONLY_ENV,
        extra_config: &[],
    }
}

/// 写操作成功后失效该仓库的全部内存缓存（AGENTS.md：缓存失效不得散落调用点
/// 遗漏 —— 曾因 local.rs 写函数收缩后无人失效，Local 项目 diff 统计永久陈旧）。
fn invalidate_caches(work_dir: &str) {
    super::cache::invalidate_repo_caches(std::path::Path::new(work_dir));
}

/// 解析 worktree_path：空字符串视为「未指定 worktree」，回落项目根目录。
///
/// 与 `get_worktree_changed_files`/`get_ignored_files` 的空串处理保持一致。
/// 前端在无激活 worktree 时会传空字符串（`activeWorktreePath ?? ''`），若把 `''`
/// 当作字面路径，`git2::Repository::open("")` 失败后会落入 shell 回退，在 app 启动
/// CWD 执行 git，用错误仓库的数据污染真实项目的 git 信息。
#[must_use]
pub fn resolve_worktree_path<'a>(worktree_path: &'a Option<String>, wd: &'a str) -> &'a str {
    match worktree_path.as_deref() {
        Some(p) if !p.trim().is_empty() => p,
        _ => wd,
    }
}

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

/// Fetch from all remotes: `git fetch --all`
pub async fn fetch(transport: &dyn GitTransport, work_dir: &str) -> Result<PushOutcome> {
    let result = transport.run_git(&["fetch", "--all"], work_dir).await;
    match result {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
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
    exec_with_credentials(transport, work_dir, &["fetch", "--all"], username, password).await?;
    invalidate_caches(work_dir);
    Ok(PushOutcome::Success {})
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
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
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
    exec_with_credentials(transport, work_dir, &args, username, password).await?;
    invalidate_caches(work_dir);
    Ok(PushOutcome::Success {})
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
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
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
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
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
    invalidate_caches(work_dir);
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

    Ok(super::parsers::parse_numstat_with_status(
        &numstat,
        &status_output,
    ))
}

/// List stashes: `git stash list --format=%gd%x00%gs%x00%H%x00%aI%x00`
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
    Ok(super::parsers::parse_stash_list(&output))
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
    Ok(super::parsers::parse_numstat_with_status(
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
fn stash_action_result(err: anyhow::Error) -> Result<StashActionResult> {
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
fn stash_conflict_message_from_stdout(stdout: &str) -> String {
    stdout
        .lines()
        .find(|l| l.contains("CONFLICT"))
        .unwrap_or_else(|| stdout.trim())
        .to_string()
}

/// Get file diff for a commit: `git diff <hash>^ <hash> -- <file>`
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
async fn get_revision_file_diff(
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
        args.push(super::parsers::full_diff_context_arg(file_bytes));
    }
    args.push(format!("{}^", revision));
    args.push(revision.to_string());
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
    super::local::assert_git_repo(std::path::Path::new(work_dir))?;
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
    // 只读查询：GIT_OPTIONAL_LOCKS=0 防止 stat-refresh 写 .git/index（自反馈回路公理2）
    let diff_text = transport
        .run_git_opts(&["diff", "--cached"], work_dir, readonly_opts())
        .await?;
    let lines: Vec<&str> = diff_text.lines().collect();
    if lines.len() <= line_limit {
        Ok(diff_text)
    } else {
        let truncated: String = lines[..line_limit].join("\n");
        let stat = transport
            .run_git_opts(&["diff", "--cached", "--stat"], work_dir, readonly_opts())
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

/// Get changed files for a worktree path (shell-based) with additions/deletions
async fn get_worktree_changed_files_shell(
    transport: &dyn GitTransport,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    let output = transport
        .run_git_opts(&["status", "--porcelain"], worktree_path, readonly_opts())
        .await?;
    let mut files: Vec<FileChange> = output.lines().filter_map(parse_status_line).collect();

    // Enrich with additions/deletions from git diff --numstat
    if !files.is_empty() {
        let mut numstat: std::collections::HashMap<String, (usize, usize)> =
            std::collections::HashMap::new();

        // Unstaged changes
        if let Ok(unstaged) = transport
            .run_git_opts(&["diff", "--numstat"], worktree_path, readonly_opts())
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
            .run_git_opts(
                &["diff", "--cached", "--numstat"],
                worktree_path,
                readonly_opts(),
            )
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
    let output = transport
        .run_git_opts(&arg_refs, work_dir, readonly_opts())
        .await?;
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
    super::local::assert_git_repo(std::path::Path::new(work_dir))?;
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
    super::local::assert_git_repo(std::path::Path::new(work_dir))?;
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
    super::local::assert_git_repo(std::path::Path::new(worktree_path))?;
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
    const MAX_IGNORED_FILES: usize = 500;
    let output = transport
        .run_git_opts(
            &["status", "--porcelain", "--ignored"],
            worktree_path,
            readonly_opts(),
        )
        .await?;
    let mut entries = parse_ignored_porcelain(&output);
    if entries.len() > MAX_IGNORED_FILES {
        // 与 get_untracked_files 截断惯例一致：超限必须留痕，避免静默丢数据
        log::warn!(
            "get_ignored_files({}) exceeded cap: {} entries truncated to {}",
            worktree_path,
            entries.len(),
            MAX_IGNORED_FILES
        );
        entries.truncate(MAX_IGNORED_FILES);
    }
    Ok(entries)
}

/// List untracked files under `dir_path`, expanding a collapsed untracked-dir
/// entry from `get_worktree_changed_files` (changes list shows `dir/` as a single
/// row; the UI expands it on demand). `git ls-files --others --exclude-standard`
/// respects .gitignore and works for all transports; result is capped to guard
/// IPC size on huge untracked directories (公理：随输入规模增长的结构必须有界).
pub async fn get_untracked_files(
    transport: &dyn GitTransport,
    worktree_path: &str,
    dir_path: &str,
) -> Result<Vec<String>> {
    const MAX_UNTRACKED_FILES: usize = 500;
    let dir = dir_path.trim_end_matches('/');
    if dir.is_empty() {
        return Ok(Vec::new());
    }
    let output = transport
        .run_git_opts(
            &["ls-files", "--others", "--exclude-standard", "--", dir],
            worktree_path,
            readonly_opts(),
        )
        .await?;
    let mut entries: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    if entries.len() > MAX_UNTRACKED_FILES {
        // 与 local.rs MAX_CHANGED_FILES 截断惯例一致：超限必须留痕，避免静默丢数据
        log::warn!(
            "get_untracked_files({}) exceeded cap: {} entries truncated to {}",
            dir,
            entries.len(),
            MAX_UNTRACKED_FILES
        );
        entries.truncate(MAX_UNTRACKED_FILES);
    }
    Ok(entries)
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

    // ── resolve_worktree_path ─────────────────────────────────────────────

    #[test]
    fn resolve_worktree_path_none_falls_back_to_project_root() {
        let wd = "/repo/main".to_string();
        assert_eq!(resolve_worktree_path(&None, &wd), "/repo/main");
    }

    #[test]
    fn resolve_worktree_path_empty_string_falls_back_to_project_root() {
        // 回归：前端 git-changed 在无激活 worktree 时传空字符串，
        // 不能把 "" 当字面路径，否则 shell 回退会在 app 启动 CWD 跑 git。
        let wd = "/repo/main".to_string();
        assert_eq!(
            resolve_worktree_path(&Some(String::new()), &wd),
            "/repo/main"
        );
        assert_eq!(
            resolve_worktree_path(&Some("   ".to_string()), &wd),
            "/repo/main"
        );
    }

    #[test]
    fn resolve_worktree_path_uses_worktree_path_when_provided() {
        let wd = "/repo/main".to_string();
        let wt = Some("/repo/wt".to_string());
        assert_eq!(resolve_worktree_path(&wt, &wd), "/repo/wt");
    }
    use async_trait::async_trait;
    use tempfile::tempdir;

    /// 在测试中执行本地 git 命令（async，走统一接口）。
    async fn git_local(path: &str, args: &[&str]) -> crate::common::executor::ExecOutput {
        collect_in_dir(&ExecTarget::Local, "git", args, Some(path))
            .await
            .expect("run git command")
    }

    /// 行尾无关地断言工作区文件内容（git smudge 可能把 LF 转成平台 CRLF，
    /// 工作区字节是不透明平台数据，禁止字节级精确断言）。
    fn assert_worktree_eq(dir: &std::path::Path, rel: &str, expected: &str) {
        let content = std::fs::read_to_string(dir.join(rel)).expect("read worktree file");
        assert_eq!(
            content.replace("\r\n", "\n"),
            expected,
            "worktree content mismatch: {rel}"
        );
    }

    /// 初始化一个含单个提交的临时 git 仓库，返回 (TempDir, 路径)。
    async fn init_repo() -> (tempfile::TempDir, String) {
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().to_string_lossy().to_string();
        let commands: Vec<Vec<&str>> = vec![
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
            // 换行语义钉死（与 tests/unit/support.rs 的 TestRepo 同一套双保险）：
            // Windows 上 git 默认 autocrlf=true 会把检出内容转成 CRLF，
            // 导致 discard 恢复后内容与写入的 `base\n` 不一致。
            // 仓库级 autocrlf=false + `.gitattributes * -text` 保证跨平台一致。
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
        std::fs::write(dir.path().join(".gitattributes"), "* -text\n")
            .expect("write .gitattributes");
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

        assert_worktree_eq(dir.path(), "base.txt", "base\n");
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

        assert_worktree_eq(dir.path(), "base.txt", "base\n");
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

    /// 脚本化 mock transport：open_repo=None 强制走 shell 分支；run_git 返回空 diff，
    /// 使 `get_file_diff_shell` 的 fallback 读工作区字节。
    struct NoHunkShellTransport;

    #[async_trait]
    impl GitTransport for NoHunkShellTransport {
        async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
            self.run_git_opts(args, work_dir, GitExecOptions::default())
                .await
        }

        async fn run_git_opts(
            &self,
            _args: &[&str],
            _work_dir: &str,
            _opts: GitExecOptions<'_>,
        ) -> Result<String> {
            Ok(String::new())
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
    async fn file_diff_shell_fallback_crlf_file_strips_carriage_returns() {
        // L4 换行边界（shell 分支）：WSL/SSH transport 无 git2 repo（open_repo=None），
        // 走 `get_file_diff_shell` 的 fallback 读工作区字节构建 Added 行。
        // 必须用 `.lines()` 等 CRLF 兼容解析，禁止把 `\r` 泄漏进 diff 视图。
        let (dir, path) = init_repo().await;
        std::fs::write(dir.path().join("crlf.txt"), "line1\r\nline2\r\n").expect("write crlf file");

        let result = get_file_diff(&NoHunkShellTransport, &path, "crlf.txt", false)
            .await
            .expect("shell fallback diff on CRLF file should succeed");

        let added: Vec<&str> = result
            .hunks
            .iter()
            .flat_map(|h| h.lines.iter())
            .filter_map(|l| match l {
                DiffLine::Added(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(added, vec!["line1", "line2"], "CRLF 行尾不应泄漏 \\r");
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

    /// 脚本化 mock transport：返回带长连续 context 的 diff 文本，并捕获
    /// args 与 opts.env（供只读查询契约断言）。
    struct DiffTextTransport {
        output: String,
        captured_args: std::sync::Mutex<Vec<String>>,
        captured_env: std::sync::Mutex<Vec<(String, String)>>,
    }

    impl DiffTextTransport {
        fn new(output: String) -> Self {
            Self {
                output,
                captured_args: std::sync::Mutex::new(Vec::new()),
                captured_env: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn last_args(&self) -> Vec<String> {
            self.captured_args.lock().unwrap().clone()
        }

        fn last_env(&self) -> Vec<(String, String)> {
            self.captured_env.lock().unwrap().clone()
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
            args: &[&str],
            _work_dir: &str,
            opts: GitExecOptions<'_>,
        ) -> Result<String> {
            self.captured_args.lock().unwrap().push(
                args.iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            self.captured_env.lock().unwrap().push(
                opts.env
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            );
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

    // ── 公理2契约：只读查询必须携带 GIT_OPTIONAL_LOCKS=0（不写 .git/index）──

    /// 高频只读查询（changed_files / ignored_files / file_diff / staged_diff）
    /// 必须经 `readonly_opts()` 注入 `GIT_OPTIONAL_LOCKS=0`——缺 env 时 git
    /// 可能 stat-refresh 写 index，与 .git 元数据 watcher 形成自反馈回路。
    #[tokio::test]
    async fn readonly_queries_inject_git_optional_locks() {
        let transport = DiffTextTransport::new(long_context_diff());

        let _ = get_worktree_changed_files(&transport, "/tmp").await;
        let _ = get_ignored_files(&transport, "/tmp").await;
        let _ = get_file_diff(&transport, "/tmp", "a.txt", true).await;
        let _ = get_staged_diff(&transport, "/tmp", 100).await;

        let envs = transport.last_env();
        assert!(!envs.is_empty(), "只读查询必须携带 env");
        for env in envs {
            assert_eq!(
                env,
                ("GIT_OPTIONAL_LOCKS".to_string(), "0".to_string()),
                "只读查询必须注入 GIT_OPTIONAL_LOCKS=0（公理2：查询无副作用）"
            );
        }
    }

    // ── shell 路径（WSL/SSH transport）collapse 契约 ──────────────────────

    /// `get_file_diff_shell`（open_repo=None → shell 实现）的 collapse 参数映射：
    /// collapse=false → 全量 `-U100000` 上下文参数、不产生 Collapsed 标记；
    /// collapse=true → `-U3` 并将超阈 context 折叠为 Collapsed 标记。
    /// 该契约随旧测试被 env 契约测试替换而丢失，这里补回（P2）。
    #[tokio::test]
    async fn get_file_diff_shell_collapse_contract() {
        let transport = DiffTextTransport::new(long_context_diff());

        // collapse=false：全量上下文参数 + 无折叠标记
        let expanded = get_file_diff(&transport, "/tmp", "a.txt", false)
            .await
            .expect("parse expanded diff");
        let args = transport.last_args();
        assert!(
            args.last().unwrap().contains("-U100000"),
            "collapse=false should pass -U100000, got: {:?}",
            args.last()
        );
        assert!(
            !expanded
                .hunks
                .iter()
                .flat_map(|h| &h.lines)
                .any(|l| matches!(l, DiffLine::Collapsed(_))),
            "collapse=false should not produce Collapsed markers"
        );

        // collapse=true：-U3 + Collapsed 标记
        let collapsed = get_file_diff(&transport, "/tmp", "a.txt", true)
            .await
            .expect("parse collapsed diff");
        let args = transport.last_args();
        assert!(
            args.last().unwrap().contains("-U3"),
            "collapse=true should pass -U3, got: {:?}",
            args.last()
        );
        assert!(
            collapsed
                .hunks
                .iter()
                .flat_map(|h| &h.lines)
                .any(|l| matches!(l, DiffLine::Collapsed(_))),
            "collapse=true should keep Collapsed markers"
        );
    }

    // ── stash apply/pop 错误分流（P3） ────────────────────────────────────

    fn git_exec_err(kind: ErrorKind, stderr: &str) -> anyhow::Error {
        git_exec_err_full(kind, stderr, "")
    }

    fn git_exec_err_full(kind: ErrorKind, stderr: &str, stdout: &str) -> anyhow::Error {
        GitExecError {
            kind,
            stderr: stderr.to_string(),
            stdout: stdout.to_string(),
            command: "git stash apply stash@{0}".to_string(),
        }
        .into()
    }

    #[test]
    fn stash_action_conflict_on_stderr_returns_success_false() {
        // 本地改动冲突：stderr 携带 "would be overwritten by merge"（classify_stderr → Other）
        let result = stash_action_result(git_exec_err(
            ErrorKind::Other,
            "error: Your local changes to the following files would be overwritten by merge:\n\tf.txt\nAborting",
        ))
        .expect("local-change conflict should be reported as success:false");
        assert!(!result.success, "conflict must not be reported as success");
        assert!(
            result.message.contains("would be overwritten by merge"),
            "stderr should be surfaced, got: {}",
            result.message
        );
    }

    #[test]
    fn stash_action_conflict_on_stdout_extracts_conflict_line() {
        // 真实 3-way 冲突：git 把 "CONFLICT (content): ..." 写到 stdout，stderr 为空
        let result = stash_action_result(git_exec_err_full(
            ErrorKind::Other,
            "",
            "Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\nOn branch main",
        ))
        .expect("stdout conflict should be reported as success:false");
        assert!(!result.success);
        assert_eq!(
            result.message, "CONFLICT (content): Merge conflict in f.txt",
            "stdout conflict line should be extracted, got: {}",
            result.message
        );
    }

    #[test]
    fn stash_action_invalid_selector_is_operation_failure() {
        // 无效 selector（stderr 无 CONFLICT 关键字，仍属操作级）
        let result = stash_action_result(git_exec_err(
            ErrorKind::Other,
            "fatal: log for 'stash' only has 1 entries",
        ))
        .expect("invalid selector should be reported as success:false");
        assert!(!result.success);
        assert!(result.message.contains("only has 1 entries"));
    }

    #[test]
    fn stash_action_unrecognized_other_propagates() {
        // 收紧：未命中操作级 marker 的 Other（如 config 损坏）不再伪装成 success:false
        let err = git_exec_err(ErrorKind::Other, "fatal: bad config file line 1");
        assert!(
            stash_action_result(err).is_err(),
            "unrecognized Other failure must propagate, not be masked as success:false"
        );
    }

    #[test]
    fn stash_action_system_kinds_propagate() {
        // 系统级错误（认证/网络/上游等）必须上抛 Err，不允许伪装成 success:false
        for kind in [
            ErrorKind::Auth,
            ErrorKind::AuthSsh,
            ErrorKind::Network,
            ErrorKind::Ambiguous,
            ErrorKind::NoUpstream,
        ] {
            let err = git_exec_err(kind, "fatal: unable to access");
            assert!(
                stash_action_result(err).is_err(),
                "{kind:?} is a system-level error and must propagate"
            );
        }
    }

    #[test]
    fn stash_action_non_git_error_propagates() {
        // 非 GitExecError（spawn 失败、timeout 等）同样上抛
        let err = anyhow::anyhow!("git command failed to spawn: No such file or directory");
        assert!(stash_action_result(err).is_err());
    }

    // ── Branch operations（自 local.rs 收缩后迁移，行为等价）─────────────

    #[tokio::test]
    async fn write_operation_invalidates_diff_stats_cache() {
        // 回归：local.rs 写函数删除后，Local 项目的 shell 写操作是唯一失效入口；
        // 若写后不清缓存，diff 统计（get_cached_diff_stats）将永久陈旧。
        let (dir, path) = init_repo().await;
        let transport = ExecTarget::Local;

        // 1. 修改文件 → 首次统计（填充 DIFF_STATS_CACHE）。
        // local 版是同步 fn（内部走同步桥），必须经 spawn_blocking 调用。
        std::fs::write(dir.path().join("base.txt"), "modified\n").expect("modify");
        let path_clone = path.clone();
        let before = tokio::task::spawn_blocking(move || {
            crate::common::git::local::get_changed_files_diff_stats(std::path::Path::new(
                &path_clone,
            ))
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(before.len(), 1, "precondition: one modified file");

        // 2. shell 写操作恢复文件
        discard_file(&transport, &path, "base.txt")
            .await
            .expect("discard");

        // 3. 再取统计：缓存若未失效会返回修改态（Bug）
        let path_clone = path.clone();
        let after = tokio::task::spawn_blocking(move || {
            crate::common::git::local::get_changed_files_diff_stats(std::path::Path::new(
                &path_clone,
            ))
        })
        .await
        .unwrap()
        .unwrap();
        assert!(
            after.is_empty(),
            "cache must be invalidated after discard_file, got {after:?}"
        );
    }

    #[tokio::test]
    async fn create_branch_then_checkout_switches_head() {
        let (_dir, path) = init_repo().await;
        let transport = ExecTarget::Local;

        create_branch(&transport, &path, "feature-1", None)
            .await
            .expect("create branch");
        checkout_branch(&transport, &path, "feature-1")
            .await
            .expect("checkout branch");

        let out = git_local(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "feature-1");
    }

    #[tokio::test]
    async fn create_branch_from_start_point() {
        let (_dir, path) = init_repo().await;
        let transport = ExecTarget::Local;

        // 制造第二个提交
        std::fs::write(std::path::Path::new(&path).join("file2.txt"), "hello\n")
            .expect("write file2");
        let out = git_local(&path, &["add", "-A"]).await;
        assert!(out.exit_code == 0, "git add failed");
        let out = git_local(&path, &["commit", "-qm", "Second"]).await;
        assert!(out.exit_code == 0, "git commit failed");

        create_branch(&transport, &path, "from-first", Some("HEAD~1"))
            .await
            .expect("create branch from HEAD~1");

        let out = git_local(&path, &["rev-parse", "--abbrev-ref", "from-first"]).await;
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "from-first");
        // from-first 应指向第一个提交，而非 HEAD
        let out = git_local(&path, &["rev-parse", "from-first"]).await;
        let from_first = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let out = git_local(&path, &["rev-parse", "HEAD"]).await;
        assert_ne!(from_first, String::from_utf8_lossy(&out.stdout).trim());
    }

    #[tokio::test]
    async fn checkout_nonexistent_branch_fails() {
        let (_dir, path) = init_repo().await;
        let transport = ExecTarget::Local;
        assert!(checkout_branch(&transport, &path, "nonexistent")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn rename_current_branch() {
        let (_dir, path) = init_repo().await;
        let transport = ExecTarget::Local;

        let out = git_local(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
        let current = String::from_utf8_lossy(&out.stdout).trim().to_string();

        rename_branch(&transport, &path, &current, "renamed-branch")
            .await
            .expect("rename current branch");

        let out = git_local(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).await;
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "renamed-branch"
        );
    }

    #[tokio::test]
    async fn rename_nonexistent_branch_fails() {
        let (_dir, path) = init_repo().await;
        let transport = ExecTarget::Local;
        assert!(
            rename_branch(&transport, &path, "no-such-branch", "new-name")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn get_commit_log_scoped_to_head_excludes_isolated_tool_refs() {
        // 孤立提交仅被 refs/synara/checkpoints/isolated 引用 —— 不应出现在 HEAD-scoped log
        let (_dir, path) = init_repo().await;
        let transport = ExecTarget::Local;

        // 空树孤立提交
        let out = git_local(&path, &["hash-object", "-t", "tree", "--stdin"]).await;
        assert!(out.exit_code == 0, "hash-object failed");
        let empty_tree = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let out = git_local(
            &path,
            &["commit-tree", &empty_tree, "-m", "synara checkpoint"],
        )
        .await;
        assert!(out.exit_code == 0, "commit-tree failed");
        let orphan = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_ne!(orphan, "", "orphan commit id must not be empty");

        let out = git_local(
            &path,
            &["update-ref", "refs/synara/checkpoints/isolated", &orphan],
        )
        .await;
        assert!(out.exit_code == 0, "update-ref isolated failed");
        let out = git_local(
            &path,
            &["update-ref", "refs/synara/checkpoints/head-marker", "HEAD"],
        )
        .await;
        assert!(out.exit_code == 0, "update-ref head-marker failed");

        let head_out = git_local(&path, &["rev-parse", "HEAD"]).await;
        let head_id = String::from_utf8_lossy(&head_out.stdout).trim().to_string();

        let log = get_commit_log(&transport, &path, 0, 0)
            .await
            .expect("get commit log");
        assert!(
            log.iter().all(|c| c.hash != orphan),
            "isolated synara-only commit must not appear in HEAD-scoped log"
        );
        let head_entry = log
            .iter()
            .find(|c| c.hash == head_id)
            .expect("HEAD commit should be in log");
        assert!(
            !head_entry.refs.contains("synara"),
            "refs string must not contain tool refs, got: {}",
            head_entry.refs
        );
        assert!(
            head_entry
                .refs_list
                .iter()
                .all(|r| r.name != "synara/checkpoints/head-marker"),
            "refs_list must not contain tool refs"
        );
        assert!(
            head_entry
                .refs_list
                .iter()
                .any(|r| r.kind == crate::common::git::refs::RefKind::Branch),
            "HEAD commit should still expose its branch ref"
        );
    }
}
