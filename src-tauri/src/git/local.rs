use crate::models::{
    BranchGroup, CommitDetail, CommitInfo, DiffHunk, DiffLine, DiffResult, FileChange, FileStatus,
    GitInfo, Worktree,
};
use anyhow::{Context, Result};
use git2::{BranchType, Repository, Sort, Status, StatusOptions};
use std::path::{Path, PathBuf};
use std::process::Command;

fn no_window_cmd(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

pub fn get_git_info(repo_path: &Path) -> Result<GitInfo> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    // 获取当前分支
    let head = repo.head()?;
    let current_branch = if head.is_branch() {
        head.shorthand().unwrap_or("HEAD").to_string()
    } else {
        "HEAD (detached)".to_string()
    };

    // 只获取本地分支
    let branches = repo.branches(Some(git2::BranchType::Local))?;
    let mut branch_names = Vec::new();
    for branch_result in branches {
        if let Ok((branch, _)) = branch_result {
            if let Some(name) = branch.name()? {
                branch_names.push(name.to_string());
            }
        }
    }

    // 获取变更文件
    let changed_files = get_changed_files(&repo)?;

    // 判断是否干净
    let is_clean = changed_files.is_empty();

    // 获取 worktrees
    let worktrees = get_worktrees(&repo)?;

    Ok(GitInfo {
        current_branch,
        branches: branch_names,
        worktrees,
        changed_files,
        is_clean,
    })
}

fn get_changed_files(repo: &Repository) -> Result<Vec<FileChange>> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::new();

    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            let status = entry.status();

            if status.contains(Status::IGNORED) {
                continue;
            }
            if status.is_empty() {
                continue;
            }

            let file_status = if status.contains(Status::WT_NEW)
                || status.contains(Status::INDEX_NEW)
            {
                FileStatus::Added
            } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED)
            {
                FileStatus::Deleted
            } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED)
            {
                FileStatus::Renamed
            } else if status.contains(Status::WT_MODIFIED)
                || status.contains(Status::INDEX_MODIFIED)
            {
                FileStatus::Modified
            } else {
                continue;
            };

            files.push(FileChange {
                path: PathBuf::from(path),
                status: file_status,
                additions: 0,
                deletions: 0,
            });
        }
    }

    // Single combined diff to get per-file stats
    if !files.is_empty() {
        let mut diff_opts = git2::DiffOptions::new();
        let old_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| c.tree().ok());

        let diff = match &old_tree {
            Some(tree) => repo
                .diff_tree_to_workdir_with_index(Some(tree), Some(&mut diff_opts))
                .or_else(|_| repo.diff_index_to_workdir(None, Some(&mut diff_opts))),
            None => repo
                .diff_index_to_workdir(None, Some(&mut diff_opts))
                .or_else(|_| repo.diff_tree_to_workdir_with_index(None, Some(&mut diff_opts))),
        };

        if let Ok(diff) = diff {
            use std::cell::RefCell;
            let file_stats: RefCell<Vec<(String, usize, usize)>> = RefCell::new(Vec::new());
            let _ = diff.foreach(
                &mut |delta, _| {
                    if let Some(path) = delta.new_file().path() {
                        file_stats
                            .borrow_mut()
                            .push((path.to_string_lossy().to_string(), 0, 0));
                    }
                    true
                },
                None,
                None,
                Some(&mut |_delta, _hunk, line| {
                    let origin = line.origin();
                    if origin == '+' || origin == '-' {
                        let mut stats = file_stats.borrow_mut();
                        if let Some(last) = stats.last_mut() {
                            if origin == '+' {
                                last.1 += 1;
                            } else {
                                last.2 += 1;
                            }
                        }
                    }
                    true
                }),
            );

            let stats = file_stats.into_inner();
            for file in &mut files {
                let path_str = file.path.to_string_lossy().replace('\\', "/");
                if let Some((_, a, d)) = stats.iter().find(|(p, _, _)| {
                    let normalized = p.replace('\\', "/");
                    normalized == path_str
                        || normalized.ends_with(&path_str)
                        || path_str.ends_with(&normalized)
                }) {
                    file.additions = *a;
                    file.deletions = *d;
                }
            }
        }

        // Handle untracked/added files not in diff (count their lines as additions)
        if let Some(workdir) = repo.workdir() {
            for file in &mut files {
                if (file.status == FileStatus::Added) && file.additions == 0 && file.deletions == 0
                {
                    let full_path = workdir.join(&file.path);
                    if full_path.exists() && full_path.is_file() {
                        if let Ok(content) = std::fs::read_to_string(&full_path) {
                            let line_count = content.lines().count();
                            file.additions = line_count;
                        }
                    }
                }
            }
        }
    }

    Ok(files)
}

