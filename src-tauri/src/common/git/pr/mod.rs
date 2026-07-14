pub mod gitee;
pub mod github;
pub mod gitlab;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use anyhow::Result;

use super::cache;
use super::invalidate_repo_caches;
use super::provider::get_git_provider;
use crate::common::types::GitProvider;
use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

// ─── PrProvider Trait ────────────────────────────────────────────────────────

pub trait PrProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_installed(&self) -> bool;
    fn is_authenticated(&self) -> bool;
    fn list_prs(&self, repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>>;
    fn list_repo_labels(&self, repo_path: &Path) -> Result<Vec<PrLabel>>;
    fn list_repo_authors(&self, repo_path: &Path) -> Result<Vec<String>>;
    fn view_pr(&self, repo_path: &Path, pr_number: u64) -> Result<PRInfo>;
    fn create_pr(
        &self,
        repo_path: &Path,
        title: &str,
        body: &str,
        base: Option<&str>,
        draft: bool,
    ) -> Result<u64>;
    fn merge_pr(&self, repo_path: &Path, pr_number: u64, method: &str) -> Result<PRMergeResult>;
    fn close_pr(&self, repo_path: &Path, pr_number: u64) -> Result<()>;
    fn list_pr_files(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRFileChange>>;
    fn list_pr_commits(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRCommit>>;
    fn list_pr_comments(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRComment>>;
    fn add_pr_comment(&self, repo_path: &Path, pr_number: u64, body: &str) -> Result<PRComment>;
    fn edit_pr_comment(
        &self,
        repo_path: &Path,
        pr_number: u64,
        comment_id: &str,
        body: &str,
    ) -> Result<PRComment>;
    fn delete_pr_comment(&self, repo_path: &Path, pr_number: u64, comment_id: &str) -> Result<()>;
    fn add_comment_reaction(
        &self,
        repo_path: &Path,
        pr_number: u64,
        comment_id: &str,
        emoji: &str,
    ) -> Result<()>;
    fn add_pr_review_comment(
        &self,
        repo_path: &Path,
        pr_number: u64,
        body: &str,
        path: &str,
        line: u64,
        side: &str,
    ) -> Result<PRReviewComment>;
    fn list_pr_review_comments(
        &self,
        repo_path: &Path,
        pr_number: u64,
    ) -> Result<Vec<PRReviewComment>>;
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

fn create_provider(provider: GitProvider) -> Result<Box<dyn PrProvider>> {
    match provider {
        GitProvider::GitHub => Ok(Box::new(github::GitHubPrProvider)),
        GitProvider::GitLab => Err(anyhow::anyhow!("GitLab PR operations not yet supported")),
        GitProvider::Gitee => Err(anyhow::anyhow!("Gitee PR operations not yet supported")),
        GitProvider::Unknown => Err(anyhow::anyhow!(
            "Unknown Git provider — PR operations unavailable"
        )),
    }
}

fn provider_from_repo(repo_path: &Path) -> Result<Box<dyn PrProvider>> {
    let provider = resolve_provider(repo_path);
    create_provider(provider)
}

fn invalidate_after_write(repo_path: &Path) {
    invalidate_repo_caches(repo_path);
    invalidate_provider_cache(repo_path);
}

// ─── Dispatch Functions ──────────────────────────────────────────────────────

pub fn is_gh_installed() -> bool {
    cache::get_cached_gh_installed(|| github::GitHubPrProvider.is_installed())
}

pub fn is_gh_authenticated() -> bool {
    cache::get_cached_gh_authenticated(|| github::GitHubPrProvider.is_authenticated())
}

pub fn list_prs(repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
    let s = state.to_string();
    let limit_val = limit;
    let client = provider_from_repo(repo_path)?;
    cache::get_cached_pr_list(repo_path, &s, limit_val, || {
        client.list_prs(repo_path, state, limit_val)
    })
}

pub fn list_repo_labels(repo_path: &Path) -> Result<Vec<PrLabel>> {
    let client = provider_from_repo(repo_path)?;
    cache::get_cached_repo_labels(repo_path, || client.list_repo_labels(repo_path))
}

pub fn list_repo_authors(repo_path: &Path) -> Result<Vec<String>> {
    let client = provider_from_repo(repo_path)?;
    cache::get_cached_repo_authors(repo_path, || client.list_repo_authors(repo_path))
}

pub fn view_pr(repo_path: &Path, pr_number: u64) -> Result<PRInfo> {
    let client = provider_from_repo(repo_path)?;
    cache::get_cached_pr_info(repo_path, pr_number, || {
        client.view_pr(repo_path, pr_number)
    })
}

pub fn create_pr(
    repo_path: &Path,
    title: &str,
    body: &str,
    base: Option<&str>,
    draft: bool,
) -> Result<u64> {
    let client = provider_from_repo(repo_path)?;
    let result = client.create_pr(repo_path, title, body, base, draft)?;
    invalidate_after_write(repo_path);
    Ok(result)
}

pub fn merge_pr(repo_path: &Path, pr_number: u64, method: &str) -> Result<PRMergeResult> {
    let client = provider_from_repo(repo_path)?;
    let result = client.merge_pr(repo_path, pr_number, method)?;
    invalidate_after_write(repo_path);
    Ok(result)
}

pub fn close_pr(repo_path: &Path, pr_number: u64) -> Result<()> {
    let client = provider_from_repo(repo_path)?;
    client.close_pr(repo_path, pr_number)?;
    invalidate_after_write(repo_path);
    Ok(())
}

pub fn checkout_pr(repo_path: &Path, pr_number: u64) -> Result<()> {
    let output = std::process::Command::new("git")
        .args([
            "fetch",
            "origin",
            &format!("pull/{}/head:pr-{}", pr_number, pr_number),
        ])
        .current_dir(repo_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!(
            "git fetch failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let output = std::process::Command::new("git")
        .args(["checkout", &format!("pr-{}", pr_number)])
        .current_dir(repo_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!(
            "git checkout failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    invalidate_after_write(repo_path);
    Ok(())
}

pub fn list_pr_files(repo_path: &Path, pr_number: u64) -> Result<Vec<PRFileChange>> {
    let client = provider_from_repo(repo_path)?;
    client.list_pr_files(repo_path, pr_number)
}

pub fn list_pr_commits(repo_path: &Path, pr_number: u64) -> Result<Vec<PRCommit>> {
    let client = provider_from_repo(repo_path)?;
    client.list_pr_commits(repo_path, pr_number)
}

pub fn list_pr_comments(repo_path: &Path, pr_number: u64) -> Result<Vec<PRComment>> {
    let client = provider_from_repo(repo_path)?;
    client.list_pr_comments(repo_path, pr_number)
}

pub fn add_pr_comment(repo_path: &Path, pr_number: u64, body: &str) -> Result<PRComment> {
    let client = provider_from_repo(repo_path)?;
    client.add_pr_comment(repo_path, pr_number, body)
}

pub fn edit_pr_comment(
    repo_path: &Path,
    pr_number: u64,
    comment_id: &str,
    body: &str,
) -> Result<PRComment> {
    let client = provider_from_repo(repo_path)?;
    client.edit_pr_comment(repo_path, pr_number, comment_id, body)
}

pub fn delete_pr_comment(repo_path: &Path, pr_number: u64, comment_id: &str) -> Result<()> {
    let client = provider_from_repo(repo_path)?;
    client.delete_pr_comment(repo_path, pr_number, comment_id)
}

pub fn add_comment_reaction(
    repo_path: &Path,
    pr_number: u64,
    comment_id: &str,
    emoji: &str,
) -> Result<()> {
    let client = provider_from_repo(repo_path)?;
    client.add_comment_reaction(repo_path, pr_number, comment_id, emoji)
}

pub fn add_pr_review_comment(
    repo_path: &Path,
    pr_number: u64,
    body: &str,
    path: &str,
    line: u64,
    side: &str,
) -> Result<PRReviewComment> {
    let client = provider_from_repo(repo_path)?;
    client.add_pr_review_comment(repo_path, pr_number, body, path, line, side)
}

pub fn list_pr_review_comments(repo_path: &Path, pr_number: u64) -> Result<Vec<PRReviewComment>> {
    let client = provider_from_repo(repo_path)?;
    client.list_pr_review_comments(repo_path, pr_number)
}
