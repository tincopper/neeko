use anyhow::Result;

use super::transport::GitTransport;
use crate::models::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, DiffHunk, DiffLine,
    DiffResult, FileChange, FileDiffStats, FileStatus, GitBranchInfo, GitInfo, Worktree,
};
use crate::utils::command::local::exec;

/// Stage specific files: `git add -- <files>`
pub async fn stage_files(
    transport: &GitTransport,
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
    transport: &GitTransport,
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
pub async fn stage_all(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["add", "-A"], work_dir).await?;
    Ok(())
}

/// Unstage all changes: `git restore --staged .`
pub async fn unstage_all(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["restore", "--staged", "."], work_dir)
        .await?;
    Ok(())
}

/// Discard file changes: `git checkout -- <file>`
pub async fn discard_file(transport: &GitTransport, work_dir: &str, file_path: &str) -> Result<()> {
    transport
        .run_git(&["checkout", "--", file_path], work_dir)
        .await?;
    Ok(())
}

/// Discard all changes: `git checkout -- .`
pub async fn discard_all(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["checkout", "--", "."], work_dir)
        .await?;
    let _ = transport.run_git(&["clean", "-fd"], work_dir).await;
    Ok(())
}

/// Fetch from all remotes: `git fetch --all`
pub async fn fetch(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["fetch", "--all"], work_dir).await?;
    Ok(())
}

/// Push to remote: `git push [--set-upstream]`
pub async fn push(transport: &GitTransport, work_dir: &str, set_upstream: bool) -> Result<()> {
    if set_upstream {
        transport
            .run_git(&["push", "--set-upstream"], work_dir)
            .await?;
    } else {
        transport.run_git(&["push"], work_dir).await?;
    }
    Ok(())
}

/// Pull: fetch + merge --ff-only
pub async fn pull(transport: &GitTransport, work_dir: &str) -> Result<()> {
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let branch = branch.trim();
    transport
        .run_git(&["fetch", "origin", branch], work_dir)
        .await?;
    let remote_branch = format!("origin/{}", branch);
    transport
        .run_git(&["merge", "--ff-only", &remote_branch], work_dir)
        .await?;
    Ok(())
}

/// Commit staged changes: `git commit -m <message>`
pub async fn commit_files(
    transport: &GitTransport,
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
    let hash = extract_commit_hash(&output);
    Ok(CommitResult {
        success: true,
        hash: hash.unwrap_or_default(),
        message: message.to_string(),
    })
}

fn extract_commit_hash(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if let Some(idx) = trimmed.find("] ") {
                let bracket_content = &trimmed[1..idx];
                if let Some(last_space) = bracket_content.rfind(' ') {
                    return Some(bracket_content[last_space + 1..].to_string());
                }
                return Some(bracket_content.to_string());
            }
        }
    }
    None
}

