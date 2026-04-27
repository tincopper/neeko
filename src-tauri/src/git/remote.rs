use anyhow::Result;
use russh::*;
use std::path::PathBuf;
use std::sync::Arc;

use crate::models::{
    AuthMethod, BranchGroup, CommitDetail, CommitInfo, DiffResult, FileChange, FileStatus, GitInfo,
    Worktree,
};

use super::local::parse_unified_diff;

struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// SSH 一次性认证连接 + 执行命令 + 返回 stdout
async fn ssh_exec_command(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    cmd: &str,
) -> Result<String> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), Client).await?;

    let auth_result = match auth {
        AuthMethod::Password(password) => session.authenticate_password(username, password).await?,
        AuthMethod::KeyFile(key_path) => {
            let key_pair = russh::keys::load_secret_key(key_path, None)?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session
                .authenticate_publickey(username, key_with_hash)
                .await?
        }
        AuthMethod::KeyFileWithPassphrase {
            key_path,
            passphrase,
        } => {
            let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session
                .authenticate_publickey(username, key_with_hash)
                .await?
        }
    };

    if !auth_result.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

    let mut channel = session.channel_open_session().await?;
    channel.exec(true, cmd.as_bytes()).await?;

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut exit_code: Option<u32> = None;
    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { data }) => {
                stdout_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                // channel 1 = stderr
                stderr_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
                // continue draining in case Data arrives after ExitStatus
            }
            Some(russh::ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();

    // 退出码非零视为失败
    if let Some(code) = exit_code {
        if code != 0 {
            let stderr = String::from_utf8_lossy(&stderr_buf).trim().to_string();
            let msg = if !stderr.is_empty() {
                stderr
            } else {
                format!("SSH command failed with exit code {}", code)
            };
            return Err(anyhow::anyhow!("{}", msg));
        }
    }

    Ok(stdout)
}

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
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
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
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_unified_diff(&output))
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
    ssh_exec_command(host, port, username, auth, &cmd).await
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

/// 解析 git log 输出为 CommitInfo 列表
/// 格式: 每条提交 7 行: hash \n short_hash \n message \n author \n email \n timestamp \n parent_hashes
pub fn parse_commit_log_output(output: &str) -> Vec<CommitInfo> {
    let lines: Vec<&str> = output.lines().collect();
    let mut commits = Vec::new();
    let mut i = 0;

    while i + 6 < lines.len() {
        let hash = lines[i].trim().to_string();
        let short_hash = lines[i + 1].trim().to_string();
        let message = lines[i + 2].trim().to_string();
        let author = lines[i + 3].trim().to_string();
        let email = lines[i + 4].trim().to_string();
        let timestamp = lines[i + 5].trim().parse::<i64>().unwrap_or(0);
        let parent_hashes = lines[i + 6]
            .trim()
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<String>>();

        let date = {
            chrono::DateTime::from_timestamp(timestamp, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_else(|| format!("{}", timestamp))
        };

        if !hash.is_empty() {
            commits.push(CommitInfo {
                hash,
                short_hash,
                message,
                author,
                email,
                timestamp,
                date,
                parent_hashes,
            });
        }
        i += 7; // 每条提交 7 行 (hash, short_hash, message, author, email, timestamp, parent_hashes)
    }

    commits
}

/// 通过 SSH 获取提交日志
pub async fn get_remote_commit_log(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<CommitInfo>> {
    let sp = safe_path(project_path);
    let cmd = format!(
        "cd '{sp}' && git log --skip={offset} -{limit} --format='%H%n%h%n%s%n%an%n%ae%n%at%n%P' 2>/dev/null"
    );
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_commit_log_output(&output))
}

/// 通过 SSH 获取提交详情
pub async fn get_remote_commit_detail(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    commit_hash: &str,
) -> Result<CommitDetail> {
    let sp = safe_path(project_path);
    let ch = safe_path(commit_hash);

    // 提交信息
    let commit_cmd = format!(
        "cd '{sp}' && git log -1 --format='%H%n%h%n%s%n%an%n%ae%n%at%n%P' '{ch}' 2>/dev/null"
    );
    let commit_output = ssh_exec_command(host, port, username, auth, &commit_cmd).await?;
    let commits = parse_commit_log_output(&commit_output);
    let commit = commits
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("Commit not found"))?;

    // 父提交
    let parents_cmd = format!("cd '{sp}' && git rev-parse '{ch}^@' 2>/dev/null");
    let parents_output = ssh_exec_command(host, port, username, auth, &parents_cmd).await?;
    let parent_hashes: Vec<String> = parents_output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .collect();

    // 修改文件 + 统计
    let files_cmd =
        format!("cd '{sp}' && git diff-tree --no-commit-id -r --numstat '{ch}' 2>/dev/null");
    let files_output = ssh_exec_command(host, port, username, auth, &files_cmd).await?;
    let mut files = Vec::new();
    for line in files_output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            files.push(FileChange {
                path: PathBuf::from(parts[2]),
                status: FileStatus::Modified,
                additions: parts[0].parse().unwrap_or(0),
                deletions: parts[1].parse().unwrap_or(0),
            });
        }
    }

    // 文件状态
    let status_cmd =
        format!("cd '{sp}' && git diff-tree --no-commit-id -r --name-status '{ch}' 2>/dev/null");
    let status_output = ssh_exec_command(host, port, username, auth, &status_cmd).await?;
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