fn get_worktrees(repo: &Repository) -> Result<Vec<Worktree>> {
    let mut worktrees = Vec::new();

    if let Ok(names) = repo.worktrees() {
        for name in names.iter().flatten() {
            if let Some(wt) = repo.find_worktree(name).ok() {
                let path = wt.path().to_path_buf();
                // Use git command to get branch and head info (avoids N+1 repo opens)
                let wt_path_str = path.to_str().unwrap_or(".");
                if let Ok(output) = no_window_cmd("git")
                    .args(["-C", wt_path_str, "rev-parse", "--abbrev-ref", "HEAD"])
                    .output()
                {
                    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let branch = if branch.is_empty() {
                        "HEAD".to_string()
                    } else {
                        branch
                    };

                    if let Ok(output) = no_window_cmd("git")
                        .args(["-C", wt_path_str, "rev-parse", "HEAD"])
                        .output()
                    {
                        let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        let head = if head.is_empty() {
                            "detached".to_string()
                        } else {
                            head
                        };

                        worktrees.push(Worktree { path, branch, head });
                    }
                }
            }
        }
    }

    Ok(worktrees)
}

pub fn checkout_branch(repo_path: &Path, branch_name: &str) -> Result<()> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    let obj = repo
        .revparse_single(&format!("refs/heads/{}", branch_name))
        .context("Branch not found")?;

    let commit = obj.peel_to_commit().context("Failed to peel to commit")?;

    repo.checkout_tree(commit.as_object(), None)
        .context("Failed to checkout tree")?;

    repo.set_head(&format!("refs/heads/{}", branch_name))
        .context("Failed to set HEAD")?;

    Ok(())
}

pub fn create_branch(repo_path: &Path, branch_name: &str, start_point: Option<&str>) -> Result<()> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    let target = if let Some(sp) = start_point {
        repo.revparse_single(sp)?
    } else {
        repo.revparse_single("HEAD")?
    };

    let commit = target.peel_to_commit()?;
    repo.branch(branch_name, &commit, false)?;

    Ok(())
}

pub fn get_file_diff(repo_path: &Path, file_path: &str) -> Result<DiffResult> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file_path)
        .context_lines(3)
        .ignore_whitespace_eol(false);

    let old_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .and_then(|c| c.tree().ok());

    let diff = match &old_tree {
        Some(tree) => repo
            .diff_tree_to_workdir_with_index(Some(tree), Some(&mut opts))
            .context("Failed to compute diff")?,
        None => repo
            .diff_index_to_workdir(None, Some(&mut opts))
            .context("Failed to compute diff")?,
    };

    // 先收集所有 patch 数据，避免多个闭包同时借用
    use std::cell::RefCell;
    let hunks: RefCell<Vec<DiffHunk>> = RefCell::new(Vec::new());

    diff.foreach(
        &mut |_, _| true,
        None,
        Some(&mut |_delta, hunk| {
            hunks.borrow_mut().push(DiffHunk {
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                lines: Vec::new(),
            });
            true
        }),
        Some(&mut |_delta, _hunk_opt, line| {
            let content = std::str::from_utf8(line.content())
                .unwrap_or("")
                .trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string();

            let diff_line = match line.origin() {
                '+' => DiffLine::Added(content),
                '-' => DiffLine::Removed(content),
                ' ' => DiffLine::Context(content),
                _ => return true,
            };

            if let Some(last) = hunks.borrow_mut().last_mut() {
                last.lines.push(diff_line);
            }
            true
        }),
    )
    .context("Failed to iterate diff")?;

    let mut result_hunks = hunks.into_inner();

    // If hunks is empty, try to read file content (may be a new file)
    if result_hunks.is_empty() {
        let full_path = repo_path.join(file_path);
        if full_path.exists() && full_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                let lines: Vec<DiffLine> = content
                    .lines()
                    .map(|line| DiffLine::Added(line.to_string()))
                    .collect();

                if !lines.is_empty() {
                    result_hunks.push(DiffHunk {
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

    Ok(DiffResult {
        hunks: result_hunks,
    })
}

pub fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    new_branch: bool,
) -> Result<()> {
    let mut args = vec!["worktree", "add"];
    if new_branch {
        args.push("-b");
        args.push(branch_name);
    }
    let wt_path_str = worktree_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid path"))?;
    args.push(wt_path_str);
    if !new_branch {
        args.push(branch_name);
    }

    let output = no_window_cmd("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git worktree add")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {}", stderr.trim());
    }
    Ok(())
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let wt_path_str = worktree_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid path"))?;
    let output = no_window_cmd("git")
        .args(["worktree", "remove", "--force", wt_path_str])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git worktree remove")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree remove failed: {}", stderr.trim());
    }
    Ok(())
}

