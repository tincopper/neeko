use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone)]
pub struct ParsedGitSource {
    pub original_url: String,
    pub clone_url: String,
    pub branch: Option<String>,
    pub subpath: Option<String>,
}

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

pub fn validate_git_url(url: &str) -> Result<()> {
    if url.is_empty() {
        anyhow::bail!("Git URL cannot be empty");
    }

    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("git@") {
        anyhow::bail!("Invalid git URL scheme. Expected http://, https://, or git@");
    }

    Ok(())
}

pub fn clone_repo_ref(
    url: &str,
    branch: Option<&str>,
    cancel: Option<&AtomicBool>,
    proxy: Option<&str>,
) -> Result<PathBuf> {
    validate_git_url(url)?;

    let temp_dir = tempfile::tempdir()?;
    let temp_path = temp_dir.path().to_path_buf();

    let mut cmd = Command::new("git");
    cmd.args(["clone", "--depth", "1"]);

    if let Some(b) = branch {
        cmd.args(["-b", b]);
    }

    if let Some(p) = proxy {
        cmd.env("https_proxy", p);
        cmd.env("http_proxy", p);
    }

    cmd.arg(url);
    cmd.arg(&temp_path);

    // Check cancel flag before starting
    if let Some(cancel_flag) = cancel {
        if cancel_flag.load(Ordering::Relaxed) {
            anyhow::bail!("Clone cancelled");
        }
    }

    let output = cmd.output().context("Failed to execute git clone")?;

    // Check cancel flag after completion
    if let Some(cancel_flag) = cancel {
        if cancel_flag.load(Ordering::Relaxed) {
            cleanup_temp(&temp_path);
            anyhow::bail!("Clone cancelled");
        }
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Git clone failed: {}", stderr);
    }

    // Leak tempdir so path remains valid
    std::mem::forget(temp_dir);

    Ok(temp_path)
}

pub fn get_head_revision(repo_path: &Path) -> Result<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get HEAD revision")?;

    if !output.status.success() {
        anyhow::bail!("Failed to get HEAD revision");
    }

    let revision = String::from_utf8(output.stdout)?.trim().to_string();
    Ok(revision)
}

pub fn cleanup_temp(path: &Path) {
    if path.exists() {
        let _ = std::fs::remove_dir_all(path);
    }
}

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
