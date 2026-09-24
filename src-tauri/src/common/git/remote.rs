//! Remote git operations over SSH transport.

use anyhow::Result;

use crate::common::connection::types::AuthMethod;
use crate::common::executor::factory::ExecTarget;
use crate::common::utils::command::local::safe_path;
use crate::core::exec::run;
use crate::project::types::{GitInfo, GitProvider};

use super::parsers::parse_git_info_output;
use super::provider::detect_provider;

/// 通过 SSH 获取完整 GitInfo（1 次 SSH 连接）
pub async fn get_remote_git_info(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
) -> Result<GitInfo> {
    let cmd = remote_git_info_command(project_path);
    let output = run(
        &ExecTarget::Remote {
            host: host.to_string(),
            port,
            username: username.to_string(),
            auth: auth.clone(),
        },
        "sh",
        &["-c", &cmd],
    )
    .await?;

    // Parse the remote URL from the last line (after __REMOTE__ marker)
    let git_provider = if let Some(remote_pos) = output.rfind("__REMOTE__\n") {
        let after_marker = &output[remote_pos + "__REMOTE__\n".len()..];
        let remote_url = after_marker.lines().next().unwrap_or("").trim();
        if remote_url.is_empty() {
            GitProvider::Unknown
        } else {
            detect_provider(remote_url)
        }
    } else {
        GitProvider::Unknown
    };

    let mut info = parse_git_info_output(&output);
    info.git_provider = git_provider;
    Ok(info)
}

/// 远端 git 信息采集命令（纯函数，便于单测）。
///
/// 远端 shell 内直接跑多个 git 子命令（绕过 transport 的 env 渲染），因此**必须在
/// 脚本开头导出只读语义** `GIT_OPTIONAL_LOCKS=0`：否则 `git status` 会在远端 refresh
/// index，与用户 / IDE 争远端 index 锁（与本地注入同源的第一性依据见
/// `common::executor::env_defaults`）。
#[must_use]
fn remote_git_info_command(project_path: &str) -> String {
    let sp = safe_path(project_path);
    format!(
        "export GIT_OPTIONAL_LOCKS=0; cd '{sp}' \
          && printf '__BRANCH__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__BRANCHES__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__WORKTREES__\\n' \
          && git worktree list --porcelain 2>/dev/null \
          && printf '\\n__STATUS__\\n' \
          && git status --porcelain 2>/dev/null \
          && printf '\\n__REMOTE__\\n' \
          && git remote get-url origin 2>/dev/null"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::git::parsers::parse_status_line;
    use crate::project::types::FileStatus;

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

#[cfg(test)]
mod remote_command_tests {
    use super::remote_git_info_command;

    #[test]
    fn remote_git_info_command_exports_optional_locks_off() {
        let cmd = remote_git_info_command("/home/user/proj");
        assert!(
            cmd.starts_with("export GIT_OPTIONAL_LOCKS=0;"),
            "远端 git 脚本必须显式导出只读语义（否则远端 git status 会 refresh index 抢锁）：{cmd}"
        );
        assert!(
            cmd.contains("cd '/home/user/proj'"),
            "工作目录须安全引用：{cmd}"
        );
        assert!(
            cmd.contains("git status --porcelain"),
            "须包含 status 采集：{cmd}"
        );
    }
}
