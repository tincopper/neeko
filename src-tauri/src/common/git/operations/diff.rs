// Git operations — diff sub-module (split from operations.rs God File).

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
pub(crate) async fn get_worktree_changed_files_shell(
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
pub(crate) async fn get_file_diff_shell(
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
        args.push(crate::common::git::parsers::full_diff_context_arg(
            file_bytes,
        ));
    }
    args.push("--".to_string());
    args.push(file_path.to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = transport
        .run_git_opts(&arg_refs, work_dir, readonly_opts())
        .await?;
    let mut result = crate::common::git::parsers::parse_unified_diff(&output);
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
        crate::common::git::parsers::collapse_diff_context(&mut result.hunks, 12);
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
        if let Some((add, del, path)) = crate::common::git::parsers::parse_numstat_line(line) {
            tracked_paths.insert(path.clone());
            stats.push(FileDiffStats {
                path: std::path::PathBuf::from(&path),
                additions: add,
                deletions: del,
            });
        }
    }

    for line in String::from_utf8_lossy(&staged.stdout).lines() {
        if let Some((add, del, path)) = crate::common::git::parsers::parse_numstat_line(line) {
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
pub async fn get_changed_files_diff_stats(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<Vec<FileDiffStats>> {
    if transport.open_repo(work_dir).is_some() {
        let work_dir_owned = work_dir.to_string();
        tokio::task::spawn_blocking(move || {
            crate::common::git::local::get_changed_files_diff_stats(std::path::Path::new(
                &work_dir_owned,
            ))
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
            crate::common::git::local::get_file_diff(
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
