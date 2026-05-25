use anyhow::Result;
use std::process::Command;

use crate::models::AuthMethod;
use crate::utils::command::local::exec as local_exec;
#[cfg(target_os = "windows")]
use crate::utils::command::wsl;
use crate::utils::command::ssh::{exec_command, safe_path};

pub enum GitTransport {
    Local,
    #[cfg(target_os = "windows")]
    Wsl { distro: String },
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
    },
}

impl GitTransport {
    /// Execute a raw git command, returning stdout
    pub async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> {
        match self {
            GitTransport::Local => {
                let output = local_exec("git")
                    .args(args)
                    .current_dir(work_dir)
                    .output()?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    anyhow::bail!(
                        "git command failed: git {} (exit {:?}): {}",
                        args.join(" "),
                        output.status.code(),
                        stderr.trim(),
                    );
                }
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
            #[cfg(target_os = "windows")]
            GitTransport::Wsl { distro } => {
                let sp = safe_path(work_dir);
                let quoted_args: Vec<String> = args
                    .iter()
                    .map(|a| format!("'{}'", safe_path(a)))
                    .collect();
                let cmd = format!("cd '{sp}' && git {}", quoted_args.join(" "));
                wsl::exec(distro, &cmd)
            }
            GitTransport::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let sp = safe_path(work_dir);
                let git_cmd = format!("git {}", args.join(" "));
                let cmd = format!("cd '{sp}' && {git_cmd}");
                exec_command(host, *port, username, auth, &cmd).await
            }
        }
    }

    /// Check if a directory is a git repo
    pub async fn is_git_repo(&self, path: &str) -> bool {
        match self {
            GitTransport::Local => {
                std::path::Path::new(path).join(".git").exists()
            }
            #[cfg(target_os = "windows")]
            GitTransport::Wsl { distro } => {
                let sp = safe_path(path);
                let cmd = format!("test -d '{sp}/.git'");
                wsl::exec(distro, &cmd).is_ok()
            }
            GitTransport::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let sp = safe_path(path);
                let cmd = format!("test -d '{sp}/.git'");
                exec_command(host, *port, username, auth, &cmd).await.is_ok()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_local_run_git() {
        let transport = GitTransport::Local;
        let result = transport.run_git(&["--version"], ".").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("git version"));
    }

    #[tokio::test]
    async fn test_local_is_git_repo() {
        let transport = GitTransport::Local;
        assert!(!transport.is_git_repo("/tmp").await);
    }
}
