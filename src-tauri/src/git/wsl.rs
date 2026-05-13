use anyhow::Result;

use crate::models::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, DiffHunk, DiffLine,
    DiffResult, FileChange, FileNode, GitInfo,
};
use crate::utils::command::wsl::{exec, open_ide, safe_path};

use super::local::parse_unified_diff;
use super::remote::parse_git_info_output;

/// 通过 WSL 获取完整 GitInfo（通过 wsl.exe 调用）
pub fn get_wsl_git_info(distro: &str, project_path: &str) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    let output = exec(
        distro,
        &format!(
            "cd '{sp}' \
          && printf '__BRANCH__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__BRANCHES__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__WORKTREES__\\n' \
          && git worktree list --porcelain 2>/dev/null \
          && printf '\\n__STATUS__\\n' \
          && git status --porcelain 2>/dev/null"
        ),
    )?;

    Ok(parse_git_info_output(&output))
}

/// 通过 WSL 获取文件 diff
pub fn get_wsl_file_diff(distro: &str, project_path: &str, file_path: &str) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let fp = safe_path(file_path);
    let output = exec(
        distro,
        &format!("cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"),
    )?;
    let mut result = parse_unified_diff(&output);

    // Fallback for untracked/added files: read via cat inside WSL
    if result.hunks.is_empty() {
        if let Ok(content) = exec(distro, &format!("cat '{sp}/{fp}' 2>/dev/null")) {
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

/// 通过 WSL 执行通用 git 写操作（checkout/create_branch/rename 等）
pub fn run_wsl_git(distro: &str, project_path: &str, git_args: &[&str]) -> Result<String> {
    let sp = safe_path(project_path);
    // 每个参数单独用单引号包裹，防止包含空格的分支名被 shell 拆分
    let quoted_args: Vec<String> = git_args
        .iter()
        .map(|a| format!("'{}'", safe_path(a)))
        .collect();
    let git_cmd = format!("cd '{}' && git {}", sp, quoted_args.join(" "));
    exec(distro, &git_cmd)
}

/// 通过 WSL 打开 IDE
pub fn open_wsl_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    open_ide(distro, project_path, ide)
}

/// 通过 WSL 获取 worktree 的变更文件列表
pub fn get_wsl_worktree_changed_files(
    distro: &str,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    let sp = safe_path(worktree_path);
    let output = exec(
        distro,
        &format!("cd '{sp}' && git status --porcelain 2>/dev/null"),
    )?;

    let files: Vec<FileChange> = output
        .lines()
        .filter_map(|line| super::remote::parse_status_line(line))
        .collect();

    Ok(files)
}

/// 通过 WSL 检查 worktree 是否有未提交的更改
pub fn wsl_is_worktree_dirty(distro: &str, worktree_path: &str) -> Result<bool> {
    let sp = safe_path(worktree_path);

    // 检查已跟踪文件的修改
    let diff_result = exec(
        distro,
        &format!("cd '{sp}' && git diff --quiet -- 2>/dev/null; echo EXIT_CODE:$?"),
    );
    if let Ok(output) = &diff_result {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查暂存区
    let cached_result = exec(
        distro,
        &format!("cd '{sp}' && git diff --cached --quiet -- 2>/dev/null; echo EXIT_CODE:$?"),
    );
    if let Ok(output) = &cached_result {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查未跟踪文件
    let untracked_result = exec(
        distro,
        &format!("cd '{sp}' && git ls-files --others --exclude-standard 2>/dev/null"),
    );
    if let Ok(output) = &untracked_result {
        if !output.trim().is_empty() {
            return Ok(true);
        }
    }

    Ok(false)
}

/// 通过 WSL 获取 worktree 中某文件的 diff
pub fn get_wsl_worktree_file_diff(
    distro: &str,
    worktree_path: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let sp = safe_path(worktree_path);
    let fp = safe_path(file_path);
    let output = exec(
        distro,
        &format!("cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"),
    )?;
    let mut result = parse_unified_diff(&output);

    // Fallback for untracked/added files: read via cat inside WSL
    if result.hunks.is_empty() {
        if let Ok(content) = exec(distro, &format!("cat '{sp}/{fp}' 2>/dev/null")) {
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

// ─── New helper functions for extended WSL git commands ──────────────────

/// 通过 WSL 执行 git log，返回 CommitEntry 列表
pub fn wsl_get_commit_log(
    distro: &str,
    project_path: &str,
    count: usize,
    skip: usize,
) -> Result<Vec<CommitEntry>> {
    let sp = safe_path(project_path);
    let format_str = "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D%x00%P";
    let count_str = format!("-{}", count);
    let skip_str = format!("--skip={}", skip);

    let cmd = if skip > 0 {
        format!(
            "cd '{sp}' && git log '{format_str}' '{count_str}' --decorate=full --all --topo-order '{skip_str}' 2>/dev/null",
            sp = sp,
            format_str = format_str,
            count_str = count_str,
            skip_str = skip_str
        )
    } else {
        format!(
            "cd '{sp}' && git log '{format_str}' '{count_str}' --decorate=full --all --topo-order 2>/dev/null",
            sp = sp,
            format_str = format_str,
            count_str = count_str
        )
    };

    let output = exec(distro, &cmd)?;
    Ok(parse_wsl_commit_log(&output))
}

fn parse_wsl_commit_log(output: &str) -> Vec<CommitEntry> {
    super::remote::parse_commit_log_output(output)
}

/// 通过 WSL 获取单个 commit 详细信息
pub fn wsl_get_commit_detail(
    distro: &str,
    project_path: &str,
    commit_hash: &str,
) -> Result<CommitDetail> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);
    let format_str = "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%B%x00%P%x00%D";
    let cmd = format!(
        "cd '{sp}' && git show '{format_str}' --no-patch '{ch}' 2>/dev/null",
        sp = sp,
        format_str = format_str,
        ch = ch
    );
    let output = exec(distro, &cmd)?;

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

/// 通过 WSL 获取某 commit 改动的文件列表
pub fn wsl_get_commit_files(
    distro: &str,
    project_path: &str,
    commit_hash: &str,
) -> Result<Vec<CommitFileChange>> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);

    // numstat for additions/deletions
    let numstat_cmd =
        format!("cd '{sp}' && git diff-tree --no-commit-id -r --numstat '{ch}' 2>/dev/null");
    let numstat_out = exec(distro, &numstat_cmd)?;

    // name-status for file status (M/A/D/R...)
    let status_cmd =
        format!("cd '{sp}' && git diff-tree --no-commit-id -r --name-status '{ch}' 2>/dev/null");
    let status_out = exec(distro, &status_cmd)?;

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

/// 通过 WSL 获取某 commit 中某文件的 diff
pub fn wsl_get_commit_file_diff(
    distro: &str,
    project_path: &str,
    commit_hash: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);
    let fp = safe_path(file_path);
    let cmd = format!("cd '{sp}' && git diff '{ch}^' '{ch}' -- '{fp}' 2>/dev/null");
    let output = exec(distro, &cmd)?;
    let mut result = parse_unified_diff(&output);
    super::local::collapse_diff_context(&mut result.hunks, 12);
    Ok(result)
}

/// 通过 WSL 获取 ahead/behind 计数
pub fn wsl_get_ahead_behind(distro: &str, project_path: &str) -> Result<AheadBehind> {
    let sp = safe_path(project_path);
    // Check if upstream exists
    let upstream_check = exec(
        distro,
        &format!(
            "cd '{sp}' && git rev-parse --abbrev-ref HEAD@{{upstream}} 2>/dev/null; echo EXIT:$?"
        ),
    );
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
    match exec(distro, &cmd) {
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

/// 通过 WSL 执行 git commit（先 stage 指定文件，再 commit）
pub fn wsl_commit_files(
    distro: &str,
    project_path: &str,
    file_paths: &[String],
    message: &str,
) -> Result<CommitResult> {
    let sp = safe_path(project_path);

    // Stage files
    if !file_paths.is_empty() {
        let quoted_files: Vec<String> = file_paths
            .iter()
            .map(|f| format!("'{}'", safe_path(f)))
            .collect();
        let stage_cmd = format!("cd '{sp}' && git add -- {}", quoted_files.join(" "));
        exec(distro, &stage_cmd)?;
    }

    // Commit
    let safe_msg = message.replace('\'', "'\\''");
    let commit_cmd = format!("cd '{sp}' && git commit -m '{safe_msg}'");
    let output = exec(distro, &commit_cmd)?;

    // Extract hash from output like "[branch abc1234] ..."
    let hash = extract_wsl_commit_hash(&output).unwrap_or_default();
    Ok(CommitResult {
        success: true,
        hash,
        message: message.to_string(),
    })
}

fn extract_wsl_commit_hash(output: &str) -> Option<String> {
    super::remote::extract_commit_hash_from_output(output)
}

/// 通过 WSL 读取目录树（使用 find 命令）
pub fn wsl_read_dir_tree(
    distro: &str,
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
    let safe_root = safe_path(root_path);

    let cmd = format!(
        "find '{safe_ap}' -maxdepth {max_depth} \
         -not -path '*/.git/*' \
         -not -path '*/node_modules/*' \
         -not -path '*/target/*' \
         -not -name '.git' \
         2>/dev/null | sort"
    );
    let output = exec(distro, &cmd)?;

    // Build tree from flat path list，路径相对于 actual_path
    let mut tree = build_file_tree(&output, &actual_path, &safe_root)?;

    // 如果使用了 sub_path，需要将路径修正为相对于项目根的完整路径
    if let Some(sp) = effective_sub {
        prefix_paths(&mut tree, sp);
    }

    Ok(tree)
}

/// 递归给所有节点的 path 字段加上前缀（确保路径相对于项目根）
fn prefix_paths(nodes: &mut Vec<FileNode>, prefix: &str) {
    for node in nodes.iter_mut() {
        node.path = format!("{}/{}", prefix, node.path);
        if !node.children.is_empty() {
            prefix_paths(&mut node.children, prefix);
        }
    }
}

fn build_file_tree(find_output: &str, root_path: &str, _safe_root: &str) -> Result<Vec<FileNode>> {
    super::remote::build_file_tree_from_find(find_output, root_path)
}
