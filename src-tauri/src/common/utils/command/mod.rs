pub mod gh;
pub mod local;

/// Thin re-export: fire-and-forget IDE launch in WSL.
pub mod wsl {
    use anyhow::{bail, Result};

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

/// SSH channel-based command execution.
///
/// Used by theme modules to execute commands on an already-open SSH channel.
pub mod ssh {
    use anyhow::Result;

    /// Execute a command on an already-opened SSH channel.
    pub async fn exec(channel: &mut russh::Channel<russh::client::Msg>, cmd: &str) -> Result<()> {
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
}