/// 获取指定路径（worktree 或项目路径）的变更文件列表
pub fn get_changed_files_for_path(repo_path: &Path) -> Result<Vec<FileChange>> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    get_changed_files(&repo)
}

/// 获取指定路径（worktree 或项目路径）中某文件的 diff
pub fn get_file_diff_for_path(repo_path: &Path, file_path: &str) -> Result<DiffResult> {
    get_file_diff(repo_path, file_path)
}

/// 检查 worktree 是否有未提交的更改（modified / untracked）
pub fn is_worktree_dirty(_repo_path: &Path, worktree_path: &Path) -> Result<bool> {
    let wt_path_str = worktree_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid path"))?;

    // 检查已跟踪文件的修改
    let diff_output = no_window_cmd("git")
        .args(["diff", "--quiet", "--"])
        .current_dir(wt_path_str)
        .output()
        .context("Failed to run git diff")?;

    if !diff_output.status.success() {
        return Ok(true);
    }

    // 检查暂存区
    let cached_output = no_window_cmd("git")
        .args(["diff", "--cached", "--quiet", "--"])
        .current_dir(wt_path_str)
        .output()
        .context("Failed to run git diff --cached")?;

    if !cached_output.status.success() {
        return Ok(true);
    }

    // 检查未跟踪文件
    let untracked_output = no_window_cmd("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(wt_path_str)
        .output()
        .context("Failed to run git ls-files")?;

    if !untracked_output.stdout.is_empty() {
        return Ok(true);
    }

    Ok(false)
}

/// 删除本地分支
pub fn delete_branch(repo_path: &Path, branch_name: &str, force: bool) -> Result<()> {
    let flag = if force { "-D" } else { "-d" };
    let output = no_window_cmd("git")
        .args(["branch", flag, branch_name])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git branch -D")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 分支不存在时不报错
        if stderr.contains("not found") || stderr.contains("does not exist") {
            return Ok(());
        }
        anyhow::bail!("git branch {} failed: {}", flag, stderr.trim());
    }
    Ok(())
}

pub fn is_git_repo(path: &Path) -> bool {
    Repository::open(path).is_ok()
}

/// 获取提交日志（按时间倒序，支持 offset + limit 分页）
pub fn get_commit_log(repo_path: &Path, offset: usize, limit: usize) -> Result<Vec<CommitInfo>> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(Sort::TIME)?;
    revwalk.push_head()?;

    let mut commits = Vec::with_capacity(limit);
    for (i, oid) in revwalk.enumerate() {
        if i < offset {
            continue;
        }
        if commits.len() >= limit {
            break;
        }
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits.push(commit_to_info(&commit));
    }
    Ok(commits)
}

/// 获取单个提交的详情（含修改文件列表）
pub fn get_commit_detail(repo_path: &Path, commit_hash: &str) -> Result<CommitDetail> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    let oid = git2::Oid::from_str(commit_hash)
        .map_err(|e| anyhow::anyhow!("Invalid commit hash: {}", e))?;
    let commit = repo.find_commit(oid)?;

    // Parent hashes
    let parent_hashes: Vec<String> = commit.parents().map(|p| p.id().to_string()).collect();

    // 获取该提交修改的文件列表
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let mut diff_opts = git2::DiffOptions::new();
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts))?;

    use std::cell::RefCell;
    let files: RefCell<Vec<FileChange>> = RefCell::new(Vec::new());
    diff.foreach(
        &mut |delta, _| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_path_buf())
                .unwrap_or_default();

            let status = match delta.status() {
                git2::Delta::Added => FileStatus::Added,
                git2::Delta::Deleted => FileStatus::Deleted,
                git2::Delta::Renamed => FileStatus::Renamed,
                git2::Delta::Modified | git2::Delta::Typechange => FileStatus::Modified,
                _ => FileStatus::Modified,
            };

            files.borrow_mut().push(FileChange {
                path,
                status,
                additions: 0,
                deletions: 0,
            });
            true
        },
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            let origin = line.origin();
            let mut files_ref = files.borrow_mut();
            if let Some(last) = files_ref.last_mut() {
                if origin == '+' {
                    last.additions += 1;
                } else if origin == '-' {
                    last.deletions += 1;
                }
            }
            true
        }),
    )?;

    Ok(CommitDetail {
        commit: commit_to_info(&commit),
        files: files.into_inner(),
        parent_hashes,
    })
}

