#![allow(missing_docs)]
use crate::common::git::provider::detect_provider;
use crate::project::types::{GitInfo, GitProvider};
use anyhow::{Context, Result};
use git2::Repository;
use std::path::Path;

/// 采集项目的 git **元数据**（分支 / 工作树清单 / provider）。
///
/// 不含未提交变更：status 是「每个工作树」的事实，经 `WorkspaceRef` 寻址、由
/// `status_worker`（push）或 `operations::status_porcelain`（pull）产出。
/// 项目登记（`ProjectManager`）只需要这份 per-project 的元数据。
pub fn get_git_info(repo_path: &Path) -> Result<GitInfo> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    let branch_info = crate::common::git::local::get_git_branch_info_from_repo(&repo)?;
    let git_provider = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|u| u.to_string()))
        .map(|u| detect_provider(&u))
        .unwrap_or(GitProvider::Unknown);

    // 注入 ProviderStore 缓存，后续 PR 操作直接读缓存
    crate::common::git::pr::set_cached_provider(repo_path, git_provider);

    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        git_provider,
    })
}