/// 通过 SSH 获取分支分组
pub async fn get_remote_all_branches(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
) -> Result<BranchGroup> {
    let sp = safe_path(project_path);
    let cmd = format!(
        "cd '{sp}' \
          && printf '__CURRENT__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__LOCAL__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__REMOTE__\\n' \
          && git branch -r 2>/dev/null \
          && printf '\\n__TAGS__\\n' \
          && git tag 2>/dev/null"
    );
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_branch_output(&output))
}

/// 解析分支输出（共享：remote + wsl 都用）
pub fn parse_branch_output(output: &str) -> BranchGroup {
    let mut current = String::new();
    let mut local = Vec::new();
    let mut remote = Vec::new();
    let mut tags = Vec::new();
    let mut section = "";

    for line in output.lines() {
        let trimmed = line.trim();
        match trimmed {
            "__CURRENT__" => {
                section = "current";
                continue;
            }
            "__LOCAL__" => {
                section = "local";
                continue;
            }
            "__REMOTE__" => {
                section = "remote";
                continue;
            }
            "__TAGS__" => {
                section = "tags";
                continue;
            }
            _ => {}
        }

        match section {
            "current" => {
                if !trimmed.is_empty() {
                    current = trimmed.to_string();
                }
            }
            "local" => {
                let name = trimmed.trim_start_matches('*').trim();
                if !name.is_empty() {
                    local.push(name.to_string());
                }
            }
            "remote" => {
                if !trimmed.is_empty() && !trimmed.contains("->") {
                    remote.push(trimmed.to_string());
                }
            }
            "tags" => {
                if !trimmed.is_empty() {
                    tags.push(trimmed.to_string());
                }
            }
            _ => {}
        }
    }

    BranchGroup {
        local,
        remote,
        tags,
        current,
    }
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
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;

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
    if let Ok(output) = ssh_exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查暂存区
    let cmd = format!(
        "cd '{}' && git diff --cached --quiet -- 2>/dev/null; echo EXIT_CODE:$?",
        sp
    );
    if let Ok(output) = ssh_exec_command(host, port, username, auth, &cmd).await {
        if !output.trim().ends_with("EXIT_CODE:0") {
            return Ok(true);
        }
    }

    // 检查未跟踪文件
    let cmd = format!(
        "cd '{}' && git ls-files --others --exclude-standard 2>/dev/null",
        sp
    );
    if let Ok(output) = ssh_exec_command(host, port, username, auth, &cmd).await {
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
    let cmd = format!("cd '{}' && git diff --unified=3 -- '{}' 2>/dev/null", sp, fp);
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
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
worktree /path/to/wt
branch refs/heads/feature

__STATUS__";
        let info = parse_git_info_output(output);
        assert_eq!(info.current_branch, "main");
        assert_eq!(info.branches.len(), 2);
        assert_eq!(info.worktrees.len(), 1);
        assert_eq!(info.worktrees[0].branch, "feature");
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

    #[test]
    fn should_parse_commit_log_output() {
        let output = "\
abc1234567890
abc1234
Initial commit
test user
test@test.com
1700000001

def5678901234
def5678
Second commit
test user
test@test.com
1700000002
abc1234567890
";
        let commits = parse_commit_log_output(output);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, "abc1234567890");
        assert_eq!(commits[0].short_hash, "abc1234");
        assert_eq!(commits[0].message, "Initial commit");
        assert_eq!(commits[0].author, "test user");
        assert_eq!(commits[0].email, "test@test.com");
        assert_eq!(commits[0].timestamp, 1700000001);
        assert!(commits[0].parent_hashes.is_empty());
        assert_eq!(commits[1].message, "Second commit");
        assert_eq!(commits[1].parent_hashes, vec!["abc1234567890"]);
    }

    #[test]
    fn should_parse_branch_output() {
        let output = "\
__CURRENT__
main

__LOCAL__
main
feature/test

__REMOTE__
origin/main
origin/develop
origin/HEAD -> origin/main

__TAGS__
v1.0.0
v1.1.0
";
        let groups = parse_branch_output(output);
        assert_eq!(groups.current, "main");
        assert_eq!(groups.local.len(), 2);
        assert_eq!(groups.remote.len(), 2); // HEAD -> 被过滤
        assert_eq!(groups.tags.len(), 2);
        assert!(groups.local.contains(&"main".to_string()));
        assert!(groups.local.contains(&"feature/test".to_string()));
        assert!(groups.tags.contains(&"v1.0.0".to_string()));
    }
}
