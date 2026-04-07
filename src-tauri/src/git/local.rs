use crate::state::{DiffHunk, DiffLine, DiffResult, FileChange, FileStatus, GitInfo, Worktree};
use anyhow::{Context, Result};
use git2::{BranchType, Repository, Status, StatusOptions};
use std::path::{Path, PathBuf};
use std::process::Command;

fn no_window_cmd(program: &str) -> Command {
    let cmd = Command::new(program);
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
}
