use crate::state::{AuthMethod, TerminalSession, TerminalStatus};
use anyhow::Result;
use russh::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, EventId, Listener};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use uuid::Uuid;

struct SSHHandle {
    /// 用于向 SSH channel 写入数据的 sender（发到 IO 任务）
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    /// 用于向 IO 任务发送 PTY resize 请求 (cols, rows)
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
    input_listener_id: EventId,
    app_handle: tauri::AppHandle,
}

pub struct RemoteTerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    ssh_handles: Arc<Mutex<HashMap<String, SSHHandle>>>,
}

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

impl RemoteTerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            ssh_handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 创建 SSH 终端会话
    pub async fn create_session(
        &self,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        project_path: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        log_info(&format!("[SSH] Session ID: {}", id));
        log_info(&format!("[SSH] Host: {}:{}", host, port));
        log_info(&format!("[SSH] Username: {}", username));
        log_info(&format!("[SSH] Working Dir: {}", project_path));

        // 建立 SSH 连接
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (host, port), Client).await?;

        // 认证
        let auth_result = match auth {
            AuthMethod::Password(password) => {
                session.authenticate_password(username, password).await?
            }
            AuthMethod::KeyFile(key_path) => {
                let key_pair = russh::keys::load_secret_key(key_path, None)?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
            AuthMethod::KeyFileWithPassphrase {
                key_path,
                passphrase,
            } => {
                let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
        };

        if !auth_result.success() {
            return Err(anyhow::anyhow!("SSH authentication failed"));
        }

        log_info(&format!("[SSH] Authentication successful for {}", username));

        // 打开 channel
        let mut channel = session.channel_open_session().await?;

        // 请求 PTY
        channel
            .request_pty(
                false,
                "xterm-256color",
                cols as u32,
                rows as u32,
                0,
                0,
                &[],
            )
            .await?;

        // 请求 shell
        channel.request_shell(true).await?;

        // 切换到项目目录
        let cd_cmd = format!("cd {}\n", project_path);
        channel.data(cd_cmd.as_bytes()).await?;

        // 创建 session 对象
        let terminal_session = TerminalSession {
            id: id.clone(),
            pid: None,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(id.clone(), terminal_session.clone());

        // mpsc channel：input listener → IO 任务
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        // mpsc channel：resize 请求 (cols, rows) → IO 任务
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();

        // 监听前端输入事件，把数据放入 mpsc
        let tx_clone = input_tx.clone();
        let input_listener_id =
            app_handle.listen(&format!("terminal-input-{}", id), move |event| {
                match serde_json::from_str::<Vec<u8>>(event.payload()) {
                    Ok(data) => {
                        let _ = tx_clone.send(data);
                    }
                    Err(e) => {
                        log_error(&format!(
                            "[SSH-WRITER] Parse error: {} payload={}",
                            e,
                            event.payload()
                        ));
                    }
                }
            });

        // 保存 handle（包含 resize_tx，供 resize_session 调用）
        self.ssh_handles.lock().unwrap().insert(
            id.clone(),
            SSHHandle {
                input_tx,
                resize_tx,
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

        // 用 make_writer() 分离读写端，避免 select! 中的可变借用冲突
        let mut writer = channel.make_writer();

        // IO 任务：在独立 tokio 线程里同时处理读写和 resize，消除锁竞争
        let io_id = id.clone();
        let read_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("ssh-io-{}", &id[..8]))
            .spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async move {
                    log_info(&format!("[SSH-IO] Thread started for {}", &io_id[..8]));
                    loop {
                        tokio::select! {
                            // 从前端收到输入 → 写入 SSH channel（写端独立，无借用冲突）
                            maybe_data = input_rx.recv() => {
                                match maybe_data {
                                    Some(data) => {
                                        if let Err(e) = writer.write_all(&data).await {
                                            log_error(&format!("[SSH-IO] Write error: {}", e));
                                            break;
                                        }
                                    }
                                    None => break, // sender 全部 drop，退出
                                }
                            }
                            // 收到 resize 请求 → 发送 window_change 给远端 PTY
                            maybe_resize = resize_rx.recv() => {
                                match maybe_resize {
                                    Some((cols, rows)) => {
                                        if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                                            log_error(&format!("[SSH-IO] window_change error: {}", e));
                                        }
                                    }
                                    None => break,
                                }
                            }
                            // 从 SSH channel 收到输出 → 发给前端（读端独立）
                            msg = channel.wait() => {
                                match msg {
                                    Some(ChannelMsg::Data { data }) => {
                                        let event_name = format!("terminal-output-{}", io_id);
                                        let data_vec = data.to_vec();
                                        if let Err(e) = read_handle.emit(&event_name, &data_vec) {
                                            log_error(&format!("[SSH-IO] Emit error: {}", e));
                                            break;
                                        }
                                    }
                                    Some(ChannelMsg::Eof) => {
                                        log_info("[SSH-IO] EOF");
                                        break;
                                    }
                                    Some(ChannelMsg::Close) => {
                                        log_info("[SSH-IO] Channel closed");
                                        break;
                                    }
                                    None => {
                                        log_info("[SSH-IO] Channel disconnected");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    log_info(&format!("[SSH-IO] Thread exiting for {}", &io_id[..8]));
                });
            })?;

        log_info(&format!("[SSH] Session {} ready", &id[..8]));
        Ok(terminal_session)
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let handles = self.ssh_handles.lock().unwrap();
        if let Some(handle) = handles.get(session_id) {
            let _ = handle.resize_tx.send((cols as u32, rows as u32));
            log_info(&format!(
                "[SSH] Resize {}x{} sent to session {}",
                cols, rows, &session_id[..8]
            ));
        }
        Ok(())
    }

    pub fn close_session(&self, session_id: &str) {
        log_info(&format!(
            "[SSH] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));
        self.sessions.lock().unwrap().remove(session_id);

        if let Some(handle) = self.ssh_handles.lock().unwrap().remove(session_id) {
            // 注销 input 监听器
            handle.app_handle.unlisten(handle.input_listener_id);
            // input_tx drop 后，IO 任务的 recv() 会返回 None，任务自然退出
        }
    }

    pub fn close_all_sessions(&self) {
        log_info("[SSH] Closing all sessions...");
        let ids: Vec<String> = self.ssh_handles.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.close_session(&id);
        }
        log_info("[SSH] All sessions closed");
    }

    /// 测试 SSH 连接是否可用（验证 host/port/username/auth）
    pub async fn test_connection(
        &self,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
    ) -> Result<()> {
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (host, port), Client).await?;

        let auth_result = match auth {
            AuthMethod::Password(password) => {
                session.authenticate_password(username, password).await?
            }
            AuthMethod::KeyFile(key_path) => {
                let key_pair = russh::keys::load_secret_key(key_path, None)?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
            AuthMethod::KeyFileWithPassphrase { key_path, passphrase } => {
                let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
        };

        if !auth_result.success() {
            return Err(anyhow::anyhow!("Authentication failed: invalid credentials"));
        }

        let mut channel = session.channel_open_session().await?;
        channel.exec(true, b"echo ok").await?;
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::ExitStatus { .. }) | None => break,
                Some(russh::ChannelMsg::Eof) => break,
                _ => {}
            }
        }
        let _ = channel.close().await;
        let _ = session.disconnect(russh::Disconnect::ByApplication, "", "").await;
        Ok(())
    }

    /// 列出远程服务器上指定路径下的子目录（用于路径自动补全）
    /// 建立一次性 SSH 连接，执行 ls 并返回目录名列表
    pub async fn list_directories(
        &self,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        path: &str,
    ) -> Result<Vec<String>> {
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (host, port), Client).await?;

        let auth_result = match auth {
            AuthMethod::Password(password) => {
                session.authenticate_password(username, password).await?
            }
            AuthMethod::KeyFile(key_path) => {
                let key_pair = russh::keys::load_secret_key(key_path, None)?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
            AuthMethod::KeyFileWithPassphrase { key_path, passphrase } => {
                let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
        };

        if !auth_result.success() {
            return Err(anyhow::anyhow!("SSH authentication failed"));
        }

        let mut channel = session.channel_open_session().await?;
        let safe_path = path.replace('\'', "'\\''");
        let cmd = format!(
            "ls -1p '{}' 2>/dev/null | grep '/$' | sed 's|/$||'",
            safe_path
        );
        channel.exec(true, cmd.as_bytes()).await?;

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    output.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::Eof) | None => break,
                Some(russh::ChannelMsg::ExitStatus { .. }) => break,
                _ => {}
            }
        }

        let _ = channel.close().await;
        let _ = session.disconnect(russh::Disconnect::ByApplication, "", "").await;

        let dirs = String::from_utf8_lossy(&output)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.trim().to_string())
            .collect();

        Ok(dirs)
    }
}

fn log_info(msg: &str) {
    log::info!("{}", msg);
}

fn log_error(msg: &str) {
    log::error!("{}", msg);
}
