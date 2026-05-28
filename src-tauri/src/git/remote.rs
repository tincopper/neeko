use anyhow::Result;

use crate::connection::types::AuthMethod;
#[cfg(test)]
use crate::project::types::FileStatus;
use crate::project::types::{FileNode, GitInfo};
use crate::utils::command::ssh::{exec_command, safe_path};

use super::parsers::{build_file_tree_from_find, parse_git_info_output};

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
    use crate::git::parsers::parse_status_line;
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
