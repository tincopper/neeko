//! Git credential helpers for filling, approving, and rejecting credentials.

use super::transport::{GitExecOptions, GitTransport};
use anyhow::Result;

/// Git credential protocol data structure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    /// Protocol (e.g. "https", "ssh").
    pub protocol: String,
    /// Host name (e.g. "github.com").
    pub host: String,
    /// Path component of the URL.
    pub path: String,
    /// Optional username.
    pub username: Option<String>,
    /// Optional password (populated from credential helper cache).
    pub password: Option<String>,
}

impl Credential {
    /// Parse protocol + host from a URL. Username is provided separately via `username_hint`.
    pub fn from_url(url: &str, username_hint: Option<&str>) -> Result<Self> {
        // 解析 URL（https://user@host/path 或 https://host/path）
        let url = url.trim();
        let (protocol, rest) = url
            .split_once("://")
            .ok_or_else(|| anyhow::anyhow!("Invalid URL (missing protocol): {}", url))?;
        // 提取 host（去 user@ 前缀）
        let host = rest
            .split_once('@')
            .map(|(_, h)| h)
            .unwrap_or(rest)
            .split('/')
            .next()
            .ok_or_else(|| anyhow::anyhow!("Invalid URL (no host): {}", url))?;
        let path = rest
            .split_once('@')
            .map(|(_, h)| h)
            .unwrap_or(rest)
            .splitn(2, '/')
            .nth(1)
            .unwrap_or("")
            .to_string();
        // username 可能在 URL 中（已剥离），也可能作为 hint
        let username = username_hint.map(String::from);
        Ok(Self {
            protocol: protocol.to_string(),
            host: host.to_string(),
            path,
            username,
            password: None,
        })
    }

    /// Build stdin input for `git credential fill` (query cache, no password).
    pub fn build_fill_input(&self) -> Vec<u8> {
        format!(
            "protocol={}\nhost={}\npath={}\n\n",
            self.protocol, self.host, self.path
        )
        .into_bytes()
    }

    /// Build stdin input for `git credential approve` (store username + password).
    pub fn build_approve_input(&self, username: &str, password: &str) -> Vec<u8> {
        format!(
            "protocol={}\nhost={}\npath={}\nusername={}\npassword={}\n\n",
            self.protocol, self.host, self.path, username, password
        )
        .into_bytes()
    }

    /// Build stdin input for `git credential reject` (delete cached credentials).
    pub fn build_reject_input(&self, username: &str) -> Vec<u8> {
        format!(
            "protocol={}\nhost={}\npath={}\nusername={}\n\n",
            self.protocol, self.host, self.path, username
        )
        .into_bytes()
    }

    /// Parse `git credential fill` stdout output. Returns a Credential with cached username/password.
    /// `password=None` means no cached credentials.
    pub fn parse_fill_output(output: &str) -> Result<Credential> {
        let mut protocol = String::new();
        let mut host = String::new();
        let mut path = String::new();
        let mut username = None;
        let mut password = None;
        for line in output.lines() {
            if let Some((k, v)) = line.split_once('=') {
                match k {
                    "protocol" => protocol = v.to_string(),
                    "host" => host = v.to_string(),
                    "path" => path = v.to_string(),
                    "username" => username = Some(v.to_string()),
                    "password" => password = Some(v.to_string()),
                    _ => {}
                }
            }
        }
        Ok(Credential {
            protocol,
            host,
            path,
            username,
            password,
        })
    }
}

