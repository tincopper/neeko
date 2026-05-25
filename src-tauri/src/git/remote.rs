use anyhow::Result;

use crate::models::{
    AheadBehind, AuthMethod, CommitDetail, CommitEntry, CommitFileChange, CommitResult, DiffHunk,
    DiffLine, DiffResult, FileChange, FileNode, FileStatus, GitInfo,
};
use crate::utils::command::ssh::{exec_command, safe_path};

use super::parsers::{
    build_file_tree_from_find, extract_commit_hash_from_output,
    parse_commit_log_output, parse_git_info_output, parse_status_line, parse_unified_diff,
};

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

    let cmd = format!(
        "cd '{}' && git diff --quiet -- 2>/dev/null; echo EXIT_CODE:$?",
        sp
    );
    if let Ok(output) = exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    let cmd = format!(
        "cd '{}' && git diff --cached --quiet -- 2>/dev/null; echo EXIT_CODE:$?",
        sp
    );
    if let Ok(output) = exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

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

// ─── Extended Remote git helper functions ────────────────────────────────────

/// 通过 SSH 获取 commit 日志列表
pub async fn remote_get_commit_log(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    count: usize,
    skip: usize,
) -> Result<Vec<CommitEntry>> {
    let sp = safe_path(project_path);
    let format_str = "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D%x00%P";
    let skip_part = if skip > 0 {
        format!(" --skip={}", skip)
    } else {
        String::new()
    };
    let cmd = format!(
        "cd '{sp}' && git log '{format_str}' -{count} --decorate=full --all --topo-order{skip_part} 2>/dev/null"
    );
    let output = exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_commit_log_output(&output))
}

/// 通过 SSH 获取单个 commit 详细信息
pub async fn remote_get_commit_detail_fn(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    commit_hash: &str,
) -> Result<CommitDetail> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);
    let format_str = "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%B%x00%P%x00%D";
    let cmd = format!("cd '{sp}' && git show '{format_str}' --no-patch '{ch}' 2>/dev/null");
    let output = exec_command(host, port, username, auth, &cmd).await?;

    let parts: Vec<&str> = output.split('\0').collect();
    if parts.len() < 7 {
        anyhow::bail!(
            "Unexpected git show output format for commit: {}",
            commit_hash
        );
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

/// 通过 SSH 获取某 commit 改动的文件列表
pub async fn remote_get_commit_files_fn(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    commit_hash: &str,
) -> Result<Vec<CommitFileChange>> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);

    let numstat_cmd =
        format!("cd '{sp}' && git diff-tree --no-commit-id -r --numstat '{ch}' 2>/dev/null");
    let numstat_out = exec_command(host, port, username, auth, &numstat_cmd).await?;

    let status_cmd =
        format!("cd '{sp}' && git diff-tree --no-commit-id -r --name-status '{ch}' 2>/dev/null");
    let status_out = exec_command(host, port, username, auth, &status_cmd).await?;

    let status_map: std::collections::HashMap<String, String> = status_out
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

    let files: Vec<CommitFileChange> = numstat_out
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

/// 通过 SSH 获取某 commit 中某文件的 diff
pub async fn remote_get_commit_file_diff_fn(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    commit_hash: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);
    let fp = safe_path(file_path);
    let cmd = format!("cd '{sp}' && git diff '{ch}^' '{ch}' -- '{fp}' 2>/dev/null");
    let output = exec_command(host, port, username, auth, &cmd).await?;
    let mut result = parse_unified_diff(&output);
    super::parsers::collapse_diff_context(&mut result.hunks, 12);
    Ok(result)
}

/// 通过 SSH 获取 ahead/behind 计数
pub async fn remote_get_ahead_behind_fn(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
) -> Result<AheadBehind> {
    let sp = safe_path(project_path);
    let upstream_check = exec_command(
        host,
        port,
        username,
        auth,
        &format!(
            "cd '{sp}' && git rev-parse --abbrev-ref HEAD@{{upstream}} 2>/dev/null; echo EXIT:$?"
        ),
    )
    .await;
    match upstream_check {
        Ok(ref out) if out.contains("EXIT:0") => {}
        _ => {
            return Ok(AheadBehind {
                ahead: 0,
                behind: 0,
            });
        }
    }

    let cmd = format!("cd '{sp}' && git rev-list --left-right --count HEAD...@{{u}} 2>/dev/null");
    match exec_command(host, port, username, auth, &cmd).await {
        Ok(output) => {
            let trimmed = output.trim().to_string();
            let parts: Vec<&str> = trimmed.split('\t').collect();
            Ok(AheadBehind {
                ahead: parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
                behind: parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            })
        }
        Err(_) => Ok(AheadBehind {
            ahead: 0,
            behind: 0,
        }),
    }
}

/// 通过 SSH 执行 git commit（先 stage 指定文件，再 commit）
pub async fn remote_commit_files_fn(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    file_paths: &[String],
    message: &str,
) -> Result<CommitResult> {
    let sp = safe_path(project_path);

    if !file_paths.is_empty() {
        let quoted_files: Vec<String> = file_paths
            .iter()
            .map(|f| format!("'{}'", safe_path(f)))
            .collect();
        let stage_cmd = format!("cd '{sp}' && git add -- {}", quoted_files.join(" "));
        exec_command(host, port, username, auth, &stage_cmd).await?;
    }

    let safe_msg = message.replace('\'', "'\\''");
    let commit_cmd = format!("cd '{sp}' && git commit -m '{safe_msg}'");
    let output = exec_command(host, port, username, auth, &commit_cmd).await?;

    let hash = extract_commit_hash_from_output(&output).unwrap_or_default();
    Ok(CommitResult {
        success: true,
        hash,
        message: message.to_string(),
    })
}

/// 通过 SSH 读取目录树（使用 find 命令）
pub async fn remote_read_dir_tree_fn(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    root_path: &str,
    sub_path: Option<&str>,
    max_depth: u32,
) -> Result<Vec<FileNode>> {
    let effective_sub = sub_path.filter(|sp| !sp.is_empty());
    let actual_path = match effective_sub {
        Some(sp) => format!("{}/{}", root_path, sp),
        None => root_path.to_string(),
    };
    let safe_ap = safe_path(&actual_path);

    let cmd = format!(
        "find '{safe_ap}' -maxdepth {max_depth} \
         -not -path '*/.git/*' \
         -not -path '*/node_modules/*' \
         -not -path '*/target/*' \
         -not -name '.git' \
         2>/dev/null | sort"
    );
    let output = exec_command(host, port, username, auth, &cmd).await?;
    let mut tree = build_file_tree_from_find(&output, &actual_path)?;

    // 如果使用了 sub_path，需要将路径修正为相对于项目根的完整路径
    if let Some(sp) = effective_sub {
        prefix_paths_remote(&mut tree, sp);
    }

    Ok(tree)
}

/// 递归给所有节点的 path 字段加上前缀（确保路径相对于项目根）
fn prefix_paths_remote(nodes: &mut Vec<FileNode>, prefix: &str) {
    for node in nodes.iter_mut() {
        node.path = format!("{}/{}", prefix, node.path);
        if !node.children.is_empty() {
            prefix_paths_remote(&mut node.children, prefix);
        }
    }
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
