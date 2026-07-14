pub mod gh;
pub mod local;

/// Thin re-export: delegates to the unified executor.
pub mod wsl {
    use anyhow::{bail, Result};

    /// Execute a command inside a WSL distribution.
    #[cfg(target_os = "windows")]
    pub fn exec(distro: &str, cmd: &str) -> Result<String> {
        let target = crate::common::executor::factory::ExecTarget::Wsl {
            distro: distro.to_string(),
        };
        crate::common::executor::sync::exec_on(&target, "bash", &["-c", cmd])
            .map_err(|e| anyhow::anyhow!("{}", e))
    }

    /// Non-Windows stub for exec.
    #[cfg(not(target_os = "windows"))]
    pub fn exec(_distro: &str, _cmd: &str) -> Result<String> {
        bail!("WSL is only supported on Windows")
    }

    /// Launch an IDE inside a WSL distribution (fire-and-forget).
    ///
    /// Kept as a standalone utility since it doesn't fit the ExecChild model.
    #[cfg(target_os = "windows")]
    pub fn open_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
        use crate::common::utils::command::local;
        let _child = local::exec("wsl.exe")
            .arg("-d")
            .arg(distro)
            .arg("--cd")
            .arg(project_path)
            .arg("--")
            .arg(ide)
            .arg(".")
            .spawn()
            .map_err(|e| anyhow::anyhow!("Failed to launch IDE in WSL: {}", e))?;
        Ok(())
    }

    /// Non-Windows stub.
    #[cfg(not(target_os = "windows"))]
    pub fn open_ide(_distro: &str, _project_path: &str, _ide: &str) -> Result<()> {
        bail!("WSL is only supported on Windows")
    }
}

/// Thin re-export: delegates to the unified executor.
pub mod ssh {
    use anyhow::Result;
    use crate::common::connection::types::AuthMethod;

    /// Execute a command on an already-opened SSH channel.
    ///
    /// Kept as a standalone utility since the executor opens its own
    /// connection. Used by theme/service.rs for config file operations.
    pub async fn exec(
        channel: &mut russh::Channel<russh::client::Msg>,
        cmd: &str,
    ) -> Result<()> {
        use russh::ChannelMsg;

        channel.exec(true, cmd.as_bytes()).await?;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    if exit_status != 0 {
                        return Err(anyhow::anyhow!(
                            "SSH command failed with exit code {}",
                            exit_status,
                        ));
                    }
                }
                Some(ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }
        Ok(())
    }

    /// Connect to a remote host via SSH, execute a command, and return stdout.
    pub async fn exec_command(
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        cmd: &str,
    ) -> Result<String> {
        let target = crate::common::executor::factory::ExecTarget::Remote {
            host: host.to_string(),
            port,
            username: username.to_string(),
            auth: auth.clone(),
        };
        crate::common::executor::sync::exec_on(&target, "sh", &["-c", cmd])
            .map_err(|e| anyhow::anyhow!("{}", e))
    }
}