/// Resolve the git credential helper (user config first, then platform default).
/// Returns the helper value without a leading `-c` — callers prepend it into GitExecOptions.
pub async fn resolve_credential_helper(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<String> {
    let trimmed = match transport
        .run_git(&["config", "--get", "credential.helper"], work_dir)
        .await
    {
        Ok(out) => out.trim().to_string(),
        Err(_) => String::new(), // 未配置 → 回退平台默认
    };
    if !trimmed.is_empty() {
        return Ok(trimmed);
    }
    // 回退平台默认
    let platform_default = if cfg!(target_os = "macos") {
        "osxkeychain"
    } else if cfg!(windows) {
        "manager"
    } else {
        // Linux：探测 libsecret 是否可用；否则回退 store（明文）并 warn
        // 这里简单返回 "libsecret"，运行时若不可用 git 会 fallback
        "libsecret"
    };
    Ok(platform_default.to_string())
}

/// Query cached credentials via `git credential fill`.
/// Returns `Some(Credential)` if a cached entry with password was found.
/// Requires `-c credential.helper=<resolved>` injected via GitExecOptions.
pub async fn credential_fill(
    transport: &dyn GitTransport,
    work_dir: &str,
    helper: &str,
    cred: &Credential,
) -> Result<Option<Credential>> {
    let stdin = cred.build_fill_input();
    let opts = GitExecOptions {
        env: &[],
        extra_config: &[("credential.helper", helper)],
    };
    let output = transport
        .run_git_with_stdin(&["credential", "fill"], work_dir, opts, &stdin)
        .await?;
    let result = Credential::parse_fill_output(&output)?;
    if result.password.is_some() {
        Ok(Some(result))
    } else {
        Ok(None)
    }
}

/// Store credentials via `git credential approve` (persists to credential helper).
pub async fn credential_approve(
    transport: &dyn GitTransport,
    work_dir: &str,
    helper: &str,
    cred: &Credential,
    username: &str,
    password: &str,
) -> Result<()> {
    let stdin = cred.build_approve_input(username, password);
    let opts = GitExecOptions {
        env: &[],
        extra_config: &[("credential.helper", helper)],
    };
    let _ = transport
        .run_git_with_stdin(&["credential", "approve"], work_dir, opts, &stdin)
        .await?;
    Ok(())
}

/// Delete cached credentials via `git credential reject`.
pub async fn credential_reject(
    transport: &dyn GitTransport,
    work_dir: &str,
    helper: &str,
    cred: &Credential,
    username: &str,
) -> Result<()> {
    let stdin = cred.build_reject_input(username);
    let opts = GitExecOptions {
        env: &[],
        extra_config: &[("credential.helper", helper)],
    };
    let _ = transport
        .run_git_with_stdin(&["credential", "reject"], work_dir, opts, &stdin)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::git::transport::GitTransportKind;

    // ── Credential::from_url ───────────────────────────────────────────────

    #[test]
    fn should_parse_https_url_without_user() {
        let cred = Credential::from_url("https://github.com/user/repo", None).unwrap();
        assert_eq!(cred.protocol, "https");
        assert_eq!(cred.host, "github.com");
        assert_eq!(cred.path, "user/repo");
        assert_eq!(cred.username, None);
    }

    #[test]
    fn should_parse_https_url_with_user_in_hint() {
        let cred = Credential::from_url("https://github.com/user/repo", Some("bob")).unwrap();
        assert_eq!(cred.username, Some("bob".to_string()));
    }

    #[test]
    fn should_parse_url_with_embedded_user() {
        let cred = Credential::from_url("https://bob@github.com/user/repo", None).unwrap();
        assert_eq!(cred.host, "github.com");
        assert_eq!(cred.path, "user/repo");
        assert_eq!(cred.username, None); // from_url 不解析嵌入的 user，靠 hint
    }

    // ── build_input / parse_output ─────────────────────────────────────────

    #[test]
    fn should_build_fill_input_without_password() {
        let cred = Credential {
            protocol: "https".to_string(),
            host: "github.com".to_string(),
            path: "user/repo".to_string(),
            username: None,
            password: None,
        };
        let input = cred.build_fill_input();
        assert_eq!(
            input,
            b"protocol=https\nhost=github.com\npath=user/repo\n\n"
        );
    }

    #[test]
    fn should_build_approve_input_with_username_password() {
        let cred = Credential {
            protocol: "https".to_string(),
            host: "github.com".to_string(),
            path: "user/repo".to_string(),
            username: None,
            password: None,
        };
        let input = cred.build_approve_input("alice", "ghp_xxx");
        assert_eq!(
            input,
            b"protocol=https\nhost=github.com\npath=user/repo\nusername=alice\npassword=ghp_xxx\n\n"
        );
    }

    #[test]
    fn should_parse_fill_output_with_credentials() {
        let output = "protocol=https\nhost=github.com\nusername=alice\npassword=ghp_xxx\n\n";
        let cred = Credential::parse_fill_output(output).unwrap();
        assert_eq!(cred.protocol, "https");
        assert_eq!(cred.host, "github.com");
        assert_eq!(cred.username, Some("alice".to_string()));
        assert_eq!(cred.password, Some("ghp_xxx".to_string()));
    }

    #[test]
    fn should_parse_fill_output_empty_when_no_cache() {
        let output = "protocol=https\nhost=github.com\n\n";
        let cred = Credential::parse_fill_output(output).unwrap();
        assert_eq!(cred.username, None);
        assert_eq!(cred.password, None);
    }

    // ── resolve_credential_helper ─────────────────────────────────────────

    #[tokio::test]
    #[cfg(target_os = "macos")]
    async fn should_return_osxkeychain_on_macos_when_no_config() {
        let transport = GitTransportKind::Local;
        let helper = resolve_credential_helper(&transport, ".").await.unwrap();
        assert_eq!(helper, "osxkeychain");
    }

    #[tokio::test]
    #[cfg(windows)]
    async fn should_return_manager_on_windows_when_no_config() {
        let transport = GitTransportKind::Local;
        let helper = resolve_credential_helper(&transport, ".").await.unwrap();
        assert_eq!(helper, "manager");
    }

    #[tokio::test]
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    async fn should_return_libsecret_on_linux_when_no_config() {
        let transport = GitTransportKind::Local;
        let helper = resolve_credential_helper(&transport, ".").await.unwrap();
        assert_eq!(helper, "libsecret");
    }

    // ─── 简单模拟 GitExecOptions（实际在 transport.rs）────────────────────

    // 集成测试需要临时 repo + git credential helper，此处仅单元测试纯函数。
    // 填充测试的填充部分 (fill/approve stdin 本地，无需 stdin/网络)
}
