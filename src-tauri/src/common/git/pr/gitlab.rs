use std::path::{Path, PathBuf};

use anyhow::Result;
use async_trait::async_trait;

use crate::common::executor::factory::ExecTarget;
use crate::common::git::pr::PrProvider;
use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

pub struct GitLabPrProvider {
    _repo_path: PathBuf,
    _target: ExecTarget,
}

impl GitLabPrProvider {
    pub fn new(repo_path: &Path, target: &ExecTarget) -> Self {
        Self {
            _repo_path: repo_path.to_path_buf(),
            _target: target.clone(),
        }
    }
}

#[async_trait]
impl PrProvider for GitLabPrProvider {
    fn name(&self) -> &'static str {
        "GitLab"
    }
    fn is_installed(&self) -> bool {
        false
    }
    fn is_authenticated(&self) -> bool {
        false
    }
    async fn list_prs(&self, _state: &str, _limit: usize) -> Result<Vec<PRListItem>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn list_repo_labels(&self) -> Result<Vec<PrLabel>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn list_repo_authors(&self) -> Result<Vec<String>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn view_pr(&self, _pr_number: u64) -> Result<PRInfo> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn create_pr(
        &self,
        _title: &str,
        _body: &str,
        _base: Option<&str>,
        _draft: bool,
    ) -> Result<u64> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn merge_pr(&self, _pr_number: u64, _method: &str) -> Result<PRMergeResult> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn close_pr(&self, _pr_number: u64) -> Result<()> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn list_pr_files(&self, _pr_number: u64) -> Result<Vec<PRFileChange>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn list_pr_commits(&self, _pr_number: u64) -> Result<Vec<PRCommit>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn list_pr_comments(&self, _pr_number: u64) -> Result<Vec<PRComment>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn add_pr_comment(&self, _pr_number: u64, _body: &str) -> Result<PRComment> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn edit_pr_comment(
        &self,
        _pr_number: u64,
        _comment_id: &str,
        _body: &str,
    ) -> Result<PRComment> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn delete_pr_comment(&self, _pr_number: u64, _comment_id: &str) -> Result<()> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn add_comment_reaction(
        &self,
        _pr_number: u64,
        _comment_id: &str,
        _emoji: &str,
    ) -> Result<()> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn add_pr_review_comment(
        &self,
        _pr_number: u64,
        _body: &str,
        _path: &str,
        _line: u64,
        _side: &str,
    ) -> Result<PRReviewComment> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
    async fn list_pr_review_comments(&self, _pr_number: u64) -> Result<Vec<PRReviewComment>> {
        Err(anyhow::anyhow!("GitLab PR operations not yet supported"))
    }
}
