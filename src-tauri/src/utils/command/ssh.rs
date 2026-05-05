use crate::models::AuthMethod;
use anyhow::Result;
use russh::*;
use std::sync::Arc;

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
    struct Client;

    impl client::Handler for Client {
        type Error = russh::Error;
        async fn check_server_key(
            &mut self,
            _server_public_key: &russh::keys::PublicKey,
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }
    }

    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), Client).await?;

    let auth_result = match auth {
        AuthMethod::Password(password) => session.authenticate_password(username, password).await?,
        AuthMethod::KeyFile(key_path) => {
            let key_pair = russh::keys::load_secret_key(key_path, None)?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session
                .authenticate_publickey(username, key_with_hash)
                .await?
        }
        AuthMethod::KeyFileWithPassphrase {
            key_path,
            passphrase,
        } => {
            let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session
                .authenticate_publickey(username, key_with_hash)
                .await?
        }
    };

    if !auth_result.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

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