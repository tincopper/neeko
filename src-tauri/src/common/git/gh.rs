use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;

/// Parse GitHub owner/repo from a remote URL.
/// Handles https, git@, and ssh:// formats.
fn parse_gh_owner_repo(url: &str) -> Result<(String, String)> {
    let url = url.trim();

    // https://github.com/owner/repo[.git]
    if let Some(rest) = url.strip_prefix("https://github.com/") {
        let cleaned = rest.strip_suffix(".git").unwrap_or(rest);
        if let Some((owner, repo)) = cleaned.split_once('/') {
            if !owner.is_empty() && !repo.is_empty() {
                return Ok((owner.to_string(), repo.to_string()));
            }
        }
    }

    // git@github.com:owner/repo[.git]
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        let cleaned = rest.strip_suffix(".git").unwrap_or(rest);
        if let Some((owner, repo)) = cleaned.split_once('/') {
            if !owner.is_empty() && !repo.is_empty() {
                return Ok((owner.to_string(), repo.to_string()));
            }
        }
    }

    // ssh://git@github.com/owner/repo[.git]
    if let Some(rest) = url.strip_prefix("ssh://git@github.com/") {
        let cleaned = rest.strip_suffix(".git").unwrap_or(rest);
        if let Some((owner, repo)) = cleaned.split_once('/') {
            if !owner.is_empty() && !repo.is_empty() {
                return Ok((owner.to_string(), repo.to_string()));
            }
        }
    }

    anyhow::bail!("Could not parse GitHub owner/repo from remote URL: {url}")
}

pub struct GhCli {
    repo_path: PathBuf,
    target: ExecTarget,
    owner: Mutex<Option<(String, String)>>,
}

impl GhCli {
    pub fn new(repo_path: &Path, target: &ExecTarget) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
            target: target.clone(),
            owner: Mutex::new(None),
        }
    }

    /// Run a gh command with `-R owner/repo` prefix.
    /// Uses `-R` (supported by all gh versions) instead of `-C <path>` (requires gh ≥ 2.23.0).
    pub async fn run(&self, args: &[&str]) -> Result<String> {
        let (owner, repo) = self.repo_owner_name().await?;
        let repo_flag = format!("{owner}/{repo}");
        let mut full_args = vec!["-R", repo_flag.as_str()];
        full_args.extend_from_slice(args);
        exec_on(&self.target, "gh", &full_args)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }

    pub async fn run_json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T> {
        let stdout = self.run(args).await?;
        serde_json::from_str(&stdout).with_context(|| {
            format!(
                "Failed to parse gh output as JSON: {}",
                &stdout[..stdout.len().min(200)]
            )
        })
    }

    pub async fn api_run(&self, path: &str, extra_args: &[&str]) -> Result<String> {
        let (owner, repo) = self.repo_owner_name().await?;
        let api_path = format!("repos/{owner}/{repo}/{path}");
        let mut args = vec!["api", &api_path];
        args.extend_from_slice(extra_args);
        self.run(&args).await
    }

    pub async fn api_json<T: DeserializeOwned>(
        &self,
        path: &str,
        extra_args: &[&str],
    ) -> Result<T> {
        let stdout = self.api_run(path, extra_args).await?;
        serde_json::from_str(&stdout).with_context(|| "Failed to parse gh api output as JSON")
    }

    /// Resolve owner/repo from `git remote get-url origin`.
    /// Uses `git -C <path>` (universally supported) instead of `gh -C <path>`.
    pub async fn repo_owner_name(&self) -> Result<(String, String)> {
        // Check cache — lock scope is contained, no await held
        if let Ok(guard) = self.owner.lock() {
            if let Some(pair) = &*guard {
                return Ok(pair.clone());
            }
        }

        let repo_path = self.repo_path.to_string_lossy().to_string();
        let stdout = exec_on(
            &self.target,
            "git",
            &["-C", &repo_path, "remote", "get-url", "origin"],
        )
        .await
        .context(
            "Failed to get git remote URL — is this a GitHub repo with a remote named 'origin'?",
        )?;

        let (owner, repo) = parse_gh_owner_repo(&stdout)?;

        if let Ok(mut guard) = self.owner.lock() {
            *guard = Some((owner.clone(), repo.clone()));
        }
        Ok((owner, repo))
    }

    pub fn invalidate_owner(&self) {
        if let Ok(mut guard) = self.owner.lock() {
            *guard = None;
        }
    }

    pub async fn is_installed(&self) -> bool {
        exec_on(&self.target, "gh", &["--version"]).await.is_ok()
    }

    pub async fn is_authenticated(&self) -> bool {
        exec_on(&self.target, "gh", &["auth", "status"])
            .await
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gh_owner_repo_https() {
        let (owner, repo) = parse_gh_owner_repo("https://github.com/owner/repo.git").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_gh_owner_repo_https_no_dot_git() {
        let (owner, repo) = parse_gh_owner_repo("https://github.com/owner/repo").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_gh_owner_repo_ssh() {
        let (owner, repo) = parse_gh_owner_repo("git@github.com:owner/repo.git").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_gh_owner_repo_ssh_no_dot_git() {
        let (owner, repo) = parse_gh_owner_repo("git@github.com:owner/repo").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_gh_owner_repo_ssh_protocol() {
        let (owner, repo) = parse_gh_owner_repo("ssh://git@github.com/owner/repo.git").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_gh_owner_repo_invalid() {
        assert!(parse_gh_owner_repo("https://gitlab.com/owner/repo.git").is_err());
        assert!(parse_gh_owner_repo("not-a-url").is_err());
    }
}
