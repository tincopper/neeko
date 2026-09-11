//! PR 操作的调度层：解析 provider → 建 provider 实例 → 转发调用。

use std::path::Path;

use anyhow::Result;

use crate::common::executor::factory::ExecTarget;
use crate::common::git::{cache, invalidate_repo_caches};
use crate::common::types::GitProvider;
use crate::core::exec::run;
use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

use super::github;
use super::provider::PrProvider;
use super::store::{invalidate_provider_cache, resolve_provider};

// ─── Factory ─────────────────────────────────────────────────────────────────

fn create_provider(
    provider: GitProvider,
    repo_path: &Path,
    target: &ExecTarget,
) -> Result<Box<dyn PrProvider>> {
    match provider {
        GitProvider::GitHub => Ok(Box::new(github::GitHubPrProvider::new(repo_path, target))),
        GitProvider::GitLab => Err(anyhow::anyhow!("GitLab PR operations not yet supported")),
        GitProvider::Gitee => Err(anyhow::anyhow!("Gitee PR operations not yet supported")),
        GitProvider::Unknown => Err(anyhow::anyhow!(
            "Unknown Git provider — PR operations unavailable"
        )),
    }
}

fn provider_from_repo(repo_path: &Path, target: &ExecTarget) -> Result<Box<dyn PrProvider>> {
    let provider = resolve_provider(repo_path);
    create_provider(provider, repo_path, target)
}

fn invalidate_after_write(repo_path: &Path) {
    invalidate_repo_caches(repo_path);
    invalidate_provider_cache(repo_path);
}

// ─── Dispatch Functions ──────────────────────────────────────────────────────

/// Check whether the `gh` CLI is installed (cached).
pub async fn is_gh_installed() -> bool {
    if let Some(cached) = cache::get_gh_installed_cached() {
        return cached;
    }
    let result = github::GitHubPrProvider::new(Path::new(""), &ExecTarget::Local)
        .is_installed()
        .await;
    cache::set_gh_installed_cache(result);
    result
}

/// Check whether the user is authenticated with `gh` (cached).
pub async fn is_gh_authenticated() -> bool {
    if let Some(cached) = cache::get_gh_authenticated_cached() {
        return cached;
    }
    let result = github::GitHubPrProvider::new(Path::new(""), &ExecTarget::Local)
        .is_authenticated()
        .await;
    cache::set_gh_authenticated_cache(result);
    result
}

/// List pull requests for the given repository (cached).
pub async fn list_prs(
    repo_path: &Path,
    target: &ExecTarget,
    state: &str,
    limit: usize,
) -> Result<Vec<PRListItem>> {
    let s = state.to_string();
    let limit_val = limit;
    if let Some(cached) = cache::get_pr_list_cached(repo_path, &s, limit_val) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.list_prs(&s, limit_val).await?;
    cache::set_pr_list_cache(repo_path, &s, limit_val, result.clone());
    Ok(result)
}

/// List labels for the given repository (cached).
pub async fn list_repo_labels(repo_path: &Path, target: &ExecTarget) -> Result<Vec<PrLabel>> {
    if let Some(cached) = cache::get_repo_labels_cached(repo_path) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.list_repo_labels().await?;
    cache::set_repo_labels_cache(repo_path, result.clone());
    Ok(result)
}

/// List PR authors for the given repository (cached).
pub async fn list_repo_authors(repo_path: &Path, target: &ExecTarget) -> Result<Vec<String>> {
    if let Some(cached) = cache::get_repo_authors_cached(repo_path) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.list_repo_authors().await?;
    cache::set_repo_authors_cache(repo_path, result.clone());
    Ok(result)
}

/// View detailed information about a pull request (cached).
pub async fn view_pr(repo_path: &Path, target: &ExecTarget, pr_number: u64) -> Result<PRInfo> {
    if let Some(cached) = cache::get_pr_info_cached(repo_path, pr_number) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.view_pr(pr_number).await?;
    cache::set_pr_info_cache(repo_path, pr_number, result.clone());
    Ok(result)
}

/// Create a new pull request.
pub async fn create_pr(
    repo_path: &Path,
    target: &ExecTarget,
    title: &str,
    body: &str,
    base: Option<&str>,
    draft: bool,
) -> Result<u64> {
    let client = provider_from_repo(repo_path, target)?;
    let result = client.create_pr(title, body, base, draft).await?;
    invalidate_after_write(repo_path);
    Ok(result)
}

/// Merge a pull request.
pub async fn merge_pr(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    method: &str,
) -> Result<PRMergeResult> {
    let client = provider_from_repo(repo_path, target)?;
    let result = client.merge_pr(pr_number, method).await?;
    invalidate_after_write(repo_path);
    Ok(result)
}

/// Close a pull request without merging.
pub async fn close_pr(repo_path: &Path, target: &ExecTarget, pr_number: u64) -> Result<()> {
    let client = provider_from_repo(repo_path, target)?;
    client.close_pr(pr_number).await?;
    invalidate_after_write(repo_path);
    Ok(())
}

/// Check out a pull request locally as a branch.
pub async fn checkout_pr(repo_path: &Path, target: &ExecTarget, pr_number: u64) -> Result<()> {
    let repo_str = repo_path.to_string_lossy().to_string();
    run(
        target,
        "git",
        &[
            "-C",
            &repo_str,
            "fetch",
            "origin",
            &format!("pull/{}/head:pr-{}", pr_number, pr_number),
        ],
    )
    .await
    .map_err(|e| anyhow::anyhow!("git fetch failed: {}", e))?;
    run(
        target,
        "git",
        &["-C", &repo_str, "checkout", &format!("pr-{}", pr_number)],
    )
    .await
    .map_err(|e| anyhow::anyhow!("git checkout failed: {}", e))?;
    invalidate_after_write(repo_path);
    Ok(())
}

/// List files changed in a pull request.
pub async fn list_pr_files(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRFileChange>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_files(pr_number).await
}

/// List commits in a pull request.
pub async fn list_pr_commits(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRCommit>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_commits(pr_number).await
}

/// List comments on a pull request.
pub async fn list_pr_comments(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRComment>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_comments(pr_number).await
}

/// Add a comment to a pull request.
pub async fn add_pr_comment(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    body: &str,
) -> Result<PRComment> {
    let client = provider_from_repo(repo_path, target)?;
    client.add_pr_comment(pr_number, body).await
}

/// Edit an existing pull request comment.
pub async fn edit_pr_comment(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    comment_id: &str,
    body: &str,
) -> Result<PRComment> {
    let client = provider_from_repo(repo_path, target)?;
    client.edit_pr_comment(pr_number, comment_id, body).await
}

/// Delete a pull request comment.
pub async fn delete_pr_comment(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    comment_id: &str,
) -> Result<()> {
    let client = provider_from_repo(repo_path, target)?;
    client.delete_pr_comment(pr_number, comment_id).await
}

/// Add an emoji reaction to a pull request comment.
pub async fn add_comment_reaction(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    comment_id: &str,
    emoji: &str,
) -> Result<()> {
    let client = provider_from_repo(repo_path, target)?;
    client
        .add_comment_reaction(pr_number, comment_id, emoji)
        .await
}

/// Add a review comment on a specific file and line in a pull request.
pub async fn add_pr_review_comment(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    body: &str,
    path: &str,
    line: u64,
    side: &str,
) -> Result<PRReviewComment> {
    let client = provider_from_repo(repo_path, target)?;
    client
        .add_pr_review_comment(pr_number, body, path, line, side)
        .await
}

/// List review comments on a pull request.
pub async fn list_pr_review_comments(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRReviewComment>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_review_comments(pr_number).await
}
