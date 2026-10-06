// Git operations — info sub-module (split from operations.rs God File).

use crate::common::git::operations::worktree::parse_worktree_list;
use crate::common::git::provider::detect_provider;
use crate::common::git::transport::GitTransport;
use crate::project::types::{GitBranchInfo, GitInfo, GitProvider};
use anyhow::Result;

/// 经 transport（shell）查询仓库信息：分支 + provider 检测，三端一致。
pub async fn get_git_info_shell(transport: &dyn GitTransport, work_dir: &str) -> Result<GitInfo> {
    let branch_info = get_git_branch_info_shell(transport, work_dir).await?;
    // 检测 Git 提供商
    let remote_url = transport
        .run_git(&["remote", "get-url", "origin"], work_dir)
        .await
        .unwrap_or_default();
    let git_provider = if remote_url.trim().is_empty() {
        GitProvider::Unknown
    } else {
        detect_provider(remote_url.trim())
    };

    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        git_provider,
    })
}

/// Get git branch info using shell commands
pub async fn get_git_branch_info_shell(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<GitBranchInfo> {
    let head = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let current_branch = head.trim();
    let current_branch = if current_branch == "HEAD" {
        "HEAD (detached)"
    } else {
        current_branch
    };

    // 本地分支
    let local_output = transport
        .run_git(&["branch", "--format=%(refname:short)"], work_dir)
        .await?;
    let mut branches: Vec<String> = local_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    // 远程跟踪分支，跳过 HEAD 引用和已存在本地分支的同名分支
    let remote_output = transport
        .run_git(&["branch", "-r", "--format=%(refname:short)"], work_dir)
        .await
        .unwrap_or_default();
    for line in remote_output.lines() {
        let name = line.trim();
        if name.is_empty() || name.ends_with("/HEAD") {
            continue;
        }
        // 提取远程名后的分支名，如 origin/feature/xxx -> feature/xxx
        let local_name = name.split('/').skip(1).collect::<Vec<&str>>().join("/");
        if !local_name.is_empty() && branches.contains(&local_name) {
            continue;
        }
        branches.push(name.to_string());
    }

    let worktrees_output = transport
        .run_git(&["worktree", "list", "--porcelain"], work_dir)
        .await?;
    // 归一化需要 transport 的 target 语义（Local canonicalize / 远端词法归一），
    // 因此清单在解析处即归一 —— 前端会拿这些路径拼 RepoKey，必须与 RepoRef::key() 同形。
    //
    // 每条目的归一含 `exists` / `canonicalize`（阻塞 fs）⇒ 整份清单在**一次** `spawn_blocking`
    // 内解析（红线 3）：逐条 hop 会把线程池往返乘以条目数，且让清单内部来自不同时刻的 fs 视图。
    let parse_target = transport.exec_target();
    let mut worktrees =
        tokio::task::spawn_blocking(move || parse_worktree_list(&worktrees_output, &parse_target))
            .await
            .map_err(|e| anyhow::anyhow!("worktree list parsing task failed: {e}"))?;
    // The first worktree is always the main worktree (the project directory itself):
    // `git worktree list` 保证主工作树排在最前（2.54 实测 + git-worktree(1) 文档），
    // git2 的 `repo.worktrees()` 同样只返回 linked worktree —— 两条路径语义一致。
    if !worktrees.is_empty() {
        worktrees.remove(0);
    }

    Ok(GitBranchInfo {
        current_branch: current_branch.to_string(),
        branches,
        worktrees,
    })
}

/// 查询仓库信息：本地可开 repo 时走 git2 快路径，否则回落 shell 实现。
pub async fn get_git_info(transport: &dyn GitTransport, work_dir: &str) -> Result<GitInfo> {
    crate::common::git::local::assert_git_repo_async(work_dir).await?;
    if let Some(repo) = transport.open_repo_async(work_dir).await {
        tokio::task::spawn_blocking(move || {
            let branch_info = crate::common::git::local::get_git_branch_info_from_repo(&repo)?;
            let git_provider = repo
                .find_remote("origin")
                .ok()
                .and_then(|r| r.url().map(|u| u.to_string()))
                .map(|u| detect_provider(&u))
                .unwrap_or(GitProvider::Unknown);
            Ok(GitInfo {
                current_branch: branch_info.current_branch,
                branches: branch_info.branches,
                worktrees: branch_info.worktrees,
                git_provider,
            })
        })
        .await
        .map_err(|e| anyhow::anyhow!("git info task join error: {e}"))?
    } else {
        get_git_info_shell(transport, work_dir).await
    }
}

/// Get git branch info. Uses git2 for local transports, shell fallback otherwise.
pub async fn get_git_branch_info(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<GitBranchInfo> {
    crate::common::git::local::assert_git_repo_async(work_dir).await?;
    if let Some(repo) = transport.open_repo_async(work_dir).await {
        tokio::task::spawn_blocking(move || {
            crate::common::git::local::get_git_branch_info_from_repo(&repo)
        })
        .await
        .map_err(|e| anyhow::anyhow!("git branch info task join error: {e}"))?
    } else {
        get_git_branch_info_shell(transport, work_dir).await
    }
}