/// 获取所有分支分组（Local / Remote / Tags）
pub fn get_all_branches(repo_path: &Path) -> Result<BranchGroup> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    let head = repo.head()?;
    let current = if head.is_branch() {
        head.shorthand().unwrap_or("HEAD").to_string()
    } else {
        "HEAD (detached)".to_string()
    };

    let mut local = Vec::new();
    if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for branch_result in branches.flatten() {
            if let Ok(Some(name)) = branch_result.0.name() {
                local.push(name.to_string());
            }
        }
    }

    let mut remote = Vec::new();
    if let Ok(branches) = repo.branches(Some(BranchType::Remote)) {
        for branch_result in branches.flatten() {
            if let Ok(Some(name)) = branch_result.0.name() {
                remote.push(name.to_string());
            }
        }
    }

    let mut tags = Vec::new();
    if let Ok(tag_names) = repo.tag_names(None) {
        for name in tag_names.iter().flatten() {
            tags.push(name.to_string());
        }
    }

    Ok(BranchGroup {
        local,
        remote,
        tags,
        current,
    })
}

/// 获取提交的 diff（用于在右栏展示单个文件的 diff）
pub fn get_commit_file_diff(
    repo_path: &Path,
    commit_hash: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    let oid = git2::Oid::from_str(commit_hash)
        .map_err(|e| anyhow::anyhow!("Invalid commit hash: {}", e))?;
    let commit = repo.find_commit(oid)?;

    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts
        .pathspec(file_path)
        .context_lines(3)
        .ignore_whitespace_eol(false);

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts))?;

    use std::cell::RefCell;
    let hunks: RefCell<Vec<DiffHunk>> = RefCell::new(Vec::new());

    diff.foreach(
        &mut |_, _| true,
        None,
        Some(&mut |_delta, hunk| {
            hunks.borrow_mut().push(DiffHunk {
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                lines: Vec::new(),
            });
            true
        }),
        Some(&mut |_delta, _hunk_opt, line| {
            let content = std::str::from_utf8(line.content())
                .unwrap_or("")
                .trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string();

            let diff_line = match line.origin() {
                '+' => DiffLine::Added(content),
                '-' => DiffLine::Removed(content),
                ' ' => DiffLine::Context(content),
                _ => return true,
            };

            if let Some(last) = hunks.borrow_mut().last_mut() {
                last.lines.push(diff_line);
            }
            true
        }),
    )?;

    Ok(DiffResult {
        hunks: hunks.into_inner(),
    })
}

/// 将 git2::Commit 转换为 CommitInfo
fn commit_to_info(commit: &git2::Commit) -> CommitInfo {
    let hash = commit.id().to_string();
    let short_hash = hash[..7.min(hash.len())].to_string();
    let message = commit
        .message()
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    let author = commit.author().name().unwrap_or("Unknown").to_string();
    let email = commit.author().email().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();
    let date = {
        let dt = chrono::DateTime::from_timestamp(timestamp, 0);
        match dt {
            Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            None => format!("{}", timestamp),
        }
    };

    CommitInfo {
        hash,
        short_hash,
        message,
        author,
        email,
        timestamp,
        date,
        parent_hashes: commit.parent_ids().map(|id| id.to_string()).collect(),
    }
}

/// 重命名本地分支（不能重命名当前 checkout 的分支以外的情况需特殊处理）
pub fn rename_branch(repo_path: &Path, old_name: &str, new_name: &str) -> Result<()> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    let mut branch = repo
        .find_branch(old_name, BranchType::Local)
        .with_context(|| format!("Branch '{}' not found", old_name))?;
    branch
        .rename(new_name, false)
        .with_context(|| format!("Failed to rename branch '{}' to '{}'", old_name, new_name))?;
    Ok(())
}