/// Cherry-pick a commit: `git cherry-pick <commit_hash>`
pub async fn cherry_pick(
    transport: &GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<()> {
    transport
        .run_git(&["cherry-pick", commit_hash], work_dir)
        .await?;
    Ok(())
}

/// Revert a commit: `git revert --no-edit <commit_hash>`
pub async fn revert(transport: &GitTransport, work_dir: &str, commit_hash: &str) -> Result<()> {
    transport
        .run_git(&["revert", "--no-edit", commit_hash], work_dir)
        .await?;
    Ok(())
}

/// Create a tag: `git tag -a <name> -m <message>`
pub async fn create_tag(
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
pub async fn is_worktree_dirty(transport: &GitTransport, worktree_path: &str) -> Result<bool> {
    let output = transport
        .run_git(&["status", "--porcelain"], worktree_path)
        .await?;
    Ok(!output.trim().is_empty())
}

/// Create a worktree: `git worktree add <path> <branch>`
pub async fn create_worktree(
    transport: &GitTransport,
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
pub async fn default_branch(transport: &GitTransport, work_dir: &str) -> Result<String> {
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
    transport: &GitTransport,
    work_dir: &str,
    count: usize,
    skip: usize,
) -> Result<Vec<CommitEntry>> {
    let format = "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D%x00%P";
    let count_str = format!("-{}", count);
    let skip_str = if skip > 0 {
        Some(format!("--skip={}", skip))
    } else {
        None
    };
    let mut args: Vec<String> = Vec::new();
    args.push("log".to_string());
    args.push(format.to_string());
    args.push(count_str);
    args.push("--decorate=full".to_string());
    args.push("--all".to_string());
    args.push("--topo-order".to_string());
    if let Some(s) = skip_str {
        args.push(s);
    }
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = transport.run_git(&str_args, work_dir).await?;
    Ok(parse_commit_log(&output))
}

fn parse_commit_log(output: &str) -> Vec<CommitEntry> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 6 {
                let parents = parts
                    .get(6)
                    .map(|s| {
                        s.split_whitespace()
                            .map(|p| p.to_string())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                Some(CommitEntry {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    author: parts[2].to_string(),
                    timestamp: parts[3].to_string(),
                    message: parts[4].to_string(),
                    refs: parts.get(5).map(|s| s.to_string()).unwrap_or_default(),
                    parents,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Get commit detail: `git show --format=... --no-patch <hash>`
pub async fn get_commit_detail(
    transport: &GitTransport,
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
    transport: &GitTransport,
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
    transport: &GitTransport,
    work_dir: &str,
    commit_hash: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let output = transport
        .run_git(
            &[
                "diff",
                &format!("{}^", commit_hash),
                commit_hash,
                "--",
                file_path,
            ],
            work_dir,
        )
        .await?;
    let mut result = super::parsers::parse_unified_diff(&output);
    super::parsers::collapse_diff_context(&mut result.hunks, 12);
    Ok(result)
}

/// Get ahead/behind counts: `git rev-list --left-right --count`
pub async fn get_ahead_behind(transport: &GitTransport, work_dir: &str) -> Result<AheadBehind> {
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
    transport: &GitTransport,
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
    transport: &GitTransport,
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
pub async fn get_git_info_shell(transport: &GitTransport, work_dir: &str) -> Result<GitInfo> {
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
    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        changed_files: files,
        is_clean,
    })
}

/// Get git branch info using shell commands
pub async fn get_git_branch_info_shell(
    transport: &GitTransport,
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

    let branches_output = transport
        .run_git(&["branch", "--format=%(refname:short)"], work_dir)
        .await?;
    let branches: Vec<String> = branches_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let worktrees_output = transport
        .run_git(&["worktree", "list", "--porcelain"], work_dir)
        .await?;
    let worktrees = parse_worktree_list(&worktrees_output);

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
        if line.starts_with("worktree ") {
            if !current_path.is_empty() {
                worktrees.push(Worktree {
                    path: std::path::PathBuf::from(&current_path),
                    branch: std::mem::take(&mut current_branch),
                    head: std::mem::take(&mut current_head),
                });
            }
            current_path = line["worktree ".len()..].to_string();
        } else if line.starts_with("branch ") {
            let ref_str = &line["branch ".len()..];
            if let Some(name) = ref_str.strip_prefix("refs/heads/") {
                current_branch = name.to_string();
            }
        } else if line.starts_with("HEAD ") {
            current_head = line["HEAD ".len()..].to_string();
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

/// Get changed files for a worktree path (shell-based)
pub async fn get_worktree_changed_files(
    transport: &GitTransport,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    let output = transport
        .run_git(&["status", "--porcelain"], worktree_path)
        .await?;
    Ok(parse_porcelain_status(&output))
}

/// Get file diff for a worktree path
pub async fn get_file_diff(
    transport: &GitTransport,
    work_dir: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let output = transport
        .run_git(&["diff", "-U3", "--", file_path], work_dir)
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
    super::parsers::collapse_diff_context(&mut result.hunks, 12);
    Ok(result)
}

/// Get changed files diff stats (additions/deletions) for local
pub async fn get_changed_files_diff_stats_local(work_dir: &str) -> Result<Vec<FileDiffStats>> {
    let unstaged = exec("git")
        .args(["diff", "--numstat"])
        .current_dir(work_dir)
        .output()?;
    let staged = exec("git")
        .args(["diff", "--cached", "--numstat"])
        .current_dir(work_dir)
        .output()?;

    let mut stats: Vec<FileDiffStats> = Vec::new();
    let mut tracked_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in String::from_utf8_lossy(&unstaged.stdout).lines() {
        if let Some((add, del, path)) = parse_numstat_line(line) {
            tracked_paths.insert(path.clone());
            stats.push(FileDiffStats {
                path: std::path::PathBuf::from(&path),
                additions: add,
                deletions: del,
            });
        }
    }

    for line in String::from_utf8_lossy(&staged.stdout).lines() {
        if let Some((add, del, path)) = parse_numstat_line(line) {
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

    let untracked = exec("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(work_dir)
        .output()?;
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

fn parse_numstat_line(line: &str) -> Option<(usize, usize, String)> {
    let parts: Vec<&str> = line.splitn(3, '\t').collect();
    if parts.len() < 3 {
        return None;
    }
    let additions = if parts[0] == "-" {
        0
    } else {
        parts[0].parse().unwrap_or(0)
    };
    let deletions = if parts[1] == "-" {
        0
    } else {
        parts[1].parse().unwrap_or(0)
    };
    Some((additions, deletions, parts[2].to_string()))
}

/// Get recent commit messages
pub async fn get_recent_commit_messages(
    transport: &GitTransport,
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
