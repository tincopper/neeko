use anyhow::Result;
use std::path::PathBuf;

use crate::models::{AuthMethod, DiffHunk, DiffLine, DiffResult, FileChange, FileStatus, GitInfo, Worktree};
use crate::utils::command::ssh::{exec_command, safe_path};

use super::local::parse_unified_diff;

/// 通过 SSH 获取完整 GitInfo（1 次 SSH 连接）
pub async fn get_remote_git_info(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    let cmd = format!(
        "cd '{sp}' \
          && printf '__BRANCH__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__BRANCHES__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__WORKTREES__\\n' \
          && git worktree list --porcelain 2>/dev/null \
          && printf '\\n__STATUS__\\n' \
          && git status --porcelain 2>/dev/null"
    );
    let output = exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_git_info_output(&output))
}

/// 通过 SSH 获取文件 diff
pub async fn get_remote_file_diff(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let fp = safe_path(file_path);
    let cmd = format!("cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null");
    let output = exec_command(host, port, username, auth, &cmd).await?;
    let mut result = parse_unified_diff(&output);

    // Fallback for untracked/added files: read via cat over SSH
    if result.hunks.is_empty() {
        let cat_cmd = format!("cat '{sp}/{fp}' 2>/dev/null");
        if let Ok(content) = exec_command(host, port, username, auth, &cat_cmd).await {
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

    Ok(result)
}

/// 通过 SSH 执行通用 git 写操作
pub async fn run_remote_git(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    git_cmd: &str,
) -> Result<String> {
    let sp = safe_path(project_path);
    let cmd = format!("cd '{sp}' && {git_cmd}");
    exec_command(host, port, username, auth, &cmd).await
}

/// 解析合并 git 命令输出为 GitInfo
pub fn parse_git_info_output(output: &str) -> GitInfo {
    let mut current_branch = String::new();
    let mut branches = Vec::new();
    let mut worktrees = Vec::new();
    let mut changed_files = Vec::new();

    let mut section = "";
    let mut wt_path: Option<PathBuf> = None;
    let mut wt_head = String::new();
    let mut wt_branch = String::new();

    for line in output.lines() {
        match line.trim() {
            "__BRANCH__" => {
                section = "branch";
                continue;
            }
            "__BRANCHES__" => {
                section = "branches";
                continue;
            }
            "__WORKTREES__" => {
                section = "worktrees";
                continue;
            }
            "__STATUS__" => {
                section = "status";
                continue;
            }
            _ => {}
        }

        match section {
            "branch" => {
                if !line.trim().is_empty() {
                    current_branch = line.trim().to_string();
                }
            }
            "branches" => {
                let trimmed = line.trim();
                if trimmed.starts_with('*') {
                    let name = trimmed.trim_start_matches('*').trim();
                    branches.push(name.to_string());
                } else if !trimmed.is_empty() {
                    branches.push(trimmed.to_string());
                }
            }
            "worktrees" => {
                let trimmed = line.trim();
                if trimmed.starts_with("worktree ") {
                    // 如果之前有未完成的 worktree 条目，push
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_path = Some(PathBuf::from(&trimmed[9..]));
                    wt_head.clear();
                    wt_branch.clear();
                } else if trimmed.starts_with("HEAD ") {
                    wt_head = trimmed[5..].to_string();
                } else if trimmed.starts_with("branch refs/heads/") {
                    wt_branch = trimmed[18..].to_string();
                } else if trimmed == "detached" {
                    wt_branch = "(detached HEAD)".to_string();
                } else if trimmed == "bare" {
                    wt_branch = "(bare)".to_string();
                } else if trimmed.is_empty() {
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_head.clear();
                    wt_branch.clear();
                }
            }
            "status" => {
                if let Some(fc) = parse_status_line(line) {
                    changed_files.push(fc);
                }
            }
            _ => {}
        }
    }

    // 处理最后一个 worktree 条目（可能没有尾部空行）
    if let Some(path) = wt_path.take() {
        worktrees.push(Worktree {
            path,
            branch: wt_branch,
            head: wt_head,
        });
    }

    // 主 worktree（项目本身）是第一个条目，前端不需要显示
    if !worktrees.is_empty() {
        worktrees.remove(0);
    }

    let is_clean = changed_files.is_empty();

    GitInfo {
        current_branch,
        branches,
        worktrees,
        changed_files,
        is_clean,
    }
}

pub(crate) fn parse_status_line(line: &str) -> Option<FileChange> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // git status --porcelain 格式: XY path
    let status_chars = &trimmed[..2.min(trimmed.len())];
    let file_path = trimmed[2.min(trimmed.len())..].trim();

    if file_path.is_empty() {
        return None;
    }

    let file_status = if status_chars.contains('?') {
        FileStatus::Untracked
    } else if status_chars.contains('A') {
        FileStatus::Added
    } else if status_chars.contains('D') {
        FileStatus::Deleted
    } else if status_chars.contains('R') {
        FileStatus::Renamed
    } else {
        FileStatus::Modified
    };

    Some(FileChange {
        path: PathBuf::from(file_path),
        status: file_status,
        additions: 0,
        deletions: 0,
    })
}

/// 通过 SSH 获取 worktree 的变更文件列表
pub async fn get_remote_worktree_changed_files(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    let sp = safe_path(worktree_path);
    let cmd = format!("cd '{}' && git status --porcelain 2>/dev/null", sp);
    let output = exec_command(host, port, username, auth, &cmd).await?;

    let files: Vec<FileChange> = output
        .lines()
        .filter_map(|line| parse_status_line(line))
        .collect();

    Ok(files)
}

/// 通过 SSH 检查 worktree 是否有未提交的更改
pub async fn remote_is_worktree_dirty(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    worktree_path: &str,
) -> Result<bool> {
    let sp = safe_path(worktree_path);

    // 检查已跟踪文件的修改
    let cmd = format!(
        "cd '{}' && git diff --quiet -- 2>/dev/null; echo EXIT_CODE:$?",
        sp
    );
    if let Ok(output) = exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查暂存区
    let cmd = format!(
        "cd '{}' && git diff --cached --quiet -- 2>/dev/null; echo EXIT_CODE:$?",
        sp
    );
    if let Ok(output) = exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查未跟踪文件
    let cmd = format!(
        "cd '{}' && git ls-files --others --exclude-standard 2>/dev/null",
        sp
    );
    if let Ok(output) = exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().is_empty() {
            return Ok(true);
        }
    }

    Ok(false)
}

