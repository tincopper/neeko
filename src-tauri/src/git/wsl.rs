use anyhow::Result;
use std::process::Command;

use crate::models::{
    BranchGroup, CommitDetail, CommitInfo, DiffResult, FileChange, FileStatus, GitInfo,
};

use super::local::parse_unified_diff;
use super::remote::{parse_branch_output, parse_commit_log_output, parse_git_info_output};

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn no_window_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// 执行 wsl.exe -d distro bash -c "<cmd>" 并返回 stdout
fn run_wsl_bash(distro: &str, cmd: &str) -> Result<String> {
    let output = no_window_cmd("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Command failed with status {}", output.status)
        };
        return Err(anyhow::anyhow!("{}", msg));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 通过 WSL 获取完整 GitInfo（通过 wsl.exe 调用）
pub fn get_wsl_git_info(distro: &str, project_path: &str) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    let output = run_wsl_bash(
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
    let output = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"),
    )?;
    Ok(parse_unified_diff(&output))
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
    run_wsl_bash(distro, &git_cmd)
}

/// 通过 WSL 打开 IDE
pub fn open_wsl_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    // 在 WSL 中以后台模式运行 code 或 zed
    let _ = no_window_cmd("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("--cd")
        .arg(project_path)
        .arg("--")
        .arg(ide)
        .arg(".")
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to launch IDE in WSL: {}", e))?;
    Ok(())
}

/// 通过 WSL 获取提交日志
pub fn get_wsl_commit_log(
    distro: &str,
    project_path: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<CommitInfo>> {
    let sp = safe_path(project_path);
    let output = run_wsl_bash(
        distro,
        &format!(
            "cd '{sp}' && git log --skip={offset} -{limit} --format='%H%n%h%n%s%n%an%n%ae%n%at%n%P' 2>/dev/null"
        ),
    )?;
    Ok(parse_commit_log_output(&output))
}

/// 通过 WSL 获取提交详情
pub fn get_wsl_commit_detail(
    distro: &str,
    project_path: &str,
    commit_hash: &str,
) -> Result<CommitDetail> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);

    // 获取提交信息
    let commit_output = run_wsl_bash(
        distro,
        &format!(
            "cd '{sp}' && git log -1 --format='%H%n%h%n%s%n%an%n%ae%n%at%n%P' '{ch}' 2>/dev/null"
        ),
    )?;
    let commits = parse_commit_log_output(&commit_output);
    let commit = commits
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("Commit not found"))?;

    // 获取父提交 hash
    let parents_output = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git rev-parse '{ch}^@' 2>/dev/null"),
    )?;
    let parent_hashes: Vec<String> = parents_output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .collect();

    // 获取修改文件列表
    let files_output = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git diff-tree --no-commit-id -r --numstat '{ch}' 2>/dev/null"),
    )?;
    let mut files = Vec::new();
    for line in files_output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions: usize = parts[0].parse().unwrap_or(0);
            let deletions: usize = parts[1].parse().unwrap_or(0);
            let path = parts[2].to_string();
            files.push(FileChange {
                path: std::path::PathBuf::from(path),
                status: FileStatus::Modified,
                additions,
                deletions,
            });
        }
    }

    // 获取文件状态（M/A/D/R）
    let status_output = run_wsl_bash(
        distro,
        &format!(
            "cd '{sp}' && git diff-tree --no-commit-id -r --name-status '{ch}' 2>/dev/null"
        ),
    )?;
    for (i, line) in status_output.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        if parts.len() >= 2 && i < files.len() {
            files[i].status = match parts[0] {
                "A" => FileStatus::Added,
                "D" => FileStatus::Deleted,
                "R" => FileStatus::Renamed,
                _ => FileStatus::Modified,
            };
        }
    }

    Ok(CommitDetail {
        commit,
        files,
        parent_hashes,
    })
}

/// 通过 WSL 获取分支分组
pub fn get_wsl_all_branches(distro: &str, project_path: &str) -> Result<BranchGroup> {
    let sp = safe_path(project_path);
    let output = run_wsl_bash(
        distro,
        &format!(
            "cd '{sp}' \
              && printf '__CURRENT__\\n' \
              && git branch --show-current 2>/dev/null \
              && printf '\\n__LOCAL__\\n' \
              && git branch 2>/dev/null \
              && printf '\\n__REMOTE__\\n' \
              && git branch -r 2>/dev/null \
              && printf '\\n__TAGS__\\n' \
              && git tag 2>/dev/null"
        ),
    )?;
    Ok(parse_branch_output(&output))
}

/// 通过 WSL 获取 worktree 的变更文件列表
pub fn get_wsl_worktree_changed_files(
    distro: &str,
    worktree_path: &str,
) -> Result<Vec<FileChange>> {
    let sp = safe_path(worktree_path);
    let output = run_wsl_bash(
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
    let diff_result = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git diff --quiet -- 2>/dev/null; echo EXIT_CODE:$?"),
    );
    if let Ok(output) = &diff_result {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查暂存区
    let cached_result = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git diff --cached --quiet -- 2>/dev/null; echo EXIT_CODE:$?"),
    );
    if let Ok(output) = &cached_result {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查未跟踪文件
    let untracked_result = run_wsl_bash(
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
    let output = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"),
    )?;
    Ok(parse_unified_diff(&output))
}