/// 重命名 worktree 目录（使用 git worktree move，需要 git >= 2.30）
pub fn rename_worktree(repo_path: &Path, worktree_path: &Path, new_name: &str) -> Result<String> {
    let parent = worktree_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine parent directory of worktree"))?;
    let new_path = parent.join(new_name);

    let wt_old_str = worktree_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid worktree path"))?;
    let wt_new_str = new_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid new worktree path"))?;

    let output = no_window_cmd("git")
        .args(["worktree", "move", wt_old_str, wt_new_str])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git worktree move")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree move failed: {}", stderr.trim());
    }

    Ok(wt_new_str.to_string())
}

/// 创建提交（git commit -m 或 git commit --amend -m）
pub fn create_commit(repo_path: &Path, message: &str, amend: bool, files: &[String]) -> Result<String> {
    // Stage specified files (or all if empty)
    let mut add_cmd = no_window_cmd("git");
    add_cmd.arg("add");
    if files.is_empty() {
        add_cmd.arg("-A");
    } else {
        for f in files {
            add_cmd.arg(f);
        }
    }
    add_cmd.current_dir(repo_path);
    let add_output = add_cmd.output().context("Failed to run git add")?;
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        anyhow::bail!("git add failed: {}", stderr.trim());
    }

    // Commit
    let mut commit_cmd = no_window_cmd("git");
    commit_cmd.arg("commit");
    if amend {
        commit_cmd.arg("--amend");
    }
    commit_cmd.args(["-m", message]);
    commit_cmd.current_dir(repo_path);
    let commit_output = commit_cmd.output().context("Failed to run git commit")?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        anyhow::bail!("git commit failed: {}", stderr.trim());
    }

    // Get the new commit hash
    let hash_output = no_window_cmd("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get commit hash")?;
    let hash = String::from_utf8_lossy(&hash_output.stdout).trim().to_string();
    Ok(hash)
}

/// Push 到远程
pub fn push_remote(repo_path: &Path) -> Result<()> {
    let output = no_window_cmd("git")
        .arg("push")
        .current_dir(repo_path)
        .output()
        .context("Failed to run git push")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git push failed: {}", stderr.trim());
    }
    Ok(())
}

/// 获取未跟踪文件列表
pub fn get_unversioned_files(repo_path: &Path) -> Result<Vec<FileChange>> {
    let output = no_window_cmd("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git ls-files")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();
    for line in stdout.lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        // Count lines in the file
        let file_path = repo_path.join(path);
        let line_count = std::fs::read_to_string(&file_path)
            .map(|c| c.lines().count())
            .unwrap_or(0);
        files.push(FileChange {
            path: PathBuf::from(path),
            status: FileStatus::Untracked,
            additions: line_count,
            deletions: 0,
        });
    }
    Ok(files)
}

/// 解析 git diff --unified=3 文本输出为 DiffResult
pub fn parse_unified_diff(output: &str) -> DiffResult {
    let mut hunks: Vec<DiffHunk> = Vec::new();

    for line in output.lines() {
        if line.starts_with("@@") {
            // 解析 @@ -old_start,old_lines +new_start,new_lines @@
            if let Some((hunk_header, _)) = parse_hunk_header(line) {
                hunks.push(hunk_header);
            }
        } else if let Some(last) = hunks.last_mut() {
            if line.starts_with('+') && !line.starts_with("+++") {
                last.lines.push(DiffLine::Added(line[1..].to_string()));
            } else if line.starts_with('-') && !line.starts_with("---") {
                last.lines.push(DiffLine::Removed(line[1..].to_string()));
            } else if line.starts_with(' ') {
                last.lines.push(DiffLine::Context(line[1..].to_string()));
            }
            // 跳过其他行（\ No newline at end of file 等）
        }
    }

    DiffResult { hunks }
}

