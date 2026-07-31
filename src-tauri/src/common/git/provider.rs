//! Git provider detection (GitHub, GitLab, Gitee) from remote URLs.

use anyhow::Result;
use std::path::Path;

use crate::common::types::GitProvider;

/// 从 remote URL 检测 Git 提供商
#[must_use]
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

/// 执行 git remote get-url origin（同步）。
/// 通过 git2 直接读取 `.git/config`：零子进程、零 tokio runtime，
/// 可在 async command 调用链中安全调用（无 runtime-in-runtime panic）。
/// git2 原生支持 linked worktree 的 `.git` 指针文件。
pub fn get_git_provider(repo_path: &Path) -> Result<GitProvider> {
    let repo = git2::Repository::open(repo_path)?;
    let remote = repo.find_remote("origin")?;
    let url = remote.url().unwrap_or_default();
    Ok(detect_provider(url))
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

    /// 临时仓库 + origin remote（GitHub）→ 返回 GitHub
    #[test]
    fn get_git_provider_detects_github_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        repo.remote("origin", "https://github.com/user/repo.git")
            .unwrap();
        assert_eq!(get_git_provider(tmp.path()).unwrap(), GitProvider::GitHub);
    }

    /// 临时仓库 + origin remote（GitLab）→ 返回 GitLab
    #[test]
    fn get_git_provider_detects_gitlab_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        repo.remote("origin", "git@gitlab.com:user/repo.git")
            .unwrap();
        assert_eq!(get_git_provider(tmp.path()).unwrap(), GitProvider::GitLab);
    }

    /// 仓库存在但无 origin → 返回 Err（调用方 unwrap_or(Unknown) 兜底）
    #[test]
    fn get_git_provider_returns_err_without_origin() {
        let tmp = tempfile::tempdir().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        assert!(get_git_provider(tmp.path()).is_err());
    }

    /// 非 git 目录 → 返回 Err（不 panic）
    #[test]
    fn get_git_provider_returns_err_for_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(get_git_provider(tmp.path()).is_err());
    }
}