/// 通过 SSH 获取 worktree 中某文件的 diff
pub async fn get_remote_worktree_file_diff(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    worktree_path: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let sp = safe_path(worktree_path);
    let fp = safe_path(file_path);
    let cmd = format!(
        "cd '{}' && git diff --unified=3 -- '{}' 2>/dev/null",
        sp, fp
    );
    let output = exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_unified_diff(&output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_git_info_with_branch() {
        let output = "\
__BRANCH__
main

__BRANCHES__
main
feature/test

__WORKTREES__
worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/wt
HEAD def456
branch refs/heads/feature

__STATUS__";
        let info = parse_git_info_output(output);
        assert_eq!(info.current_branch, "main");
        assert_eq!(info.branches.len(), 2);
        // 主 worktree（第一条）被过滤，只保留 linked worktree
        assert_eq!(info.worktrees.len(), 1);
        assert_eq!(info.worktrees[0].branch, "feature");
        assert_eq!(info.worktrees[0].path.to_str().unwrap(), "/path/to/wt");
    }

    #[test]
    fn should_parse_status_line_modified() {
        let line = " M src/main.rs";
        let fc = parse_status_line(line).unwrap();
        assert_eq!(fc.path.to_str().unwrap(), "src/main.rs");
        assert!(matches!(fc.status, FileStatus::Modified));
    }

    #[test]
    fn should_parse_status_line_added() {
        let line = "A  new_file.rs";
        let fc = parse_status_line(line).unwrap();
        assert!(matches!(fc.status, FileStatus::Added));
    }

    #[test]
    fn should_parse_status_line_untracked() {
        let line = "?? untracked.txt";
        let fc = parse_status_line(line).unwrap();
        assert!(matches!(fc.status, FileStatus::Untracked));
    }

    #[test]
    fn should_parse_status_line_deleted() {
        let line = " D deleted.rs";
        let fc = parse_status_line(line).unwrap();
        assert!(matches!(fc.status, FileStatus::Deleted));
    }

    #[test]
    fn should_return_none_for_empty_line() {
        assert!(parse_status_line("").is_none());
        assert!(parse_status_line("   ").is_none());
    }

    #[test]
    fn should_parse_empty_output() {
        let info = parse_git_info_output("");
        assert!(info.current_branch.is_empty());
        assert!(info.branches.is_empty());
        assert!(info.worktrees.is_empty());
    }
}
