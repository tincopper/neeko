#![allow(unused_imports, missing_docs)]
use crate::common::git::local::worktree::get_worktrees;
use crate::project::types::GitBranchInfo;
use anyhow::Result;
use git2::Repository;

/// 内部版本：接受已打开的 &Repository，避免重复 open
pub fn get_git_branch_info_from_repo(repo: &Repository) -> Result<GitBranchInfo> {
    // 获取当前分支
    let head = repo.head()?;
    let current_branch = if head.is_branch() {
        head.shorthand().unwrap_or("HEAD").to_string()
    } else {
        "HEAD (detached)".to_string()
    };

    // 本地分支
    let local_branches = repo.branches(Some(git2::BranchType::Local))?;
    let mut branch_names = Vec::new();
    for (branch, _) in local_branches.flatten() {
        if let Some(name) = branch.name()? {
            branch_names.push(name.to_string());
        }
    }

    // 远程跟踪分支（如 origin/feature/xxx），仅当本地同名分支不存在时加入
    if let Ok(remote_branches) = repo.branches(Some(git2::BranchType::Remote)) {
        for (branch, _) in remote_branches.flatten() {
            if let Some(name) = branch.name()? {
                let name = name.to_string();
                // 跳过 HEAD 远程引用 (origin/HEAD -> origin/main)
                if name.ends_with("/HEAD") {
                    continue;
                }
                // 提取远程名后的分支名，如 origin/feature/xxx -> feature/xxx
                let local_name = name.split('/').skip(1).collect::<Vec<_>>().join("/");
                if !local_name.is_empty() && branch_names.contains(&local_name) {
                    continue;
                }
                branch_names.push(name);
            }
        }
    }

    // 获取 worktrees
    let worktrees = get_worktrees(repo);

    Ok(GitBranchInfo {
        current_branch,
        branches: branch_names,
        worktrees,
    })
}