fn parse_hunk_header(line: &str) -> Option<(DiffHunk, &str)> {
    // @@ -old_start,old_lines +new_start,new_lines @@
    let rest = line.strip_prefix("@@ ")?;
    let rest = rest.strip_prefix('-')?;

    let (old_part, rest) = rest.split_once(' ')?;
    let (old_start, old_lines) = if let Some((s, l)) = old_part.split_once(',') {
        (s.parse::<u32>().ok()?, l.parse::<u32>().ok()?)
    } else {
        // 省略行数时隐含为 1（git 标准）
        (old_part.parse::<u32>().ok()?, 1)
    };

    let rest = rest.strip_prefix('+')?;

    let (new_part, _rest) = if let Some(pos) = rest.find(" @@") {
        (&rest[..pos], &rest[pos..])
    } else {
        return None;
    };

    let (new_start, new_lines) = if let Some((s, l)) = new_part.split_once(',') {
        (s.parse::<u32>().ok()?, l.parse::<u32>().ok()?)
    } else {
        // 省略行数时隐含为 1
        (new_part.parse::<u32>().ok()?, 1)
    };

    Some((
        DiffHunk {
            old_start,
            old_lines,
            new_start,
            new_lines,
            lines: Vec::new(),
        },
        _rest,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_empty_diff() {
        let result = parse_unified_diff("");
        assert!(result.hunks.is_empty());
    }

    #[test]
    fn should_parse_single_hunk() {
        let diff = r#"@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3"#;
        let result = parse_unified_diff(diff);
        assert_eq!(result.hunks.len(), 1);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 3);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 4);
        assert_eq!(hunk.lines.len(), 4);
    }

    #[test]
    fn should_parse_added_lines() {
        let diff = r#"@@ -1,1 +1,2 @@
 existing
+new line"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert!(matches!(hunk.lines[0], DiffLine::Context(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Added(_)));
    }

    #[test]
    fn should_parse_removed_lines() {
        let diff = r#"@@ -1,2 +1,1 @@
-removed line
-removed line2"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.lines.len(), 2);
        assert!(matches!(hunk.lines[0], DiffLine::Removed(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Removed(_)));
    }

    #[test]
    fn should_parse_multiple_hunks() {
        let diff = r#"@@ -1,3 +1,3 @@
 context1
-old1
+new1
 context2
@@ -10,2 +10,3 @@
 context10
+added
 context11"#;
        let result = parse_unified_diff(diff);
        assert_eq!(result.hunks.len(), 2);
        assert_eq!(result.hunks[0].old_start, 1);
        assert_eq!(result.hunks[1].old_start, 10);
    }

    #[test]
    fn should_skip_diff_headers() {
        let diff = r#"--- a/file.rs
+++ b/file.rs
@@ -1,1 +1,2 @@
 line1
+added"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        // Should not include --- or +++ as diff lines
        assert_eq!(hunk.lines.len(), 2);
        assert!(matches!(hunk.lines[0], DiffLine::Context(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Added(_)));
    }

    #[test]
    fn should_parse_hunk_without_line_counts() {
        let diff = "@@ -1 +1 @@
-old
+new";
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 1);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 1);
    }

    #[test]
    fn should_strip_prefix_from_lines() {
        let diff = r#"@@ -1,3 +1,3 @@
 unchanged
-removed
+added"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];

        match &hunk.lines[0] {
            DiffLine::Context(s) => assert_eq!(s, "unchanged"),
            _ => panic!("Expected Context"),
        }
        match &hunk.lines[1] {
            DiffLine::Removed(s) => assert_eq!(s, "removed"),
            _ => panic!("Expected Removed"),
        }
        match &hunk.lines[2] {
            DiffLine::Added(s) => assert_eq!(s, "added"),
            _ => panic!("Expected Added"),
        }
    }

    #[test]
    fn should_get_changed_files_for_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        // Init git repo
        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("initial.txt");
        std::fs::write(&file_path, "initial content\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("initial.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // Modify a file
        std::fs::write(&file_path, "modified content\n").unwrap();

        // Call get_changed_files_for_path (should detect modification)
        let files = get_changed_files_for_path(repo_path).unwrap();
        assert!(!files.is_empty(), "Should detect changed file");
        assert_eq!(files[0].status, FileStatus::Modified);
    }

    #[test]
    fn should_return_empty_for_clean_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("clean.txt");
        std::fs::write(&file_path, "clean content\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("clean.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // No modifications
        let files = get_changed_files_for_path(repo_path).unwrap();
        assert!(files.is_empty(), "Clean repo should have no changes");
    }

    #[test]
    fn should_get_file_diff_for_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("test.txt");
        std::fs::write(&file_path, "line1\nline2\nline3\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("test.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // Modify file
        std::fs::write(&file_path, "line1\nmodified\nline3\n").unwrap();

        // Get diff
        let diff_result = get_file_diff_for_path(repo_path, "test.txt").unwrap();
        assert!(!diff_result.hunks.is_empty(), "Should have hunks");
        // Should have removed and added lines
        let has_removed = diff_result
            .hunks
            .iter()
            .any(|h| h.lines.iter().any(|l| matches!(l, DiffLine::Removed(_))));
        let has_added = diff_result
            .hunks
            .iter()
            .any(|h| h.lines.iter().any(|l| matches!(l, DiffLine::Added(_))));
        assert!(has_removed, "Should have removed lines");
        assert!(has_added, "Should have added lines");
    }

    #[test]
    fn should_detect_added_file_in_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("existing.txt");
        std::fs::write(&file_path, "existing\n").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("existing.txt"))
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // Add new untracked file
        let new_file = repo_path.join("new_file.txt");
        std::fs::write(&new_file, "new content\n").unwrap();

        let files = get_changed_files_for_path(repo_path).unwrap();
        let new_file_entry = files
            .iter()
            .find(|f| f.path.to_string_lossy().contains("new_file.txt"));
        assert!(new_file_entry.is_some(), "Should detect new file");
        assert_eq!(new_file_entry.unwrap().status, FileStatus::Added);
    }

    // ─── get_commit_log / get_commit_detail / get_all_branches 测试 ────

    fn create_test_repo_with_commits() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();
        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create 3 commits with distinct timestamps to ensure stable ordering
        for i in 1..=3 {
            let file_path = repo_path.join(format!("file{}.txt", i));
            std::fs::write(&file_path, format!("content {}\n", i)).unwrap();
            let mut index = repo.index().unwrap();
            index
                .add_path(std::path::Path::new(&format!("file{}.txt", i)))
                .unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            // Use distinct timestamps (1 second apart) to guarantee TIME sort order
            let sig = git2::Signature::new(
                "test",
                "test@test.com",
                &git2::Time::new(1700000000 + i as i64, 0),
            )
            .unwrap();
            let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let parents: Vec<&git2::Commit> = if let Some(ref c) = parent_commit {
                vec![c]
            } else {
                vec![]
            };
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &format!("commit {}", i),
                &tree,
                &parents,
            )
            .unwrap();
        }

        dir
    }

    #[test]
    fn should_get_commit_log() {
        let dir = create_test_repo_with_commits();
        let commits = get_commit_log(dir.path(), 0, 50).unwrap();
        assert_eq!(commits.len(), 3);
        // 最新提交在前
        assert_eq!(commits[0].message, "commit 3");
        assert_eq!(commits[1].message, "commit 2");
        assert_eq!(commits[2].message, "commit 1");
        assert_eq!(commits[0].author, "test");
        assert!(!commits[0].hash.is_empty());
        assert!(!commits[0].short_hash.is_empty());
    }

    #[test]
    fn should_get_commit_log_with_pagination() {
        let dir = create_test_repo_with_commits();
        let page1 = get_commit_log(dir.path(), 0, 2).unwrap();
        assert_eq!(page1.len(), 2);
        let page2 = get_commit_log(dir.path(), 2, 2).unwrap();
        assert_eq!(page2.len(), 1);
        assert_eq!(page2[0].message, "commit 1");
    }

    #[test]
    fn should_get_commit_detail() {
        let dir = create_test_repo_with_commits();
        let commits = get_commit_log(dir.path(), 0, 1).unwrap();
        let hash = &commits[0].hash;

        let detail = get_commit_detail(dir.path(), hash).unwrap();
        assert_eq!(detail.commit.message, "commit 3");
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].status, FileStatus::Added);
        assert_eq!(detail.parent_hashes.len(), 1);
    }

    #[test]
    fn should_get_all_branches() {
        let dir = create_test_repo_with_commits();
        let repo_path = dir.path();

        // Create a second branch
        let repo = Repository::open(repo_path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let current = repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap_or("master")
            .to_string();
        repo.branch("feature/test", &head, false).unwrap();

        let groups = get_all_branches(repo_path).unwrap();
        assert!(groups.local.len() >= 2, "Should have at least 2 branches");
        assert!(groups.local.contains(&current));
        assert!(groups.local.contains(&"feature/test".to_string()));
        assert_eq!(groups.current, current);
        assert!(groups.tags.is_empty());
    }
}
