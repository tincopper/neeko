use crate::models::{
    CommitDetail, CommitEntry, CommitFileChange, DiffHunk, DiffLine, DiffResult, FileChange,
    FileStatus, GitInfo, Worktree,
};
use crate::utils::command::local::exec;
use anyhow::{Context, Result};
use git2::{BranchType, Repository, Status, StatusOptions};
use std::path::{Path, PathBuf};

use super::invalidate_repo_caches;

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

            let file_status = if status.contains(Status::INDEX_NEW) {
                FileStatus::Added
            } else if status.contains(Status::WT_NEW) {
                FileStatus::Untracked
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
                if (file.status == FileStatus::Added || file.status == FileStatus::Untracked)
                    && file.additions == 0
                    && file.deletions == 0
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
                if let Ok(output) = exec("git")
                    .args(["-C", wt_path_str, "rev-parse", "--abbrev-ref", "HEAD"])
                    .output()
                {
                    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let branch = if branch.is_empty() {
                        "HEAD".to_string()
                    } else {
                        branch
                    };

                    if let Ok(output) = exec("git")
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

    invalidate_repo_caches(repo_path);
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
        truncated: false,
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

    let output = exec("git")
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
    let output = exec("git")
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
    let diff_output = exec("git")
        .args(["diff", "--quiet", "--"])
        .current_dir(wt_path_str)
        .output()
        .context("Failed to run git diff")?;

    if !diff_output.status.success() {
        return Ok(true);
    }

    // 检查暂存区
    let cached_output = exec("git")
        .args(["diff", "--cached", "--quiet", "--"])
        .current_dir(wt_path_str)
        .output()
        .context("Failed to run git diff --cached")?;

    if !cached_output.status.success() {
        return Ok(true);
    }

    // 检查未跟踪文件
    let untracked_output = exec("git")
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
    let output = exec("git")
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
    invalidate_repo_caches(repo_path);
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

    let output = exec("git")
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

    DiffResult {
        hunks,
        truncated: false,
    }
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

/// 将连续上下文的中间部分折叠（参考 Muxy GitDiffParser.collapseContextRows）
fn flush_context_buffer(
    collapsed_lines: &mut Vec<DiffLine>,
    buffer: &mut Vec<DiffLine>,
    threshold: usize,
    keep_edges: usize,
) {
    let count = buffer.len();
    let min_keep = keep_edges * 2;
    if count > threshold && count > min_keep {
        let middle = count - min_keep;
        collapsed_lines.extend(buffer.drain(..keep_edges));
        collapsed_lines.push(DiffLine::Collapsed(format!("{} unmodified lines", middle)));
        buffer.drain(..middle);
        collapsed_lines.extend(buffer.drain(..));
    } else {
        collapsed_lines.extend(buffer.drain(..));
    }
}

/// 折叠连续上下文行（参考 Muxy GitDiffParser.collapseContextRows），保留前后 3 行
pub fn collapse_diff_context(hunks: &mut Vec<DiffHunk>, threshold: usize) {
    for hunk in hunks.iter_mut() {
        let mut collapsed_lines: Vec<DiffLine> = Vec::new();
        let mut context_buffer: Vec<DiffLine> = Vec::new();
        for line in hunk.lines.drain(..) {
            match &line {
                DiffLine::Context(_) => context_buffer.push(line),
                _ => {
                    flush_context_buffer(&mut collapsed_lines, &mut context_buffer, threshold, 3);
                    collapsed_lines.push(line);
                }
            }
        }
        flush_context_buffer(&mut collapsed_lines, &mut context_buffer, threshold, 3);
        hunk.lines = collapsed_lines;
    }
}

/// CLI 方式获取文件 diff（工作区 vs index，仅未暂存变更）
pub fn get_file_diff_cli(
    repo_path: &Path,
    file_path: &str,
    line_limit: Option<usize>,
) -> Result<DiffResult> {
    let output = exec("git")
        .args(["diff", "-U3", "--", file_path])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff")?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut result = parse_unified_diff(&stdout);

    // Fallback for untracked/added files: git diff returns empty for files
    // not yet in HEAD (new files staged or untracked). Read the file directly
    // and present all lines as Added so the user can see the content.
    if result.hunks.is_empty() {
        let full_path = repo_path.join(file_path);
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

    if let Some(limit) = line_limit {
        let mut total = 0;
        for hunk in result.hunks.iter() {
            total += hunk.lines.len();
        }
        if total > limit {
            result.truncated = true;
            let mut current = 0;
            for hunk in result.hunks.iter_mut() {
                let remaining = limit.saturating_sub(current);
                if remaining == 0 {
                    hunk.lines.clear();
                } else if hunk.lines.len() > remaining {
                    hunk.lines.truncate(remaining);
                }
                current += hunk.lines.len();
            }
            result.hunks.retain(|h| !h.lines.is_empty());
        }
    }
    collapse_diff_context(&mut result.hunks, 12);
    Ok(result)
}

/// Stage 指定文件
pub fn stage_files(repo_path: &Path, file_paths: &[String]) -> Result<()> {
    if file_paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    args.extend(file_paths.iter().map(|s| s.as_str()));
    let output = exec("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git add")?;
    if !output.status.success() {
        anyhow::bail!(
            "git add failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Unstage 指定文件
pub fn unstage_files(repo_path: &Path, file_paths: &[String]) -> Result<()> {
    if file_paths.is_empty() {
        return Ok(());
    }
    for path in file_paths {
        let output = exec("git")
            .args(["reset", "HEAD", "--", path])
            .current_dir(repo_path)
            .output()
            .context("Failed to run git reset HEAD")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("unknown revision") || stderr.contains("ambiguous") {
                let rm_output = exec("git")
                    .args(["rm", "--cached", "-f", "--", path])
                    .current_dir(repo_path)
                    .output()
                    .context("Failed to run git rm --cached")?;
                if !rm_output.status.success() {
                    anyhow::bail!(
                        "git rm --cached failed for '{}': {}",
                        path,
                        String::from_utf8_lossy(&rm_output.stderr).trim()
                    );
                }
                continue;
            }
            anyhow::bail!("git reset HEAD failed for '{}': {}", path, stderr.trim());
        }
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Stage 所有变更
pub fn stage_all(repo_path: &Path) -> Result<()> {
    let output = exec("git")
        .args(["add", "-A"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git add -A")?;
    if !output.status.success() {
        anyhow::bail!(
            "git add -A failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Unstage 所有变更（兼容无 HEAD 的新仓库）
pub fn unstage_all(repo_path: &Path) -> Result<()> {
    let output = exec("git")
        .args(["reset", "HEAD"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git reset HEAD")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("unknown revision") || stderr.contains("ambiguous") {
            let rm_output = exec("git")
                .args(["rm", "--cached", "-r", "."])
                .current_dir(repo_path)
                .output()
                .context("Failed to run git rm --cached -r .")?;
            if !rm_output.status.success() {
                anyhow::bail!(
                    "git rm --cached failed: {}",
                    String::from_utf8_lossy(&rm_output.stderr).trim()
                );
            }
        } else {
            anyhow::bail!("git reset HEAD failed: {}", stderr.trim());
        }
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Discard 单个文件的变更（理解为：恢复到 HEAD 版本）
/// - 未跟踪文件 → 删除
/// - 已暂存文件 → 先 unstage 再恢复工作区
/// - 仅工作区修改 → 恢复到 index 版本
pub fn discard_file(repo_path: &Path, file_path: &str) -> Result<()> {
    let output = exec("git")
        .args(["status", "--porcelain=1", "-z", "--", file_path])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git status")?;

    let stdout_bytes = &output.stdout;
    if stdout_bytes.is_empty() {
        anyhow::bail!("File '{}' has no changes to discard.", file_path);
    }

    let x = stdout_bytes.first().copied().unwrap_or(b' ');
    let y = stdout_bytes.get(1).copied().unwrap_or(b' ');

    // ?? → 未跟踪文件：直接删除
    if x == b'?' && y == b'?' {
        let full_path = repo_path.join(file_path);
        if full_path.exists() {
            std::fs::remove_file(&full_path)?;
        }
        return Ok(());
    }

    // X (index) 有变更 → 先 reset HEAD 撤销暂存
    if x != b' ' && x != b'?' {
        let reset = exec("git")
            .args(["reset", "HEAD", "--", file_path])
            .current_dir(repo_path)
            .output()
            .context("Failed to run git reset HEAD")?;
        if !reset.status.success() {
            let stderr = String::from_utf8_lossy(&reset.stderr);
            if !stderr.contains("unknown revision") && !stderr.contains("ambiguous") {
                anyhow::bail!("git reset HEAD failed: {}", stderr.trim());
            }
            // 新仓库无 HEAD，尝试 git rm --cached
            if x == b'A' {
                let rm_cached = exec("git")
                    .args(["rm", "--cached", "-f", "--", file_path])
                    .current_dir(repo_path)
                    .output()
                    .context("Failed to run git rm --cached")?;
                if !rm_cached.status.success() {
                    anyhow::bail!(
                        "git rm --cached failed: {}",
                        String::from_utf8_lossy(&rm_cached.stderr).trim()
                    );
                }
            }
        }
    }

    // y (worktree) 有变更 → checkout 恢复文件
    if y != b' ' && y != b'?' {
        let checkout = exec("git")
            .args(["checkout", "--", file_path])
            .current_dir(repo_path)
            .output()
            .context("Failed to run git checkout")?;
        if !checkout.status.success() {
            anyhow::bail!(
                "git checkout failed: {}",
                String::from_utf8_lossy(&checkout.stderr).trim()
            );
        }
    }

    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Discard 所有变更
pub fn discard_all(repo_path: &Path) -> Result<()> {
    let output = exec("git")
        .args(["checkout", "--", "."])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git checkout -- .")?;
    if !output.status.success() {
        anyhow::bail!(
            "git checkout -- . failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let output = exec("git")
        .args(["clean", "-fd"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git clean -fd")?;
    if !output.status.success() {
        anyhow::bail!(
            "git clean -fd failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Commit 暂存区变更
pub fn commit(repo_path: &Path, message: &str) -> Result<CommitResult> {
    let output = exec("git")
        .args(["commit", "-m", message])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git commit")?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("nothing to commit") || stderr.contains("nothing added") {
            anyhow::bail!(
                "No staged changes. Select files and click 'Stage Selected' first, then commit."
            );
        }
        anyhow::bail!("git commit failed: {}", stderr.trim());
    }
    let hash = extract_commit_hash(&combined).unwrap_or_default();
    invalidate_repo_caches(repo_path);
    Ok(CommitResult {
        success: true,
        hash,
        message: message.to_string(),
    })
}

/// Commit 选中文件
pub fn commit_files(
    repo_path: &Path,
    file_paths: &[String],
    message: &str,
) -> Result<CommitResult> {
    stage_files(repo_path, file_paths)?;
    commit(repo_path, message)
}

/// Commit 并 Push
pub fn commit_and_push(repo_path: &Path, message: &str) -> Result<CommitResult> {
    let commit_result = commit(repo_path, message)?;
    push(repo_path, false)?;
    Ok(commit_result)
}

/// Fetch 远程更新
pub fn fetch(repo_path: &Path) -> Result<()> {
    let output = exec("git")
        .args(["fetch"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git fetch")?;
    if !output.status.success() {
        anyhow::bail!(
            "git fetch failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Pull 远程更新（参考 Muxy upstream 检测模式）
/// 拆为 fetch + merge --ff-only，避免 git pull 混合 stderr 难以排查
pub fn pull(repo_path: &Path) -> Result<()> {
    let branch = get_current_branch_via_cli(repo_path)?;
    let remote_branch = format!("origin/{}", branch);

    // Step 1: fetch
    let output = exec("git")
        .args(["fetch", "origin", &branch])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git fetch")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git fetch origin {} failed: {}", branch, stderr.trim());
    }

    // Step 2: merge --ff-only (只允许快进，避免冲突)
    let output = exec("git")
        .args(["merge", "--ff-only", &remote_branch])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git merge")?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 过滤 remote: 信息行，只展示本地错误
        let msg = if stdout.trim().is_empty() {
            stderr
                .lines()
                .filter(|l| !l.trim_start().starts_with("remote: "))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
        } else {
            stdout.trim().to_string()
        };
        let msg = if msg.is_empty() {
            "merge failed (no details)".to_string()
        } else {
            msg
        };
        anyhow::bail!("git merge {} failed: {}", remote_branch, msg);
    }

    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Push 到远程（参考 Muxy upstream 检测模式）
pub fn push(repo_path: &Path, set_upstream: bool) -> Result<()> {
    let branch = get_current_branch_via_cli(repo_path)?;
    let has_upstream = check_upstream(repo_path, &branch)?;
    if !set_upstream && !has_upstream {
        anyhow::bail!(
            "No upstream configured for branch '{}'. Push with --set-upstream to push.",
            branch
        );
    }
    let mut args = vec!["push"];
    if set_upstream {
        args.push("--set-upstream");
    }
    args.push("origin");
    args.push(&branch);
    let result = exec("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git push")?;
    if !result.status.success() {
        anyhow::bail!(
            "git push failed: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// 获取 Commit 历史（参考 Muxy git log 格式）
pub fn get_commit_log(repo_path: &Path, count: usize, skip: usize) -> Result<Vec<CommitEntry>> {
    let format = "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D%x00%P";
    let count_str = format!("-{}", count);
    let skip_str = if skip > 0 {
        Some(format!("--skip={}", skip))
    } else {
        None
    };
    let mut args = vec![
        "log",
        format,
        count_str.as_str(),
        "--decorate=full",
        "--all",
        "--topo-order",
    ];
    if let Some(ref s) = skip_str {
        args.push(s.as_str());
    }
    let output = exec("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git log")?;
    if !output.status.success() {
        anyhow::bail!(
            "git log failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(parse_commit_log(&String::from_utf8_lossy(&output.stdout)))
}

/// 获取 Ahead/Behind 计数（参考 Muxy）
pub fn get_ahead_behind(repo_path: &Path) -> Result<AheadBehind> {
    let branch = get_current_branch_via_cli(repo_path)?;
    if !check_upstream(repo_path, &branch)? {
        return Ok(AheadBehind {
            ahead: 0,
            behind: 0,
        });
    }
    let output = exec("git")
        .args([
            "rev-list",
            "--left-right",
            "--count",
            &format!("origin/{}...{}", branch, branch),
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git rev-list --left-right --count")?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = stdout.split('\t').collect();
    Ok(AheadBehind {
        ahead: parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
        behind: parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
    })
}

fn get_current_branch_via_cli(repo_path: &Path) -> Result<String> {
    let output = exec("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get current branch")?;
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch == "HEAD" {
        anyhow::bail!(
            "Cannot perform this operation on a detached HEAD. Please checkout a branch first."
        );
    }
    Ok(branch)
}

fn check_upstream(repo_path: &Path, branch: &str) -> Result<bool> {
    Ok(exec("git")
        .args([
            "rev-parse",
            "--abbrev-ref",
            &format!("{}@{{upstream}}", branch),
        ])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false))
}

fn extract_commit_hash(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            // 支持 "[branch abc1234]" 和 "[detached HEAD abc1234]" 格式
            if let Some(idx) = trimmed.find("] ") {
                let bracket_content = &trimmed[1..idx];
                // 取最后一个空格后的部分作为 hash
                if let Some(last_space) = bracket_content.rfind(' ') {
                    return Some(bracket_content[last_space + 1..].to_string());
                }
                // 如果没有空格，整个内容就是 hash（如 "[abc1234]"）
                return Some(bracket_content.to_string());
            }
        }
    }
    None
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

/// 获取单个 Commit 详细信息
pub fn get_commit_detail(repo_path: &Path, commit_hash: &str) -> Result<CommitDetail> {
    let format = "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%B%x00%P%x00%D";
    let output = exec("git")
        .args(["show", format, "--no-patch", commit_hash])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git show")?;
    if !output.status.success() {
        anyhow::bail!(
            "git show failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Split by NUL — the message body (%B) may contain newlines,
    // so we must not use lines() which would split on those.
    let parts: Vec<&str> = stdout.split('\0').collect();
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

/// 获取某个 Commit 改动的文件列表
pub fn get_commit_files(repo_path: &Path, commit_hash: &str) -> Result<Vec<CommitFileChange>> {
    let output = exec("git")
        .args([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--numstat",
            commit_hash,
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff-tree --numstat")?;
    if !output.status.success() {
        anyhow::bail!(
            "git diff-tree --numstat failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let stdout = String::from_utf8_lossy(&output.stdout);

    let status_output = exec("git")
        .args([
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--name-status",
            commit_hash,
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff-tree --name-status")?;
    let status_stdout = String::from_utf8_lossy(&status_output.stdout);

    let status_map: std::collections::HashMap<String, String> = status_stdout
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

    let files: Vec<CommitFileChange> = stdout
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

/// 获取某个 Commit 中某个文件的 diff
pub fn get_commit_file_diff(
    repo_path: &Path,
    commit_hash: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let output = exec("git")
        .args([
            "diff",
            &format!("{}^", commit_hash),
            commit_hash,
            "--",
            file_path,
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff for commit file")?;
    if !output.status.success() {
        // For initial commit (no parent), try git show
        let show_output = exec("git")
            .args(["show", &format!("{}:{}", commit_hash, file_path)])
            .current_dir(repo_path)
            .output();
        if let Ok(so) = show_output {
            if so.status.success() {
                // Return empty diff for initial commit file content
                return Ok(DiffResult {
                    hunks: vec![],
                    truncated: false,
                });
            }
        }
        anyhow::bail!(
            "git diff for commit file failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut result = parse_unified_diff(&stdout);
    collapse_diff_context(&mut result.hunks, 12);
    Ok(result)
}

/// Cherry-pick 指定 commit（参考 Muxy GitRepositoryService.cherryPick）
pub fn cherry_pick(repo_path: &Path, commit_hash: &str) -> Result<()> {
    let output = exec("git")
        .args(["cherry-pick", commit_hash])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git cherry-pick")?;
    if !output.status.success() {
        anyhow::bail!(
            "git cherry-pick failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Revert 指定 commit（参考 Muxy GitRepositoryService.revert）
pub fn revert(repo_path: &Path, commit_hash: &str) -> Result<()> {
    let output = exec("git")
        .args(["revert", "--no-edit", commit_hash])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git revert")?;
    if !output.status.success() {
        anyhow::bail!(
            "git revert failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// 创建 tag（参考 Muxy GitRepositoryService.createTag）
pub fn create_tag(repo_path: &Path, name: &str, message: Option<&str>) -> Result<()> {
    let mut args = vec!["tag", "-a", name, "-m"];
    args.push(message.unwrap_or(name));
    let output = exec("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git tag")?;
    if !output.status.success() {
        anyhow::bail!(
            "git tag failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Checkout detached HEAD（参考 Muxy GitRepositoryService.checkoutDetached）
pub fn checkout_detached(repo_path: &Path, commit_hash: &str) -> Result<()> {
    let output = exec("git")
        .args(["checkout", commit_hash])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git checkout (detached)")?;
    if !output.status.success() {
        anyhow::bail!(
            "git checkout detached failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// 创建并切换分支（参考 Muxy GitRepositoryService.createAndSwitchBranch）
pub fn create_and_switch_branch(repo_path: &Path, branch_name: &str) -> Result<()> {
    let output = exec("git")
        .args(["checkout", "-b", branch_name])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git checkout -b")?;
    if !output.status.success() {
        anyhow::bail!(
            "git checkout -b failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// 获取默认分支名（纯本地操作，无需联网）
pub fn default_branch(repo_path: &Path) -> Result<String> {
    let rp = repo_path.to_path_buf();
    super::cache::get_cached_default_branch(repo_path, || {
        // 优先从 refs/remotes/origin/HEAD 符号引用读取（纯本地）
        let output = exec("git")
            .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
            .current_dir(&rp)
            .output()
            .context("Failed to resolve origin/HEAD")?;
        if output.status.success() {
            let full_ref = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }
        // 回退：检查本地是否有 origin/main 或 origin/master
        for candidate in &["main", "master"] {
            if exec("git")
                .args([
                    "rev-parse",
                    "--verify",
                    &format!("refs/remotes/origin/{}", candidate),
                ])
                .current_dir(&rp)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Ok(candidate.to_string());
            }
        }
        Ok("main".to_string())
    })
}

/// 获取仓库 web URL（参考 Muxy GitRepositoryService.remoteWebURL）
pub fn remote_web_url(repo_path: &Path) -> Result<String> {
    let output = exec("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get remote URL")?;
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if let Some(rest) = url.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            return Ok(format!(
                "https://{}/{}",
                host,
                path.strip_suffix(".git").unwrap_or(path)
            ));
        }
    }
    if let Some(rest) = url.strip_prefix("ssh://") {
        // ssh://[user@]host[:port]/path
        let after_at = rest.split('@').nth(1).unwrap_or(rest);
        let (host_port, path) = after_at.split_once('/').unwrap_or((after_at, ""));
        // Strip SSH port — HTTPS uses 443
        let host = host_port.split(':').next().unwrap_or(host_port);
        if !path.is_empty() {
            return Ok(format!(
                "https://{}/{}",
                host,
                path.strip_suffix(".git").unwrap_or(path)
            ));
        }
    }
    Ok(url.strip_suffix(".git").unwrap_or(&url).to_string())
}

use crate::models::{AheadBehind, CommitResult};

/// 获取指定文件相对于 HEAD 的 diff（未 staged 也包含）。
/// 优先取 `git diff HEAD -- files`，新文件（untracked）回退到直接读文件内容。
/// 超过 `line_limit` 行时截断并附加 stat 摘要。
pub fn get_diff_for_files(repo_path: &Path, file_paths: &[String], line_limit: usize) -> Result<String> {
    if file_paths.is_empty() {
        return Ok(String::new());
    }

    // git diff HEAD -- file1 file2 ...（包含已 stage 和未 stage 的变更）
    let mut args = vec!["diff", "HEAD", "--"];
    args.extend(file_paths.iter().map(|s| s.as_str()));

    let diff_output = exec("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff HEAD")?;

    let mut diff_text = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // 对于新文件（untracked），git diff HEAD 返回空；读文件内容补充
    if diff_text.trim().is_empty() {
        let mut lines: Vec<String> = Vec::new();
        for fp in file_paths {
            let full = repo_path.join(fp);
            if full.exists() {
                if let Ok(content) = std::fs::read_to_string(&full) {
                    lines.push(format!("--- /dev/null\n+++ b/{}", fp));
                    for line in content.lines() {
                        lines.push(format!("+{}", line));
                    }
                }
            }
        }
        diff_text = lines.join("\n");
    }

    if diff_text.trim().is_empty() {
        return Ok(String::new());
    }

    // stat 摘要
    let mut stat_args = vec!["diff", "HEAD", "--stat", "--"];
    stat_args.extend(file_paths.iter().map(|s| s.as_str()));
    let stat_output = exec("git")
        .args(&stat_args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff HEAD --stat")?;
    let stat_text = String::from_utf8_lossy(&stat_output.stdout).trim().to_string();

    let lines: Vec<&str> = diff_text.lines().collect();
    if lines.len() <= line_limit {
        Ok(diff_text)
    } else {
        let truncated = lines[..line_limit].join("\n");
        Ok(format!(
            "{}\n\n[diff truncated at {} lines]\n\nFile change summary:\n{}",
            truncated, line_limit, stat_text
        ))
    }
}

/// 获取 staged changes 的 unified diff（git diff --cached）。
/// 超过 `line_limit` 行时截断，并在末尾附加 `git diff --cached --stat` 摘要。
pub fn get_staged_diff(repo_path: &Path, line_limit: usize) -> Result<String> {
    // 获取完整的 staged diff
    let diff_output = exec("git")
        .args(["diff", "--cached"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff --cached")?;

    let diff_text = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // 获取 stat 摘要（总是附加，无论是否截断）
    let stat_output = exec("git")
        .args(["diff", "--cached", "--stat"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git diff --cached --stat")?;
    let stat_text = String::from_utf8_lossy(&stat_output.stdout).trim().to_string();

    if diff_text.trim().is_empty() {
        return Ok(String::new());
    }

    let lines: Vec<&str> = diff_text.lines().collect();
    if lines.len() <= line_limit {
        // diff 未超限，直接返回
        Ok(diff_text)
    } else {
        // 截断并附加 stat 摘要
        let truncated: String = lines[..line_limit].join("\n");
        Ok(format!(
            "{}\n\n[diff truncated at {} lines]\n\nFile change summary:\n{}",
            truncated, line_limit, stat_text
        ))
    }
}

/// 获取最近 N 条 commit message（仅 subject 行）。
pub fn get_recent_commit_messages(repo_path: &Path, count: usize) -> Result<Vec<String>> {
    let count_str = format!("-{}", count);
    let output = exec("git")
        .args(["log", count_str.as_str(), "--format=%s"])
        .current_dir(repo_path)
        .output()
        .context("Failed to run git log for recent messages")?;

    if !output.status.success() {
        // 空仓库或无提交记录时不报错，返回空列表
        return Ok(vec![]);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let messages: Vec<String> = text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(messages)
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
        assert_eq!(new_file_entry.unwrap().status, FileStatus::Untracked);
    }
}
