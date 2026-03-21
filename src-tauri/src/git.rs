use crate::state::{DiffHunk, DiffLine, DiffResult, FileChange, FileStatus, GitInfo, Worktree};
use anyhow::{Context, Result};
use git2::{Repository, Status, StatusOptions};
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

    // 获取所有分支
    let branches = repo.branches(None)?;
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
    // 简化实现：读取文件内容计算行数差异
    let full_path = repo
        .workdir()
        .unwrap_or_else(|| Path::new(""))
        .join(file_path);

    if !full_path.exists() {
        return Ok((0, 1));
    }

    // 读取工作目录文件
    let workdir_content = std::fs::read_to_string(&full_path).unwrap_or_default();
    let workdir_lines = workdir_content.lines().count();

    // 尝试获取 HEAD 版本
    let head_lines = match repo.head() {
        Ok(head) => match head.peel_to_commit() {
            Ok(commit) => match commit.tree()?.get_path(Path::new(file_path)) {
                Ok(entry) => {
                    let blob = repo.find_blob(entry.id())?;
                    let content = std::str::from_utf8(blob.content()).unwrap_or("");
                    content.lines().count()
                }
                Err(_) => 0,
            },
            Err(_) => 0,
        },
        Err(_) => 0,
    };

    if workdir_lines > head_lines {
        Ok((workdir_lines - head_lines, 0))
    } else if head_lines > workdir_lines {
        Ok((0, head_lines - workdir_lines))
    } else {
        Ok((1, 1)) // 默认：假设有变更
    }
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

    let mut hunks = Vec::new();

    // 获取 HEAD 版本内容
    let old_content = get_head_content(&repo, file_path)?;

    // 获取工作目录版本内容
    let workdir_path = repo
        .workdir()
        .unwrap_or_else(|| Path::new(""))
        .join(file_path);
    let new_content = std::fs::read_to_string(&workdir_path).unwrap_or_default();

    // 简单的 diff 实现
    let old_lines: Vec<&str> = old_content.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();

    let mut diff_lines = Vec::new();
    let mut old_line_num = 1;
    let mut new_line_num = 1;

    // 简化的 diff：逐行比较
    let max_len = old_lines.len().max(new_lines.len());
    let mut changes_exist = false;

    for i in 0..max_len {
        let old_line = old_lines.get(i);
        let new_line = new_lines.get(i);

        match (old_line, new_line) {
            (Some(old), Some(new)) => {
                if old != new {
                    changes_exist = true;
                    diff_lines.push(DiffLine::Removed(old.to_string()));
                    diff_lines.push(DiffLine::Added(new.to_string()));
                    old_line_num += 1;
                    new_line_num += 1;
                } else {
                    diff_lines.push(DiffLine::Context(old.to_string()));
                    old_line_num += 1;
                    new_line_num += 1;
                }
            }
            (Some(old), None) => {
                changes_exist = true;
                diff_lines.push(DiffLine::Removed(old.to_string()));
                old_line_num += 1;
            }
            (None, Some(new)) => {
                changes_exist = true;
                diff_lines.push(DiffLine::Added(new.to_string()));
                new_line_num += 1;
            }
            (None, None) => {}
        }
    }

    if changes_exist {
        hunks.push(DiffHunk {
            old_start: 1,
            old_lines: old_lines.len() as u32,
            new_start: 1,
            new_lines: new_lines.len() as u32,
            lines: diff_lines,
        });
    }

    Ok(DiffResult { hunks })
}

fn get_head_content(repo: &Repository, file_path: &str) -> Result<String> {
    match repo.head() {
        Ok(head) => match head.peel_to_commit() {
            Ok(commit) => match commit.tree()?.get_path(Path::new(file_path)) {
                Ok(entry) => {
                    let blob = repo.find_blob(entry.id())?;
                    let content = std::str::from_utf8(blob.content())
                        .unwrap_or("")
                        .to_string();
                    Ok(content)
                }
                Err(_) => Ok(String::new()),
            },
            Err(_) => Ok(String::new()),
        },
        Err(_) => Ok(String::new()),
    }
}

pub fn is_git_repo(path: &Path) -> bool {
    Repository::open(path).is_ok()
}
