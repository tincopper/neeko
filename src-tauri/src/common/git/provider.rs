//! Git provider detection (GitHub, GitLab, Gitee) from remote URLs.

use anyhow::Result;
use std::path::Path;

use crate::common::types::GitProvider;

/// 从 remote URL 检测 Git 提供商
pub fn detect_provider(remote_url: &str) -> GitProvider {
    let url = remote_url.trim().to_lowercase();
    if url.contains("github.com") {
        GitProvider::GitHub
    } else if url.contains("gitee.com") {
        GitProvider::Gitee
    } else if url.contains("gitlab.") {
        GitProvider::GitLab
    } else {
        GitProvider::Unknown
    }
}

/// 执行 git remote get-url origin（同步，local 使用）
pub fn get_git_provider(repo_path: &Path) -> Result<GitProvider> {
    let output = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()?;
    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout);
        Ok(detect_provider(&url))
    } else {
        Ok(GitProvider::Unknown)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_github_ssh() {
        assert_eq!(
            detect_provider("git@github.com:user/repo.git"),
            GitProvider::GitHub
        );
    }

    #[test]
    fn test_detect_github_https() {
        assert_eq!(
            detect_provider("https://github.com/user/repo.git"),
            GitProvider::GitHub
        );
    }

    #[test]
    fn test_detect_github_https_with_token() {
        assert_eq!(
            detect_provider("https://token@github.com/user/repo.git"),
            GitProvider::GitHub
        );
    }

    #[test]
    fn test_detect_gitee() {
        assert_eq!(
            detect_provider("git@gitee.com:user/repo.git"),
            GitProvider::Gitee
        );
    }

    #[test]
    fn test_detect_gitlab_com() {
        assert_eq!(
            detect_provider("git@gitlab.com:user/repo.git"),
            GitProvider::GitLab
        );
    }

    #[test]
    fn test_detect_gitlab_self_hosted() {
        assert_eq!(
            detect_provider("git@gitlab.example.com:user/repo.git"),
            GitProvider::GitLab
        );
    }

    #[test]
    fn test_detect_gitlab_https() {
        assert_eq!(
            detect_provider("https://gitlab.mycompany.com/group/project.git"),
            GitProvider::GitLab
        );
    }

    #[test]
    fn test_detect_unknown() {
        assert_eq!(
            detect_provider("git@bitbucket.org:user/repo.git"),
            GitProvider::Unknown
        );
    }

    #[test]
    fn test_detect_empty() {
        assert_eq!(detect_provider(""), GitProvider::Unknown);
    }

    #[test]
    fn test_detect_nonsense() {
        assert_eq!(detect_provider("not-a-url"), GitProvider::Unknown);
    }
}
