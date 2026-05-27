use crate::connection::types::AuthMethod;
use crate::utils::command::ssh_auth;
use anyhow::Result;

/// 通过 SSH 通道执行命令并等待完成（验证 exit code）
pub async fn exec(channel: &mut russh::Channel<russh::client::Msg>, cmd: &str) -> Result<()> {
    use russh::ChannelMsg;

    channel.exec(true, cmd.as_bytes()).await?;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                if exit_status != 0 {
                    return Err(anyhow::anyhow!(
                        "SSH command failed with exit code {}",
                        exit_status
                    ));
                }
            }
            Some(ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }
    Ok(())
}

/// SSH 一次性认证连接 + 执行命令 + 返回 stdout
pub async fn exec_command(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    cmd: &str,
) -> Result<String> {
    let session = ssh_auth::connect_and_authenticate(host, port, username, auth).await?;

    let mut channel = session.channel_open_session().await?;
    channel.exec(true, cmd.as_bytes()).await?;

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut exit_code: Option<u32> = None;

    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { data }) => {
                stdout_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                stderr_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            Some(russh::ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();

    if let Some(code) = exit_code {
        if code != 0 {
            let stderr = String::from_utf8_lossy(&stderr_buf).trim().to_string();
            let msg = if !stderr.is_empty() {
                stderr
            } else {
                format!("SSH command failed with exit code {}", code)
            };
            return Err(anyhow::anyhow!("{}", msg));
        }
    }

    Ok(stdout)
}

pub fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}
