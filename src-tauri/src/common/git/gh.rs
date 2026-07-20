//! GitHub CLI integration for PR and repository operations.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::common::executor::ExecError;

/// Extract `owner/repo` from a GraphQL "Could not resolve to a Repository" message.
fn extract_repo_name_from_resolve_error(text: &str) -> Option<String> {
    // GraphQL: Could not resolve to a Repository with the name 'owner/repo'. (repository)
    const MARKER: &str = "with the name '";
    let start = text.find(MARKER)? + MARKER.len();
    let rest = &text[start..];
    let end = rest.find('\'')?;
    let name = &rest[..end];
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Classify common `gh` CLI stderr into stable, user-facing English messages.
///
/// Returns `None` when no known pattern matches (caller should use cleaned stderr).
pub fn classify_gh_error(stderr_or_stdout: &str) -> Option<String> {
    let text = stderr_or_stdout.trim();
    if text.is_empty() {
        return None;
    }
    let lower = text.to_ascii_lowercase();

    if text.contains("Could not resolve to a Repository")
        || text.contains("Could not resolve to a PullRequest")
    {
        if let Some(repo) = extract_repo_name_from_resolve_error(text) {
            return Some(format!(
                "Repository '{repo}' was not found or you don't have access. \
Check the remote URL and that your GitHub account can access this repo \
(private repos need the correct token scopes)."
            ));
        }
        return Some(
            "Repository was not found or you don't have access. \
Check the remote URL and that your GitHub account can access this repo \
(private repos need the correct token scopes)."
                .to_string(),
        );
    }

    if lower.contains("bad credentials")
        || lower.contains("http 401")
        || lower.contains("401 unauthorized")
        || text.contains("gh auth login")
        || (lower.contains("authentication")
            && (lower.contains("failed") || lower.contains("required") || lower.contains("error")))
    {
        return Some(
            "GitHub authentication failed. Run `gh auth login` or refresh your token.".to_string(),
        );
    }

    if lower.contains("http 403")
        || lower.contains("resource not accessible")
        || lower.contains("insufficient scope")
        || lower.contains("insufficient_scope")
        || lower.contains("must have push access")
    {
        return Some(
            "GitHub denied access to this repository. Your token may lack required scopes (e.g. `repo`)."
                .to_string(),
        );
    }

    if lower.contains("could not resolve host")
        || lower.contains("connection timed out")
        || lower.contains("connection refused")
        || lower.contains("network is unreachable")
        || lower.contains("temporary failure in name resolution")
        || lower.contains("error sending request")
    {
        return Some(
            "Network error while contacting GitHub. Check your connection and try again."
                .to_string(),
        );
    }

    None
}

/// Map an executor failure from a `gh` invocation into a user-facing anyhow error.
pub fn map_gh_exec_error(err: ExecError) -> anyhow::Error {
    match err {
        ExecError::CommandFailed {
            code,
            stdout,
            stderr,
        } => {
            let stderr_text = String::from_utf8_lossy(&stderr);
            let stdout_text = String::from_utf8_lossy(&stdout);
            if let Some(msg) = classify_gh_error(&stderr_text) {
                return anyhow::anyhow!(msg);
            }
            if let Some(msg) = classify_gh_error(&stdout_text) {
                return anyhow::anyhow!(msg);
            }
            anyhow::anyhow!(crate::common::executor::format_command_failed_msg(
                code, &stdout, &stderr
            ))
        }
        other => anyhow::anyhow!("{other}"),
    }
}

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

/// GitHub CLI (`gh`) wrapper for executing commands in the context of a repository.
pub struct GhCli {
    /// Path to the local git repository.
    repo_path: PathBuf,
    /// Execution target (local, WSL, or SSH remote).
    target: ExecTarget,
    /// Cached (owner, repo) pair, lazily resolved from the remote URL.
    owner: Mutex<Option<(String, String)>>,
}

impl GhCli {
    /// Create a new `GhCli` for the given repository and execution target.
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
            .map_err(map_gh_exec_error)
    }

    /// Run a gh command and parse the output as JSON.
    pub async fn run_json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T> {
        let stdout = self.run(args).await?;
        serde_json::from_str(&stdout).with_context(|| {
            format!(
                "Failed to parse gh output as JSON: {}",
                &stdout[..stdout.len().min(200)]
            )
        })
    }

    /// Run a `gh api` subcommand with the `repos/{owner}/{repo}/{path}` prefix.
    pub async fn api_run(&self, path: &str, extra_args: &[&str]) -> Result<String> {
        let (owner, repo) = self.repo_owner_name().await?;
        let api_path = format!("repos/{owner}/{repo}/{path}");
        let mut args = vec!["api", &api_path];
        args.extend_from_slice(extra_args);
        self.run(&args).await
    }

    /// Run a `gh api` subcommand and parse the output as JSON.
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

    /// Invalidate the cached owner/repo pair (e.g. after remote URL change).
    pub fn invalidate_owner(&self) {
        if let Ok(mut guard) = self.owner.lock() {
            *guard = None;
        }
    }

    /// Check whether the `gh` CLI is installed and available.
    pub async fn is_installed(&self) -> bool {
        exec_on(&self.target, "gh", &["--version"]).await.is_ok()
    }

    /// Check whether the user is authenticated with `gh`.
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
    fn should_classify_repository_not_found_with_name() {
        let msg = classify_gh_error(
            "GraphQL: Could not resolve to a Repository with the name 'liusy0101/codeant'. (repository)\n",
        )
        .expect("should classify");
        assert!(msg.contains("liusy0101/codeant"));
        assert!(msg.contains("not found") || msg.contains("don't have access"));
        assert!(!msg.contains("stderr=["));
    }

    #[test]
    fn should_classify_auth_failure() {
        let msg = classify_gh_error("HTTP 401: Bad credentials").expect("should classify");
        assert!(msg.to_ascii_lowercase().contains("authentication"));
        assert!(msg.contains("gh auth login"));
    }

    #[test]
    fn should_classify_permission_denied() {
        let msg = classify_gh_error("HTTP 403: Resource not accessible by integration")
            .expect("should classify");
        assert!(msg.contains("denied access") || msg.contains("lack required scopes"));
    }

    #[test]
    fn should_classify_network_error() {
        let msg = classify_gh_error("error connecting to api.github.com: Could not resolve host")
            .expect("should classify");
        assert!(msg.to_ascii_lowercase().contains("network"));
    }

    #[test]
    fn should_return_none_for_unknown_stderr() {
        assert!(classify_gh_error("some unrelated gh message").is_none());
        assert!(classify_gh_error("").is_none());
    }

    #[test]
    fn should_map_command_failed_to_friendly_message() {
        let err = ExecError::CommandFailed {
            code: 1,
            stdout: vec![],
            stderr: b"GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)\n"
                .to_vec(),
        };
        let mapped = map_gh_exec_error(err);
        let s = mapped.to_string();
        assert!(s.contains("o/r"));
        assert!(!s.contains("Unknown error"));
        assert!(!s.contains("stderr=["));
    }

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
