//! Git repository cloning, parsing, and cleanup helpers for skill installation.

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::SpawnOptions;
use crate::core::exec::collect_blocking_with;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Decomposed git source URL with branch and subpath components.
#[derive(Debug, Clone)]
pub struct ParsedGitSource {
    /// The original URL as provided.
    pub original_url: String,
    /// Normalized clone URL (with .git suffix).
    pub clone_url: String,
    /// Optional branch extracted from URL#branch.
    pub branch: Option<String>,
    /// Optional subpath extracted from URL#branch:path.
    pub subpath: Option<String>,
}

/// Parse a git source URL into its components (clone_url, branch, subpath).
#[must_use]
pub fn parse_git_source(url: &str) -> ParsedGitSource {
    let original_url = url.to_string();
    let mut clone_url = url.to_string();
    let mut branch = None;
    let mut subpath = None;

    // Parse URL#branch:path format
    if let Some(hash_pos) = url.find('#') {
        clone_url = url[..hash_pos].to_string();
        let rest = &url[hash_pos + 1..];

        if let Some(colon_pos) = rest.find(':') {
            branch = Some(rest[..colon_pos].to_string());
            subpath = Some(rest[colon_pos + 1..].to_string());
        } else {
            branch = Some(rest.to_string());
        }
    }

    // Ensure .git suffix
    if !clone_url.ends_with(".git") {
        clone_url = format!("{}.git", clone_url);
    }

    ParsedGitSource {
        original_url,
        clone_url,
        branch,
        subpath,
    }
}

/// Validate that a git URL has a supported scheme.
pub fn validate_git_url(url: &str) -> Result<()> {
    if url.is_empty() {
        anyhow::bail!("Git URL cannot be empty");
    }

    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("git@") {
        anyhow::bail!("Invalid git URL scheme. Expected http://, https://, or git@");
    }

    Ok(())
}

/// Clone a git repository to a temp directory with optional branch, cancellation, and proxy.
pub fn clone_repo_ref(
    url: &str,
    branch: Option<&str>,
    cancel: Option<&AtomicBool>,
    proxy: Option<&str>,
) -> Result<PathBuf> {
    validate_git_url(url)?;

    let temp_dir = tempfile::tempdir()?;
    let temp_path = temp_dir.path().to_path_buf();
    let temp_path_str = temp_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid temp path"))?;

    let mut args: Vec<String> = vec!["clone".to_string(), "--depth".to_string(), "1".to_string()];

    if let Some(b) = branch {
        args.push("-b".to_string());
        args.push(b.to_string());
    }

    args.push(url.to_string());
    args.push(temp_path_str.to_string());

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    // Check cancel flag before starting
    if let Some(cancel_flag) = cancel {
        if cancel_flag.load(Ordering::Relaxed) {
            anyhow::bail!("Clone cancelled");
        }
    }

    let output = match proxy {
        Some(p) => {
            let envs = [("https_proxy", p), ("http_proxy", p)];
            collect_blocking_with(
                &ExecTarget::Local,
                SpawnOptions::new("git", &arg_refs).with_env(&envs),
            )
            .context("Failed to execute git clone")?
        }
        None => collect_blocking_with(&ExecTarget::Local, SpawnOptions::new("git", &arg_refs))
            .context("Failed to execute git clone")?,
    };

    // Check cancel flag after completion
    if let Some(cancel_flag) = cancel {
        if cancel_flag.load(Ordering::Relaxed) {
            cleanup_temp(&temp_path);
            anyhow::bail!("Clone cancelled");
        }
    }

    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Git clone failed: {}", stderr);
    }

    // Leak tempdir so path remains valid
    std::mem::forget(temp_dir);

    Ok(temp_path)
}

/// Get the HEAD commit revision of a git repository.
pub fn get_head_revision(repo_path: &Path) -> Result<String> {
    let repo_str = repo_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid path"))?;
    let output = collect_blocking_with(
        &ExecTarget::Local,
        SpawnOptions::new("git", &["rev-parse", "HEAD"]).with_current_dir(repo_str),
    )
    .context("Failed to get HEAD revision")?;

    if output.exit_code != 0 {
        anyhow::bail!("Failed to get HEAD revision");
    }

    let revision = String::from_utf8(output.stdout)?.trim().to_string();
    Ok(revision)
}

/// Remove a temporary clone directory if it exists.
pub fn cleanup_temp(path: &Path) {
    if path.exists() {
        let _ = std::fs::remove_dir_all(path);
    }
}

/// Convert a GitHub shorthand (owner/repo) to a full HTTPS URL.
#[must_use]
pub fn construct_github_url(source: &str) -> String {
    if source.starts_with("http://") || source.starts_with("https://") || source.starts_with("git@")
    {
        source.to_string()
    } else {
        format!("https://github.com/{}.git", source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_git_source_simple() {
        let parsed = parse_git_source("https://github.com/user/repo.git");
        assert_eq!(parsed.clone_url, "https://github.com/user/repo.git");
        assert!(parsed.branch.is_none());
        assert!(parsed.subpath.is_none());
    }

    #[test]
    fn test_parse_git_source_with_branch() {
        let parsed = parse_git_source("https://github.com/user/repo#main");
        assert_eq!(parsed.clone_url, "https://github.com/user/repo.git");
        assert_eq!(parsed.branch, Some("main".to_string()));
        assert!(parsed.subpath.is_none());
    }

    #[test]
    fn test_parse_git_source_with_branch_and_subpath() {
        let parsed = parse_git_source("https://github.com/user/repo#main:skills/my-skill");
        assert_eq!(parsed.clone_url, "https://github.com/user/repo.git");
        assert_eq!(parsed.branch, Some("main".to_string()));
        assert_eq!(parsed.subpath, Some("skills/my-skill".to_string()));
    }

    #[test]
    fn test_validate_git_url_valid() {
        assert!(validate_git_url("https://github.com/user/repo.git").is_ok());
        assert!(validate_git_url("http://github.com/user/repo.git").is_ok());
        assert!(validate_git_url("git@github.com:user/repo.git").is_ok());
    }

    #[test]
    fn test_validate_git_url_invalid() {
        assert!(validate_git_url("").is_err());
        assert!(validate_git_url("ftp://github.com/user/repo.git").is_err());
        assert!(validate_git_url("github.com/user/repo.git").is_err());
    }

    #[test]
    fn test_construct_github_url() {
        assert_eq!(
            construct_github_url("antfu/skills"),
            "https://github.com/antfu/skills.git"
        );
        assert_eq!(
            construct_github_url("https://github.com/user/repo.git"),
            "https://github.com/user/repo.git"
        );
    }
}
