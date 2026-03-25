use crate::state::{DiffHunk, DiffLine, DiffResult, FileChange, FileStatus, GitInfo, Worktree};
use anyhow::{Context, Result};
use git2::{BranchType, Repository, Status, StatusOptions};
use std::path::{Path, PathBuf};

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

            // 显式跳过 gitignored 文件（双重保险，配合 include_ignored(false)）
            if status.contains(Status::IGNORED) {
                continue;
            }
            // 跳过已提交且无变化的文件
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

            // 简化版本：使用固定值
            let (additions, deletions) = count_file_changes(repo, path)?;

            files.push(FileChange {
                path: PathBuf::from(path),
                status: file_status,
                additions,
                deletions,
            });
        }
    }

    Ok(files)
}

fn count_file_changes(repo: &Repository, file_path: &str) -> Result<(usize, usize)> {
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file_path).context_lines(0);

    let old_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .and_then(|c| c.tree().ok());

    let diff = match &old_tree {
        Some(tree) => repo
            .diff_tree_to_workdir_with_index(Some(tree), Some(&mut opts))
            .unwrap_or_else(|_| repo.diff_index_to_workdir(None, Some(&mut opts)).unwrap()),
        None => repo
            .diff_index_to_workdir(None, Some(&mut opts))
            .unwrap_or_else(|_| {
                return repo
                    .diff_tree_to_workdir_with_index(None, Some(&mut opts))
                    .unwrap();
            }),
    };

    let stats = diff.stats().context("Failed to get diff stats")?;
    Ok((stats.insertions(), stats.deletions()))
}

fn get_worktrees(repo: &Repository) -> Result<Vec<Worktree>> {
    let mut worktrees = Vec::new();

    // 获取 worktree 名称列表
    if let Ok(names) = repo.worktrees() {
        for name in names.iter().flatten() {
            if let Some(wt) = repo.find_worktree(name).ok() {
                let path = wt.path().to_path_buf();
                // 简化版本，获取分支信息
                if let Ok(wt_repo) = Repository::open(&path) {
                    if let Ok(head) = wt_repo.head() {
                        let branch = head.shorthand().unwrap_or("HEAD").to_string();
                        let head_oid = head
                            .target()
                            .map(|oid| oid.to_string())
                            .unwrap_or_else(|| "detached".to_string());

                        worktrees.push(Worktree {
                            path,
                            branch,
                            head: head_oid,
                        });
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
    use std::process::Command;

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

    let output = Command::new("git")
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
    use std::process::Command;

    let wt_path_str = worktree_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid path"))?;
    let output = Command::new("git")
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

pub fn is_git_repo(path: &Path) -> bool {
    Repository::open(path).is_ok()
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
    use std::process::Command;

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

    let output = Command::new("git")
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
