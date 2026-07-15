pub mod gitee;
pub mod github;
pub mod gitlab;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use anyhow::Result;
use async_trait::async_trait;

use super::cache;
use super::invalidate_repo_caches;
use super::provider::get_git_provider;
use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::common::types::GitProvider;
use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

// ─── PrProvider Trait ────────────────────────────────────────────────────────

#[async_trait]
pub trait PrProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_installed(&self) -> bool;
    fn is_authenticated(&self) -> bool;
    async fn list_prs(&self, state: &str, limit: usize) -> Result<Vec<PRListItem>>;
    async fn list_repo_labels(&self) -> Result<Vec<PrLabel>>;
    async fn list_repo_authors(&self) -> Result<Vec<String>>;
    async fn view_pr(&self, pr_number: u64) -> Result<PRInfo>;
    async fn create_pr(
        &self,
        title: &str,
        body: &str,
        base: Option<&str>,
        draft: bool,
    ) -> Result<u64>;
    async fn merge_pr(&self, pr_number: u64, method: &str) -> Result<PRMergeResult>;
    async fn close_pr(&self, pr_number: u64) -> Result<()>;
    async fn list_pr_files(&self, pr_number: u64) -> Result<Vec<PRFileChange>>;
    async fn list_pr_commits(&self, pr_number: u64) -> Result<Vec<PRCommit>>;
    async fn list_pr_comments(&self, pr_number: u64) -> Result<Vec<PRComment>>;
    async fn add_pr_comment(&self, pr_number: u64, body: &str) -> Result<PRComment>;
    async fn edit_pr_comment(
        &self,
        pr_number: u64,
        comment_id: &str,
        body: &str,
    ) -> Result<PRComment>;
    async fn delete_pr_comment(&self, pr_number: u64, comment_id: &str) -> Result<()>;
    async fn add_comment_reaction(
        &self,
        pr_number: u64,
        comment_id: &str,
        emoji: &str,
    ) -> Result<()>;
    async fn add_pr_review_comment(
        &self,
        pr_number: u64,
        body: &str,
        path: &str,
        line: u64,
        side: &str,
    ) -> Result<PRReviewComment>;
    async fn list_pr_review_comments(&self, pr_number: u64) -> Result<Vec<PRReviewComment>>;
}

// ─── ProviderStore ──────────────────────────────────────────────────────────

static PROVIDER_STORE: OnceLock<Mutex<HashMap<PathBuf, GitProvider>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<PathBuf, GitProvider>> {
    PROVIDER_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 缓存优先，未命中时通过 `get_git_provider` 检测并缓存
pub fn resolve_provider(repo_path: &Path) -> GitProvider {
    if let Some(p) = store().lock().ok().and_then(|m| m.get(repo_path).copied()) {
        return p;
    }
    let p = get_git_provider(repo_path).unwrap_or(GitProvider::Unknown);
    if let Ok(mut guard) = store().lock() {
        guard.insert(repo_path.to_path_buf(), p);
    }
    p
}

/// 由 `get_git_info` 在刷新时注入已解析的 provider
pub fn set_cached_provider(repo_path: &Path, provider: GitProvider) {
    if let Ok(mut guard) = store().lock() {
        guard.insert(repo_path.to_path_buf(), provider);
    }
}

/// 缓存失效（当 git remote 变更时）
pub fn invalidate_provider_cache(repo_path: &Path) {
    if let Ok(mut guard) = store().lock() {
        guard.remove(repo_path);
    }
}

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

pub fn is_gh_installed() -> bool {
    cache::get_cached_gh_installed(|| {
        github::GitHubPrProvider::new(Path::new(""), &ExecTarget::Local).is_installed()
    })
}

pub fn is_gh_authenticated() -> bool {
    cache::get_cached_gh_authenticated(|| {
        github::GitHubPrProvider::new(Path::new(""), &ExecTarget::Local).is_authenticated()
    })
}

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

pub async fn list_repo_labels(repo_path: &Path, target: &ExecTarget) -> Result<Vec<PrLabel>> {
    if let Some(cached) = cache::get_repo_labels_cached(repo_path) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.list_repo_labels().await?;
    cache::set_repo_labels_cache(repo_path, result.clone());
    Ok(result)
}

pub async fn list_repo_authors(repo_path: &Path, target: &ExecTarget) -> Result<Vec<String>> {
    if let Some(cached) = cache::get_repo_authors_cached(repo_path) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.list_repo_authors().await?;
    cache::set_repo_authors_cache(repo_path, result.clone());
    Ok(result)
}

pub async fn view_pr(repo_path: &Path, target: &ExecTarget, pr_number: u64) -> Result<PRInfo> {
    if let Some(cached) = cache::get_pr_info_cached(repo_path, pr_number) {
        return Ok(cached);
    }
    let client = provider_from_repo(repo_path, target)?;
    let result = client.view_pr(pr_number).await?;
    cache::set_pr_info_cache(repo_path, pr_number, result.clone());
    Ok(result)
}

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

pub async fn close_pr(repo_path: &Path, target: &ExecTarget, pr_number: u64) -> Result<()> {
    let client = provider_from_repo(repo_path, target)?;
    client.close_pr(pr_number).await?;
    invalidate_after_write(repo_path);
    Ok(())
}

pub async fn checkout_pr(repo_path: &Path, target: &ExecTarget, pr_number: u64) -> Result<()> {
    let repo_str = repo_path.to_string_lossy().to_string();
    exec_on(
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
    exec_on(
        target,
        "git",
        &["-C", &repo_str, "checkout", &format!("pr-{}", pr_number)],
    )
    .await
    .map_err(|e| anyhow::anyhow!("git checkout failed: {}", e))?;
    invalidate_after_write(repo_path);
    Ok(())
}

pub async fn list_pr_files(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRFileChange>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_files(pr_number).await
}

pub async fn list_pr_commits(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRCommit>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_commits(pr_number).await
}

pub async fn list_pr_comments(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRComment>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_comments(pr_number).await
}

pub async fn add_pr_comment(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    body: &str,
) -> Result<PRComment> {
    let client = provider_from_repo(repo_path, target)?;
    client.add_pr_comment(pr_number, body).await
}

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

pub async fn delete_pr_comment(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
    comment_id: &str,
) -> Result<()> {
    let client = provider_from_repo(repo_path, target)?;
    client.delete_pr_comment(pr_number, comment_id).await
}

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

pub async fn list_pr_review_comments(
    repo_path: &Path,
    target: &ExecTarget,
    pr_number: u64,
) -> Result<Vec<PRReviewComment>> {
    let client = provider_from_repo(repo_path, target)?;
    client.list_pr_review_comments(pr_number).await
}
