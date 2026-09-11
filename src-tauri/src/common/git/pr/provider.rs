//! [`PrProvider`]：各托管平台（GitHub / GitLab / Gitee）的 PR 能力抽象。

use anyhow::Result;
use async_trait::async_trait;

use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

// ─── PrProvider Trait ────────────────────────────────────────────────────────

/// Trait for pull request operations backed by a specific provider (GitHub, GitLab, Gitee).
#[async_trait]
pub trait PrProvider: Send + Sync {
    /// Provider display name (e.g. "GitHub").
    fn name(&self) -> &'static str;
    /// Check whether the provider CLI tool is installed.
    async fn is_installed(&self) -> bool;
    /// Check whether the user is authenticated with the provider.
    async fn is_authenticated(&self) -> bool;
    /// List pull requests matching the given state and limit.
    async fn list_prs(&self, state: &str, limit: usize) -> Result<Vec<PRListItem>>;
    /// List all labels in the repository.
    async fn list_repo_labels(&self) -> Result<Vec<PrLabel>>;
    /// List all PR authors in the repository.
    async fn list_repo_authors(&self) -> Result<Vec<String>>;
    /// View detailed information about a pull request.
    async fn view_pr(&self, pr_number: u64) -> Result<PRInfo>;
    /// Create a new pull request.
    async fn create_pr(
        &self,
        title: &str,
        body: &str,
        base: Option<&str>,
        draft: bool,
    ) -> Result<u64>;
    /// Merge a pull request using the given method.
    async fn merge_pr(&self, pr_number: u64, method: &str) -> Result<PRMergeResult>;
    /// Close a pull request without merging.
    async fn close_pr(&self, pr_number: u64) -> Result<()>;
    /// List files changed in a pull request.
    async fn list_pr_files(&self, pr_number: u64) -> Result<Vec<PRFileChange>>;
    /// List commits in a pull request.
    async fn list_pr_commits(&self, pr_number: u64) -> Result<Vec<PRCommit>>;
    /// List comments on a pull request.
    async fn list_pr_comments(&self, pr_number: u64) -> Result<Vec<PRComment>>;
    /// Add a comment to a pull request.
    async fn add_pr_comment(&self, pr_number: u64, body: &str) -> Result<PRComment>;
    /// Edit an existing pull request comment.
    async fn edit_pr_comment(
        &self,
        pr_number: u64,
        comment_id: &str,
        body: &str,
    ) -> Result<PRComment>;
    /// Delete a pull request comment.
    async fn delete_pr_comment(&self, pr_number: u64, comment_id: &str) -> Result<()>;
    /// Add an emoji reaction to a comment.
    async fn add_comment_reaction(
        &self,
        pr_number: u64,
        comment_id: &str,
        emoji: &str,
    ) -> Result<()>;
    /// Add a review comment on a specific file/line.
    async fn add_pr_review_comment(
        &self,
        pr_number: u64,
        body: &str,
        path: &str,
        line: u64,
        side: &str,
    ) -> Result<PRReviewComment>;
    /// List review comments on a pull request.
    async fn list_pr_review_comments(&self, pr_number: u64) -> Result<Vec<PRReviewComment>>;
}
