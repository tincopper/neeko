use std::path::Path;

use anyhow::Result;

use crate::common::git::pr::PrProvider;
use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

pub struct GiteePrProvider;

impl PrProvider for GiteePrProvider {
    fn name(&self) -> &'static str {
        "Gitee"
    }
    fn is_installed(&self) -> bool {
        false
    }
    fn is_authenticated(&self) -> bool {
        false
    }
    fn list_prs(&self, _repo_path: &Path, _state: &str, _limit: usize) -> Result<Vec<PRListItem>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn list_repo_labels(&self, _repo_path: &Path) -> Result<Vec<PrLabel>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn list_repo_authors(&self, _repo_path: &Path) -> Result<Vec<String>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn view_pr(&self, _repo_path: &Path, _pr_number: u64) -> Result<PRInfo> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn create_pr(
        &self,
        _repo_path: &Path,
        _title: &str,
        _body: &str,
        _base: Option<&str>,
        _draft: bool,
    ) -> Result<u64> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn merge_pr(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
        _method: &str,
    ) -> Result<PRMergeResult> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn close_pr(&self, _repo_path: &Path, _pr_number: u64) -> Result<()> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn list_pr_files(&self, _repo_path: &Path, _pr_number: u64) -> Result<Vec<PRFileChange>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn list_pr_commits(&self, _repo_path: &Path, _pr_number: u64) -> Result<Vec<PRCommit>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn list_pr_comments(&self, _repo_path: &Path, _pr_number: u64) -> Result<Vec<PRComment>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn add_pr_comment(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
        _body: &str,
    ) -> Result<PRComment> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn edit_pr_comment(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
        _comment_id: &str,
        _body: &str,
    ) -> Result<PRComment> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn delete_pr_comment(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
        _comment_id: &str,
    ) -> Result<()> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn add_comment_reaction(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
        _comment_id: &str,
        _emoji: &str,
    ) -> Result<()> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn add_pr_review_comment(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
        _body: &str,
        _path: &str,
        _line: u64,
        _side: &str,
    ) -> Result<PRReviewComment> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
    fn list_pr_review_comments(
        &self,
        _repo_path: &Path,
        _pr_number: u64,
    ) -> Result<Vec<PRReviewComment>> {
        Err(anyhow::anyhow!("Gitee PR operations not yet supported"))
    }
}
