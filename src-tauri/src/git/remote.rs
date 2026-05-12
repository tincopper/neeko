use anyhow::Result;
use std::path::PathBuf;

use crate::models::{
    AheadBehind, AuthMethod, CommitDetail, CommitEntry, CommitFileChange, CommitResult, DiffHunk,
    DiffLine, DiffResult, FileChange, FileNode, FileStatus, GitInfo, Worktree,
};
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

// ─── Shared parsing helpers (used by both remote and wsl modules) ────────────

/// 解析 git log 的 NUL 分隔格式输出为 CommitEntry 列表
pub(crate) fn parse_commit_log_output(output: &str) -> Vec<CommitEntry> {
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

/// 从 git commit 输出中提取 commit hash（"[branch abc1234] ..."）
pub(crate) fn extract_commit_hash_from_output(output: &str) -> Option<String> {
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

/// 从 find 命令输出构建文件树（适用于 SSH/WSL 两侧）
pub(crate) fn build_file_tree_from_find(
    find_output: &str,
    root_path: &str,
) -> Result<Vec<FileNode>> {
    use std::collections::HashMap;

    let mut path_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_paths: Vec<String> = Vec::new();

    for line in find_output.lines() {
        let p = line.trim();
        if p.is_empty() || p == root_path {
            continue;
        }
        path_set.insert(p.to_string());
        all_paths.push(p.to_string());
    }

    // Determine which paths are directories (they have children)
    let mut is_dir_map: HashMap<String, bool> = HashMap::new();
    for p in &all_paths {
        is_dir_map.entry(p.clone()).or_insert(false);
        if let Some(parent) = std::path::Path::new(p).parent() {
            let parent_str = parent.to_string_lossy().to_string();
            if parent_str != root_path && path_set.contains(&parent_str) {
                is_dir_map.insert(parent_str, true);
            }
        }
    }

    let mut top_level: Vec<FileNode> = Vec::new();
    for p in &all_paths {
        let parent = std::path::Path::new(p)
            .parent()
            .map(|pp| pp.to_string_lossy().to_string())
            .unwrap_or_default();
        if parent == root_path {
            let name = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let is_dir = *is_dir_map.get(p).unwrap_or(&false);
            let children = if is_dir {
                collect_file_tree_children(p, &all_paths, &is_dir_map, root_path)
            } else {
                vec![]
            };
            let rel_path = p
                .strip_prefix(&format!("{}/", root_path))
                .or_else(|| p.strip_prefix(root_path))
                .unwrap_or(p)
                .to_string();
            top_level.push(FileNode {
                name,
                path: rel_path,
                is_dir,
                children,
            });
        }
    }

    top_level.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(top_level)
}

pub(crate) fn collect_file_tree_children(
    dir_path: &str,
    all_paths: &[String],
    is_dir_map: &std::collections::HashMap<String, bool>,
    root_path: &str,
) -> Vec<FileNode> {
    let mut children: Vec<FileNode> = Vec::new();
    for p in all_paths {
        let parent = std::path::Path::new(p)
            .parent()
            .map(|pp| pp.to_string_lossy().to_string())
            .unwrap_or_default();
        if parent == dir_path {
            let name = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let is_dir = *is_dir_map.get(p).unwrap_or(&false);
            let grandchildren = if is_dir {
                collect_file_tree_children(p, all_paths, is_dir_map, root_path)
            } else {
                vec![]
            };
            let rel_path = p
                .strip_prefix(&format!("{}/", root_path))
                .or_else(|| p.strip_prefix(root_path))
                .unwrap_or(p)
                .to_string();
            children.push(FileNode {
                name,
                path: rel_path,
                is_dir,
                children: grandchildren,
            });
        }
    }

    children.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    children
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
    super::local::collapse_diff_context(&mut result.hunks, 12);
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
    let actual_path = match sub_path {
        Some(sp) if !sp.is_empty() => format!("{}/{}", root_path, sp),
        _ => root_path.to_string(),
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
    build_file_tree_from_find(&output, &actual_path)
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
